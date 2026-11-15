import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  startShift,
  planUnload,
  planReorder,
  moveQueueTruck,
  runFor,
  runUntilIdle,
  step,
  getTaskProgress,
  getOutcome,
  getStack,
} from "../src/simulation.js";

function playCleanRound() {
  const game = createGame();
  startShift(game);
  assert.equal(planUnload(game, { truckId: "T-01", stackId: "N-YS", craneId: "A", route: "north" }).ok, true);
  assert.equal(planUnload(game, { truckId: "T-02", stackId: "N-NB", craneId: "B", route: "south" }).ok, true);
  runUntilIdle(game, 12);
  assert.equal(planUnload(game, { truckId: "T-03", stackId: "N-YS", craneId: "A", route: "laneN" }).ok, true);
  runFor(game, 10);
  return game;
}

test("完整一局：3 辆集卡在截止时间内完成且通道保持净宽", () => {
  const game = playCleanRound();
  const progress = getTaskProgress(game);
  const outcome = getOutcome(game);

  assert.equal(game.status, "won");
  assert.deepEqual(progress, {
    completed: 3,
    total: 3,
    unloadsDone: 3,
    reordersDone: 0,
    reorderTasks: 0,
  });
  assert.equal(game.stats.deadlineMisses, 0);
  assert.equal(game.stats.channelViolations, 0);
  assert.ok(game.time <= 30);
  assert.deepEqual(getStack(game, "N-YS").boxes.map((box) => box.weight), [24, 12]);
  assert.equal(outcome.status, "won");
});

test("错误堆叠：轻箱在前时触发翻箱重排并恢复重下轻上", () => {
  const game = createGame();
  startShift(game);

  assert.equal(moveQueueTruck(game, "T-03", -1).ok, true);
  assert.equal(moveQueueTruck(game, "T-03", -1).ok, true);
  assert.equal(planUnload(game, { truckId: "T-03", stackId: "N-YS", craneId: "A", route: "north" }).ok, true);

  assert.equal(moveQueueTruck(game, "T-02", -1).ok, true);
  assert.equal(planUnload(game, { truckId: "T-02", stackId: "N-NB", craneId: "B", route: "south" }).ok, true);

  runFor(game, 3);
  assert.equal(planUnload(game, { truckId: "T-01", stackId: "N-YS", craneId: "A", route: "north" }).ok, true);
  runUntilIdle(game, 15);

  const badStack = getStack(game, "N-YS");
  assert.deepEqual(badStack.boxes.map((box) => box.weight), [12, 24]);
  assert.equal(badStack.reorderRequired, true);
  assert.equal(game.stats.reorderTasksCreated, 1);
  assert.equal(getTaskProgress(game).total, 4);

  assert.equal(planReorder(game, { stackId: "N-YS", craneId: "A", route: "north" }).ok, true);
  runFor(game, 12);

  assert.deepEqual(badStack.boxes.map((box) => box.weight), [24, 12]);
  assert.equal(badStack.reorderRequired, false);
  assert.equal(game.stats.reordersDone, 1);
  assert.equal(game.status, "won");
  assert.equal(getTaskProgress(game).completed, 4);
});

test("派工校验：目的地不符、插队和非法箱位会被拒绝", () => {
  const game = createGame();
  startShift(game);
  assert.equal(
    planUnload(game, { truckId: "T-01", stackId: "N-NB", craneId: "A", route: "north" }).reason,
    "目的地不符",
  );
  assert.equal(
    planUnload(game, { truckId: "T-02", stackId: "N-NB", craneId: "B", route: "north" }).reason,
    "仅可派工队列首位集卡",
  );
  game.cranes[0].operation = { phase: "travel" };
  assert.equal(
    planUnload(game, { truckId: "T-01", stackId: "N-YS", craneId: "A", route: "north" }).reason,
    "吊机 A 正在作业",
  );
});

test("通道扫描：双 lane 同列占用会记录零净宽", () => {
  const game = createGame();
  startShift(game);
  game.cranes[0].col = 5;
  game.cranes[0].row = 3;
  game.cranes[1].col = 5;
  game.cranes[1].row = 4;
  step(game, 0.05);

  assert.equal(game.channelWidth, 0);
  assert.deepEqual(game.blockedColumns, [5]);
  assert.equal(game.stats.channelViolations, 1);
});
