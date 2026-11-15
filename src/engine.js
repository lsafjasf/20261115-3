const DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];
const DIR_DIST = DIRS.map(([dx, dy]) => Math.hypot(dx, dy));
const EPSILON = 0.0015;
const CELL_SIZE = 24;
const EROSION_K = 0.00023;
const DEPOSITION_K = 0.000034;

export const GRID = Object.freeze({ width: 112, height: 72, cellSize: CELL_SIZE });

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function fractalNoise(x, y, seed, octaves = 5) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 97) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total / norm;
}

export function generateTerrain(seed, width = GRID.width, height = GRID.height) {
  const count = width * height;
  const elevation = new Float64Array(count);
  const hardnessMap = new Float64Array(count);
  const outletX = Math.floor(width * 0.54);
  const outletY = height - 2;
  const outlet = outletY * width + outletX;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / width;
      const ny = y / height;
      const ridgeA = Math.abs(nx - 0.24 + 0.1 * Math.sin(ny * 5.2));
      const ridgeB = Math.abs(nx - 0.74 + 0.08 * Math.cos(ny * 4.6));
      const ridgeC = Math.abs(ny - 0.30 + 0.11 * Math.sin(nx * 5.8));
      const massif = 390 * Math.exp(-Math.pow((nx - 0.47) / 0.42, 2))
        + 210 * Math.exp(-Math.pow((ny - 0.20) / 0.34, 2));
      const rugged = fractalNoise(nx * 4.1, ny * 3.4, seed, 5) * 760;
      const fine = fractalNoise(nx * 13, ny * 11, seed + 31, 3) * 110;
      const valley = 120 * Math.exp(-Math.pow((nx - outletX / width) / 0.085, 2)) * ny;
      const slopeToOutlet = 340 * Math.sqrt(Math.pow((x - outletX) / width, 2)
        + Math.pow((y - outletY) / height, 2));
      const rim = Math.max(0, 1 - Math.min(nx, 1 - nx, ny, 1 - ny) * 8) * 140;
      const ridges = 185 * Math.exp(-ridgeA * 10) + 130 * Math.exp(-ridgeB * 12)
        + 90 * Math.exp(-ridgeC * 14);
      elevation[y * width + x] = 220 + rugged + fine + massif + ridges
        + slopeToOutlet + rim - valley;
      hardnessMap[y * width + x] = 0.78 + valueNoise(nx * 8, ny * 7, seed + 811) * 0.55;
    }
  }
  elevation[outlet] = 62;
  return { width, height, elevation, hardnessMap, outlet, outletX, outletY, seed };
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(index, priority) {
    const item = { index, priority };
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent].priority <= priority) break;
      this.items[child] = this.items[parent];
      child = parent;
    }
    this.items[child] = item;
  }

  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let smaller = left;
        if (right < this.items.length
          && this.items[right].priority < this.items[left].priority) smaller = right;
        if (this.items[smaller].priority > last.priority) break;
        this.items[parent] = this.items[smaller];
        parent = smaller;
      }
      this.items[parent] = last;
    }
    return root;
  }
}

export function computeRouting(terrain) {
  const { width, height, elevation, outlet } = terrain;
  const count = width * height;
  const filled = new Float64Array(count);
  const receiver = new Int32Array(count);
  receiver.fill(-1);
  const visited = new Uint8Array(count);
  const heap = new MinHeap();
  filled[outlet] = elevation[outlet];
  visited[outlet] = 1;
  heap.push(outlet, filled[outlet]);

  while (heap.items.length) {
    const current = heap.pop();
    if (!current) break;
    const cx = current.index % width;
    const cy = Math.floor(current.index / width);
    for (let d = 0; d < DIRS.length; d += 1) {
      const nx = cx + DIRS[d][0];
      const ny = cy + DIRS[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (visited[next]) continue;
      visited[next] = 1;
      receiver[next] = current.index;
      filled[next] = Math.max(elevation[next], filled[current.index] + EPSILON);
      heap.push(next, filled[next]);
    }
  }
  return { filled, receiver, visited };
}

export function computeHydrology(terrain, routing, rainfall) {
  const { width, height } = terrain;
  const count = width * height;
  const receiver = routing.receiver;
  const localRunoff = rainfall / 1000 / 3600 * CELL_SIZE * CELL_SIZE;
  const flow = new Float64Array(count);
  const upstream = new Uint32Array(count);
  flow.fill(localRunoff);
  upstream.fill(1);

  const order = buildTopologicalOrder(receiver, count, terrain.outlet);
  for (let k = 0; k < order.length; k += 1) {
    const cell = order[k];
    const next = receiver[cell];
    if (next >= 0) {
      flow[next] += flow[cell];
      upstream[next] += upstream[cell];
    }
  }
  const totalInput = localRunoff * count;
  const outletFlow = flow[terrain.outlet];
  const conservationError = Math.abs(outletFlow - totalInput);
  return {
    flow,
    upstream,
    order,
    localRunoff,
    totalInput,
    outletFlow,
    conservationError,
  };
}

function buildTopologicalOrder(receiver, count, outlet) {
  const indegree = new Uint32Array(count);
  for (let cell = 0; cell < count; cell += 1) {
    const next = receiver[cell];
    if (next >= 0) indegree[next] += 1;
  }
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;
  for (let cell = 0; cell < count; cell += 1) {
    if (indegree[cell] === 0) queue[tail++] = cell;
  }
  const order = new Uint32Array(count);
  let visited = 0;
  while (head < tail) {
    const cell = queue[head++];
    order[visited++] = cell;
    const next = receiver[cell];
    if (next >= 0) {
      indegree[next] -= 1;
      if (indegree[next] === 0) queue[tail++] = next;
    }
  }
  if (visited !== count || order[0] === outlet) {
    throw new Error('Flow graph is not a single acyclic tree rooted at the outlet');
  }
  return order;
}

export function watershedOf(routing, cell) {
  const cells = [];
  const stack = [cell];
  while (stack.length) {
    const current = stack.pop();
    cells.push(current);
    for (const candidate of routing.children[current] || []) stack.push(candidate);
  }
  return cells;
}

export function buildChildren(receiver, count) {
  const children = Array.from({ length: count }, () => []);
  for (let cell = 0; cell < count; cell += 1) {
    const next = receiver[cell];
    if (next >= 0) children[next].push(cell);
  }
  return children;
}

export function attachChildren(routing) {
  routing.children = buildChildren(routing.receiver, routing.receiver.length);
  return routing;
}

export function collectUpstream(routing, cells) {
  const marked = new Uint8Array(routing.receiver.length);
  const stack = [...cells];
  const result = [];
  while (stack.length) {
    const cell = stack.pop();
    if (marked[cell]) continue;
    marked[cell] = 1;
    result.push(cell);
    const children = routing.children[cell];
    for (let i = 0; i < children.length; i += 1) stack.push(children[i]);
  }
  return result;
}

export function refreshHydrology(terrain, rainfall) {
  const routing = attachChildren(computeRouting(terrain));
  const hydrology = computeHydrology(terrain, routing, rainfall);
  return { routing, hydrology };
}

export function createSimulation(terrain, params) {
  const baseTerrain = {
    ...terrain,
    elevation: new Float64Array(terrain.elevation),
    hardnessMap: new Float64Array(terrain.hardnessMap),
  };
  const { routing, hydrology } = refreshHydrology(baseTerrain, params.rainfall);
  const count = baseTerrain.width * baseTerrain.height;
  return {
    terrain: baseTerrain,
    routing,
    hydrology,
    params: { ...params },
    stepCount: 0,
    simTime: 0,
    cumulativeErosion: new Float64Array(count),
    cumulativeDeposition: new Float64Array(count),
    lastDelta: new Float64Array(count),
    affectedMask: new Uint8Array(count),
    totals: { eroded: 0, deposited: 0 },
  };
}

export function setSimulationParams(simulation, params) {
  simulation.params = { ...simulation.params, ...params };
  if ('rainfall' in params) {
    simulation.hydrology = computeHydrology(
      simulation.terrain,
      simulation.routing,
      simulation.params.rainfall,
    );
  }
}

export function stepSimulation(simulation, steps = 1) {
  const { terrain, hardnessMap } = simulation.terrain;
  for (let step = 0; step < steps; step += 1) {
    const { elevation, width, hardnessMap: rocks, outlet } = simulation.terrain;
    const { receiver, filled } = simulation.routing;
    const { upstream } = simulation.hydrology;
    const delta = new Float64Array(elevation.length);
    const { rainfall, hardness, dt } = simulation.params;
    const rainFactor = Math.max(0.12, rainfall / 100);
    let eroded = 0;
    let deposited = 0;

    for (let cell = 0; cell < elevation.length; cell += 1) {
      if (cell === outlet) continue;
      const next = receiver[cell];
      if (next < 0) continue;
      const cx = cell % width;
      const cy = Math.floor(cell / width);
      const nx = next % width;
      const ny = Math.floor(next / width);
      const distance = Math.hypot(nx - cx, ny - cy) * CELL_SIZE;
      const slope = Math.max(0, (elevation[cell] - elevation[next]) / distance);
      const hydraulicSlope = Math.max(
        0.0001,
        (filled[cell] - filled[next]) / Math.max(1, distance),
      );
      const discharge = Math.max(1, upstream[cell]);
      const resistance = Math.max(0.35, rocks[cell] * hardness);
      const streamPower = EROSION_K * rainFactor
        * Math.pow(discharge, 0.70) * Math.pow(Math.max(slope, hydraulicSlope * 0.25), 1.12)
        / resistance;
      const erosion = Math.min(2.4, streamPower * dt);

      let deposit = 0;
      if (discharge > 10 && hydraulicSlope < 0.018) {
        const trapping = (0.018 - hydraulicSlope) / 0.018;
        deposit = Math.min(1.5, DEPOSITION_K * rainFactor
          * Math.pow(discharge, 0.82) * trapping / resistance * dt);
      }
      const change = deposit - erosion;
      delta[cell] = change;
      eroded += Math.max(0, -change);
      deposited += Math.max(0, change);
    }

    for (let cell = 0; cell < elevation.length; cell += 1) {
      if (cell === outlet) continue;
      elevation[cell] = Math.max(20, elevation[cell] + delta[cell]);
      simulation.cumulativeErosion[cell] += Math.max(0, -delta[cell]);
      simulation.cumulativeDeposition[cell] += Math.max(0, delta[cell]);
    }
    simulation.lastDelta = delta;
    simulation.totals.eroded += eroded;
    simulation.totals.deposited += deposited;
    simulation.stepCount += 1;
    simulation.simTime += dt;

    const refreshed = refreshHydrology(simulation.terrain, rainfall);
    simulation.routing = refreshed.routing;
    simulation.hydrology = refreshed.hydrology;
  }
  return simulation;
}

export function editTerrain(simulation, centerX, centerY, radius, amount) {
  const { width, height, elevation, outlet } = simulation.terrain;
  const beforeRouting = simulation.routing;
  const paintRadius = Math.max(1, Math.round(radius));
  const modified = [];
  for (let y = Math.max(0, centerY - paintRadius); y <= Math.min(height - 1, centerY + paintRadius); y += 1) {
    for (let x = Math.max(0, centerX - paintRadius); x <= Math.min(width - 1, centerX + paintRadius); x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > paintRadius) continue;
      const cell = y * width + x;
      if (cell === outlet) continue;
      const falloff = 1 - (distance / (paintRadius + 0.5)) * 0.42;
      elevation[cell] = Math.max(20, elevation[cell] + amount * falloff);
      modified.push(cell);
    }
  }

  const oldAffected = new Set(collectUpstream(beforeRouting, modified));
  const refreshed = refreshHydrology(simulation.terrain, simulation.params.rainfall);
  simulation.routing = refreshed.routing;
  simulation.hydrology = refreshed.hydrology;
  const newAffected = collectUpstream(simulation.routing, modified);

  const mask = new Uint8Array(width * height);
  for (const cell of oldAffected) mask[cell] = 1;
  for (const cell of newAffected) mask[cell] = 1;
  for (let cell = 0; cell < mask.length; cell += 1) {
    if (beforeRouting.receiver[cell] !== simulation.routing.receiver[cell]) mask[cell] = 1;
  }
  simulation.affectedMask = mask;
  simulation.editCenter = { x: centerX, y: centerY, radius: paintRadius };
  const affectedCount = mask.reduce((sum, value) => sum + value, 0);
  return { modified, affectedCount, oldAffected: oldAffected.size, newAffected: newAffected.length };
}

export function auditFlow(simulation) {
  const { width, height, outlet } = simulation.terrain;
  const { receiver, filled } = simulation.routing;
  const { flow, localRunoff, totalInput } = simulation.hydrology;
  const count = width * height;
  const state = new Uint8Array(count);
  let discontinuity = 0;
  let cycles = 0;
  let conservationResidual = Math.abs(flow[outlet] - totalInput);

  for (let cell = 0; cell < count; cell += 1) {
    const next = receiver[cell];
    if (next < 0) continue;
    const dx = (next % width) - (cell % width);
    const dy = Math.floor(next / width) - Math.floor(cell / width);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) discontinuity += 1;
    if (filled[next] >= filled[cell]) discontinuity += 1;
  }
  for (let cell = 0; cell < count; cell += 1) {
    if (state[cell]) continue;
    let cursor = cell;
    const path = [];
    while (cursor >= 0 && state[cursor] === 0) {
      state[cursor] = 1;
      path.push(cursor);
      cursor = receiver[cursor];
    }
    if (cursor >= 0 && path.includes(cursor)) cycles += 1;
    for (const visited of path) state[visited] = 2;
  }
  conservationResidual = Math.max(conservationResidual, Math.abs(localRunoff * count - totalInput));
  return {
    discontinuity,
    cycles,
    conservationResidual,
    relativeError: conservationResidual / totalInput,
    outletFlow: flow[outlet],
    totalInput,
  };
}

export function channelMetrics(simulation, threshold = 12) {
  const { receiver, filled } = simulation.routing;
  const { upstream } = simulation.hydrology;
  const { width } = simulation.terrain;
  let cells = 0;
  let lengthMeters = 0;
  for (let cell = 0; cell < upstream.length; cell += 1) {
    if (upstream[cell] < threshold) continue;
    cells += 1;
    const next = receiver[cell];
    if (next < 0) continue;
    const dx = (next % width) - (cell % width);
    const dy = Math.floor(next / width) - Math.floor(cell / width);
    lengthMeters += Math.hypot(dx, dy) * CELL_SIZE;
    if (filled[next] >= filled[cell]) lengthMeters += 0;
  }
  return { cells, lengthKm: lengthMeters / 1000 };
}

export function hashArray(values, quantize = 1000) {
  let hash = 2166136261;
  for (let i = 0; i < values.length; i += 1) {
    const rounded = Math.round(values[i] * quantize);
    hash ^= rounded & 0xff;
    hash = Math.imul(hash, 16777619);
    hash ^= (rounded >>> 8) & 0xff;
    hash = Math.imul(hash, 16777619);
    hash ^= (rounded >>> 16) & 0xff;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hydrologySignature(simulation) {
  const terrainHash = hashArray(simulation.terrain.elevation, 1000);
  const routingHash = hashArray(simulation.routing.receiver, 1);
  const flowHash = hashArray(simulation.hydrology.flow, 100);
  return `${terrainHash}-${routingHash}-${flowHash}`;
}
