"use strict";

const assert = require("node:assert/strict");
const { createSimulation } = require("../simulation");

const recovered = createSimulation();
const result = recovered.runToEnd({ autoRecoverDelay: 9 });

assert.equal(result.outcome.success, true);
assert.equal(result.outcome.correct, 103);
assert.equal(result.outcome.overflowCount, 0);
assert.ok(result.outcome.recoveredBags > 0);
assert.equal(result.recovery.completed, true);

const ignored = createSimulation();
const failed = ignored.runToEnd({ autoRecoverDelay: null });

assert.equal(failed.outcome.success, false);
assert.equal(failed.outcome.reason, "target");
assert.ok(failed.jam.queueLength > 0);

console.log("固定输入：103/120 正确，0 溢出，D1 恢复 2 件，班次成功。");
console.log("忽略堵包：正确率低于 80%，班次失败。");
