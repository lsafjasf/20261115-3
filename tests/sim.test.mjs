import test from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_DT,
  compareTraces,
  createSimulation,
  hashState,
  runTrace,
  sanitizeInput,
  stepSimulation,
} from "../src/sim.js";

function scriptedInputs(frames = 900) {
  const inputs = [];
  for (let frame = 0; frame < frames; frame += 1) {
    let thrustX = 0;
    let thrustY = 1;
    let cable = frame < 170 ? 1 : 0;
    if (frame > 210) thrustX = -1;
    if (frame > 430) thrustX = frame % 90 < 55 ? 1 : -1;
    if (frame > 620) thrustY = frame % 120 < 70 ? -1 : 1;
    let tool = 0;
    if (frame === 180) tool = 3;
    if (frame === 410) tool = 2;
    if (frame === 650) tool = 1;
    inputs.push({ thrustX, thrustY, cable, tool });
  }
  return inputs;
}

test("fixed-step simulation is bit-for-bit deterministic", () => {
  const seed = 0x6d2b79f5;
  const inputs = scriptedInputs();
  const first = runTrace(seed, inputs);
  const second = runTrace(seed, inputs);

  assert.equal(first.hashes.length, second.hashes.length);
  assert.deepEqual(first.hashes, second.hashes);
  assert.equal(first.finalHash, second.finalHash);
  assert.equal(first.state.pod.x, second.state.pod.x);
  assert.equal(first.state.pod.y, second.state.pod.y);
});

test("same inputs with a changed frame produce a trajectory divergence", () => {
  const seed = 0x6d2b79f5;
  const inputs = scriptedInputs(320);
  const replay = compareTraces(seed, inputs, runTrace(seed, inputs).hashes);
  assert.equal(replay.ok, true);
  assert.equal(replay.frames, inputs.length);

  const changed = inputs.map((input, index) => (
    index === 240 ? { ...input, thrustX: 1, thrustY: -1, cable: -1 } : input
  ));
  const divergence = compareTraces(seed, changed, runTrace(seed, inputs).hashes);
  assert.equal(divergence.ok, false);
  assert.ok(divergence.mismatchFrame >= 240);
});

test("recorded input is quantized before it enters physics", () => {
  assert.deepEqual(
    sanitizeInput({ thrustX: 0.37, thrustY: -2, cable: -0.1, tool: 2.9 }),
    { thrustX: 1, thrustY: -1, cable: -1, tool: 2 },
  );
  const input = { thrustX: 0, thrustY: 1, cable: 0, tool: 1 };
  const expected = stepSimulation(createSimulation(13), input).pod.y;
  const quantized = stepSimulation(createSimulation(13), { ...input, thrustY: 0.2 }).pod.y;
  assert.equal(expected, quantized);
});

test("state hashes change once deterministic drifters are spawned", () => {
  const state = createSimulation(91);
  state.time = 3;
  state.pod.x = 365;
  state.pod.y = 705;
  state.selectedTool = 1;
  state.cable.length = 760;
  let before = null;
  let after = null;

  for (let frame = 0; frame < 180; frame += 1) {
    state.time = (frame + 1) * FIXED_DT;
    if (frame === 179) before = hashState(state);
    stepSimulation(state, { tool: 0, thrustX: 0, thrustY: 0, cable: 0 });
    if (frame === 179) after = hashState(state);
  }

  assert.ok(state.drifters.length > 0);
  assert.notEqual(before, after);
});
