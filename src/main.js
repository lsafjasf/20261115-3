import { AudioEngine } from "./audio.js";
import {
  BEAT_INTERVAL,
  PROGRAM,
  TRANSITION_DURATION,
  TRANSITION_LABELS,
  activeShotIndex,
  beatPosition,
  buildShotTable,
  cloneShots,
  formatClock,
  formatTimecode,
  getCutPoints,
  isOnBeat,
  snapToBeat,
  sortShots,
  transitionAtTime,
  validateProgram
} from "./program.js";
import { CAMERA_BY_ID, CAMERAS, renderCamera, renderTransition, sceneSignature } from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  programCanvas: $("#programCanvas"),
  previewCanvases: $$(".preview-canvas"),
  cameraPreviews: $$(".camera-preview"),
  playBtn: $("#playBtn"),
  playLabel: $("#playLabel"),
  restartBtn: $("#restartBtn"),
  timecode: $("#timecode"),
  programClock: $("#programClock"),
  liveBadge: $("#liveBadge"),
  tally: $("#tally"),
  shotReadout: $("#shotReadout"),
  nextCut: $("#nextCut"),
  barReadout: $("#barReadout"),
  beatDots: $$("#beatDots i"),
  ruler: $("#ruler"),
  beatGrid: $("#beatGrid"),
  shotBlocks: $("#shotBlocks"),
  playhead: $("#playhead"),
  timelineTrack: $("#timelineTrack"),
  shotCount: $("#shotCount"),
  selectedShotTitle: $("#inspectorTitle"),
  inspectorChip: $("#inspectorChip"),
  cutTimeInput: $("#cutTimeInput"),
  timeHint: $("#timeHint"),
  cameraPicker: $("#cameraPicker"),
  cameraPickButtons: $$("[data-pick-camera]"),
  transitionSelect: $("#transitionSelect"),
  removeShotBtn: $("#removeShotBtn"),
  addCutBtn: $("#addCutBtn"),
  checkSummary: $("#checkSummary"),
  checkList: $("#checkList"),
  continuitySpan: $(".continuity-note span"),
  exportWebmBtn: $("#exportWebmBtn"),
  exportJsonBtn: $("#exportJsonBtn"),
  exportProgress: $("#exportProgress"),
  exportPercent: $("#exportPercent"),
  exportBar: $("#exportBar"),
  toast: $("#toast")
};

const programContext = dom.programCanvas.getContext("2d", { alpha: false });
const previewContexts = dom.previewCanvases.map((canvas) => canvas.getContext("2d", { alpha: false }));
const sourceBuffer = document.createElement("canvas");
const targetBuffer = document.createElement("canvas");
sourceBuffer.width = dom.programCanvas.width;
sourceBuffer.height = dom.programCanvas.height;
targetBuffer.width = dom.programCanvas.width;
targetBuffer.height = dom.programCanvas.height;
const sourceContext = sourceBuffer.getContext("2d", { alpha: false });
const targetContext = targetBuffer.getContext("2d", { alpha: false });
const audio = new AudioEngine();

const state = {
  shots: cloneShots(),
  selectedShotId: "shot-2",
  playhead: 0,
  playing: false,
  exporting: false,
  exportPercent: 0,
  lastRenderTime: -1,
  toastTimer: null
};

let validation = validateProgram(state.shots);

function orderedShots() {
  return sortShots(state.shots);
}

function selectedShot() {
  return state.shots.find((shot) => shot.id === state.selectedShotId) ?? orderedShots()[0];
}

function currentProgramTime() {
  return state.playing ? audio.clockTime() : state.playhead;
}

function drawProgram(time) {
  const shots = orderedShots();
  const activeIndex = activeShotIndex(shots, time);
  const active = shots[activeIndex];
  const transition = transitionAtTime(shots, time);

  if (transition) {
    renderCamera(sourceContext, sourceBuffer.width, sourceBuffer.height, transition.fromCamera, time);
    renderCamera(targetContext, targetBuffer.width, targetBuffer.height, transition.toCamera, time);
    renderTransition(
      programContext,
      dom.programCanvas.width,
      dom.programCanvas.height,
      sourceBuffer,
      targetBuffer,
      transition.progress,
      transition.transition
    );
  } else {
    renderCamera(programContext, dom.programCanvas.width, dom.programCanvas.height, active.camera, time);
  }

  dom.cameraPreviews.forEach((preview, index) => {
    renderCamera(previewContexts[index], 384, 216, CAMERAS[index].id, time);
    preview.classList.toggle("is-active", CAMERAS[index].id === active.camera);
  });

  updateMonitorUI(time, shots, activeIndex, transition);
}

function updateMonitorUI(time, shots, activeIndex, transition) {
  const active = shots[activeIndex];
  const camera = CAMERA_BY_ID[active.camera];
  const beat = beatPosition(time);
  const next = shots.find((shot) => shot.start > time + 0.0005);
  const displayCamera = transition ? CAMERA_BY_ID[transition.toCamera] : camera;

  dom.timecode.textContent = formatTimecode(time);
  dom.programClock.textContent = formatClock(time);
  dom.shotReadout.textContent = `SHOT ${String(activeIndex + 1).padStart(2, "0")} / ${camera.name.split(" /")[0]}`;
  dom.tally.querySelector("span").textContent = `CAM ${displayCamera.number}`;
  dom.nextCut.textContent = next ? formatClock(next.start) : "END";
  dom.barReadout.textContent = `${String(beat.bar).padStart(2, "0")}.${beat.beatInBar}`;
  dom.beatDots.forEach((dot, index) => {
    dot.classList.toggle("is-on", index === beat.beatInBar - 1);
  });
  dom.playhead.style.left = `${(time / PROGRAM.durationSeconds) * 100}%`;

  if (state.playing) {
    dom.liveBadge.classList.add("is-live");
    dom.liveBadge.innerHTML = "<i></i> LIVE";
  } else {
    dom.liveBadge.classList.remove("is-live");
    dom.liveBadge.innerHTML = "<i></i> READY";
  }

  const shouldTick = Math.abs(time - state.lastRenderTime) > 0.03;
  if (shouldTick) {
    state.lastRenderTime = time;
  }
}

function frame() {
  const time = currentProgramTime();
  if (!state.exporting && state.playing && time >= PROGRAM.durationSeconds) {
    state.playhead = PROGRAM.durationSeconds;
    state.playing = false;
    audio.stop();
    syncTransportButtons();
  } else {
    state.playhead = time;
  }

  drawProgram(Math.min(state.playhead, PROGRAM.durationSeconds));
  if (state.exporting) {
    updateExportProgress(Math.min(1, state.playhead / PROGRAM.durationSeconds));
  }
  requestAnimationFrame(frame);
}

function syncTransportButtons() {
  dom.playBtn.classList.toggle("is-playing", state.playing);
  dom.playBtn.setAttribute("aria-label", state.playing ? "暂停节目" : "播放节目");
  dom.playLabel.textContent = state.playing ? "暂停" : "播放";
  dom.playBtn.disabled = state.exporting;
  dom.restartBtn.disabled = state.exporting;
}

function renderTimelineStatic() {
  const rulerLabels = [0, 3, 6, 9, 12, 15];
  dom.ruler.innerHTML = rulerLabels
    .map((second) => {
      const edge = second === 0 || second === PROGRAM.durationSeconds ? " is-edge" : "";
      return `<span class="ruler-tick${edge}" style="left:${(second / PROGRAM.durationSeconds) * 100}%">${second}s</span>`;
    })
    .join("");

  const lines = [];
  const beatCount = Math.round(PROGRAM.durationSeconds / BEAT_INTERVAL);
  for (let beat = 0; beat <= beatCount; beat += 1) {
    const isBar = beat % PROGRAM.beatsPerBar === 0;
    lines.push(
      `<i class="beat-line${isBar ? " is-bar" : ""}" style="left:${(beat / beatCount) * 100}%"></i>`
    );
  }
  dom.beatGrid.innerHTML = lines.join("");
}

function renderShotBlocks() {
  const shots = orderedShots();
  const selectedId = selectedShot().id;
  const blocks = shots.map((shot, index) => {
    const end = shots[index + 1]?.start ?? PROGRAM.durationSeconds;
    const width = end - shot.start;
    const camera = CAMERA_BY_ID[shot.camera];
    const transition = index === 0 ? "开场" : TRANSITION_LABELS[shot.transition];
    return `
      <button
        class="shot-block${shot.id === selectedId ? " is-selected" : ""}"
        type="button"
        data-shot-id="${shot.id}"
        data-camera="${shot.camera}"
        style="left:${(shot.start / PROGRAM.durationSeconds) * 100}%;width:${(width / PROGRAM.durationSeconds) * 100}%"
        aria-label="镜头 ${index + 1}，${camera.label}，${formatClock(shot.start)}"
      >
        <span class="shot-top">
          <span class="shot-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="shot-cam">CAM ${camera.number}</span>
        </span>
        <span class="shot-camera-name">${camera.name}</span>
        <span class="shot-transition">${transition}</span>
      </button>
    `;
  });

  shots.slice(1).forEach((shot, index) => {
    blocks.push(
      `<span class="cut-marker" style="left:${(shot.start / PROGRAM.durationSeconds) * 100}%" title="切点 ${index + 1} · ${formatClock(shot.start)}"></span>`
    );
  });
  dom.shotBlocks.innerHTML = blocks.join("");
  dom.shotCount.textContent = `${shots.length} 段 / ${shots.length - 1} 切点`;
}

function renderInspector() {
  const shots = orderedShots();
  const selected = selectedShot();
  const index = shots.findIndex((shot) => shot.id === selected.id);
  const beat = beatPosition(selected.start);
  dom.selectedShotTitle.textContent = `镜头 ${String(index + 1).padStart(2, "0")}`;
  dom.inspectorChip.textContent = index === 0 ? "OPENING" : `CUT ${String(index).padStart(2, "0")}`;
  dom.cutTimeInput.value = selected.start.toFixed(2);
  dom.cutTimeInput.disabled = index === 0 || state.exporting;
  dom.cutTimeInput.closest(".field-group").classList.toggle("is-disabled", index === 0);
  dom.timeHint.textContent = index === 0
    ? "节目开场 · 场景时钟从 0.00s 起算"
    : `第 ${beat.bar} 小节第 ${beat.beatInBar} 拍 · 第 ${beat.zeroBasedBeat} 个半拍`;
  dom.timeHint.classList.remove("is-error");

  dom.cameraPickButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.pickCamera === selected.camera);
    button.disabled = state.exporting;
  });
  dom.transitionSelect.value = selected.transition;
  dom.transitionSelect.disabled = state.exporting;
  dom.removeShotBtn.disabled = index === 0 || shots.length <= 1 || state.exporting;
  dom.addCutBtn.disabled = state.exporting;
}

function renderValidation() {
  validation = validateProgram(state.shots);
  const passedChecks = validation.checks.filter((check) => check.passed).length;
  dom.checkSummary.textContent = `${passedChecks} / ${validation.checks.length}`;
  dom.checkSummary.style.color = validation.passed ? "var(--lime)" : "var(--danger)";
  dom.checkList.innerHTML = validation.checks.length
    ? validation.checks.map((check, index) => `
        <div class="cut-check${check.passed ? "" : " is-error"}">
          <span class="check-icon">${check.passed ? "✓" : "!"}</span>
          <span class="check-copy">
            <strong>${check.label}</strong>
            <small>${check.detail}</small>
          </span>
          <time>CAM ${CAMERA_BY_ID[check.toCamera]?.number ?? "??"}</time>
        </div>
      `).join("")
    : `<div class="cut-check is-error"><span class="check-icon">!</span><span class="check-copy"><strong>没有切点</strong><small>至少需要一个镜头切换</small></span><time>--</time></div>`;

  const countNote = validation.cutCount === validation.expectedCutCount
    ? "3 个切点"
    : `需要 ${validation.expectedCutCount} 个切点，当前 ${validation.cutCount} 个`;
  const maxDelta = validation.continuity.maxDeltaPx.toFixed(2);
  dom.continuitySpan.textContent = `绝对时钟连续 · 切点最大位移 ${maxDelta}px / 8.3ms`;
  dom.checkSummary.title = countNote;

  const secondCheck = dom.checkSummary;
  secondCheck.dataset.passed = String(validation.passed);
  return validation;
}

function renderAll() {
  renderShotBlocks();
  renderInspector();
  renderValidation();
}

function setSelectedShot(id, seek = false) {
  const shot = state.shots.find((item) => item.id === id);
  if (!shot) {
    return;
  }
  state.selectedShotId = shot.id;
  if (seek) {
    seekTo(shot.start);
  }
  renderShotBlocks();
  renderInspector();
}

function replaceShots(nextShots) {
  state.shots = sortShots(nextShots);
  if (!state.shots.some((shot) => shot.id === state.selectedShotId)) {
    state.selectedShotId = state.shots[0]?.id ?? null;
  }
  renderAll();
  drawProgram(state.playhead);
}

function seekTo(time) {
  if (state.exporting) {
    return;
  }
  if (state.playing) {
    audio.stop();
    state.playing = false;
    syncTransportButtons();
  }
  state.playhead = Math.max(0, Math.min(PROGRAM.durationSeconds, time));
  state.lastRenderTime = -1;
  drawProgram(state.playhead);
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("is-error", isError);
  dom.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => dom.toast.classList.remove("is-visible"), 3200);
}

async function togglePlayback() {
  if (state.exporting) {
    return;
  }
  if (state.playing) {
    state.playhead = audio.clockTime();
    audio.stop();
    state.playing = false;
    syncTransportButtons();
    return;
  }

  const offset = state.playhead >= PROGRAM.durationSeconds ? 0 : state.playhead;
  try {
    await audio.start(offset);
    state.playhead = offset;
    state.playing = true;
    syncTransportButtons();
  } catch (error) {
    showToast(`无法启动音频：${error.message}`, true);
  }
}

function restartProgram() {
  if (state.exporting) {
    return;
  }
  audio.stop();
  state.playing = false;
  syncTransportButtons();
  seekTo(0);
  showToast("节目已回到 00:00");
}

function changeSelectedCamera(cameraId) {
  if (state.exporting || !CAMERA_BY_ID[cameraId]) {
    return;
  }
  const shot = selectedShot();
  shot.camera = cameraId;
  renderAll();
  drawProgram(state.playhead);
}

function changeSelectedTransition(transition) {
  if (state.exporting || !Object.hasOwn(TRANSITION_DURATION, transition)) {
    return;
  }
  const shot = selectedShot();
  shot.transition = transition;
  renderAll();
  drawProgram(state.playhead);
}

function updateSelectedCutTime(rawTime) {
  const shots = orderedShots();
  const shot = selectedShot();
  const index = shots.findIndex((item) => item.id === shot.id);
  if (index <= 0) {
    renderInspector();
    return;
  }

  const snapped = snapToBeat(Number(rawTime));
  if (!Number.isFinite(snapped) || snapped < BEAT_INTERVAL || snapped >= PROGRAM.durationSeconds) {
    renderInspector();
    dom.timeHint.textContent = "切点必须位于 0.5s 与 14.5s 之间";
    dom.timeHint.classList.add("is-error");
    return;
  }
  if (shots.some((item) => item.id !== shot.id && Math.abs(item.start - snapped) < 1e-6)) {
    renderInspector();
    dom.timeHint.textContent = "该节拍已有切点，请选择其他时间";
    dom.timeHint.classList.add("is-error");
    return;
  }

  shot.start = snapped;
  state.shots = sortShots(state.shots);
  renderAll();
  drawProgram(state.playhead);
  showToast(`切点已吸附至 ${snapped.toFixed(2)}s · ${isOnBeat(snapped) ? "节拍锁定" : "节拍偏差"}`);
}

function addCut() {
  if (state.exporting) {
    return;
  }
  const shots = orderedShots();
  if (shots.length >= 8) {
    showToast("镜头段数已达上限", true);
    return;
  }

  let bestGap = null;
  shots.forEach((shot, index) => {
    const end = shots[index + 1]?.start ?? PROGRAM.durationSeconds;
    const size = end - shot.start;
    if (size >= BEAT_INTERVAL * 2 && (!bestGap || size > bestGap.size)) {
      bestGap = { start: shot.start, end, size, index };
    }
  });
  if (!bestGap) {
    showToast("没有足够长的镜头间隔来添加切点", true);
    return;
  }

  const start = snapToBeat((bestGap.start + bestGap.end) / 2);
  const previousCamera = shots[bestGap.index].camera;
  const camera = CAMERAS.find((item) => item.id !== previousCamera)?.id ?? previousCamera;
  const shot = {
    id: `shot-${Date.now().toString(36)}`,
    start,
    camera,
    transition: "dissolve"
  };
  state.shots = sortShots([...state.shots, shot]);
  state.selectedShotId = shot.id;
  renderAll();
  seekTo(start);
  showToast(`已在 ${formatClock(start)} 添加切点`);
}

function removeSelectedShot() {
  if (state.exporting) {
    return;
  }
  const shots = orderedShots();
  const shot = selectedShot();
  const index = shots.findIndex((item) => item.id === shot.id);
  if (index <= 0) {
    showToast("开场镜头不可删除", true);
    return;
  }
  const neighbor = shots[Math.max(0, index - 1)];
  state.selectedShotId = neighbor.id;
  replaceShots(state.shots.filter((item) => item.id !== shot.id));
  showToast(`已删除镜头 ${String(index + 1).padStart(2, "0")}`);
}

function handleTimelineClick(event) {
  if (state.exporting) {
    return;
  }
  const block = event.target.closest(".shot-block");
  if (block) {
    const shot = state.shots.find((item) => item.id === block.dataset.shotId);
    setSelectedShot(shot.id, true);
    return;
  }
  const rect = dom.timelineTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const time = ratio * PROGRAM.durationSeconds;
  setSelectedShot(orderedShots()[activeShotIndex(state.shots, time)].id, false);
  seekTo(time);
}

function updateExportProgress(progress) {
  state.exportPercent = Math.max(0, Math.min(1, progress));
  const percent = Math.round(state.exportPercent * 100);
  dom.exportPercent.textContent = `${percent}%`;
  dom.exportBar.style.width = `${percent}%`;
}

function setExporting(exporting) {
  state.exporting = exporting;
  dom.exportProgress.classList.toggle("is-visible", exporting);
  dom.programCanvas.parentElement.setAttribute("aria-busy", String(exporting));
  dom.addCutBtn.disabled = exporting;
  dom.exportWebmBtn.disabled = exporting;
  dom.exportJsonBtn.disabled = exporting;
  dom.cameraPreviews.forEach((button) => {
    button.disabled = exporting;
  });
  renderInspector();
  syncTransportButtons();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportShotJson(download = true) {
  validation = validateProgram(state.shots);
  const payload = buildShotTable(state.shots, validation, "orbit-web-deck");
  if (download) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, "orbit-shot-list.json");
    showToast(validation.passed ? "镜头表 JSON 已导出" : "镜头表已导出，但切点自检未通过", !validation.passed);
  }
  return payload;
}

function chooseMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function waitForProgramEnd() {
  const startedAt = performance.now();
  await new Promise((resolve, reject) => {
    const check = () => {
      if (audio.clockTime() >= PROGRAM.durationSeconds) {
        resolve();
      } else if (performance.now() - startedAt > 22000) {
        reject(new Error("实时渲染超时"));
      } else {
        setTimeout(check, 80);
      }
    };
    check();
  });
}

async function exportWebM() {
  if (state.exporting) {
    return;
  }
  validation = validateProgram(state.shots);
  if (!validation.passed) {
    showToast("切点自检未通过：请确认 3 个切点均落在节拍且机位不同", true);
    return;
  }
  if (!dom.programCanvas.captureStream || !window.MediaRecorder) {
    showToast("当前浏览器不支持画布 WebM 录制", true);
    return;
  }

  setExporting(true);
  updateExportProgress(0);
  state.playhead = 0;
  state.playing = false;
  state.lastRenderTime = -1;
  drawProgram(0);

  let recorder = null;
  let combinedStream = null;
  try {
    await audio.ensure();
    const videoStream = dom.programCanvas.captureStream(PROGRAM.fps);
    const audioStream = audio.audioStream;
    if (!audioStream || audioStream.getAudioTracks().length === 0) {
      throw new Error("无法创建音频轨道");
    }
    combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks()
    ]);
    const mimeType = chooseMimeType();
    recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : {});
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      });
      recorder.addEventListener("error", () => reject(recorder.error || new Error("录制失败")));
    });

    recorder.start(250);
    await audio.start(0);
    state.playing = true;
    syncTransportButtons();
    await waitForProgramEnd();
    state.playhead = PROGRAM.durationSeconds;
    drawProgram(PROGRAM.durationSeconds);
    updateExportProgress(1);
    audio.stop();
    state.playing = false;
    recorder.stop();
    const recordedBlob = await stopped;
    if (!recordedBlob || recordedBlob.size < 1000) {
      throw new Error("WebM 文件为空");
    }
    const blob = window.ysFixWebmDuration
      ? await window.ysFixWebmDuration(recordedBlob, PROGRAM.durationSeconds * 1000, { logger: false })
      : recordedBlob;
    downloadBlob(blob, "orbit-three-camera-15s.webm");
    showToast(`WebM 已导出 · ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
  } catch (error) {
    audio.stop();
    state.playing = false;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
    showToast(`导出失败：${error.message}`, true);
  } finally {
    combinedStream?.getTracks().forEach((track) => track.stop());
    state.exporting = false;
    setExporting(false);
    dom.exportProgress.classList.remove("is-visible");
    updateExportProgress(0);
  }
}

function bindEvents() {
  dom.playBtn.addEventListener("click", togglePlayback);
  dom.restartBtn.addEventListener("click", restartProgram);
  dom.addCutBtn.addEventListener("click", addCut);
  dom.removeShotBtn.addEventListener("click", removeSelectedShot);
  dom.timelineTrack.addEventListener("click", handleTimelineClick);
  dom.exportJsonBtn.addEventListener("click", () => exportShotJson(true));
  dom.exportWebmBtn.addEventListener("click", exportWebM);

  dom.cameraPickButtons.forEach((button) => {
    button.addEventListener("click", () => changeSelectedCamera(button.dataset.pickCamera));
  });
  dom.cameraPreviews.forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.exporting) {
        changeSelectedCamera(button.dataset.camera);
      }
    });
  });
  dom.transitionSelect.addEventListener("change", () => {
    changeSelectedTransition(dom.transitionSelect.value);
  });
  dom.cutTimeInput.addEventListener("change", () => {
    updateSelectedCutTime(dom.cutTimeInput.value);
  });
  dom.cutTimeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      dom.cutTimeInput.blur();
    }
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const shots = orderedShots();
      const selectedIndex = shots.findIndex((shot) => shot.id === selectedShot().id);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (selectedIndex + delta + shots.length) % shots.length;
      setSelectedShot(shots[nextIndex].id, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      restartProgram();
    }
  });

  window.addEventListener("beforeunload", () => audio.stop());
}

function boot() {
  renderTimelineStatic();
  renderAll();
  syncTransportButtons();
  bindEvents();
  drawProgram(0);
  requestAnimationFrame(frame);

  window.__PROGRAM__ = Object.freeze({
    version: "1.0",
    program: PROGRAM,
    cameras: CAMERAS,
    getShots: () => cloneShots(state.shots),
    getState: () => ({
      shots: cloneShots(state.shots),
      playhead: state.playhead,
      playing: state.playing,
      exporting: state.exporting,
      selectedShotId: state.selectedShotId
    }),
    getValidation: () => validateProgram(state.shots),
    getShotTable: () => buildShotTable(state.shots, validateProgram(state.shots), "api"),
    getSceneSignature: (time) => sceneSignature(time),
    getCutPoints: () => getCutPoints(state.shots),
    seek: (time) => seekTo(time),
    play: () => (!state.playing ? togglePlayback() : Promise.resolve()),
    pause: () => {
      if (state.playing) {
        togglePlayback();
      }
    },
    exportShotJson: () => exportShotJson(false),
    exportWebM
  });
}

boot();
