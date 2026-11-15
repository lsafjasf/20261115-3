/* 仓库火场模拟核心：浏览器 UI 与 Node 测试共用。 */
(function (global) {
'use strict';

const W = 40, H = 26;
const CELL = { FLOOR: 0, WALL: 1, RACK: 2, DOOR: 3, EXIT: 4 };
const PMAX = 10;            // 泵全速、无负载时的压力（bar）
const SIM_SECONDS = 1200;   // 20 分钟模拟
const HOSE_MAX_LEN = 22;    // 水带最大铺设长度（曼哈顿距离）
const HOSE_MAX_COUNT = 8;
const SUPPRESS_RADIUS = 2.6;
const HEAT_RADIUS = 5.5;
const DOOR_CLOSE_HEAT = 45; // 通道受热封闭阈值

const DOOR_CELLS = [[13, 8], [13, 18], [26, 6], [26, 14], [26, 20]];
const FIRE_CELLS = [[6, 4], [33, 20], [22, 14]];
const WORKER_CELLS = [[10, 10], [17, 5], [22, 20], [30, 8], [35, 12], [24, 9]];
const EXIT_CELLS = [[2, 0], [37, H - 1]];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idx(x, y) { return y * W + x; }

function buildGrid() {
  const g = new Uint8Array(W * H).fill(CELL.FLOOR);
  for (let x = 0; x < W; x++) { g[idx(x, 0)] = CELL.WALL; g[idx(x, H - 1)] = CELL.WALL; }
  for (let y = 0; y < H; y++) { g[idx(0, y)] = CELL.WALL; g[idx(W - 1, y)] = CELL.WALL; }
  for (let y = 1; y < H - 1; y++) { g[idx(13, y)] = CELL.WALL; g[idx(26, y)] = CELL.WALL; }
  for (const [dx, dy] of DOOR_CELLS) g[idx(dx, dy)] = CELL.DOOR;
  const keepClear = (x, y) =>
    FIRE_CELLS.some(f => Math.abs(f[0] - x) + Math.abs(f[1] - y) <= 2) ||
    DOOR_CELLS.some(d => Math.abs(d[0] - x) + Math.abs(d[1] - y) <= 1) ||
    WORKER_CELLS.some(w => w[0] === x && w[1] === y);
  for (const ry of [6, 12, 18]) {
    for (let x = 2; x < W - 2; x++) {
      if (x % 7 === 0 || x % 7 === 1) continue;
      if (g[idx(x, ry)] !== CELL.FLOOR) continue;
      if (keepClear(x, ry)) continue;
      g[idx(x, ry)] = CELL.RACK;
    }
  }
  for (const [ex, ey] of EXIT_CELLS) g[idx(ex, ey)] = CELL.EXIT;
  return g;
}

function createGame(seed) {
  const state = {
    t: 0,
    status: 'running', // running | won | lost
    rand: mulberry32(seed >>> 0),
    grid: buildGrid(),
    fires: FIRE_CELLS.map(([x, y], i) => ({ id: i, x, y, intensity: 60, water: 0, extinguished: false })),
    smoke: new Float32Array(W * H),
    heat: new Float32Array(W * H),
    doors: DOOR_CELLS.map(([x, y]) => ({ x, y, closed: false })),
    mains: {
      A: { id: 'A', row: H - 2, pumpX: 1, speed: 0, pressure: 0, load: 0 },
      B: { id: 'B', row: 1, pumpX: W - 2, speed: 0, pressure: 0, load: 0 },
    },
    hoses: [],
    nextHoseId: 1,
    workers: WORKER_CELLS.map(([x, y], i) => ({
      id: i, x, y, hp: 100, evacuated: false, dead: false, path: [], moveTimer: 0, repath: 0,
    })),
    log: [],
    opts: { autoBurst: false },
    stats: { bursts: 0, doorsClosed: 0, maxSmoke: 0, minVis: 1 },
  };
  return state;
}

function pushLog(state, type, msg) {
  state.log.push({ t: state.t, type, msg });
}
// ---------- 玩家操作 ----------

function setPump(state, mainId, speed) {
  const m = state.mains[mainId];
  if (m) m.speed = Math.max(0, Math.min(1, speed));
}

function layHose(state, mainId, tapX, tx, ty) {
  const m = state.mains[mainId];
  if (!m) return { ok: false, error: 'no main' };
  if (state.hoses.length >= HOSE_MAX_COUNT) return { ok: false, error: '水带数量已达上限' };
  if (tapX < 1 || tapX > W - 2) return { ok: false, error: '接口不在主干上' };
  const c = state.grid[idx(tx, ty)];
  if (c === CELL.WALL || c === CELL.RACK) return { ok: false, error: '目标点不可达' };
  const len = Math.abs(tapX - tx) + Math.abs(m.row - ty);
  if (len > HOSE_MAX_LEN) return { ok: false, error: '超出水带长度' };
  const hose = {
    id: state.nextHoseId++, main: mainId, tapX, tapY: m.row, tx, ty,
    length: len, open: true, burst: false, flow: 0, pressure: 0,
  };
  state.hoses.push(hose);
  pushLog(state, 'lay', `水带 #${hose.id} 铺设：主干${mainId} (${tapX},${m.row}) → (${tx},${ty})`);
  return { ok: true, hose };
}

function setBranch(state, hoseId, open) {
  const h = state.hoses.find(h => h.id === hoseId);
  if (h) {
    h.open = !!open;
    pushLog(state, 'branch', `水带 #${hoseId} 支路${open ? '开启' : '关闭'}`);
  }
}

function burstHose(state, hoseId) {
  const h = state.hoses.find(h => h.id === hoseId);
  if (h && !h.burst) {
    h.burst = true;
    state.stats.bursts++;
    pushLog(state, 'burst', `⚠ 水带 #${hoseId} 破裂，漏水失压！`);
  }
}

// ---------- 水力计算 ----------
// 每条开启的支路都会拉低主干压力；破裂且未关闭的支路相当于额外泄漏负载。
function computeHydraulics(state) {
  for (const key of ['A', 'B']) {
    const m = state.mains[key];
    let load = 0;
    for (const h of state.hoses) {
      if (h.main === key && h.open) load += h.burst ? 2.5 : 1;
    }
    m.load = load;
    m.pressure = (m.speed * PMAX) / (1 + 0.35 * load);
  }
  for (const h of state.hoses) {
    const m = state.mains[h.main];
    if (!h.open) { h.pressure = m.pressure; h.flow = 0; continue; }
    const p = Math.max(0, m.pressure - 0.05 * h.length);
    h.pressure = p;
    h.flow = h.burst ? 0.12 * Math.sqrt(p) : Math.sqrt(p);
  }
}
// ---------- 火势 / 烟 / 热 ----------

function updateFires(state) {
  for (const f of state.fires) {
    if (f.extinguished) continue;
    let water = 0;
    for (const h of state.hoses) {
      if (!h.open || h.flow <= 0) continue;
      const d = Math.hypot(h.tx - f.x, h.ty - f.y);
      if (d <= SUPPRESS_RADIUS) water += h.flow * (1 - d / (SUPPRESS_RADIUS + 1));
    }
    f.water = water;
    f.intensity += 0.4 - water * 0.35;
    if (f.intensity <= 0) {
      f.intensity = 0;
      f.extinguished = true;
      pushLog(state, 'extinguished', `火点 ${f.id + 1} 被扑灭`);
    }
    if (f.intensity > 100) f.intensity = 100;
  }
}

function updateSmoke(state) {
  const s = state.smoke, g = state.grid;
  for (const f of state.fires) {
    if (f.extinguished) continue;
    const e = f.intensity * 0.012;
    s[idx(f.x, f.y)] += e;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s[idx(f.x + dx, f.y + dy)] += e * 0.5;
  }
  const next = Float32Array.from(s);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (g[i] === CELL.WALL || g[i] === CELL.RACK) { next[i] = s[i] * 0.98; continue; }
      let sum = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = idx(x + dx, y + dy);
        if (g[j] === CELL.WALL || g[j] === CELL.RACK) continue;
        sum += s[j]; n++;
      }
      next[i] = s[i] + (n ? (sum / n - s[i]) * 0.12 : 0);
      next[i] *= 0.992;
      if (next[i] > 1.2) next[i] = 1.2;
      if (next[i] > state.stats.maxSmoke) state.stats.maxSmoke = next[i];
    }
  }
  state.smoke = next;
}

function updateHeatAndDoors(state) {
  const heat = state.heat;
  for (const f of state.fires) {
    if (f.extinguished) continue;
    const r = Math.ceil(HEAT_RADIUS);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = f.x + dx, y = f.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(dx, dy);
        if (d > HEAT_RADIUS) continue;
        heat[idx(x, y)] += f.intensity * 0.06 * (1 - d / HEAT_RADIUS);
      }
    }
  }
  for (let i = 0; i < heat.length; i++) {
    heat[i] -= 0.15;
    if (heat[i] < 0) heat[i] = 0;
    if (heat[i] > 120) heat[i] = 120;
  }
  for (const door of state.doors) {
    if (door.closed) continue;
    if (heat[idx(door.x, door.y)] >= DOOR_CLOSE_HEAT) {
      door.closed = true;
      state.stats.doorsClosed++;
      pushLog(state, 'doorClosed', `通道 (${door.x},${door.y}) 受热封闭`);
    }
  }
}

function visibilityAt(state, x, y) {
  const v = 1 - state.smoke[idx(x, y)] * 1.4;
  return Math.max(0.05, Math.min(1, v));
}
// ---------- 人员撤离 ----------

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function passable(state, x, y, avoidDanger) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const c = state.grid[idx(x, y)];
  if (c === CELL.WALL || c === CELL.RACK) return false;
  if (c === CELL.DOOR) {
    const d = state.doors.find(d => d.x === x && d.y === y);
    if (d && d.closed) return false;
  }
  if (avoidDanger) {
    if (state.heat[idx(x, y)] > 55) return false;
    for (const f of state.fires) {
      if (!f.extinguished && Math.abs(f.x - x) + Math.abs(f.y - y) <= 1) return false;
    }
  }
  return true;
}

function findPath(state, sx, sy) {
  for (const avoid of [true, false]) {
    const prev = new Int32Array(W * H).fill(-1);
    const start = idx(sx, sy);
    prev[start] = start;
    const q = [start];
    let found = -1;
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      if (state.grid[cur] === CELL.EXIT) { found = cur; break; }
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!passable(state, nx, ny, avoid)) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (found !== -1) {
      const path = [];
      let cur = found;
      while (cur !== start) { path.push(cur); cur = prev[cur]; }
      path.reverse();
      return path;
    }
  }
  return [];
}

function updateWorkers(state) {
  for (const w of state.workers) {
    if (w.evacuated || w.dead) continue;
    const i = idx(w.x, w.y);
    const sm = state.smoke[i], ht = state.heat[i];
    let dmg = 0;
    if (sm > 0.55) dmg += (sm - 0.55) * 10;
    if (ht > 40) dmg += (ht - 40) * 0.12;
    if (dmg > 0) {
      w.hp -= dmg;
      if (w.hp <= 0) {
        w.hp = 0; w.dead = true;
        pushLog(state, 'death', `人员 ${w.id + 1} 被困倒下`);
        continue;
      }
    }
    if (state.grid[i] === CELL.EXIT) {
      w.evacuated = true;
      pushLog(state, 'evac', `人员 ${w.id + 1} 撤离`);
      continue;
    }
    w.repath--;
    if (w.repath <= 0 || !w.path.length) {
      w.path = findPath(state, w.x, w.y);
      w.repath = 6;
    }
    w.moveTimer++;
    const slow = sm > 0.4 ? 3 : 2; // 浓烟中行动变慢
    if (w.moveTimer >= slow && w.path.length) {
      w.moveTimer = 0;
      const next = w.path.shift();
      w.x = next % W;
      w.y = (next / W) | 0;
    }
  }
}
// ---------- 主循环 ----------

function step(state) {
  if (state.status !== 'running') return;
  state.t++;
  computeHydraulics(state);
  updateFires(state);
  updateSmoke(state);
  updateHeatAndDoors(state);
  updateWorkers(state);
  for (let i = 0; i < state.smoke.length; i++) {
    const v = 1 - state.smoke[i] * 1.4;
    if (v < state.stats.minVis) state.stats.minVis = Math.max(0.05, v);
  }
  if (state.opts.autoBurst && state.t > 60) {
    for (const h of state.hoses) {
      if (h.open && !h.burst && h.flow > 0.5 && state.rand() < 0.0035) burstHose(state, h.id);
    }
  }
  if (state.workers.some(w => w.dead)) {
    state.status = 'lost';
    pushLog(state, 'lost', '有人员未能撤出，任务失败');
  } else if (state.t >= SIM_SECONDS) {
    state.status = 'lost';
    pushLog(state, 'lost', '超过 20 分钟，任务失败');
  } else if (state.fires.every(f => f.extinguished) && state.workers.every(w => w.evacuated)) {
    state.status = 'won';
    pushLog(state, 'won', '全部火点扑灭，人员安全撤离！');
  }
}

const API = {
  W, H, CELL, PMAX, SIM_SECONDS, HOSE_MAX_LEN, SUPPRESS_RADIUS,
  createGame, setPump, layHose, setBranch, burstHose,
  computeHydraulics, step, findPath, visibilityAt,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else global.FireSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
