import {
  AIRCRAFT,
  EVENTS,
  FIELD,
  FUEL_RESERVE,
  MAX_TIME,
  RELEASE_GAP,
  ROUTES,
  SCENARIO,
  SEPARATION,
  SPEEDS,
  TFR,
  WEATHER,
  WRONG_PRIORITIES,
  cloneConfig,
  pointAt
} from "./scenario.js";

const FLIGHT_MODES = new Set(["inbound", "holding", "approach"]);

function normalizeConfigs(configs) {
  const byId = new Map();
  if (Array.isArray(configs)) {
    for (const config of configs) byId.set(config.id, config);
  } else if (configs && typeof configs === "object") {
    for (const [id, config] of Object.entries(configs)) byId.set(id, config);
  }
  return AIRCRAFT.map((plane) => {
    const config = byId.get(plane.id) || {};
    return {
      id: plane.id,
      speed: SPEEDS[config.speed] ? config.speed : plane.config.speed,
      radius: Number.isFinite(config.radius)
        ? Math.max(30, Math.min(80, config.radius))
        : plane.config.radius,
      priority: Number.isFinite(config.priority)
        ? Math.max(1, Math.min(4, Math.round(config.priority)))
        : plane.config.priority
    };
  });
}

function pushEvent(state, event) {
  state.eventSeq += 1;
  state.events.push({
    id: `evt-${state.eventSeq}`,
    time: Number(state.time.toFixed(2)),
    tone: "info",
    ...event
  });
}

function distanceToField(point) {
  return Math.hypot(point.x - FIELD.x, point.y - FIELD.y);
}

function separationLimit(first, second) {
  return SEPARATION + (first.config.radius + second.config.radius) * 0.22;
}

function isBlocked(state, flight) {
  const weatherBlocked =
    flight.routeId === WEATHER.corridor &&
    state.weatherActive &&
    flight.distance < flight.route.fafDist;
  const tfrBlocked = state.tfrActive && flight.distance < flight.route.fafDist;
  if (weatherBlocked) return "weather";
  if (tfrBlocked) return "tfr";
  return null;
}

function modeLabel(mode) {
  return {
    staged: "待起飞",
    inbound: "进港",
    holding: "等待",
    approach: "进近",
    landed: "已落地",
    lost: "失联"
  }[mode] || mode;
}

export function createSimulation(configs = cloneConfig(), options = {}) {
  const normalized = normalizeConfigs(configs);
  const state = {
    scenario: SCENARIO,
    time: 0,
    done: false,
    outcome: null,
    weatherActive: false,
    tfrActive: false,
    lastReleaseAt: -100,
    releaseSequence: 0,
    eventSeq: 0,
    events: [],
    conflicts: [],
    conflictKeys: new Set(),
    recordTrails: options.recordTrails !== false,
    metrics: {
      maxAirborne: 0,
      maxHolding: 0,
      minSeparation: Infinity,
      initialFuel: 0,
      landedFuel: 0
    },
    flags: {
      weather: false,
      tfr: false
    }
  };

  state.flights = AIRCRAFT.map((plane) => {
    const config = normalized.find((item) => item.id === plane.id);
    const route = ROUTES[plane.route];
    const position = pointAt(route, 0);
    return {
      id: plane.id,
      name: plane.name,
      type: plane.type,
      color: plane.color,
      routeId: plane.route,
      route,
      launch: plane.launch,
      startFuel: plane.startFuel,
      fuel: plane.startFuel,
      config,
      distance: 0,
      mode: "staged",
      statusLabel: modeLabel("staged"),
      holdReason: null,
      holdStartedAt: null,
      releaseTime: null,
      landingTime: null,
      landedFuel: null,
      fuelCritical: false,
      enteredTerminalAt: null,
      position,
      trail: state.recordTrails ? [{ ...position, time: 0 }] : [],
      lastTrailAt: 0
    };
  });

  state.metrics.initialFuel = state.flights.reduce((sum, f) => sum + f.startFuel, 0);
  pushEvent(state, {
    title: "固定场景已锁定",
    detail: "SCN-04 · 双走廊 / 单跑道 / 四机",
    tone: "info"
  });
  return state;
}

function activateTimeline(state) {
  state.weatherActive = state.time >= WEATHER.start && state.time < WEATHER.end;
  state.tfrActive = state.time >= TFR.start && state.time < TFR.end;

  if (state.weatherActive !== state.flags.weather) {
    state.flags.weather = state.weatherActive;
    const event = EVENTS.find((item) =>
      state.weatherActive ? item.id === "weather-on" : item.id === "weather-off"
    );
    pushEvent(state, {
      title: event.label,
      detail: state.weatherActive
        ? "CB-04 覆盖 ALPHA 入口，等待圈启用"
        : "ALPHA 恢复，仍需等待净空区解除",
      tone: state.weatherActive ? "weather" : "safe"
    });
  }

  if (state.tfrActive !== state.flags.tfr) {
    state.flags.tfr = state.tfrActive;
    const event = EVENTS.find((item) =>
      state.tfrActive ? item.id === "tfr-on" : item.id === "tfr-off"
    );
    pushEvent(state, {
      title: event.label,
      detail: state.tfrActive
        ? "TFR-12 压住汇合点，四机实施等待"
        : "地勤车队离场，终端区按优先权放行",
      tone: state.tfrActive ? "danger" : "safe"
    });
  }
}

function releaseNext(state) {
  if (state.time - state.lastReleaseAt < RELEASE_GAP) return;
  const candidates = state.flights
    .filter(
      (flight) =>
        flight.mode === "holding" &&
        !isBlocked(state, flight) &&
        flight.fuel > 0
    )
    .sort(
      (a, b) =>
        a.config.priority - b.config.priority ||
        a.fuel - b.fuel ||
        a.id.localeCompare(b.id)
    );
  const next = candidates[0];
  if (!next) return;

  next.mode = "approach";
  next.statusLabel = modeLabel("approach");
  next.holdReason = null;
  next.releaseTime = state.time;
  next.lastReleaseAt = state.time;
  state.lastReleaseAt = state.time;
  state.releaseSequence += 1;
  pushEvent(state, {
    title: `${next.id} ${next.name} 获准进近`,
    detail: `优先权 P${next.config.priority} · 第 ${state.releaseSequence} 顺位`,
    tone: next.config.priority === 4 ? "danger" : "release",
    flightId: next.id
  });
}

export function stepSimulation(state, dt = 0.1) {
  if (state.done) return state;
  const safeDt = Math.max(0.01, Math.min(dt, 0.2));
  state.time = Math.min(MAX_TIME, state.time + safeDt);
  activateTimeline(state);
  releaseNext(state);

  let airborne = 0;
  let holding = 0;

  for (const flight of state.flights) {
    if (flight.mode === "landed" || flight.mode === "lost") continue;

    if (flight.mode === "staged" && state.time >= flight.launch) {
      flight.mode = "inbound";
      flight.statusLabel = modeLabel("inbound");
      pushEvent(state, {
        title: `${flight.id} ${flight.name} 起飞`,
        detail: `${flight.route.label} 走廊 · P${flight.config.priority}`,
        tone: "info",
        flightId: flight.id
      });
    }
    if (flight.mode === "staged") {
      flight.statusLabel = modeLabel("staged");
      continue;
    }

    const isHolding = flight.mode === "holding";
    const speed = SPEEDS[flight.config.speed].value;
    const burnFactor = SPEEDS[flight.config.speed].burn;
    const radiusFactor = 0.9 + flight.config.radius / 400;
    const burnRate = isHolding
      ? 0.295 * burnFactor * radiusFactor
      : 0.18 * burnFactor;

    flight.fuel = Math.max(0, flight.fuel - burnRate * safeDt);
    if (!flight.fuelCritical && flight.fuel <= FUEL_RESERVE) {
      flight.fuelCritical = true;
      pushEvent(state, {
        title: `${flight.id} 触及燃油下限`,
        detail: `剩余 ${flight.fuel.toFixed(1)}% < 储备 ${FUEL_RESERVE}%`,
        tone: "danger",
        flightId: flight.id
      });
    }
    if (flight.fuel <= 0) {
      flight.mode = "lost";
      flight.statusLabel = modeLabel("lost");
      flight.position = pointAt(flight.route, flight.distance);
      pushEvent(state, {
        title: `${flight.id} 燃油耗尽`,
        detail: "失去动力，任务终止",
        tone: "danger",
        flightId: flight.id
      });
      continue;
    }

    if (flight.mode === "holding") {
      holding += 1;
      flight.position = pointAt(flight.route, flight.distance);
      continue;
    }

    const blocked = isBlocked(state, flight);
    let nextDistance = flight.distance + speed * safeDt;
    if (nextDistance >= flight.route.holdDist && blocked) {
      nextDistance = flight.route.holdDist;
      flight.mode = "holding";
      flight.statusLabel = modeLabel("holding");
      flight.holdReason = blocked;
      flight.holdStartedAt = state.time;
      holding += 1;
      pushEvent(state, {
        title: `${flight.id} 进入等待圈`,
        detail:
          blocked === "weather"
            ? "ALPHA 因 CB-04 关闭"
            : "TFR-12 压住终端汇合点",
        tone: blocked === "weather" ? "weather" : "danger",
        flightId: flight.id
      });
    }

    flight.distance = Math.min(nextDistance, flight.route.landDist);
    flight.position = pointAt(flight.route, flight.distance);
    airborne += 1;

    if (
      flight.enteredTerminalAt === null &&
      distanceToField(flight.position) < FIELD.terminalRadius
    ) {
      flight.enteredTerminalAt = state.time;
      pushEvent(state, {
        title: `${flight.id} 进入终端区`,
        detail: `放行后 ${(state.time - flight.releaseTime).toFixed(1)}s`,
        tone: "info",
        flightId: flight.id
      });
    }

    if (state.recordTrails && state.time - flight.lastTrailAt >= 0.6) {
      flight.trail.push({ ...flight.position, time: state.time });
      flight.lastTrailAt = state.time;
    }

    if (flight.distance >= flight.route.landDist) {
      flight.mode = "landed";
      flight.statusLabel = modeLabel("landed");
      flight.landingTime = state.time;
      flight.landedFuel = flight.fuel;
      state.metrics.landedFuel += flight.fuel;
      airborne = Math.max(0, airborne - 1);
      pushEvent(state, {
        title: `${flight.id} ${flight.name} 落地`,
        detail: `余油 ${flight.fuel.toFixed(1)}% · T+${state.time.toFixed(1)}s`,
        tone: flight.fuel >= FUEL_RESERVE ? "safe" : "danger",
        flightId: flight.id
      });
    }
  }

  state.metrics.maxAirborne = Math.max(state.metrics.maxAirborne, airborne);
  state.metrics.maxHolding = Math.max(state.metrics.maxHolding, holding);
  checkTerminalConflicts(state);
  finalizeIfReady(state);
  return state;
}

function checkTerminalConflicts(state) {
  const active = state.flights.filter(
    (flight) =>
      FLIGHT_MODES.has(flight.mode) &&
      distanceToField(flight.position) < FIELD.terminalRadius
  );

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const first = active[i];
      const second = active[j];
      const separation = Math.hypot(
        first.position.x - second.position.x,
        first.position.y - second.position.y
      );
      state.metrics.minSeparation = Math.min(
        state.metrics.minSeparation,
        separation
      );
      const limit = separationLimit(first, second);
      if (separation >= limit) continue;

      const key = [first.id, second.id].sort().join("/");
      if (state.conflictKeys.has(key)) continue;
      state.conflictKeys.add(key);
      const conflict = {
        time: Number(state.time.toFixed(1)),
        ids: [first.id, second.id],
        separation: Number(separation.toFixed(1)),
        limit: Number(limit.toFixed(1))
      };
      state.conflicts.push(conflict);
      pushEvent(state, {
        title: `${first.id} / ${second.id} 间隔违规`,
        detail: `终端区净距 ${conflict.separation} < ${conflict.limit}`,
        tone: "danger",
        flightId: first.id
      });
    }
  }
}

function finalizeIfReady(state) {
  const allResolved = state.flights.every(
    (flight) => flight.mode === "landed" || flight.mode === "lost"
  );
  const timedOut = state.time >= MAX_TIME;
  if (!allResolved && !timedOut) return;

  const landed = state.flights
    .filter((flight) => flight.mode === "landed")
    .sort((a, b) => a.landingTime - b.landingTime);
  const fuelFailures = landed.filter(
    (flight) => flight.landedFuel < FUEL_RESERVE
  );
  const unresolved = state.flights.filter(
    (flight) => flight.mode !== "landed"
  );
  const reasons = [];

  if (state.conflicts.length) {
    reasons.push(`${state.conflicts.length} 次终端区间隔违规`);
  }
  if (fuelFailures.length) {
    reasons.push(
      `${fuelFailures.map((flight) => flight.id).join("、")} 低于燃油下限`
    );
  }
  if (unresolved.length) {
    reasons.push(`${unresolved.map((flight) => flight.id).join("、")} 未落地`);
  }

  state.done = true;
  state.outcome = {
    success: reasons.length === 0,
    reasons,
    elapsed: Number(state.time.toFixed(1)),
    landingSequence: landed.map((flight) => flight.id),
    conflictCount: state.conflicts.length,
    landedCount: landed.length,
    maxHolding: state.metrics.maxHolding,
    minSeparation:
      state.metrics.minSeparation === Infinity
        ? null
        : Number(state.metrics.minSeparation.toFixed(1))
  };
  pushEvent(state, {
    title: state.outcome.success ? "任务完成 · 全部安全落地" : "任务终止 · 存在冲突",
    detail: state.outcome.success
      ? `四机在燃油下限前落地 · 最小净距 ${state.outcome.minSeparation}`
      : reasons.join(" / "),
    tone: state.outcome.success ? "safe" : "danger"
  });
}

export function simulate(configs = cloneConfig(), options = {}) {
  const state = createSimulation(configs, {
    recordTrails: options.recordTrails === true
  });
  const dt = options.dt || 0.05;
  let guard = 0;
  while (!state.done && guard < 20000) {
    stepSimulation(state, dt);
    guard += 1;
  }
  return state;
}

export function summarize(state) {
  const outcome = state.outcome || {
    success: false,
    reasons: ["仿真未完成"],
    elapsed: Number(state.time.toFixed(1)),
    landingSequence: [],
    conflictCount: state.conflicts.length,
    landedCount: state.flights.filter((flight) => flight.mode === "landed").length,
    maxHolding: state.metrics.maxHolding,
    minSeparation:
      state.metrics.minSeparation === Infinity
        ? null
        : Number(state.metrics.minSeparation.toFixed(1))
  };
  return {
    ...outcome,
    flights: state.flights.map((flight) => ({
      id: flight.id,
      name: flight.name,
      priority: flight.config.priority,
      speed: flight.config.speed,
      releasedAt:
        flight.releaseTime === null ? null : Number(flight.releaseTime.toFixed(1)),
      landedAt:
        flight.landingTime === null ? null : Number(flight.landingTime.toFixed(1)),
      fuel: Number(flight.fuel.toFixed(1)),
      landedFuel:
        flight.landedFuel === null ? null : Number(flight.landedFuel.toFixed(1)),
      fuelCritical: flight.fuelCritical
    })),
    conflicts: state.conflicts,
    events: state.events
  };
}

export function runPriorityAudit() {
  const baselineState = simulate(cloneConfig(), { recordTrails: false });
  const faultState = simulate(cloneConfig(WRONG_PRIORITIES), {
    recordTrails: false
  });
  const baseline = summarize(baselineState);
  const fault = summarize(faultState);
  const hasMergeConflict = fault.conflicts.some(
    (conflict) =>
      conflict.ids.includes("U01") && conflict.ids.includes("U02")
  );
  const fuelChain = fault.flights.some(
    (flight) => flight.id === "U01" && flight.fuelCritical
  );
  const checks = [
    {
      id: "baseline",
      label: "正确优先权基线安全落地",
      pass: baseline.success
    },
    {
      id: "fault",
      label: "错误优先权导致任务失败",
      pass: !fault.success
    },
    {
      id: "conflict",
      label: "U01 与 U02 在终端区产生间隔链",
      pass: hasMergeConflict
    },
    {
      id: "fuel",
      label: "U01 晚放行触发燃油下限",
      pass: fuelChain
    }
  ];
  const chain = fault.events.filter(
    (event) =>
      event.flightId === "U01" ||
      event.title.includes("U01") ||
      event.title.includes("U02") ||
      event.tone === "danger"
  );
  return {
    verified: checks.every((check) => check.pass),
    checks,
    baseline,
    fault,
    chain
  };
}

export { normalizeConfigs, separationLimit };
