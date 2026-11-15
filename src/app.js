import {
  DEFAULT_CLIPS,
  MIN_CLIP_DURATION,
  SOURCE_DURATION,
  TRANSITIONS,
  buildSequence,
  clamp,
  clipDuration,
  cueAtOutputTime,
  formatClock,
  primaryClipAt,
  sequenceCaptionSegments,
  transitionProgress,
} from "./scene.js";
import { createAudioContext, drawWaveform, scheduleSequenceAudio } from "./audio.js";
import { renderSequenceFrame, renderSourceFrame, renderThumbnail } from "./render.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  previewCanvas: $("#preview-canvas"),
  preview: $("#preview-canvas").getContext("2d", { alpha: false }),
  monitor: $("#monitor"),
  monitorLabel: $("#monitor-label"),
  monitorTime: $("#monitor-time"),
  monitorMode: $("#monitor-mode"),
  viewSource: $("#view-source"),
  viewEdit: $("#view-edit"),
  bigPlay: $("#big-play"),
  transportPlay: $("#transport-play"),
  current: $("#transport-current"),
  duration: $("#transport-duration"),
  scrubber: $("#scrubber"),
  loop: $("#loop-toggle"),
  sourceClock: $("#source-clock"),
  clipList: $("#clip-list"),
  addClip: $("#add-clip-button"),
  reset: $("#reset-button"),
  clipCount: $("#clip-count"),
  totalDuration: $("#total-duration"),
  timelineScroll: $("#timeline-scroll"),
  timelineInner: $("#timeline-inner"),
  ruler: $("#ruler"),
  clipTrack: $("#clip-track"),
  captionTrack: $("#caption-track"),
  waveform: $("#audio-waveform"),
  playhead: $("#playhead"),
  zoom: $("#timeline-zoom"),
  syncDetail: $("#sync-detail"),
  gatePill: $("#gate-pill"),
  checkCard: $("#check-card"),
  checkIcon: $("#check-icon"),
  checkTitle: $("#check-title"),
  checkDescription: $("#check-description"),
  checkValue: $("#check-value"),
  statSamples: $("#stat-samples"),
  statBlack: $("#stat-black"),
  statLuma: $("#stat-luma"),
  checkButton: $("#check-button"),
  exportButton: $("#export-button"),
  topExport: $("#top-export-button"),
  exportProgress: $("#export-progress"),
  exportBar: $("#export-progress-bar"),
  exportLabel: $("#export-progress-label"),
  resultDrawer: $("#result-drawer"),
  resultVideo: $("#result-video"),
  resultMeta: $("#result-file-meta"),
  replay: $("#replay-export-button"),
  download: $("#download-link"),
  toast: $("#toast"),
};

const state = {
  clips: structuredClone(DEFAULT_CLIPS),
  sequence: buildSequence(DEFAULT_CLIPS),
  viewMode: "edit",
  previewTime: 0,
  sourceTime: 0,
  playing: false,
  loop: false,
  playbackAudio: null,
  playbackOrigin: 0,
  playbackStart: 0,
  playbackDuration: 0,
  raf: 0,
  gate: "idle",
  checkResult: null,
  revision: 0,
  exporting: false,
  exportUrl: "",
  dragIndex: -1,
  lastPaint: 0,
  captionElements: [],
  timelineMetrics: { contentWidth: 0 },
};

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.remove("is-visible"), 2400);
}

function normalizeClip(clip) {
  const safeIn = clamp(Number.isFinite(clip.inPoint) ? clip.inPoint : 0, 0, SOURCE_DURATION - MIN_CLIP_DURATION);
  const safeOut = clamp(
    Number.isFinite(clip.outPoint) ? clip.outPoint : safeIn + MIN_CLIP_DURATION,
    safeIn + MIN_CLIP_DURATION,
    SOURCE_DURATION,
  );
  return { ...clip, inPoint: safeIn, outPoint: safeOut };
}

function normalizeAllClips() {
  state.clips = state.clips.map(normalizeClip);
  state.sequence = buildSequence(state.clips);
}

function activeClock() {
  return state.viewMode === "edit" ? state.previewTime : state.sourceTime;
}

function activeDuration() {
  return state.viewMode === "edit" ? state.sequence.total : SOURCE_DURATION;
}

function setActiveClock(value) {
  if (state.viewMode === "edit") state.previewTime = clamp(value, 0, state.sequence.total);
  else state.sourceTime = clamp(value, 0, SOURCE_DURATION);
}

function invalidateGate(reason = "剪辑已修改，请重新检查黑帧") {
  if (state.exporting) return;
  state.gate = "idle";
  state.checkResult = null;
  state.revision += 1;
  state.captionElements = [];
  dom.resultDrawer.hidden = true;
  updateGateUI();
  if (reason) {
    dom.checkDescription.textContent = "导出前扫描全部成片帧，确认没有黑场断层。";
  }
}

function updateGateUI() {
  const locked = state.gate !== "pass";
  dom.exportButton.disabled = locked || state.exporting;
  dom.topExport.disabled = locked || state.exporting;
  dom.gatePill.textContent = state.gate === "pass" ? "PASSED" : state.gate === "checking" ? "SCANNING" : state.gate === "fail" ? "BLOCKED" : "LOCKED";
  dom.gatePill.classList.toggle("is-open", state.gate === "pass");
  dom.checkCard.classList.toggle("is-pass", state.gate === "pass");
  dom.checkCard.classList.toggle("is-fail", state.gate === "fail");
  dom.checkIcon.textContent =
    state.gate === "pass" ? "✓" : state.gate === "fail" ? "×" : state.gate === "checking" ? "◌" : "◌";
  dom.checkButton.disabled = state.gate === "checking" || state.exporting;
  if (state.gate === "checking") {
    dom.checkTitle.textContent = "正在扫描成片帧";
    dom.checkValue.textContent = "…";
  } else if (state.gate === "pass") {
    dom.checkTitle.textContent = "黑帧检查通过";
    dom.checkDescription.textContent = "所有采样帧都有有效画面亮度，可以导出。";
    dom.checkValue.textContent = "PASS";
  } else if (state.gate === "fail") {
    dom.checkTitle.textContent = "检测到黑帧，导出已阻止";
    dom.checkDescription.textContent = "请调整入点、出点或转场后重新运行检查。";
    dom.checkValue.textContent = "FAIL";
  } else {
    dom.checkTitle.textContent = "黑帧检查待运行";
    dom.checkValue.textContent = "—";
  }

  if (state.checkResult) {
    dom.statSamples.textContent = state.checkResult.samples;
    dom.statBlack.textContent = state.checkResult.black;
    dom.statLuma.textContent = state.checkResult.minLuma.toFixed(1);
  } else {
    dom.statSamples.textContent = "—";
    dom.statBlack.textContent = "—";
    dom.statLuma.textContent = "—";
  }
}

function renderInspector() {
  dom.clipList.innerHTML = state.clips
    .map((clip, index) => {
      const transitionOptions = Object.entries(TRANSITIONS)
        .filter(([key]) => key !== "cut" || index > 0)
        .map(
          ([key, value]) =>
            `<option value="${key}" ${clip.transition === key ? "selected" : ""}>${value.label}</option>`,
        )
        .join("");
      return `
        <article class="clip-card" data-index="${index}" data-clip-id="${clip.id}" draggable="true">
          <div class="clip-card-head">
            <span class="drag-badge" aria-hidden="true">⠿</span>
            <span class="clip-index">0${index + 1}</span>
            <div class="clip-name">
              <strong>${clip.name}</strong>
              <span>SRC ${formatClock(clip.inPoint)} → ${formatClock(clip.outPoint)}</span>
            </div>
            <span class="clip-duration">${clipDuration(clip).toFixed(1)}s</span>
            <button class="clip-remove" type="button" data-remove="${index}" title="删除片段" ${state.clips.length <= 1 ? "disabled" : ""}>×</button>
          </div>
          <div class="range-pair">
            <label class="time-field">
              <span>IN 入点 <small>s</small></span>
              <input data-field="inPoint" data-index="${index}" type="number" min="0" max="28.5" step="0.1" value="${clip.inPoint.toFixed(1)}" />
            </label>
            <label class="time-field">
              <span>OUT 出点 <small>s</small></span>
              <input data-field="outPoint" data-index="${index}" type="number" min="1.5" max="30" step="0.1" value="${clip.outPoint.toFixed(1)}" />
            </label>
          </div>
          <div class="clip-card-foot">
            <span>${index === 0 ? "起始转场" : "转场 IN"}</span>
            <select data-field="transition" data-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="片段 ${index + 1} 转场">
              ${index === 0 ? '<option>时间线起点</option>' : transitionOptions}
            </select>
          </div>
        </article>
      `;
    })
    .join("");
  dom.clipCount.textContent = `${state.clips.length} 段`;
  dom.addClip.disabled = state.clips.length >= 5;
}

function onChangeClipField(index, field, rawValue) {
  const clip = state.clips[index];
  if (!clip) return;
  if (field === "transition") {
    clip.transition = rawValue;
  } else {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      renderInspector();
      return;
    }
    if (field === "inPoint") {
      clip.inPoint = clamp(value, 0, SOURCE_DURATION - MIN_CLIP_DURATION);
      if (clip.outPoint < clip.inPoint + MIN_CLIP_DURATION) {
        clip.outPoint = Math.min(SOURCE_DURATION, clip.inPoint + MIN_CLIP_DURATION);
      }
    } else {
      clip.outPoint = clamp(value, MIN_CLIP_DURATION, SOURCE_DURATION);
      if (clip.inPoint > clip.outPoint - MIN_CLIP_DURATION) {
        clip.inPoint = Math.max(0, clip.outPoint - MIN_CLIP_DURATION);
      }
    }
    state.clips[index] = normalizeClip(clip);
  }
  normalizeAllClips();
  state.previewTime = clamp(state.previewTime, 0, state.sequence.total);
  invalidateGate();
  renderAll();
}

function addClip() {
  if (state.clips.length >= 5) {
    toast("最多支持五个片段");
    return;
  }
  const presets = [
    [2.4, 6.2],
    [10.6, 14.2],
    [20.8, 24.6],
    [14.8, 18.2],
    [5.6, 9.2],
  ];
  const preset = presets[state.clips.length % presets.length];
  state.clips.push({
    id: `clip-${Date.now().toString(36)}`,
    name: `片段 ${String(state.clips.length + 1).padStart(2, "0")}`,
    inPoint: preset[0],
    outPoint: preset[1],
    transition: state.clips.length % 2 ? "crossfade" : "slide",
  });
  normalizeAllClips();
  invalidateGate();
  renderAll();
}

function removeClip(index) {
  if (state.clips.length <= 1) return;
  state.clips.splice(index, 1);
  normalizeAllClips();
  state.previewTime = clamp(state.previewTime, 0, state.sequence.total);
  invalidateGate();
  renderAll();
}

function reorderClip(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  const [moved] = state.clips.splice(fromIndex, 1);
  state.clips.splice(toIndex, 0, moved);
  normalizeAllClips();
  state.previewTime = clamp(state.previewTime, 0, state.sequence.total);
  invalidateGate();
  renderAll();
  toast("片段顺序已更新，转场与同步关系已重算");
}

function renderTimeline() {
  const sequence = state.sequence;
  const viewportWidth = Math.max(620, dom.timelineScroll.clientWidth - 84);
  const contentWidth = Math.max(viewportWidth, sequence.total * 105 * Number(dom.zoom.value));
  const innerWidth = contentWidth + 82;
  state.timelineMetrics.contentWidth = contentWidth;
  dom.timelineInner.style.width = `${innerWidth}px`;
  dom.timelineInner.style.minHeight = "236px";

  const tickInterval = sequence.total <= 8 ? 0.5 : sequence.total <= 16 ? 1 : 2;
  const ticks = [];
  for (let time = 0; time <= sequence.total + 0.001; time += tickInterval) {
    const major = Math.abs(time % (tickInterval * 2)) < 0.001;
    const percent = (time / Math.max(0.001, sequence.total)) * 100;
    ticks.push(
      `<span class="ruler-tick ${major ? "major" : ""}" style="left:${percent}%">
        <span>${formatClock(time)}</span>
      </span>`,
    );
  }
  ticks.push(
    `<span class="ruler-tick" style="left:100%"><span>${formatClock(sequence.total)}</span></span>`,
  );
  dom.ruler.innerHTML = ticks.join("");

  dom.clipTrack.innerHTML = sequence.clips
    .map((clip) => {
      const left = (clip.start / Math.max(0.001, sequence.total)) * contentWidth;
      const width = Math.max(66, (clip.duration / Math.max(0.001, sequence.total)) * contentWidth);
      const transition = TRANSITIONS[clip.transition] || TRANSITIONS.cut;
      const thumb = renderThumbnail(clip.inPoint + Math.min(0.45, clip.duration / 2));
      return `
        <div class="clip-strip" draggable="true" data-index="${clip.index}" data-clip-id="${clip.id}"
          style="left:${left}px;width:${width}px;z-index:${clip.index + 1}">
          ${clip.index > 0 ? `<span class="transition-tag" title="${transition.label}">${transition.short}</span>` : ""}
          <img class="strip-thumb" src="${thumb}" alt="" draggable="false" />
          <div class="strip-copy">
            <strong>0${clip.index + 1} · ${clip.name}</strong>
            <span>${formatClock(clip.inPoint)}–${formatClock(clip.outPoint)} · ${clip.duration.toFixed(1)}s</span>
          </div>
        </div>
      `;
    })
    .join("");

  const captionSegments = sequenceCaptionSegments(sequence);
  dom.captionTrack.innerHTML = captionSegments
    .map((segment) => {
      const left = (segment.start / Math.max(0.001, sequence.total)) * contentWidth;
      const width = Math.max(20, ((segment.end - segment.start) / Math.max(0.001, sequence.total)) * contentWidth);
      return `<span class="caption-clip" data-start="${segment.start}" data-end="${segment.end}"
        style="left:${left}px;width:${width}px" title="${segment.text}">${segment.text}</span>`;
    })
    .join("");
  state.captionElements = $$(".caption-clip", dom.captionTrack);
  dom.timelineInner.style.setProperty("--content-width", `${contentWidth}px`);
  requestAnimationFrame(() => drawWaveform(dom.waveform, sequence, "#ff9b54"));
  updateDurationUI();
  updateLiveUI();
}

function updateDurationUI() {
  const total = state.sequence.total;
  dom.totalDuration.textContent = formatClock(total);
  dom.clipCount.textContent = `${state.clips.length} 段`;
  dom.current.textContent = formatClock(activeClock());
  dom.duration.textContent = formatClock(activeDuration());
  dom.scrubber.max = activeDuration().toFixed(2);
  dom.scrubber.value = activeClock().toFixed(2);
  const overlap = state.sequence.clips.reduce(
    (sum, clip, index) => sum + (index > 0 ? clip.overlap : 0),
    0,
  );
  dom.syncDetail.textContent = `${state.clips.length} cuts · ${overlap.toFixed(1)}s overlap · ${formatClock(total)}`;
  dom.sourceClock.textContent = `${SOURCE_DURATION.toFixed(2)}s`;
}

function paintPreview() {
  if (state.viewMode === "source") {
    renderSourceFrame(dom.preview, dom.previewCanvas.width, dom.previewCanvas.height, state.sourceTime);
  } else {
    renderSequenceFrame(
      dom.preview,
      dom.previewCanvas.width,
      dom.previewCanvas.height,
      state.sequence,
      state.previewTime,
    );
  }
}

function updateLiveUI() {
  const clock = activeClock();
  const duration = activeDuration();
  dom.current.textContent = formatClock(clock);
  dom.scrubber.value = clock.toFixed(2);
  dom.monitorTime.textContent = formatClock(clock, true);

  if (state.viewMode === "edit") {
    const sequence = state.sequence;
    const clip = primaryClipAt(sequence, Math.min(clock, sequence.total - 0.001));
    const sourceTime = clip
      ? clip.inPoint + clamp(clock - clip.start, 0, clip.duration)
      : 0;
    dom.syncDetail.textContent = clip
      ? `EDIT ${String(clip.index + 1).padStart(2, "0")} · SRC ${formatClock(sourceTime)} · ${formatClock(sequence.total)}`
      : `EDIT · ${formatClock(sequence.total)}`;
    const left = state.timelineMetrics.contentWidth
      ? 82 + (clock / Math.max(0.001, sequence.total)) * state.timelineMetrics.contentWidth
      : 82;
    dom.playhead.style.left = `${left}px`;
    dom.playhead.hidden = false;
    for (const element of state.captionElements) {
      const start = Number(element.dataset.start);
      const end = Number(element.dataset.end);
      element.classList.toggle("is-active", clock >= start && clock <= end);
    }
  } else {
    dom.syncDetail.textContent = `SOURCE · ${formatClock(state.sourceTime)} / ${formatClock(SOURCE_DURATION)}`;
    dom.playhead.hidden = true;
    for (const element of state.captionElements) element.classList.remove("is-active");
  }
}

function updateViewUI() {
  const source = state.viewMode === "source";
  dom.viewSource.classList.toggle("is-active", source);
  dom.viewEdit.classList.toggle("is-active", !source);
  dom.monitorLabel.textContent = source ? "SOURCE / GENERATED" : "EDIT / COMPOSITE";
  dom.monitorMode.textContent = source ? "源预览" : "成片预览";
  dom.duration.textContent = formatClock(activeDuration());
  dom.scrubber.max = activeDuration().toFixed(2);
  dom.scrubber.value = activeClock().toFixed(2);
}

function renderAll() {
  renderInspector();
  renderTimeline();
  updateViewUI();
  updateDurationUI();
  updateGateUI();
  paintPreview();
  updateLiveUI();
  dom.resultDrawer.hidden = state.gate !== "pass" || !state.exportUrl;
}

function sourceSequence() {
  return {
    total: SOURCE_DURATION,
    clips: [
      {
        id: "source-all",
        index: 0,
        name: "完整源素材",
        start: 0,
        end: SOURCE_DURATION,
        duration: SOURCE_DURATION,
        overlap: 0,
        transition: "cut",
        inPoint: 0,
        outPoint: SOURCE_DURATION,
      },
    ],
  };
}

function stopPlayback() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.playing = false;
  document.body.classList.remove("is-playing");
  if (state.playbackAudio?.compressor) {
    try {
      state.playbackAudio.compressor.disconnect();
    } catch {
      // The graph may already be disconnected at the end of a loop.
    }
  }
  state.playbackAudio = null;
  dom.bigPlay.setAttribute("aria-label", "播放");
  dom.transportPlay.setAttribute("aria-label", "播放");
}

async function startPlayback(from = activeClock()) {
  stopPlayback();
  if (state.exporting) return;
  const duration = activeDuration();
  let origin = clamp(from, 0, duration);
  if (origin >= duration - 0.025) origin = 0;
  setActiveClock(origin);
  paintPreview();
  updateLiveUI();

  try {
    state.audioContext = await createAudioContext();
  } catch (error) {
    toast(`音频上下文不可用：${error.message}`);
    return;
  }
  if (state.exporting) return;
  const startAt = state.audioContext.currentTime + 0.07;
  state.playbackAudio = scheduleSequenceAudio(
    state.audioContext,
    state.audioContext.destination,
    state.viewMode === "edit" ? state.sequence : sourceSequence(),
    startAt,
    { fromOutput: origin },
  );
  state.playbackOrigin = origin;
  state.playbackStart = startAt;
  state.playbackDuration = duration;
  state.playing = true;
  document.body.classList.add("is-playing");
  dom.bigPlay.setAttribute("aria-label", "暂停");
  dom.transportPlay.setAttribute("aria-label", "暂停");
  state.lastPaint = 0;

  const tick = (timestamp) => {
    if (!state.playing) return;
    const elapsed = Math.max(0, state.audioContext.currentTime - state.playbackStart);
    const position = state.playbackOrigin + elapsed;
    if (position >= state.playbackDuration) {
      setActiveClock(state.playbackDuration);
      paintPreview();
      updateLiveUI();
      const shouldLoop = state.loop;
      stopPlayback();
      if (shouldLoop) {
        setActiveClock(0);
        window.setTimeout(() => startPlayback(0), 40);
      }
      return;
    }
    setActiveClock(position);
    if (timestamp - state.lastPaint > 30) {
      paintPreview();
      updateLiveUI();
      state.lastPaint = timestamp;
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

async function togglePlayback() {
  if (state.playing) {
    stopPlayback();
  } else {
    await startPlayback(activeClock());
  }
}

function switchView(mode) {
  if (state.viewMode === mode) return;
  stopPlayback();
  state.viewMode = mode;
  updateViewUI();
  paintPreview();
  updateLiveUI();
}

function frameLumaStats(imageData) {
  const data = imageData.data;
  let sum = 0;
  let max = 0;
  let darkPixels = 0;
  const pixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const luma = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    sum += luma;
    if (luma > max) max = luma;
    if (luma < 8) darkPixels += 1;
  }
  return { average: sum / pixels, max, darkRatio: darkPixels / pixels };
}

async function runBlackCheck() {
  if (state.gate === "checking" || state.exporting) return false;
  stopPlayback();
  const checkRevision = state.revision;
  state.gate = "checking";
  state.checkResult = null;
  updateGateUI();
  dom.checkDescription.textContent = "逐帧采样成片画面，检测亮度断层…";
  const sequence = structuredClone(state.sequence);
  const checkCanvas = document.createElement("canvas");
  checkCanvas.width = 320;
  checkCanvas.height = 180;
  const ctx = checkCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const fps = 30;
  const samples = Math.max(1, Math.ceil(sequence.total * fps));
  let black = 0;
  let minLuma = Number.POSITIVE_INFINITY;
  let firstBlackTime = null;

  for (let sample = 0; sample < samples; sample += 1) {
    const time = Math.min(sequence.total - 0.001, sample / fps);
    renderSequenceFrame(ctx, checkCanvas.width, checkCanvas.height, sequence, time);
    const stats = frameLumaStats(ctx.getImageData(0, 0, checkCanvas.width, checkCanvas.height));
    minLuma = Math.min(minLuma, stats.average);
    const isBlack = stats.average < 5 || (stats.max < 18 && stats.darkRatio > 0.98);
    if (isBlack) {
      black += 1;
      firstBlackTime ??= time;
    }
    if (sample % 9 === 0) {
      dom.checkValue.textContent = `${Math.round(((sample + 1) / samples) * 100)}%`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (checkRevision !== state.revision) {
    state.gate = "idle";
    state.checkResult = null;
    updateGateUI();
    toast("检查期间剪辑已变更，请重新运行");
    return false;
  }

  state.checkResult = {
    samples,
    black,
    minLuma: Number.isFinite(minLuma) ? minLuma : 0,
    firstBlackTime,
    revision: checkRevision,
    duration: sequence.total,
  };
  state.gate = black === 0 ? "pass" : "fail";
  updateGateUI();
  dom.statSamples.textContent = String(samples);
  dom.statBlack.textContent = String(black);
  dom.statLuma.textContent = state.checkResult.minLuma.toFixed(1);
  if (state.gate === "pass") {
    toast(`黑帧检查通过：${samples} 帧，最低亮度 ${state.checkResult.minLuma.toFixed(1)}`);
  } else {
    dom.checkDescription.textContent = `首次黑帧出现在 ${formatClock(firstBlackTime)}，请调整后重试。`;
    toast("黑帧检查未通过，WebM 导出被阻止");
  }
  return state.gate === "pass";
}

function supportedWebmType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function setExportProgress(value, label) {
  const percent = clamp(value, 0, 1);
  dom.exportProgress.hidden = false;
  dom.exportBar.style.width = `${percent * 100}%`;
  dom.exportLabel.textContent = label || `渲染中 ${Math.round(percent * 100)}%`;
}

async function exportWebM() {
  if (state.gate !== "pass") {
    toast("请先通过黑帧检查");
    return;
  }
  if (state.exporting) return;
  const mimeType = supportedWebmType();
  if (!mimeType) {
    toast("当前浏览器不支持 WebM MediaRecorder");
    return;
  }

  stopPlayback();
  state.exporting = true;
  updateGateUI();
  dom.checkButton.disabled = true;
  dom.resultDrawer.hidden = true;
  setExportProgress(0, "准备 MediaRecorder…");
  const sequence = structuredClone(state.sequence);
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 1280;
  exportCanvas.height = 720;
  const exportContext = exportCanvas.getContext("2d", { alpha: false });
  renderSequenceFrame(exportContext, exportCanvas.width, exportCanvas.height, sequence, 0);

  const audioContext = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
  await audioContext.resume();
  const destination = audioContext.createMediaStreamDestination();
  const startAt = audioContext.currentTime + 0.12;
  scheduleSequenceAudio(audioContext, destination, sequence, startAt);

  const videoStream = exportCanvas.captureStream(30);
  const combined = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const chunks = [];
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 4_500_000,
    audioBitsPerSecond: 128_000,
  });
  let recordingError = null;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener("error", (event) => {
    recordingError = event.error || new Error("MediaRecorder 编码失败");
  });
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  recorder.start(120);
  const recordingStartedWall = performance.now();
  let recordedDurationMs = sequence.total * 1000;

  try {
    await new Promise((resolve, reject) => {
      const paint = () => {
        if (recordingError) {
          reject(recordingError);
          return;
        }
        const elapsed = audioContext.currentTime - startAt;
        const position = clamp(elapsed, 0, sequence.total);
        renderSequenceFrame(exportContext, exportCanvas.width, exportCanvas.height, sequence, position);
        const ratio = position / sequence.total;
        setExportProgress(
          Math.min(0.96, ratio * 0.96),
          `录制 VP9 / Opus · ${formatClock(position)} / ${formatClock(sequence.total)}`,
        );
        if (elapsed >= sequence.total + 0.1) {
          resolve();
          return;
        }
        requestAnimationFrame(paint);
      };
      requestAnimationFrame(paint);
    });
    setExportProgress(0.98, "封装 WebM 容器…");
    recorder.stop();
    await stopped;
    if (recordingError) throw recordingError;
    recordedDurationMs = Math.max(1000, performance.now() - recordingStartedWall);
    const rawBlob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    let blob = rawBlob;
    if (typeof window.ysFixWebmDuration === "function") {
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        blob = await window.ysFixWebmDuration(rawBlob, recordedDurationMs, { logger: false });
      } catch {
        blob = rawBlob;
      }
    }
    if (blob.size < 1024) throw new Error("导出的 WebM 为空");
    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = URL.createObjectURL(blob);
    state.exportInfo = {
      size: blob.size,
      mimeType: blob.type,
      sequenceDuration: sequence.total,
      recordedDuration: recordedDurationMs / 1000,
      clips: sequence.clips.length,
      samples: state.checkResult?.samples,
    };
    dom.resultVideo.src = state.exportUrl;
    dom.download.href = state.exportUrl;
    dom.download.download = "framecut-two-cuts.webm";
    dom.resultDrawer.hidden = false;
    setExportProgress(1, "WebM 已完成");
    await waitForVideoMetadata(dom.resultVideo);
    const actualDuration = Number.isFinite(dom.resultVideo.duration)
      ? dom.resultVideo.duration.toFixed(2)
      : sequence.total.toFixed(2);
    dom.resultMeta.textContent = `${(blob.size / 1024).toFixed(0)} KB · ${blob.type} · ${actualDuration}s · ${sequence.clips.length} 段 · 回放来自实际导出文件`;
    dom.resultMeta.dataset.duration = actualDuration;
    dom.resultVideo.currentTime = 0;
    const playResult = dom.resultVideo.play();
    if (playResult?.catch) {
      playResult.catch(() => toast("导出完成，点击播放按钮回放 WebM"));
    }
    dom.resultDrawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    document.body.dataset.exportReady = "true";
    toast("WebM 导出完成，正在回放实际文件");
  } catch (error) {
    console.error(error);
    toast(`导出失败：${error.message}`);
    setExportProgress(0, "导出失败");
  } finally {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // Ignore recorder shutdown races.
    }
    videoStream.getTracks().forEach((track) => track.stop());
    destination.stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => {});
    state.exporting = false;
    dom.checkButton.disabled = false;
    updateGateUI();
  }
}

function waitForVideoMetadata(video) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("导出文件无法读取元数据")), 5000);
    video.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("导出文件解码失败"));
      },
      { once: true },
    );
  });
}

function replayExport() {
  if (!state.exportUrl) return;
  dom.resultVideo.currentTime = 0;
  dom.resultVideo.play().then(
    () => toast("正在重播导出的 WebM 文件"),
    () => toast("浏览器阻止了自动播放，请点击视频控制栏"),
  );
}

function clearDropTargets() {
  $$(".clip-strip.is-drop-target", dom.clipTrack).forEach((element) =>
    element.classList.remove("is-drop-target"),
  );
}

function clearDropHints() {
  clearDropTargets();
  $$(".clip-strip.is-dragging", dom.clipTrack).forEach((element) =>
    element.classList.remove("is-dragging"),
  );
  state.dragIndex = -1;
}

dom.clipList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-field]");
  if (!input || state.exporting) return;
  onChangeClipField(Number(input.dataset.index), input.dataset.field, input.value);
});

dom.clipList.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  if (!remove || state.exporting) return;
  removeClip(Number(remove.dataset.remove));
});

dom.addClip.addEventListener("click", () => {
  if (!state.exporting) addClip();
});

dom.reset.addEventListener("click", () => {
  if (state.exporting) return;
  stopPlayback();
  state.clips = structuredClone(DEFAULT_CLIPS);
  normalizeAllClips();
  state.previewTime = 0;
  state.sourceTime = 0;
  state.gate = "idle";
  state.checkResult = null;
  state.exportUrl = "";
  state.exportInfo = null;
  state.revision += 1;
  document.body.dataset.exportReady = "false";
  renderAll();
  toast("已恢复三段默认剪辑");
});

dom.viewSource.addEventListener("click", () => switchView("source"));
dom.viewEdit.addEventListener("click", () => switchView("edit"));
dom.bigPlay.addEventListener("click", togglePlayback);
dom.transportPlay.addEventListener("click", togglePlayback);
dom.loop.addEventListener("click", () => {
  state.loop = !state.loop;
  dom.loop.setAttribute("aria-pressed", String(state.loop));
});

dom.scrubber.addEventListener("pointerdown", () => stopPlayback());
dom.scrubber.addEventListener("input", () => {
  stopPlayback();
  setActiveClock(Number(dom.scrubber.value));
  paintPreview();
  updateLiveUI();
});

$("#transport-back").addEventListener("click", () => {
  stopPlayback();
  setActiveClock(activeClock() - 5);
  paintPreview();
  updateLiveUI();
});

$("#transport-forward").addEventListener("click", () => {
  stopPlayback();
  setActiveClock(activeClock() + 5);
  paintPreview();
  updateLiveUI();
});

dom.zoom.addEventListener("input", () => {
  renderTimeline();
  paintPreview();
});

dom.clipTrack.addEventListener("click", (event) => {
  const strip = event.target.closest(".clip-strip");
  if (!strip) return;
  const clip = state.sequence.clips[Number(strip.dataset.index)];
  if (!clip) return;
  stopPlayback();
  state.viewMode = "edit";
  state.previewTime = clip.start;
  updateViewUI();
  paintPreview();
  updateLiveUI();
});

dom.clipTrack.addEventListener("dragstart", (event) => {
  const strip = event.target.closest(".clip-strip");
  if (!strip) return;
  state.dragIndex = Number(strip.dataset.index);
  strip.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(state.dragIndex));
});

dom.clipTrack.addEventListener("dragover", (event) => {
  if (state.dragIndex < 0) return;
  const strip = event.target.closest(".clip-strip");
  if (!strip) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDropTargets();
  strip.classList.add("is-drop-target");
});

dom.clipTrack.addEventListener("dragleave", (event) => {
  const strip = event.target.closest(".clip-strip");
  if (strip) strip.classList.remove("is-drop-target");
});

dom.clipTrack.addEventListener("drop", (event) => {
  const strip = event.target.closest(".clip-strip");
  if (!strip || state.dragIndex < 0) return;
  event.preventDefault();
  const target = Number(strip.dataset.index);
  const from = state.dragIndex;
  clearDropHints();
  reorderClip(from, target);
});

dom.clipTrack.addEventListener("dragend", clearDropHints);

dom.checkButton.addEventListener("click", runBlackCheck);
dom.exportButton.addEventListener("click", exportWebM);
dom.topExport.addEventListener("click", exportWebM);
dom.replay.addEventListener("click", replayExport);

dom.resultVideo.addEventListener("loadedmetadata", () => {
  const duration = Number.isFinite(dom.resultVideo.duration) ? dom.resultVideo.duration : 0;
  dom.resultMeta.dataset.duration = duration.toFixed(2);
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.target.matches("input, select, textarea, button, video")) return;
  event.preventDefault();
  togglePlayback();
});

window.addEventListener("resize", () => {
  clearTimeout(window.__framecutResizeTimer);
  window.__framecutResizeTimer = setTimeout(() => {
    renderTimeline();
    paintPreview();
  }, 120);
});

window.addEventListener("beforeunload", () => {
  if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
});

Object.defineProperty(window, "__FRAMECUT__", {
  value: {
    getState: () => ({
      clips: state.sequence.clips.map((clip) => ({
        id: clip.id,
        name: clip.name,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        start: clip.start,
        end: clip.end,
        transition: clip.transition,
      })),
      totalDuration: state.sequence.total,
      gate: state.gate,
      checkResult: state.checkResult,
      exportInfo: state.exportInfo || null,
      exportReady: Boolean(state.exportUrl),
      exporting: state.exporting,
      viewMode: state.viewMode,
      previewTime: activeClock(),
      captions: sequenceCaptionSegments(state.sequence).map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
        clipId: segment.clipId,
      })),
      syncPoints: state.sequence.clips.map((clip) => {
        const outputTime = clip.start + Math.min(0.8, clip.duration * 0.24);
        return {
          outputTime,
          sourceTime: clip.inPoint + (outputTime - clip.start),
          clipId: clip.id,
          subtitle: cueAtOutputTime(state.sequence, outputTime)?.text || null,
          audioClock: clip.inPoint + (outputTime - clip.start),
        };
      }),
      playback: {
        playing: state.playing,
        currentTime: dom.resultVideo.currentTime,
        resultDuration: dom.resultVideo.duration,
      },
    }),
    replayExport,
  },
  writable: false,
});

await document.fonts.load('600 16px "Framecut Sans"');
await document.fonts.load('400 16px "Framecut Sans"');
await document.fonts.ready;
normalizeAllClips();
renderAll();
document.body.dataset.exportReady = "false";
