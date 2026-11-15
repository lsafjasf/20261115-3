'use strict';

const C = window.SyncCore;

const project = C.createProject({
  flashTimes: C.FLASH_TIMES,
  beatTimes: C.BEAT_TIMES,
});

const fps = project.timeline.fps;
const duration = project.timeline.durationSeconds;
const totalFrames = fps * duration;

// The single clock every control reads from.
const clock = new C.TransportClock({ fps, durationSeconds: duration });

const el = (id) => document.getElementById(id);
const fmtTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
};
const pct = (time) => `${(time / duration) * 100}%`;

// ---- Audio scheduling (optional; silent core remains fully functional) ----
let audioContext = null;
let activeVoices = [];
let nextBeatIndex = 0;

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function stopVoices() {
  for (const voice of activeVoices) {
    try { voice.stop(); } catch { /* already stopped */ }
  }
  activeVoices = [];
}

function resetScheduler() {
  stopVoices();
  nextBeatIndex = 0;
}

function scheduleBeat(audio, startAudioTime) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = C.BEAT_FREQ_HZ;
  gain.gain.setValueAtTime(0.0001, startAudioTime);
  gain.gain.exponentialRampToValueAtTime(0.8, startAudioTime + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAudioTime + C.BEAT_DURATION_S);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAudioTime);
  osc.stop(startAudioTime + C.BEAT_DURATION_S + 0.02);
  activeVoices.push(osc);
}

function pumpScheduler() {
  if (!clock.playing || !audioContext) return;
  const offsetSec = project.offset.ms / 1000;
  const horizon = 0.2;
  while (nextBeatIndex < project.events.beatTimes.length) {
    const timelineBeat = project.events.beatTimes[nextBeatIndex] + offsetSec;
    const untilBeat = timelineBeat - clock.position;
    if (untilBeat > horizon) break;
    if (untilBeat >= -0.05) {
      const audioTime = audioContext.currentTime + Math.max(0, untilBeat);
      scheduleBeat(audioContext, audioTime);
    }
    nextBeatIndex += 1;
  }
}

// ---- Rendering ----
function buildMarkers() {
  const flashLane = el('flash-lane');
  const beatLane = el('beat-lane');
  flashLane.innerHTML = '';
  beatLane.innerHTML = '';
  project.events.flashTimes.forEach((time) => {
    const node = document.createElement('div');
    node.className = 'marker flash';
    node.style.left = pct(time);
    flashLane.appendChild(node);
  });
  project.events.beatTimes.forEach((time) => {
    const node = document.createElement('div');
    node.className = 'marker beat';
    node.dataset.raw = time;
    beatLane.appendChild(node);
  });
}

function renderBeatMarkers() {
  const offsetSec = project.offset.ms / 1000;
  el('beat-lane').querySelectorAll('.marker.beat').forEach((node, index) => {
    node.style.left = pct(Number(node.dataset.raw) + offsetSec);
  });
}

function lampStateAt(time) {
  return project.events.flashTimes.some(
    (flashTime) => Math.abs(time - flashTime) <= 1 / fps
  );
}

function renderClock() {
  const position = clock.position;
  el('readout-time').textContent = fmtTime(position);
  el('readout-frame').textContent = `帧 ${clock.frame}`;
  el('playhead').value = clock.frame;
  el('playhead-line').style.left = `calc(58px + ${pct(position)})`;
  el('flash-lamp').classList.toggle('on', lampStateAt(position));
  pumpScheduler();
  requestAnimationFrame(renderClock);
}

function renderEvaluation() {
  const result = C.evaluateAll(project);
  const tbody = el('event-rows');
  tbody.innerHTML = '';
  result.perEvent.forEach((event, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${event.flashTime.toFixed(4)}</td>
      <td>${event.alignedBeatTime.toFixed(4)}</td>
      <td class="${event.pass ? 'pass' : 'fail'}">${event.errorMs.toFixed(2)}</td>
      <td class="${event.pass ? 'pass' : 'fail'}">${event.errorFrames.toFixed(3)}</td>
      <td class="${event.pass ? 'pass' : 'fail'}">${event.pass ? '通过' : '超差'}</td>`;
    tbody.appendChild(row);
  });
  el('sum-pass').textContent = `${result.withinCount} / ${result.total}`;
  el('sum-max').textContent = `${result.maxAbsErrorFrames.toFixed(3)} 帧`;
  const verdict = el('sum-verdict');
  verdict.textContent = result.allWithinTolerance ? '全部在容差内' : '存在超差事件';
  verdict.className = result.allWithinTolerance ? 'pass' : 'fail';
}

function renderOffset() {
  el('offset-frames').textContent = `${project.offset.frameShift} 帧`;
  el('offset-ms').textContent = `${project.offset.ms.toFixed(2)} ms`;
  el('offset-source').textContent =
    project.offset.source === 'auto' ? '自动' : '手动';
  el('marker-drag').value = project.offset.frameShift;
  renderBeatMarkers();
  renderEvaluation();
}

function download(filename, data, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Browser-side export runs the same synthesis/shift/onset pipeline as
// the Node CLI, then verifies the rendered bytes before downloading.
function exportAlignedWav() {
  const sampleRate = 48000;
  const source = C.synthesizeBeatTrack(
    project.events.beatTimes, sampleRate, duration
  );
  const shift = Math.round((project.offset.ms / 1000) * sampleRate);
  const aligned = C.shiftSamples(source, shift);
  const bytes = C.writeWav(aligned, sampleRate);
  const { samples } = C.readWav(bytes);
  const onsets = C.detectOnsets(samples, sampleRate);
  const maxError = project.events.flashTimes.reduce((max, flashTime) => {
    const nearest = onsets.reduce((best, onset) =>
      Math.abs(onset - flashTime) < Math.abs(best - flashTime) ? onset : best
    );
    return Math.max(max, Math.abs(C.timeToFrame(nearest - flashTime, fps)));
  }, 0);
  el('verification-note').textContent =
    `导出前浏览器内验证：检出 ${onsets.length} 个起振，最大误差 ${maxError.toFixed(3)} 帧（容差 2 帧），样本偏移 ${shift}。`;
  download('beat_track_aligned.wav', bytes, 'audio/wav');
}

// ---- Wiring: every transport action goes through the one clock ----
el('btn-play').addEventListener('click', () => {
  ensureAudio();
  resetScheduler();
  clock.play();
});
el('btn-pause').addEventListener('click', () => {
  clock.pause();
  resetScheduler();
});
el('btn-stop').addEventListener('click', () => {
  clock.stop();
  resetScheduler();
});
el('btn-prev-frame').addEventListener('click', () => {
  resetScheduler();
  clock.stepFrames(-1);
});
el('btn-next-frame').addEventListener('click', () => {
  resetScheduler();
  clock.stepFrames(1);
});
el('playhead').addEventListener('input', (event) => {
  resetScheduler();
  clock.seekToFrame(Number(event.target.value));
});

// Marker drag shifts the whole audio track, quantized to frames.
el('marker-drag').addEventListener('input', (event) => {
  const frameShift = Number(event.target.value);
  project.offset = {
    ms: C.frameShiftToSeconds(frameShift, fps) * 1000,
    frameShift,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  };
  renderOffset();
});

el('btn-auto').addEventListener('click', () => {
  C.calibrate(project, 'auto');
  renderOffset();
});
el('btn-reset').addEventListener('click', () => {
  project.offset = {
    ms: 0, frameShift: 0, source: 'manual',
    updatedAt: new Date().toISOString(),
  };
  renderOffset();
});
el('btn-export-wav').addEventListener('click', exportAlignedWav);

el('btn-save').addEventListener('click', () => {
  download('sync_project.json',
    JSON.stringify(project, null, 2), 'application/json');
});
el('btn-load').addEventListener('click', () => el('file-load').click());
el('file-load').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    const loaded = JSON.parse(text);
    Object.assign(project, loaded);
    renderOffset();
  });
});

el('meta-fps').textContent = `${fps} fps`;
el('meta-duration').textContent = `时长 ${duration} s`;
el('meta-tolerance').textContent =
  `容差 ${project.timeline.toleranceFrames} 帧 (${C.toleranceMs(fps).toFixed(2)} ms)`;

buildMarkers();
renderOffset();
requestAnimationFrame(renderClock);
