import { OrbitCamera } from "./camera.js";
import { clamp } from "./math.js";
import { SceneRenderer } from "./renderer.js";

const elements = {
  canvas: document.querySelector("#scene"),
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  cameraAngles: document.querySelector("#cameraAngles"),
  cameraDistance: document.querySelector("#cameraDistance"),
  saveViewButton: document.querySelector("#saveViewButton"),
  savedView: document.querySelector("#savedView"),
  savedViewText: document.querySelector("#savedViewText"),
  frameReadout: document.querySelector("#frameReadout"),
  generationReadout: document.querySelector("#generationReadout"),
  resourceReadout: document.querySelector("#resourceReadout"),
  lossButton: document.querySelector("#lossButton"),
  toast: document.querySelector("#toast"),
  lostOverlay: document.querySelector("#lostOverlay"),
  lostTitle: document.querySelector("#lostTitle"),
  lostMessage: document.querySelector("#lostMessage"),
  overlayNote: document.querySelector("#overlayNote"),
  restoreButton: document.querySelector("#restoreButton"),
  restoreLabel: document.querySelector("#restoreLabel"),
  unsupported: document.querySelector("#unsupported"),
};

const camera = new OrbitCamera();
const state = {
  phase: "loading",
  frameCount: 0,
  elapsed: 0,
  lastTimestamp: null,
  animationHandle: null,
  savedView: null,
  savedAt: null,
  preLossView: null,
  recoveryView: null,
  hudUpdatedAt: 0,
  toastTimer: null,
  pointer: null,
  lastFrameSample: null,
};

const renderer = new SceneRenderer(elements.canvas, camera, {
  onContextLost: handleContextLost,
  onContextRestored: handleContextRestored,
  onContextRestoreFailed: handleRestoreFailed,
});

function setStatus(phase, label) {
  state.phase = phase;
  elements.statusPill.dataset.state = phase;
  elements.statusText.textContent = label;
}

function formatDegrees(radians) {
  return `${((radians * 180) / Math.PI).toFixed(1)}°`;
}

function updateCameraReadout() {
  elements.cameraAngles.textContent =
    `${formatDegrees(camera.yaw)} / ${formatDegrees(camera.pitch)}`;
  elements.cameraDistance.textContent = `${camera.distance.toFixed(2)} m`;
}

function updateTelemetry() {
  const resources = renderer.resourceSummary();
  const resourceCount =
    resources.programs +
    resources.buffers +
    resources.vertexArrays +
    resources.textures;
  elements.frameReadout.textContent = String(state.frameCount).padStart(6, "0");
  elements.generationReadout.textContent = String(
    Math.max(renderer.generation, 0),
  ).padStart(2, "0");
  elements.resourceReadout.textContent = String(resourceCount);
}

function updateInteractiveControls() {
  const running = state.phase === "running";
  elements.saveViewButton.disabled = !running;
  elements.lossButton.disabled = !running;
}

function updateHud(force = false) {
  updateCameraReadout();
  updateTelemetry();
  if (!force && performance.now() - state.hudUpdatedAt < 100) {
    return;
  }
  state.hudUpdatedAt = performance.now();
  updateInteractiveControls();
}

function showToast(message, duration = 2800) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

function stopRenderLoop() {
  if (state.animationHandle !== null) {
    cancelAnimationFrame(state.animationHandle);
    state.animationHandle = null;
  }
  state.lastTimestamp = null;
}

function renderLoop(timestamp) {
  state.animationHandle = null;
  if (state.phase !== "running") {
    return;
  }

  if (state.lastTimestamp === null) {
    state.lastTimestamp = timestamp;
  }
  const deltaSeconds = clamp((timestamp - state.lastTimestamp) / 1000, 0, 0.05);
  state.lastTimestamp = timestamp;
  state.elapsed += deltaSeconds;

  if (!renderer.render(state.elapsed)) {
    return;
  }

  state.frameCount += 1;
  updateHud();
  state.animationHandle = requestAnimationFrame(renderLoop);
}

function startRenderLoop() {
  if (state.animationHandle !== null || state.phase !== "running") {
    return;
  }
  state.lastTimestamp = null;
  state.animationHandle = requestAnimationFrame(renderLoop);
}

function saveCurrentView() {
  if (state.phase !== "running") {
    return;
  }
  state.savedView = camera.snapshot();
  state.savedAt = new Date();
  elements.savedView.hidden = false;
  elements.savedViewText.textContent =
    `已保存 ${formatDegrees(state.savedView.yaw)} / ` +
    `${formatDegrees(state.savedView.pitch)} · ${state.savedAt.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  showToast("视角快照已保存 · 恢复后将自动还原");
}

function enterLostState(source) {
  stopRenderLoop();
  state.pointer = null;
  elements.canvas.classList.remove("is-dragging");
  state.preLossView ??= camera.snapshot();
  state.recoveryView = state.savedView ?? state.preLossView;
  setStatus("lost", "上下文已丢失");
  updateInteractiveControls();

  elements.lostTitle.textContent = "WebGL2 渲染上下文已丢失";
  elements.lostMessage.textContent =
    "渲染循环已停止。相机、视角快照与场景状态仍保留在内存中，等待重建 GPU 资源。";
  elements.overlayNote.textContent =
    source === "manual"
      ? "已模拟一次上下文丢失。恢复后将重新创建纹理、着色器程序、缓冲与 VAO，并还原已保存视角。"
      : "检测到外部上下文丢失。恢复后将重新创建纹理、着色器程序、缓冲与 VAO。";
  elements.restoreButton.disabled = false;
  elements.restoreLabel.textContent = "恢复渲染上下文";
  elements.lostOverlay.hidden = false;
  updateHud(true);
}

function handleContextLost() {
  if (state.phase === "running") {
    state.preLossView = camera.snapshot();
    enterLostState("external");
  }
}

function handleContextRestored({ generation, resources }) {
  try {
    state.recoveryView ??= state.preLossView ?? camera.snapshot();
    camera.restore(state.recoveryView);
    updateCameraReadout();

    const rendered = renderer.render(state.elapsed);
    if (!rendered) {
      throw new Error("资源重建后首帧未能绘制");
    }
    state.lastFrameSample = renderer.sampleFrame();

    state.frameCount += 1;
    elements.lostOverlay.hidden = true;
    setStatus("running", "渲染已恢复");
    updateHud(true);
    startRenderLoop();

    const resourceCount =
      resources.programs +
      resources.buffers +
      resources.vertexArrays +
      resources.textures;
    showToast(
      `上下文已恢复 · 第 ${generation} 代 · ${resourceCount} 个 GPU 对象 · 视角已还原`,
      4200,
    );
  } catch (error) {
    handleRestoreFailed(error);
  }
}

function handleRestoreFailed(error) {
  stopRenderLoop();
  setStatus("failed", "恢复失败");
  elements.lostTitle.textContent = "GPU 资源重建失败";
  elements.lostMessage.textContent =
    error instanceof Error ? error.message : String(error);
  elements.overlayNote.textContent =
    "渲染保持停止，页面没有使用丢失前的失效对象。可以再次尝试恢复。";
  elements.restoreButton.disabled = false;
  elements.lostOverlay.hidden = false;
  updateHud(true);
  console.error("WebGL2 restore failed", error);
}

function simulateContextLoss() {
  if (state.phase !== "running") {
    return false;
  }

  state.preLossView = camera.snapshot();
  state.recoveryView = state.savedView ?? state.preLossView;
  enterLostState("manual");

  try {
    const started = renderer.simulateLoss();
    if (!started) {
      throw new Error("渲染上下文当前不处于可丢失状态");
    }
    return true;
  } catch (error) {
    elements.lostOverlay.hidden = true;
    setStatus("running", "渲染运行中");
    updateHud(true);
    startRenderLoop();
    showToast(`无法模拟上下文丢失：${error.message}`, 4200);
    console.error(error);
    return false;
  }
}

function restoreContext() {
  if (state.phase !== "lost" && state.phase !== "failed") {
    return false;
  }

  setStatus("restoring", "正在重建 GPU 资源");
  elements.restoreButton.disabled = true;
  elements.restoreLabel.textContent = "正在重建…";
  elements.lostTitle.textContent = "正在重建渲染管线";
  elements.lostMessage.textContent =
    "正在创建新一代着色器程序、网格缓冲、VAO 与纹理，并从视角快照恢复相机状态。";
  elements.overlayNote.textContent =
    "此过程不会引用丢失前的 GPU 对象；所有资源均重新上传。";

  try {
    const requested = renderer.requestRestore();
    if (!requested) {
      throw new Error("当前上下文没有等待恢复");
    }
    return true;
  } catch (error) {
    handleRestoreFailed(error);
    return false;
  }
}

function handlePointerDown(event) {
  if (state.phase !== "running" || event.button !== 0) {
    return;
  }
  state.pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
  elements.canvas.classList.add("is-dragging");
  elements.canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handlePointerMove(event) {
  if (
    state.phase !== "running" ||
    !state.pointer ||
    state.pointer.id !== event.pointerId
  ) {
    return;
  }
  const deltaX = event.clientX - state.pointer.x;
  const deltaY = event.clientY - state.pointer.y;
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  camera.rotate(deltaX, deltaY);
  updateCameraReadout();
  event.preventDefault();
}

function handlePointerUp(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) {
    return;
  }
  state.pointer = null;
  elements.canvas.classList.remove("is-dragging");
  if (elements.canvas.hasPointerCapture?.(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
}

function handleWheel(event) {
  if (state.phase !== "running") {
    return;
  }
  event.preventDefault();
  camera.zoom(event.deltaY);
  updateCameraReadout();
}

elements.saveViewButton.addEventListener("click", saveCurrentView);
elements.lossButton.addEventListener("click", simulateContextLoss);
elements.restoreButton.addEventListener("click", restoreContext);
elements.canvas.addEventListener("pointerdown", handlePointerDown);
elements.canvas.addEventListener("pointermove", handlePointerMove);
elements.canvas.addEventListener("pointerup", handlePointerUp);
elements.canvas.addEventListener("pointercancel", handlePointerUp);
elements.canvas.addEventListener("wheel", handleWheel, { passive: false });

function showUnsupported(message) {
  setStatus("unsupported", "WebGL2 不可用");
  elements.unsupported.hidden = false;
  elements.unsupported.querySelector("span").textContent = message;
  elements.saveViewButton.disabled = true;
  elements.lossButton.disabled = true;
}

function showFatal(error) {
  stopRenderLoop();
  setStatus("failed", "场景初始化失败");
  elements.lostTitle.textContent = "场景初始化失败";
  elements.lostMessage.textContent =
    error instanceof Error ? error.message : String(error);
  elements.overlayNote.textContent = "请检查 WebGL2 支持后刷新页面。";
  elements.restoreButton.disabled = true;
  elements.lostOverlay.hidden = false;
  updateHud(true);
  console.error(error);
}

function diagnostics() {
  return {
    phase: state.phase,
    frameCount: state.frameCount,
    renderCalls: renderer.renderCalls,
    generation: renderer.generation,
    loopActive: state.animationHandle !== null,
    contextLost: renderer.contextLost,
    webglContextLost: renderer.gl?.isContextLost() ?? true,
    resources: renderer.resourceSummary(),
    camera: camera.snapshot(),
    savedView: state.savedView ? { ...state.savedView } : null,
    preLossView: state.preLossView ? { ...state.preLossView } : null,
    recoveryView: state.recoveryView ? { ...state.recoveryView } : null,
    lastFrameSample: state.lastFrameSample,
    elapsed: state.elapsed,
  };
}

window.__orbital = {
  diagnostics,
  saveView: saveCurrentView,
  simulateLoss: simulateContextLoss,
  restoreContext,
};

try {
  renderer.initialize();
  setStatus("running", "渲染运行中");
  if (!renderer.render(0)) {
    throw new Error("首帧渲染失败");
  }
  state.lastFrameSample = renderer.sampleFrame();
  state.frameCount = 1;
  updateHud(true);
  startRenderLoop();
} catch (error) {
  if (error instanceof Error && error.message.includes("WebGL2")) {
    showUnsupported(error.message);
  } else {
    showFatal(error);
  }
}
