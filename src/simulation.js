export const DURATION_MIN = 360;
export const TICK_MIN = 1;
export const BUS_CAPACITY_A = 188;
export const HOSPITAL_CURRENT_A = 24;
export const RIVER_DANGER_M = 5.32;

export const PUMP_SPECS = [
  {
    id: 'A',
    name: '江口站',
    shortName: '江口',
    zoneId: 'old',
    ratedCurrent: 64,
    maxFlow: 21,
    initialSpeed: 70,
    color: '#67e8d5'
  },
  {
    id: 'B',
    name: '老闸站',
    shortName: '老闸',
    zoneId: 'hospital',
    ratedCurrent: 50,
    maxFlow: 19,
    initialSpeed: 90,
    color: '#f7c66b'
  },
  {
    id: 'C',
    name: '南湖站',
    shortName: '南湖',
    zoneId: 'south',
    ratedCurrent: 78,
    maxFlow: 25,
    initialSpeed: 72,
    color: '#8fb7ff'
  }
];

export const ZONE_SPECS = [
  {
    id: 'old',
    name: '老城片区',
    shortName: '老城',
    threshold: 1.42,
    initial: 0.95,
    areaM2: 430000,
    rainGain: 0.9,
    seepGain: 1
  },
  {
    id: 'hospital',
    name: '医院片区',
    shortName: '医院',
    threshold: 1.3,
    initial: 0.98,
    areaM2: 390000,
    rainGain: 1.15,
    seepGain: 0.55
  },
  {
    id: 'south',
    name: '南湖片区',
    shortName: '南湖',
    threshold: 1.25,
    initial: 0.8,
    areaM2: 450000,
    rainGain: 0.82,
    seepGain: 1.2
  }
];

const RAIN_ANCHORS = [
  [0, 22],
  [30, 34],
  [60, 50],
  [90, 74],
  [120, 91],
  [150, 108],
  [180, 120],
  [210, 112],
  [240, 92],
  [270, 70],
  [300, 48],
  [330, 30],
  [360, 18]
];

export function getRainAt(minute) {
  const t = clamp(minute, 0, DURATION_MIN);
  for (let index = 1; index < RAIN_ANCHORS.length; index += 1) {
    const [rightT, rightRain] = RAIN_ANCHORS[index];
    if (t <= rightT) {
      const [leftT, leftRain] = RAIN_ANCHORS[index - 1];
      const ratio = (t - leftT) / (rightT - leftT);
      return leftRain + (rightRain - leftRain) * ratio;
    }
  }
  return RAIN_ANCHORS.at(-1)[1];
}

export function createSimulation() {
  const pumps = {};
  for (const spec of PUMP_SPECS) {
    pumps[spec.id] = {
      ...spec,
      on: false,
      running: false,
      speed: spec.initialSpeed,
      current: 0,
      baseCurrent: 0,
      flow: 0,
      surgeMinutes: 0,
      overloadMinutes: 0,
      health: 100,
      faulted: false,
      repairing: false,
      repairMinutes: 0,
      lastStopAt: null,
      starts: 0
    };
  }

  const zones = {};
  for (const spec of ZONE_SPECS) {
    zones[spec.id] = {
      ...spec,
      level: spec.initial,
      flooded: false,
      floodedAt: null,
      peak: spec.initial,
      pumpedM3: 0
    };
  }

  return {
    t: 0,
    status: 'running',
    endedAt: null,
    storm: {
      rain: getRainAt(0),
      peakRain: Math.max(...RAIN_ANCHORS.map(([, rain]) => rain)),
      lightning: 0
    },
    river: {
      level: 5.02,
      peak: 5.02,
      danger: RIVER_DANGER_M,
      levee: 5.7,
      inflow: 0,
      outflow: 0,
      pumpedM3: 0
    },
    bus: {
      capacity: BUS_CAPACITY_A,
      current: 0,
      voltage: 380,
      loadPct: 0,
      tripped: false,
      overloadMinutes: 0,
      cooldownUntil: 0,
      trips: 0,
      lastTripAt: null
    },
    hospital: {
      source: 'bus',
      powered: true,
      outageMinutes: 0,
      everLostPower: false,
      current: HOSPITAL_CURRENT_A,
      generatorFuel: 260,
      generatorCapacity: 30
    },
    pumps,
    zones,
    metrics: {
      totalPumpedM3: 0,
      starts: 0,
      faults: 0,
      repairs: 0,
      busOverloadMinutes: 0,
      maxBusCurrent: 0,
      maxPowerLoadPct: 0
    },
    events: [],
    failures: [],
    completed: false
  };
}

export function createScenarioState(options = {}) {
  const state = createSimulation();
  if (options.prepared) {
    for (const pump of Object.values(state.pumps)) {
      pump.on = true;
      pump.running = true;
      pump.surgeMinutes = 0;
    }
    state.hospital.source = 'generator';
    state.events = [];
    state.t = 0;
  }
  return state;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function addEvent(state, type, title, detail) {
  state.events.push({
    at: round(state.t, 0),
    type,
    title,
    detail
  });
  if (state.events.length > 80) state.events.shift();
}

function addFailure(state, code, title) {
  if (state.failures.some((failure) => failure.code === code)) return;
  state.failures.push({ code, title, at: round(state.t, 0) });
  if (state.status === 'running') {
    state.status = 'lost';
    state.endedAt = round(state.t, 0);
    addEvent(state, 'failure', title, '调度目标已被突破');
  }
}

export function setPumpSpeed(state, pumpId, speed) {
  const pump = state.pumps[pumpId];
  if (!pump) return { ok: false, message: '未知泵站' };
  if (state.status !== 'running') return { ok: false, message: '调度已结束' };
  const nextSpeed = clamp(round(speed, 0), 40, 110);
  pump.speed = nextSpeed;
  if (nextSpeed > 100 && pump.on) {
    pump.overloadWarning = true;
  } else {
    pump.overloadWarning = false;
  }
  return { ok: true, message: `${pump.name}转速 ${nextSpeed}%` };
}

export function startPump(state, pumpId) {
  const pump = state.pumps[pumpId];
  if (!pump) return { ok: false, message: '未知泵站' };
  if (state.status !== 'running') return { ok: false, message: '调度已结束' };
  if (state.bus.tripped) return { ok: false, message: '母线失电，需先复位' };
  if (pump.faulted) return { ok: false, message: '设备故障，需先抢修' };
  if (pump.repairing) return { ok: false, message: '抢修作业进行中' };
  if (pump.on) return { ok: false, message: '水泵已在运行' };
  if (pump.lastStopAt !== null && state.t - pump.lastStopAt < 2) {
    return { ok: false, message: '停机保护中，请稍后再启' };
  }

  pump.on = true;
  pump.running = true;
  pump.surgeMinutes = 3;
  pump.starts += 1;
  state.metrics.starts += 1;
  addEvent(state, 'start', `${pump.name}启动`, `${pump.speed}% 转速，进入 3 分钟浪涌`);
  return { ok: true, message: `${pump.name}启动` };
}

export function stopPump(state, pumpId) {
  const pump = state.pumps[pumpId];
  if (!pump) return { ok: false, message: '未知泵站' };
  if (!pump.on && !pump.running) return { ok: false, message: '水泵已停机' };
  pump.on = false;
  pump.running = false;
  pump.surgeMinutes = 0;
  pump.current = 0;
  pump.flow = 0;
  pump.lastStopAt = state.t;
  addEvent(state, 'stop', `${pump.name}停机`, '出口阀缓闭，避免水锤');
  return { ok: true, message: `${pump.name}停机` };
}

export function setHospitalSource(state, source) {
  if (!['bus', 'generator'].includes(source)) {
    return { ok: false, message: '未知医院电源' };
  }
  if (state.status !== 'running') return { ok: false, message: '调度已结束' };
  if (source === 'generator' && state.hospital.generatorFuel <= 0) {
    return { ok: false, message: '柴发已无燃料' };
  }
  if (state.hospital.source === source) {
    return { ok: true, message: '电源未变化' };
  }
  state.hospital.source = source;
  addEvent(
    state,
    'load',
    '医院负荷切换',
    source === 'generator' ? '医院支线切至柴发，释放母线容量' : '医院支线切回共用母线'
  );
  return {
    ok: true,
    message: source === 'generator' ? '医院切至柴发' : '医院切回母线'
  };
}

export function resetBus(state) {
  if (!state.bus.tripped) return { ok: false, message: '母线未跳闸' };
  if (state.t < state.bus.cooldownUntil) {
    return {
      ok: false,
      message: `母线冷却中，还需 ${Math.ceil(state.bus.cooldownUntil - state.t)} 分钟`
    };
  }
  state.bus.tripped = false;
  state.bus.voltage = 380;
  state.bus.current = 0;
  state.bus.overloadMinutes = 0;
  addEvent(state, 'recover', '母线复位成功', '泵组接触器已释放，请逐台重新启动');
  return { ok: true, message: '母线已复位，请逐台启动泵组' };
}

export function startRepair(state, pumpId) {
  const pump = state.pumps[pumpId];
  if (!pump) return { ok: false, message: '未知泵站' };
  if (!pump.faulted) return { ok: false, message: '该泵组无需抢修' };
  if (pump.repairing) return { ok: false, message: '抢修作业已在进行' };
  pump.on = false;
  pump.running = false;
  pump.repairing = true;
  pump.repairMinutes = 12;
  addEvent(state, 'repair', `${pump.name}开始抢修`, '预计 12 分钟，抢修期间不能启泵');
  return { ok: true, message: `${pump.name}抢修开始，预计 12 分钟` };
}

export function stepSimulation(state, minutes = 1) {
  if (state.status !== 'running') return state;
  const wholeMinutes = Math.max(1, Math.floor(minutes));
  for (let index = 0; index < wholeMinutes && state.status === 'running'; index += 1) {
    tickOneMinute(state);
  }
  return state;
}

function tickOneMinute(state) {
  state.storm.rain = getRainAt(state.t);
  state.storm.lightning = Math.max(0, Math.sin(state.t * 0.37) * Math.cos(state.t * 0.13));
  tickRepairs(state);
  tickGenerator(state);

  const busPowered = !state.bus.tripped;
  let hospitalBusCurrent = 0;
  if (state.hospital.source === 'bus' && busPowered) {
    hospitalBusCurrent = HOSPITAL_CURRENT_A;
  }

  let totalCurrent = hospitalBusCurrent;
  let totalFlow = 0;
  const headResistance = 1 + Math.max(0, state.river.level - 5.15) * 0.09;
  const headFlowFactor = clamp(
    1 - Math.max(0, state.river.level - 5.15) * 0.16,
    0.82,
    1
  );

  for (const pump of Object.values(state.pumps)) {
    if (!busPowered) {
      pump.running = false;
      pump.current = 0;
      pump.baseCurrent = 0;
      pump.flow = 0;
      continue;
    }
    if (!pump.on || pump.faulted || pump.repairing) {
      pump.running = false;
      pump.current = 0;
      pump.baseCurrent = 0;
      pump.flow = 0;
      continue;
    }

    const speedFactor = 0.27 + pump.speed * 0.0073;
    const surgeFactor = pump.surgeMinutes > 0 ? pump.surgeMinutes / 3 : 0;
    pump.baseCurrent = pump.ratedCurrent * speedFactor * headResistance;
    pump.current = pump.baseCurrent + pump.ratedCurrent * 0.75 * surgeFactor;
    const zone = state.zones[pump.zoneId];
    const intakeFactor = clamp(0.68 + zone.level * 0.32, 0.55, 1);
    pump.flow =
      pump.maxFlow *
      (pump.speed / 100) ** 1.25 *
      headFlowFactor *
      intakeFactor;
    pump.running = true;
    totalCurrent += pump.current;
    totalFlow += pump.flow;

    if (pump.surgeMinutes > 0) pump.surgeMinutes -= 1;
    tickPumpOverload(state, pump);
  }

  state.bus.current = totalCurrent;
  state.bus.loadPct = (totalCurrent / state.bus.capacity) * 100;
  state.metrics.maxBusCurrent = Math.max(state.metrics.maxBusCurrent, totalCurrent);
  state.metrics.maxPowerLoadPct = Math.max(
    state.metrics.maxPowerLoadPct,
    state.bus.loadPct
  );
  state.bus.voltage =
    380 *
    clamp(
      1 - Math.max(0, state.bus.loadPct - 88) * 0.0024,
      0.76,
      1
    );

  if (!state.bus.tripped) {
    const overloaded = totalCurrent > state.bus.capacity;
    state.bus.overloadMinutes = overloaded
      ? state.bus.overloadMinutes + 1
      : Math.max(0, state.bus.overloadMinutes - 1);
    if (overloaded) state.metrics.busOverloadMinutes += 1;

    if (
      totalCurrent > state.bus.capacity * 1.34 ||
      state.bus.overloadMinutes >= 4
    ) {
      tripBus(state);
    }
  }

  updateHospital(state);
  updateWater(state);
  updateRiver(state);
  checkWaterAlarms(state);

  state.t = round(state.t + TICK_MIN, 0);
  state.storm.rain = getRainAt(state.t);
  if (state.t >= DURATION_MIN && state.status === 'running') {
    state.status = 'won';
    state.completed = true;
    state.endedAt = DURATION_MIN;
    addEvent(state, 'success', '六小时调度完成', '重点区域未进水，医院供电保持正常');
  }
}

function tickRepairs(state) {
  for (const pump of Object.values(state.pumps)) {
    if (!pump.repairing) continue;
    pump.repairMinutes -= 1;
    if (pump.repairMinutes > 0) continue;
    pump.repairing = false;
    pump.faulted = false;
    pump.health = 100;
    pump.overloadMinutes = 0;
    pump.repairMinutes = 0;
    state.metrics.repairs += 1;
    addEvent(state, 'recover', `${pump.name}抢修完成`, '设备已恢复，可重新逐台启动');
  }
}

function tickGenerator(state) {
  if (state.hospital.source !== 'generator') return;
  state.hospital.generatorFuel = Math.max(0, state.hospital.generatorFuel - 1);
  if (state.hospital.generatorFuel === 20) {
    addEvent(state, 'warning', '医院柴发低油量', '剩余 20 分钟，请择机切回母线');
  }
  if (state.hospital.generatorFuel === 0) {
    if (!state.bus.tripped) {
      state.hospital.source = 'bus';
      addEvent(state, 'load', '柴发燃料耗尽', '自动无扰切回共用母线');
    } else {
      state.hospital.powered = false;
      addFailure(state, 'hospital_fuel', '柴发燃料耗尽，医院支线失电');
    }
  }
}

function tickPumpOverload(state, pump) {
  const overloaded = pump.baseCurrent > pump.ratedCurrent * 1.045;
  if (overloaded) {
    pump.overloadMinutes = Math.min(30, pump.overloadMinutes + 1);
    pump.health = Math.max(0, pump.health - 3.5);
  } else {
    pump.overloadMinutes = Math.max(0, pump.overloadMinutes - 0.35);
  }
  if (pump.overloadMinutes < 24 || pump.faulted) return;

  pump.faulted = true;
  pump.on = false;
  pump.running = false;
  pump.surgeMinutes = 0;
  pump.current = 0;
  pump.baseCurrent = 0;
  pump.flow = 0;
  pump.health = 0;
  state.metrics.faults += 1;
  addEvent(
    state,
    'fault',
    `${pump.name}过载保护跳闸`,
    `连续超载 ${Math.round(pump.overloadMinutes)} 分钟，设备损伤`
  );
}

function tripBus(state) {
  state.bus.tripped = true;
  state.bus.trips += 1;
  state.bus.lastTripAt = state.t;
  state.bus.cooldownUntil = state.t + 3;
  state.bus.current = 0;
  state.bus.loadPct = 0;
  state.bus.voltage = 0;
  state.bus.overloadMinutes = 0;
  for (const pump of Object.values(state.pumps)) {
    if (!pump.on) continue;
    pump.on = false;
    pump.running = false;
    pump.surgeMinutes = 0;
    pump.current = 0;
    pump.baseCurrent = 0;
    pump.flow = 0;
    pump.lastStopAt = state.t;
  }
  addEvent(state, 'trip', '共用母线失电', '反向功率保护动作，全部泵组接触器释放');
  if (state.hospital.source === 'bus') {
    state.hospital.powered = false;
    state.hospital.everLostPower = true;
    addFailure(state, 'hospital_outage', '过载跳闸导致医院支线失电');
  }
}

function updateHospital(state) {
  const generatorReady =
    state.hospital.source === 'generator' && state.hospital.generatorFuel > 0;
  const busReady = state.hospital.source === 'bus' && !state.bus.tripped;
  state.hospital.powered = generatorReady || busReady;
  state.hospital.current =
    state.hospital.source === 'generator' ? 0 : HOSPITAL_CURRENT_A;
  if (state.hospital.powered) {
    state.hospital.outageMinutes = 0;
    return;
  }

  state.hospital.outageMinutes += 1;
  state.hospital.everLostPower = true;
  addFailure(state, 'hospital_outage', '医院支线失电');
}

function updateWater(state) {
  const units = Object.values(state.pumps);
  const rainDepth = state.storm.rain * 0.00004;
  let pumpedThisMinute = 0;

  for (const zone of Object.values(state.zones)) {
    const pump = units.find((item) => item.zoneId === zone.id);
    const flow = pump?.flow || 0;
    const pumpedDepth = (flow * 60) / zone.areaM2;
    const riverSeep =
      state.river.level > state.river.danger
        ? (state.river.level - state.river.danger) *
          0.0032 *
          zone.seepGain
        : 0;
    zone.level = Math.max(
      0,
      zone.level + rainDepth * zone.rainGain + riverSeep - pumpedDepth
    );
    zone.peak = Math.max(zone.peak, zone.level);
    zone.pumpedM3 += flow * 60;
    pumpedThisMinute += flow * 60;
  }
  state.metrics.totalPumpedM3 += pumpedThisMinute;
}

function updateRiver(state) {
  const rainInflow = state.storm.rain * 0.55;
  const pumpInflow = Object.values(state.pumps).reduce(
    (sum, pump) => sum + pump.flow,
    0
  );
  const outflow =
    42 + Math.max(0, state.river.level - 5) * 50;
  const volumeDelta = (rainInflow + pumpInflow - outflow) * 60;
  state.river.level = Math.max(
    4.8,
    state.river.level + volumeDelta / 2300000
  );
  state.river.peak = Math.max(state.river.peak, state.river.level);
  state.river.inflow = rainInflow + pumpInflow;
  state.river.outflow = outflow;
  state.river.pumpedM3 += pumpInflow * 60;

  if (state.river.level >= state.river.danger && !state.river.dangerNotified) {
    state.river.dangerNotified = true;
    addEvent(state, 'warning', '河道超警戒水位', '沿江渗水开始抬高片区积水');
  }
}

function checkWaterAlarms(state) {
  for (const zone of Object.values(state.zones)) {
    if (zone.level >= zone.threshold && !zone.flooded) {
      zone.flooded = true;
      zone.floodedAt = state.t;
      addFailure(state, `flood_${zone.id}`, `${zone.name}达到进水阈值`);
    } else if (
      zone.level >= zone.threshold - 0.1 &&
      !zone.warned &&
      !zone.flooded
    ) {
      zone.warned = true;
      addEvent(state, 'warning', `${zone.name}积水逼近阈值`, '请提高对应泵站排量');
    }
  }
}

export function getWarnings(state) {
  const warnings = [];
  if (state.bus.tripped) {
    warnings.push({ severity: 'critical', text: '共用母线跳闸，等待复位' });
  } else if (state.bus.loadPct > 100) {
    warnings.push({
      severity: 'critical',
      text: `母线过载 ${state.bus.overloadMinutes}/3 分钟`
    });
  } else if (state.bus.loadPct > 90) {
    warnings.push({ severity: 'warning', text: '母线负荷接近上限' });
  }

  for (const pump of Object.values(state.pumps)) {
    if (pump.faulted) {
      warnings.push({
        severity: 'critical',
        text: `${pump.name}设备损伤，需抢修`
      });
    } else if (pump.overloadMinutes > 0) {
      warnings.push({
        severity: 'critical',
        text: `${pump.name}连续超载 ${Math.round(pump.overloadMinutes)}/24 分钟`
      });
    }
  }

  for (const zone of Object.values(state.zones)) {
    if (!zone.flooded && zone.level > zone.threshold - 0.08) {
      warnings.push({
        severity: 'warning',
        text: `${zone.name}水位 ${zone.level.toFixed(2)}m`
      });
    }
  }

  if (
    state.hospital.source === 'generator' &&
    state.hospital.generatorFuel < 30
  ) {
    warnings.push({
      severity: 'warning',
      text: `医院柴发余油 ${Math.round(state.hospital.generatorFuel)} 分钟`
    });
  }
  return warnings;
}

export function getScenarioSummary(state) {
  return {
    status: state.status,
    minute: state.t,
    failures: state.failures.map((failure) => ({ ...failure })),
    pumps: Object.values(state.pumps).map((pump) => ({
      id: pump.id,
      speed: pump.speed,
      on: pump.on,
      running: pump.running,
      current: round(pump.current, 1),
      flow: round(pump.flow, 2),
      health: round(pump.health, 0),
      faulted: pump.faulted
    })),
    bus: {
      current: round(state.bus.current, 1),
      capacity: state.bus.capacity,
      tripped: state.bus.tripped
    },
    zones: Object.values(state.zones).map((zone) => ({
      id: zone.id,
      level: round(zone.level, 3),
      threshold: zone.threshold,
      flooded: zone.flooded
    }))
  };
}
