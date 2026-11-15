import {
  DEFAULT_PARAMS,
  analyzeRelease,
  clamp,
  computeDetectionEnvelope,
  computeGainEnvelope,
  encodeWav,
  envelopeValueAt,
  measurePeak,
  renderMix
} from "./ducking.js";
import { createDemoTracks } from "./demo.js";
import { currentDetectionDb, EnvelopeView, TimelineView } from "./charts.js";
import { DuckingPlayer } from "./player.js";

const $ = (selector) => document.querySelector(selector);
const refs = {
  play: $("#playButton"),
  restart: $("#restartButton"),
  export: $("#exportButton"),
  currentTime: $("#currentTime"),
  totalTime: $("#totalTime"),
  transportLabel: $("#transportLabel"),
  recomputeLabel: $("#recomputeLabel"),
  meterFill: $("#meterFill"),
  meterPeak: $("#meterPeak"),
  threshold: $("#threshold"),
  thresholdValue: $("#thresholdValue"),
  release: $("#release"),
  releaseValue: $("#releaseValue"),
  attenuation: $("#attenuation"),
  attenuationValue: $("#attenuationValue"),
  segmentStrip: $("#segmentStrip"),
  musicCanvas: $("#musicCanvas"),
  broadcastCanvas: $("#broadcastCanvas"),
  timelineRuler: $("#timelineRuler"),
  timelinePlayhead: $("#timelinePlayhead"),
  timelineWrap: $("#timelineWrap"),
  detectorCanvas: $("#detectorCanvas"),
  gainCanvas: $("#gainCanvas"),
  broadcastReadout: $("#broadcastReadout"),
  gainReadout: $("#gainReadout"),
  releaseA: $("#releaseA"),
  releaseB: $("#releaseB"),
  compareButton: $("#compareButton"),
  compareState: $("#compareState"),
  resultALabel: $("#resultALabel"),
  resultBLabel: $("#resultBLabel"),
  resultAPeak: $("#resultAPeak"),
  resultBPeak: $("#resultBPeak"),
  resultAGain: $("#resultAGain"),
  resultBGain: $("#resultBGain"),
  resultARecovery: $("#resultARecovery"),
  resultBRecovery: $("#resultBRecovery"),
  resultASlew: $("#resultASlew"),
  resultBSlew: $("#resultBSlew"),
  verdictTitle: $("#verdictTitle"),
  verdictCopy: $("#verdictCopy"),
  clipChip: $("#clipChip"),
  toast: $("#toast"),
  loading: $("#loadingScreen")
};

const state = {
  tracks: null,
  params: { ...DEFAULT_PARAMS },
  skippedIds: new Set(),
  detection: null,
  envelope: null,
  comparison: null,
  compareEnvelope: null,
  position: 0,
  recomputes: 0,
  playing: false,
  toastTimer: null,
  animationFrame: null
};

let player;
let timeline;
let detectorView;
let gainView;

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function formatDb(value, digits = 1) {
  if (!Number.isFinite(value) || value <= -90) return "−∞";
  const sign = value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function showToast(message, error = false) {
  clearTimeout(state.toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.toggle("is-error", error);
  refs.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => refs.toast.classList.remove("is-visible"), 3600);
}

function updateParameterLabels() {
  refs.thresholdValue.textContent = `−${Math.abs(state.params.thresholdDb).toFixed(0)} dBFS`;
  refs.releaseValue.textContent = `${state.params.releaseMs.toFixed(0)} ms`;
  refs.attenuationValue.textContent = `−${state.params.maxAttenuationDb.toFixed(0)} dB`;
}

function buildSegmentStrip() {
  refs.segmentStrip.innerHTML = state.tracks.segments.map((segment, index) => {
    const skipped = state.skippedIds.has(segment.id);
    return `
      <div class="segment-chip${skipped ? " is-skipped" : ""}" data-segment="${segment.id}">
        <span class="segment-chip-index">0${index + 1}</span>
        <span class="segment-chip-copy">
          <strong>${segment.title}</strong>
          <small>${formatTime(segment.start)} — ${formatTime(segment.end)}</small>
        </span>
        <button class="skip-toggle" type="button" aria-pressed="${skipped}">
          ${skipped ? "恢复" : "跳过"}
        </button>
      </div>`;
  }).join("");

  refs.segmentStrip.querySelectorAll(".skip-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const chip = button.closest(".segment-chip");
      toggleSegment(chip.dataset.segment);
    });
  });
}

function toggleSegment(id) {
  if (state.skippedIds.has(id)) state.skippedIds.delete(id);
  else state.skippedIds.add(id);
  state.recomputes += 1;
  buildSegmentStrip();
  recalculateEnvelope();
  showToast(state.skippedIds.has(id) ? "广播区段已跳过，音乐包络已重算。" : "广播区段已恢复，音乐包络已重算。");
}

function invalidateComparison(message = "参数或区段已变，请重新实测") {
  state.comparison = null;
  state.compareEnvelope = null;
  refs.compareState.textContent = message;
  refs.verdictTitle.textContent = "等待实测";
  refs.verdictCopy.textContent = "运行后会比较峰值、削波样本与增益变化速度。";
  refs.clipChip.textContent = "未检查削波";
  refs.clipChip.className = "clip-chip";
  for (const key of ["APeak", "BPeak", "AGain", "BGain", "ARecovery", "BRecovery", "ASlew", "BSlew"]) {
    refs[`result${key}`].textContent = "—";
  }
}

function recalculateEnvelope() {
  const skippedIds = state.skippedIds;
  state.detection = computeDetectionEnvelope({
    broadcast: state.tracks.broadcast,
    sampleRate: state.tracks.sampleRate,
    segments: state.tracks.segments,
    skippedIds
  });
  state.envelope = computeGainEnvelope(state.detection, state.params);
  refs.recomputeLabel.textContent = `包络重算 #${state.recomputes} · 跳过 ${skippedIds.size} 段`;
  invalidateComparison();
  player?.reschedule(state.envelope, skippedIds);
  renderVisuals(state.position);
}

function renderVisuals(time) {
  if (!state.envelope) return;
  state.position = time;
  refs.currentTime.textContent = formatTime(time);
  timeline.draw(time, state.skippedIds);
  const common = { envelope: state.envelope, time };
  detectorView.update(common);
  gainView.update({ ...common, compareEnvelope: state.compareEnvelope });
  const detectionDb = currentDetectionDb(state.envelope, time);
  const gainDb = envelopeValueAt(state.envelope, time);
  refs.broadcastReadout.textContent = `${formatDb(detectionDb)} dBFS`;
  refs.gainReadout.textContent = `${formatDb(gainDb)} dB`;
}

function updateTransport() {
  refs.play.classList.toggle("is-playing", state.playing);
  refs.play.setAttribute("aria-label", state.playing ? "暂停" : "播放");
  refs.transportLabel.textContent = state.playing ? "正在播放" : "已暂停";
}

function animationLoop() {
  if (!state.playing || !player) return;
  const position = player.getPosition();
  renderVisuals(position);
  const meterPeak = player.getMeterPeak();
  const meterDb = meterPeak > 0 ? 20 * Math.log10(meterPeak) : -90;
  refs.meterFill.style.width = `${clamp((meterDb + 60) / 60, 0, 1) * 100}%`;
  refs.meterPeak.textContent = meterPeak > 0 ? `${formatDb(meterDb)} dB` : "—";
  state.animationFrame = requestAnimationFrame(animationLoop);
}

async function togglePlayback() {
  if (!state.envelope) return;
  try {
    if (state.playing) {
      await player.pause();
      state.playing = false;
      state.position = player.getPosition();
      cancelAnimationFrame(state.animationFrame);
      renderVisuals(state.position);
      updateTransport();
      return;
    }
    state.recomputes += 1;
    refs.recomputeLabel.textContent = `包络重算 #${state.recomputes} · 从 ${formatTime(state.position)} 继续`;
    await player.play(state.envelope, state.skippedIds);
    state.playing = true;
    updateTransport();
    cancelAnimationFrame(state.animationFrame);
    animationLoop();
  } catch (error) {
    showToast(`音频启动失败：${error.message}`, true);
  }
}

async function seekTo(position) {
  if (!player) return;
  await player.seek(clamp(position, 0, state.tracks.duration));
  state.position = clamp(position, 0, state.tracks.duration);
  renderVisuals(state.position);
  if (state.playing) {
    cancelAnimationFrame(state.animationFrame);
    animationLoop();
  }
}

function bindControls() {
  const bindRange = (element, key) => {
    element.addEventListener("input", () => {
      state.params[key] = Number(element.value);
      updateParameterLabels();
      state.recomputes += 1;
      recalculateEnvelope();
    });
  };

  bindRange(refs.threshold, "thresholdDb");
  bindRange(refs.release, "releaseMs");
  bindRange(refs.attenuation, "maxAttenuationDb");

  refs.play.addEventListener("click", togglePlayback);
  refs.restart.addEventListener("click", async () => {
    if (!player) return;
    state.position = 0;
    if (state.playing) {
      await player.restart(state.envelope, state.skippedIds);
      cancelAnimationFrame(state.animationFrame);
      animationLoop();
    } else {
      await player.seek(0);
    }
    renderVisuals(0);
  });
  refs.export.addEventListener("click", exportWav);
  refs.compareButton.addEventListener("click", runComparison);
}

function updateResult(letter, result) {
  const { peak, gain } = result;
  refs[`result${letter}Peak`].textContent = `${formatDb(peak.peakDb, 2)} dBFS`;
  refs[`result${letter}Gain`].textContent = `${formatDb(gain.minimumGainDb, 1)} dB`;
  refs[`result${letter}Recovery`].textContent = `${Math.round(gain.recoveryMs)} ms`;
  refs[`result${letter}Slew`].textContent = `${Math.round(gain.maximumRecoverySlewDbPerSecond)} dB/s`;
}

async function runComparison() {
  if (!state.tracks || !state.detection) return;
  const releaseA = clamp(Number(refs.releaseA.value) || 150, 60, 2000);
  const releaseB = clamp(Number(refs.releaseB.value) || 650, 60, 2000);
  refs.releaseA.value = releaseA;
  refs.releaseB.value = releaseB;
  refs.resultALabel.textContent = `${releaseA} ms 释放`;
  refs.resultBLabel.textContent = `${releaseB} ms 释放`;
  refs.compareButton.disabled = true;
  refs.compareState.textContent = "完整渲染中…";

  await new Promise((resolve) => setTimeout(resolve, 35));
  try {
    const common = {
      tracks: state.tracks,
      detection: state.detection,
      params: state.params,
      skippedIds: state.skippedIds
    };
    const resultA = analyzeRelease({ ...common, releaseMs: releaseA });
    const resultB = analyzeRelease({ ...common, releaseMs: releaseB });
    state.comparison = { resultA, resultB };
    state.compareEnvelope = resultB.envelope;
    updateResult("A", resultA);
    updateResult("B", resultB);
    updateComparisonVerdict(resultA, resultB);
    refs.compareState.textContent = `已检查 ${Math.round(state.tracks.duration)} s 混音`;
    gainView.update({
      envelope: state.envelope,
      time: state.position,
      compareEnvelope: state.compareEnvelope
    });
  } catch (error) {
    refs.compareState.textContent = "渲染失败";
    showToast(`A/B 渲染失败：${error.message}`, true);
  } finally {
    refs.compareButton.disabled = false;
  }
}

function updateComparisonVerdict(resultA, resultB) {
  const clipping = resultA.peak.clipping || resultB.peak.clipping;
  const peak = Math.max(resultA.peak.peakDb, resultB.peak.peakDb);
  const headroom = -peak;
  const faster = resultA.gain.recoveryMs <= resultB.gain.recoveryMs ? resultA : resultB;
  const slower = faster === resultA ? resultB : resultA;
  const slewReduction = slower.gain.maximumRecoverySlewDbPerSecond > 0
    ? (1 - slower.gain.maximumRecoverySlewDbPerSecond / faster.gain.maximumRecoverySlewDbPerSecond) * 100
    : 0;

  refs.clipChip.classList.toggle("is-safe", !clipping);
  refs.clipChip.classList.toggle("is-clipping", clipping);
  if (clipping) {
    refs.verdictTitle.textContent = "检测到削波";
    refs.verdictCopy.textContent = `峰值 ${formatDb(peak, 2)} dBFS，存在 ${resultA.peak.clippedSamples + resultB.peak.clippedSamples} 个削波样本，请降低素材电平。`;
    refs.clipChip.textContent = "需要降低电平";
    return;
  }

  refs.verdictTitle.textContent = "两版均无削波";
  refs.verdictCopy.textContent = `${slower.releaseMs} ms 版恢复斜率低 ${Math.max(0, slewReduction).toFixed(0)}%，泵感风险更低；${faster.releaseMs} ms 版更快恢复。`;
  refs.clipChip.textContent = `${headroom.toFixed(1)} dB 峰值余量 · 0 削波`;
}

async function exportWav() {
  if (!state.envelope) return;
  refs.export.disabled = true;
  const original = refs.export.innerHTML;
  refs.export.textContent = "正在渲染…";
  await new Promise((resolve) => setTimeout(resolve, 35));
  try {
    const mix = renderMix({
      tracks: state.tracks,
      envelope: state.envelope,
      skippedIds: state.skippedIds
    });
    const peak = measurePeak(mix);
    const bytes = encodeWav(mix, state.tracks.sampleRate);
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `duck-mix_${state.params.releaseMs.toFixed(0)}ms_${state.skippedIds.size}skip.wav`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    refs.meterFill.style.width = `${clamp((peak.peakDb + 60) / 60, 0, 1) * 100}%`;
    refs.meterPeak.textContent = `${formatDb(peak.peakDb, 1)} dB`;
    showToast(
      peak.clipping
        ? `WAV 已导出，但峰值 ${formatDb(peak.peakDb, 2)} dBFS 发生削波。`
        : `WAV 已导出 · 峰值 ${formatDb(peak.peakDb, 2)} dBFS · 无削波。`,
      peak.clipping
    );
  } catch (error) {
    showToast(`导出失败：${error.message}`, true);
  } finally {
    refs.export.disabled = false;
    refs.export.innerHTML = original;
  }
}

function handlePlaybackEnd() {
  state.playing = false;
  state.position = state.tracks.duration;
  cancelAnimationFrame(state.animationFrame);
  updateTransport();
  renderVisuals(state.position);
}

async function init() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    state.tracks = createDemoTracks();
    state.recomputes = 1;
    refs.totalTime.textContent = formatTime(state.tracks.duration);
    updateParameterLabels();
    buildSegmentStrip();

    timeline = new TimelineView({
      musicCanvas: refs.musicCanvas,
      broadcastCanvas: refs.broadcastCanvas,
      ruler: refs.timelineRuler,
      playhead: refs.timelinePlayhead,
      timelineWrap: refs.timelineWrap,
      tracks: state.tracks,
      onSeek: seekTo
    });
    detectorView = new EnvelopeView(refs.detectorCanvas, "detector");
    gainView = new EnvelopeView(refs.gainCanvas, "gain");
    player = new DuckingPlayer(state.tracks, { onEnd: handlePlaybackEnd });
    bindControls();
    recalculateEnvelope();
    updateTransport();
    refs.loading.classList.add("is-hidden");
  } catch (error) {
    refs.loading.querySelector("p").textContent = "示例音轨生成失败";
    refs.loading.querySelector("small").textContent = error.message;
    console.error(error);
  }
}

init();
