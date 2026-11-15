import assert from "node:assert/strict";
import { WarehouseSim } from "../src/sim.js";

function advance(sim, seconds, speed = 10) {
  sim.setSpeed(speed);
  const step = 0.1;
  const target = sim.elapsed + seconds;
  while (sim.elapsed < target && sim.running) {
    sim.update(step / speed);
  }
}

const sim = new WarehouseSim();
assert.equal(sim.robots.length, 12, "there must be 12 robots");
assert.equal(sim.tasks.length, 100, "the task flow must contain 100 jobs");
assert.equal(sim.chargers.length, 3, "there must be 3 charge lanes");

advance(sim, 132);
sim.elapsed = 135.1;
sim.tick();
assert.ok(sim.deadlockActive, "the fixed ring-wait scenario must trigger");
assert.equal(sim.deadlockActive.robotIds.length, 4, "the scripted cycle must lock 4 robots");
assert.equal(sim.rules.loopYield, false, "loop yielding must start disabled");

const lockedRobots = sim.deadlockActive.robotIds.join(",");
advance(sim, 20);
assert.equal(
  sim.deadlockActive?.robotIds.join(","),
  lockedRobots,
  "the ring wait must remain locked until policy repair",
);

sim.setRule("loopYield", true);
assert.equal(sim.deadlockActive, null, "loop yielding must release the cycle");
assert.equal(sim.stats.resolvedDeadlocks, 1, "the repaired cycle must be counted");

advance(sim, 1045);
assert.ok(sim.stats.finished, "the 20-minute shift must finish");
assert.ok(sim.stats.done >= 80, `expected at least 80 completed tasks, got ${sim.stats.done}`);
assert.ok(sim.stats.success, "the repaired shift should succeed");

const unresolved = new WarehouseSim();
unresolved.elapsed = 135.1;
unresolved.tick();
assert.ok(unresolved.deadlockActive, "the no-policy run must also reach the fixed cycle");
advance(unresolved, 1065);
assert.ok(unresolved.stats.finished, "the unresolved run must finish");
assert.equal(unresolved.stats.success, false, "an unresolved ring wait must fail the shift");

console.log(
  JSON.stringify(
    {
      done: sim.stats.done,
      deadlocks: sim.stats.deadlocks,
      repaired: sim.stats.resolvedDeadlocks,
      success: sim.stats.success,
      unresolvedRunFailed: !unresolved.stats.success,
    },
    null,
    2,
  ),
);
