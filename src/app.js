import { PRIORITIES, TASK_COUNT } from "./config.js";
import { WarehouseAudio } from "./audio.js";
import { WarehouseRenderer } from "./renderer.js";
import { WarehouseSim } from "./sim.js";

const sim = new WarehouseSim();
const canvas = document.getElementById("warehouseCanvas");
const canvasWrap = document.getElementById("canvasWrap");
const renderer = new WarehouseRenderer(canvas, sim);
const audio = new WarehouseAudio();

const elements = {
  clock: document.getElementById("clock"),
  doneCount: document.getElementById("doneCount"),
  avgBattery: document.getElementById("avgBattery"),
  progressRing: document.getElementById("progressRing"),
  progressPct: document.getElementById("progressPct"),
  progressFill: document.getElementById("progressFill"),
  progressValue: document.getElementById("progressValue"),
  densityValue: document.getElementById("densityValue"),
  densityMeter: document.getElementById("densityMeter"),
  densityFooter: document.getElementById("densityFooter"),
  densityBars: document.getElementById("densityBars"),
  waitValue: document.getElementById("waitValue"),
  waitMeter: document.getElementById("waitMeter"),
  chargeQueueValue: document.getElementById("chargeQueueValue"),
  deadlockValue: document.getElementById("deadlockValue"),
  deadlockFoot: document.getElementById("deadlockFoot"),
  deadlockKpi: document.getElementById("deadlockKpi"),
  deadlockAlert: document.getElementById("deadlockAlert"),
  deadlockRobots: document.getElementById("deadlockRobots"),
  playButton: document.getElementById("playButton"),
  playText: document.querySelector("#playButton .play-text"),
  resetButton: document.getElementById("resetButton"),
  scenarioButton: document.getElementById("scenarioButton"),
  runStateLabel: document.getElementById("runStateLabel"),
  speedButtons: document.getElementById("speedButtons"),
  audioButton: document.getElementById("audioButton"),
  audioLabel: document.getElementById("audioLabel"),
  audioState: document.getElementById("audioState"),
  soundWave: document.getElementById("soundWave"),
  inspectTool: document.getElementById("inspectTool"),
  blockTool: document.getElementById("blockTool"),
  clearZonesButton: document.getElementById("clearZonesButton"),
  zoneCount: document.getElementById("zoneCount"),
  toolHint: document.getElementById("toolHint"),
  taskList: document.getElementById("taskList"),
  openTaskCount: document.getElementById("openTaskCount"),
  eventTicker: document.getElementById("eventTicker"),
  inspectorName: document.getElementById("inspectorName"),
  inspectorStatus: document.getElementById("inspectorStatus"),
  inspectorBattery: document.getElementById("inspectorBattery"),
  robotInspector: document.getElementById("robotInspector"),
  loopYieldToggle: document.getElementById("loopYieldToggle"),
  lowBatteryToggle: document.getElementById("lowBatteryToggle"),
  fairQueueToggle: document.getElementById("fairQueueToggle"),
  fixDeadlockButton: document.getElementById("fixDeadlockButton"),
  resultModal: document.getElementById("resultModal"),
  resultKicker: document.getElementById("resultKicker"),
  resultTitle: document.getElementById("resultTitle"),
  resultCopy: document.getElementById("resultCopy"),
  resultRate: document.getElementById("resultRate"),
  resultDone: document.getElementById("resultDone"),
  resultDeadlocks: document.getElementById("resultDeadlocks"),
  resultResetButton: document.getElementById("resultResetButton"),
};

let selectedRobotId = "R01";
let tool = "inspect";
let isPainting = false;
let lastPaintedCell = "";
let taskSignature = "";
let eventVersion = -1;
let lastDeadlockId = null;
let resultShown = false;
let lastUiUpdate = 0;
let lastTimestamp = performance.now();
let toolHintTimer = null;

const formatClock = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const taskStatusLabel = (task) => {
  if (task.status === "assigned") return "取货中";
  if (task.status === "carrying") return "运输中";
  const robot = task.robotId ? sim.robots.find((item) => item.id === task.robotId) : null;
  if (robot?.waitTicks > 2 || robot?.state === "ring") return "等待";
  if (task.scheduled > sim.elapsed) return formatClock(task.scheduled);
  return "待派";
};

const taskStatusClass = (task) => {
  const label = taskStatusLabel(task);
  return label === "等待" ? "waiting" : "";
};

function renderTaskList() {
  const tasks = [...sim.tasks]
    .filter((task) => task.status !== "done")
    .sort((a, b) => {
      const aActive = a.status === "assigned" || a.status === "carrying";
      const bActive = b.status === "assigned" || b.status === "carrying";
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive && bActive) return a.scheduled - b.scheduled;
      return a.priority - b.priority || a.scheduled - b.scheduled;
    });

  elements.openTaskCount.textContent = String(sim.openTaskCount);
  if (!tasks.length) {
    elements.taskList.innerHTML = '<div class="empty-tasks">固定序列已全部完成</div>';
    return;
  }

  const html = tasks
    .map((task) => {
      const active = task.status === "assigned" || task.status === "carrying";
      const priority = PRIORITIES[task.priority];
      const progress = active ? Math.round(task.progress * 100) : 0;
      return `
        <div class="task-row ${active ? "active" : ""} ${task.priority === 1 ? "urgent" : ""}" data-task-id="${task.id}">
          <div class="task-main">
            <div class="task-id-line">
              <b>${task.id}</b>
              <span>${formatClock(task.scheduled)}</span>
              <span class="task-state ${taskStatusClass(task)}">${taskStatusLabel(task)}</span>
            </div>
            <div class="task-route"><strong>${task.sourceId}</strong> → <strong>${task.destId}</strong> · ${priority.label}</div>
            <div class="task-progress"><i style="width:${progress}%"></i></div>
          </div>
          <button class="priority-button" type="button" data-priority="${task.priority}" title="点击切换优先级">
            <span>${priority.code}</span>
            <span class="priority-pips"><i></i><i></i><i></i></span>
          </button>
        </div>`;
    })
    .join("");
  elements.taskList.innerHTML = html;
}

function getTaskSignature() {
  return sim.tasks
    .map((task) => `${task.id}:${task.status}:${task.priority}`)
    .join("|");
}

function updateEventTicker() {
  if (eventVersion === sim.uiVersion && elements.eventTicker.childElementCount) return;
  eventVersion = sim.uiVersion;
  const visible = sim.eventLog.slice(0, 4).reverse();
  elements.eventTicker.replaceChildren();
  for (const event of visible) {
    const span = document.createElement("span");
    span.className = event.tone;
    const time = document.createElement("b");
    time.textContent = formatClock(event.time);
    span.append(time, document.createTextNode(event.text));
    elements.eventTicker.append(span);
  }
}

function updateUI(force = false) {
  const now = performance.now();
  if (!force && now - lastUiUpdate < 85) return;
  lastUiUpdate = now;
  const density = sim.density;
  const battery = Math.round(sim.averageBattery);
  const wait = Math.round(sim.averageWaitSeconds);
  const progress = sim.completionRate;
  const progressPct = Math.floor(progress * 100);
  const deadlock = sim.deadlockActive;

  elements.clock.textContent = formatClock(sim.elapsed);
  elements.doneCount.textContent = String(sim.stats.done);
  elements.avgBattery.textContent = `${battery}%`;
  elements.progressPct.textContent = `${progressPct}%`;
  elements.progressValue.textContent = String(sim.stats.done);
  elements.progressRing.style.strokeDashoffset = String(169.6 * (1 - progress));
  elements.progressFill.style.width = `${Math.min(100, progress * 100)}%`;
  elements.densityValue.textContent = `${Math.round(density * 100)}%`;
  elements.densityMeter.style.width = `${density * 100}%`;
  elements.densityFooter.textContent = `${Math.round(density * 100)}%`;
  elements.waitValue.textContent = String(wait);
  elements.waitMeter.style.width = `${Math.min(100, wait * 2)}%`;
  elements.chargeQueueValue.textContent = String(sim.chargingQueueCount);
  elements.deadlockValue.textContent = deadlock ? String(deadlock.robotIds.length) : "0";
  elements.deadlockFoot.textContent = deadlock
    ? "闭环锁定"
    : sim.stats.resolvedDeadlocks
      ? `已修复 ${sim.stats.resolvedDeadlocks}`
      : "监测中";
  elements.deadlockKpi.classList.toggle("has-deadlock", Boolean(deadlock));
  elements.deadlockAlert.hidden = !deadlock;
  if (deadlock) {
    const loop = [...deadlock.robotIds, deadlock.robotIds[0]].join(" → ");
    elements.deadlockRobots.textContent = loop;
    if (deadlock.id !== lastDeadlockId) {
      lastDeadlockId = deadlock.id;
      audio.alarm();
    }
  }

  elements.playText.textContent = sim.stats.finished
    ? "重启"
    : sim.running
      ? "暂停"
      : "继续";
  elements.playButton.classList.toggle("is-paused", !sim.running || sim.stats.finished);
  elements.runStateLabel.textContent = sim.stats.finished
    ? "已结束"
    : sim.running
      ? "运行中"
      : "已暂停";
  elements.zoneCount.textContent = String(sim.noGo.size);
  elements.audioState.textContent = audio.enabled ? "密度联动" : "待机";

  const activeBars = Math.round(density * 8);
  [...elements.densityBars.children].forEach((bar, index) => {
    bar.classList.toggle("active", index < activeBars);
    bar.style.height = `${index < activeBars ? 38 + index * 8 : 15 + index * 2}%`;
  });
  [...elements.soundWave.children].forEach((bar, index) => {
    const wave = 18 + ((index * 13 + Math.round(density * 81)) % 70);
    bar.style.height = audio.enabled ? `${Math.min(100, wave + density * 24)}%` : "7%";
  });

  const robot = sim.robots.find((item) => item.id === selectedRobotId) ?? sim.robots[0];
  selectedRobotId = robot.id;
  elements.inspectorName.textContent = robot.id;
  elements.inspectorStatus.textContent = sim.statusText(robot);
  elements.inspectorBattery.textContent = `${Math.round(robot.battery)}%`;
  elements.robotInspector.classList.toggle("low", robot.battery < 25);

  const signature = getTaskSignature();
  if (signature !== taskSignature) {
    taskSignature = signature;
    renderTaskList();
  }
  updateEventTicker();
  audio.setDensity(density);
  renderer.setSelected(selectedRobotId);

  if (sim.stats.finished && !resultShown) {
    resultShown = true;
    window.setTimeout(showResult, 320);
  }
}

function showResult() {
  if (!sim.stats.finished) return;
  const success = sim.stats.success;
  const rate = Math.round(sim.completionRate * 100);
  elements.resultModal.hidden = false;
  elements.resultKicker.textContent = success ? "SHIFT COMPLETE" : "SHIFT EXCEPTION";
  elements.resultTitle.textContent = success
    ? "班次达标"
    : sim.stats.endReason === "deadlock"
      ? "环路未解除"
      : "吞吐未达标";
  if (success && sim.stats.resolvedDeadlocks > 0) {
    elements.resultCopy.textContent =
      "完成率超过 80%，所有环形等待均已通过让行规则解除，仓库恢复流动。";
  } else if (success) {
    elements.resultCopy.textContent =
      "完成率超过 80%，班次内未出现未解除的环路等待。";
  } else if (sim.stats.endReason === "deadlock") {
    elements.resultCopy.textContent =
      "结束时仍有闭环等待。启用「环路让行」后再跑一局。";
  } else {
    elements.resultCopy.textContent =
      "结束前未完成 80% 的任务。重新安排优先级或缩小禁行范围。";
  }
  elements.resultRate.textContent = `${rate}%`;
  elements.resultDone.textContent = `${sim.stats.done} / ${TASK_COUNT}`;
  elements.resultDeadlocks.textContent = `${sim.stats.deadlocks} · 修复 ${sim.stats.resolvedDeadlocks}`;
  if (success) audio.success();
  else audio.alarm();
}

function syncRuleUI() {
  elements.loopYieldToggle.checked = sim.rules.loopYield;
  elements.lowBatteryToggle.checked = sim.rules.lowBattery;
  elements.fairQueueToggle.checked = sim.rules.fairQueue;
}

function setSpeed(speed) {
  sim.setSpeed(speed);
  [...elements.speedButtons.children].forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  });
}

function resetGame() {
  sim.reset();
  selectedRobotId = "R01";
  renderer.setSelected(selectedRobotId);
  resultShown = false;
  lastDeadlockId = null;
  taskSignature = "";
  eventVersion = -1;
  elements.resultModal.hidden = true;
  syncRuleUI();
  setSpeed(4);
  setTool("inspect");
  updateUI(true);
}

function setTool(nextTool) {
  tool = nextTool;
  renderer.setTool(tool);
  elements.inspectTool.classList.toggle("active", tool === "inspect");
  elements.blockTool.classList.toggle("active", tool === "block");
  elements.toolHint.textContent =
    tool === "block" ? "当前：布设临时禁行区" : "当前：查看机器人";
  canvasWrap.style.cursor = tool === "block" ? "cell" : "crosshair";
}

function flashToolHint(message) {
  if (toolHintTimer) window.clearTimeout(toolHintTimer);
  elements.toolHint.textContent = message;
  toolHintTimer = window.setTimeout(() => {
    elements.toolHint.textContent =
      tool === "block" ? "当前：布设临时禁行区" : "当前：查看机器人";
  }, 2300);
}

function paintZone(cell) {
  if (!cell) return;
  const key = `${cell.x},${cell.y}`;
  if (key === lastPaintedCell) return;
  lastPaintedCell = key;
  const changed = sim.toggleNoGo(cell.x, cell.y);
  if (!changed) flashToolHint("该网格为设备区或正被机器人占用");
  updateUI(true);
}

function selectRobotAt(cell) {
  if (!cell) return;
  const robot = sim.robotAt(cell.x, cell.y);
  if (!robot) return;
  selectedRobotId = robot.id;
  renderer.setSelected(robot.id);
  updateUI(true);
}

function toggleRun() {
  if (sim.stats.finished) {
    resetGame();
    return;
  }
  sim.setRunning(!sim.running);
  if (sim.running && audio.enabled && audio.context?.state === "suspended") {
    audio.context.resume();
  }
  updateUI(true);
}

function startScenario() {
  if (sim.elapsed >= 130 || sim.stats.finished) resetGame();
  sim.setRunning(true);
  sim.jumpTo(130);
  setSpeed(4);
  syncRuleUI();
  lastDeadlockId = null;
  updateUI(true);
}

elements.playButton.addEventListener("click", toggleRun);
elements.resetButton.addEventListener("click", resetGame);
elements.resultResetButton.addEventListener("click", resetGame);
elements.scenarioButton.addEventListener("click", startScenario);

elements.speedButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-speed]");
  if (!button) return;
  setSpeed(Number(button.dataset.speed));
});

elements.audioButton.addEventListener("click", async () => {
  const enabled = await audio.toggle();
  elements.audioButton.classList.toggle("is-muted", !enabled);
  elements.audioLabel.textContent = enabled ? "音景开" : "音景关";
  elements.audioState.textContent = enabled ? "密度联动" : "待机";
  updateUI(true);
});

for (const [key, element] of [
  ["loopYield", elements.loopYieldToggle],
  ["lowBattery", elements.lowBatteryToggle],
  ["fairQueue", elements.fairQueueToggle],
]) {
  element.addEventListener("change", () => {
    sim.setRule(key, element.checked);
    lastDeadlockId = null;
    updateUI(true);
  });
}

elements.fixDeadlockButton.addEventListener("click", () => {
  elements.loopYieldToggle.checked = true;
  sim.setRule("loopYield", true);
  lastDeadlockId = null;
  audio.chime(540, 0.055, 0.16);
  updateUI(true);
});

elements.taskList.addEventListener("click", (event) => {
  const button = event.target.closest(".priority-button");
  if (!button) return;
  const row = button.closest(".task-row");
  if (!row) return;
  sim.cyclePriority(row.dataset.taskId);
  updateUI(true);
});

elements.inspectTool.addEventListener("click", () => setTool("inspect"));
elements.blockTool.addEventListener("click", () => setTool("block"));
elements.clearZonesButton.addEventListener("click", () => {
  sim.clearNoGo();
  updateUI(true);
});

canvas.addEventListener("pointerdown", (event) => {
  const cell = renderer.cellFromPoint(event.clientX, event.clientY);
  if (!cell) return;
  if (tool === "block") {
    isPainting = true;
    lastPaintedCell = "";
    canvas.setPointerCapture?.(event.pointerId);
    paintZone(cell);
  } else {
    selectRobotAt(cell);
  }
});

canvas.addEventListener("pointermove", (event) => {
  const cell = renderer.cellFromPoint(event.clientX, event.clientY);
  renderer.setHover(cell);
  if (isPainting && tool === "block") paintZone(cell);
});

canvas.addEventListener("pointerleave", () => {
  if (!isPainting) renderer.setHover(null);
});

canvas.addEventListener("pointerup", () => {
  isPainting = false;
  lastPaintedCell = "";
});

window.addEventListener("pointerup", () => {
  isPainting = false;
  lastPaintedCell = "";
});

canvas.addEventListener("dblclick", () => {
  sim.clearNoGo();
  updateUI(true);
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    toggleRun();
  } else if (event.key === "b" || event.key === "B") {
    setTool("block");
  } else if (event.key === "v" || event.key === "V") {
    setTool("inspect");
  }
});

const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(canvasWrap);
window.addEventListener("resize", () => renderer.resize());

function frame(timestamp) {
  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  sim.update(delta);
  renderer.draw(timestamp);
  updateUI();
  requestAnimationFrame(frame);
}

syncRuleUI();
setSpeed(4);
setTool("inspect");
updateUI(true);
requestAnimationFrame(frame);
