import { CoolingSim, HOTSPOT_LIMIT_C } from "./simulation.js";
import { FacilityRenderer, TrendRenderer } from "./render.js";
import { FanAudio } from "./audio.js";

const sim = new CoolingSim();
const facility = new FacilityRenderer(document.getElementById("facility-canvas"), sim, {
  onHover: showRackTooltip,
  onSelect: selectRack
});
const trend = new TrendRenderer(document.getElementById("trend-canvas"));
const audio = new FanAudio();

const dom = {
  clock: document.getElementById("sim-clock"),
  shiftState: document.getElementById("shift-state"),
  power: document.getElementById("top-power"),
  peak: document.getElementById("top-peak"),
  stability: document.getElementById("top-stability"),
  supply: document.getElementById("supply-readout"),
  coolant: document.getElementById("coolant-slider"),
  coolantValue: document.getElementById("coolant-value"),
  taskCount: document.getElementById("task-count"),
  waste: document.getElementById("waste-kwh"),
  faultIndicator: document.getElementById("fault-indicator"),
  faultButton: document.getElementById("fault-button"),
  focusId: document.getElementById("focus-id"),
  focusTemp: document.getElementById("focus-temp"),
  focusLoad: document.getElementById("focus-load"),
  focusHint: document.getElementById("focus-hint"),
  migrate: document.getElementById("migrate-button"),
  eventList: document.getElementById("event-list"),
  dayProgress: document.getElementById("day-progress"),
  speedLabel: document.getElementById("speed-label"),
  tooltip: document.getElementById("rack-tooltip"),
  audioToggle: document.getElementById("audio-toggle"),
  reset: document.getElementById("reset-button"),
  checks: {
    migration: document.getElementById("check-migration"),
    fault: document.getElementById("check-fault")
  },
  demo: document.getElementById("auto-demo"),
  summary: document.getElementById("summary-modal"),
  summaryGrade: document.getElementById("summary-grade"),
  summaryTitle: document.getElementById("summary-title"),
  summaryCopy: document.getElementById("summary-copy"),
  summaryMetrics: document.getElementById("summary-metrics"),
  summaryClose: document.getElementById("summary-close"),
  toastStack: document.getElementById("toast-stack")
};

let speed = 4;
let paused = false;
let previousSpeed = 4;
let lastFrame = performance.now();
let stepAccumulator = 0;
let uiAccumulator = 0;
let lastEventId = 0;
let lastHistoryLength = -1;
let summaryShown = false;
let lastAutoToastAt = -Infinity;

const initialRack = sim.racks
  .filter((rack) => rack.tasks.length > 0)
  .sort((a, b) => b.tempC - a.tempC)[0];
sim.selectRack(initialRack?.id ?? "R2-05");

function setSpeed(nextSpeed) {
  speed = nextSpeed;
  paused = false;
  previousSpeed = nextSpeed || previousSpeed;
  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === nextSpeed);
  });
  updateSpeedLabel();
}

function togglePause() {
  if (paused) {
    paused = false;
    speed = previousSpeed || 4;
  } else {
    previousSpeed = speed;
    paused = true;
  }
  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.classList.toggle("active", !paused && Number(button.dataset.speed) === speed);
  });
  updateSpeedLabel();
  updateUI(sim.stats(), true);
}

function updateSpeedLabel() {
  dom.speedLabel.textContent = paused ? "已暂停 · 检查热场" : `${speed}× · 推演时标`;
}

function selectRack(rack) {
  sim.selectRack(rack.id);
  updateFocus();
}

function showRackTooltip(rack, event) {
  if (!rack || !event) {
    dom.tooltip.style.display = "none";
    return;
  }
  const stage = dom.tooltip.parentElement.getBoundingClientRect();
  const x = Math.min(event.clientX - stage.left + 14, stage.width - 165);
  const y = Math.min(event.clientY - stage.top + 14, stage.height - 88);
  dom.tooltip.innerHTML = `<b>${rack.id} · ${rack.rowName} 排</b>${rack.tempC.toFixed(1)}°C · ${rack.loadKw.toFixed(1)} kW<br>${rack.tasks.length} 个任务 · 热点 ${rack.hotspotMinutes} min<br>${rack.hotspotMinutes >= 24 ? "自动迁移阈值已达" : "点击查看调度"}`;
  dom.tooltip.style.display = "block";
  dom.tooltip.style.left = `${Math.max(4, x)}px`;
  dom.tooltip.style.top = `${Math.max(4, y)}px`;
}

function updateFocus() {
  const rack = sim.rack(sim.selectedRackId) ?? sim.racks[0];
  const target = sim.bestMigrationTarget(rack, true);
  dom.focusId.textContent = rack.id;
  dom.focusTemp.textContent = `${rack.tempC.toFixed(1)}°`;
  dom.focusLoad.textContent = `${rack.loadKw.toFixed(1)} kW · ${rack.tasks.length} 任务`;
  dom.focusTemp.style.color =
    rack.tempC >= HOTSPOT_LIMIT_C ? "var(--coral)" : rack.tempC >= 26 ? "var(--amber)" : "var(--text)";
  if (!rack.tasks.length) {
    dom.focusHint.textContent = "当前机柜没有可迁移任务";
  } else if (target) {
    dom.focusHint.textContent = `目标 ${target.id} · ${target.tempC.toFixed(1)}°C`;
  } else {
    dom.focusHint.textContent = "暂无跨排冷目标";
  }
  dom.migrate.disabled = !sim.running || !rack.tasks.length || !target;
}

function triggerMigrate() {
  const rack = sim.rack(sim.selectedRackId);
  if (!rack) return;
  const target = sim.bestMigrationTarget(rack, true);
  if (!target || !sim.migrateTask(rack.id, target.id, false)) {
    toast("迁移未执行", "机柜没有任务或目标机柜已满载。", "fault");
    return;
  }
  toast("任务已迁移", `${rack.id} → ${target.id}，热负荷正在重新平衡。`);
  updateUI(sim.stats(), true);
}

function triggerFault() {
  if (!sim.triggerChillerFailure(90, false)) return;
  setSpeed(12);
  toast("冷却机离线", "供水温度将上升 90 分钟，热点迁移阈值已生效。", "fault");
  updateUI(sim.stats(), true);
}

function runDemo() {
  if (sim.finished) resetSimulation(false);
  const source = [...sim.racks]
    .filter((rack) => rack.tasks.length <= 3)
    .sort((a, b) => a.tempC - b.tempC)[0];
  sim.injectSurge(source?.id);
  sim.triggerChillerFailure(90, false);
  setSpeed(12);
  toast("组合演练已注入", "局部负载抬升 + 冷却机离线，观察自动迁移。", "fault");
  updateUI(sim.stats(), true);
}

function resetSimulation(showToast = true) {
  sim.reset();
  const rack = sim.racks.filter((candidate) => candidate.tasks.length > 0).sort((a, b) => b.tempC - a.tempC)[0];
  sim.selectRack(rack?.id ?? "R2-05");
  lastEventId = 0;
  lastHistoryLength = -1;
  summaryShown = false;
  paused = false;
  speed = 4;
  previousSpeed = 4;
  dom.summary.hidden = true;
  dom.coolant.value = sim.coolant;
  document.querySelectorAll("[data-fan]").forEach((input) => {
    input.value = sim.fan[Number(input.dataset.fan)];
  });
  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === 4);
  });
  updateSpeedLabel();
  updateUI(sim.stats(), true);
  if (showToast) toast("模拟已重置", "已回到 DAY 01 · 08:00。");
}

function toast(title, detail, type = "") {
  while (dom.toastStack.children.length >= 3) {
    dom.toastStack.firstElementChild.remove();
  }
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.innerHTML = `<b>${title}</b><span>${detail}</span>`;
  dom.toastStack.appendChild(element);
  window.setTimeout(() => {
    element.style.opacity = "0";
    element.style.transform = "translateY(5px)";
    window.setTimeout(() => element.remove(), 300);
  }, 4200);
}

function updateUI(stats, forceEvents = false) {
  dom.clock.textContent = stats.clock;
  dom.shiftState.textContent = stats.finished
    ? "已完成"
    : !stats.chillerOnline
      ? "故障中"
      : paused
        ? "已暂停"
        : "运行中";
  dom.shiftState.className = `status-pill ${paused || stats.finished ? "paused" : ""} ${!stats.chillerOnline ? "fault" : ""}`;

  dom.power.textContent = `${stats.totalKw.toFixed(0)} kW`;
  dom.peak.textContent = `${stats.peak15Kw.toFixed(0)} kW`;
  dom.peak.classList.toggle("accent", stats.peak15Kw >= 590);
  dom.stability.textContent = `${stats.stability.toFixed(1)}%`;
  dom.stability.classList.toggle("accent", stats.stability < 92);
  dom.supply.textContent = `供水 ${stats.supplyTemp.toFixed(1)}°C`;
  dom.coolantValue.textContent = `${sim.coolant}%`;
  document.querySelectorAll("[data-fan-value]").forEach((output) => {
    const row = Number(output.dataset.fanValue);
    output.textContent = `${sim.fan[row]}%`;
  });
  dom.taskCount.textContent = String(sim.tasks.length);
  dom.waste.textContent = stats.wasteKwh.toFixed(1);

  dom.faultIndicator.textContent = stats.chillerOnline
    ? "冷却机正常"
    : `冷却机离线 · ${stats.faultMinutesLeft}m`;
  dom.faultIndicator.classList.toggle("failed", !stats.chillerOnline);

  if (stats.chillerOnline) {
    dom.faultButton.disabled = !stats.running;
    dom.faultButton.innerHTML =
      '<span class="fault-icon">!</span><span><b>冷却机故障演练</b><small>离线 90 min · 可恢复</small></span><span class="fault-arrow">↗</span>';
  } else {
    dom.faultButton.disabled = true;
    dom.faultButton.innerHTML = `<span class="fault-icon">!</span><span><b>故障处理中</b><small>预计 ${stats.faultMinutesLeft} min 后恢复</small></span><span class="fault-arrow">·</span>`;
  }

  dom.dayProgress.style.width = `${(stats.progress * 100).toFixed(2)}%`;
  updateFocus();
  updateChecks();
  updateEvents(forceEvents);
  audio.update(
    sim.fan.reduce((sum, value) => sum + value, 0) / sim.fan.length,
    sim.coolant,
    sim.chiller.online
  );

  if (stats.finished && !summaryShown) showSummary();
}

function updateEvents(force = false) {
  const newestId = sim.events[0]?.id ?? 0;
  if (!force && newestId === lastEventId) return;

  const unseen = sim.events.filter((event) => event.id > lastEventId);
  if (lastEventId > 0 || force) {
    let autoToastShown = false;
    for (const event of unseen.reverse()) {
      if (event.type === "auto-migration") {
        if (autoToastShown || performance.now() - lastAutoToastAt < 10000) continue;
        autoToastShown = true;
        lastAutoToastAt = performance.now();
        toast(event.title, event.detail);
      } else if (event.type === "fault" || event.type === "recovery") {
        toast(event.title, event.detail, event.type === "fault" ? "fault" : "");
      }
    }
  }
  lastEventId = Math.max(lastEventId, newestId);
  dom.eventList.innerHTML = sim.events
    .slice(0, 9)
    .map(
      (event) => `
        <div class="event-row">
          <time>${event.time.slice(-5)}</time>
          <i class="event-marker ${event.type}"></i>
          <div class="event-copy"><b>${event.title}</b><p>${event.detail}</p></div>
        </div>`
    )
    .join("");
}

function updateChecks() {
  const migration = sim.events.find((event) => event.type === "auto-migration" || event.type === "migration");
  const fault = sim.events.find((event) => event.type === "fault");
  const recovery = sim.events.find((event) => event.type === "recovery");

  updateCheck(
    dom.checks.migration,
    Boolean(migration),
    "热点迁移",
    migration
      ? `${migration.type === "auto-migration" ? "自动" : "手动"} · ${migration.rackId}→${migration.targetRackId}`
      : "等待演练"
  );
  updateCheck(
    dom.checks.fault,
    Boolean(fault),
    "冷却机故障",
    fault
      ? recovery
        ? "已离线并恢复"
        : `离线中 · 余 ${Math.max(0, sim.chiller.failedUntil - sim.elapsedMin)} min`
      : "等待演练"
  );
}

function updateCheck(element, passed, label, detail) {
  element.classList.toggle("passed", passed);
  element.querySelector("b").textContent = label;
  element.querySelector("small").textContent = detail;
  element.querySelector(".check-icon").textContent = passed ? "✓" : "·";
}

function showSummary() {
  const summary = sim.summary();
  summaryShown = true;
  dom.summaryGrade.textContent = summary.grade;
  dom.summaryGrade.dataset.grade = summary.grade;
  dom.summaryTitle.textContent = summary.headline;
  dom.summaryCopy.textContent = `${summary.notes.join(" · ")}。稳定性 ${summary.stability.toFixed(1)}%，过冷 ${summary.overcoolMinutes} min。`;
  dom.summaryMetrics.innerHTML = `
    <div><span>总耗电</span><strong>${summary.totalKwh.toFixed(0)} kWh</strong></div>
    <div><span>15 MIN 峰值</span><strong>${summary.peak15Kw.toFixed(0)} kW</strong></div>
    <div><span>自动迁移</span><strong>${summary.autoMigrations} 次</strong></div>`;
  dom.summary.hidden = false;
}

function frame(now) {
  const delta = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  if (sim.running && !paused) {
    stepAccumulator += delta * speed;
    let steps = 0;
    while (stepAccumulator >= 1 && steps < 60) {
      sim.step(1);
      stepAccumulator -= 1;
      steps += 1;
      if (!sim.running) break;
    }
  }

  facility.draw(now);
  if (sim.history.length !== lastHistoryLength) {
    trend.draw(sim);
    lastHistoryLength = sim.history.length;
  }

  uiAccumulator += delta;
  if (uiAccumulator >= 0.2 || !sim.running) {
    updateUI(sim.stats());
    uiAccumulator = 0;
  }
  requestAnimationFrame(frame);
}

document.querySelectorAll("[data-fan]").forEach((input) => {
  input.addEventListener("input", () => {
    const row = Number(input.dataset.fan);
    sim.setFan(row, input.value);
    document.querySelector(`[data-fan-value="${row}"]`).textContent = `${sim.fan[row]}%`;
    updateUI(sim.stats(), true);
  });
});

dom.coolant.addEventListener("input", () => {
  sim.setCoolant(dom.coolant.value);
  dom.coolantValue.textContent = `${sim.coolant}%`;
  updateUI(sim.stats(), true);
});

dom.migrate.addEventListener("click", triggerMigrate);
dom.faultButton.addEventListener("click", triggerFault);
dom.demo.addEventListener("click", runDemo);
dom.reset.addEventListener("click", () => resetSimulation(true));
dom.summaryClose.addEventListener("click", () => {
  dom.summary.hidden = true;
});

document.querySelectorAll("[data-speed]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextSpeed = Number(button.dataset.speed);
    if (nextSpeed === 0) togglePause();
    else setSpeed(nextSpeed);
    updateUI(sim.stats(), true);
  });
});

dom.audioToggle.addEventListener("click", async () => {
  const enabled = await audio.toggle();
  dom.audioToggle.setAttribute("aria-pressed", String(enabled));
  dom.audioToggle.querySelector("span").textContent = enabled ? "静音" : "声场";
  audio.update(
    sim.fan.reduce((sum, value) => sum + value, 0) / sim.fan.length,
    sim.coolant,
    sim.chiller.online
  );
  if (!audio.context) toast("音频不可用", "当前浏览器不支持 Web Audio。");
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
    updateUI(sim.stats(), true);
  }
  if (event.key.toLowerCase() === "r") resetSimulation(true);
});

window.setTimeout(() => {
  toast("24H 值守开始", "先用低风量寻找节能平衡，再处理周期负载与故障。");
}, 500);

updateSpeedLabel();
updateUI(sim.stats(), true);
trend.draw(sim);
lastHistoryLength = sim.history.length;
requestAnimationFrame(frame);
