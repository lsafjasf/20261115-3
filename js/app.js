import { STAGE, SAFE_ZONE, findSafeZoneViolations } from "./geometry.js";
import { generatePhotos } from "./photos.js";

const STORAGE_KEY = "collage-project-v1";
const stage = document.getElementById("stage");
const safezoneEl = document.getElementById("safezone");
const warningEl = document.getElementById("safezone-warning");
const layerListEl = document.getElementById("layer-list");
const controlsEl = document.getElementById("layer-controls");

const photos = new Map();
for (const p of generatePhotos()) photos.set(p.id, p);

const state = {
  layers: [],
  selectedId: null,
  cropMode: false,
};

const history = { undo: [], redo: [] };

function snapshot() {
  return JSON.stringify({ layers: state.layers, selectedId: state.selectedId });
}

// 在“即将修改状态”之前调用：把当前（或指定）状态压入撤销栈
function commit(snap) {
  history.undo.push(snap ?? snapshot());
  if (history.undo.length > 100) history.undo.shift();
  history.redo.length = 0;
  updateUndoRedoButtons();
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.layers = data.layers;
  state.selectedId = data.selectedId;
  state.cropMode = false;
  renderAll();
}

function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  restore(history.undo.pop());
  updateUndoRedoButtons();
}

function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  restore(history.redo.pop());
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  document.getElementById("btn-undo").disabled = !history.undo.length;
  document.getElementById("btn-redo").disabled = !history.redo.length;
}

function selectedLayer() {
  return state.layers.find((l) => l.id === state.selectedId) || null;
}

function defaultLayout() {
  const defs = [
    { id: "sunset", x: 300, y: 360, rotation: -6, scale: 0.62, opacity: 1 },
    { id: "geometry", x: 660, y: 380, rotation: 5, scale: 0.55, opacity: 0.95 },
    { id: "night", x: 480, y: 470, rotation: 2, scale: 0.5, opacity: 0.9 },
  ];
  state.layers = defs.map((d) => {
    const photo = photos.get(d.id);
    return {
      ...d,
      name: photo.name,
      visible: true,
      crop: { x: 0, y: 0, w: photo.width, h: photo.height },
    };
  });
  state.selectedId = state.layers[state.layers.length - 1].id;
}

// ---------- 渲染 ----------

function renderStage() {
  stage.querySelectorAll(".layer").forEach((el) => el.remove());
  state.layers.forEach((layer, index) => {
    const photo = photos.get(layer.id);
    const el = document.createElement("div");
    el.className = "layer" + (layer.id === state.selectedId ? " selected" : "");
    el.dataset.id = layer.id;
    el.style.zIndex = index + 1;
    el.style.opacity = layer.opacity;
    el.style.transform =
      `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotation}deg) scale(${layer.scale})`;

    const win = document.createElement("div");
    win.className = "crop-window";
    win.style.width = layer.crop.w + "px";
    win.style.height = layer.crop.h + "px";

    const img = document.createElement("img");
    img.src = photo.dataURL;
    img.draggable = false;
    img.style.width = photo.width + "px";
    img.style.height = photo.height + "px";
    img.style.left = -layer.crop.x + "px";
    img.style.top = -layer.crop.y + "px";
    win.appendChild(img);
    el.appendChild(win);

    if (layer.id === state.selectedId) {
      if (state.cropMode) addCropHandles(el, layer);
      else addRotateHandle(el, layer);
    }
    stage.appendChild(el);
  });
}

function addRotateHandle(el, layer) {
  const h = document.createElement("div");
  h.className = "handle rotate";
  h.style.left = "0px";
  h.style.top = -(layer.crop.h / 2 + 34) + "px";
  h.dataset.kind = "rotate";
  el.appendChild(h);
}

function addCropHandles(el, layer) {
  const corners = [
    [-1, -1], [1, -1], [1, 1], [-1, 1],
  ];
  for (const [sx, sy] of corners) {
    const h = document.createElement("div");
    h.className = "handle crop";
    h.style.left = (sx * layer.crop.w) / 2 + "px";
    h.style.top = (sy * layer.crop.h) / 2 + "px";
    h.dataset.kind = "crop";
    h.dataset.sx = sx;
    h.dataset.sy = sy;
    el.appendChild(h);
  }
}

function renderLayerList() {
  layerListEl.innerHTML = "";
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const li = document.createElement("li");
    li.textContent = layer.name;
    li.dataset.id = layer.id;
    if (layer.id === state.selectedId) li.classList.add("selected");
    const tag = document.createElement("span");
    tag.className = "ztag";
    tag.textContent = `层级 ${i + 1}`;
    li.appendChild(tag);
    layerListEl.appendChild(li);
  }
}

function renderSafeZone() {
  const show = document.getElementById("chk-safezone").checked;
  safezoneEl.style.display = show ? "block" : "none";
  safezoneEl.style.left = SAFE_ZONE.x + "px";
  safezoneEl.style.top = SAFE_ZONE.y + "px";
  safezoneEl.style.width = SAFE_ZONE.width + "px";
  safezoneEl.style.height = SAFE_ZONE.height + "px";
  const violations = findSafeZoneViolations(state.layers);
  safezoneEl.classList.toggle("violated", violations.length > 0);
  warningEl.hidden = violations.length === 0;
}

function renderControls() {
  const layer = selectedLayer();
  controlsEl.hidden = !layer;
  if (!layer) return;
  document.getElementById("inp-opacity").value = Math.round(layer.opacity * 100);
  document.getElementById("opacity-val").textContent = Math.round(layer.opacity * 100) + "%";
  document.getElementById("inp-rotation").value = Math.round(layer.rotation);
  document.getElementById("rotation-val").textContent = Math.round(layer.rotation) + "°";
  document.getElementById("inp-scale").value = Math.round(layer.scale * 100);
  document.getElementById("scale-val").textContent = Math.round(layer.scale * 100) + "%";
  document.getElementById("btn-crop").classList.toggle("active", state.cropMode);
}

function renderAll() {
  renderStage();
  renderLayerList();
  renderSafeZone();
  renderControls();
}

// ---------- 指针交互 ----------

function stagePoint(evt) {
  const rect = stage.getBoundingClientRect();
  const k = STAGE.width / rect.width;
  return {
    x: (evt.clientX - rect.left) * k,
    y: (evt.clientY - rect.top) * k,
  };
}

// 舞台坐标 -> 图层局部坐标（未旋转、未缩放）
function toLocal(layer, pt) {
  const a = (-layer.rotation * Math.PI) / 180;
  const dx = pt.x - layer.x;
  const dy = pt.y - layer.y;
  return {
    x: (dx * Math.cos(a) - dy * Math.sin(a)) / layer.scale,
    y: (dx * Math.sin(a) + dy * Math.cos(a)) / layer.scale,
  };
}

let drag = null;

stage.addEventListener("pointerdown", (evt) => {
  const handle = evt.target.closest(".handle");
  const layerEl = evt.target.closest(".layer");
  if (handle && layerEl) {
    const layer = state.layers.find((l) => l.id === layerEl.dataset.id);
    if (!layer) return;
    if (handle.dataset.kind === "rotate") {
      const pt = stagePoint(evt);
      drag = {
        type: "rotate",
        layer,
        startAngle: (Math.atan2(pt.y - layer.y, pt.x - layer.x) * 180) / Math.PI,
        startRotation: layer.rotation,
        moved: false,
        before: snapshot(),
      };
    } else if (handle.dataset.kind === "crop") {
      drag = {
        type: "crop",
        layer,
        sx: Number(handle.dataset.sx),
        sy: Number(handle.dataset.sy),
        moved: false,
        before: snapshot(),
      };
    }
  } else if (layerEl) {
    const layer = state.layers.find((l) => l.id === layerEl.dataset.id);
    if (!layer) return;
    state.selectedId = layer.id;
    const pt = stagePoint(evt);
    drag = { type: "move", layer, dx: pt.x - layer.x, dy: pt.y - layer.y, moved: false, before: snapshot() };
    renderAll();
  } else {
    state.selectedId = null;
    renderAll();
  }
  if (drag) {
    evt.preventDefault();
    stage.setPointerCapture(evt.pointerId);
  }
});

stage.addEventListener("pointermove", (evt) => {
  if (!drag) return;
  const pt = stagePoint(evt);
  const layer = drag.layer;
  if (drag.type === "move") {
    layer.x = Math.round(pt.x - drag.dx);
    layer.y = Math.round(pt.y - drag.dy);
    drag.moved = true;
  } else if (drag.type === "rotate") {
    const angle = (Math.atan2(pt.y - layer.y, pt.x - layer.x) * 180) / Math.PI;
    let deg = drag.startRotation + angle - drag.startAngle;
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    layer.rotation = Math.round(deg * 10) / 10;
    drag.moved = true;
  } else if (drag.type === "crop") {
    applyCropDrag(layer, drag, pt);
    drag.moved = true;
  }
  renderAll();
});

stage.addEventListener("pointerup", () => {
  if (drag && drag.moved) commit(drag.before);
  drag = null;
});

function applyCropDrag(layer, dragInfo, pt) {
  const photo = photos.get(layer.id);
  const local = toLocal(layer, pt);
  const crop = layer.crop;
  const minSize = 40;
  // 窗口局部坐标：中心为原点，crop 窗口半宽半高
  const hw = crop.w / 2;
  const hh = crop.h / 2;
  let newLeft = -hw, newRight = hw, newTop = -hh, newBottom = hh;
  if (dragInfo.sx < 0) newLeft = Math.min(local.x, newRight - minSize);
  else newRight = Math.max(local.x, newLeft + minSize);
  if (dragInfo.sy < 0) newTop = Math.min(local.y, newBottom - minSize);
  else newBottom = Math.max(local.y, newTop + minSize);

  // 窗口局部坐标 -> 图片源坐标：源图以 (-crop.x, -crop.y) 偏移贴在窗口内
  const toSrc = (vx, vy) => ({ x: vx + crop.x + crop.w / 2, y: vy + crop.y + crop.h / 2 });
  const tl = toSrc(newLeft, newTop);
  const br = toSrc(newRight, newBottom);
  const nx = Math.max(0, Math.min(tl.x, photo.width - minSize));
  const ny = Math.max(0, Math.min(tl.y, photo.height - minSize));
  const nw = Math.min(photo.width - nx, Math.max(minSize, br.x - tl.x));
  const nh = Math.min(photo.height - ny, Math.max(minSize, br.y - tl.y));
  layer.crop = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
}

// ---------- 面板控件 ----------

layerListEl.addEventListener("click", (evt) => {
  const li = evt.target.closest("li");
  if (!li) return;
  state.selectedId = li.dataset.id;
  renderAll();
});

function bindSlider(id, valId, fmt, apply) {
  const input = document.getElementById(id);
  let before = null;
  input.addEventListener("pointerdown", () => (before = snapshot()));
  input.addEventListener("keydown", () => (before ??= snapshot()));
  input.addEventListener("input", () => {
    const layer = selectedLayer();
    if (!layer) return;
    apply(layer, Number(input.value));
    document.getElementById(valId).textContent = fmt(Number(input.value));
    renderStage();
    renderSafeZone();
  });
  input.addEventListener("change", () => {
    if (before) commit(before);
    before = null;
  });
}

bindSlider("inp-opacity", "opacity-val", (v) => v + "%", (l, v) => (l.opacity = v / 100));
bindSlider("inp-rotation", "rotation-val", (v) => v + "°", (l, v) => (l.rotation = v));
bindSlider("inp-scale", "scale-val", (v) => v + "%", (l, v) => (l.scale = v / 100));

function reorder(layer, toIndex) {
  const from = state.layers.indexOf(layer);
  if (from < 0) return;
  commit();
  state.layers.splice(from, 1);
  state.layers.splice(Math.max(0, Math.min(state.layers.length, toIndex)), 0, layer);
  renderAll();
}

document.getElementById("btn-front").addEventListener("click", () => {
  const l = selectedLayer();
  if (l) reorder(l, state.layers.length);
});
document.getElementById("btn-back").addEventListener("click", () => {
  const l = selectedLayer();
  if (l) reorder(l, 0);
});
document.getElementById("btn-up").addEventListener("click", () => {
  const l = selectedLayer();
  if (l) reorder(l, state.layers.indexOf(l) + 2);
});
document.getElementById("btn-down").addEventListener("click", () => {
  const l = selectedLayer();
  if (l) reorder(l, state.layers.indexOf(l) - 1);
});

document.getElementById("btn-crop").addEventListener("click", () => {
  state.cropMode = !state.cropMode;
  renderAll();
});
document.getElementById("btn-crop-reset").addEventListener("click", () => {
  const layer = selectedLayer();
  if (!layer) return;
  const photo = photos.get(layer.id);
  commit();
  layer.crop = { x: 0, y: 0, w: photo.width, h: photo.height };
  renderAll();
});

document.getElementById("chk-safezone").addEventListener("change", renderSafeZone);
document.getElementById("btn-undo").addEventListener("click", undo);
document.getElementById("btn-redo").addEventListener("click", redo);
document.addEventListener("keydown", (evt) => {
  if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "z" && !evt.shiftKey) {
    evt.preventDefault();
    undo();
  } else if (
    (evt.ctrlKey || evt.metaKey) &&
    (evt.key.toLowerCase() === "y" || (evt.shiftKey && evt.key.toLowerCase() === "z"))
  ) {
    evt.preventDefault();
    redo();
  }
});

// ---------- 工程保存 / 载入 ----------

function serializeProject() {
  return JSON.stringify(
    {
      version: 1,
      stage: STAGE,
      safeZone: SAFE_ZONE,
      layers: state.layers,
      selectedId: state.selectedId,
    },
    null,
    2
  );
}

function loadProjectData(data) {
  if (!data || !Array.isArray(data.layers)) throw new Error("工程文件格式不正确");
  for (const layer of data.layers) {
    if (!photos.has(layer.id)) throw new Error(`未知照片：${layer.id}`);
    const photo = photos.get(layer.id);
    layer.name = layer.name || photo.name;
    layer.visible = layer.visible !== false;
  }
  state.layers = data.layers;
  state.selectedId = data.selectedId || null;
  state.cropMode = false;
  history.undo.length = 0;
  history.redo.length = 0;
  updateUndoRedoButtons();
  renderAll();
}

document.getElementById("btn-save").addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEY, serializeProject());
  flashButton("btn-save", "已保存 ✓");
});

document.getElementById("btn-load").addEventListener("click", () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    flashButton("btn-load", "无存档");
    return;
  }
  try {
    loadProjectData(JSON.parse(raw));
  } catch (err) {
    alert("载入失败：" + err.message);
  }
});

document.getElementById("btn-download-project").addEventListener("click", () => {
  downloadBlob(
    new Blob([serializeProject()], { type: "application/json" }),
    "collage-project.json"
  );
});

document.getElementById("file-project").addEventListener("change", async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;
  try {
    loadProjectData(JSON.parse(await file.text()));
  } catch (err) {
    alert("载入失败：" + err.message);
  }
  evt.target.value = "";
});

// 双击“载入工程”从文件恢复：长按不合适，这里用单独的隐藏 input 由按钮触发
document.getElementById("btn-load").addEventListener("dblclick", () => {
  document.getElementById("file-project").click();
});

function flashButton(id, text) {
  const btn = document.getElementById(id);
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1200);
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- 导出 PNG（保留裁切与透明度） ----------

function renderExportCanvas(scaleFactor = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = STAGE.width * scaleFactor;
  canvas.height = STAGE.height * scaleFactor;
  const ctx = canvas.getContext("2d");
  ctx.scale(scaleFactor, scaleFactor);
  for (const layer of state.layers) {
    if (layer.visible === false) continue;
    const photo = photos.get(layer.id);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.scale(layer.scale, layer.scale);
    ctx.drawImage(
      photo.canvas,
      layer.crop.x,
      layer.crop.y,
      layer.crop.w,
      layer.crop.h,
      -layer.crop.w / 2,
      -layer.crop.h / 2,
      layer.crop.w,
      layer.crop.h
    );
    ctx.restore();
  }
  return canvas;
}

document.getElementById("btn-export").addEventListener("click", () => {
  renderExportCanvas(2).toBlob((blob) => downloadBlob(blob, "collage.png"), "image/png");
});

// ---------- 初始化 ----------

function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      loadProjectData(JSON.parse(raw));
      return;
    } catch {
      // 存档损坏则退回默认布局
    }
  }
  defaultLayout();
  renderAll();
  updateUndoRedoButtons();
}

init();

// 供自动化验证 / 脚本驱动使用
window.Collage = {
  STAGE,
  SAFE_ZONE,
  getState: () => JSON.parse(snapshot()),
  setState: (s) => {
    state.layers = s.layers;
    state.selectedId = s.selectedId ?? null;
    state.cropMode = false;
    renderAll();
  },
  commit,
  undo,
  redo,
  violations: () => findSafeZoneViolations(state.layers),
  exportDataURL: (scale = 2) => renderExportCanvas(scale).toDataURL("image/png"),
  serializeProject,
};
