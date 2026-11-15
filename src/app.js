import {
  WORLD,
  normalizeAngle,
  toDegrees,
} from "./geometry.js";
import {
  createInitialState,
  findLight,
  findObject,
  shapeGlyph,
} from "./scene.js";
import { ShadowRenderer, renderExportCanvas } from "./renderer.js";
import {
  probeBeamBoundary,
  probeOutOfRange,
  runDiagnostics,
  verifyDualLightBoundaries,
} from "./diagnostics.js";

const state = createInitialState();
const canvas = document.querySelector("#scene");
const canvasShell = document.querySelector("#canvasShell");
const renderer = new ShadowRenderer(canvas);
const lightList = document.querySelector("#lightList");
const objectList = document.querySelector("#objectList");
const lightCount = document.querySelector("#lightCount");
const liveStatus = document.querySelector("#liveStatus");
const selectedLightLabel = document.querySelector("#selectedLightLabel");
const angleControl = document.querySelector("#angleControl");
const spreadControl = document.querySelector("#spreadControl");
const rangeControl = document.querySelector("#rangeControl");
const heightControl = document.querySelector("#heightControl");
const angleOutput = document.querySelector("#angleOutput");
const spreadOutput = document.querySelector("#spreadOutput");
const rangeOutput = document.querySelector("#rangeOutput");
const heightOutput = document.querySelector("#heightOutput");
const toggleSelectedLight = document.querySelector("#toggleSelectedLight");
const checkList = document.querySelector("#checkList");
const runChecksButton = document.querySelector("#runChecksButton");
const canvasHint = document.querySelector("#canvasHint");
const toast = document.querySelector("#toast");

let drag = null;
let hintDismissed = false;
let toastTimer = 0;
let checksDirty = true;

function selectedLight() {
  return findLight(state, state.selectedLightId) ?? state.lights[0];
}

function selectedObject() {
  return findObject(state, state.selectedObjectId) ?? state.objects[0];
}

function renderLightCards() {
  lightList.innerHTML = state.lights.map((light) => `
    <div
      class="light-card${light.id === state.selectedLightId ? " is-selected" : ""}${light.enabled ? "" : " is-off"}"
      role="button"
      tabindex="0"
      data-light-id="${light.id}"
      aria-label="Select ${light.name}"
      aria-pressed="${light.id === state.selectedLightId}"
      style="--light-color: ${light.color}"
    >
      <span class="light-swatch" aria-hidden="true"></span>
      <span class="light-copy">
        <span class="light-name-row">
          <span class="light-letter">${light.label}</span>
          <span class="light-name">${light.name}</span>
        </span>
        <span class="light-meta" data-light-meta="${light.id}">
          ${Math.round(light.angle)}° · ${light.range} px ${light.enabled ? "" : "· OFF"}
        </span>
      </span>
      <button
        class="light-switch"
        type="button"
        role="switch"
        aria-checked="${light.enabled}"
        aria-label="${light.enabled ? "Turn off" : "Turn on"} ${light.name}"
        data-toggle-light="${light.id}"
      ></button>
    </div>
  `).join("");
}

function renderObjectCards() {
  objectList.innerHTML = state.objects.map((object) => `
    <button
      class="object-card${object.id === state.selectedObjectId ? " is-selected" : ""}"
      type="button"
      data-object-id="${object.id}"
      aria-pressed="${object.id === state.selectedObjectId}"
      style="--object-color: ${object.color}"
    >
      <span class="object-glyph" aria-hidden="true">${shapeGlyph(object)}</span>
      <span class="object-copy">
        <span class="object-name">${object.label} / ${object.name}</span>
        <span class="object-meta" data-object-meta="${object.id}">
          ${object.kind} · h ${object.height.toFixed(2)}
        </span>
      </span>
      <span class="object-coord" data-object-coord="${object.id}">
        ${Math.round(object.x)},${Math.round(object.y)}
      </span>
    </button>
  `).join("");
}

function setRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function syncControls() {
  const light = selectedLight();
  const object = selectedObject();
  selectedLightLabel.textContent = `${light.shortName} / ${light.label}`;
  angleControl.value = String(Math.round(light.angle) % 360);
  spreadControl.value = String(light.spread);
  rangeControl.value = String(light.range);
  heightControl.value = String(object.height);
  angleOutput.textContent = `${Math.round(light.angle)}°`;
  spreadOutput.textContent = `${light.spread}°`;
  rangeOutput.textContent = `${light.range} px`;
  heightOutput.textContent = object.height.toFixed(2);
  toggleSelectedLight.textContent = light.enabled ? "Turn off" : "Turn on";
  toggleSelectedLight.setAttribute("aria-pressed", String(!light.enabled));
  [angleControl, spreadControl, rangeControl, heightControl].forEach(setRangeFill);
}

function updateLiveStatus() {
  const active = state.lights.filter((light) => light.enabled).length;
  const shadowCount = state.objects.length;
  liveStatus.textContent = active === 0
    ? "No light · shadows paused"
    : `${active} / 3 lights active · ${shadowCount} shapes`;
  lightCount.textContent = `${String(active).padStart(2, "0")} / 03`;
}

function updateDynamicLabels() {
  for (const light of state.lights) {
    const element = document.querySelector(`[data-light-meta="${light.id}"]`);
    if (element) {
      element.textContent = `${Math.round(light.angle)}° · ${light.range} px ${light.enabled ? "" : "· OFF"}`;
    }
  }
  for (const object of state.objects) {
    const meta = document.querySelector(`[data-object-meta="${object.id}"]`);
    const coordinate = document.querySelector(`[data-object-coord="${object.id}"]`);
    if (meta) meta.textContent = `${object.kind} · h ${object.height.toFixed(2)}`;
    if (coordinate) {
      coordinate.textContent = `${Math.round(object.x)},${Math.round(object.y)}`;
    }
  }
}

function renderSidebar() {
  renderLightCards();
  renderObjectCards();
  syncControls();
  updateLiveStatus();
}

function render() {
  renderer.render(state);
}

function hideHint() {
  if (hintDismissed) return;
  hintDismissed = true;
  canvasHint.classList.add("is-hidden");
}

function showToast(message, duration = 2400) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, duration);
}

function markChecksStale() {
  checksDirty = true;
  for (const item of checkList.querySelectorAll("li")) {
    item.classList.remove("is-pass", "is-fail");
    const detail = item.querySelector("small");
    if (detail && !detail.textContent.includes("Scene changed")) {
      detail.textContent = "Scene changed · run audit";
    }
  }
}

function selectLight(id) {
  if (!findLight(state, id)) return;
  state.selectedLightId = id;
  renderSidebar();
  render();
}

function selectObject(id) {
  if (!findObject(state, id)) return;
  state.selectedObjectId = id;
  renderObjectCards();
  syncControls();
  render();
}

function setLightEnabled(id, enabled) {
  const light = findLight(state, id);
  if (!light) return;
  light.enabled = Boolean(enabled);
  state.selectedLightId = id;
  markChecksStale();
  renderSidebar();
  render();
}

function mutateSelectedLight(property, value) {
  const light = selectedLight();
  light[property] = value;
  markChecksStale();
  render();
  syncControls();
  updateLiveStatus();
  updateDynamicLabels();
}

function mutateSelectedObject(property, value) {
  const object = selectedObject();
  object[property] = value;
  markChecksStale();
  render();
  syncControls();
  updateDynamicLabels();
}

lightList.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle-light]");
  if (toggle) {
    event.stopPropagation();
    const light = findLight(state, toggle.dataset.toggleLight);
    setLightEnabled(toggle.dataset.toggleLight, !light.enabled);
    return;
  }
  const card = event.target.closest("[data-light-id]");
  if (card) selectLight(card.dataset.lightId);
});

lightList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("[data-toggle-light]")) return;
  const card = event.target.closest("[data-light-id]");
  if (!card) return;
  event.preventDefault();
  selectLight(card.dataset.lightId);
});

objectList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-object-id]");
  if (card) selectObject(card.dataset.objectId);
});

angleControl.addEventListener("input", () => {
  mutateSelectedLight("angle", normalizeAngle(Number(angleControl.value)));
});

spreadControl.addEventListener("input", () => {
  mutateSelectedLight("spread", Number(spreadControl.value));
});

rangeControl.addEventListener("input", () => {
  mutateSelectedLight("range", Number(rangeControl.value));
});

heightControl.addEventListener("input", () => {
  mutateSelectedObject("height", Number(heightControl.value));
});

document.querySelector("#nudgeLeft").addEventListener("click", () => {
  mutateSelectedLight("angle", normalizeAngle(selectedLight().angle - 5));
});

document.querySelector("#nudgeRight").addEventListener("click", () => {
  mutateSelectedLight("angle", normalizeAngle(selectedLight().angle + 5));
});

toggleSelectedLight.addEventListener("click", () => {
  const light = selectedLight();
  setLightEnabled(light.id, !light.enabled);
});

document.querySelector("#focusSceneButton").addEventListener("click", () => {
  canvas.focus({ preventScroll: true });
  showToast("Scene focused · use arrow keys to move, Shift + arrows to aim.");
});

function updatePointerCursor(event) {
  if (drag) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const hit = renderer.hitTest(point, state);
  canvas.classList.toggle("is-aiming", hit?.type === "aim");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const hit = renderer.hitTest(point, state);
  if (!hit) return;

  hideHint();
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
  canvas.classList.remove("is-aiming");

  if (hit.type === "aim") {
    const light = findLight(state, hit.lightId);
    state.selectedLightId = light.id;
    drag = { type: "aim", pointerId: event.pointerId, lightId: light.id };
    canvas.classList.add("is-aiming");
  } else if (hit.type === "light") {
    const light = findLight(state, hit.lightId);
    state.selectedLightId = light.id;
    drag = {
      type: "light",
      pointerId: event.pointerId,
      lightId: light.id,
      offsetX: light.x - point.x,
      offsetY: light.y - point.y,
    };
  } else {
    const object = findObject(state, hit.objectId);
    state.selectedObjectId = object.id;
    drag = {
      type: "object",
      pointerId: event.pointerId,
      objectId: object.id,
      offsetX: object.x - point.x,
      offsetY: object.y - point.y,
    };
  }

  renderSidebar();
  render();
});

canvas.addEventListener("pointermove", (event) => {
  updatePointerCursor(event);
  if (!drag || drag.pointerId !== event.pointerId) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);

  if (drag.type === "aim") {
    const light = findLight(state, drag.lightId);
    const angle = toDegrees(Math.atan2(point.y - light.y, point.x - light.x));
    light.angle = normalizeAngle(angle);
    markChecksStale();
    syncControls();
    updateDynamicLabels();
  } else if (drag.type === "light") {
    const light = findLight(state, drag.lightId);
    light.x = Math.min(WORLD.width - 30, Math.max(30, point.x + drag.offsetX));
    light.y = Math.min(WORLD.height - 30, Math.max(30, point.y + drag.offsetY));
    markChecksStale();
    updateDynamicLabels();
  } else if (drag.type === "object") {
    const object = findObject(state, drag.objectId);
    object.x = Math.min(WORLD.width - 48, Math.max(48, point.x + drag.offsetX));
    object.y = Math.min(WORLD.height - 48, Math.max(48, point.y + drag.offsetY));
    markChecksStale();
    updateDynamicLabels();
  }
  render();
});

function finishDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  drag = null;
  canvas.classList.remove("is-dragging", "is-aiming");
  updatePointerCursor(event);
}

canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);
canvas.addEventListener("pointerleave", (event) => {
  if (!drag) canvas.classList.remove("is-aiming");
  updatePointerCursor(event);
});

canvas.addEventListener("keydown", (event) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const light = selectedLight();
  const step = event.altKey ? 2 : 8;

  if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    light.angle = normalizeAngle(light.angle + (event.key === "ArrowRight" ? 5 : -5));
  } else if (event.altKey) {
    const object = selectedObject();
    object.x += event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    object.y += event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
  } else {
    light.x += event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    light.y += event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    light.x = Math.min(WORLD.width - 30, Math.max(30, light.x));
    light.y = Math.min(WORLD.height - 30, Math.max(30, light.y));
  }
  markChecksStale();
  updateDynamicLabels();
  syncControls();
  render();
  hideHint();
});

function applyCheckResult(key, result) {
  const item = checkList.querySelector(`[data-check="${key}"]`);
  if (!item) return;
  item.classList.toggle("is-pass", Boolean(result.pass));
  item.classList.toggle("is-fail", !result.pass);
  item.querySelector("small").textContent = result.detail;
}

let auditTimer = 0;

function runAudit({ announce = true } = {}) {
  window.clearTimeout(auditTimer);
  runChecksButton.classList.add("is-running");
  runChecksButton.disabled = true;
  runChecksButton.setAttribute("aria-busy", "true");

  return new Promise((resolve) => {
    auditTimer = window.setTimeout(() => {
      const result = runDiagnostics(state);
      checksDirty = false;
      applyCheckResult("dual", result.dual);
      applyCheckResult("range", result.range);
      runChecksButton.classList.remove("is-running");
      runChecksButton.disabled = false;
      runChecksButton.setAttribute("aria-busy", "false");

      if (announce) {
        const passed = Number(result.dual.pass) + Number(result.range.pass);
        showToast(
          passed === 2
            ? "Audit complete · dual-light contours and range culling verified."
            : "Audit finished with an unresolved boundary condition.",
          passed === 2 ? 2600 : 3600,
        );
      }
      resolve(result);
    }, 140);
  });
}

runChecksButton.addEventListener("click", () => {
  runAudit();
});

async function exportPng() {
  const exportButton = document.querySelector("#exportButton");
  exportButton.disabled = true;
  try {
    const exportCanvas = renderExportCanvas(state);
    const blob = await new Promise((resolve, reject) => {
      exportCanvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("PNG encoding failed"));
      }, "image/png");
    });
    const date = new Date();
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `umbra-shadow-field-${stamp}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("PNG exported · 2000 × 1400 vector composite.");
  } catch (error) {
    console.error(error);
    showToast("PNG export failed. The scene is still available on screen.");
  } finally {
    exportButton.disabled = false;
  }
}

document.querySelector("#exportButton").addEventListener("click", exportPng);

document.querySelector("#resetButton").addEventListener("click", () => {
  const initial = createInitialState();
  state.lights = initial.lights;
  state.objects = initial.objects;
  state.selectedLightId = initial.selectedLightId;
  state.selectedObjectId = initial.selectedObjectId;
  hintDismissed = false;
  canvasHint.classList.remove("is-hidden");
  markChecksStale();
  renderSidebar();
  render();
  showToast("Composition reset.");
  runAudit({ announce: false });
});

const resizeObserver = new ResizeObserver(() => {
  renderer.resize();
  render();
});
resizeObserver.observe(canvasShell);

window.addEventListener("resize", () => {
  renderer.resize();
  render();
});

function clonePublicState() {
  return structuredClone(state);
}

function applyLightPatch(id, patch) {
  const light = findLight(state, id);
  if (!light) throw new Error(`Unknown light: ${id}`);
  const numericKeys = ["x", "y", "angle", "spread", "range", "height", "intensity"];
  for (const key of numericKeys) {
    if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) {
      light[key] = Number(patch[key]);
    }
  }
  if (patch.enabled !== undefined) light.enabled = Boolean(patch.enabled);
  if (patch.color) light.color = String(patch.color);
  light.angle = normalizeAngle(light.angle);
  light.spread = Math.min(70, Math.max(16, light.spread));
  light.range = Math.min(680, Math.max(220, light.range));
  state.selectedLightId = id;
  markChecksStale();
  renderSidebar();
  render();
  return { ...light };
}

function applyObjectPatch(id, patch) {
  const object = findObject(state, id);
  if (!object) throw new Error(`Unknown object: ${id}`);
  for (const key of ["x", "y", "rotation", "height", "scale"]) {
    if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) {
      object[key] = Number(patch[key]);
    }
  }
  state.selectedObjectId = id;
  markChecksStale();
  renderObjectCards();
  syncControls();
  render();
  return { ...object };
}

function shadowSummary() {
  return state.lights.map((light) => ({
    id: light.id,
    enabled: light.enabled,
    objects: state.objects.map((object) => ({
      id: object.id,
      ...probeBeamBoundary(light, object),
    })),
  }));
}

window.__shadowLab = {
  world: { ...WORLD },
  getState: clonePublicState,
  setLight: applyLightPatch,
  setObject: applyObjectPatch,
  setSelectedLight(id) {
    selectLight(id);
  },
  setSelectedObject(id) {
    selectObject(id);
  },
  setLightEnabled(id, enabled) {
    setLightEnabled(id, enabled);
  },
  runDiagnostics() {
    return runDiagnostics(state);
  },
  runChecks(options) {
    return runAudit(options);
  },
  verifyDualLights() {
    return verifyDualLightBoundaries(state);
  },
  checkOutOfRange() {
    return probeOutOfRange(state);
  },
  getShadowSummary: shadowSummary,
  screenToWorld(clientX, clientY) {
    return renderer.screenToWorld(clientX, clientY);
  },
  worldToScreen(x, y) {
    const rect = canvas.getBoundingClientRect();
    const point = renderer.worldToScreen([x, y]);
    return { x: rect.left + point.x, y: rect.top + point.y };
  },
  exportDataURL() {
    return renderExportCanvas(state).toDataURL("image/png");
  },
  exportPng,
};

renderSidebar();
render();
requestAnimationFrame(() => {
  renderer.resize();
  render();
  runAudit({ announce: false });
});
