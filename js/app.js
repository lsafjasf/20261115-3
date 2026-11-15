import {
  BUFFER_STOP,
  DESTINATIONS,
  YardSimulation,
  destinationForRoute,
  routeForDestination,
} from "./simulation.js";
import { RailAudio } from "./audio.js";
import { YardRenderer } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  canvas: $("#yardCanvas"),
  grade: $("#gradeReadout"),
  wind: $("#windReadout"),
  parked: $("#parkedCount"),
  clock: $("#yardClock"),
  cutNumber: $("#cutNumber"),
  cutBadge: $("#cutBadge"),
  cutDest: $("#cutDest"),
  cutCode: $("#cutCode"),
  cutMeta: $("#cutMeta"),
  cutTicks: $("#cutTicks"),
  queueStrip: $("#queueStrip"),
  routeButtons: $$(".route-btn"),
  capA: $("#capA"),
  capB: $("#capB"),
  capC: $("#capC"),
  pushSpeed: $("#pushSpeed"),
  pushSpeedOut: $("#pushSpeedOut"),
  brakePoint: $("#brakePoint"),
  brakePointOut: $("#brakePointOut"),
  prediction: $("#prediction"),
  predictionText: $("#predictionText"),
  releaseBtn: $("#releaseBtn"),
  releaseLabel: $("#releaseLabel"),
  releaseHint: $("#releaseHint"),
  waitNote: $("#waitNote"),
  pauseBtn: $("#pauseBtn"),
  pauseLabel: $("#pauseLabel"),
  replayBtn: $("#replayBtn"),
  resetBtn: $("#resetBtn"),
  muteBtn: $("#muteBtn"),
  muteIcon: $("#muteIcon"),
  hudEnv: $("#hudEnv"),
  hudRoute: $("#hudRoute"),
  hudRuntime: $("#hudRuntime"),
  pauseOverlay: $("#pauseOverlay"),
  resultOverlay: $("#resultOverlay"),
  resultEyebrow: $("#resultEyebrow"),
  resultTitle: $("#resultTitle"),
  resultCopy: $("#resultCopy"),
  resultTime: $("#resultTime"),
  resultHits: $("#resultHits"),
  resultErrors: $("#resultErrors"),
  resultReplay: $("#resultReplay"),
  resultRestart: $("#resultRestart"),
  toast: $("#toast"),
  replayBar: $("#replayBar"),
  replayPlay: $("#replayPlay"),
  replayRange: $("#replayRange"),
  replayTime: $("#replayTime"),
  replayExit: $("#replayExit"),
  helpToggle: $("#helpToggle"),
  helpPanel: $("#helpPanel"),
};

const renderer = new YardRenderer(dom.canvas);
const audio = new RailAudio();
const SIM_RATE = 1.4;
const FIXED_STEP = 1 / 60;
const RECORD_INTERVAL = 0.05;
const MAX_REPLAY_FRAMES = 15000;

let seed = 7;
let simulation = new YardSimulation({ seed });
let paused = false;
let accumulator = 0;
let lastTimestamp = performance.now();
let runFrames = [];
let toastTimer = null;
let resultTimer = null;
let lastUiKey = "";
let lastQueueSignature = "";
let muted = false;

const replay = {
  active: false,
  playing: true,
  index: 0,
  cursor: 0,
  wasPaused: false,
};

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function windLabel(environment) {
  const arrow = environment.windDirection > 0 ? "→" : "←";
  return `${arrow} ${environment.windSpeed.toFixed(1)} m/s`;
}

function showToast(message, danger = false, duration = 2600) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("danger", danger);
  dom.toast.classList.add("show");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), duration);
}

function updateRangeProgress(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const progress = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--range-progress", `${progress}%`);
}

function currentFrame() {
  return replay.active ? runFrames[replay.index] ?? runFrames.at(-1) : simulation.capture();
}

function displayFrame() {
  return currentFrame();
}

function recordFrame(force = false) {
  if (replay.active) return;
  const last = runFrames.at(-1);
  if (!force && last && simulation.elapsed - last.elapsed < RECORD_INTERVAL) return;
  if (last && Math.abs(simulation.elapsed - last.elapsed) < 0.0001) {
    if (force) runFrames[runFrames.length - 1] = simulation.capture();
    return;
  }
  runFrames.push(simulation.capture());
  if (runFrames.length > MAX_REPLAY_FRAMES) runFrames.shift();
  dom.replayBtn.disabled = runFrames.length < 2;
  dom.resultReplay.disabled = runFrames.length < 2;
}

function updateStaticUi() {
  const frame = displayFrame();
  dom.grade.textContent = `${frame.environment.gradePercent.toFixed(2)}%`;
  dom.wind.textContent = windLabel(frame.environment);
  dom.parked.textContent = String(frame.parkedCount ?? 0);
  dom.clock.textContent = formatTime(frame.elapsed);
  dom.hudEnv.textContent = `${frame.environment.gradePercent.toFixed(1)}% · ${frame.environment.windSpeed.toFixed(1)} m/s`;
  dom.hudRoute.textContent = DESTINATIONS[frame.selectedRoute].name;

  let runtime = "待命";
  if (replay.active) runtime = replay.playing ? "回放中" : "回放暂停";
  else if (paused) runtime = "作业暂停";
  else if (frame.phase === "running") runtime = "溜放中";
  else if (frame.phase === "success") runtime = "编组完成";
  else if (frame.phase === "failure") runtime = "作业中止";
  dom.hudRuntime.textContent = runtime;

  for (let route = 0; route < DESTINATIONS.length; route += 1) {
    const count = frame.laneCounts?.[route] ?? 0;
    dom.routeButtons[route].querySelector(".route-cap b").textContent = String(count);
    dom.routeButtons[route].classList.toggle("active", route === frame.selectedRoute);
  }
  dom.replayPlay.textContent = replay.playing ? "Ⅱ" : "▶";
}

function rebuildQueue(frame) {
  const signature = `${frame.nextIndex}:${frame.phase}`;
  if (signature === lastQueueSignature) return;
  lastQueueSignature = signature;
  dom.queueStrip.replaceChildren();
  frame.cars.forEach((car) => {
    const chip = document.createElement("span");
    chip.className = "queue-car";
    chip.textContent = DESTINATIONS[routeForDestination(car.destination)].short;
    chip.style.setProperty("--car-color", DESTINATIONS[routeForDestination(car.destination)].color);
    chip.title = `${car.code} → ${DESTINATIONS[routeForDestination(car.destination)].name}`;
    if (car.index < frame.nextIndex) chip.classList.add("done");
    if (car.index === frame.nextIndex) chip.classList.add("current");
    dom.queueStrip.append(chip);
  });
  const label = document.createElement("span");
  label.className = "queue-label";
  label.textContent =
    frame.nextIndex >= frame.cars.length ? "全部发出" : `余 ${frame.cars.length - frame.nextIndex} 辆`;
  dom.queueStrip.append(label);
}

function updateUi() {
  const frame = displayFrame();
  updateStaticUi();
  rebuildQueue(frame);

  const car = frame.cars[frame.nextIndex] ?? null;
  const cutSignature = `${frame.nextIndex}:${frame.phase}:${car?.destination ?? "end"}`;
  if (cutSignature !== lastUiKey) {
    lastUiKey = cutSignature;
    if (car) {
      const destination = destinationForRoute(routeForDestination(car.destination));
      dom.cutNumber.textContent = String(car.index + 1).padStart(2, "0");
      dom.cutBadge.textContent = destination.short;
      dom.cutBadge.dataset.route = String(routeForDestination(car.destination));
      dom.cutDest.textContent = destination.name;
      dom.cutCode.textContent = car.code;
      dom.cutMeta.textContent = `第 ${car.index + 1} 钩 · ${car.mass} t · 待溜放`;
      dom.cutTicks.replaceChildren();
      for (let index = 0; index < 10; index += 1) {
        const tick = document.createElement("i");
        if (index < frame.nextIndex) tick.style.opacity = "0.2";
        if (index === frame.nextIndex) tick.style.background = destination.color;
        dom.cutTicks.append(tick);
      }
    } else {
      dom.cutNumber.textContent = "—";
      dom.cutBadge.textContent = "✓";
      dom.cutBadge.dataset.route = "0";
      dom.cutDest.textContent = frame.phase === "success" ? "编组完成" : "等待回场";
      dom.cutCode.textContent = "END";
      dom.cutMeta.textContent = "十节车厢已完成分类";
    }
  }

  dom.pushSpeed.value = String(simulation.settings.pushSpeed);
  dom.brakePoint.value = String(simulation.settings.brakePoint);
  dom.pushSpeedOut.textContent = `${simulation.settings.pushSpeed.toFixed(1)} m/s`;
  dom.brakePointOut.textContent = `${Math.round(simulation.settings.brakePoint)} m`;
  updateRangeProgress(dom.pushSpeed);
  updateRangeProgress(dom.brakePoint);

  const target = frame.targets?.[frame.selectedRoute] ?? simulation.targetForLane(frame.selectedRoute);
  const predicted = simulation.predictStoppingPoint({
    pushSpeed: simulation.settings.pushSpeed,
    brakePoint: simulation.settings.brakePoint,
  });
  const difference = predicted - target;
  const dangerouslyLate = predicted >= BUFFER_STOP;
  const className = dangerouslyLate || Math.abs(difference) > 11 ? "danger" : Math.abs(difference) > 5 ? "warn" : "";
  dom.prediction.className = `prediction${className ? ` ${className}` : ""}`;
  if (dangerouslyLate) {
    dom.predictionText.textContent = `预计越过止冲挡 · 目标 ${target.toFixed(0)} m`;
  } else {
    const tone = Math.abs(difference) <= 5 ? "命中" : difference > 0 ? "偏晚" : "偏早";
    dom.predictionText.textContent = `预计停在 ${predicted.toFixed(1)} m · 目标 ${target.toFixed(0)} m · ${tone}`;
  }

  const controlLocked = replay.active || paused || frame.phase === "failure" || frame.phase === "success";
  dom.routeButtons.forEach((button) => {
    button.disabled = controlLocked;
  });
  dom.pushSpeed.disabled = controlLocked;
  dom.brakePoint.disabled = controlLocked;
  dom.pauseBtn.disabled = replay.active || frame.phase !== "running";
  dom.replayBtn.disabled = runFrames.length < 2 && !replay.active;
  dom.replayBtn.lastElementChild.textContent = replay.active ? "退出回放" : "回放";

  dom.waitNote.className = "wait-note";
  if (replay.active) {
    dom.releaseBtn.disabled = true;
    dom.releaseLabel.textContent = "回放作业";
    dom.releaseHint.textContent = "退出回放后可继续";
    dom.waitNote.innerHTML = "<span></span>正在重建历史作业";
  } else if (paused) {
    dom.releaseBtn.disabled = true;
    dom.releaseLabel.textContent = "作业暂停";
    dom.releaseHint.textContent = "按 P 继续作业";
    dom.waitNote.className = "wait-note waiting";
    dom.waitNote.innerHTML = "<span></span>轮轨惯性已冻结";
  } else if (frame.phase === "success") {
    dom.releaseBtn.disabled = true;
    dom.releaseLabel.textContent = "编组完成";
    dom.releaseHint.textContent = "三列均已归位";
    dom.waitNote.innerHTML = "<span></span>未发生碰撞，作业完成";
  } else if (frame.phase === "failure") {
    dom.releaseBtn.disabled = true;
    dom.releaseLabel.textContent = "作业中止";
    dom.releaseHint.textContent = "查看回放或重新值班";
    dom.waitNote.className = "wait-note error";
    dom.waitNote.innerHTML = "<span></span>整列需回场重新编组";
  } else if (simulation.stalledCar) {
    dom.releaseBtn.disabled = false;
    dom.releaseLabel.textContent = "坡道补推前车";
    dom.releaseHint.textContent = "补推后仍需等待清空";
    dom.waitNote.className = "wait-note waiting";
    dom.waitNote.innerHTML = "<span></span>前车未清空，后车必须等待";
  } else if (simulation.canRelease) {
    dom.releaseBtn.disabled = false;
    dom.releaseLabel.textContent = "溜放本车";
    dom.releaseHint.textContent = "空格键发车";
    dom.waitNote.innerHTML = "<span></span>股道空闲，可以溜放";
  } else {
    dom.releaseBtn.disabled = true;
    dom.releaseLabel.textContent = frame.releaseGate?.open ? "无可溜放" : "等待前车";
    dom.releaseHint.textContent = frame.releaseGate?.reason ?? "前车尚未清空";
    dom.waitNote.className = "wait-note waiting";
    dom.waitNote.innerHTML = `<span></span>${frame.releaseGate?.reason ?? "等待股道清空"}`;
  }

  const pausedVisible = paused && !replay.active && frame.phase === "running";
  dom.pauseOverlay.classList.toggle("hidden", !pausedVisible);
  dom.pauseLabel.textContent = paused ? "继续" : "暂停";
  dom.pauseBtn.querySelector(".tool-icon").textContent = paused ? "▶" : "Ⅱ";
  dom.pauseBtn.title = paused ? "继续 (P)" : "暂停 (P)";
}

function showResult() {
  if (replay.active) return;
  const frame = simulation.capture();
  const stats = {
    time: formatTime(frame.elapsed),
    hits: frame.collisions,
    errors: frame.errors,
  };
  dom.resultTime.textContent = stats.time;
  dom.resultHits.textContent = String(stats.hits);
  dom.resultErrors.textContent = String(stats.errors);
  dom.resultReplay.disabled = runFrames.length < 2;
  dom.resultOverlay.classList.remove("hidden", "success", "failure");

  if (frame.phase === "success") {
    dom.resultOverlay.classList.add("success");
    dom.resultEyebrow.textContent = "MISSION COMPLETE / 作业完成";
    dom.resultTitle.textContent = "三列编组完成";
    dom.resultCopy.textContent = "十节车厢全部归位，三组股道均无碰撞。作业记录已写入回放。";
  } else {
    dom.resultOverlay.classList.add("failure");
    dom.resultEyebrow.textContent = "INCIDENT REPORT / 事故记录";
    const reason = frame.failure?.reason;
    if (reason === "rear-end") {
      dom.resultTitle.textContent = "车钩发生追尾";
      dom.resultCopy.textContent = `${frame.failure.detail}。前车占用股道时，后车必须等待其清空。整列回场重新编组。`;
    } else if (reason === "wrong-route") {
      dom.resultTitle.textContent = "错股，整列重编";
      dom.resultCopy.textContent = `${frame.failure.detail}。道岔顺序错误，本列作业作废并回场重新编组。`;
    } else if (reason === "buffer") {
      dom.resultTitle.textContent = "冲向止冲挡";
      dom.resultCopy.textContent = `${frame.failure.detail}。制动点过晚，整列回场重新编组。`;
    } else {
      dom.resultTitle.textContent = "作业中止";
      dom.resultCopy.textContent = "溜放过程发生异常，本列需回场重新编组。";
    }
  }
}

function scheduleResult() {
  window.clearTimeout(resultTimer);
  if (replay.active) return;
  resultTimer = window.setTimeout(showResult, 650);
}

function handleSimulationEvents() {
  const events = simulation.drainEvents();
  for (const event of events) {
    if (event.type === "switch") {
      audio.switchClack();
    } else if (event.type === "release") {
      audio.enable();
      audio.clack(0.3);
    } else if (event.type === "park") {
      audio.coupler();
      if (event.reason !== "soft-couple") {
        const route = destinationForRoute(event.route);
        showToast(`${simulation.cars.find((car) => car.id === event.carId)?.code ?? "车厢"} 已停入${route.name} · ${event.at} m`);
      }
    } else if (event.type === "stalled") {
      showToast(`制动过早，前车距清空点尚差 ${event.shortBy} m。请使用坡道补推。`, true, 3600);
    } else if (event.type === "rescue") {
      showToast("场务正在低速补推前车，后车保持等待。");
    } else if (event.type === "failure") {
      if (event.reason === "rear-end") audio.impact();
      else audio.chime(false);
      recordFrame(true);
      scheduleResult();
    } else if (event.type === "success") {
      audio.chime(true);
      recordFrame(true);
      scheduleResult();
    }
  }
}

async function ensureAudio() {
  if (!audio.enabled) await audio.enable();
  else if (audio.context?.state === "suspended") await audio.resume();
}

function selectRoute(route) {
  if (replay.active || paused || simulation.phase === "failure" || simulation.phase === "success") return;
  ensureAudio();
  const changed = simulation.selectedRoute !== route;
  simulation.setRoute(route);
  if (changed) {
    audio.switchClack();
    showToast(`道岔已锁向 ${destinationForRoute(route).name}`);
  }
  handleSimulationEvents();
}

function releaseCurrentCar() {
  if (replay.active || paused || simulation.phase === "failure" || simulation.phase === "success") return;
  ensureAudio();
  if (simulation.stalledCar) {
    const result = simulation.rescueStalledCar();
    if (!result.ok) showToast(result.reason, true);
    else {
      recordFrame(true);
      handleSimulationEvents();
      lastQueueSignature = "";
    }
    return;
  }

  const result = simulation.releaseCar(simulation.selectedRoute);
  if (!result.ok) {
    showToast(result.reason, true);
    return;
  }
  accumulator = 0;
  recordFrame(true);
  handleSimulationEvents();
  lastQueueSignature = "";
}

function setPaused(next) {
  if (replay.active || simulation.phase !== "running") return;
  paused = Boolean(next);
  accumulator = 0;
  if (!paused) ensureAudio();
  updateUi();
}

function togglePause() {
  if (replay.active) {
    toggleReplayPlay();
    return;
    }
  if (simulation.phase === "running") {
    setPaused(!paused);
  }
}

function resetRun() {
  seed = (seed * 1103515245 + 12345) >>> 0;
  simulation = new YardSimulation({ seed });
  paused = false;
  accumulator = 0;
  runFrames = [];
  lastQueueSignature = "";
  lastUiKey = "";
  replay.active = false;
  replay.playing = true;
  replay.index = 0;
  replay.cursor = 0;
  window.clearTimeout(resultTimer);
  dom.resultOverlay.classList.add("hidden");
  dom.pauseOverlay.classList.add("hidden");
  dom.replayBar.classList.add("hidden");
  dom.replayBtn.disabled = true;
  dom.resultReplay.disabled = true;
  dom.helpPanel.classList.add("hidden");
  dom.helpToggle.setAttribute("aria-expanded", "false");
  dom.brakePoint.value = "194";
  dom.pushSpeed.value = "4";
  updateRangeProgress(dom.brakePoint);
  updateRangeProgress(dom.pushSpeed);
  showToast(`新班次：坡度 ${simulation.environment.gradePercent.toFixed(2)}%，侧风 ${windLabel(simulation.environment)}`, false, 3200);
  recordFrame(true);
  updateUi();
}

function startReplay() {
  if (replay.active) {
    exitReplay();
    return;
  }
  if (runFrames.length < 2) {
    showToast("本班次记录尚不足以回放。", true);
    return;
  }
  ensureAudio();
  window.clearTimeout(resultTimer);
  replay.wasPaused = paused;
  paused = true;
  accumulator = 0;
  replay.active = true;
  replay.playing = true;
  replay.index = 0;
  replay.cursor = runFrames[0].elapsed;
  dom.resultOverlay.classList.add("hidden");
  dom.pauseOverlay.classList.add("hidden");
  dom.helpPanel.classList.add("hidden");
  dom.replayBar.classList.remove("hidden");
  dom.replayRange.max = String(runFrames.length - 1);
  dom.replayRange.value = "0";
  dom.replayTime.textContent = formatTime(runFrames[0].elapsed);
  dom.replayPlay.textContent = "Ⅱ";
  updateUi();
}

function exitReplay() {
  if (!replay.active) return;
  replay.active = false;
  replay.playing = false;
  paused = replay.wasPaused;
  dom.replayBar.classList.add("hidden");
  dom.pauseOverlay.classList.toggle("hidden", !(paused && simulation.phase === "running"));
  if (simulation.phase === "failure" || simulation.phase === "success") {
    showResult();
  }
  updateUi();
}

function toggleReplayPlay() {
  if (!replay.active) return;
  ensureAudio();
  if (!replay.playing && replay.index >= runFrames.length - 1) {
    replay.index = 0;
    replay.cursor = runFrames[0]?.elapsed ?? 0;
  }
  replay.playing = !replay.playing;
  dom.replayPlay.textContent = replay.playing ? "Ⅱ" : "▶";
}

function seekReplay(index) {
  if (!replay.active) return;
  const safeIndex = Math.max(0, Math.min(runFrames.length - 1, Number(index)));
  replay.index = safeIndex;
  replay.cursor = runFrames[safeIndex]?.elapsed ?? 0;
  replay.playing = false;
  dom.replayPlay.textContent = "▶";
  dom.replayRange.value = String(safeIndex);
  dom.replayTime.textContent = formatTime(replay.cursor);
  updateStaticUi();
}

function updateReplay(dt) {
  if (!replay.active || !replay.playing) return;
  replay.cursor += dt;
  let index = replay.index;
  while (index + 1 < runFrames.length && runFrames[index + 1].elapsed <= replay.cursor) {
    index += 1;
  }
  replay.index = index;
  if (index >= runFrames.length - 1) {
    replay.playing = false;
    replay.cursor = runFrames.at(-1).elapsed;
    dom.replayPlay.textContent = "▶";
  }
  dom.replayRange.value = String(index);
  dom.replayTime.textContent = formatTime(runFrames[index].elapsed);
}

function tick(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastTimestamp) / 1000));
  lastTimestamp = now;

  if (replay.active) {
    updateReplay(dt);
  } else if (!paused && simulation.phase === "running") {
    accumulator += dt * SIM_RATE;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 12 && simulation.phase === "running") {
      simulation.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    handleSimulationEvents();
    recordFrame();
  }

  updateUi();

  const frame = displayFrame();
  const preview = replay.active
    ? null
    : {
        progress: simulation.predictStoppingPoint(),
        target: simulation.targetForLane(simulation.selectedRoute),
      };
  renderer.draw(frame, {
    selectedRoute: frame.selectedRoute,
    targets: frame.targets,
    preview,
    replay: replay.active,
    releaseGate: frame.releaseGate,
  });

  audio.update({
    cars: frame.cars,
    paused: replay.active ? !replay.playing : paused,
    active: replay.active ? replay.playing : frame.phase === "running",
  });
  requestAnimationFrame(tick);
}

dom.routeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectRoute(Number(button.dataset.route));
  });
});

dom.pushSpeed.addEventListener("input", () => {
  simulation.setSettings({ pushSpeed: Number(dom.pushSpeed.value) });
  updateRangeProgress(dom.pushSpeed);
});

dom.brakePoint.addEventListener("input", () => {
  simulation.setSettings({ brakePoint: Number(dom.brakePoint.value) });
  updateRangeProgress(dom.brakePoint);
});

dom.releaseBtn.addEventListener("click", releaseCurrentCar);
dom.pauseBtn.addEventListener("click", togglePause);
dom.replayBtn.addEventListener("click", startReplay);
dom.resetBtn.addEventListener("click", resetRun);
dom.resultReplay.addEventListener("click", startReplay);
dom.resultRestart.addEventListener("click", resetRun);
dom.replayPlay.addEventListener("click", toggleReplayPlay);
dom.replayExit.addEventListener("click", exitReplay);
dom.replayRange.addEventListener("input", () => seekReplay(dom.replayRange.value));

dom.muteBtn.addEventListener("click", async () => {
  muted = !muted;
  if (!muted) await ensureAudio();
  audio.setMuted(muted);
  dom.muteIcon.textContent = muted ? "×" : "♪";
  dom.muteBtn.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
  dom.muteBtn.classList.toggle("muted", muted);
});

dom.helpToggle.addEventListener("click", () => {
  const hidden = dom.helpPanel.classList.toggle("hidden");
  dom.helpToggle.setAttribute("aria-expanded", String(!hidden));
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const tag = target?.tagName;
  const isFormField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (event.key === "Escape") {
    if (replay.active) exitReplay();
    else {
      dom.helpPanel.classList.add("hidden");
      dom.helpToggle.setAttribute("aria-expanded", "false");
    }
    return;
  }
  if (isFormField || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (tag !== "BUTTON") releaseCurrentCar();
  } else if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
  } else if (event.code === "KeyR") {
    event.preventDefault();
    if (replay.active) exitReplay();
    else startReplay();
  } else if (event.code === "Digit1") {
    selectRoute(0);
  } else if (event.code === "Digit2") {
    selectRoute(1);
  } else if (event.code === "Digit3") {
    selectRoute(2);
  } else if (event.code === "KeyM") {
    dom.muteBtn.click();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && simulation.phase === "running" && !replay.active && !paused) {
    setPaused(true);
  }
});

recordFrame(true);
updateUi();
renderer.draw(simulation.capture(), {
  selectedRoute: simulation.selectedRoute,
  targets: simulation.capture().targets,
  preview: {
    progress: simulation.predictStoppingPoint(),
    target: simulation.targetForLane(simulation.selectedRoute),
  },
  replay: false,
  releaseGate: simulation.capture().releaseGate,
});
requestAnimationFrame(tick);
