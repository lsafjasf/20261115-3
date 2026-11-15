import { DeepAudio } from "./audio.js";
import { SceneRenderer } from "./render.js";
import {
  FAULTS,
  FIXED_DT,
  TOOLS,
  compareTraces,
  createSimulation,
  hashState,
  sanitizeInput,
  stepSimulation,
} from "./sim.js";

const canvas = document.querySelector("#scene");
const renderer = new SceneRenderer(canvas);
const audio = new DeepAudio();

const dom = {
  missionNodes: document.querySelector("#missionNodes"),
  missionCount: document.querySelector("#missionCount"),
  depth: document.querySelector("#depthValue"),
  load: document.querySelector("#loadValue"),
  loadBar: document.querySelector("#loadBar"),
  tensionFill: document.querySelector("#tensionFill"),
  tensionMarker: document.querySelector("#tensionMarker"),
  tension: document.querySelector("#tensionValue"),
  length: document.querySelector("#lengthValue"),
  integrity: document.querySelector("#integrityValue"),
  cableState: document.querySelector("#cableState"),
  signalDot: document.querySelector("#signalDot"),
  traceHash: document.querySelector("#traceHash"),
  replayFrame: document.querySelector("#replayFrame"),
  verifyBtn: document.querySelector("#verifyBtn"),
  verifyResult: document.querySelector("#verifyResult"),
  objectiveTool: document.querySelector("#objectiveTool"),
  objectiveKicker: document.querySelector("#objectiveKicker"),
  objectiveText: document.querySelector("#objectiveText"),
  alert: document.querySelector("#alert"),
  startToast: document.querySelector("#startToast"),
  resultPanel: document.querySelector("#resultPanel"),
  resultCode: document.querySelector("#resultCode"),
  resultTitle: document.querySelector("#resultTitle"),
  resultBody: document.querySelector("#resultBody"),
  statTime: document.querySelector("#statTime"),
  statFrames: document.querySelector("#statFrames"),
  statHash: document.querySelector("#statHash"),
  restartBtn: document.querySelector("#restartBtn"),
  playbackBtn: document.querySelector("#playbackBtn"),
  replayBtn: document.querySelector("#replayBtn"),
  muteBtn: document.querySelector("#muteBtn"),
  toolCards: [...document.querySelectorAll(".tool-card")],
};

const keys = new Set();
let runNumber = 0;
let state = createSimulation(makeSeed());
let recording = { seed: state.seed, inputs: [], hashes: [], finished: false };
let savedLiveState = null;
let mode = "live";
let replay = null;
let queuedTool = 0;
let lastTimestamp = performance.now();
let accumulator = 0;
let alertTimer = 0;
let lastEventTimes = new Map();
let resultTimer = 0;

function makeSeed() {
  return (0x6a09e667 + Math.imul(runNumber + 1, 0x9e3779b1)) >>> 0;
}

function buildMissionNodes() {
  dom.missionNodes.replaceChildren();
  FAULTS.forEach((fault, index) => {
    const node = document.createElement("span");
    node.className = "mission-node";
    node.dataset.index = String(index);
    node.textContent = String(index + 1).padStart(2, "0");
    node.title = `${fault.code}号断点 · ${TOOLS[fault.tool - 1].name}`;
    dom.missionNodes.append(node);
  });
}

function guidedFault() {
  const remaining = state.faults.filter((fault) => !fault.done);
  if (!remaining.length) return null;
  const selected = remaining.filter((fault) => fault.tool === state.selectedTool);
  const candidates = selected.length ? selected : remaining;
  return candidates.reduce((nearest, fault) => {
    const distance = Math.hypot(state.pod.x - fault.x, state.pod.y - fault.y);
    if (!nearest || distance < nearest.distance) return { fault, distance };
    return nearest;
  }, null).fault;
}

function activeInput() {
  const thrustX = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  const thrustY = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
  const cable = (keys.has("payout") ? 1 : 0) - (keys.has("retract") ? 1 : 0);
  return sanitizeInput({ thrustX, thrustY, cable, tool: queuedTool });
}

function showAlert(message, kind = "", duration = 1900) {
  window.clearTimeout(alertTimer);
  dom.alert.textContent = message;
  dom.alert.className = `alert show ${kind}`;
  alertTimer = window.setTimeout(() => {
    dom.alert.className = "alert";
  }, duration);
}

function eventAllowed(type, cooldown) {
  const now = performance.now();
  const previous = lastEventTimes.get(type) || 0;
  if (now - previous < cooldown) return false;
  lastEventTimes.set(type, now);
  return true;
}

function processEvents(events) {
  for (const event of events) {
    if (event.type === "repair-start" && eventAllowed("repair-start", 1200)) {
      showAlert(`工具接触 ${event.fault} 号断点 · 保持位置`, "", 1400);
      audio.event("repair-start");
    } else if (event.type === "repair-done") {
      showAlert(`${event.fault} 号断点接续完成 · 新负载 ${event.load.toFixed(1)} kg`, "", 2200);
      audio.event("repair-done");
    } else if (event.type === "all-repaired") {
      showAlert("三处缆芯接通 · 收缆返回月池", "", 3000);
    } else if (event.type === "wrong-tool" && eventAllowed("wrong-tool", 1800)) {
      showAlert(`工具不匹配 · 需要${TOOLS[event.required - 1].name}`, "danger", 1500);
    } else if (event.type === "collision" && eventAllowed("collision", 420)) {
      showAlert(`漂流物撞击 · 船体完好 ${event.integrity}%`, "danger", 1800);
      audio.event("collision");
    } else if (event.type === "tension-warning" && eventAllowed("tension-warning", 1250)) {
      showAlert("张力进入红区 · 立即放缆或停止收缆", "danger", 1600);
      audio.event("warning");
    } else if (event.type === "tangle-warning" && eventAllowed("tangle-warning", 1100)) {
      showAlert("脐带过松并接触礁石 · 收缆脱离", "danger", 1600);
      audio.event("warning");
    } else if (event.type === "failure") {
      audio.event("failure");
      finishLiveRun();
    } else if (event.type === "success") {
      audio.event("success");
      finishLiveRun();
    }
  }
}

function finishLiveRun() {
  if (recording.finished) return;
  recording.finished = true;
  window.clearTimeout(resultTimer);
  runVerification();
  resultTimer = window.setTimeout(showResult, 650);
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function showResult() {
  if (mode !== "live") return;
  const success = state.status === "won";
  dom.resultPanel.classList.toggle("failed", !success);
  dom.resultCode.textContent = success ? "MISSION COMPLETE" : "UMBILICAL FAULT";
  dom.resultTitle.textContent = success ? "三处缆芯已接续" : "维修舱未安全回收";
  dom.resultBody.textContent = success
    ? "维修舱安全回收。海流数据与输入轨迹已封存，可逐帧复验。"
    : state.failReason;
  dom.statTime.textContent = formatTime(state.time);
  dom.statFrames.textContent = String(recording.inputs.length);
  dom.statHash.textContent = hashState(state);
  dom.playbackBtn.textContent = "回放本局";
  dom.resultPanel.classList.add("show");
}

function hideResult() {
  window.clearTimeout(resultTimer);
  dom.resultPanel.classList.remove("show");
}

function updateHud() {
  const target = guidedFault();
  const nodes = dom.missionNodes.children;
  FAULTS.forEach((fault, index) => {
    const node = nodes[index];
    node.classList.toggle("done", state.faults[index].done);
    node.classList.toggle("active", Boolean(target) && target.id === fault.id);
  });
  dom.missionCount.textContent = `${state.repairedCount} / ${FAULTS.length}`;

  const depth = Math.round(48 + state.pod.y * 0.32);
  dom.depth.textContent = String(depth).padStart(3, "0");
  dom.load.innerHTML = `${state.load.toFixed(1)} <small>kg</small>`;
  dom.loadBar.style.width = `${Math.min(100, (state.load / 52) * 100)}%`;
  dom.integrity.textContent = `${Math.round(state.integrity)}%`;

  const tension = state.cable.tension;
  const gauge = Math.max(2, Math.min(100, (tension / 1.8) * 100));
  dom.tensionFill.style.width = `${gauge}%`;
  dom.tensionMarker.style.left = `${gauge}%`;
  dom.tension.textContent = tension.toFixed(2);
  dom.length.textContent = `${Math.round(state.cable.length)} m`;
  if (tension > 1.48) {
    dom.tensionFill.style.background = "#ff5f57";
  } else if (tension > 1.26) {
    dom.tensionFill.style.background = "linear-gradient(90deg, #72d6b6, #ffad63)";
  } else {
    dom.tensionFill.style.background = "linear-gradient(90deg, #4fbeb5, #b8e88d)";
  }

  let cableState = "松弛";
  let cableClass = "";
  if (state.cable.tensionTime > 0) {
    cableState = `临界 ${Math.max(0, 0.5 - state.cable.tensionTime).toFixed(1)}s`;
    cableClass = "danger";
  } else if (state.cable.tangleTime > 0) {
    cableState = `缠绕 ${Math.max(0, 1.6 - state.cable.tangleTime).toFixed(1)}s`;
    cableClass = "danger";
  } else if (tension > 1.3) {
    cableState = "过紧";
    cableClass = "warn";
  } else if (state.cable.ratio < 0.72) {
    cableState = "过松";
    cableClass = "warn";
  } else if (state.cable.ratio > 0.92) {
    cableState = "工作";
  }
  dom.cableState.textContent = cableState;
  dom.cableState.className = cableClass;
  dom.signalDot.style.background = cableClass === "danger" ? "#ff5f57" : cableClass === "warn" ? "#ff9c55" : "#63e0d1";

  dom.traceHash.textContent = hashState(state);
  if (mode === "replay" && replay) {
    dom.replayFrame.textContent = `${String(replay.index).padStart(4, "0")} / ${String(replay.total).padStart(4, "0")}`;
  } else {
    dom.replayFrame.textContent = `${String(recording.inputs.length).padStart(4, "0")} / REC`;
  }

  dom.toolCards.forEach((card, index) => {
    const tool = index + 1;
    const relatedFault = state.faults[index];
    card.classList.toggle("active", state.selectedTool === tool);
    card.classList.toggle("done", Boolean(relatedFault && relatedFault.done));
  });

  if (!target) {
    const recoveryPercent = Math.round((state.recoveryProgress / 2.2) * 100);
    dom.objectiveTool.innerHTML = "<span>✓</span>";
    dom.objectiveKicker.textContent = "回收阶段";
    dom.objectiveText.textContent =
      recoveryPercent > 0
        ? `月池回收中 ${recoveryPercent}% · 保持稳定`
        : "收缆返回月池 · 避开新生成漂移物";
  } else {
    const tool = TOOLS[target.tool - 1];
    const distance = Math.hypot(state.pod.x - target.x, state.pod.y - target.y);
    dom.objectiveTool.innerHTML = `<span>${tool.short}</span>`;
    dom.objectiveKicker.textContent = "当前目标";
    if (state.selectedTool !== target.tool) {
      dom.objectiveText.textContent = `切换至${tool.name} · 前往 ${target.id} 号断点`;
    } else if (distance < target.radius) {
      dom.objectiveText.textContent = `${target.id} 号断点接续中 ${Math.round(target.progress * 100)}%`;
    } else {
      dom.objectiveText.textContent = `前往 ${target.id} 号断点 · ${Math.round(distance)} m`;
    }
  }

  dom.verifyBtn.disabled = recording.inputs.length === 0;
  dom.replayBtn.textContent = mode === "replay" ? "退出回放" : "回放";
  dom.replayBtn.disabled = mode === "live" && recording.inputs.length === 0;
}

function runVerification() {
  if (!recording.inputs.length) {
    dom.verifyResult.textContent = "尚无轨迹";
    dom.verifyResult.className = "";
    return;
  }
  const result = compareTraces(recording.seed, recording.inputs, recording.hashes);
  if (result.ok) {
    dom.verifyResult.textContent = `✓ ${result.frames} / ${result.frames} 帧状态完全一致`;
    dom.verifyResult.className = "ok";
  } else {
    dom.verifyResult.textContent = `轨迹分歧 @ ${result.mismatchFrame} 帧`;
    dom.verifyResult.className = "fail";
  }
}

function startReplay() {
  if (!recording.inputs.length) {
    showAlert("尚无足够轨迹可供回放", "danger");
    return;
  }
  audio.ensureStarted();
  savedLiveState = state;
  mode = "replay";
  state = createSimulation(recording.seed);
  replay = {
    index: 0,
    total: recording.inputs.length,
    mismatch: null,
    complete: false,
  };
  queuedTool = 0;
  accumulator = 0;
  hideResult();
  showAlert(`确定性回放 · 种子 ${recording.seed.toString(16).toUpperCase()}`, "", 2200);
}

function stopReplay() {
  if (mode !== "replay") return;
  mode = "live";
  state = savedLiveState || state;
  savedLiveState = null;
  replay = null;
  accumulator = 0;
  showAlert("已退出回放 · 轨迹保持封存", "", 1600);
  if (state.status !== "playing") showResult();
}

function finishReplay() {
  if (!replay) return;
  replay.complete = true;
  if (replay.mismatch !== null) {
    dom.verifyResult.textContent = `轨迹分歧 @ ${replay.mismatch} 帧`;
    dom.verifyResult.className = "fail";
    showAlert(`回放失败 · 第 ${replay.mismatch} 帧哈希不同`, "danger", 3200);
  } else {
    dom.verifyResult.textContent = `✓ ${replay.total} / ${replay.total} 帧状态完全一致`;
    dom.verifyResult.className = "ok";
    showAlert(`回放完成 · ${replay.total} 帧轨迹一致`, "", 3200);
  }
}

function replayStep() {
  if (!replay || replay.complete) return;
  const input = recording.inputs[replay.index];
  const expected = recording.hashes[replay.index];
  stepSimulation(state, input);
  const actual = hashState(state);
  if (actual !== expected && replay.mismatch === null) {
    replay.mismatch = replay.index;
  }
  replay.index += 1;
  if (replay.index >= replay.total) finishReplay();
}

function simulationStep() {
  const input = activeInput();
  queuedTool = 0;
  stepSimulation(state, input);
  recording.inputs.push(input);
  recording.hashes.push(hashState(state));
  processEvents(state.events);
}

function newRun() {
  audio.ensureStarted();
  runNumber += 1;
  state = createSimulation(makeSeed());
  recording = { seed: state.seed, inputs: [], hashes: [], finished: false };
  mode = "live";
  savedLiveState = null;
  replay = null;
  queuedTool = 0;
  keys.clear();
  accumulator = 0;
  lastTimestamp = performance.now();
  lastEventTimes = new Map();
  hideResult();
  dom.verifyResult.textContent = "等待轨迹样本";
  dom.verifyResult.className = "";
  dom.verifyBtn.disabled = true;
  showAlert("脐带已解锁 · 先用 Q 放缆", "", 2600);
}

const keyMap = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  KeyQ: "payout",
  KeyE: "retract",
};

window.addEventListener("keydown", (event) => {
  audio.ensureStarted();
  if (keyMap[event.code]) {
    keys.add(keyMap[event.code]);
    event.preventDefault();
  }
  if (["KeyR", "KeyM", "KeyP", "Space", "Digit1", "Digit2", "Digit3"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.repeat) return;

  if (event.code === "Digit1" || event.code === "Digit2" || event.code === "Digit3") {
    queuedTool = Number(event.code.slice(-1));
    audio.event("tool");
  } else if (event.code === "KeyR") {
    newRun();
  } else if (event.code === "KeyM") {
    toggleMute();
  } else if (event.code === "KeyP" || event.code === "Space") {
    if (mode === "replay") stopReplay();
    else if (recording.inputs.length) startReplay();
  }
});

window.addEventListener("keyup", (event) => {
  if (keyMap[event.code]) {
    keys.delete(keyMap[event.code]);
    event.preventDefault();
  }
});

window.addEventListener("blur", () => keys.clear());

function toggleMute() {
  audio.ensureStarted();
  audio.setMuted(!audio.muted);
  dom.muteBtn.classList.toggle("muted", audio.muted);
  dom.muteBtn.title = audio.muted ? "开启声音" : "静音";
  showAlert(audio.muted ? "音频已静音" : "张力声呐已开启", "", 1300);
}

dom.toolCards.forEach((card) => {
  card.addEventListener("click", () => {
    audio.ensureStarted();
    queuedTool = Number(card.dataset.tool);
    audio.event("tool");
  });
});

dom.muteBtn.addEventListener("click", toggleMute);
dom.restartBtn.addEventListener("click", newRun);
dom.playbackBtn.addEventListener("click", startReplay);
dom.replayBtn.addEventListener("click", () => {
  if (mode === "replay") stopReplay();
  else startReplay();
});
dom.verifyBtn.addEventListener("click", () => {
  audio.ensureStarted();
  runVerification();
  audio.event("tool");
});

window.addEventListener("pointerdown", () => audio.ensureStarted(), { once: true });

function gameLoop(timestamp) {
  const elapsed = Math.min(0.1, Math.max(0, (timestamp - lastTimestamp) / 1000));
  lastTimestamp = timestamp;
  const canAdvance = (mode === "live" && state.status === "playing") || (mode === "replay" && replay && !replay.complete);
  if (canAdvance) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 7) {
      if (mode === "live") simulationStep();
      else replayStep();
      accumulator -= FIXED_DT;
      steps += 1;
      if (mode === "live" && state.status !== "playing") break;
      if (mode === "replay" && (!replay || replay.complete)) break;
    }
    if (steps === 7) accumulator = 0;
  } else {
    accumulator = 0;
  }

  updateHud();
  renderer.draw(state, guidedFault());
  audio.update(state.cable.tension, state.status);
  requestAnimationFrame(gameLoop);
}

buildMissionNodes();
updateHud();
requestAnimationFrame((timestamp) => {
  lastTimestamp = timestamp;
  gameLoop(timestamp);
});

window.setTimeout(() => dom.startToast.classList.add("show"), 350);
window.setTimeout(() => dom.startToast.classList.remove("show"), 5600);
