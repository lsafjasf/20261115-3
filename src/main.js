import {
  DEFAULT_LAYERS,
  INITIAL_CAMERA,
  LANDMARKS,
  clampCamera,
} from "./map-data.js";
import { exportViewportPng } from "./exporter.js";
import { drawMap, getLandmarkScreenPositions, hitTestLandmark } from "./render-map.js";

const canvas = document.querySelector("#mapCanvas");
const mapFrame = document.querySelector("#mapFrame");
const context = canvas.getContext("2d", { alpha: false });
const exportButton = document.querySelector("#exportButton");
const exportOverlay = document.querySelector("#exportOverlay");
const exportDone = document.querySelector("#exportDone");
const mapToast = document.querySelector("#mapToast");

const state = {
  camera: { ...INITIAL_CAMERA },
  layers: { ...DEFAULT_LAYERS },
  selectedId: null,
  viewport: { width: 1, height: 1, dpr: 1 },
  exporting: false,
  lastExport: null,
  toastTimer: null,
};

let renderQueued = false;
let drag = null;

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPreview();
  });
}

function renderPreview() {
  const { width, height, dpr } = state.viewport;
  if (!width || !height) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMap(context, {
    width,
    height,
    camera: state.camera,
    layers: state.layers,
    selectedId: state.selectedId,
  });
}

function resizeViewport() {
  const rect = mapFrame.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (width === state.viewport.width && height === state.viewport.height && dpr === state.viewport.dpr) return;

  state.viewport = { width, height, dpr };
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  updateSizeLabels();
  queueRender();
}

function updateSizeLabels() {
  const { width, height } = state.viewport;
  const outputWidth = width * 4;
  const outputHeight = height * 4;
  const tileCount = Math.ceil(outputWidth / 1024) * Math.ceil(outputHeight / 1024);
  const megapixels = (outputWidth * outputHeight) / 1_000_000;
  document.querySelector("#viewportSize").textContent = `Viewport ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")}`;
  document.querySelector("#exportSize").textContent =
    `4× output ${outputWidth.toLocaleString("en-US")} × ${outputHeight.toLocaleString("en-US")}`;
  document.querySelector("#tileCount").textContent = `${tileCount} tiles`;
  document.querySelector("#previewDimensions").textContent = `${outputWidth.toLocaleString("en-US")} × ${outputHeight.toLocaleString("en-US")}`;
  document.querySelector("#previewMegapixels").textContent = `${megapixels.toFixed(1)} megapixels`;
  updateScaleIndicators();
}

function updateScaleIndicators() {
  document.querySelector("#zoomLevel").textContent = `${Math.round(state.camera.zoom * 100)}%`;
  const meters = Math.max(50, Math.round((500 / state.camera.zoom) / 50) * 50);
  document.querySelector("#scaleLabel").textContent = `${meters.toLocaleString("en-US")} m`;
}

function formatCoordinate(value, positive, negative) {
  const hemisphere = value >= 0 ? positive : negative;
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
  return `${degrees}° ${String(minutes).padStart(2, "0")}′ ${seconds.padStart(4, "0")}″ ${hemisphere}`;
}

function updateCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const worldX = (screenX - rect.width / 2) / state.camera.zoom + state.camera.x;
  const worldY = (screenY - rect.height / 2) / state.camera.zoom + state.camera.y;
  const latitude = 51.506 + (573 - worldY) * 0.00042;
  const longitude = -0.088 + (worldX - 880) * 0.00058;
  document.querySelector("#coordinateReadout").textContent =
    `${formatCoordinate(latitude, "N", "S")} · ${formatCoordinate(longitude, "E", "W")}`;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  mapToast.textContent = message;
  mapToast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    mapToast.hidden = true;
  }, 2200);
}

function selectLandmark(hit) {
  state.selectedId = hit?.id || null;
  if (hit) {
    const landmark = LANDMARKS.find((item) => item.id === hit.id);
    showToast(`${landmark.number} · ${landmark.name} — ${Math.round(hit.x)}, ${Math.round(hit.y)} px`);
  }
  queueRender();
}

function zoomAt(screenX, screenY, nextZoom) {
  const oldZoom = state.camera.zoom;
  const zoom = Math.min(2.4, Math.max(0.68, nextZoom));
  const { width, height } = state.viewport;
  const worldX = (screenX - width / 2) / oldZoom + state.camera.x;
  const worldY = (screenY - height / 2) / oldZoom + state.camera.y;
  state.camera = clampCamera({
    x: worldX - (screenX - width / 2) / zoom,
    y: worldY - (screenY - height / 2) / zoom,
    zoom,
  });
  updateScaleIndicators();
  queueRender();
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    cameraX: state.camera.x,
    cameraY: state.camera.y,
    moved: false,
  };
});

canvas.addEventListener("pointermove", (event) => {
  updateCoordinates(event);
  if (!drag || drag.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 2) drag.moved = true;
  state.camera = clampCamera({
    ...state.camera,
    x: drag.cameraX - deltaX / state.camera.zoom,
    y: drag.cameraY - deltaY / state.camera.zoom,
  });
  queueRender();
});

canvas.addEventListener("pointerup", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  canvas.classList.remove("is-dragging");
  canvas.releasePointerCapture(event.pointerId);
  const rect = canvas.getBoundingClientRect();
  if (!drag.moved) {
    selectLandmark(
      hitTestLandmark(state.viewport.width, state.viewport.height, state.camera, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }),
    );
  }
  drag = null;
});

canvas.addEventListener("pointercancel", () => {
  canvas.classList.remove("is-dragging");
  drag = null;
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0012);
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, state.camera.zoom * factor);
  },
  { passive: false },
);

document.querySelector("#zoomIn").addEventListener("click", () => {
  zoomAt(state.viewport.width / 2, state.viewport.height / 2, state.camera.zoom * 1.18);
});

document.querySelector("#zoomOut").addEventListener("click", () => {
  zoomAt(state.viewport.width / 2, state.viewport.height / 2, state.camera.zoom / 1.18);
});

document.querySelector("#resetView").addEventListener("click", () => {
  state.camera = { ...INITIAL_CAMERA };
  state.selectedId = null;
  updateScaleIndicators();
  queueRender();
});

document.querySelectorAll(".layer-row").forEach((row) => {
  row.addEventListener("click", () => {
    const layer = row.dataset.layer;
    state.layers[layer] = !state.layers[layer];
    row.classList.toggle("is-active", state.layers[layer]);
    row.classList.toggle("is-off", !state.layers[layer]);
    queueRender();
  });
});

function setProgress(progress) {
  const phaseLabels = {
    prepare: "Preparing vector tiles",
    render: "Rendering & stitching",
    encode: "Encoding lossless PNG",
    complete: "Export ready",
  };
  const percent = Math.round(progress.progress * 100);
  document.querySelector("#progressPhase").textContent = phaseLabels[progress.phase] || "Working";
  document.querySelector("#progressPercent").textContent = `${percent}%`;
  document.querySelector("#progressBar").style.width = `${percent}%`;
  document.querySelector("#progressDetail").textContent = progress.detail;
  document.querySelector("#progressTiles").textContent = `Tile ${progress.completed} / ${progress.total}`;
  document.querySelector("#progressMemory").textContent = "Working set: 1 tile";
  if (progress.phase === "render") {
    document.querySelector("#progressTitle").textContent = "Stitching high-resolution tiles";
  } else if (progress.phase === "encode") {
    document.querySelector("#progressTitle").textContent = "Writing the PNG";
  } else if (progress.phase === "complete") {
    document.querySelector("#progressTitle").textContent = "4× export complete";
  }
  window.dispatchEvent(new CustomEvent("export-progress", { detail: progress }));
}

async function pacedProgress(progress) {
  setProgress(progress);
  await new Promise((resolve) => setTimeout(resolve, progress.phase === "render" ? 34 : 8));
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function performExport({ download = true } = {}) {
  if (state.exporting) return null;
  state.exporting = true;
  exportButton.disabled = true;
  exportDone.hidden = true;
  exportOverlay.hidden = false;
  setProgress({
    phase: "prepare",
    progress: 0,
    completed: 0,
    total: 0,
    detail: "Freezing the current camera and layer state.",
  });

  try {
    const result = await exportViewportPng({
      width: state.viewport.width,
      height: state.viewport.height,
      camera: { ...state.camera },
      layers: { ...state.layers },
      selectedId: state.selectedId,
      scale: 4,
      tileSize: 1024,
      bleed: 16,
      onProgress: pacedProgress,
    });

    const filename = "harbor-district@4x.png";
    state.lastExport = { ...result, filename };
    exportOverlay.hidden = true;
    exportDone.hidden = false;
    document.querySelector("#doneMeta").textContent =
      `${result.width.toLocaleString("en-US")} × ${result.height.toLocaleString("en-US")} px · ${result.tileCount} tiles · ${(result.blob.size / 1_000_000).toFixed(1)} MB`;
    if (download) triggerDownload(result.blob, filename);

    const detail = {
      width: result.width,
      height: result.height,
      scale: result.scale,
      tileSize: result.tileSize,
      bleed: result.bleed,
      columns: result.columns,
      rows: result.rows,
      tileCount: result.tileCount,
      markers: result.markers,
      filename,
      bytes: result.blob.size,
    };
    window.__lastExport = detail;
    window.dispatchEvent(new CustomEvent("export-complete", { detail }));
    return result;
  } catch (error) {
    console.error(error);
    exportOverlay.hidden = true;
    showToast(`Export failed: ${error.message}`);
    return null;
  } finally {
    state.exporting = false;
    exportButton.disabled = false;
  }
}

exportButton.addEventListener("click", () => performExport({ download: true }));

document.querySelector("#downloadAgain").addEventListener("click", () => {
  if (state.lastExport) triggerDownload(state.lastExport.blob, state.lastExport.filename);
});

document.querySelector("#closeDone").addEventListener("click", () => {
  exportDone.hidden = true;
});

window.mapStudio = {
  getState: () => ({
    camera: { ...state.camera },
    layers: { ...state.layers },
    selectedId: state.selectedId,
    viewport: { ...state.viewport },
    exporting: state.exporting,
  }),
  getLandmarks: () => getLandmarkScreenPositions(state.viewport.width, state.viewport.height, state.camera),
  exportCurrentViewport: (options = {}) => performExport({ download: false, ...options }),
  setCamera: (patch) => {
    state.camera = clampCamera({ ...state.camera, ...patch });
    updateScaleIndicators();
    queueRender();
  },
};

new ResizeObserver(resizeViewport).observe(mapFrame);
resizeViewport();
updateScaleIndicators();
queueRender();

document.fonts.ready.then(() => {
  queueRender();
  window.__mapReady = true;
  window.dispatchEvent(new Event("map-ready"));
});
