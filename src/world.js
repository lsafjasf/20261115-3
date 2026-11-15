// 确定性世界定义：6x4 街网、海拔、居民分布、避难所、初始封锁道路、水位曲线。

export const TICK_MS = 10_000;          // 一个逻辑 tick = 10 秒
export const TICKS = 180;               // 30 分钟
export const WATER_START = 0.05;        // 米
export const WATER_END = 3.4;           // 30 分钟时水位（米）
export const BUS_CAPACITY = 25;
export const BOARD_PER_TICK = 10;       // 每 tick 上车人数
export const DWELL_TICKS = 2;           // 默认上下客驻留 20 秒
export const BASE_SPEED = 18000;        // 像素/小时，空载（一条 150px 边约 3 个 tick）
export const LOAD_FACTOR = 0.6;         // 满载时速度系数
export const EVAC_RATIO = 0.8;

export const COLS = 6;
export const ROWS = 4;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function waterLevelAt(tick) {
  const p = Math.min(1, Math.max(0, tick / TICKS));
  return WATER_START + (WATER_END - WATER_START) * p;
}

// 某海拔点被淹没的 tick（水位达到海拔即断行）
export function cutTickOf(elev) {
  if (elev <= WATER_START) return 0;
  if (elev >= WATER_END) return Infinity;
  const p = (elev - WATER_START) / (WATER_END - WATER_START);
  return p * TICKS;
}

export function edgeKey(a, b) {
  return a < b ? `${a}>${b}` : `${b}>${a}`;
}

export function createWorld(seed = 20261115) {
  const rnd = mulberry32(seed);
  const nodes = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = r * COLS + c;
      // 顶部行（避难所侧）海拔更高、最后被淹；底部低洼最先进水
      const elev = +(1.5 + (ROWS - 1 - r) * 0.55 + (rnd() - 0.5) * 0.45).toFixed(2);
      nodes.push({
        id, r, c,
        x: 80 + c * 160,
        y: 70 + r * 150,
        elev,
        cutTick: cutTickOf(elev),
        residents: 0,
      });
    }
  }

  const edges = [];
  const edgeIndex = new Map();
  const addEdge = (a, b, blocked = false) => {
    const na = nodes[a], nb = nodes[b];
    const length = Math.hypot(na.x - nb.x, na.y - nb.y);
    const elev = Math.min(na.elev, nb.elev);
    const id = `e${edges.length}`;
    const edge = {
      id, from: a, to: b, length,
      elev,
      cutTick: blocked ? 0 : cutTickOf(elev),
      blocked,
      priority: 0,
    };
    edges.push(edge);
    edgeIndex.set(edgeKey(a, b), edge);
  };
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS - 1; c++) addEdge(r * COLS + c, r * COLS + c + 1);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS - 1; r++) addEdge(r * COLS + c, (r + 1) * COLS + c);

  // 两条初始封锁道路（路障，整场不可通行）：e11 = 13-14，e8 = 9-10
  const blockedEdgeIds = [];
  for (const eid of ['e11', 'e8']) {
    const e = edges.find((x) => x.id === eid);
    e.blocked = true; e.cutTick = 0;
    blockedEdgeIds.push(e.id);
  }

  // 居民分布：避难所之外的 10 个街区，合计 220 人
  const shelterId = 5;
  const homeIds = [7, 8, 10, 11, 13, 14, 16, 17, 20, 22];
  const weights = [1.4, 1.1, 1.0, 1.3, 0.9, 1.2, 1.1, 1.0, 0.8, 1.2];
  const totalW = weights.reduce((s, w) => s + w, 0);
  let residentsTotal = 0;
  homeIds.forEach((nid, i) => {
    const pop = Math.round((weights[i] / totalW) * 220);
    nodes[nid].residents = pop;
    residentsTotal += pop;
  });
  // 修正取整误差到最后一个街区
  const delta = 220 - residentsTotal;
  nodes[homeIds[homeIds.length - 1]].residents += delta;
  residentsTotal += delta;

  return {
    seed,
    nodes, edges, edgeIndex,
    shelterId,
    homeIds,
    residentsTotal,
    evacTarget: Math.ceil(residentsTotal * EVAC_RATIO),
    blockedEdgeIds,
    tick: 0,
  };
}
