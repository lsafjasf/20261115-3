import assert from "node:assert/strict";
import { WORLD } from "../js/config.js";
import { runFixedSeedMission, validateWrongDetour } from "../js/validation.js";

console.log(`WHITEOUT deterministic validation · seed ${WORLD.seed}`);

const mission = runFixedSeedMission();
console.log("\n[1] Fixed-seed rescue");
console.log(JSON.stringify(mission, null, 2));
assert.equal(mission.seed, 20261115, "seed must stay fixed");
assert.equal(mission.success, true, "fixed-seed mission must be completable");
assert.equal(mission.safeCount, 3, "all three survivors must reach shore");
assert.deepEqual(mission.order, ["程野", "赵海", "林岚"], "rescue order must be reproducible");
assert.equal(mission.mode, "won", "vehicle must return safely");

const first = validateWrongDetour();
const second = validateWrongDetour();
console.log("\n[2] Wrong-detour propagation");
console.log(JSON.stringify(first, null, 2));
assert.deepEqual(first, second, "detour simulation must be deterministic");
assert.equal(first.passed, true, "wrong detour must trigger stronger cracking");
assert.ok(first.wrong.crackGrowth > first.safe.crackGrowth * 1.25, "wrong detour must grow cracks faster");
assert.ok(first.wrong.crackCount > first.safe.crackCount, "wrong detour must create new branches");
assert.ok(first.wrong.peakStress > first.safe.peakStress + 20, "wrong detour must raise stress sharply");

console.log("\nPASS · rescue completes and wrong detour propagates cracks deterministically.");
