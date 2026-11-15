import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("three repairs and safe recovery replay exactly", () => {
  const script = fileURLToPath(new URL("../scripts/prove-mission.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  const result = JSON.parse(output);

  assert.equal(result.status, "won");
  assert.equal(result.repaired, 3);
  assert.equal(result.load, 46.5);
  assert.equal(result.integrity, 100);
  assert.ok(result.frames > 2000);
  assert.equal(result.replay.ok, true);
  assert.equal(result.replay.frames, result.frames);
  assert.equal(result.replay.finalHash, result.finalHash);
});
