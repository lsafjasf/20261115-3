import { BinauralAudioEngine } from "./audio-engine.js";

const STORAGE_KEY = "echo-file.binaural-calibration.v1";
const PROFILE_VERSION = 1;
const PITCH_TOLERANCE_CENTS = 20;
const LEVEL_TOLERANCE_DB = 1.5;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const byId = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, places = 1) => Number(value.toFixed(places));
const randomBetween = (min, max) => min + Math.random() * (max - min);
const centsBetween = (heard, reference) => 1200 * Math.log2(heard / reference);
const signed = (value, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;

const engine = new BinauralAudioEngine();
const dom = {
  calibrationView: byId("calibration-view"),
  sceneView: byId("scene-view"),
  stageRoot: byId("stage-root"),
  stageChannel: byId("stage-channel"),
  stageTone: byId("stage-tone"),
  stageSpatial: byId("stage-spatial"),
  stepRailElement: document.querySelector(".step-rail"),
  stepRail: [...document.querySelectorAll(".step-rail li")],
  systemStatus: byId("system-status"),
  profileRestored: byId("profile-restored"),
  restoredDetail: byId("restored-detail"),
  resumeScene: byId("resume-scene"),
  restartCalibration: byId("restart-calibration"),
  startChannel: byId("start-channel"),
  toTone: byId("to-tone"),
  channelConsole: byId("channel-console"),
  channelStatus: byId("channel-status"),
  channelPrompt: byId("channel-prompt"),
  channelError: byId("channel-error"),
  channelErrorText: byId("channel-error-text"),
  channelSuccess: byId("channel-success"),
  channelSuccessText: byId("channel-success-text"),
  answerLeft: byId("answer-left"),
  answerRight: byId("answer-right"),
  swapRetry: byId("swap-retry"),
  manualRetry: byId("manual-retry"),
  leftEarZone: document.querySelector(".ear-zone.left"),
  rightEarZone: document.querySelector(".ear-zone.right"),
  channelScope: byId("channel-scope"),
  pitchSlider: byId("pitch-slider"),
  levelSlider: byId("level-slider"),
  playReference: byId("play-reference"),
  playMatch: byId("play-match"),
  compareTone: byId("compare-tone"),
  referenceOrb: document.querySelector(".reference-orb"),
  toneFeedback: byId("tone-feedback"),
  toneResult: byId("tone-result"),
  checkTone: byId("check-tone"),
  toSpatial: byId("to-spatial"),
  spatialCounter: byId("spatial-counter"),
  spatialStatus: byId("spatial-status"),
  playSpatial: byId("play-spatial"),
  spatialPrompt: byId("spatial-prompt"),
  spatialError: byId("spatial-error"),
  answerFront: byId("answer-front"),
  answerBack: byId("answer-back"),
  radarSweep: byId("radar-sweep"),
  trialDots: [...document.querySelectorAll(".trial-dots span")],
  calibrationComplete: byId("calibration-complete"),
  completeDetail: byId("complete-detail"),
  saveCalibration: byId("save-calibration"),
  sceneProfile: byId("scene-profile"),
  profileSwap: byId("profile-swap"),
  profilePitch: byId("profile-pitch"),
  profileGain: byId("profile-gain"),
  profileSpatial: byId("profile-spatial"),
  sceneFeedback: byId("scene-feedback"),
  backToCalibration: byId("back-to-calibration"),
  clues: [...document.querySelectorAll(".clue")],
  toast: byId("toast"),
};

const state = {
  stage: 1,
  screen: "calibration",
  profile: null,
  channel: {
    status: "idle",
    currentIndex: 0,
    queue: [],
    swap: false,
    passed: false,
    results: [],
    token: 0,
  },
  tone: {
    initialized: false,
    referenceHz: 0,
    referenceDb: 0,
    matchHz: 0,
    matchDb: 0,
    passed: false,
  },
  spatial: {
    initialized: false,
    expected: [],
    index: 0,
    passed: false,
    status: "idle",
    results: [],
    token: 0,
  },
};

let toastTimer = 0;
let profileLoaded = false;

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.version !== PROFILE_VERSION || !value.channels || !value.tone) return null;
    if (!value.channels.leftVerified || !value.channels.rightVerified) return null;
    if (!value.spatial?.passed) return null;
    return value;
  } catch {
    return null;
  }
}

function showToast(message, duration = 3600) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, duration);
}

function setSystemStatus(text) {
  dom.systemStatus.textContent = text;
}

async function ensureAudio() {
  try {
    await engine.ensureReady();
    const output = engine.getOutputState();
    setSystemStatus(`Web Audio · ${output.sampleRate / 1000} kHz`);
    document.documentElement.dataset.audioState = output.state;
    return true;
  } catch (error) {
    console.error(error);
    setSystemStatus("音频引擎不可用");
    showToast(`无法启动 Web Audio：${error.message}`);
    return false;
  }
}

function applyProfileToEngine(profile) {
  if (!profile) return;
  engine.setChannelSwap(profile.channels.swap);
  engine.setMasterGainDb(profile.applied?.masterGainDb ?? profile.tone.matchDb);
}

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "刚刚";
  }
}

function setStage(stage) {
  state.stage = stage;
  const panels = [
    [1, dom.stageChannel],
    [2, dom.stageTone],
    [3, dom.stageSpatial],
  ];
  for (const [number, panel] of panels) {
    panel.hidden = number !== stage;
    panel.classList.toggle("active", number === stage);
  }
  for (const item of dom.stepRail) {
    const number = Number(item.dataset.step);
    item.classList.toggle("active", number === stage);
    item.classList.toggle("done", number < stage);
  }
  document.documentElement.dataset.stage = String(stage);
}

function setChannelState(nextState) {
  state.channel.status = nextState;
  document.documentElement.dataset.channelState = nextState;
}

function clearEarHighlights() {
  dom.leftEarZone.classList.remove("active");
  dom.rightEarZone.classList.remove("active");
}

function resetChannelUi() {
  clearEarHighlights();
  dom.channelPrompt.hidden = true;
  dom.channelError.hidden = true;
  dom.channelSuccess.hidden = true;
  dom.startChannel.hidden = false;
  dom.startChannel.disabled = false;
  dom.startChannel.textContent = "开始声道测试";
  dom.toTone.hidden = true;
  dom.channelStatus.dataset.state = "idle";
  dom.channelStatus.textContent = state.channel.swap
    ? "将使用自动交换后的声道映射"
    : "准备开始声道测试";
}

async function startChannelTest() {
  if (!(await ensureAudio())) return;
  state.channel.token += 1;
  state.channel.queue = ["left", "right"];
  state.channel.currentIndex = 0;
  state.channel.results = [];
  state.channel.passed = false;
  engine.setChannelSwap(state.channel.swap);
  dom.startChannel.hidden = true;
  dom.channelError.hidden = true;
  dom.channelSuccess.hidden = true;
  dom.channelPrompt.hidden = true;
  dom.toTone.hidden = true;
  setChannelState("starting");
  await playNextChannelCue();
}

async function playNextChannelCue() {
  const side = state.channel.queue[state.channel.currentIndex];
  if (!side) return;
  const token = ++state.channel.token;
  setChannelState("playing");
  clearEarHighlights();
  dom.channelPrompt.hidden = true;
  dom.channelError.hidden = true;
  dom.channelSuccess.hidden = true;
  dom.channelStatus.dataset.state = "playing";
  dom.channelStatus.textContent = `正在播放第 ${state.channel.currentIndex + 1} 个提示音…`;
  engine.playChannelCue(side);
  window.setTimeout(() => {
    if (token !== state.channel.token || state.channel.status !== "playing") return;
    dom.channelPrompt.hidden = false;
    dom.channelStatus.dataset.state = "awaiting";
    dom.channelStatus.textContent = "提示音结束。请选择你实际听到的一侧。";
    setChannelState("awaiting");
  }, 950);
}

async function answerChannel(heard) {
  if (state.channel.status !== "awaiting") return;
  const expected = state.channel.queue[state.channel.currentIndex];
  const heardLabel = heard === "left" ? "左耳" : "右耳";
  const expectedLabel = expected === "left" ? "左声道" : "右声道";
  state.channel.token += 1;
  dom.channelPrompt.hidden = true;

  if (heard !== expected) {
    setChannelState("error");
    dom.channelStatus.dataset.state = "error";
    dom.channelStatus.textContent = "检测到声道映射与听觉位置不一致。";
    dom.channelErrorText.textContent =
      `${expectedLabel}提示被判断为从${heardLabel}出现。请交换耳机左右佩戴方向，或自动交换声道后重新测试。校准通过前不会进入下一步。`;
    dom.channelError.hidden = false;
    engine.playError();
    engine.speak("左右声道接反，请交换后重测", { level: 0.1, when: 0.18 });
    if (expected === "left") {
      dom.leftEarZone.classList.add("active");
    } else {
      dom.rightEarZone.classList.add("active");
    }
    return;
  }

  state.channel.results.push({ expected, heard, correct: true });
  engine.playTick();
  if (state.channel.currentIndex < state.channel.queue.length - 1) {
    setChannelState("between");
    dom.channelStatus.dataset.state = "success";
    dom.channelStatus.textContent = `${expectedLabel}已确认，准备测试另一侧…`;
    if (expected === "left") {
      dom.leftEarZone.classList.add("active");
    } else {
      dom.rightEarZone.classList.add("active");
    }
    await sleep(400);
    state.channel.currentIndex += 1;
    await playNextChannelCue();
    return;
  }

  state.channel.passed = true;
  setChannelState("passed");
  dom.channelStatus.dataset.state = "success";
  dom.channelStatus.textContent = "左右声道均与听觉位置一致。";
  dom.channelSuccessText.textContent = state.channel.swap
    ? "自动交换矩阵已启用。调查场景会沿用此声道映射。"
    : "已采用标准声道映射。调查场景会沿用此声道映射。";
  dom.channelSuccess.hidden = false;
  dom.toTone.hidden = false;
  engine.setChannelSwap(state.channel.swap);
  engine.playConfirm();
  engine.speak("左右声道确认完成", { level: 0.1, when: 0.12 });
}

async function retryChannelWithSwap() {
  if (!(await ensureAudio())) return;
  state.channel.swap = !state.channel.swap;
  engine.setChannelSwap(state.channel.swap);
  dom.channelError.hidden = true;
  showToast(state.channel.swap ? "已交换左右输出声道，开始重测。" : "已恢复标准声道，开始重测。");
  await startChannelTest();
}

async function retryChannelManual() {
  if (!(await ensureAudio())) return;
  dom.channelError.hidden = true;
  await startChannelTest();
}

function initializeToneStage() {
  if (state.tone.initialized) return;
  const referenceHz = round(randomBetween(215, 385));
  const referenceDb = round(randomBetween(-32, -23));
  const matchHz = round(clamp(referenceHz + randomBetween(-65, 65), 150, 620));
  const matchDb = round(clamp(referenceDb + randomBetween(-5.5, 5.5), -42, -12));
  Object.assign(state.tone, {
    initialized: true,
    referenceHz,
    referenceDb,
    matchHz,
    matchDb,
    passed: false,
  });
  dom.pitchSlider.value = String(matchHz);
  dom.levelSlider.value = String(matchDb);
  dom.pitchSlider.dataset.target = String(referenceHz);
  dom.levelSlider.dataset.target = String(referenceDb);
  dom.toneFeedback.classList.remove("pass", "fail");
  dom.toneResult.textContent = "调整后检查匹配";
  dom.toSpatial.hidden = true;
  dom.checkTone.hidden = false;
  dom.checkTone.disabled = false;
  document.documentElement.dataset.toneState = "idle";
}

function currentToneValues() {
  return {
    hz: Number(dom.pitchSlider.value),
    db: Number(dom.levelSlider.value),
  };
}

async function playReferenceTone() {
  if (!(await ensureAudio())) return;
  const tone = state.tone;
  engine.playReferenceTone(tone.referenceHz, tone.referenceDb);
  dom.referenceOrb.classList.add("playing");
  window.setTimeout(() => dom.referenceOrb.classList.remove("playing"), 850);
}

async function playMatchedTone() {
  if (!(await ensureAudio())) return;
  const current = currentToneValues();
  engine.playMatchTone(current.hz, current.db);
}

async function compareTones() {
  if (!(await ensureAudio())) return;
  const current = currentToneValues();
  engine.toggleCompareTone(
    { hz: state.tone.referenceHz, db: state.tone.referenceDb },
    current,
    3,
  );
  dom.referenceOrb.classList.add("playing");
  window.setTimeout(() => dom.referenceOrb.classList.remove("playing"), 3600);
}

async function startLiveTonePreview() {
  if (state.stage !== 2 || state.tone.passed) return;
  if (!(await ensureAudio())) return;
  const current = currentToneValues();
  engine.startLiveTone(current.hz, current.db);
}

function updateLiveTonePreview() {
  if (!engine.liveTone || state.tone.passed) return;
  const current = currentToneValues();
  engine.updateLiveTone(current.hz, current.db);
}

function stopLiveTonePreview() {
  engine.stopLiveTone();
}

async function checkToneMatch() {
  if (!(await ensureAudio())) return;
  if (state.tone.passed) return;
  const current = currentToneValues();
  const cents = centsBetween(current.hz, state.tone.referenceHz);
  const levelDelta = current.db - state.tone.referenceDb;
  const pitchPass = Math.abs(cents) <= PITCH_TOLERANCE_CENTS;
  const levelPass = Math.abs(levelDelta) <= LEVEL_TOLERANCE_DB;
  state.tone.matchHz = current.hz;
  state.tone.matchDb = current.db;
  dom.toneFeedback.classList.remove("pass", "fail");

  if (pitchPass && levelPass) {
    state.tone.passed = true;
    dom.toneFeedback.classList.add("pass");
    dom.toneResult.textContent =
      `音高偏差 ${signed(cents, " 音分")} · 响度偏差 ${signed(levelDelta, " dB")} · 通过`;
    dom.checkTone.hidden = true;
    dom.toSpatial.hidden = false;
    dom.pitchSlider.disabled = true;
    dom.levelSlider.disabled = true;
    document.documentElement.dataset.toneState = "passed";
    engine.playConfirm();
    engine.speak("音高与响度匹配完成", { level: 0.1, when: 0.12 });
    return;
  }

  const guidance = [];
  if (!pitchPass) {
    guidance.push(cents > 0 ? "测试音偏高，请降低音高" : "测试音偏低，请提高音高");
  }
  if (!levelPass) {
    guidance.push(levelDelta > 0 ? "测试音偏响，请降低响度" : "测试音偏轻，请提高响度");
  }
  dom.toneFeedback.classList.add("fail");
  dom.toneResult.textContent =
    `${guidance.join("；")}（${signed(cents, " 音分")} / ${signed(levelDelta, " dB")}）`;
  document.documentElement.dataset.toneState = "retry";
  engine.playError();
}

function initializeSpatialStage() {
  if (state.spatial.initialized) return;
  const patterns = [
    ["front", "back", "front"],
    ["back", "front", "back"],
    ["front", "back", "back"],
    ["back", "front", "front"],
  ];
  state.spatial.expected = patterns[Math.floor(Math.random() * patterns.length)];
  state.spatial.index = 0;
  state.spatial.results = [];
  state.spatial.passed = false;
  state.spatial.status = "idle";
  state.spatial.initialized = true;
  dom.spatialCounter.textContent = "0 / 3";
  dom.spatialStatus.dataset.state = "idle";
  dom.spatialStatus.textContent = "等待第一段移动声源";
  dom.playSpatial.hidden = false;
  dom.playSpatial.disabled = false;
  dom.playSpatial.textContent = "播放第 1 段";
  dom.spatialPrompt.hidden = true;
  dom.spatialError.hidden = true;
  dom.calibrationComplete.hidden = true;
  for (const dot of dom.trialDots) dot.classList.remove("done");
  document.documentElement.dataset.spatialState = "idle";
}

function setSpatialState(nextState) {
  state.spatial.status = nextState;
  document.documentElement.dataset.spatialState = nextState;
}

async function playCurrentSpatialSegment() {
  if (!(await ensureAudio())) return;
  const trial = state.spatial.index;
  const expected = state.spatial.expected[trial];
  if (!expected) return;
  const token = ++state.spatial.token;
  setSpatialState("playing");
  dom.spatialError.hidden = true;
  dom.spatialPrompt.hidden = true;
  dom.playSpatial.hidden = true;
  dom.playSpatial.dataset.expected = expected;
  document.documentElement.dataset.spatialExpected = expected;
  dom.spatialCounter.textContent = `${trial + 1} / 3`;
  dom.spatialStatus.dataset.state = "playing";
  dom.spatialStatus.textContent = `第 ${trial + 1} 段声源正在掠过…`;
  dom.radarSweep.classList.remove("playing");
  void dom.radarSweep.offsetWidth;
  dom.radarSweep.classList.add("playing");
  engine.playSpatialSegment(expected);
  await sleep(2100);
  if (token !== state.spatial.token) return;
  dom.radarSweep.classList.remove("playing");
  dom.spatialPrompt.hidden = false;
  dom.spatialStatus.dataset.state = "awaiting";
  dom.spatialStatus.textContent = "声源已掠过。请判断它位于前方还是后方。";
  setSpatialState("awaiting");
}

async function answerSpatial(heard) {
  if (state.spatial.status !== "awaiting") return;
  const trial = state.spatial.index;
  const expected = state.spatial.expected[trial];
  state.spatial.token += 1;
  dom.spatialPrompt.hidden = true;

  if (heard !== expected) {
    setSpatialState("retry");
    dom.spatialError.hidden = false;
    dom.spatialStatus.dataset.state = "error";
    dom.spatialStatus.textContent = "本轮未通过，请重听同一段声源。";
    dom.playSpatial.hidden = false;
    dom.playSpatial.disabled = false;
    dom.playSpatial.textContent = `重听第 ${trial + 1} 段`;
    engine.playError();
    engine.speak("方向不准确，请重听", { level: 0.1, when: 0.15 });
    return;
  }

  state.spatial.results.push({ trial: trial + 1, expected, heard, correct: true });
  state.spatial.index += 1;
  dom.spatialError.hidden = true;
  dom.trialDots[trial].classList.add("done");
  dom.spatialCounter.textContent = `${state.spatial.index} / 3`;
  engine.playTick();

  if (state.spatial.index >= 3) {
    state.spatial.passed = true;
    setSpatialState("passed");
    dom.spatialStatus.dataset.state = "success";
    dom.spatialStatus.textContent = "三段前后方向均校验通过。";
    dom.completeDetail.textContent =
      `声道、音高/响度与三段空间方向全部通过。参考音 ${state.tone.matchHz.toFixed(1)} Hz，` +
      `主增益 ${state.tone.matchDb.toFixed(1)} dB。`;
    dom.calibrationComplete.hidden = false;
    engine.playConfirm();
    engine.speak("双耳校准完成，可以保存", { level: 0.1, when: 0.12 });
    return;
  }

  setSpatialState("between");
  dom.spatialStatus.dataset.state = "success";
  dom.spatialStatus.textContent = `第 ${trial + 1} 段通过。准备下一段。`;
  dom.playSpatial.hidden = false;
  dom.playSpatial.disabled = false;
  dom.playSpatial.textContent = `播放第 ${state.spatial.index + 1} 段`;
}

function buildProfile() {
  const cents = centsBetween(state.tone.matchHz, state.tone.referenceHz);
  const levelDelta = state.tone.matchDb - state.tone.referenceDb;
  return {
    version: PROFILE_VERSION,
    createdAt: new Date().toISOString(),
    channels: {
      swap: state.channel.swap,
      leftVerified: true,
      rightVerified: true,
    },
    tone: {
      referenceHz: state.tone.referenceHz,
      matchHz: state.tone.matchHz,
      referenceDb: state.tone.referenceDb,
      matchDb: state.tone.matchDb,
      pitchDeviationCents: round(cents, 2),
      loudnessDeviationDb: round(levelDelta, 2),
    },
    spatial: {
      passed: true,
      score: "3/3",
      trials: state.spatial.results,
    },
    applied: {
      masterGainDb: state.tone.matchDb,
      alertHz: state.tone.matchHz,
    },
  };
}

async function saveCalibration() {
  if (!state.channel.passed || !state.tone.passed || !state.spatial.passed) {
    showToast("校准尚未全部通过，无法保存。");
    return;
  }
  const profile = buildProfile();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  state.profile = profile;
  applyProfileToEngine(profile);
  engine.playConfirm();
  showToast("校准参数已保存，正在应用至调查场景。");
  await sleep(450);
  await enterScene();
}

function showRestoredProfile(profile) {
  dom.restoredDetail.textContent =
    `${formatDate(profile.createdAt)} · ${profile.channels.swap ? "声道已交换" : "标准声道"} · ` +
    `${profile.tone.matchHz.toFixed(1)} Hz / ${profile.tone.matchDb.toFixed(1)} dB · 空间 ${profile.spatial.score}`;
  dom.profileRestored.hidden = false;
  dom.stageRoot.hidden = true;
  dom.stepRailElement.hidden = true;
  document.documentElement.dataset.profileRestored = "true";
  dom.systemStatus.textContent = "已载入本地校准参数";
}

function renderSceneProfile(profile) {
  dom.profileSwap.textContent = profile.channels.swap ? "已自动交换" : "标准映射";
  dom.profilePitch.textContent = `${profile.tone.matchHz.toFixed(1)} Hz`;
  dom.profileGain.textContent = `${profile.tone.matchDb.toFixed(1)} dB`;
  dom.profileSpatial.textContent = `${profile.spatial.score} 通过`;
  dom.sceneProfile.dataset.swap = profile.channels.swap ? "true" : "false";
  dom.sceneProfile.dataset.gainDb = String(profile.applied.masterGainDb);
  dom.sceneProfile.dataset.alertHz = String(profile.applied.alertHz);
  dom.sceneProfile.dataset.spatial = profile.spatial.score;
}

async function enterScene() {
  const profile = state.profile || loadProfile();
  if (!profile) {
    showToast("请先完成双耳校准。");
    return;
  }
  if (!(await ensureAudio())) return;
  state.profile = profile;
  applyProfileToEngine(profile);
  renderSceneProfile(profile);
  state.screen = "scene";
  dom.calibrationView.hidden = true;
  dom.sceneView.hidden = false;
  document.documentElement.dataset.screen = "scene";
  document.documentElement.dataset.profileApplied = "true";
  setSystemStatus("校准参数已应用");
  dom.sceneFeedback.textContent =
    `校准已载入：${profile.channels.swap ? "左右声道自动交换" : "标准声道"}，` +
    `主增益 ${profile.tone.matchDb.toFixed(1)} dB。选择一个线索开始监听。`;
  engine.speak("校准已应用。请选择线索开始调查。", { level: 0.1 });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function leaveScene() {
  state.screen = "calibration";
  dom.sceneView.hidden = true;
  dom.calibrationView.hidden = false;
  document.documentElement.dataset.screen = "calibration";
  const profile = state.profile || loadProfile();
  if (profile) showRestoredProfile(profile);
}

async function playClue(clueButton) {
  const profile = state.profile || loadProfile();
  if (!(await ensureAudio())) return;
  if (profile) applyProfileToEngine(profile);
  const clue = clueButton.dataset.clue;
  const labels = {
    door: "门缝里有一阵轻微的摩擦声。",
    recorder: "录音机的磁头还在缓慢转动。",
    steps: "身后的脚步停在档案架旁。",
  };
  for (const item of dom.clues) item.classList.remove("playing");
  clueButton.classList.add("playing");
  const result = engine.playSceneCue(clue, profile?.applied.alertHz ?? 330);
  engine.speak(labels[clue], { level: 0.1, pan: result.pan, when: 0.92 });
  dom.sceneFeedback.textContent =
    `${labels[clue]} 声音经过校准矩阵与 HRTF 空间渲染。`;
  window.setTimeout(() => clueButton.classList.remove("playing"), 1800);
}

function resetCalibration() {
  localStorage.removeItem(STORAGE_KEY);
  state.profile = null;
  state.channel = {
    status: "idle",
    currentIndex: 0,
    queue: [],
    swap: false,
    passed: false,
    results: [],
    token: state.channel.token + 1,
  };
  state.tone = {
    initialized: false,
    referenceHz: 0,
    referenceDb: 0,
    matchHz: 0,
    matchDb: 0,
    passed: false,
  };
  state.spatial = {
    initialized: false,
    expected: [],
    index: 0,
    passed: false,
    status: "idle",
    results: [],
    token: state.spatial.token + 1,
  };
  profileLoaded = false;
  dom.profileRestored.hidden = true;
  dom.stageRoot.hidden = false;
  dom.stepRailElement.hidden = false;
  dom.pitchSlider.disabled = false;
  dom.levelSlider.disabled = false;
  dom.toneFeedback.classList.remove("pass", "fail");
  dom.toneResult.textContent = "调整后检查匹配";
  dom.toSpatial.hidden = true;
  dom.checkTone.hidden = false;
  dom.checkTone.disabled = false;
  dom.calibrationComplete.hidden = true;
  dom.spatialPrompt.hidden = true;
  dom.playSpatial.hidden = false;
  dom.playSpatial.disabled = false;
  resetChannelUi();
  setStage(1);
  engine.setChannelSwap(false);
  engine.setMasterGainDb(0);
  document.documentElement.dataset.profileRestored = "false";
  document.documentElement.dataset.toneState = "idle";
  document.documentElement.dataset.spatialState = "idle";
  showToast("已清除旧参数，开始新的双耳校准。");
}

function drawScope(now) {
  const canvas = dom.channelScope;
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  context.strokeStyle = "rgba(110, 231, 221, 0.08)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 42) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  context.strokeStyle = "rgba(110, 231, 221, 0.22)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  context.strokeStyle = "rgba(110, 231, 221, 0.035)";
  context.lineWidth = 8;
  context.beginPath();
  for (let x = 0; x <= width; x += 3) {
    const phase = x * 0.045 - now * 0.0022;
    const amplitude = 18 + Math.sin(now * 0.0011 + x * 0.01) * 5;
    const y = height / 2 + Math.sin(phase) * amplitude;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();

  if (engine.analyser) {
    const data = new Uint8Array(engine.analyser.fftSize);
    engine.analyser.getByteTimeDomainData(data);
    context.strokeStyle = "rgba(110, 231, 221, 0.88)";
    context.lineWidth = 1.3;
    context.beginPath();
    for (let index = 0; index < data.length; index += 1) {
      const x = (index / (data.length - 1)) * width;
      const normalized = (data[index] - 128) / 128;
      const y = height / 2 + normalized * height * 0.36;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  requestAnimationFrame(drawScope);
}

function bindButton(id, handler) {
  const element = typeof id === "string" ? byId(id) : id;
  element.addEventListener("click", () => {
    Promise.resolve(handler()).catch((error) => {
      console.error(error);
      showToast(`操作失败：${error.message}`);
    });
  });
}

function bindEvents() {
  bindButton(dom.startChannel, startChannelTest);
  bindButton(dom.answerLeft, () => answerChannel("left"));
  bindButton(dom.answerRight, () => answerChannel("right"));
  bindButton(dom.swapRetry, retryChannelWithSwap);
  bindButton(dom.manualRetry, retryChannelManual);

  bindButton(dom.toTone, async () => {
    if (!(await ensureAudio())) return;
    initializeToneStage();
    setStage(2);
    engine.speak("先听参考音，再调整连续音高和响度", { level: 0.1 });
  });
  bindButton(dom.playReference, playReferenceTone);
  bindButton(dom.playMatch, playMatchedTone);
  bindButton(dom.compareTone, compareTones);
  bindButton(dom.checkTone, checkToneMatch);
  bindButton(dom.toSpatial, async () => {
    if (!(await ensureAudio())) return;
    initializeSpatialStage();
    setStage(3);
    engine.speak("听三段移动声源，判断前方或后方", { level: 0.1 });
  });

  bindButton(dom.playSpatial, playCurrentSpatialSegment);
  bindButton(dom.answerFront, () => answerSpatial("front"));
  bindButton(dom.answerBack, () => answerSpatial("back"));
  bindButton(dom.saveCalibration, saveCalibration);
  bindButton(dom.resumeScene, enterScene);
  bindButton(dom.restartCalibration, resetCalibration);
  bindButton(dom.backToCalibration, leaveScene);
  for (const clue of dom.clues) {
    bindButton(clue, () => playClue(clue));
  }

  for (const slider of [dom.pitchSlider, dom.levelSlider]) {
    slider.addEventListener("input", updateLiveTonePreview);
    slider.addEventListener("pointerdown", startLiveTonePreview);
    slider.addEventListener("keydown", startLiveTonePreview);
    slider.addEventListener("keyup", stopLiveTonePreview);
    slider.addEventListener("blur", stopLiveTonePreview);
  }
  window.addEventListener("pointerup", stopLiveTonePreview);
}

function bootstrap() {
  const profile = loadProfile();
  if (profile) {
    state.profile = profile;
    profileLoaded = true;
    showRestoredProfile(profile);
    applyProfileToEngine(profile);
  }
  resetChannelUi();
  setStage(1);
  bindEvents();
  document.documentElement.dataset.appReady = "true";
  document.documentElement.dataset.screen = "calibration";
  requestAnimationFrame(drawScope);
}

bootstrap();

window.__echoCalibration = {
  getState: () => JSON.parse(JSON.stringify({
    stage: state.stage,
    screen: state.screen,
    channel: state.channel,
    tone: state.tone,
    spatial: state.spatial,
  })),
  getOutputState: () => engine.getOutputState(),
};
