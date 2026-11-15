import {
  clientToCanvasPoint,
  getViewportMetrics,
  syncCanvasBackingStore,
} from "./coords.js";
import { renderCanvas } from "./render.js";

const app = document.querySelector("#app");
const stage = document.querySelector("#stage");
const canvas = document.querySelector("#canvas");
const context = canvas.getContext("2d", { alpha: false });
const fullscreenBtn = document.querySelector("#fullscreenBtn");
const fullscreenLabel = document.querySelector("#fullscreenLabel");
const clearBtn = document.querySelector("#clearBtn");
const toast = document.querySelector("#toast");

const ui = {
  topDpr: document.querySelector("#topDpr"),
  syncBadge: document.querySelector("#syncBadge"),
  syncMessage: document.querySelector("#syncMessage"),
  pointerX: document.querySelector("#pointerX"),
  pointerY: document.querySelector("#pointerY"),
  screenPoint: document.querySelector("#screenPoint"),
  metricDpr: document.querySelector("#metricDpr"),
  metricCss: document.querySelector("#metricCss"),
  metricBacking: document.querySelector("#metricBacking"),
  metricSpace: document.querySelector("#metricSpace"),
  scaleLabel: document.querySelector("#scaleLabel"),
  pinCount: document.querySelector("#pinCount"),
};

const state = {
  viewport: null,
  pointer: null,
  lastClient: null,
  pins: [],
  pinSequence: 0,
  lastClickAt: 0,
};

let activeDprQuery = null;
let activeDprHandler = null;
let toastTimer = 0;
let statusTimer = 0;
let hasRendered = false;

function formatDimension(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function updatePointerUi() {
  const pointer = state.pointer;

  if (!pointer) {
    ui.pointerX.textContent = "—";
    ui.pointerY.textContent = "—";
    ui.screenPoint.textContent = "— / —";
    delete canvas.dataset.pointerX;
    delete canvas.dataset.pointerY;
    return;
  }

  ui.pointerX.textContent = pointer.x.toFixed(1);
  ui.pointerY.textContent = pointer.y.toFixed(1);
  ui.screenPoint.textContent = `${pointer.clientX.toFixed(1)} / ${pointer.clientY.toFixed(1)}`;
  canvas.dataset.pointerX = pointer.x.toFixed(3);
  canvas.dataset.pointerY = pointer.y.toFixed(3);
}

function updateViewportUi(previousViewport, reason) {
  const viewport = state.viewport;
  const dprChanged = !previousViewport
    || Math.abs(previousViewport.dpr - viewport.dpr) > 1e-9;
  const sizeChanged = !previousViewport
    || Math.abs(previousViewport.cssWidth - viewport.cssWidth) > 0.01
    || Math.abs(previousViewport.cssHeight - viewport.cssHeight) > 0.01;

  ui.topDpr.textContent = `DPR ${viewport.dpr.toFixed(2)}`;
  ui.metricDpr.textContent = `${viewport.dpr.toFixed(2)}×`;
  ui.metricCss.textContent = `${formatDimension(viewport.cssWidth)} × ${formatDimension(viewport.cssHeight)}`;
  ui.metricBacking.textContent = `${viewport.backingWidth} × ${viewport.backingHeight} px`;
  ui.metricSpace.textContent = "CSS logical";
  ui.scaleLabel.textContent = `1 CSS = ${viewport.dpr.toFixed(2)} DEVICE PX`;

  canvas.dataset.dpr = String(viewport.dpr);
  canvas.dataset.cssWidth = String(viewport.cssWidth);
  canvas.dataset.cssHeight = String(viewport.cssHeight);
  canvas.dataset.backingWidth = String(viewport.backingWidth);
  canvas.dataset.backingHeight = String(viewport.backingHeight);
  stage.dataset.dpr = String(viewport.dpr);

  if (!previousViewport) {
    ui.syncMessage.textContent = "Coordinates and DPR synchronized";
    return;
  }

  if (dprChanged) {
    showSyncEvent(
      `DPR changed to ${viewport.dpr.toFixed(2)} · backing store rebuilt`,
      reason,
    );
  } else if (sizeChanged) {
    showSyncEvent(
      `Viewport resized to ${formatDimension(viewport.cssWidth)} × ${formatDimension(viewport.cssHeight)}`,
      reason,
    );
  }
}

function showSyncEvent(message, reason) {
  window.clearTimeout(statusTimer);
  ui.syncBadge.textContent = "RESYNCED";
  ui.syncBadge.classList.add("is-warning");
  ui.syncMessage.textContent = `${message}${reason ? ` · ${reason}` : ""}`;

  statusTimer = window.setTimeout(() => {
    ui.syncBadge.textContent = "LOCKED";
    ui.syncBadge.classList.remove("is-warning");
    ui.syncMessage.textContent = "Coordinates and DPR synchronized";
  }, 1800);
}

function recomputePointerFromClient() {
  if (!state.lastClient || !state.viewport) {
    return;
  }

  const point = clientToCanvasPoint(
    state.lastClient.clientX,
    state.lastClient.clientY,
    state.viewport,
  );
  const updatedAt = state.pointer?.updatedAt ?? performance.now();
  state.pointer = {
    ...point,
    clientX: state.lastClient.clientX,
    clientY: state.lastClient.clientY,
    updatedAt,
  };
}

function syncViewport(reason = "viewport") {
  const rect = canvas.getBoundingClientRect();
  const metrics = getViewportMetrics(rect, window.devicePixelRatio);
  const previous = state.viewport;
  const backingChanged = syncCanvasBackingStore(canvas, metrics);

  state.viewport = metrics;
  recomputePointerFromClient();
  updatePointerUi();
  updateViewportUi(previous, reason);

  if (backingChanged) {
    canvas.dataset.backingSync = String(performance.now().toFixed(1));
  }

  return {
    backingChanged,
    dprChanged: !previous || Math.abs(previous.dpr - metrics.dpr) > 1e-9,
    sizeChanged: !previous
      || Math.abs(previous.cssWidth - metrics.cssWidth) > 0.01
      || Math.abs(previous.cssHeight - metrics.cssHeight) > 0.01,
  };
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1500);
}

function trackPointer(event) {
  const currentDpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  if (
    !state.viewport
    || Math.abs(currentDpr - state.viewport.dpr) > 1e-9
    || Math.abs(rect.width - state.viewport.cssWidth) > 0.01
    || Math.abs(rect.height - state.viewport.cssHeight) > 0.01
    || Math.abs(rect.left - state.viewport.left) > 0.01
    || Math.abs(rect.top - state.viewport.top) > 0.01
    || canvas.width !== Math.round(rect.width * currentDpr)
    || canvas.height !== Math.round(rect.height * currentDpr)
  ) {
    syncViewport("pointer input");
  }

  const point = clientToCanvasPoint(
    event.clientX,
    event.clientY,
    state.viewport,
  );

  state.lastClient = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  state.pointer = {
    ...point,
    clientX: event.clientX,
    clientY: event.clientY,
    updatedAt: performance.now(),
  };
  updatePointerUi();
  return point;
}

function addPin(event) {
  if (!state.viewport) {
    return;
  }

  const point = trackPointer(event);
  const number = state.pinSequence + 1;
  state.pinSequence = number;
  state.pins.push({
    number,
    u: Math.min(1, Math.max(0, point.x / state.viewport.renderWidth)),
    v: Math.min(1, Math.max(0, point.y / state.viewport.renderHeight)),
    createdAt: performance.now(),
  });
  state.lastClickAt = performance.now();

  ui.pinCount.textContent = String(state.pins.length);
  canvas.dataset.lastClickX = point.x.toFixed(3);
  canvas.dataset.lastClickY = point.y.toFixed(3);
  canvas.dataset.lastClickClientX = event.clientX.toFixed(3);
  canvas.dataset.lastClickClientY = event.clientY.toFixed(3);
  showToast(
    `P${String(number).padStart(2, "0")} pinned · X ${point.x.toFixed(1)} / Y ${point.y.toFixed(1)}`,
  );
}

function clearPins() {
  if (state.pins.length === 0) {
    showToast("No pinned coordinates");
    return;
  }

  state.pins = [];
  state.pinSequence = 0;
  ui.pinCount.textContent = "0";
  delete canvas.dataset.lastClickX;
  delete canvas.dataset.lastClickY;
  delete canvas.dataset.lastClickClientX;
  delete canvas.dataset.lastClickClientY;
  showToast("All pins cleared");
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await app.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    showToast("Fullscreen is unavailable");
  }
}

function updateFullscreenUi() {
  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenLabel.textContent = isFullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN";
  fullscreenBtn.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen" : "Enter fullscreen verification",
  );
  syncAfterLayout("fullscreen transition");
}

function syncAfterLayout(reason) {
  requestAnimationFrame(() => {
    syncViewport(reason);
    requestAnimationFrame(() => syncViewport(`${reason} settle`));
  });
}

function bindDprWatcher() {
  if (activeDprQuery && activeDprHandler) {
    activeDprQuery.removeEventListener("change", activeDprHandler);
  }

  const dpr = window.devicePixelRatio || 1;
  activeDprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
  activeDprHandler = () => {
    syncViewport("DPR media change");
    bindDprWatcher();
  };
  activeDprQuery.addEventListener("change", activeDprHandler);
}

function renderFrame(now) {
  const currentDpr = window.devicePixelRatio || 1;

  if (state.viewport && Math.abs(currentDpr - state.viewport.dpr) > 1e-9) {
    syncViewport("DPR runtime check");
    bindDprWatcher();
  }

  if (state.viewport) {
    renderCanvas(context, state.viewport, state, now);
    if (!hasRendered) {
      stage.dataset.ready = "true";
      hasRendered = true;
    }
  }

  requestAnimationFrame(renderFrame);
}

canvas.addEventListener("pointermove", (event) => {
  trackPointer(event);
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  event.preventDefault();
  addPin(event);
});

canvas.addEventListener("pointerleave", () => {
  if (state.pins.length > 0 && state.pointer) {
    canvas.dataset.lastPointerX = state.pointer.x.toFixed(3);
    canvas.dataset.lastPointerY = state.pointer.y.toFixed(3);
  }
  state.pointer = null;
  state.lastClient = null;
  updatePointerUi();
});

canvas.addEventListener("pointercancel", () => {
  state.pointer = null;
  state.lastClient = null;
  updatePointerUi();
});

fullscreenBtn.addEventListener("click", toggleFullscreen);
clearBtn.addEventListener("click", clearPins);

document.addEventListener("fullscreenchange", updateFullscreenUi);
document.addEventListener("webkitfullscreenchange", updateFullscreenUi);

window.addEventListener("resize", () => syncViewport("window resize"));
window.addEventListener("orientationchange", () => {
  window.setTimeout(() => syncViewport("orientation change"), 80);
});
window.addEventListener("pageshow", () => syncAfterLayout("page restore"));
window.addEventListener("blur", () => bindDprWatcher());

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    syncViewport("visual viewport resize");
  });
  window.visualViewport.addEventListener("scroll", () => {
    syncViewport("visual viewport scroll");
  });
}

if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(() => {
    syncViewport("resize observer");
  });
  resizeObserver.observe(stage);
  resizeObserver.observe(canvas);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    syncAfterLayout("visibility restore");
    bindDprWatcher();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey) {
    toggleFullscreen();
  }
});

window.__pixelLock = {
  getState: () => ({
    viewport: { ...state.viewport },
    pointer: state.pointer ? { ...state.pointer } : null,
    pins: state.pins.map((pin) => ({ ...pin })),
  }),
  clientToCanvasPoint: (clientX, clientY) => (
    clientToCanvasPoint(clientX, clientY, state.viewport)
  ),
  sync: () => syncViewport("manual sync"),
};

syncViewport("initial");
bindDprWatcher();
requestAnimationFrame(renderFrame);
