import { AudioEngine } from "./audio-engine.js";
import { createDemoProject } from "./demo-project.js";
import {
  STEP_COUNT,
  TRACK_COUNT,
  clamp,
  cloneProject,
  makeExportProject,
  midiToName,
  normalizeProject,
} from "./project.js";
import { renderProjectToStereo } from "./synth.js";
import { wavBlob } from "./wav.js";

const STORAGE_KEY = "eight-sequencer-project-v1";
const NOTE_MIN = 24;
const NOTE_MAX = 96;
const WAVE_LABELS = {
  sine: "SINE",
  triangle: "TRI",
  sawtooth: "SAW",
  square: "SQR",
  noise: "NOISE",
};

let project = loadInitialProject();
let selectedTrack = 0;
let selectedStep = 0;
let history = [];
let redoStack = [];
let toastTimer = 0;
let saveTimer = 0;
let liveEditSnapshot = null;
let lastPlayheadStep = -1;

const $ = (selector) => document.querySelector(selector);
const grid = $("#sequencerGrid");
const inspector = $(".inspector");
const stepNoteSelect = $("#stepNoteSelect");
const copyDialog = $("#copyDialog");
const exportDialog = $("#exportDialog");
const clearDialog = $("#clearDialog");

const engine = new AudioEngine(() => project, {
  onState: (state) => {
    renderTransportState(state);
    updatePlayhead();
  },
});

function loadInitialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeProject(JSON.parse(saved));
  } catch {
    // Invalid local data falls back to the bundled performance pattern.
  }
  return normalizeProject(createDemoProject());
}

function selectedTrackData() {
  return project.tracks[selectedTrack];
}

function selectedStepData() {
  return selectedTrackData().steps[selectedStep];
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function setProject(nextProject) {
  project = nextProject;
  selectedTrack = clamp(selectedTrack, 0, TRACK_COUNT - 1);
  selectedStep = clamp(selectedStep, 0, STEP_COUNT - 1);
  engine.invalidateVoices();
  engine.setBpm(project.bpm);
  engine.setLoop(project.loop);
  renderAll();
  scheduleSave();
}

function snapshot() {
  history.push(cloneProject(project));
  if (history.length > 40) history.shift();
  redoStack = [];
}

function applyChange(mutator, record = true) {
  if (record) snapshot();
  mutator(project);
  engine.invalidateVoices();
  renderAll();
  scheduleSave();
}

function applyLiveChange(mutator) {
  if (!liveEditSnapshot) {
    history.push(cloneProject(project));
    if (history.length > 40) history.shift();
    redoStack = [];
    liveEditSnapshot = true;
  }
  mutator(project);
  engine.invalidateVoices();
  scheduleSave();
}

function finishLiveEdit() {
  liveEditSnapshot = null;
}

function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("is-error", isError);
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 2600);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFilename(value, suffix) {
  const base =
    String(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "") || "eight-pattern";
  return `${base}${suffix}`;
}

function renderAll() {
  renderProjectMeta();
  renderGrid();
  renderInspector();
  renderTransportState(engine.state);
  updatePlayhead(true);
}

function renderProjectMeta() {
  const nameInput = $("#projectName");
  if (document.activeElement !== nameInput) nameInput.value = project.name;
  $("#tempoInput").value = project.bpm;
  $("#loopButton").setAttribute("aria-pressed", String(project.loop));
  document.querySelectorAll("#resumeSegment button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === project.resumeMode);
  });
  $("#exportProjectName").textContent = project.name;
  $("#undoButton").disabled = history.length === 0;
  $("#redoButton").disabled = redoStack.length === 0;
}

function renderGrid() {
  const fragment = document.createDocumentFragment();
  const header = document.createElement("div");
  header.className = "step-headers";
  const ruler = document.createElement("div");
  ruler.className = "beats-ruler";
  ruler.innerHTML = "<i></i><span>1 BAR · 4/4</span>";
  header.append(ruler);
  for (let step = 0; step < STEP_COUNT; step += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "step-number";
    button.dataset.step = String(step);
    button.textContent = pad(step + 1);
    button.setAttribute("aria-label", `选择第 ${step + 1} 步`);
    if (step % 4 === 0) button.classList.add("is-beat");
    if (step === selectedStep) button.classList.add("is-selected");
    header.append(button);
  }
  fragment.append(header);

  project.tracks.forEach((track, trackIndex) => {
    const row = document.createElement("div");
    row.className = "track-row";
    row.dataset.track = String(trackIndex);
    row.style.setProperty("--track-color", track.color);
    if (trackIndex === selectedTrack) row.classList.add("is-selected");
    if (track.mute) row.classList.add("is-muted");

    const label = document.createElement("div");
    label.className = "track-label";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "track-select";
    select.dataset.track = String(trackIndex);
    select.innerHTML = `
      <span class="track-index">${pad(trackIndex + 1)}</span>
      <span class="track-copy">${escapeHtml(track.name)}</span>
    `;
    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "track-mute";
    mute.dataset.track = String(trackIndex);
    mute.setAttribute("aria-label", track.mute ? "取消静音" : "静音");
    mute.innerHTML = track.mute
      ? '<svg viewBox="0 0 24 24"><path d="m5 5 14 14"></path><path d="M9 9v6h3l4 3V8l-4 3H9Z"></path></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9 9v6h3l4 3V8l-4 3H9Z"></path><path d="M5 10v4h4"></path></svg>';
    label.append(select, mute);
    row.append(label);

    track.steps.forEach((step, stepIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "step-cell";
      button.dataset.track = String(trackIndex);
      button.dataset.step = String(stepIndex);
      button.setAttribute("aria-pressed", String(step.on));
      const soundingNote = clamp(step.note + track.synth.transpose, 0, 127);
      button.setAttribute(
        "aria-label",
        `轨道 ${trackIndex + 1}，第 ${stepIndex + 1} 步，${midiToName(soundingNote)}，延音 ${step.sustain} 步${step.on ? "" : "，关闭"}`,
      );
      if (step.on) button.classList.add("is-on");
      if (stepIndex % 4 === 0) button.classList.add("is-beat");
      if (trackIndex === selectedTrack && stepIndex === selectedStep) {
        button.classList.add("is-selected");
      }
      const gateBars = Array.from(
        { length: 4 },
        (_, index) => `<i class="${index < step.sustain ? "is-filled" : ""}"></i>`,
      ).join("");
      button.innerHTML = `
        <span class="step-note">${midiToName(soundingNote)}</span>
        <span class="gate-bars">${gateBars}</span>
        ${step.on ? '<span class="step-remove" role="button" aria-label="关闭此步">×</span>' : ""}
      `;
      row.append(button);
    });
    fragment.append(row);
  });
  grid.replaceChildren(fragment);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SLIDER_DEFS = {
  cutoff: {
    min: 60,
    max: 16000,
    log: true,
    format: (value) =>
      value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`,
  },
  resonance: {
    min: 0.4,
    max: 20,
    format: (value) => value.toFixed(1),
  },
  filterEnv: {
    min: 0,
    max: 10000,
    format: (value) =>
      value >= 1000 ? `${(value / 1000).toFixed(1)}k Hz` : `${Math.round(value)} Hz`,
  },
  detune: {
    min: -50,
    max: 50,
    format: (value) => `${value > 0 ? "+" : ""}${Math.round(value)} ct`,
  },
  attack: {
    min: 0.001,
    max: 2,
    log: true,
    format: (value) => `${Math.round(value * 1000)} ms`,
  },
  decay: {
    min: 0.01,
    max: 3,
    log: true,
    format: (value) => `${Math.round(value * 1000)} ms`,
  },
  sustain: {
    min: 0,
    max: 1,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  release: {
    min: 0.01,
    max: 4,
    log: true,
    format: (value) =>
      value >= 1 ? `${value.toFixed(2)} s` : `${Math.round(value * 1000)} ms`,
  },
  volume: {
    min: 0,
    max: 1,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  pan: {
    min: -1,
    max: 1,
    format: (value) => {
      if (Math.abs(value) < 0.01) return "C";
      return `${value < 0 ? "L" : "R"}${Math.round(Math.abs(value) * 100)}`;
    },
  },
};

function sliderPosition(key, value) {
  const def = SLIDER_DEFS[key];
  if (def.log) {
    return (
      (Math.log(Math.max(def.min, value) / def.min) /
        Math.log(def.max / def.min)) *
      1000
    );
  }
  return ((value - def.min) / (def.max - def.min)) * 1000;
}

function sliderValue(key, position) {
  const def = SLIDER_DEFS[key];
  const normalized = clamp(position / 1000, 0, 1);
  if (def.log) return def.min * Math.pow(def.max / def.min, normalized);
  return def.min + (def.max - def.min) * normalized;
}

function renderInspector() {
  const track = selectedTrackData();
  const step = selectedStepData();
  inspector.style.setProperty("--track-color", track.color);
  $("#inspectorNumber").textContent = pad(selectedTrack + 1);
  $("#trackNameInput").value = track.name;
  const muteButton = $("#muteButton");
  muteButton.setAttribute("aria-pressed", String(track.mute));
  muteButton.classList.toggle("is-on", !track.mute);

  renderStepEditor();
  $("#waveformTag").textContent = WAVE_LABELS[track.synth.waveform];
  document.querySelectorAll("#waveformPicker button").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.waveform === track.synth.waveform,
    );
  });
  Object.keys(SLIDER_DEFS).forEach((key) => {
    const input = document.querySelector(
      `#synthControls [data-control="${key}"] input`,
    );
    const output = input.closest(".slider-control").querySelector("output");
    const position = sliderPosition(key, track.synth[key]);
    input.value = String(position);
    input.style.setProperty("--range-fill", `${position / 10}%`);
    output.textContent = SLIDER_DEFS[key].format(track.synth[key]);
  });
  $("#transposeSelect").value = String(track.synth.transpose);

  const activeSteps = track.steps.filter((item) => item.on).length;
  const sustainSteps = track.steps.filter((item) => item.on && item.sustain > 1).length;
  $("#activeStepCount").textContent = String(activeSteps);
  $("#sustainStepCount").textContent = String(sustainSteps);
  $("#trackMeter").style.width = `${(activeSteps / STEP_COUNT) * 100}%`;
}

function renderStepEditor() {
  const track = selectedTrackData();
  const step = selectedStepData();
  $("#selectedStepNumber").textContent = pad(selectedStep + 1);
  const powerButton = $("#stepPowerButton");
  powerButton.setAttribute("aria-pressed", String(step.on));
  powerButton.querySelector("span").textContent = step.on ? "ON" : "OFF";
  populateNoteSelect(step.note);
  document.querySelectorAll("#sustainPicker button").forEach((button) => {
    button.classList.toggle(
      "is-active",
      Number(button.dataset.sustain) === step.sustain,
    );
  });
  const soundingNote = clamp(step.note + track.synth.transpose, 0, 127);
  $("#stepPreviewNote").textContent = midiToName(soundingNote);
  const seconds = step.sustain * (60 / project.bpm / 4);
  $("#stepPreviewText").textContent =
    `${step.on ? "发声" : "静音"} · ${step.sustain} 步 · ${seconds.toFixed(3)} 秒`;
}

function populateNoteSelect(currentNote) {
  const selected = Number(currentNote);
  if (stepNoteSelect.dataset.rendered === "true") {
    stepNoteSelect.value = String(selected);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let octave = 1; octave <= 7; octave += 1) {
    const group = document.createElement("optgroup");
    group.label = `八度 ${octave}`;
    for (let semitone = 0; semitone < 12; semitone += 1) {
      const note = (octave + 1) * 12 + semitone;
      if (note < NOTE_MIN || note > NOTE_MAX) continue;
      const option = document.createElement("option");
      option.value = String(note);
      option.textContent = `${midiToName(note)} · ${note}`;
      group.append(option);
    }
    if (group.children.length) fragment.append(group);
  }
  stepNoteSelect.replaceChildren(fragment);
  stepNoteSelect.dataset.rendered = "true";
  stepNoteSelect.value = String(selected);
}

function selectTrack(index) {
  selectedTrack = clamp(index, 0, TRACK_COUNT - 1);
  renderGrid();
  renderInspector();
  updatePlayhead(true);
}

function selectStep(index) {
  selectedStep = clamp(index, 0, STEP_COUNT - 1);
  renderGrid();
  renderStepEditor();
  updatePlayhead(true);
}

function toggleStep(trackIndex, stepIndex, forceValue) {
  snapshot();
  selectedTrack = trackIndex;
  selectedStep = stepIndex;
  const step = project.tracks[trackIndex].steps[stepIndex];
  step.on = forceValue === undefined ? !step.on : Boolean(forceValue);
  engine.invalidateVoices();
  renderAll();
  scheduleSave();
}

function renderTransportState(state) {
  const playing = state === "playing";
  const paused = state === "paused";
  const playButton = $("#playButton");
  playButton.classList.toggle("is-playing", playing);
  $("#playLabel").textContent = playing ? "暂停" : "播放";
  playButton.setAttribute("aria-label", playing ? "暂停" : "播放");
  $("#transportState").textContent = playing
    ? "播放中"
    : paused
      ? "已暂停"
      : "已停止";
  $("#readoutDot").className =
    `readout-dot${playing ? " is-playing" : paused ? " is-paused" : ""}`;
}

function updatePlayhead(force = false) {
  const position = engine.getPosition();
  const currentStep = clamp(Math.floor(position), 0, STEP_COUNT - 1);
  $("#timelineFill").style.width = `${(position / STEP_COUNT) * 100}%`;
  $("#positionReadout").innerHTML = `${pad(currentStep + 1)}<span>/${STEP_COUNT}</span>`;
  if (!force && currentStep === lastPlayheadStep) return;
  lastPlayheadStep = currentStep;
  grid.querySelectorAll(".is-current").forEach((node) => {
    node.classList.remove("is-current");
  });
  grid.querySelectorAll(`[data-step="${currentStep}"]`).forEach((node) => {
    node.classList.add("is-current");
  });
}

function animationLoop() {
  updatePlayhead();
  requestAnimationFrame(animationLoop);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  $("#saveStatus").textContent = "正在自动保存…";
  $("#saveStatus").classList.add("is-saving");
  saveTimer = window.setTimeout(saveLocalProject, 320);
}

function saveLocalProject() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeExportProject(project)));
    $("#saveStatus").textContent = "已自动保存";
    $("#saveStatus").classList.remove("is-saving", "is-error");
    renderProjectMeta();
  } catch {
    $("#saveStatus").textContent = "本地保存不可用";
    $("#saveStatus").classList.add("is-error");
  }
}

function saveJsonFile() {
  const data = makeExportProject(project);
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, safeFilename(project.name, ".json"));
  saveLocalProject();
  toast("工程 JSON 已保存");
}

async function importJsonFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const nextProject = normalizeProject(parsed);
    engine.stop();
    snapshot();
    selectedTrack = 0;
    selectedStep = 0;
    setProject(nextProject);
    toast(`已导入「${project.name}」`);
  } catch (error) {
    toast(`导入失败：${error.message || "JSON 格式无效"}`, true);
  } finally {
    $("#fileInput").value = "";
  }
}

function undo() {
  if (!history.length) return;
  engine.stop();
  redoStack.push(cloneProject(project));
  setProject(history.pop());
  toast("已撤销");
}

function redo() {
  if (!redoStack.length) return;
  engine.stop();
  history.push(cloneProject(project));
  setProject(redoStack.pop());
  toast("已重做");
}

function populateCopySelects() {
  const source = $("#copySource");
  const length = $("#copyLength");
  const destination = $("#copyDestination");
  source.innerHTML = Array.from(
    { length: STEP_COUNT },
    (_, index) => `<option value="${index}">第 ${index + 1} 步</option>`,
  ).join("");
  length.innerHTML = Array.from(
    { length: STEP_COUNT },
    (_, index) => `<option value="${index + 1}">${index + 1} 步</option>`,
  ).join("");
  destination.innerHTML = source.innerHTML;
  length.value = "8";
  destination.value = "8";
}

function openCopyDialog() {
  $("#copySource").value = String(selectedStep);
  const source = Number($("#copySource").value);
  const maxLength = STEP_COUNT - source;
  $("#copyLength").value = String(Math.min(8, maxLength));
  $("#copyDestination").value = String(
    source + Number($("#copyLength").value) < STEP_COUNT
      ? source + Number($("#copyLength").value)
      : 0,
  );
  updateCopyPreview();
  copyDialog.showModal();
}

function updateCopyPreview() {
  const source = Number($("#copySource").value);
  const length = Number($("#copyLength").value);
  const destination = Number($("#copyDestination").value);
  const valid =
    source + length <= STEP_COUNT && destination + length <= STEP_COUNT;
  const note = $("#copyNote");
  note.textContent = valid
    ? `将第 ${source + 1}–${source + length} 步复制到第 ${destination + 1}–${destination + length} 步。`
    : "源区间或目标区间超出十六步范围。";
  note.classList.toggle("is-warning", !valid);
  $("#confirmCopyButton").disabled = !valid;
  const visual = $("#copyRangeVisual");
  visual.replaceChildren(
    ...Array.from({ length: STEP_COUNT }, (_, index) => {
      const bar = document.createElement("i");
      const inSource = index >= source && index < source + length;
      const inDestination =
        index >= destination && index < destination + length;
      if (inSource) bar.classList.add("is-source");
      if (inDestination) bar.classList.add("is-destination");
      return bar;
    }),
  );
}

function copySection() {
  const source = Number($("#copySource").value);
  const length = Number($("#copyLength").value);
  const destination = Number($("#copyDestination").value);
  if (source + length > STEP_COUNT || destination + length > STEP_COUNT) {
    return;
  }
  snapshot();
  const tracks =
    $("#copyScope").value === "current"
      ? [project.tracks[selectedTrack]]
      : project.tracks;
  for (const track of tracks) {
    const copied = track.steps
      .slice(source, source + length)
      .map((step) => ({ ...step }));
    copied.forEach((step, index) => {
      track.steps[destination + index] = step;
    });
  }
  engine.invalidateVoices();
  renderAll();
  scheduleSave();
  copyDialog.close();
  toast(`已复制 ${length} 步到第 ${destination + 1} 步`);
}

function updateExportSummary() {
  const cycles = Number($("#exportCycles").value);
  const seconds = (cycles * 4 * 60) / project.bpm + 0.6;
  const whole = Math.floor(seconds);
  $("#exportDuration").textContent =
    `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
  $("#exportProjectName").textContent = project.name;
}

async function exportWav() {
  const button = $("#confirmExportButton");
  if (button.disabled) return;
  const cycles = Number($("#exportCycles").value);
  const sampleRate = Number($("#exportSampleRate").value);
  button.disabled = true;
  button.textContent = "渲染中…";
  $("#renderProgress").hidden = false;
  $("#renderProgressBar").style.width = "8%";
  await new Promise((resolve) => window.setTimeout(resolve, 60));
  try {
    $("#renderProgressBar").style.width = "32%";
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const rendered = renderProjectToStereo(project, { cycles, sampleRate });
    $("#renderProgressBar").style.width = "82%";
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    const blob = wavBlob(rendered.left, rendered.right, sampleRate);
    $("#renderProgressBar").style.width = "100%";
    downloadBlob(
      blob,
      safeFilename(project.name, `-${cycles}x16-step.wav`),
    );
    exportDialog.close();
    toast(`WAV 已导出 · ${rendered.duration.toFixed(1)} 秒`);
  } catch (error) {
    toast(`WAV 导出失败：${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = "渲染并下载";
    $("#renderProgress").hidden = true;
    $("#renderProgressBar").style.width = "0";
  }
}

function bindTransportEvents() {
  $("#playButton").addEventListener("click", async () => {
    try {
      if (engine.state === "playing") {
        engine.pause();
      } else {
        await engine.play();
        updatePlayhead(true);
      }
    } catch (error) {
      toast(`无法开始播放：${error.message}`, true);
    }
  });
  $("#stopButton").addEventListener("click", () => {
    engine.stop();
    updatePlayhead(true);
  });
  $("#loopButton").addEventListener("click", () => {
    snapshot();
    project.loop = !project.loop;
    engine.setLoop(project.loop);
    renderProjectMeta();
    scheduleSave();
  });
  document.querySelectorAll("#resumeSegment button").forEach((button) => {
    button.addEventListener("click", () => {
      project.resumeMode = button.dataset.mode;
      renderProjectMeta();
      if (engine.state === "stopped") engine.stop();
      updatePlayhead(true);
      scheduleSave();
    });
  });
}

function setTempo(value, record = true) {
  const bpm = clamp(Math.round(Number(value) || project.bpm), 40, 240);
  if (record) snapshot();
  project.bpm = bpm;
  engine.setBpm(bpm);
  $("#tempoInput").value = bpm;
  renderStepEditor();
  updateExportSummary();
  scheduleSave();
}

function bindTempoEvents() {
  $("#tempoDown").addEventListener("click", () => setTempo(project.bpm - 1));
  $("#tempoUp").addEventListener("click", () => setTempo(project.bpm + 1));
  $("#tempoInput").addEventListener(
    "input",
    (event) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      if (!liveEditSnapshot) {
        history.push(cloneProject(project));
        if (history.length > 40) history.shift();
        redoStack = [];
        liveEditSnapshot = true;
      }
      project.bpm = clamp(Math.round(value), 40, 240);
      engine.setBpm(project.bpm);
      renderStepEditor();
      updateExportSummary();
      scheduleSave();
    },
    false,
  );
  $("#tempoInput").addEventListener("change", () => {
    finishLiveEdit();
    $("#tempoInput").value = project.bpm;
  });
}

function bindGridEvents() {
  grid.addEventListener("click", (event) => {
    const remove = event.target.closest(".step-remove");
    if (remove) {
      event.stopPropagation();
      const cell = remove.closest(".step-cell");
      toggleStep(Number(cell.dataset.track), Number(cell.dataset.step), false);
      return;
    }
    const trackButton = event.target.closest(".track-select");
    if (trackButton) {
      selectTrack(Number(trackButton.dataset.track));
      return;
    }
    const muteButton = event.target.closest(".track-mute");
    if (muteButton) {
      event.stopPropagation();
      const trackIndex = Number(muteButton.dataset.track);
      snapshot();
      project.tracks[trackIndex].mute = !project.tracks[trackIndex].mute;
      renderAll();
      scheduleSave();
      return;
    }
    const stepNumber = event.target.closest(".step-number");
    if (stepNumber) {
      selectStep(Number(stepNumber.dataset.step));
      return;
    }
    const cell = event.target.closest(".step-cell");
    if (!cell) return;
    const trackIndex = Number(cell.dataset.track);
    const stepIndex = Number(cell.dataset.step);
    const step = project.tracks[trackIndex].steps[stepIndex];
    if (!step.on) {
      toggleStep(trackIndex, stepIndex, true);
    } else if (event.altKey || event.metaKey) {
      toggleStep(trackIndex, stepIndex, false);
    } else {
      selectTrack(trackIndex);
      selectStep(stepIndex);
    }
  });
  grid.addEventListener("dblclick", (event) => {
    const cell = event.target.closest(".step-cell");
    if (!cell) return;
    event.preventDefault();
    const step = project.tracks[Number(cell.dataset.track)].steps[
      Number(cell.dataset.step)
    ];
    if (step.on) {
      toggleStep(Number(cell.dataset.track), Number(cell.dataset.step), false);
    }
  });
  grid.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest(".step-cell");
    if (!cell) return;
    event.preventDefault();
    const step = project.tracks[Number(cell.dataset.track)].steps[
      Number(cell.dataset.step)
    ];
    toggleStep(
      Number(cell.dataset.track),
      Number(cell.dataset.step),
      !step.on,
    );
  });
}

function bindInspectorEvents() {
  $("#muteButton").addEventListener("click", () => {
    snapshot();
    selectedTrackData().mute = !selectedTrackData().mute;
    renderAll();
    scheduleSave();
  });
  $("#stepPowerButton").addEventListener("click", () => {
    snapshot();
    const step = selectedStepData();
    step.on = !step.on;
    engine.invalidateVoices();
    renderAll();
    scheduleSave();
  });
  stepNoteSelect.addEventListener("change", () => {
    snapshot();
    selectedStepData().note = clamp(Number(stepNoteSelect.value), 0, 127);
    engine.invalidateVoices();
    renderAll();
    scheduleSave();
  });
  document.querySelectorAll("#sustainPicker button").forEach((button) => {
    button.addEventListener("click", () => {
      snapshot();
      selectedStepData().sustain = Number(button.dataset.sustain);
      renderAll();
      scheduleSave();
    });
  });
  document.querySelectorAll("#waveformPicker button").forEach((button) => {
    button.addEventListener("click", () => {
      applyChange(() => {
        selectedTrackData().synth.waveform = button.dataset.waveform;
      });
    });
  });
  $("#transposeSelect").addEventListener("change", (event) => {
    applyChange(() => {
      selectedTrackData().synth.transpose = Number(event.target.value);
    });
  });
  $("#trackNameInput").addEventListener("focus", () => {
    if (!liveEditSnapshot) {
      history.push(cloneProject(project));
      if (history.length > 40) history.shift();
      redoStack = [];
      liveEditSnapshot = true;
    }
  });
  $("#trackNameInput").addEventListener("input", (event) => {
    selectedTrackData().name = event.target.value.slice(0, 28);
    const selectedLabel = grid.querySelector(
      ".track-row.is-selected .track-copy",
    );
    if (selectedLabel) selectedLabel.textContent = selectedTrackData().name;
    scheduleSave();
  });
  $("#trackNameInput").addEventListener("blur", finishLiveEdit);

  $("#synthControls").addEventListener("input", (event) => {
    const input = event.target.closest("input[type=range]");
    if (!input) return;
    const control = input.closest(".slider-control");
    const key = control.dataset.control;
    const def = SLIDER_DEFS[key];
    const value = sliderValue(key, Number(input.value));
    applyLiveChange(() => {
      selectedTrackData().synth[key] = value;
    });
    const position = Number(input.value);
    input.style.setProperty("--range-fill", `${position / 10}%`);
    control.querySelector("output").textContent = def.format(value);
  });
  $("#synthControls").addEventListener("change", (event) => {
    if (event.target.matches("input[type=range]")) finishLiveEdit();
  });
}

function bindProjectEvents() {
  $("#projectName").addEventListener("focus", () => {
    if (!liveEditSnapshot) {
      history.push(cloneProject(project));
      if (history.length > 40) history.shift();
      redoStack = [];
      liveEditSnapshot = true;
    }
  });
  $("#projectName").addEventListener("input", (event) => {
    project.name = event.target.value.slice(0, 48);
    scheduleSave();
  });
  $("#projectName").addEventListener("blur", finishLiveEdit);
  $("#saveButton").addEventListener("click", saveJsonFile);
  $("#importButton").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importJsonFile(file);
  });
  $("#undoButton").addEventListener("click", undo);
  $("#redoButton").addEventListener("click", redo);
  $("#copySectionButton").addEventListener("click", openCopyDialog);
  $("#clearButton").addEventListener("click", () => clearDialog.showModal());
  $("#wavButton").addEventListener("click", () => {
    updateExportSummary();
    exportDialog.showModal();
  });
}

function bindDialogEvents() {
  ["#copySource", "#copyLength", "#copyDestination"].forEach((selector) => {
    $(selector).addEventListener("change", updateCopyPreview);
  });
  $("#confirmCopyButton").addEventListener("click", (event) => {
    event.preventDefault();
    copySection();
  });
  $("#clearForm").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "default") return;
    event.preventDefault();
    snapshot();
    selectedTrackData().steps.forEach((step) => {
      step.on = false;
    });
    engine.invalidateVoices();
    renderAll();
    scheduleSave();
    clearDialog.close();
    toast("当前轨道已清空");
  });
  $("#confirmExportButton").addEventListener("click", (event) => {
    event.preventDefault();
    exportWav();
  });
  $("#exportCycles").addEventListener("change", updateExportSummary);
  $("#exportSampleRate").addEventListener("change", updateExportSummary);
}

function bindKeyboardEvents() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditing = target.closest?.("input, select, textarea");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveJsonFile();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (isEditing || target.closest?.("button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (engine.state === "playing") engine.pause();
      else engine.play().catch((error) => toast(error.message, true));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      toggleStep(selectedTrack, selectedStep, false);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectStep((selectedStep + 1) % STEP_COUNT);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectStep((selectedStep - 1 + STEP_COUNT) % STEP_COUNT);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectTrack((selectedTrack + 1) % TRACK_COUNT);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectTrack((selectedTrack - 1 + TRACK_COUNT) % TRACK_COUNT);
    }
  });
}

function init() {
  populateCopySelects();
  bindTransportEvents();
  bindTempoEvents();
  bindGridEvents();
  bindInspectorEvents();
  bindProjectEvents();
  bindDialogEvents();
  bindKeyboardEvents();
  renderAll();
  updateExportSummary();
  saveLocalProject();
  requestAnimationFrame(animationLoop);
}

init();
