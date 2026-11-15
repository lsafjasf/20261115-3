// 确定性模拟引擎：巴士状态机、水位断路、道路优先级、改道日志与快照哈希。
import {
  TICKS, TICK_MS, BUS_CAPACITY, BOARD_PER_TICK, DWELL_TICKS,
  BASE_SPEED, LOAD_FACTOR, edgeKey, waterLevelAt,
} from './world.js';

export function speedOf(bus) {
  const loadRatio = bus.passengers / BUS_CAPACITY;
  return BASE_SPEED * (LOAD_FACTOR + (1 - LOAD_FACTOR) * (1 - loadRatio));
}

// 每 tick 前进的像素数（车速单位为像素/小时，一个 tick 为 TICK_MS 毫秒）
function pxPerTick(bus) {
  return speedOf(bus) * (TICK_MS / 3_600_000);
}

// 离散 tick 安全余量：必须在断路时刻前半个 tick 完成整条边，避免取整被困
const SAFE_MARGIN = 0.5;

export function isOpenAt(edge, tick) {
  return !edge.blocked && tick <= edge.cutTick;
}

export function neighborsOf(world, nodeId) {
  const out = [];
  for (const e of world.edges) {
    if (e.from === nodeId) out.push([e, e.to]);
    else if (e.to === nodeId) out.push([e, e.from]);
  }
  return out;
}

// 只考虑当前开放的最短路径，priority 越高权重越低
export function findOpenRoute(world, from, to, tick) {
  if (from === to) return [from];
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const seen = new Set();
  while (true) {
    let cur = null, curD = Infinity;
    for (const [n, d] of dist) {
      if (!seen.has(n) && d < curD) { cur = n; curD = d; }
    }
    if (cur === null) return null;
    if (cur === to) break;
    seen.add(cur);
    for (const [e, nb] of neighborsOf(world, cur)) {
      if (!isOpenAt(e, tick)) continue;
      const w = e.length * (1 - 0.4 * e.priority);
      const nd = curD + w;
      if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, cur); }
    }
  }
  const path = [to];
  while (path[0] !== from) {
    const p = prev.get(path[0]);
    if (p === undefined) return null;
    path.unshift(p);
  }
  return path;
}

// 安全路径：按当前载客量推算到达时间，拒绝在行程中被淹的边
export function findSafeRoute(world, from, to, tick, passengers = 0, conservative = false) {
  // 去避难所的回程用满载最保守速度，避免上客后变慢被困；其余按当前载客量
  const virtualBus = { passengers: conservative ? BUS_CAPACITY : passengers };
  const dist = new Map([[from, 0]]);
  const timeAt = new Map([[from, tick]]);
  const prev = new Map();
  const seen = new Set();
  while (true) {
    let cur = null, curD = Infinity;
    for (const [n, d] of dist) {
      if (!seen.has(n) && d < curD) { cur = n; curD = d; }
    }
    if (cur === null) return null;
    if (cur === to) break;
    seen.add(cur);
    for (const [e, nb] of neighborsOf(world, cur)) {
      if (e.blocked) continue;
      // 不足一 tick 也按一 tick 结算，向上取整与真实移动一致
      const arrival = timeAt.get(cur) + Math.ceil(e.length / pxPerTick(virtualBus));
      if (arrival > e.cutTick - SAFE_MARGIN) continue;
      const w = e.length * (1 - 0.4 * e.priority);
      const nd = curD + w;
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd); prev.set(nb, cur); timeAt.set(nb, arrival);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path;
}

export function createEngine(world) {
  const depot = 18; // 巴士停放点（左下片区）
  const buses = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    state: 'idle',            // idle | moving | dwelling | trapped
    node: depot,
    edge: null,
    fromNode: depot,
    toNode: null,
    remaining: 0,
    edgeLength: 0,
    passengers: 0,
    dwellLeft: 0,
    route: [],
  }));
  const engine = {
    world, tick: 0, buses, evacuated: 0, trapped: [],
    log: [], snapshots: [], closedAt: new Map(), listeners: [],
  };

  const push = (entry) => {
    const full = { tick: engine.tick, ...entry };
    engine.log.push(full);
    for (const fn of engine.listeners) fn(full);
  };

  engine.onEvent = (fn, replayHistory = false) => {
    engine.listeners.push(fn);
    if (replayHistory) for (const entry of engine.log) fn(entry);
  };

  engine.bus = (id) => buses.find((b) => b.id === id);

  engine.setPriority = (edgeId, level, source = 'player') => {
    const edge = world.edges.find((e) => e.id === edgeId);
    if (!edge || edge.blocked) return false;
    edge.priority = Math.max(0, Math.min(2, level));
    push({ kind: 'priority', edgeId, level: edge.priority, source });
    return true;
  };

  engine.reroute = (busId, path, source = 'player', reason = 'manual') => {
    const bus = engine.bus(busId);
    if (!bus || bus.state === 'trapped') return false;
    if (bus.state === 'moving') return false; // 必须在节点上才能改道
    if (!Array.isArray(path) || path.length < 2 || path[0] !== bus.node) return false;
    let cursor = engine.tick;
    for (let i = 0; i < path.length - 1; i++) {
      const edge = world.edgeIndex.get(edgeKey(path[i], path[i + 1]));
      if (!edge || edge.blocked) return false;
      const finish = cursor + Math.ceil(edge.length / pxPerTick(bus));
      if (finish > edge.cutTick - SAFE_MARGIN) return false;
      cursor = finish;
    }
    bus.route = path.slice(1);
    bus.state = 'moving';
    bus.dwellLeft = 0;
    startNextLeg(bus);
    push({ kind: 'reroute', busId, path: path.slice(), source, reason });
    return true;
  };

  engine.departNow = (busId, source = 'player') => {
    const bus = engine.bus(busId);
    if (!bus || bus.state !== 'dwelling') return false;
    bus.dwellLeft = 1; // 本 tick 结算后立即变 idle
    push({ kind: 'depart-now', busId, source });
    return true;
  };

  function startNextLeg(bus) {
    const next = bus.route.shift();
    const edge = world.edgeIndex.get(edgeKey(bus.node, next));
    bus.edge = edge.id;
    bus.fromNode = bus.node;
    bus.toNode = next;
    bus.edgeLength = edge.length;
    bus.remaining = edge.length;
  }

  function nextLegSafe(bus) {
    const next = bus.route[0];
    const edge = world.edgeIndex.get(edgeKey(bus.node, next));
    const finish = engine.tick + Math.ceil(edge.length / pxPerTick(bus));
    return !edge.blocked && finish <= edge.cutTick - SAFE_MARGIN;
  }

  function arrive(bus) {
    bus.node = bus.toNode;
    bus.edge = null;
    if (bus.node === world.shelterId) {
      engine.evacuated += bus.passengers;
      push({ kind: 'unload', busId: bus.id, n: bus.passengers });
      bus.passengers = 0;
      if (bus.route.length && nextLegSafe(bus)) { startNextLeg(bus); return; }
      bus.state = 'idle';
      return;
    }
    const node = world.nodes[bus.node];
    const room = BUS_CAPACITY - bus.passengers;
    if (node.residents > 0 && room > 0) {
      bus.state = 'dwelling';
      bus.dwellLeft = DWELL_TICKS;
    } else if (bus.route.length && nextLegSafe(bus)) {
      bus.state = 'moving';
      startNextLeg(bus);
    } else {
      bus.state = 'idle';
    }
  }

  engine.step = () => {
    for (const bus of buses) {
      if (bus.state === 'dwelling') {
        const node = world.nodes[bus.node];
        const room = BUS_CAPACITY - bus.passengers;
        const board = Math.min(BOARD_PER_TICK, room, node.residents);
        if (board > 0) {
          node.residents -= board;
          bus.passengers += board;
          push({ kind: 'board', busId: bus.id, nodeId: bus.node, n: board });
        }
        bus.dwellLeft -= 1;
        if (bus.dwellLeft <= 0) {
          if (bus.route.length && nextLegSafe(bus)) {
            bus.state = 'moving'; startNextLeg(bus);
          } else {
            bus.route = [];
            bus.state = 'idle';
            push({ kind: 'route-halted', busId: bus.id });
          }
        }
      } else if (bus.state === 'moving') {
        const edge = world.edges.find((e) => e.id === bus.edge);
        bus.remaining -= pxPerTick(bus);
        // 本 tick 结束时若路已断，车仍在边上即被困
        if (engine.tick + 1 > edge.cutTick - SAFE_MARGIN) {
          bus.state = 'trapped';
          engine.trapped.push(bus.id);
          push({ kind: 'trap', busId: bus.id, edgeId: edge.id });
          continue;
        }
        if (bus.remaining <= 0) arrive(bus);
      }
    }
    // 记录本 tick 新被水位切断的路段
    for (const e of world.edges) {
      if (!e.blocked && engine.tick > 0 && e.cutTick < engine.tick &&
          !engine.closedAt.has(e.id) && engine.tick < TICKS) {
        engine.closedAt.set(e.id, engine.tick);
        push({ kind: 'edge-closed', edgeId: e.id });
      }
    }
    engine.tick += 1;
    if (engine.tick % 6 === 0) engine.snapshots.push(snapshot(engine));
  };

  engine.water = () => waterLevelAt(engine.tick);
  return engine;
}

// 确定性紧凑快照（Node 与浏览器结果一致）
export function snapshot(engine) {
  const { world, tick, evacuated } = engine;
  const busState = engine.buses.map((b) => [
    b.id, b.state[0], b.node, b.edge ?? -1,
    b.edge ? +(1 - b.remaining / b.edgeLength).toFixed(3) : 0,
    b.passengers, b.dwellLeft,
  ]);
  const pops = world.nodes.map((n) => n.residents);
  return { tick, evacuated, trapped: engine.trapped.slice(), buses: busState, pops };
}

export function hashSnapshot(s) {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function resultOf(engine) {
  const total = engine.world.residentsTotal;
  const target = engine.world.evacTarget;
  const won = engine.evacuated >= target && engine.trapped.length === 0;
  return {
    tick: engine.tick,
    evacuated: engine.evacuated,
    total, target,
    ratio: +(engine.evacuated / total).toFixed(4),
    trapped: engine.trapped,
    won,
    reason: won ? '达标且无车辆被困'
      : engine.trapped.length ? `巴士被困: ${engine.trapped.join(',')}`
      : `撤离 ${engine.evacuated}/${target} 未达八成`,
  };
}
