// Procedural city generation. All coordinates are in meters in a square world.
import { createRng, range, intRange } from './prng.js';

export const WORLD_SIZE = 4000;

const ROAD_NAMES = [
  '长安街', '中山路', '解放大道', '人民南路', '滨河路', '建国道',
  '和平里街', '朝阳大街', '青云路', '梧桐巷', '金桥大道', '望海路',
];

const POI_NAMES = ['中央车站', '市政厅', '大学城', '科技园区', '滨河公园'];

export function generateCity(seed = 20261115) {
  const rng = createRng(seed);
  const half = WORLD_SIZE / 2;

  const hCount = 7;
  const vCount = 7;
  const spacing = WORLD_SIZE / (hCount + 1);
  const horizontals = [];
  const verticals = [];
  for (let i = 1; i <= hCount; i += 1) {
    const y = -half + i * spacing + range(rng, -spacing * 0.18, spacing * 0.18);
    horizontals.push({ name: ROAD_NAMES[i - 1], y, width: i === 4 ? 16 : 9 });
  }
  for (let j = 1; j <= vCount; j += 1) {
    const x = -half + j * spacing + range(rng, -spacing * 0.18, spacing * 0.18);
    verticals.push({ name: ROAD_NAMES[hCount + j - 1], x, width: j === 4 ? 16 : 9 });
  }

  // Every horizontal/vertical crossing is a graph node.
  const nodes = [];
  const index = new Map();
  for (let i = 0; i < horizontals.length; i += 1) {
    for (let j = 0; j < verticals.length; j += 1) {
      const id = nodes.length;
      nodes.push({ id, x: verticals[j].x, y: horizontals[i].y, i, j });
      index.set(`${i}:${j}`, id);
    }
  }
  const edges = buildEdges(nodes, index, horizontals.length, verticals.length);

  const buildings = generateBuildings(rng, horizontals, verticals);
  const parks = generateParks(rng);
  const river = generateRiver(rng);

  const poiCells = [
    { i: 3, j: 3 }, { i: 1, j: 5 }, { i: 5, j: 1 },
    { i: 5, j: 5 }, { i: 1, j: 1 },
  ];
  const pois = poiCells.map((cell, k) => {
    const node = nodes[index.get(`${cell.i}:${cell.j}`)];
    return { id: `poi-${k + 1}`, name: POI_NAMES[k], x: node.x, y: node.y };
  });

  const startId = index.get('3:3');
  const endId = index.get('5:5');
  const route = shortestPath(nodes, edges, startId, endId);

  return {
    seed,
    bounds: { minX: -half, minY: -half, maxX: half, maxY: half },
    roads: { horizontals, verticals },
    graph: { nodes, edges },
    buildings,
    parks,
    river,
    pois,
    route,
  };
}

function buildEdges(nodes, index, hCount, vCount) {
  const edges = [];
  const link = (aId, bId) => {
    const a = nodes[aId];
    const b = nodes[bId];
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    edges.push({ a: aId, b: bId, length });
  };
  for (let i = 0; i < hCount; i += 1) {
    for (let j = 0; j < vCount; j += 1) {
      if (j + 1 < vCount) link(index.get(`${i}:${j}`), index.get(`${i}:${j + 1}`));
      if (i + 1 < hCount) link(index.get(`${i}:${j}`), index.get(`${i + 1}:${j}`));
    }
  }
  return edges;
}

function generateBuildings(rng, horizontals, verticals) {
  const buildings = [];
  const xs = verticals.map((r) => r.x).sort((a, b) => a - b);
  const ys = horizontals.map((r) => r.y).sort((a, b) => a - b);
  for (let i = 0; i < ys.length - 1; i += 1) {
    for (let j = 0; j < xs.length - 1; j += 1) {
      if (rng() < 0.18) continue;
      const x0 = xs[j] + 26;
      const x1 = xs[j + 1] - 26;
      const y0 = ys[i] + 26;
      const y1 = ys[i + 1] - 26;
      const parts = intRange(rng, 1, 3);
      const sliceW = (x1 - x0) / parts;
      for (let p = 0; p < parts; p += 1) {
        if (rng() < 0.15) continue;
        buildings.push({
          x: x0 + p * sliceW + 8,
          y: y0 + range(rng, 0, 14),
          w: sliceW - 16 - range(rng, 0, 10),
          h: y1 - y0 - range(rng, 0, 18),
          shade: intRange(rng, 0, 2),
        });
      }
    }
  }
  return buildings;
}

function generateParks(rng) {
  const parks = [];
  for (let k = 0; k < 3; k += 1) {
    parks.push({
      x: range(rng, -1600, 1200),
      y: range(rng, -1600, 1200),
      w: range(rng, 280, 460),
      h: range(rng, 220, 420),
    });
  }
  return parks;
}

function generateRiver(rng) {
  const points = [];
  const steps = 9;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    points.push({
      x: -WORLD_SIZE / 2 + t * WORLD_SIZE,
      y: -1100 + Math.sin(t * Math.PI * 1.4) * 260 + range(rng, -90, 90),
    });
  }
  return { width: 110, points };
}

// Dijkstra over the road graph; returns the route as world-space points.
function shortestPath(nodes, edges, startId, endId) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.a).push([edge.b, edge.length]);
    adjacency.get(edge.b).push([edge.a, edge.length]);
  }
  const dist = new Map(nodes.map((n) => [n.id, Infinity]));
  const prev = new Map();
  const visited = new Set();
  dist.set(startId, 0);
  while (visited.size < nodes.length) {
    let current = -1;
    let best = Infinity;
    for (const [id, value] of dist) {
      if (!visited.has(id) && value < best) {
        best = value;
        current = id;
      }
    }
    if (current === -1) break;
    if (current === endId) break;
    visited.add(current);
    for (const [next, length] of adjacency.get(current)) {
      const candidate = dist.get(current) + length;
      if (candidate < dist.get(next)) {
        dist.set(next, candidate);
        prev.set(next, current);
      }
    }
  }
  const path = [];
  let cursor = endId;
  while (cursor !== undefined) {
    path.unshift(nodes[cursor]);
    if (cursor === startId) break;
    cursor = prev.get(cursor);
  }
  return path.map((n) => ({ x: n.x, y: n.y }));
}

export function routeLength(route) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
  }
  return total;
}

