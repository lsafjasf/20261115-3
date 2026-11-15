import {
  LOAD_TIME_PER_VICTIM,
  MEDIC_POOL,
  REFUEL_TIME,
  SIM_DURATION,
  UNLOAD_TIME_PER_VICTIM,
  VEHICLE_DEFS,
  generateIncidents,
  INCIDENT_TYPES,
} from './config.js';
import { EDGE_MAP, NODES, generateBlockages, shortestPath } from './map.js';

export function createGame(seed) {
  const { incidents, victims } = generateIncidents(seed);
  const vehicles = VEHICLE_DEFS.map((def) => ({
    ...def,
    nodeId: 'DEPOT',
    status: 'idle', // idle | moving | loading | unloading | refueling | stranded
    medics: def.defaultMedics,
    rangeLeft: def.range,
    path: null,
    pathIndex: 0,
    edgeProgress: 0,
    timer: 0,
    timerTotal: 0,
    stuckTicks: 0,
    carrying: [],
    destinationId: null,
    autoHospital: true,
    autoDepot: true,
    log: [],
  }));
  return {
    seed,
    time: 0,
    vehicles,
    incidents,
    victims,
    blockages: generateBlockages(seed),
    vehicleEdgeCounts: new Map(),
    events: [],
    finished: false,
    result: null,
    medicsAtDepot: MEDIC_POOL - VEHICLE_DEFS.reduce((sum, def) => sum + def.defaultMedics, 0),
  };
}

export function findVehicle(state, vehicleId) {
  return state.vehicles.find((vehicle) => vehicle.id === vehicleId);
}

export function findIncidentAt(state, nodeId) {
  return state.incidents.find((incident) => incident.nodeId === nodeId);
}

export function pathDistance(edgeIds) {
  return edgeIds.reduce((sum, edgeId) => sum + EDGE_MAP.get(edgeId).dist, 0);
}

export function dispatch(state, vehicleId, targetNodeId, medics) {
  const vehicle = findVehicle(state, vehicleId);
  if (!vehicle || vehicle.status !== 'idle' || vehicle.nodeId !== 'DEPOT') {
    return { ok: false, error: '车辆当前不可从救援站派出' };
  }
  const wanted = medics ?? vehicle.medics;
  if (wanted < 1 || wanted > vehicle.capacity) {
    return { ok: false, error: '担架人数需在 1 与车辆容量之间' };
  }
  if (wanted > state.medicsAtDepot + vehicle.medics) {
    return { ok: false, error: '救援站担架员不足' };
  }
  const route = shortestPath(state, 'DEPOT', targetNodeId, state.time);
  if (!route) return { ok: false, error: '当前没有可达路线（道路全部封锁）' };
  const distance = pathDistance(route.edgeIds);
  if (distance > vehicle.rangeLeft) {
    return { ok: false, error: '续航不足以抵达目标，需先补能' };
  }
  state.medicsAtDepot += vehicle.medics - wanted;
  vehicle.medics = wanted;
  startRoute(state, vehicle, route.edgeIds, targetNodeId);
  pushEvent(state, 'dispatch', `${vehicle.name} 携 ${wanted} 名担架员前往 ${NODES[targetNodeId].name}`);
  return { ok: true };
}

export function reroute(state, vehicleId, targetNodeId) {
  const vehicle = findVehicle(state, vehicleId);
  if (!vehicle) return { ok: false, error: '未找到车辆' };
  if (!['moving', 'loading', 'unloading', 'idle'].includes(vehicle.status)) {
    return { ok: false, error: '该状态下无法换线' };
  }
  const route = shortestPath(state, vehicle.nodeId, targetNodeId, state.time);
  if (!route) return { ok: false, error: '没有可达路线' };
  if (pathDistance(route.edgeIds) > vehicle.rangeLeft) {
    return { ok: false, error: '续航不足以抵达新目标' };
  }
  startRoute(state, vehicle, route.edgeIds, targetNodeId);
  pushEvent(state, 'reroute', `${vehicle.name} 中途换线前往 ${NODES[targetNodeId].name}`);
  return { ok: true };
}

export function refuel(state, vehicleId) {
  const vehicle = findVehicle(state, vehicleId);
  if (!vehicle || vehicle.nodeId !== 'DEPOT' || vehicle.status !== 'idle') {
    return { ok: false, error: '只有停在救援站的空闲车辆可以补能' };
  }
  vehicle.status = 'refueling';
  vehicle.timer = 0;
  vehicle.timerTotal = REFUEL_TIME;
  pushEvent(state, 'refuel', `${vehicle.name} 开始补能`);
  return { ok: true };
}

function startRoute(state, vehicle, edgeIds, destinationId) {
  vehicle.path = edgeIds;
  vehicle.pathIndex = 0;
  vehicle.edgeProgress = 0;
  vehicle.destinationId = destinationId;
  vehicle.status = 'moving';
  vehicle.timer = 0;
  rebuildEdgeCounts(state);
}

export function rebuildEdgeCounts(state) {
  state.vehicleEdgeCounts = new Map();
  for (const vehicle of state.vehicles) {
    if (vehicle.status === 'moving' && vehicle.path) {
      const edgeId = vehicle.path[vehicle.pathIndex];
      state.vehicleEdgeCounts.set(edgeId, (state.vehicleEdgeCounts.get(edgeId) || 0) + 1);
    }
  }
}

export function pushEvent(state, kind, text) {
  state.events.push({ time: state.time, kind, text });
}

// 单步推进 dt 分钟
export function step(state, dt = 1) {
  if (state.finished) return state;
  state.time = Math.min(SIM_DURATION, state.time + dt);
  for (const vehicle of state.vehicles) moveVehicle(state, vehicle, dt);
  updateTimers(state, dt);
  updateVictims(state, dt);
  rebuildEdgeCounts(state);
  checkEnd(state);
  return state;
}

function currentEdge(vehicle) {
  if (vehicle.status !== 'moving' || !vehicle.path) return null;
  return EDGE_MAP.get(vehicle.path[vehicle.pathIndex]);
}

function moveVehicle(state, vehicle, dt) {
  if (vehicle.status !== 'moving') return;
  if (!vehicle.path || vehicle.pathIndex >= vehicle.path.length) {
    vehicle.path = null;
    arrive(state, vehicle);
    return;
  }
  const edge = currentEdge(vehicle);
  if (!edge) return;
  if (isBlockedNow(state, edge.id)) {
    vehicle.stuckTicks += 1;
    const alternate = shortestPath(state, vehicle.nodeId, vehicle.destinationId, state.time);
    if (alternate && (alternate.edgeIds[0] !== edge.id || vehicle.stuckTicks >= 3)) {
      vehicle.path = alternate.edgeIds;
      vehicle.pathIndex = 0;
      vehicle.edgeProgress = 0;
      vehicle.stuckTicks = 0;
      pushEvent(state, 'detour', `${vehicle.name} 遇临时封锁，自动绕行`);
      return dt;
    }
    return dt; // 无路可绕，原地等待解封
  }
  vehicle.stuckTicks = 0;
  const congestion = congestionOf(state, edge.id);
  const distance = (vehicle.speed / congestion) * dt;
  vehicle.edgeProgress += distance;
  if (vehicle.edgeProgress >= edge.dist) {
    vehicle.rangeLeft -= edge.dist;
    vehicle.nodeId = edge.a === vehicle.nodeId ? edge.b : edge.a;
    vehicle.pathIndex += 1;
    vehicle.edgeProgress = 0;
    if (vehicle.rangeLeft <= 0) {
      vehicle.rangeLeft = 0;
      vehicle.status = 'stranded';
      vehicle.path = null;
      pushEvent(state, 'stranded', `${vehicle.name} 续航耗尽，滞留在 ${NODES[vehicle.nodeId].name}`);
    } else if (!vehicle.path || vehicle.pathIndex >= vehicle.path.length) {
      vehicle.path = null;
      arrive(state, vehicle);
    }
  }
}

function isBlockedNow(state, edgeId) {
  return state.blockages.some(
    (block) => block.edgeId === edgeId && state.time >= block.start && state.time < block.end,
  );
}

function congestionOf(state, edgeId) {
  const edge = EDGE_MAP.get(edgeId);
  const occupancy = (state.vehicleEdgeCounts.get(edgeId) || 0) - 1;
  return edge.baseCongestion + Math.max(0, occupancy) * 0.25;
}

function arrive(state, vehicle) {
  const node = NODES[vehicle.nodeId];
  if (node.kind === 'hospital' && vehicle.carrying.length > 0) {
    vehicle.status = 'unloading';
    vehicle.timer = 0;
    vehicle.timerTotal = vehicle.carrying.length * UNLOAD_TIME_PER_VICTIM;
    return;
  }
  const incident = findIncidentAt(state, vehicle.nodeId);
  if (incident) {
    if (!incident.controlled) {
      if (vehicle.equipment === INCIDENT_TYPES[incident.type].equipment) {
        incident.controlled = true;
        incident.controlledAt = state.time;
        incident.controlledBy = vehicle.id;
        pushEvent(state, 'control', `${vehicle.name} 完成 ${node.name} 控场（${INCIDENT_TYPES[incident.type].label}）`);
      } else {
        pushEvent(state, 'warning', `${vehicle.name} 装备不符，无法处置 ${node.name} 事故`);
      }
    }
    beginLoading(state, vehicle);
  }
  if (vehicle.status === 'moving') vehicle.status = 'idle';
}

function beginLoading(state, vehicle) {
  const incident = findIncidentAt(state, vehicle.nodeId);
  if (!incident || !incident.controlled || incident.remaining <= 0) return;
  const loadCount = Math.min(vehicle.capacity - vehicle.carrying.length, vehicle.medics, incident.remaining);
  if (loadCount <= 0) return;
  const victims = state.victims
    .filter((victim) => victim.incidentId === incident.id && victim.alive && victim.state === 'onsite')
    .slice(0, loadCount);
  if (victims.length === 0) return;
  vehicle.status = 'loading';
  vehicle.timer = 0;
  vehicle.timerTotal = victims.length * LOAD_TIME_PER_VICTIM;
  vehicle.pendingLoad = victims.map((victim) => victim.id);
}

function updateTimers(state, dt) {
  for (const vehicle of state.vehicles) {
    if (!['loading', 'unloading', 'refueling'].includes(vehicle.status)) continue;
    vehicle.timer += dt;
    if (vehicle.timer < vehicle.timerTotal) continue;
    if (vehicle.status === 'loading') finishLoading(state, vehicle);
    else if (vehicle.status === 'unloading') finishUnloading(state, vehicle);
    else finishRefueling(state, vehicle);
  }
}

function finishLoading(state, vehicle) {
  const incident = findIncidentAt(state, vehicle.nodeId);
  for (const victimId of vehicle.pendingLoad) {
    const victim = state.victims.find((item) => item.id === victimId);
    victim.state = 'onboard';
    victim.vehicleId = vehicle.id;
    vehicle.carrying.push(victimId);
    if (incident) incident.remaining -= 1;
  }
  pushEvent(state, 'load', `${vehicle.name} 接载 ${vehicle.pendingLoad.length} 名伤员`);
  vehicle.pendingLoad = [];
  vehicle.status = 'idle';
  if (vehicle.autoHospital) {
    const hospital = nearestHospital(state, vehicle);
    const route = shortestPath(state, vehicle.nodeId, hospital, state.time);
    if (route && pathDistance(route.edgeIds) <= vehicle.rangeLeft) {
      startRoute(state, vehicle, route.edgeIds, hospital);
    }
  }
}

function finishUnloading(state, vehicle) {
  for (const victimId of vehicle.carrying) {
    const victim = state.victims.find((item) => item.id === victimId);
    victim.state = 'delivered';
    victim.vehicleId = null;
    victim.deliveredAt = state.time;
  }
  pushEvent(state, 'deliver', `${vehicle.name} 在 ${NODES[vehicle.nodeId].name} 送达 ${vehicle.carrying.length} 名伤员`);
  vehicle.carrying = [];
  vehicle.status = 'idle';
  if (vehicle.autoDepot) {
    const route = shortestPath(state, vehicle.nodeId, 'DEPOT', state.time);
    if (route && pathDistance(route.edgeIds) <= vehicle.rangeLeft) {
      startRoute(state, vehicle, route.edgeIds, 'DEPOT');
    }
  }
}

function finishRefueling(state, vehicle) {
  vehicle.rangeLeft = vehicle.range;
  vehicle.status = 'idle';
  pushEvent(state, 'refueled', `${vehicle.name} 补能完成，续航恢复 ${vehicle.range} km`);
}

function nearestHospital(state, vehicle) {
  const options = ['H1', 'H2'];
  let best = options[0];
  let bestCost = Infinity;
  for (const hospital of options) {
    const route = shortestPath(state, vehicle.nodeId, hospital, state.time);
    if (route && route.timeCost < bestCost) {
      best = hospital;
      bestCost = route.timeCost;
    }
  }
  return best;
}

function updateVictims(state, dt) {
  for (const victim of state.victims) {
    if (!victim.alive || victim.state === 'delivered') continue;
    const rate = victim.state === 'onboard' ? victim.declineRate * 0.4 : victim.declineRate;
    victim.status = Math.max(0, victim.status - rate * dt);
    if (victim.status <= 0 && victim.alive) {
      victim.alive = false;
      victim.state = 'dead';
      pushEvent(state, 'death', `伤员 ${victim.id} 因延误不治`);
    }
  }
}

export function deliveredCount(state) {
  return state.victims.filter((victim) => victim.state === 'delivered').length;
}

export function dispatchableVehicles(state) {
  return state.vehicles.filter(
    (vehicle) => vehicle.status !== 'stranded' && vehicle.rangeLeft >= 8,
  ).length;
}

function checkEnd(state) {
  const delivered = deliveredCount(state);
  const ready = dispatchableVehicles(state);
  if (state.time >= SIM_DURATION) {
    state.finished = true;
    const win = delivered >= 7 && ready >= 2;
    state.result = {
      win,
      reason: win ? '成功转运至少 7 名伤员且保留 2 辆可调度车辆' : '时间超限：未在 60 分钟内达成转运与车辆保留目标',
      delivered,
      dispatchable: ready,
    };
    pushEvent(state, win ? 'win' : 'fail', state.result.reason);
  }
}
