import { createGame, dispatch, refuel, reroute, step, deliveredCount, dispatchableVehicles } from '../src/engine.js';
import { shortestPath } from '../src/map.js';
import { pathDistance } from '../src/engine.js';

export const FIXED_SEED = 20261115;

export function runToEnd(state, policy, onTick) {
  while (!state.finished) {
    policy(state);
    step(state, 1);
    if (onTick) onTick(state);
  }
  return state;
}

// 正确策略：三辆专用车同时分赴三类事故，两辆救护车随后承担转运
export function winningPolicy(state) {
  if (state.time === 0) {
    dispatch(state, 'T2', 'B1', 1); // 消防车 -> 东城火灾
    dispatch(state, 'T1', 'A2', 2); // 抢险车 -> 西城坍塌
    dispatch(state, 'T3', 'A1', 1); // 化洗车 -> 西城化学品
    dispatch(state, 'V1', 'A2', 3); // 救护车支援坍塌点
    dispatch(state, 'V2', 'B1', 3); // 救护车支援火灾点
  }
  // 滞留在外、续航足够的空闲车辆先召回救援站
  for (const vehicle of state.vehicles) {
    if (vehicle.status === 'idle' && vehicle.nodeId !== 'DEPOT' && vehicle.rangeLeft >= 25) {
      const back = shortestPathSafe(state, vehicle, 'DEPOT');
      if (back) reroute(state, vehicle.id, 'DEPOT');
    }
  }
  // 还有未转运伤员时，回站补能完成的救护车再次出动
  const remainingSites = state.incidents
    .filter((incident) => incident.controlled && incident.remaining > 0)
    .map((incident) => incident.nodeId);
  for (const vehicle of state.vehicles) {
    if (vehicle.nodeId === 'DEPOT' && vehicle.status === 'idle' && vehicle.rangeLeft < vehicle.range * 0.6) {
      refuel(state, vehicle.id);
    } else if (
      vehicle.nodeId === 'DEPOT' &&
      vehicle.status === 'idle' &&
      remainingSites.length > 0 &&
      vehicle.type === 'ambulance'
    ) {
      const target = remainingSites[0];
      const result = dispatch(state, vehicle.id, target, Math.min(3, vehicle.capacity, state.medicsAtDepot + vehicle.medics));
      if (result.ok) remainingSites.shift();
    }
  }
}

function shortestPathSafe(state, vehicle, target) {
  const route = shortestPath(state, vehicle.nodeId, target, state.time);
  return route && pathDistance(route.edgeIds) <= vehicle.rangeLeft ? route : null;
}

// 错误策略：五辆车全部压到同一个事故点，且先派不匹配装备的救护车，
// 道路与车辆被重复占用，另外两类事故长时间无人响应，最终时间超限
export function wrongPolicy(state) {
  if (state.time === 0) {
    dispatch(state, 'V1', 'A2', 3);
    dispatch(state, 'V2', 'A2', 3);
    dispatch(state, 'T2', 'A2', 1);
    dispatch(state, 'T3', 'A2', 1);
    dispatch(state, 'T1', 'A2', 2);
  }
}

function summarize(state, label) {
  console.log(`\n===== ${label}（seed=${state.seed}）=====`);
  console.log(`结束时间: ${state.time} 分钟`);
  console.log(`成功送达: ${deliveredCount(state)} 名`);
  console.log(`可调度车辆: ${dispatchableVehicles(state)} 辆`);
  const deaths = state.victims.filter((victim) => !victim.alive).length;
  console.log(`死亡: ${deaths} 名`);
  console.log(`结果: ${state.result.win ? '胜利' : '失败'} —— ${state.result.reason}`);
  console.log('封锁:', state.blockages.map((block) =>
    `${block.edgeId} 封 ${block.start}-${block.end}min`).join('；'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const winGame = runToEnd(createGame(FIXED_SEED), winningPolicy);
  summarize(winGame, '正确派车局');

  const failGame = runToEnd(createGame(FIXED_SEED), wrongPolicy);
  summarize(failGame, '错误派车局');
}
