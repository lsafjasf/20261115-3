import {
  DEFAULT_PARAMS,
  normalizeParams,
  calculateRoomMetrics,
  getEarlyReflectionPaths,
  buildComparison,
  makeDrySignal,
  convolveStereo,
  measureBinaural,
  encodeStereoWav,
  roomSignature,
  audioSignature,
} from "./acoustics.js";
import {
  drawRoomScene,
  layoutRoom,
  drawImpulseResponse,
  drawBinaural,
  drawMiniResponse,
  drawPlaceholder,
} from "./visuals.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const ui = {
  engineBadge: $("engineBadge"),
  engineText: $("engineText"),
  playButton: $("playButton"),
  playButtonText: $("playButtonText"),
  exportButton: $("exportButton"),
  roomModeTag: $("roomModeTag"),
  roomWidth: $("roomWidth"),
  roomWidthValue: $("roomWidthValue"),
  roomDepth: $("roomDepth"),
  roomDepthValue: $("roomDepthValue"),
  roomHeight: $("roomHeight"),
  roomHeightValue: $("roomHeightValue"),
  absorption: $("absorption"),
  absorptionValue: $("absorptionValue"),
  absorptionClass: $("absorptionClass"),
  openingWall: $("openingWall"),
  openingWidth: $("openingWidth"),
  openingWidthValue: $("openingWidthValue"),
  openingOffset: $("openingOffset"),
  openingOffsetValue: $("openingOffsetValue"),
  openModeButton: $("openModeButton"),
  closedModeButton: $("closedModeButton"),
  sourceHeight: $("sourceHeight"),
  sourceHeightValue: $("sourceHeightValue"),
  listenerHeight: $("listenerHeight"),
  listenerHeightValue: $("listenerHeightValue"),
  headAngle: $("headAngle"),
  headAngleValue: $("headAngleValue"),
  sourceKind: $("sourceKind"),
  roomCanvas: $("roomCanvas"),
  sourceReadout: $("sourceReadout"),
  listenerReadout: $("listenerReadout"),
  facingReadout: $("facingReadout"),
  distanceMetric: $("distanceMetric"),
  schroederMetric: $("schroederMetric"),
  firstOrderMetric: $("firstOrderMetric"),
  drMetric: $("drMetric"),
  irCanvas: $("irCanvas"),
  irLengthTag: $("irLengthTag"),
  irEndLabel: $("irEndLabel"),
  compareSummary: $("compareSummary"),
  binauralCanvas: $("binauralCanvas"),
  binauralBadge: $("binauralBadge"),
  leftRms: $("leftRms"),
  rightRms: $("rightRms"),
  channelCorrelation: $("channelCorrelation"),
  itdValue: $("itdValue"),
  binauralNote: $("binauralNote"),
  signatureText: $("signatureText"),
  toast: $("toast"),
};

const sliderConfig = [
  { key: "width", input: ui.roomWidth, output: ui.roomWidthValue, suffix: " m", digits: 1 },
  { key: "depth", input: ui.roomDepth, output: ui.roomDepthValue, suffix: " m", digits: 1 },
  { key: "height", input: ui.roomHeight, output: ui.roomHeightValue, suffix: " m", digits: 1 },
  { key: "absorption", input: ui.absorption, output: ui.absorptionValue, suffix: "", digits: 2 },
  { key: "openingWidth", input: ui.openingWidth, output: ui.openingWidthValue, suffix: " m", digits: 1 },
  { key: "openingOffset", input: ui.openingOffset, output: ui.openingOffsetValue, suffix: " m", digits: 2, signed: true },
  { key: "sourceZ", input: ui.sourceHeight, output: ui.sourceHeightValue, suffix: " m", digits: 2 },
  { key: "listenerZ", input: ui.listenerHeight, output: ui.listenerHeightValue, suffix: " m", digits: 2 },
  { key: "headAngle", input: ui.headAngle, output: ui.headAngleValue, suffix: "°", digits: 0 },
];

const compareCards = {
  closed: document.querySelector('[data-mode="closed"]'),
  open: document.querySelector('[data-mode="open"]'),
};

const state = {
  params: normalizeParams(DEFAULT_PARAMS),
  paths: [],
  comparison: null,
  current: null,
  wet: null,
  alternateWet: null,
  wetMetrics: null,
  alternateWetMetrics: null,
  dry: null,
  roomView: null,
  hover: null,
  drag: null,
  generation: 0,
  regenTimer: null,
  ready: false,
  busy: false,
  audioContext: null,
  activePlayback: null,
  toastTimer: null,
};

const compass = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

function fixed(value, digits) {
  return Number(value).toFixed(digits);
}

function signed(value, digits) {
  const prefix = value >= 0 ? "+" : "−";
  return `${prefix}${Math.abs(value).toFixed(digits)}`;
}

function headingName(angle) {
  return compass[Math.round(angle / 45) % 8];
}

function setSliderProgress(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const percent = clamp(((value - min) / Math.max(1e-9, max - min)) * 100, 0, 100);
  input.style.setProperty("--range-progress", `${percent}%`);
}

function setEngine(mode, text) {
  ui.engineBadge.classList.remove("is-working", "is-dirty", "is-ready");
  ui.engineBadge.classList.add(`is-${mode}`);
  ui.engineText.textContent = text;
}

function syncControls() {
  const params = normalizeParams(state.params);
  state.params = params;

  for (const config of sliderConfig) {
    const value = params[config.key];
    config.input.value = value;
    config.output.textContent = config.signed
      ? `${signed(value, config.digits)}${config.suffix}`
      : `${fixed(value, config.digits)}${config.suffix}`;
    setSliderProgress(config.input);
  }

  const wallLength =
    params.openingWall === "east" || params.openingWall === "west"
      ? params.depth
      : params.width;
  ui.openingWidth.max = fixed(Math.max(0.6, wallLength * 0.92), 1);
  ui.openingWidth.value = params.openingWidth;
  const maxOffset = Math.max(0, (wallLength - params.openingWidth) / 2);
  ui.openingOffset.min = fixed(-maxOffset, 2);
  ui.openingOffset.max = fixed(maxOffset, 2);
  ui.openingOffset.value = params.openingOffset;
  ui.openingOffsetValue.textContent = `${signed(params.openingOffset, 2)} m`;
  setSliderProgress(ui.openingWidth);
  setSliderProgress(ui.openingOffset);

  ui.sourceHeight.max = fixed(params.height - 0.1, 2);
  ui.listenerHeight.max = fixed(params.height - 0.1, 2);
  ui.sourceHeight.value = params.sourceZ;
  ui.listenerHeight.value = params.listenerZ;
  setSliderProgress(ui.sourceHeight);
  setSliderProgress(ui.listenerHeight);

  ui.openingWall.value = params.openingWall;
  ui.sourceKind.value = params.sourceKind;
  ui.headAngleValue.textContent = `${params.headAngle}°`;
  ui.roomModeTag.textContent = params.openingEnabled ? "开放" : "封闭";
  ui.openModeButton.classList.toggle("is-active", params.openingEnabled);
  ui.closedModeButton.classList.toggle("is-active", !params.openingEnabled);
  ui.absorptionClass.textContent =
    params.absorption < 0.2 ? "强反射" : params.absorption < 0.42 ? "中频吸收" : "高吸声";

  const angleName = headingName(params.headAngle);
  ui.sourceReadout.textContent = `${fixed(params.sourceX, 1)}, ${fixed(params.sourceY, 1)}`;
  ui.listenerReadout.textContent = `${fixed(params.listenerX, 1)}, ${fixed(params.listenerY, 1)}`;
  ui.facingReadout.textContent = `${angleName} ${params.headAngle}°`;

  document.querySelectorAll("[data-alpha]").forEach((button) => {
    const active = Math.abs(Number(button.dataset.alpha) - params.absorption) < 0.015;
    button.classList.toggle("is-active", active);
  });

  refreshGeometryMetrics();
}

function refreshGeometryMetrics() {
  const paths = getEarlyReflectionPaths(state.params, 2);
  state.paths = paths;
  const metrics = calculateRoomMetrics(state.params, paths.length);
  ui.distanceMetric.innerHTML = `${fixed(metrics.directDistance, 2)} <small>m</small>`;
  ui.schroederMetric.innerHTML = `${Math.round(metrics.schroederFrequency)} <small>Hz</small>`;
  ui.firstOrderMetric.textContent = String(paths.filter((path) => path.order === 1).length).padStart(2, "0");
  if (state.ready && state.current) {
    const dr = state.current.metrics.directToReflectedDb;
    ui.drMetric.innerHTML = `${signed(dr, 1)} <small>dB</small>`;
  } else {
    ui.drMetric.innerHTML = `— <small>dB</small>`;
  }
}

function redrawRoom() {
  state.roomView = drawRoomScene(ui.roomCanvas, {
    params: state.params,
    paths: state.paths,
    hovered: state.hover,
  });
}

function applyParameterChange(message = "场景已变更") {
  state.params = normalizeParams(state.params);
  syncControls();
  redrawRoom();
  invalidateScene(message);
}

sliderConfig.forEach((config) => {
  config.input.addEventListener("input", () => {
    state.params = normalizeParams({
      ...state.params,
      [config.key]: Number(config.input.value),
    });
    applyParameterChange("参数变化，脉冲响应重新计算中");
  });
});

ui.openingWall.addEventListener("change", () => {
  state.params = normalizeParams({
    ...state.params,
    openingWall: ui.openingWall.value,
  });
  applyParameterChange("开口位置变化，脉冲响应重新计算中");
});

ui.sourceKind.addEventListener("change", () => {
  state.params = normalizeParams({
    ...state.params,
    sourceKind: ui.sourceKind.value,
  });
  applyParameterChange("试听素材变化，正在重新卷积");
});

function setRoomMode(open) {
  if (state.params.openingEnabled === open) return;
  state.params = normalizeParams({ ...state.params, openingEnabled: open });
  applyParameterChange(open ? "已切换为开放房间" : "已切换为封闭房间");
}

ui.openModeButton.addEventListener("click", () => setRoomMode(true));
ui.closedModeButton.addEventListener("click", () => setRoomMode(false));

document.querySelectorAll("[data-alpha]").forEach((button) => {
  button.addEventListener("click", () => {
    state.params = normalizeParams({
      ...state.params,
      absorption: Number(button.dataset.alpha),
    });
    applyParameterChange("吸声系数变化，脉冲响应重新计算中");
  });
});

function invalidateScene(message) {
  state.generation += 1;
  clearTimeout(state.regenTimer);
  stopPlayback();
  state.ready = false;
  state.busy = true;
  state.comparison = null;
  state.current = null;
  state.wet = null;
  state.alternateWet = null;
  state.wetMetrics = null;
  state.alternateWetMetrics = null;
  state.dry = null;
  setEngine("dirty", "响应失效 · 等待重算");
  renderPending();
  updateAudioAvailability();

  const token = state.generation;
  state.regenTimer = setTimeout(() => regenerate(token), 75);
  if (message) ui.compareSummary.textContent = message;
}

async function regenerate(token) {
  if (token !== state.generation) return;
  state.busy = true;
  setEngine("working", "生成双耳脉冲响应");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (token !== state.generation) return;

  const started = performance.now();
  try {
    const params = normalizeParams(state.params);
    const comparison = buildComparison(params);
    const dry = makeDrySignal(params.sourceKind);
    const wet = convolveStereo(dry, comparison.current);
    const alternateResult = comparison.mode === "open" ? comparison.closed : comparison.open;
    const alternateWet = convolveStereo(dry, alternateResult);
    const wetMetrics = measureBinaural(wet.left, wet.right);
    const alternateWetMetrics = measureBinaural(alternateWet.left, alternateWet.right);
    if (token !== state.generation) return;

    state.comparison = comparison;
    state.current = comparison.current;
    state.dry = dry;
    state.wet = wet;
    state.alternateWet = alternateWet;
    state.wetMetrics = wetMetrics;
    state.alternateWetMetrics = alternateWetMetrics;
    state.ready = true;
    state.busy = false;
    const elapsed = Math.round(performance.now() - started);
    setEngine("ready", `IR 已更新 · ${elapsed} ms`);
    renderGenerated();
    updateAudioAvailability();
  } catch (error) {
    console.error(error);
    state.ready = false;
    state.busy = false;
    setEngine("dirty", "重算失败");
    updateAudioAvailability();
    showToast(`脉冲响应生成失败：${error.message}`, true);
  }
}

function renderPending() {
  drawPlaceholder(ui.irCanvas, "正在重算双耳脉冲响应…");
  drawPlaceholder(ui.binauralCanvas, "等待新的卷积输出…");
  drawPlaceholder(compareCards.closed.querySelector(".mini-ir"), "重算中");
  drawPlaceholder(compareCards.open.querySelector(".mini-ir"), "重算中");
  ui.irLengthTag.textContent = "48 kHz · 重算中";
  ui.irEndLabel.textContent = "-- ms";
  ui.binauralBadge.className = "verify-badge is-pending";
  ui.binauralBadge.textContent = "验证中";
  ui.leftRms.textContent = "-- dBFS";
  ui.rightRms.textContent = "-- dBFS";
  ui.channelCorrelation.textContent = "--";
  ui.itdValue.textContent = "-- µs";
  ui.binauralNote.textContent = "房间参数已改变，旧音频已停用；正在生成新的双耳响应。";
  ui.signatureText.textContent = "SIGNATURE —";
  ui.compareSummary.textContent = "参数已改变。开放与封闭房间的响应正在同步重算。";
  for (const card of Object.values(compareCards)) {
    card.querySelector("[data-rt]").textContent = "— s";
    card.querySelector("[data-reflections]").textContent = "—";
    card.querySelector("[data-diff]").textContent = "— dB";
  }
  refreshGeometryMetrics();
}

function updateAudioAvailability() {
  const available = state.ready && !state.busy && Boolean(state.wet);
  ui.playButton.disabled = !available;
  ui.exportButton.disabled = !available;
  document.querySelectorAll("[data-play-mode]").forEach((button) => {
    button.disabled = !available;
  });
}

function responseMaximum(result) {
  let maximum = 1e-9;
  const stride = 17;
  for (let index = 0; index < result.left.length; index += stride) {
    maximum = Math.max(maximum, Math.abs(result.left[index]), Math.abs(result.right[index]));
  }
  return maximum;
}

function paintComparisonCard(mode, result, wetMetrics) {
  const card = compareCards[mode];
  const isCurrent = state.comparison.mode === mode;
  card.classList.toggle("is-current", isCurrent);
  card.querySelector("[data-current-flag]").textContent = isCurrent ? "当前" : "对照";
  card.querySelector("[data-rt]").textContent = `${fixed(result.metrics.rt60, 2)} s`;
  card.querySelector("[data-reflections]").textContent = String(result.metrics.reflectionCount);
  const earDifference = Math.abs(wetMetrics.leftDb - wetMetrics.rightDb);
  card.querySelector("[data-diff]").textContent = `${fixed(earDifference, 1)} dB`;
  const button = card.querySelector("[data-play-mode]");
  button.dataset.originalHtml = button.innerHTML;
  button.innerHTML = `<span>▶</span> 试听${mode === "open" ? "开放" : "封闭"}`;
}

function renderComparison() {
  const { closed, open, mode } = state.comparison;
  const closedWetMetrics = mode === "closed" ? state.wetMetrics : state.alternateWetMetrics;
  const openWetMetrics = mode === "open" ? state.wetMetrics : state.alternateWetMetrics;
  paintComparisonCard("closed", closed, closedWetMetrics);
  paintComparisonCard("open", open, openWetMetrics);

  const sharedDuration = Math.max(closed.duration, open.duration);
  const sharedMaximum = Math.max(responseMaximum(closed), responseMaximum(open));
  drawMiniResponse(
    compareCards.closed.querySelector(".mini-ir"),
    closed,
    "#a7a1ff",
    sharedMaximum,
    sharedDuration,
  );
  drawMiniResponse(
    compareCards.open.querySelector(".mini-ir"),
    open,
    "#c8f174",
    sharedMaximum,
    sharedDuration,
  );

  const reduction = ((closed.metrics.rt60 - open.metrics.rt60) / closed.metrics.rt60) * 100;
  const pathDelta = closed.metrics.reflectionCount - open.metrics.reflectionCount;
  const direction = reduction >= 0 ? "缩短" : "延长";
  ui.compareSummary.textContent =
    `开放使混响时间${direction} ${Math.abs(reduction).toFixed(1)}%` +
    `（${fixed(closed.metrics.rt60, 2)} → ${fixed(open.metrics.rt60, 2)} s），` +
    `高次镜像反射减少 ${Math.max(0, pathDelta)} 条；两个版本均保留左右声道差异。`;
}

function renderBinaural() {
  const metrics = state.wetMetrics;
  ui.binauralBadge.className = `verify-badge ${metrics.passed ? "is-pass" : "is-fail"}`;
  ui.binauralBadge.textContent = metrics.passed ? "验证通过" : "差异不足";
  ui.leftRms.textContent = `${fixed(metrics.leftDb, 1)} dBFS`;
  ui.rightRms.textContent = `${fixed(metrics.rightDb, 1)} dBFS`;
  ui.channelCorrelation.textContent = fixed(metrics.correlation, 3);
  const itd = Math.abs(state.current.metrics.itdMicroseconds);
  ui.itdValue.textContent = `${Math.round(itd)} µs`;
  const earDifference = Math.abs(metrics.leftDb - metrics.rightDb);
  const side =
    itd < 1
      ? "直达声接近居中，反射与扩散尾音"
      : state.current.metrics.itdMicroseconds > 0
        ? "右耳先到"
        : "左耳先到";
  ui.binauralNote.textContent =
    `${side}，双耳时差 ${Math.round(itd)} µs。左右耳声级差 ${fixed(earDifference, 1)} dB，` +
    `波形相关 ${fixed(metrics.correlation, 3)}；逐样本 L ≠ R，验证${metrics.passed ? "通过" : "未通过"}。`;
  drawBinaural(ui.binauralCanvas, state.wet);
}

function renderGenerated() {
  const result = state.current;
  state.paths = result.paths.filter((path) => path.order <= 2);
  state.params = result.params;
  syncControls();
  redrawRoom();

  ui.irLengthTag.textContent = `48 kHz · ${fixed(result.duration, 2)} s`;
  ui.irEndLabel.textContent = `${Math.round(result.duration * 1000)} ms`;
  const earlyLabel = document.querySelector(".axis-early");
  earlyLabel.style.left = `${clamp((0.08 / result.duration) * 100, 6, 95)}%`;
  drawImpulseResponse(ui.irCanvas, result);
  renderBinaural();
  renderComparison();
  ui.signatureText.textContent = `SIGNATURE IR-${result.signature}`;
  ui.signatureText.title = `音频签名 ${audioSignature(state.params)}`;
  refreshGeometryMetrics();
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle("is-error", isError);
  ui.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), 3600);
}

function wetForMode(mode) {
  if (!state.comparison) return null;
  if (mode === state.comparison.mode) return state.wet;
  return state.alternateWet;
}

async function playBuffer(wet, key, button) {
  if (!wet) {
    showToast("当前双耳音频尚未准备好。", true);
    return;
  }
  if (state.activePlayback) {
    const same = state.activePlayback.key === key;
    stopPlayback();
    if (same) return;
  }

  const generation = state.generation;
  try {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("浏览器不支持 Web Audio");
      state.audioContext = new AudioContextClass({ sampleRate: wet.sampleRate });
    }
    const context = state.audioContext;
    await context.resume();
    if (generation !== state.generation) return;

    const buffer = context.createBuffer(2, wet.left.length, wet.sampleRate);
    buffer.getChannelData(0).set(wet.left);
    buffer.getChannelData(1).set(wet.right);
    const node = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0.9;
    node.buffer = buffer;
    node.connect(gain).connect(context.destination);

    const originalHtml = button.innerHTML;
    if (button === ui.playButton) {
      ui.playButtonText.textContent = "停止试听";
      ui.playButton.querySelector(".button-icon").textContent = "■";
    } else {
      button.innerHTML = "<span>■</span> 停止";
    }
    state.activePlayback = { node, button, key, originalHtml };
    node.onended = () => {
      if (state.activePlayback?.node === node) {
        stopPlayback(false);
      }
    };
    node.start();
  } catch (error) {
    console.error(error);
    showToast(`无法播放：${error.message}`, true);
    stopPlayback();
  }
}

function stopPlayback(restore = true) {
  const playback = state.activePlayback;
  if (!playback) {
    if (restore && ui.playButtonText.textContent === "停止试听") {
      ui.playButtonText.textContent = "试听混响";
      ui.playButton.querySelector(".button-icon").textContent = "▶";
    }
    return;
  }
  try {
    playback.node.onended = null;
    playback.node.stop();
  } catch {
  }
  if (playback.button === ui.playButton) {
    ui.playButtonText.textContent = "试听混响";
    ui.playButton.querySelector(".button-icon").textContent = "▶";
  } else {
    playback.button.innerHTML = playback.originalHtml;
  }
  state.activePlayback = null;
}

ui.playButton.addEventListener("click", () => {
  if (!state.ready || !state.wet) return;
  playBuffer(state.wet, "current", ui.playButton);
});

document.querySelectorAll("[data-play-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!state.ready) return;
    const mode = button.dataset.playMode;
    playBuffer(wetForMode(mode), mode, button);
  });
});

ui.exportButton.addEventListener("click", () => {
  if (!state.ready || !state.wet || !state.comparison) {
    showToast("房间响应尚未就绪，无法导出旧音频。", true);
    return;
  }
  try {
    const bytes = encodeStereoWav([state.wet.left, state.wet.right], state.wet.sampleRate);
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `room-ir-${state.comparison.mode}-${roomSignature(state.params)}-binaural.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    showToast(
      `已导出 ${state.comparison.mode === "open" ? "开放" : "封闭"}房间双耳卷积 WAV · 48 kHz / 16-bit stereo`,
    );
  } catch (error) {
    console.error(error);
    showToast(`导出失败：${error.message}`, true);
  }
});

function canvasCoordinates(event) {
  const rect = ui.roomCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function markerAt(point) {
  if (!state.roomView) return null;
  const source = state.roomView.toScreen(state.params.sourceX, state.params.sourceY);
  const listener = state.roomView.toScreen(state.params.listenerX, state.params.listenerY);
  const sourceDistance = Math.hypot(point.x - source.x, point.y - source.y);
  const listenerDistance = Math.hypot(point.x - listener.x, point.y - listener.y);
  if (Math.min(sourceDistance, listenerDistance) > 25) return null;
  return sourceDistance <= listenerDistance ? "source" : "listener";
}

ui.roomCanvas.addEventListener("pointerdown", (event) => {
  const point = canvasCoordinates(event);
  const marker = markerAt(point);
  if (!marker) return;
  event.preventDefault();
  state.drag = { target: marker, pointerId: event.pointerId };
  state.hover = marker;
  ui.roomCanvas.setPointerCapture(event.pointerId);
  ui.roomCanvas.style.cursor = "grabbing";
  redrawRoom();
});

ui.roomCanvas.addEventListener("pointermove", (event) => {
  const point = canvasCoordinates(event);
  if (state.drag) {
    const roomPoint = state.roomView.toRoom(point.x, point.y);
    const x = clamp(roomPoint.x, 0.12, state.params.width - 0.12);
    const y = clamp(roomPoint.y, 0.12, state.params.depth - 0.12);
    if (state.drag.target === "source") {
      state.params = normalizeParams({ ...state.params, sourceX: x, sourceY: y });
    } else {
      state.params = normalizeParams({ ...state.params, listenerX: x, listenerY: y });
    }
    applyParameterChange("声源或听者移动，脉冲响应重新计算中");
    ui.roomCanvas.style.cursor = "grabbing";
    return;
  }
  const marker = markerAt(point);
  if (marker !== state.hover) {
    state.hover = marker;
    redrawRoom();
  }
  ui.roomCanvas.style.cursor = marker ? "grab" : "crosshair";
});

function finishDrag(event) {
  if (!state.drag) return;
  state.drag = null;
  if (ui.roomCanvas.hasPointerCapture(event.pointerId)) {
    ui.roomCanvas.releasePointerCapture(event.pointerId);
  }
  ui.roomCanvas.style.cursor = state.hover ? "grab" : "crosshair";
  redrawRoom();
}

ui.roomCanvas.addEventListener("pointerup", finishDrag);
ui.roomCanvas.addEventListener("pointercancel", finishDrag);
ui.roomCanvas.addEventListener("pointerleave", () => {
  if (state.drag) return;
  state.hover = null;
  ui.roomCanvas.style.cursor = "crosshair";
  redrawRoom();
});

let resizeFrame = null;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    redrawRoom();
    if (state.ready && state.current) {
      drawImpulseResponse(ui.irCanvas, state.current);
      drawBinaural(ui.binauralCanvas, state.wet);
      renderComparison();
    } else {
      renderPending();
    }
  });
});

function initialize() {
  state.params = normalizeParams(DEFAULT_PARAMS);
  state.busy = true;
  syncControls();
  redrawRoom();
  renderPending();
  updateAudioAvailability();
  setEngine("working", "生成双耳脉冲响应");
  state.generation += 1;
  regenerate(state.generation);
  document.fonts?.ready.then(() => {
    redrawRoom();
    if (state.ready && state.current) {
      drawImpulseResponse(ui.irCanvas, state.current);
      drawBinaural(ui.binauralCanvas, state.wet);
      renderComparison();
    }
  });
}

initialize();
