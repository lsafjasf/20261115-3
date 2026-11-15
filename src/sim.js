export const FIXED_DT = 1 / 60;
export const WORLD = Object.freeze({
  width: 1600,
  height: 900,
  anchorX: 800,
  anchorY: 94,
  seafloor: 826,
});

export const FAULTS = Object.freeze([
  Object.freeze({ id: "A", code: "甲", x: 365, y: 705, tool: 1, radius: 58 }),
  Object.freeze({ id: "B", code: "乙", x: 1175, y: 710, tool: 2, radius: 58 }),
  Object.freeze({ id: "C", code: "丙", x: 645, y: 775, tool: 3, radius: 58 }),
]);

export const TOOLS = Object.freeze([
  Object.freeze({ id: 1, name: "切割钳", code: "CUTTER", short: "甲" }),
  Object.freeze({ id: 2, name: "接续器", code: "SPLICER", short: "乙" }),
  Object.freeze({ id: 3, name: "注胶枪", code: "RESIN", short: "丙" }),
]);

export const REEFS = Object.freeze([
  Object.freeze({ x: 238, y: 795, r: 84 }),
  Object.freeze({ x: 975, y: 842, r: 116 }),
  Object.freeze({ x: 1334, y: 759, r: 78 }),
  Object.freeze({ x: 480, y: 864, r: 74 }),
  Object.freeze({ x: 1130, y: 848, r: 66 }),
]);

const CABLE_MIN = 105;
const CABLE_MAX = 1180;
const POD_RADIUS = 20;
const RECOVERY = Object.freeze({ x: 800, y: 158, radius: 76 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sign = (value) => (value < 0 ? -1 : value > 0 ? 1 : 0);

export function normalizeSeed(seed) {
  const value = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  return value || 0x6d2b79f5;
}

export function sanitizeInput(input = {}) {
  const tool = Math.trunc(Number(input.tool));
  return {
    thrustX: sign(clamp(Number(input.thrustX) || 0, -1, 1)),
    thrustY: sign(clamp(Number(input.thrustY) || 0, -1, 1)),
    cable: sign(clamp(Number(input.cable) || 0, -1, 1)),
    tool: tool >= 1 && tool <= 3 ? tool : 0,
  };
}

function nextRandom(state) {
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return state.rngState / 4294967296;
}

export function currentAt(state, x, y) {
  const t = state.time;
  const xCurrent =
    9.2 +
    7.1 * Math.sin(y * 0.0067 + t * 0.48) +
    4.6 * Math.sin(t * 0.21 + y * 0.0018) +
    2.2 * Math.sin(y * 0.019 - t * 0.73);
  const yCurrent =
    2.5 * Math.sin(x * 0.0042 - t * 0.34) +
    1.4 * Math.sin(t * 0.65 + x * 0.0017);
  return { x: xCurrent, y: yCurrent };
}

export function createSimulation(seed = 0x6d2b79f5) {
  return {
    seed: normalizeSeed(seed),
    rngState: normalizeSeed(seed),
    frame: 0,
    time: 0,
    status: "playing",
    failReason: "",
    pod: {
      x: 800,
      y: 210,
      vx: 0,
      vy: 0,
      angle: Math.PI / 2,
      radius: POD_RADIUS,
    },
    cable: {
      length: 260,
      tension: 0.81,
      stretch: 0,
      tensionTime: 0,
      tangleTime: 0,
      nearReef: false,
      ratio: 0.45,
    },
    selectedTool: 1,
    load: 24,
    integrity: 100,
    faults: FAULTS.map((fault) => ({ ...fault, progress: 0, done: false })),
    drifters: [],
    recoveryProgress: 0,
    repairedCount: 0,
    current: currentAt({ time: 0 }, 800, 210),
    events: [],
  };
}

function addEvent(state, type, detail = {}) {
  state.events.push({ type, ...detail });
}

function failMission(state, reason) {
  if (state.status !== "playing") return;
  state.status = "failed";
  state.failReason = reason;
  addEvent(state, "failure", { reason });
}

function spawnDrifters(state, fault) {
  const count = 3;
  for (let i = 0; i < count; i += 1) {
    const angle = nextRandom(state) * Math.PI * 2;
    const radius = 72 + nextRandom(state) * 64;
    const speed = 21 + nextRandom(state) * 26;
    state.drifters.push({
      id: state.drifters.length,
      x: clamp(fault.x + Math.cos(angle) * radius, 90, WORLD.width - 90),
      y: clamp(fault.y + Math.sin(angle) * radius, 126, WORLD.seafloor - 20),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 8,
      r: 11 + nextRandom(state) * 7,
      spin: (nextRandom(state) - 0.5) * 1.8,
      angle: nextRandom(state) * Math.PI * 2,
      cooldown: 0,
      type: state.drifters.length % 3,
    });
  }
}

function reefContact(x, y) {
  return REEFS.some((reef) => Math.hypot(x - reef.x, y - reef.y) < reef.r + POD_RADIUS + 8);
}

function updateFaults(state) {
  for (const fault of state.faults) {
    if (fault.done) continue;
    const distance = Math.hypot(state.pod.x - fault.x, state.pod.y - fault.y);
    if (distance >= fault.radius) {
      if (fault.progress > 0) fault.progress = Math.max(0, fault.progress - FIXED_DT * 0.8);
      continue;
    }

    if (state.selectedTool !== fault.tool) {
      fault.progress = Math.max(0, fault.progress - FIXED_DT * 1.5);
      addEvent(state, "wrong-tool", { fault: fault.id, required: fault.tool });
      continue;
    }

    const before = fault.progress;
    fault.progress = Math.min(1, fault.progress + FIXED_DT / 1.45);
    if (before === 0) addEvent(state, "repair-start", { fault: fault.id, progress: fault.progress });
    if (fault.progress >= 1) {
      fault.done = true;
      state.repairedCount += 1;
      state.load = Math.round((state.load + 7.5) * 10) / 10;
      spawnDrifters(state, fault);

      const joltX = (nextRandom(state) - 0.5) * 24;
      state.pod.vx += joltX;
      state.pod.vy -= 18;
      addEvent(state, "repair-done", {
        fault: fault.id,
        count: state.repairedCount,
        load: state.load,
      });
      if (state.repairedCount === state.faults.length) {
        addEvent(state, "all-repaired", { load: state.load });
      }
    }
  }
}

function updateCable(state, control, applyForce = true) {
  const cable = state.cable;
  cable.length = clamp(cable.length + control.cable * 128 * FIXED_DT, CABLE_MIN, CABLE_MAX);

  const dx = state.pod.x - WORLD.anchorX;
  const dy = state.pod.y - WORLD.anchorY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const stretch = Math.max(0, distance - cable.length);
  const outwardSpeed = Math.max(0, state.pod.vx * ux + state.pod.vy * uy);
  const tension = 0.755 + state.load * 0.0026 + stretch / 131 + outwardSpeed * 0.00082;

  cable.ratio = distance / cable.length;
  cable.stretch = stretch;
  cable.tension = tension;

  if (applyForce && stretch > 0) {
    const spring = stretch * 3.25 + outwardSpeed * 0.48;
    state.pod.vx -= ux * spring * FIXED_DT;
    state.pod.vy -= uy * spring * FIXED_DT;
  }
}

function updateDrifters(state) {
  for (const drifter of state.drifters) {
    const current = currentAt(state, drifter.x, drifter.y);
    drifter.vx += (current.x * 0.12 + 1.7 * Math.sin(state.time * 0.7 + drifter.id)) * FIXED_DT;
    drifter.vy += (current.y * 0.12 + 1.2 * Math.cos(state.time * 0.53 + drifter.id)) * FIXED_DT;
    drifter.vx *= 1 - 0.035 * FIXED_DT;
    drifter.vy *= 1 - 0.035 * FIXED_DT;
    drifter.x += drifter.vx * FIXED_DT;
    drifter.y += drifter.vy * FIXED_DT;
    drifter.angle += drifter.spin * FIXED_DT;
    drifter.cooldown = Math.max(0, drifter.cooldown - FIXED_DT);

    if (drifter.x < 80 + drifter.r) {
      drifter.x = 80 + drifter.r;
      drifter.vx = Math.abs(drifter.vx) * 0.55;
    } else if (drifter.x > WORLD.width - 80 - drifter.r) {
      drifter.x = WORLD.width - 80 - drifter.r;
      drifter.vx = -Math.abs(drifter.vx) * 0.55;
    }
    if (drifter.y < 120 + drifter.r) {
      drifter.y = 120 + drifter.r;
      drifter.vy = Math.abs(drifter.vy) * 0.55;
    } else if (drifter.y > WORLD.seafloor - drifter.r) {
      drifter.y = WORLD.seafloor - drifter.r;
      drifter.vy = -Math.abs(drifter.vy) * 0.55;
    }
  }
}

function resolveDrifterHits(state) {
  for (const drifter of state.drifters) {
    if (drifter.cooldown > 0) continue;
    const dx = state.pod.x - drifter.x;
    const dy = state.pod.y - drifter.y;
    const distance = Math.hypot(dx, dy);
    const combined = POD_RADIUS + drifter.r;
    if (distance >= combined) continue;

    const nx = distance > 0.001 ? dx / distance : 1;
    const ny = distance > 0.001 ? dy / distance : 0;
    state.pod.vx += nx * 44;
    state.pod.vy += ny * 44;
    drifter.vx -= nx * 31;
    drifter.vy -= ny * 31;
    drifter.cooldown = 1.25;
    state.integrity = Math.max(0, state.integrity - 13);
    addEvent(state, "collision", {
      integrity: state.integrity,
      x: drifter.x,
      y: drifter.y,
    });
  }
}

function updateRecovery(state) {
  if (state.repairedCount !== state.faults.length) {
    state.recoveryProgress = 0;
    return;
  }

  const distance = Math.hypot(state.pod.x - RECOVERY.x, state.pod.y - RECOVERY.y);
  const speed = Math.hypot(state.pod.vx, state.pod.vy);
  const inWindow = distance < RECOVERY.radius && speed < 72 && state.cable.tension < 1.2;
  if (inWindow) {
    state.recoveryProgress = Math.min(2.2, state.recoveryProgress + FIXED_DT);
    if (state.recoveryProgress >= 2.2) {
      state.status = "won";
      addEvent(state, "success", { time: state.time });
    }
  } else {
    state.recoveryProgress = Math.max(0, state.recoveryProgress - FIXED_DT * 1.8);
  }
}

export function stepSimulation(state, rawInput = {}) {
  state.events = [];
  if (state.status !== "playing") return state;

  const input = sanitizeInput(rawInput);
  state.frame += 1;
  state.time = state.frame * FIXED_DT;

  if (input.tool) state.selectedTool = input.tool;
  const pod = state.pod;
  state.current = currentAt(state, pod.x, pod.y);

  updateCable(state, input);

  const thrust = 214;
  let ax = input.thrustX * thrust + state.current.x * 0.68;
  let ay = input.thrustY * thrust + state.current.y * 0.68;
  pod.vx += ax * FIXED_DT;
  pod.vy += ay * FIXED_DT;
  pod.vx *= 0.9855;
  pod.vy *= 0.987;

  const speed = Math.hypot(pod.vx, pod.vy);
  if (speed > 245) {
    pod.vx = (pod.vx / speed) * 245;
    pod.vy = (pod.vy / speed) * 245;
  }

  pod.x += pod.vx * FIXED_DT;
  pod.y += pod.vy * FIXED_DT;
  if (speed > 4) pod.angle = Math.atan2(pod.vy, pod.vx);

  const leftWall = 126 + Math.sin(pod.y * 0.013) * 17;
  const rightWall = 1474 - Math.sin(pod.y * 0.011 + 1.7) * 19;
  if (pod.x < leftWall) {
    pod.x = leftWall;
    pod.vx = Math.abs(pod.vx) * 0.38;
    addEvent(state, "wall-hit", { side: "left" });
  } else if (pod.x > rightWall) {
    pod.x = rightWall;
    pod.vx = -Math.abs(pod.vx) * 0.38;
    addEvent(state, "wall-hit", { side: "right" });
  }
  if (pod.y < 124) {
    pod.y = 124;
    pod.vy = Math.abs(pod.vy) * 0.4;
  } else if (pod.y > WORLD.seafloor - POD_RADIUS) {
    pod.y = WORLD.seafloor - POD_RADIUS;
    pod.vy = -Math.abs(pod.vy) * 0.4;
    addEvent(state, "wall-hit", { side: "bottom" });
  }

  updateCable(state, { cable: 0 }, false);
  state.cable.nearReef = reefContact(pod.x, pod.y);
  if (state.cable.ratio < 0.72 && state.cable.nearReef) {
    state.cable.tangleTime = Math.min(1.8, state.cable.tangleTime + FIXED_DT);
    addEvent(state, "tangle-warning", { level: state.cable.tangleTime });
  } else {
    state.cable.tangleTime = Math.max(0, state.cable.tangleTime - FIXED_DT * 1.25);
  }

  if (state.cable.tension > 1.58) {
    state.cable.tensionTime = Math.min(0.65, state.cable.tensionTime + FIXED_DT);
    addEvent(state, "tension-warning", { level: state.cable.tensionTime });
  } else {
    state.cable.tensionTime = Math.max(0, state.cable.tensionTime - FIXED_DT * 1.5);
  }

  updateFaults(state);
  updateDrifters(state);
  resolveDrifterHits(state);

  if (state.cable.tensionTime >= 0.5) {
    failMission(state, "脐带张力持续超限，安全销切断");
  } else if (state.cable.tangleTime >= 1.6) {
    failMission(state, "松弛脐带缠入礁石，回收失败");
  } else if (state.integrity <= 0) {
    failMission(state, "漂流物连续撞击，维修舱失压");
  } else {
    updateRecovery(state);
  }

  return state;
}

const hashView = new DataView(new ArrayBuffer(8));

function hashWord(hash, word) {
  let value = word >>> 0;
  for (let i = 0; i < 4; i += 1) {
    hash = Math.imul(hash ^ (value & 0xff), 16777619) >>> 0;
    value >>>= 8;
  }
  return hash;
}

function hashNumber(hash, value) {
  hashView.setFloat64(0, Number.isFinite(value) ? value : 0, true);
  const low = hashView.getUint32(0, true);
  const high = hashView.getUint32(4, true);
  return hashWord(hashWord(hash, high), low);
}

function hashText(hash, text) {
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  return hash;
}

export function hashState(state) {
  let hash = hashText(2166136261, "ABYSSAL-SPLICE");
  hash = hashText(hash, state.status);
  hash = hashWord(hash, state.frame);
  hash = hashWord(hash, state.rngState);
  hash = hashNumber(hash, state.load);
  hash = hashNumber(hash, state.integrity);
  hash = hashNumber(hash, state.selectedTool);
  hash = hashNumber(hash, state.recoveryProgress);
  hash = hashWord(hash, state.repairedCount);

  for (const value of [
    state.pod.x,
    state.pod.y,
    state.pod.vx,
    state.pod.vy,
    state.cable.length,
    state.cable.tension,
    state.cable.stretch,
    state.cable.tensionTime,
    state.cable.tangleTime,
  ]) {
    hash = hashNumber(hash, value);
  }

  for (const fault of state.faults) {
    hash = hashNumber(hash, fault.progress);
    hash = hashWord(hash, fault.done ? 1 : 0);
  }

  hash = hashWord(hash, state.drifters.length);
  for (const drifter of state.drifters) {
    hash = hashNumber(hash, drifter.x);
    hash = hashNumber(hash, drifter.y);
    hash = hashNumber(hash, drifter.vx);
    hash = hashNumber(hash, drifter.vy);
    hash = hashNumber(hash, drifter.r);
    hash = hashNumber(hash, drifter.angle);
    hash = hashNumber(hash, drifter.cooldown);
  }

  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function runTrace(seed, inputs) {
  const state = createSimulation(seed);
  const hashes = [];
  for (let i = 0; i < inputs.length; i += 1) {
    stepSimulation(state, inputs[i]);
    hashes.push(hashState(state));
    if (state.status !== "playing" && i < inputs.length - 1) break;
  }
  return {
    state,
    hashes,
    finalHash: hashes.length ? hashes[hashes.length - 1] : hashState(state),
  };
}

export function compareTraces(seed, inputs, recordedHashes) {
  const replay = runTrace(seed, inputs);
  const length = Math.min(replay.hashes.length, recordedHashes.length);
  for (let i = 0; i < length; i += 1) {
    if (replay.hashes[i] !== recordedHashes[i]) {
      return { ok: false, mismatchFrame: i, expected: recordedHashes[i], actual: replay.hashes[i] };
    }
  }
  if (replay.hashes.length !== recordedHashes.length) {
    return {
      ok: false,
      mismatchFrame: length,
      expected: recordedHashes[length] || "(missing)",
      actual: replay.hashes[length] || "(missing)",
    };
  }
  return { ok: true, frames: length, finalHash: replay.finalHash };
}
