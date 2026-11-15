import {
  DEFAULT_LAYERS,
  FAULT,
  bearingLabel,
  cloneLayers,
  createCut,
  sampleSection,
} from "./model.js";
import { buildSectionSVG } from "./export-svg.js";
import { clampCamera, DEFAULT_CAMERA } from "./projection.js";
import { renderSection2D, sectionSummaryText } from "./render2d.js";
import { render3D } from "./render3d.js";

const state = {
  layers: cloneLayers(),
  cut: { angleDeg: 75, offsetKm: 0.3 },
  camera: { ...DEFAULT_CAMERA },
};

const elements = {
  canvas3d: document.querySelector("#view3d"),
  canvas2d: document.querySelector("#view2d"),
  wrap3d: document.querySelector("#view3d-wrap"),
  wrap2d: document.querySelector("#view2d-wrap"),
  layerEditor: document.querySelector("#layer-editor"),
  cutAngle: document.querySelector("#cut-angle"),
  cutOffset: document.querySelector("#cut-offset"),
  angleOutput: document.querySelector("#angle-output"),
  offsetOutput: document.querySelector("#offset-output"),
  cutBearing: document.querySelector("#cut-bearing"),
  cutLength: document.querySelector("#cut-length"),
  sectionSubtitle: document.querySelector("#section-subtitle"),
  veBadge: document.querySelector("#ve-badge"),
  metricTotal: document.querySelector("#metric-total"),
  metricLength: document.querySelector("#metric-length"),
  metricFault: document.querySelector("#metric-fault"),
  metricAverage: document.querySelector("#metric-average"),
  compositionBar: document.querySelector("#composition-bar"),
  compositionLegend: document.querySelector("#composition-legend"),
  compositionTotal: document.querySelector("#composition-total"),
  editFlash: document.querySelector("#edit-flash"),
  cameraReadout: document.querySelector("#camera-readout"),
  dragCue: document.querySelector("#drag-cue"),
  exportSvg: document.querySelector("#export-svg"),
};

let renderPending = false;
let flashTimer = null;
let embeddedFontPromise = null;

function buildLayerEditor() {
  const topDown = [...state.layers].reverse();
  elements.layerEditor.innerHTML = topDown.map((layer) => `
    <label class="layer-row" data-layer="${layer.id}" style="--layer-color:${layer.color}">
      <i class="layer-chip" aria-hidden="true"></i>
      <span class="layer-name"><b>${layer.id}</b><span title="${layer.lithology}">${layer.name}</span></span>
      <span class="thickness-field">
        <input type="number" inputmode="numeric" min="5" max="320" step="5" value="${layer.thickness}" aria-label="${layer.name}厚度（米）" />
      </span>
    </label>
  `).join("");

  elements.layerEditor.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", handleThicknessInput);
    input.addEventListener("change", handleThicknessInput);
  });
  markEditedLayers();
}

function handleThicknessInput(event) {
  const row = event.currentTarget.closest(".layer-row");
  const layer = state.layers.find((item) => item.id === row.dataset.layer);
  if (!layer) return;
  const value = Number(event.currentTarget.value);
  if (!Number.isFinite(value) || value < 5 || value > 320) return;
  if (layer.thickness === value) return;
  layer.thickness = value;
  markEditedLayers();
  updateAll();
  showFlash(`${layer.id} 厚度已更新`);
}

function markEditedLayers() {
  elements.layerEditor.querySelectorAll(".layer-row").forEach((row) => {
    const layer = state.layers.find((item) => item.id === row.dataset.layer);
    const original = DEFAULT_LAYERS.find((item) => item.id === row.dataset.layer);
    row.classList.toggle("is-edited", Boolean(layer && original && layer.thickness !== original.thickness));
  });
}

function updateAll() {
  const cut = createCut(state.cut.angleDeg, state.cut.offsetKm);
  const section = sampleSection(state.layers, cut, 150);
  if (!section) return;

  updateReadouts(section, cut);
  updateMetrics(section);
  scheduleRender();
}

function updateReadouts(section, cut) {
  const angle = Math.round(state.cut.angleDeg);
  const offset = state.cut.offsetKm;
  elements.angleOutput.value = `${String(angle).padStart(3, "0")}°`;
  elements.offsetOutput.value = `${offset >= 0 ? "+" : "−"}${Math.abs(offset).toFixed(2)} km`;
  elements.cutBearing.textContent = `A—A′ · ${bearingLabel(angle)}`;
  elements.cutLength.textContent = `剖面长 ${section.sectionLengthKm.toFixed(2)} km`;
  elements.sectionSubtitle.textContent = `A—A′ · 方位 ${String(angle).padStart(3, "0")}° · ${section.sectionLengthKm.toFixed(2)} km`;
  void cut;
}

function updateMetrics(section) {
  const total = section.totalThicknessMeters;
  const average = section.meanThicknessMeters;
  elements.metricTotal.innerHTML = `${Math.round(total)}<small> m</small>`;
  elements.metricLength.innerHTML = `${section.sectionLengthKm.toFixed(2)}<small> km</small>`;
  elements.metricFault.innerHTML = section.faultThrowMeters
    ? `${FAULT.throwMeters}<small> m</small>`
    : `—<small> 未切过</small>`;
  elements.metricAverage.innerHTML = `${Math.round(average)}<small> m</small>`;
  elements.compositionTotal.textContent = `${Math.round(total)} m`;

  elements.compositionBar.innerHTML = section.layers.map((layer) =>
    `<i style="--bar-color:${layer.color};width:${(layer.sectionShare * 100).toFixed(3)}%" title="${layer.name} ${Math.round(layer.averageMeters)} m"></i>`).join("");
  elements.compositionLegend.innerHTML = section.layers.map((layer) =>
    `<span title="${layer.name}"><i style="--legend-color:${layer.color}"></i>${layer.id} ${Math.round(layer.sectionShare * 100)}%</span>`).join("");
}

function showFlash(message) {
  elements.editFlash.textContent = message;
  elements.editFlash.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => elements.editFlash.classList.remove("show"), 1600);
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderViews();
  });
}

function prepareCanvas(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function renderViews() {
  const cut = createCut(state.cut.angleDeg, state.cut.offsetKm);
  const view3d = prepareCanvas(elements.canvas3d);
  render3D(view3d.ctx, { ...view3d, layers: state.layers, cut, camera: state.camera });
  const view2d = prepareCanvas(elements.canvas2d);
  const figure = renderSection2D(view2d.ctx, { ...view2d, layers: state.layers, cut });
  if (figure) {
    elements.veBadge.textContent = `垂向 ${figure.verticalExaggeration.toFixed(1)}×`;
    elements.sectionSubtitle.title = sectionSummaryText(figure);
  }
  updateCameraReadout();
}

function updateCameraReadout() {
  const yaw = (state.camera.yaw * 180 / Math.PI + 360) % 360;
  const pitch = state.camera.pitch * 180 / Math.PI;
  elements.cameraReadout.textContent = `方位 ${yaw.toFixed(0).padStart(3, "0")}° · 俯角 ${pitch.toFixed(0)}°`;
}

function resetLayers() {
  state.layers = cloneLayers();
  buildLayerEditor();
  updateAll();
  showFlash("地层厚度已恢复");
}

function resetAll() {
  state.layers = cloneLayers();
  state.cut = { angleDeg: 75, offsetKm: 0.3 };
  state.camera = { ...DEFAULT_CAMERA };
  elements.cutAngle.value = "75";
  elements.cutOffset.value = "0.3";
  buildLayerEditor();
  updateAll();
  showFlash("全部参数已重置");
}

function loadEmbeddedFont() {
  if (!embeddedFontPromise) {
    embeddedFontPromise = fetch("./assets/fonts/noto-sans-sc-subset.woff2")
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return `data:font/woff2;base64,${btoa(binary)}`;
      });
  }
  return embeddedFontPromise;
}

async function handleExport() {
  elements.exportSvg.disabled = true;
  showFlash("正在生成剖面 SVG");
  try {
    const fontDataUrl = await loadEmbeddedFont();
    const cut = createCut(state.cut.angleDeg, state.cut.offsetKm);
    const svg = buildSectionSVG(state.layers, cut, { fontDataUrl });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lithoslice-section-${Math.round(state.cut.angleDeg)}deg.svg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showFlash("剖面 SVG 已导出");
  } catch (error) {
    console.error(error);
    showFlash("导出失败，请重试");
  } finally {
    elements.exportSvg.disabled = false;
  }
}

function bindEvents() {
  elements.cutAngle.addEventListener("input", (event) => {
    state.cut.angleDeg = Number(event.currentTarget.value);
    updateAll();
  });
  elements.cutOffset.addEventListener("input", (event) => {
    state.cut.offsetKm = Number(event.currentTarget.value);
    updateAll();
  });
  document.querySelector("#reset-layers").addEventListener("click", resetLayers);
  document.querySelector("#reset-all").addEventListener("click", resetAll);
  document.querySelector("#reset-camera").addEventListener("click", () => {
    state.camera = { ...DEFAULT_CAMERA };
    scheduleRender();
  });
  elements.exportSvg.addEventListener("click", handleExport);
  bindCamera();
  new ResizeObserver(scheduleRender).observe(elements.wrap3d);
  new ResizeObserver(scheduleRender).observe(elements.wrap2d);
}

function bindCamera() {
  const canvas = elements.canvas3d;
  let drag = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      yaw: state.camera.yaw,
      pitch: state.camera.pitch,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    elements.dragCue.classList.add("hidden");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    state.camera = clampCamera({
      ...state.camera,
      yaw: drag.yaw - dx * 0.0075,
      pitch: drag.pitch + dy * 0.0055,
    });
    scheduleRender();
  });

  const finishDrag = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    canvas.classList.remove("is-dragging");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.camera = clampCamera({
      ...state.camera,
      zoom: state.camera.zoom * Math.exp(-event.deltaY * 0.0011),
    });
    scheduleRender();
  }, { passive: false });

  canvas.addEventListener("dblclick", () => {
    state.camera = { ...DEFAULT_CAMERA };
    scheduleRender();
  });
}

buildLayerEditor();
bindEvents();
loadEmbeddedFont().catch(() => {});
requestAnimationFrame(updateAll);
