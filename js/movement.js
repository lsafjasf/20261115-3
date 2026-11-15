import { WORLD, LANE_Y, BUS_DWELL } from './config.js';

const GAP = 2.2;          // 最小车头净距（米）
const ACC = 1.6;          // 舒适加速度 m/s²
const DEC = 3.2;          // 舒适减速度 m/s²

// 同一车道上距 v 最近的前车（仅比较直行段车辆）
function nearestLeader(vehicles, dir, pos, lane) {
  let best = null;
  let bestGap = Infinity;
  for (const o of vehicles) {
    if (o.dir !== dir || o.lane !== lane || o.route !== 'straight') continue;
    const front = o.pos + o.len / 2;
    const back = pos - o.len / 2;
    const gap = front - back;
    if (gap > -0.5 && gap < bestGap) { bestGap = gap; best = o; }
  }
  return { leader: best, gap: bestGap };
}

// 信号/行人/公交站给出的强制停车位置（返回障碍点 x 或 null）
function stopPoint(v, cfg, sig, peds) {
  const W = WORLD;
  if (v.dir === 'EB') {
    if (v.pos < W.stopEB && !sig.eb) return W.stopEB;                       // 红灯停车线
    if (v.pos < W.schoolX && pedOnRoad(peds, W.schoolX, LANE_Y.EB)) return W.schoolX; // 行人占道
  } else if (v.dir === 'WB') {
    if (v.pos > W.stopWB && !sig.wb) return W.stopWB;
    if (v.pos > W.schoolX && pedOnRoad(peds, W.schoolX, LANE_Y.WB)) return W.schoolX;
  } else if (v.dir === 'NB') {
    if (v.lanePos > W.stopNB && !sig.nb) return W.stopNB;
  } else if (v.dir === 'SB') {
    if (v.lanePos < W.stopSB && !sig.sb) return W.stopSB;
  }
  // 东行公交进站停靠：停靠期间对同车道后续车辆形成移动/静止障碍
  if (v.kind === 'bus' && v.dir === 'EB' && v.route === 'straight') {
    if (!v.dwellDone && v.pos < cfg.busStopX) return cfg.busStopX;
  }
  return null;
}

function pedOnRoad(peds, x, y) {
  const half = WORLD.crosswalkW / 2 + 2;
  for (const p of peds) {
    if (p.state === 'crossing' && Math.abs(p.x - x) < half &&
        Math.min(p.y, p.y0) <= y + 4 && Math.max(p.y, p.y0) >= y - 4) {
      return true;
    }
  }
  return false;
}

// 跟驰速度更新：取前车约束、强制停车约束、自由流速度的最小值
export function updateVehicle(v, vehicles, peds, cfg, sig, dt) {
  if (v.route === 'detour') { updateDetour(v, dt); return; }

  const { leader, gap } = nearestLeader(vehicles, v.dir, v.pos, v.lane);
  let vTarget = WORLD.vFree;

  if (leader) {
    const leaderSpeed = Math.max(0, leader.speed);
    const clearance = gap - GAP;
    // 简化 Gipps：净距越紧，允许速度越低
    const vGap = clearance > 0
      ? Math.min(WORLD.vFree, leaderSpeed + Math.sqrt(2 * DEC * clearance))
      : 0;
    vTarget = Math.min(vTarget, vGap);
  }

  const sp = stopPoint(v, cfg, sig, peds);
  if (sp !== null) {
    const dist = Math.abs(sp - v.pos) - v.len / 2;
    const vStop = dist > GAP ? Math.sqrt(2 * DEC * Math.max(0, dist - GAP)) : 0;
    vTarget = Math.min(vTarget, vStop);
  }

  if (v.speed < vTarget) v.speed = Math.min(vTarget, v.speed + ACC * dt);
  else v.speed = Math.max(vTarget, v.speed - DEC * dt);
  v.speed = Math.max(0, v.speed);

  // 公交到站：停稳后开始上下客计时，完成后驶离（停靠会堵住整条东行车道 → 回堵）
  if (v.kind === 'bus' && !v.dwellDone && Math.abs(v.pos - cfg.busStopX) <= 1.5 && v.speed < 0.4) {
    v.dwelling = true;
  }
  if (v.dwelling) {
    v.speed = 0;
    v.dwell += dt;
    if (v.dwell >= BUS_DWELL) { v.dwelling = false; v.dwellDone = true; }
  }

  const step = v.speed * dt;
  if (v.dir === 'EB' || v.dir === 'WB') {
    v.pos += v.dir === 'EB' ? step : -step;
  } else {
    v.lanePos += v.dir === 'NB' ? -step : step;
  }
}

// 临时绕行路径：学校南侧的虚线回环（waypoint 折线，不参与路口冲突）
const DETOUR = [
  { x: 150, y: LANE_Y.EB },
  { x: 180, y: 400 },
  { x: 420, y: 430 },
  { x: 700, y: 430 },
  { x: 980, y: 400 },
  { x: 1010, y: LANE_Y.EB },
  { x: WORLD.mainMaxX, y: LANE_Y.EB },
];

function updateDetour(v, dt) {
  const wp = DETOUR[v.wp + 1];
  if (!wp) { v.speed = 0; return; }
  const dx = wp.x - v.x, dy = wp.y - v.y;
  const d = Math.hypot(dx, dy);
  v.speed = Math.min(WORLD.vFree * 0.85, v.speed + ACC * dt);
  const move = v.speed * dt;
  if (d <= move) { v.x = wp.x; v.y = wp.y; v.wp++; }
  else { v.x += (dx / d) * move; v.y += (dy / d) * move; }
  v.pos = v.x;
}

// 行人沿学校横道线垂直穿越，速度恒定
export function updatePed(p, cfg, sig, dt) {
  if (p.state !== 'crossing') return;
  p.y += p.dirY * WORLD.vPed * dt;
  if ((p.dirY < 0 && p.y <= p.yTarget) || (p.dirY > 0 && p.y >= p.yTarget)) {
    p.y = p.yTarget;
    p.state = 'done';
  }
}
