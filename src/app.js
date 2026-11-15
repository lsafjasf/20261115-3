/*
 * app.js — UI wiring for the multi-layer texture compositor.
 *
 * Consistency guarantee: both the on-screen preview and the PNG export
 * are produced from the SAME Uint8ClampedArray returned by
 * Compositor.flatten(). Layer source pixels are never mutated by
 * compositing, so exporting any number of times cannot accumulate
 * rounding error.
 */
(function () {
  "use strict";

  const WIDTH = 512;
  const HEIGHT = 512;
  const STORAGE_KEY = "texture-compositor-project";

  const TYPE_NAMES = {
    background: "背景",
    frost: "磨砂",
    stain: "污渍",
    highlight: "高光",
  };
  const MODE_NAMES = {
    normal: "正常",
    multiply: "正片叠底",
    screen: "滤色",
    overlay: "叠加",
    add: "线性加深(加)",
    difference: "差值",
  };

  let nextId = 1;

  function makeLayer(type, overrides) {
    const seed = Math.floor(Math.random() * 1e9);
    return Object.assign(
      {
        id: nextId++,
        type,
        name: TYPE_NAMES[type] || type,
        params: { seed },
        mode: type === "highlight" ? "screen" : "normal",
        opacity: 1,
        visible: true,
      },
      overrides || {}
    );
  }

  // ---- project state -------------------------------------------------
  // layers are stored TOP-first (as shown in the panel); flatten()
  // receives them reversed (bottom-first).
  let state = { width: WIDTH, height: HEIGHT, layers: [] };
  let undoStack = [];
  let redoStack = [];

  const pixelCache = new Map(); // layer.id -> Uint8ClampedArray

  function layerPixels(layer) {
    let px = pixelCache.get(layer.id);
    if (!px) {
      px = LayerFactory.generate(layer.type, state.width, state.height, layer.params);
      pixelCache.set(layer.id, px);
    }
    return px;
  }

  function serialize() {
    return JSON.stringify({
      version: 1,
      width: state.width,
      height: state.height,
      layers: state.layers.map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        params: l.params,
        mode: l.mode,
        opacity: l.opacity,
        visible: l.visible,
      })),
    });
  }

  function deserialize(json) {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.layers)) throw new Error("工程文件格式无效");
    state = {
      width: data.width || WIDTH,
      height: data.height || HEIGHT,
      layers: data.layers.map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name || TYPE_NAMES[l.type] || l.type,
        params: l.params || {},
        mode: l.mode || "normal",
        opacity: typeof l.opacity === "number" ? l.opacity : 1,
        visible: l.visible !== false,
      })),
    };
    pixelCache.clear();
    nextId = Math.max(0, ...state.layers.map((l) => l.id)) + 1;
  }

  function pushHistory() {
    undoStack.push(serialize());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(serialize());
    deserialize(undoStack.pop());
    renderAll();
    updateHistoryButtons();
    setStatus("已撤销");
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(serialize());
    deserialize(redoStack.pop());
    renderAll();
    updateHistoryButtons();
    setStatus("已重做");
  }

  // ---- rendering -----------------------------------------------------
  const canvas = document.getElementById("preview");
  const ctx = canvas.getContext("2d");

  // Single source of truth for BOTH screen and export.
  function compositeNow() {
    const bottomFirst = state.layers
      .slice()
      .reverse()
      .map((l) => ({
        pixels: layerPixels(l),
        mode: l.mode,
        opacity: l.opacity,
        visible: l.visible,
      }));
    return Compositor.flatten(bottomFirst, state.width * state.height);
  }

  function renderPreview() {
    const flat = compositeNow();
    const img = new ImageData(new Uint8ClampedArray(flat), state.width, state.height);
    ctx.putImageData(img, 0, 0);
  }

  function renderAll() {
    renderPreview();
    renderLayerList();
  }

  // ---- layer panel ---------------------------------------------------
  const listEl = document.getElementById("layer-list");

  function renderLayerList() {
    listEl.innerHTML = "";
    state.layers.forEach((layer, index) => {
      const item = document.createElement("div");
      item.className = "layer-item";
      item.draggable = true;
      item.dataset.index = index;

      const head = document.createElement("div");
      head.className = "layer-head";

      const grip = document.createElement("span");
      grip.className = "grip";
      grip.textContent = "⠿";

      const vis = document.createElement("input");
      vis.type = "checkbox";
      vis.checked = layer.visible;
      vis.title = "显示/隐藏";
      vis.addEventListener("change", () => {
        pushHistory();
        layer.visible = vis.checked;
        renderPreview();
      });

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = layer.name + " #" + layer.id;

      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        pushHistory();
        state.layers.splice(index, 1);
        pixelCache.delete(layer.id);
        renderAll();
      });

      head.append(grip, vis, name, del);

      const controls = document.createElement("div");
      controls.className = "layer-controls";

      const modeSel = document.createElement("select");
      for (const m of Compositor.BLEND_MODES) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = MODE_NAMES[m] || m;
        modeSel.appendChild(opt);
      }
      modeSel.value = layer.mode;
      modeSel.addEventListener("change", () => {
        pushHistory();
        layer.mode = modeSel.value;
        renderPreview();
      });

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(Math.round(layer.opacity * 100));

      const pct = document.createElement("span");
      pct.className = "pct";
      pct.textContent = slider.value + "%";

      let sliderBase = null; // history checkpoint for drag sessions
      slider.addEventListener("pointerdown", () => {
        sliderBase = serialize();
      });
      slider.addEventListener("input", () => {
        layer.opacity = Number(slider.value) / 100;
        pct.textContent = slider.value + "%";
        renderPreview(); // live update while dragging
      });
      slider.addEventListener("change", () => {
        if (sliderBase !== null && sliderBase !== serialize()) {
          undoStack.push(sliderBase);
          redoStack = [];
          updateHistoryButtons();
        }
        sliderBase = null;
      });

      controls.append(modeSel, slider, pct);
      item.append(head, controls);

      // drag-to-reorder: result recomputes on every hover move
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        for (const el of listEl.querySelectorAll(".drop-target"))
          el.classList.remove("drop-target");
      });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("drop-target");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drop-target");
        const from = Number(e.dataTransfer.getData("text/plain"));
        const to = index;
        if (Number.isNaN(from) || from === to) return;
        pushHistory();
        const [moved] = state.layers.splice(from, 1);
        state.layers.splice(to, 0, moved);
        renderAll(); // pixel result updates immediately
        setStatus(`已移动「${moved.name}」到第 ${to + 1} 层`);
      });

      listEl.appendChild(item);
    });
  }

  // ---- toolbar: add / undo / redo / save / load / export -------------
  function setStatus(msg) {
    document.getElementById("status").textContent = msg;
  }

  function updateHistoryButtons() {
    document.getElementById("btn-undo").disabled = !undoStack.length;
    document.getElementById("btn-redo").disabled = !redoStack.length;
  }

  document.querySelectorAll("#add-row button").forEach((btn) => {
    btn.addEventListener("click", () => {
      pushHistory();
      const layer = makeLayer(btn.dataset.type);
      state.layers.unshift(layer); // new layers go on top
      renderAll();
      setStatus(`已添加「${layer.name}」`);
    });
  });

  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  });

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  document.getElementById("btn-save").addEventListener("click", () => {
    const json = serialize();
    localStorage.setItem(STORAGE_KEY, json);
    download(new Blob([json], { type: "application/json" }), "project.json");
    setStatus("工程已保存（文件 + 本地存储）");
  });

  const fileInput = document.getElementById("file-input");
  document.getElementById("btn-load").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        pushHistory();
        deserialize(text);
        renderAll();
        setStatus("工程已载入");
      } catch (err) {
        undoStack.pop();
        setStatus("载入失败：" + err.message);
      }
    });
    fileInput.value = "";
  });

  // Export uses the exact same flatten() output as the preview,
  // encoded by our deterministic PNG encoder (no color management).
  document.getElementById("btn-export").addEventListener("click", () => {
    const flat = compositeNow();
    const png = PNGEncoder.encodePNG(flat, state.width, state.height);
    download(new Blob([png], { type: "image/png" }), "composite.png");
    setStatus(`已导出 PNG（${png.length} 字节）`);
  });

  // ---- init ----------------------------------------------------------
  (function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        deserialize(saved);
      } catch {
        state.layers = [];
      }
    }
    if (!state.layers.length) {
      // default 5-layer stack (top first): highlight / stain / frost /
      // stain / background — matches the verification test scene.
      state.layers = [
        makeLayer("highlight", { id: 5, params: { seed: 101 }, mode: "screen", opacity: 0.8 }),
        makeLayer("stain", { id: 4, params: { seed: 77, count: 5 }, mode: "multiply", opacity: 0.9 }),
        makeLayer("frost", { id: 3, params: { seed: 42 }, mode: "normal", opacity: 0.7 }),
        makeLayer("stain", { id: 2, params: { seed: 9, count: 4 }, mode: "multiply", opacity: 0.6 }),
        makeLayer("background", { id: 1, params: {} }),
      ];
      nextId = 6;
    }
    renderAll();
    updateHistoryButtons();
  })();
})();
