import { createRng, randInt, shuffle } from './rng.js';

// 城区节点坐标（Canvas 880x560 内的归一化像素位置）
export const NODES = {
  DEPOT: { id: 'DEPOT', name: '救援站', x: 430, y: 470, kind: 'depot' },
  H1: { id: 'H1', name: '北城医院', x: 430, y: 70, kind: 'hospital' },
  H2: { id: 'H2', name: '东城医院', x: 800, y: 300, kind: 'hospital' },
  C1: { id: 'C1', name: '中北立交', x: 430, y: 250, kind: 'junction' },
  C2: { id: 'C2', name: '中心环岛', x: 430, y: 360, kind: 'junction' },
  W1: { id: 'W1', name: '西环路口', x: 180, y: 250, kind: 'junction' },
  W2: { id: 'W2', name: '西南路口', x: 180, y: 430, kind: 'junction' },
  E1: { id: 'E1', name: '东环路口', x: 680, y: 250, kind: 'junction' },
  E2: { id: 'E2', name: '东南路口', x: 680, y: 430, kind: 'junction' },
  A1: { id: 'A1', name: '西城区A1', x: 120, y: 120, kind: 'site' },
  A2: { id: 'A2', name: '西城区A2', x: 100, y: 350, kind: 'site' },
  B1: { id: 'B1', name: '东城区B1', x: 780, y: 120, kind: 'site' },
};

// 无向道路：id、两端节点、距离(km)、基础拥堵系数
export const EDGES = [
  { id: 'e01', a: 'DEPOT', b: 'C2', dist: 6, baseCongestion: 1.05 },
  { id: 'e02', a: 'C2', b: 'C1', dist: 6, baseCongestion: 1.15 },
  { id: 'e03', a: 'C1', b: 'H1', dist: 9, baseCongestion: 1.1 },
  { id: 'e04', a: 'C2', b: 'W2', dist: 9, baseCongestion: 1.1 },
  { id: 'e05', a: 'W2', b: 'W1', dist: 8, baseCongestion: 1.05 },
  { id: 'e06', a: 'W1', b: 'C1', dist: 10, baseCongestion: 1.1 },
  { id: 'e07', a: 'W1', b: 'A1', dist: 6, baseCongestion: 1.0 },
  { id: 'e08', a: 'W2', b: 'A2', dist: 7, baseCongestion: 1.05 },
  { id: 'e09', a: 'C1', b: 'E1', dist: 10, baseCongestion: 1.15 },
  { id: 'e10', a: 'C2', b: 'E2', dist: 10, baseCongestion: 1.1 },
  { id: 'e11', a: 'E1', b: 'E2', dist: 8, baseCongestion: 1.1 },
  { id: 'e12', a: 'E1', b: 'B1', dist: 6, baseCongestion: 1.0 },
  { id: 'e13', a: 'E1', b: 'H2', dist: 7, baseCongestion: 1.1 },
  { id: 'e14', a: 'E2', b: 'H2', dist: 9, baseCongestion: 1.2 },
  { id: 'e15', a: 'DEPOT', b: 'E2', dist: 11, baseCongestion: 1.15 },
];

export const EDGE_MAP = new Map(EDGES.map((edge) => [edge.id, edge]));

export function neighbors(nodeId) {
  const result = [];
  for (const edge of EDGES) {
    if (edge.a === nodeId) result.push({ node: edge.b, edge });
    if (edge.b === nodeId) result.push({ node: edge.a, edge });
  }
  return result;
}

// 固定 seed 生成两条临时封锁（避开医院/事故点唯一出入口，保证始终可绕行）
export function generateBlockages(seed) {
  const rng = createRng(seed ^ 0x9e3779b9);
  const protectedEdges = new Set(['e07', 'e08', 'e12', 'e03']);
  const candidates = shuffle(
    rng,
    EDGES.filter((edge) => !protectedEdges.has(edge.id)),
  );
  const blockages = [];
  for (let i = 0; i < 2; i += 1) {
    const edge = candidates[i * 2];
    const start = randInt(rng, 12, 22);
    const duration = randInt(rng, 8, 14);
    blockages.push({
      id: `BLK${i + 1}`,
      edgeId: edge.id,
      start,
      end: start + duration,
    });
  }
  return blockages;
}

export function isEdgeBlocked(blockages, edgeId, time) {
  return blockages.some(
    (block) => block.edgeId === edgeId && time >= block.start && time < block.end,
  );
}

// 当前拥堵系数：基础拥堵 + 车辆占用加成（同一条道路上每多一辆车 +0.25）
export function edgeCongestion(edge, time, blockages, vehicleEdgeCounts) {
  if (isEdgeBlocked(blockages, edge.id, time)) return Infinity;
  const occupancy = (vehicleEdgeCounts.get(edge.id) || 0) - 1;
  return edge.baseCongestion + Math.max(0, occupancy) * 0.25;
}

// Dijkstra 最短路（按当前时间的有效行车时间加权），封锁道路直接排除
export function shortestPath(state, fromId, toId, time) {
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  dist.set(fromId, 0);
  const queue = [fromId];
  while (queue.length) {
    queue.sort((a, b) => dist.get(a) - dist.get(b));
    const current = queue.shift();
    if (current === toId) break;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const { node, edge } of neighbors(current)) {
      const congestion = edgeCongestion(
        edge,
        time,
        state.blockages,
        state.vehicleEdgeCounts,
      );
      if (!Number.isFinite(congestion)) continue;
      const cost = (edge.dist * congestion) / 30; // 标称车速 30 km/h
      const candidate = dist.get(current) + cost;
      if (!dist.has(node) || candidate < dist.get(node)) {
        dist.set(node, candidate);
        prev.set(node, { from: current, edgeId: edge.id });
        queue.push(node);
      }
    }
  }
  if (!dist.has(toId)) return null;
  const edgeIds = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const step = prev.get(cursor);
    if (!step) return null;
    edgeIds.unshift(step.edgeId);
    cursor = step.from;
  }
  return { edgeIds, timeCost: dist.get(toId) };
}
