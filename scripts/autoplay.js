import {
  createGame,
  startShift,
  planUnload,
  planReorder,
  moveQueueTruck,
  runFor,
  runUntilIdle,
  getTaskProgress,
  getOutcome,
} from "../src/simulation.js";

function cleanRound() {
  const game = createGame();
  startShift(game);
  planUnload(game, { truckId: "T-01", stackId: "N-YS", craneId: "A", route: "north" });
  planUnload(game, { truckId: "T-02", stackId: "N-NB", craneId: "B", route: "south" });
  runUntilIdle(game, 12);
  planUnload(game, { truckId: "T-03", stackId: "N-YS", craneId: "A", route: "laneN" });
  runFor(game, 10);
  return game;
}

function badStackRound() {
  const game = createGame();
  startShift(game);
  moveQueueTruck(game, "T-03", -1);
  moveQueueTruck(game, "T-03", -1);
  planUnload(game, { truckId: "T-03", stackId: "N-YS", craneId: "A", route: "north" });
  moveQueueTruck(game, "T-02", -1);
  planUnload(game, { truckId: "T-02", stackId: "N-NB", craneId: "B", route: "south" });
  runFor(game, 3);
  planUnload(game, { truckId: "T-01", stackId: "N-YS", craneId: "A", route: "north" });
  runUntilIdle(game, 15);
  const inversion = getTaskProgress(game);
  planReorder(game, { stackId: "N-YS", craneId: "A", route: "north" });
  runFor(game, 12);
  return { game, inversion };
}

const clean = cleanRound();
const cleanOutcome = getOutcome(clean);
console.log("\n[完整一局]");
console.log(`结果: ${clean.status} | 用时: ${clean.time.toFixed(2)} min | 得分: ${cleanOutcome.score}`);
console.log(`任务: ${getTaskProgress(clean).completed}/${getTaskProgress(clean).total} | 通道违规: ${clean.stats.channelViolations}`);
console.log(`说明: ${clean.finishReason}`);

const { game: reordered, inversion } = badStackRound();
const reorderOutcome = getOutcome(reordered);
const stack = reordered.stacks.find((item) => item.id === "N-YS");
console.log("\n[错误堆叠 + 重排测试]");
console.log(`错叠任务数: ${inversion.total} | 重排触发: ${inversion.reorderTasks} | 重排完成: ${reordered.stats.reordersDone}`);
console.log(`重排后箱重: ${stack.boxes.map((box) => `${box.weight}t`).join(" 下 → 上 ")}`);
console.log(`结果: ${reordered.status} | 用时: ${reordered.time.toFixed(2)} min | 得分: ${reorderOutcome.score}`);
