import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, reroute, step, deliveredCount, dispatchableVehicles } from '../src/engine.js';
import { isEdgeBlocked } from '../src/map.js';
import { winningPolicy, wrongPolicy, runToEnd, FIXED_SEED } from '../scripts/simulate.js';

test('固定 seed 生成确定性的事故、伤员与封锁', () => {
  const a = createGame(FIXED_SEED);
  const b = createGame(FIXED_SEED);
  assert.deepEqual(
    a.victims.map((victim) => [victim.id, victim.status, victim.declineRate]),
    b.victims.map((victim) => [victim.id, victim.status, victim.declineRate]),
  );
  assert.deepEqual(a.blockages, b.blockages);
  assert.equal(a.incidents.length, 3);
  assert.equal(a.victims.length, 8);
});

test('正确策略完整打完一局：至少 7 人转运且保留 2 辆可调度车', () => {
  const game = runToEnd(createGame(FIXED_SEED), winningPolicy);
  assert.equal(game.finished, true);
  assert.equal(game.result.win, true);
  assert.ok(deliveredCount(game) >= 7, `实际送达 ${deliveredCount(game)}`);
  assert.ok(dispatchableVehicles(game) >= 2);
  assert.equal(game.victims.every((victim) => victim.state !== 'dead'), true);
});

test('错误派车（全部压向同一事故点）导致时间超限失败', () => {
  const game = runToEnd(createGame(FIXED_SEED), wrongPolicy);
  assert.equal(game.finished, true);
  assert.equal(game.result.win, false);
  assert.match(game.result.reason, /时间超限/);
  assert.ok(deliveredCount(game) < 7);
});

test('装备不符无法控场，另一事故无人响应', () => {
  const game = createGame(FIXED_SEED);
  dispatch(game, 'V1', 'B1', 3); // 医疗救护车去火灾点
  for (let i = 0; i < 5; i += 1) step(game, 1);
  const fire = game.incidents.find((incident) => incident.id === 'I1');
  assert.equal(fire.controlled, false);
  assert.ok(game.events.some((event) => event.kind === 'warning'));
});

test('道路封锁期间车辆会自动绕行而非卡死', () => {
  const game = createGame(FIXED_SEED);
  const block = game.blockages.find((item) => item.edgeId === 'e09');
  const vehicle = game.vehicles.find((item) => item.id === 'T2');
  vehicle.nodeId = 'C1';
  vehicle.medics = 1;
  vehicle.status = 'idle';
  reroute(game, 'T2', 'E1');
  game.time = block.start;
  let detoured = false;
  for (let i = 0; i < 12; i += 1) {
    step(game, 1);
    if (game.events.some((event) => event.kind === 'detour')) detoured = true;
  }
  assert.ok(isEdgeBlocked(game.blockages, block.edgeId, block.start));
  assert.equal(detoured, true);
});

test('中途换线会更换目标并记录事件', () => {
  const game = createGame(FIXED_SEED);
  dispatch(game, 'T1', 'A2', 2);
  step(game, 1);
  const result = reroute(game, 'T1', 'B1');
  assert.equal(result.ok, true);
  assert.equal(game.vehicles.find((v) => v.id === 'T1').destinationId, 'B1');
  assert.ok(game.events.some((event) => event.kind === 'reroute'));
});

test('续航不足的派车指令被拒绝', () => {
  const game = createGame(FIXED_SEED);
  const vehicle = game.vehicles.find((v) => v.id === 'T3');
  vehicle.rangeLeft = 3;
  const result = dispatch(game, 'T3', 'A1', 1);
  assert.equal(result.ok, false);
});
