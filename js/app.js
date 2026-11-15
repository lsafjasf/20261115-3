import {
  WIDTH_STEPS,
  FONT_STACK,
  computeLayout,
  findRowOverlaps,
  findOutOfBounds,
  defaultGuides,
} from "./layout.js";
import { buildSvg } from "./svg.js";

const state = {
  text: "字体实验 Typography Lab 2026",
  weight: 700,
  slant: -8,
  fontSize: 64,
  fillColor: "#15181d",
  bgColor: "#ffffff",
  guideColor: "#e0533d",
  showGuides: true,
  exportGuides: true,
  showLabels: true,
};

let guides = [];
let layout = null;

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const statusText = $("statusText");

const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

function measureText(text, fontSize, fontWeight) {
  measureCtx.font = `${fontWeight} ${fontSize}px ${FONT_STACK}`;
  const metrics = measureCtx.measureText(text);
  return metrics.width;
}

function currentOptions(interactive = false) {
  return {
    showGuides: state.showGuides,
    exportGuides: state.exportGuides,
    showLabels: state.showLabels,
    interactive,
  };
}

function render() {
  const safeText = state.text.trim() || " ";
  const nextLayout = computeLayout(
    { ...state, text: safeText },
    measureText
  );
  layout = nextLayout;
  if (guides.length === 0) {
    guides = defaultGuides(layout);
  }

  clampGuides();
  const svg = buildSvg({
    layout,
    state: { ...state, text: safeText },
    guides,
    options: currentOptions(true),
  });
  stage.innerHTML = svg;
  stage.style.width = `${layout.width}px`;
  stage.style.height = `${layout.height}px`;
  fitStage();
  bindGuideInteractions();
  reportSafety();
}

function fitStage() {
  const scroll = $("stageScroll");
  const available = scroll.clientWidth - 24;
  const scale = Math.min(1, available / layout.width);
  stage.style.transform = `scale(${scale})`;
  stage.style.transformOrigin = "top left";
  stage.style.marginBottom = `${layout.height * (scale - 1)}px`;
  stage.style.marginRight = `${layout.width * (scale - 1)}px`;
}

function reportSafety() {
  const overlaps = findRowOverlaps(layout);
  const outOfBounds = findOutOfBounds(layout);
  if (overlaps.length === 0 && outOfBounds.length === 0) {
    statusText.textContent = `五档宽度自检通过：${layout.rows.length} 行无明显重叠，画布 ${layout.width}×${layout.height}px`;
    statusText.className = "status ok";
  } else {
    statusText.textContent = `自检异常：重叠 ${JSON.stringify(overlaps)} 越界 ${JSON.stringify(outOfBounds)}`;
    statusText.className = "status err";
  }
}

function clampGuides() {
  guides.forEach((guide) => {
    const max = guide.orientation === "h" ? layout.height : layout.width;
    guide.pos = Math.min(Math.max(guide.pos, 0), max);
  });
}

function resetGuides() {
  guides = defaultGuides(layout);
}

function addGuide(orientation) {
  const id = `g-${orientation}-${Date.now()}`;
  const pos =
    orientation === "h" ? Math.round(layout.height / 2) : Math.round(layout.width / 2);
  guides.push({ id, orientation, pos });
  render();
}
function svgPoint(evt) {
  const svg = stage.querySelector("svg");
  const rect = svg.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * layout.width,
    y: ((evt.clientY - rect.top) / rect.height) * layout.height,
  };
}

function bindGuideInteractions() {
  const svg = stage.querySelector("svg");
  svg.querySelectorAll(".guide").forEach((group) => {
    const id = group.getAttribute("data-guide-id");
    const guide = guides.find((item) => item.id === id);
    const line = group.querySelector(".guide-line");
    if (!guide) return;

    group.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      group.setPointerCapture(evt.pointerId);
      line.classList.add("selected");
      const start = svgPoint(evt);
      const startPos = guide.pos;

      const onMove = (moveEvt) => {
        const point = svgPoint(moveEvt);
        guide.pos =
          guide.orientation === "h"
            ? startPos + (point.y - start.y)
            : startPos + (point.x - start.x);
        updateGuideDom(guide);
      };
      const onUp = (upEvt) => {
        group.releasePointerCapture(upEvt.pointerId);
        line.classList.remove("selected");
        group.removeEventListener("pointermove", onMove);
        group.removeEventListener("pointerup", onUp);
        clampGuides();
        updateGuideDom(guide);
      };
      group.addEventListener("pointermove", onMove);
      group.addEventListener("pointerup", onUp);
    });

    group.addEventListener("dblclick", () => {
      guides = guides.filter((item) => item.id !== guide.id);
      render();
    });
  });
}

function updateGuideDom(guide) {
  const group = stage.querySelector(`[data-guide-id="${CSS.escape(guide.id)}"]`);
  if (!group) return;
  const pos = Math.round(guide.pos * 100) / 100;
  group.querySelectorAll("line").forEach((line) => {
    if (guide.orientation === "h") {
      line.setAttribute("y1", pos);
      line.setAttribute("y2", pos);
    } else {
      line.setAttribute("x1", pos);
      line.setAttribute("x2", pos);
    }
  });
}

function exportSvg() {
  const svg = buildSvg({
    layout,
    state: { ...state, text: state.text.trim() || " " },
    guides,
    options: currentOptions(false),
  });
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  link.download = `title-morph-${stamp}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function initControls() {
  const chips = $("widthChips");
  chips.innerHTML = WIDTH_STEPS.map(
    (scale) => `<span class="chip">${Math.round(scale * 100)}%</span>`
  ).join("");

  $("titleText").addEventListener("input", (evt) => {
    state.text = evt.target.value;
    render();
  });

  $("weightRange").addEventListener("input", (evt) => {
    state.weight = Number(evt.target.value);
    $("weightValue").textContent = state.weight;
    $("weightHint").textContent =
      state.weight <= 400 ? "系统原生字重" : "stroke 模拟加粗";
    render();
  });

  $("slantRange").addEventListener("input", (evt) => {
    state.slant = Number(evt.target.value);
    $("slantValue").textContent = `${state.slant}°`;
    render();
  });

  $("sizeRange").addEventListener("input", (evt) => {
    state.fontSize = Number(evt.target.value);
    $("sizeValue").textContent = `${state.fontSize} px`;
    render();
  });

  $("fillColor").addEventListener("input", (evt) => {
    state.fillColor = evt.target.value;
    render();
  });
  $("bgColor").addEventListener("input", (evt) => {
    state.bgColor = evt.target.value;
    render();
  });
  $("guideColor").addEventListener("input", (evt) => {
    state.guideColor = evt.target.value;
    render();
  });

  $("showGuides").addEventListener("change", (evt) => {
    state.showGuides = evt.target.checked;
    render();
  });
  $("exportGuides").addEventListener("change", (evt) => {
    state.exportGuides = evt.target.checked;
  });
  $("showLabels").addEventListener("change", (evt) => {
    state.showLabels = evt.target.checked;
    render();
  });

  $("addHGuide").addEventListener("click", () => addGuide("h"));
  $("addVGuide").addEventListener("click", () => addGuide("v"));
  $("resetBtn").addEventListener("click", () => {
    resetGuides();
    render();
  });
  $("exportBtn").addEventListener("click", exportSvg);
}

function selfCheck() {
  const overlaps = findRowOverlaps(layout);
  const outOfBounds = findOutOfBounds(layout);
  return {
    ok: overlaps.length === 0 && outOfBounds.length === 0,
    overlaps,
    outOfBounds,
    rowCount: layout.rows.length,
    canvas: { width: layout.width, height: layout.height },
  };
}

initControls();
render();
window.addEventListener("resize", fitStage);

window.TitleMorph = {
  getState: () => ({ ...state }),
  getLayout: () => layout,
  getGuides: () => guides.map((guide) => ({ ...guide })),
  setGuides: (next) => {
    guides = next.map((guide) => ({ ...guide }));
    render();
  },
  resetGuides: () => {
    resetGuides();
    render();
  },
  selfCheck,
  render,
  buildExportSvg: () =>
    buildSvg({
      layout,
      state: { ...state, text: state.text.trim() || " " },
      guides,
      options: currentOptions(false),
    }),
};
