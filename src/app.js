import {
  AIRCRAFT,
  EVENTS,
  MAX_TIME,
  SPEEDS,
  TFR,
  WEATHER,
  cloneConfig
} from "./scenario.js";
import {
  createSimulation,
  runPriorityAudit,
  stepSimulation
} from "./simulation.js";
import { AirspaceRenderer } from "./renderer.js";
import { AirspaceAudio } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const refs = {
  canvas: $("#airspace"),
  clock: $("#missionClock"),
  sceneState: $("#sceneState"),
  startButton: $("#startButton"),
  startLabel: $("#startButtonLabel"),
  pauseButton: $("#pauseButton"),
  pauseIcon: $("#pauseIcon"),
  resetButton: $("#resetButton"),
  speedButton: $("#speedButton"),
  presetButton: $("#presetButton"),
  audioToggle: $("#audioToggle"),
  audioLabel: $(".audio-label"),
  audioStatus: $("#audioStatus"),
  audioReadout: $(".audio-readout"),
  weatherFlag: $("#weatherFlag"),
  weatherTimer: $("#weatherTimer"),
  densityValue: $("#densityValue"),
  densityBars: $("#densityBars"),
  progress: $("#runProgress"),
  progressTime: $("#progressTime"),
  phaseLabel: $("#phaseLabel"),
  timelineProgress: $("#timelineProgress"),
  timelineCursor: $("#timelineCursor"),
  timelineEvents: $("#timelineEvents"),
  eventTick1: $("#eventTick1"),
  eventTick2: $("#eventTick2"),
  eventFeed: $("#eventFeed"),
  sequenceTag: $("#sequenceTag"),
  flightList: $("#flightList"),
  runResult: $("#runResult"),
  resultTag: $("#resultTag"),
  resultTitle: $("#resultTitle"),
  resultCopy: $("#resultCopy"),
  resultMetrics: $("#resultMetrics"),
  resultReset: $("#resultReset"),
  resultAudit: $("#resultAudit"),
  auditButton: $("#auditButton"),
  auditDigest: $("#auditDigest"),
  auditDialog: $("#auditDialog"),
  auditClose: $("#auditClose"),
  auditDone: $("#auditDone"),
  auditSummary: $("#auditSummary"),
  auditBaseline: $("#auditBaseline"),
  auditFault: $("#auditFault"),
  auditChain: $("#auditChain")
};

const app = {
  configs: cloneConfig(),
  simulation: null,
  running: false,
  paused: false,
  rate: 4,
  accumulator: 0,
  lastFrame: 0,
  lastFeedSignature: "",
  resultShown: false,
  auditResult: null,
  flightRefs: new Map(),
  bars: []
};

const renderer = new AirspaceRenderer(refs.canvas);
const audio = new AirspaceAudio(({ enabled, detail }) => {
  refs.audioToggle.setAttribute("aria-pressed", String(enabled));
  refs.audioLabel.textContent = enabled ? "声场 开" : "声场 关";
  refs.audioReadout.classList.toggle("live", enabled);
  refs.audioStatus.textContent = detail;
});

function buildFlightCards() {
  refs.flightList.innerHTML = AIRCRAFT.map((plane) => {
    const speedButtons = Object.entries(SPEEDS)
      .map(
        ([key, speed]) =>
          `<button type="button" data-speed="${key}" title="${speed.label} ${speed.value}kt">${speed.value}</button>`
      )
      .join("");
    const priorityButtons = [1, 2, 3, 4]
      .map(
        (priority) =>
          `<button type="button" data-priority="${priority}" aria-label="避让优先权 ${priority}">${priority}</button>`
      )
      .join("");
    return `
      <article class="flight-card" data-flight="${plane.id}" style="--flight-color:${plane.color}">
        <header class="flight-head">
          <div class="flight-identity">
            <span class="flight-swatch" aria-hidden="true"></span>
            <div>
              <span class="flight-code">${plane.id}</span><span class="flight-name">${plane.name}</span>
            </div>
          </div>
          <span class="flight-status" data-status>${plane.route.toUpperCase()} · 待起飞</span>
        </header>
        <div class="fuel-line">
          <span>FUEL</span>
          <div class="fuel-meter"><i data-fuel-meter></i></div>
          <b data-fuel-value>${plane.startFuel}%</b>
        </div>
        <div class="control-row">
          <div class="control-block">
            <div class="control-label"><span>航速</span><span>KT</span></div>
            <div class="segmented" data-speed-group>${speedButtons}</div>
          </div>
          <div class="control-block">
            <div class="control-label"><span>优先权</span><span>P</span></div>
            <div class="priority-grid" data-priority-group>${priorityButtons}</div>
          </div>
          <div class="control-block">
            <div class="control-label"><span>转弯半径</span><output data-radius-output>${plane.config.radius}</output></div>
            <div class="radius-control">
              <input type="range" min="30" max="80" step="2" value="${plane.config.radius}" data-radius aria-label="${plane.id} 转弯半径" />
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  for (const card of refs.flightList.querySelectorAll(".flight-card")) {
    const id = card.dataset.flight;
    app.flightRefs.set(id, {
      card,
      status: card.querySelector("[data-status]"),
      fuelMeter: card.querySelector("[data-fuel-meter]"),
      fuelValue: card.querySelector("[data-fuel-value]"),
      speedGroup: card.querySelector("[data-speed-group]"),
      priorityGroup: card.querySelector("[data-priority-group]"),
      radius: card.querySelector("[data-radius]"),
      radiusOutput: card.querySelector("[data-radius-output]")
    });
    card.addEventListener("click", (event) => {
      if (app.running) return;
      const button = event.target.closest("button");
      if (!button) return;
      const config = app.configs.find((item) => item.id === id);
      if (button.dataset.speed) config.speed = button.dataset.speed;
      if (button.dataset.priority) {
        config.priority = Number(button.dataset.priority);
      }
      commitConfig();
    });
    card.querySelector("[data-radius]").addEventListener("input", (event) => {
      if (app.running) return;
      const config = app.configs.find((item) => item.id === id);
      config.radius = Number(event.target.value);
      card.querySelector("[data-radius-output]").textContent = config.radius;
      commitConfig();
    });
  }
}

function buildTimeline() {
  refs.timelineEvents.innerHTML = EVENTS.map((event) => {
    const left = (event.time / MAX_TIME) * 100;
    return `<i class="timeline-event ${event.tone}" style="left:${left}%" data-label="${event.label}" title="${event.label} · T+${event.time}s"></i>`;
  }).join("");
  refs.eventTick1.style.left = `${(WEATHER.start / MAX_TIME) * 100}%`;
  refs.eventTick2.style.left = `${(TFR.start / MAX_TIME) * 100}%`;

  refs.densityBars.innerHTML = Array.from(
    { length: 14 },
    (_, index) => `<i data-bar="${index}"></i>`
  ).join("");
  app.bars = [...refs.densityBars.querySelectorAll("i")];
}

function commitConfig() {
  app.simulation = createSimulation(app.configs, { recordTrails: true });
  app.resultShown = false;
  refs.runResult.hidden = true;
  updateFlightCards();
  updateInterface();
}

function syncConfigControls() {
  for (const plane of AIRCRAFT) {
    const config = app.configs.find((item) => item.id === plane.id);
    const ui = app.flightRefs.get(plane.id);
    ui.speedGroup.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.speed === config.speed);
    });
    ui.priorityGroup.querySelectorAll("button").forEach((button) => {
      button.classList.toggle(
        "active",
        Number(button.dataset.priority) === config.priority
      );
    });
    ui.radius.value = config.radius;
    ui.radiusOutput.textContent = config.radius;
  }
}

function setControlsLocked(locked) {
  for (const ui of app.flightRefs.values()) {
    ui.card.classList.toggle("locked", locked);
    ui.card.classList.toggle("running", locked);
    ui.speedGroup.querySelectorAll("button").forEach((button) => {
      button.disabled = locked;
    });
    ui.priorityGroup.querySelectorAll("button").forEach((button) => {
      button.disabled = locked;
    });
    ui.radius.disabled = locked;
  }
  refs.presetButton.disabled = locked;
}

function updateFlightCards() {
  for (const flight of app.simulation.flights) {
    const ui = app.flightRefs.get(flight.id);
    if (!ui) continue;
    const modeText = {
      staged: "待起飞",
      inbound: "进港",
      holding: "等待",
      approach: "进近",
      landed: "已落地",
      lost: "失联"
    }[flight.mode];
    ui.status.textContent = `${flight.route.label} · ${modeText}`;
    ui.status.className = `flight-status ${flight.mode}`;
    ui.fuelValue.textContent = `${flight.fuel.toFixed(1)}%`;
    ui.fuelMeter.style.width = `${Math.max(0, flight.fuel)}%`;
    ui.fuelMeter.classList.toggle("low", flight.fuel < 18);
  }
}

function currentConflict() {
  const active = app.simulation.flights.filter(
    (flight) =>
      flight.mode === "inbound" ||
      flight.mode === "approach"
  );
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const first = active[i];
      const second = active[j];
      const distance = Math.hypot(
        first.position.x - second.position.x,
        first.position.y - second.position.y
      );
      const limit =
        62 + (first.config.radius + second.config.radius) * 0.22;
      if (distance < limit) return true;
    }
  }
  return false;
}

function densitySnapshot() {
  const sim = app.simulation;
  const airborne = sim.flights.filter(
    (flight) =>
      flight.mode === "inbound" ||
      flight.mode === "holding" ||
      flight.mode === "approach"
  ).length;
  const holding = sim.flights.filter(
    (flight) => flight.mode === "holding"
  ).length;
  const conflict = currentConflict();
  const density = Math.min(
    1,
    (airborne / 4) * 0.74 + (holding / 4) * 0.19 + (conflict ? 0.22 : 0)
  );
  return { airborne, holding, conflict, density };
}

function updateDensity(stats) {
  refs.densityValue.textContent = stats.density.toFixed(2);
  const level = Math.round(stats.density * app.bars.length);
  app.bars.forEach((bar, index) => {
    const wave =
      0.33 +
      (Math.sin(index * 1.77 + app.simulation.time * 1.6) + 1) * 0.19;
    const height = 3 + wave * (3 + stats.density * 16);
    bar.style.height = `${height.toFixed(1)}px`;
    bar.classList.toggle("hot", index < level);
    if (stats.conflict) bar.classList.toggle("hot", index > app.bars.length - 5);
  });
}

function updateLog() {
  const events = app.simulation.events;
  const signature = `${app.simulation.events.length}:${app.simulation.eventSeq}`;
  if (signature === app.lastFeedSignature) return;
  app.lastFeedSignature = signature;
  const latest = events.slice(-4).reverse();
  refs.eventFeed.innerHTML = latest
    .map(
      (event) => `
        <li class="event-item ${event.tone}">
          <span class="event-time">${event.time.toFixed(1)}s</span>
          <div class="event-content">
            <b>${event.title}</b>
            <span>${event.detail || ""}</span>
          </div>
        </li>
      `
    )
    .join("");
  refs.sequenceTag.textContent = `SEQ ${String(events.length).padStart(2, "0")}`;
}

function updateInterface() {
  const sim = app.simulation;
  const stats = densitySnapshot();
  updateFlightCards();
  updateDensity(stats);
  updateLog();
  audio.update({ ...stats, active: app.running });

  refs.clock.textContent = `T+${sim.time.toFixed(1).padStart(5, "0")}`;
  const secondsLeft = Math.max(0, WEATHER.end - sim.time);
  refs.weatherFlag.classList.toggle("active", sim.weatherActive);
  refs.weatherTimer.textContent = sim.weatherActive
    ? `CLOSED · ${secondsLeft.toFixed(0)}s`
    : sim.time < WEATHER.start
      ? `IN ${(WEATHER.start - sim.time).toFixed(0)}s`
      : "CLEAR";

  const progress = Math.min(100, (sim.time / MAX_TIME) * 100);
  refs.progress.style.width = `${progress}%`;
  refs.progressTime.textContent = `${sim.time.toFixed(0)} / ${MAX_TIME}s`;
  refs.timelineProgress.style.width = `${progress}%`;
  refs.timelineCursor.style.left = `${progress}%`;

  if (sim.done) {
    refs.sceneState.textContent = sim.outcome.success
      ? "MISSION COMPLETE / 四机落地"
      : "MISSION FAILED / 存在冲突";
    refs.phaseLabel.textContent = sim.outcome.success ? "全部安全落地" : "任务失败";
  } else if (app.paused) {
    refs.sceneState.textContent = "PAUSED / 仿真暂停";
    refs.phaseLabel.textContent = "已暂停";
  } else if (app.running) {
    refs.sceneState.textContent = sim.tfrActive
      ? "LIVE / TFR-12 等待放行"
      : sim.weatherActive
        ? "LIVE / ALPHA 关闭"
        : "LIVE / 进近排序";
    refs.phaseLabel.textContent = sim.tfrActive
      ? "临时净空区激活"
      : sim.weatherActive
        ? "等待天气窗口"
        : stats.holding
          ? "按优先权放行"
          : "终端区进近";
  } else {
    refs.sceneState.textContent = "PREFLIGHT / 方案就绪";
    refs.phaseLabel.textContent = "等待执行";
  }

  refs.pauseButton.disabled = !app.running;
  refs.pauseIcon.textContent = app.paused ? "▶" : "Ⅱ";
  refs.speedButton.textContent = `×${app.rate}`;
  refs.startButton.disabled = false;
  if (sim.done) {
    refs.startLabel.textContent = "再飞一局";
  } else if (app.running && app.paused) {
    refs.startLabel.textContent = "继续运行";
  } else if (app.running) {
    refs.startLabel.textContent = "暂停运行";
  } else {
    refs.startLabel.textContent = "执行放行";
  }

  if (sim.done && !app.resultShown) showResult();
}

function metricMarkup(metrics) {
  return metrics
    .map(
      ([label, value]) =>
        `<div class="result-metric"><span>${label}</span><b>${value}</b></div>`
    )
    .join("");
}

function showResult() {
  const outcome = app.simulation.outcome;
  if (!outcome) return;
  app.resultShown = true;
  app.running = false;
  app.paused = false;
  setControlsLocked(false);
  refs.runResult.hidden = false;
  refs.runResult.classList.toggle("failure", !outcome.success);
  refs.resultTag.textContent = outcome.success ? "MISSION COMPLETE" : "MISSION FAILED";
  refs.resultTitle.textContent = outcome.success ? "全部安全落地" : "冲突链未被解除";
  refs.resultCopy.textContent = outcome.success
    ? `四机在燃油下限前完成进近。放行序列 ${outcome.landingSequence.join(" → ")}，终端区零间隔违规。`
    : outcome.reasons.join("；");
  refs.resultMetrics.innerHTML = metricMarkup([
    ["落地", `${outcome.landedCount} / 4`],
    ["最小净距", outcome.minSeparation === null ? "—" : outcome.minSeparation],
    ["总耗时", `T+${outcome.elapsed.toFixed(0)}s`]
  ]);
  if (audio.enabled) {
    refs.audioStatus.textContent = outcome.success
      ? "AUDIO CLEAR / MISSION COMPLETE"
      : "AUDIO ALERT / CONFLICT LOGGED";
    refs.audioReadout.classList.remove("live");
  }
  audio.playEvent(outcome.success ? "safe" : "danger");
}

function resetScenario(options = {}) {
  if (options.loadStandard) {
    app.configs = cloneConfig();
    syncConfigControls();
  }
  app.simulation = createSimulation(app.configs, { recordTrails: true });
  app.running = false;
  app.paused = false;
  app.accumulator = 0;
  app.resultShown = false;
  app.lastFeedSignature = "";
  refs.runResult.hidden = true;
  setControlsLocked(false);
  updateInterface();
}

async function startOrToggle() {
  if (app.running) {
    app.paused = !app.paused;
    app.lastFrame = performance.now();
    updateInterface();
    return;
  }
  if (app.simulation.done) {
    resetScenario();
  }
  if (!audio.enabled) {
    try {
      await audio.ensure();
    } catch {
      refs.audioStatus.textContent = "AUDIO UNAVAILABLE";
    }
  }
  app.running = true;
  app.paused = false;
  app.accumulator = 0;
  app.lastFrame = performance.now();
  app.resultShown = false;
  refs.runResult.hidden = true;
  setControlsLocked(true);
  updateInterface();
}

function togglePause() {
  if (!app.running) return;
  app.paused = !app.paused;
  app.lastFrame = performance.now();
  updateInterface();
}

function auditColumn(summary, title, variant) {
  const status = summary.success ? "安全完成" : "任务失败";
  const sequence = summary.landingSequence.length
    ? summary.landingSequence.join(" → ")
    : "未形成落地序列";
  const rows = summary.flights
    .map(
      (flight) => `
        <div class="column-flight">
          <span class="flight-ref">${flight.id} · ${flight.name}</span>
          <span class="flight-pri">P${flight.priority}</span>
          <span class="flight-fuel ${flight.fuel < 18 ? "low" : ""}">${flight.landedFuel ?? flight.fuel}%</span>
        </div>
      `
    )
    .join("");
  return `
    <div class="column-head">
      <span>${title}</span>
      <b>${status}</b>
    </div>
    <ul class="column-metrics">
      <li><small>LANDING</small><b>${sequence}</b></li>
      <li><small>MIN SEP</small><b>${summary.minSeparation ?? "—"}</b></li>
      <li><small>CONFLICTS</small><b>${summary.conflictCount}</b></li>
    </ul>
    <div class="column-flights">${rows}</div>
  `;
}

function openAudit() {
  refs.auditButton.disabled = true;
  refs.auditButton.querySelector("span").textContent = "正在复算…";
  const result = runPriorityAudit();
  app.auditResult = result;
  const passed = result.checks.filter((check) => check.pass).length;

  refs.auditSummary.innerHTML = result.checks
    .map(
      (check) => `
        <div class="audit-check ${check.pass ? "pass" : "fail"}">
          <span>${check.label}</span>
          <b>${check.pass ? "PASS" : "FAIL"}</b>
        </div>
      `
    )
    .join("");
  refs.auditBaseline.innerHTML = auditColumn(
    result.baseline,
    "BASELINE / 标准优先权",
    "safe"
  );
  refs.auditFault.innerHTML = auditColumn(
    result.fault,
    "FAULT / 错误优先权",
    "fault"
  );

  const chainEvents = result.fault.events.filter(
    (event) =>
      event.title.includes("获准进近") ||
      event.title.includes("燃油下限") ||
      event.title.includes("间隔违规") ||
      event.title.includes("进入终端区") ||
      (event.title.includes("落地") && event.flightId === "U01") ||
      event.title.includes("任务终止")
  );
  refs.auditChain.innerHTML = chainEvents
    .map(
      (event) => `
        <li class="chain-item ${event.tone}">
          <span class="chain-time">T+${event.time.toFixed(1)}s</span>
          <b>${event.title}</b>
          <span>${event.detail}</span>
        </li>
      `
    )
    .join("");
  refs.auditDigest.className = `audit-digest ${result.verified ? "pass" : "fail"}`;
  refs.auditDigest.innerHTML = `
    <span class="digest-led"></span>
    <span>${result.verified ? "CHAIN CONFIRMED" : "CHECK FAILED"} · ${passed}/4 通过 · U01/U02 ${result.fault.conflicts[0]?.separation ?? "—"} 净距</span>
  `;
  refs.auditButton.disabled = false;
  refs.auditButton.querySelector("span").textContent = "重新运行冲突链验证";
  refs.auditDialog.showModal();
}

function setupEvents() {
  refs.startButton.addEventListener("click", startOrToggle);
  refs.pauseButton.addEventListener("click", togglePause);
  refs.resetButton.addEventListener("click", () => {
    refs.audioStatus.textContent = audio.enabled ? "AUDIO LIVE" : "AUDIO STANDBY";
    resetScenario();
  });
  refs.speedButton.addEventListener("click", () => {
    const rates = [1, 2, 4, 8];
    app.rate = rates[(rates.indexOf(app.rate) + 1) % rates.length];
    updateInterface();
  });
  refs.presetButton.addEventListener("click", () => {
    resetScenario({ loadStandard: true });
  });
  refs.audioToggle.addEventListener("click", async () => {
    try {
      await audio.toggle();
    } catch {
      refs.audioStatus.textContent = "AUDIO UNAVAILABLE";
    }
  });
  refs.resultReset.addEventListener("click", () => {
    resetScenario();
  });
  refs.resultAudit.addEventListener("click", openAudit);
  refs.auditButton.addEventListener("click", openAudit);
  refs.auditClose.addEventListener("click", () => refs.auditDialog.close());
  refs.auditDone.addEventListener("click", () => refs.auditDialog.close());
  refs.auditDialog.addEventListener("click", (event) => {
    if (event.target === refs.auditDialog) refs.auditDialog.close();
  });
  window.addEventListener("keydown", (event) => {
    if (
      event.code === "Space" &&
      !["INPUT", "BUTTON"].includes(document.activeElement?.tagName) &&
      !refs.auditDialog.open
    ) {
      event.preventDefault();
      if (app.running) togglePause();
      else startOrToggle();
    }
  });
}

function frame(timestamp) {
  if (!app.lastFrame) app.lastFrame = timestamp;
  const realDt = Math.min(0.12, (timestamp - app.lastFrame) / 1000);
  app.lastFrame = timestamp;

  if (app.running && !app.paused) {
    app.accumulator += realDt * app.rate;
    let steps = 0;
    while (app.accumulator >= 0.1 && steps < 80) {
      stepSimulation(app.simulation, 0.1);
      app.accumulator -= 0.1;
      steps += 1;
      if (app.simulation.done) break;
    }
    if (app.simulation.done) {
      app.running = false;
      app.paused = false;
      setControlsLocked(false);
    }
  }

  renderer.draw(app.simulation);
  updateInterface();
  requestAnimationFrame(frame);
}

function init() {
  buildFlightCards();
  buildTimeline();
  syncConfigControls();
  setupEvents();
  app.simulation = createSimulation(app.configs, { recordTrails: true });
  app.lastFrame = performance.now();
  updateInterface();
  requestAnimationFrame(frame);

  window.corridorFour = {
    app,
    start: startOrToggle,
    reset: resetScenario,
    audit: runPriorityAudit,
    simulateCue(seconds = 0) {
      const steps = Math.ceil(seconds / 0.1);
      for (let i = 0; i < steps && !app.simulation.done; i += 1) {
        stepSimulation(app.simulation, 0.1);
      }
      renderer.draw(app.simulation);
      updateInterface();
      return app.simulation.outcome;
    }
  };
}

init();
