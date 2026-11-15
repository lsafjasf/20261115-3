const OBJECT_LABELS = {
  title: "主标题",
  photo: "秋日风景",
  orb: "夕阳圆形",
  caption: "说明文字",
  pill: "工作室标签",
  line: "装饰线条",
};

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

function isEditable(target) {
  return target instanceof Element && Boolean(target.closest(EDITABLE_SELECTOR));
}

function isDialogOpen() {
  return Boolean(document.querySelector("dialog[open]"));
}

export function initCanvas({ openShortcuts } = {}) {
  const artboard = document.querySelector("#artboard");
  const selectionNote = document.querySelector("#selection-note");
  const selectedLabel = document.querySelector("#selected-label");
  const toolButtons = [...document.querySelectorAll("[data-tool]")];
  const layerButtons = [...document.querySelectorAll("[data-layer]")];
  const inspectorInputs = {
    x: document.querySelector("#position-x"),
    y: document.querySelector("#position-y"),
    width: document.querySelector("#size-w"),
    height: document.querySelector("#size-h"),
  };

  let selectedId = "title";
  let generatedCount = 0;

  function objectFor(id) {
    return artboard.querySelector(`[data-object="${CSS.escape(id)}"]`);
  }

  function labelFor(id) {
    if (OBJECT_LABELS[id]) return OBJECT_LABELS[id];
    const layer = document.querySelector(`[data-layer="${CSS.escape(id)}"]`);
    if (layer) return layer.querySelector("span:nth-child(2)")?.textContent.trim() || "图层";
    return objectFor(id)?.getAttribute("aria-label") || "图层";
  }

  function objectRect(element) {
    const boardRect = artboard.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left - boardRect.left),
      y: Math.round(rect.top - boardRect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function updateInspector() {
    const element = selectedId ? objectFor(selectedId) : null;
    if (!element) {
      Object.values(inspectorInputs).forEach((input) => {
        input.value = "";
        input.disabled = true;
      });
      selectedLabel.textContent = "未选中";
      return;
    }

    const rect = objectRect(element);
    inspectorInputs.x.value = rect.x;
    inspectorInputs.y.value = rect.y;
    inspectorInputs.width.value = rect.width;
    inspectorInputs.height.value = rect.height;
    Object.values(inspectorInputs).forEach((input) => {
      input.disabled = false;
    });
    selectedLabel.textContent = labelFor(selectedId);
  }

  function select(id, { announce = true, focusCanvas = false } = {}) {
    if (id && !objectFor(id)) return;
    selectedId = id;

    artboard.querySelectorAll(".canvas-object").forEach((element) => {
      const isSelected = element.dataset.object === id;
      element.classList.toggle("is-selected", isSelected);
      element.setAttribute("aria-selected", String(isSelected));
    });

    layerButtons.forEach((button) => {
      const isSelected = button.dataset.layer === id;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-selected", String(isSelected));
    });

    updateInspector();
    if (announce) {
      selectionNote.textContent = id ? `${labelFor(id)} 已选中` : "未选中任何图层";
    }
    if (focusCanvas) artboard.focus({ preventScroll: true });
  }

  function isCanvasContext() {
    const active = document.activeElement;
    return (
      active === artboard ||
      artboard.contains(active) ||
      active?.matches?.(".layer-item, .tool-button")
    );
  }

  function setActiveTool(tool) {
    toolButtons.forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function addObject(type) {
    generatedCount += 1;
    const id = `${type}-${generatedCount}`;
    const element = document.createElement("div");
    element.className = `canvas-object added-object added-${type}`;
    element.dataset.object = id;
    element.style.left = "43%";
    element.style.top = "43%";

    if (type === "shape") {
      element.setAttribute("aria-label", `矩形 ${generatedCount}`);
      element.innerHTML = `<span>NEW SHAPE</span>`;
    } else {
      element.setAttribute("aria-label", `文本 ${generatedCount}`);
      element.innerHTML = `<span>新文本</span>`;
    }

    artboard.append(element);
    const layers = document.querySelector(".layer-list");
    const button = document.createElement("button");
    button.className = "layer-item";
    button.type = "button";
    button.dataset.layer = id;
    button.setAttribute("role", "treeitem");
    button.setAttribute("aria-selected", "false");
    button.innerHTML = `<span class="layer-type ${type === "shape" ? "shape" : ""}" aria-hidden="true">${
      type === "shape" ? "▭" : "T"
    }</span><span>${type === "shape" ? "新矩形" : "新文本"}</span><span class="layer-lock" aria-hidden="true">◇</span>`;
    button.addEventListener("click", () => select(id, { focusCanvas: false }));
    layers.append(button);
    layerButtons.push(button);

    setActiveTool(type);
    select(id, { announce: true, focusCanvas: true });
  }

  function moveSelected(dx, dy) {
    const element = selectedId ? objectFor(selectedId) : null;
    if (!element) return;
    const rect = objectRect(element);
    element.style.left = `${rect.x + dx}px`;
    element.style.top = `${rect.y + dy}px`;
    updateInspector();
  }

  function deleteSelected() {
    const element = selectedId ? objectFor(selectedId) : null;
    if (!element) return;
    const removedLabel = labelFor(selectedId);
    document.querySelector(`[data-layer="${CSS.escape(selectedId)}"]`)?.remove();
    element.remove();
    selectedId = null;
    select(null, { announce: false });
    selectionNote.textContent = `${removedLabel} 已删除`;
  }

  layerButtons.forEach((button) => {
    button.addEventListener("click", () => select(button.dataset.layer));
  });

  artboard.addEventListener("pointerdown", (event) => {
    const object = event.target.closest(".canvas-object");
    if (object) select(object.dataset.object, { announce: false });
    artboard.focus({ preventScroll: true });
  });

  artboard.addEventListener("focus", () => {
    if (!artboard.querySelector(".canvas-object.is-selected") && selectedId) {
      select(selectedId, { announce: false });
    }
  });

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTool(button.dataset.tool);
      if (button.dataset.tool === "shape") addObject("shape");
      if (button.dataset.tool === "text") addObject("text");
    });
  });

  Object.entries(inspectorInputs).forEach(([property, input]) => {
    input.addEventListener("change", () => {
      const element = selectedId ? objectFor(selectedId) : null;
      const value = Number(input.value);
      if (!element || !Number.isFinite(value)) return;
      if (property === "x" || property === "y") {
        element.style[property === "x" ? "left" : "top"] = `${value}px`;
      } else {
        element.style[property] = `${Math.max(1, value)}px`;
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || isDialogOpen() || isEditable(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "?" && !isCanvasContext()) {
      event.preventDefault();
      openShortcuts?.();
      return;
    }

    if (!isCanvasContext()) return;

    const step = event.shiftKey ? 10 : 2;
    const moves = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };

    if (moves[event.key]) {
      event.preventDefault();
      moveSelected(...moves[event.key]);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      addObject("shape");
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      addObject("text");
    } else if (event.key === "?") {
      event.preventDefault();
      openShortcuts?.();
    }
  });

  select("title", { announce: false });
  return { select, addObject, getSelectedId: () => selectedId };
}
