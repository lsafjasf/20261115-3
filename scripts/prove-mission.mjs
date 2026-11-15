import {
  FAULTS,
  WORLD,
  compareTraces,
  createSimulation,
  hashState,
  sanitizeInput,
  stepSimulation,
} from "../src/sim.js";

const seed = 0x6d2b79f5;
const state = createSimulation(seed);
const inputs = [];
const hashes = [];

function controlFor(state) {
  const remaining = state.faults.filter((fault) => !fault.done);
  const recovery = remaining.length === 0;
  const target = recovery
    ? { x: 800, y: 158, radius: 76, tool: state.selectedTool }
    : remaining[0];
  const deltaX = target.x - state.pod.x;
  const deltaY = target.y - state.pod.y;
  const targetDistance = Math.hypot(deltaX, deltaY);
  const anchorDistance = Math.hypot(state.pod.x - WORLD.anchorX, state.pod.y - WORLD.anchorY);
  const speed = Math.hypot(state.pod.vx, state.pod.vy);
  const braking = targetDistance < target.radius && speed > 52;

  let thrustX = Math.abs(deltaX) < 12 ? 0 : Math.sign(deltaX);
  let thrustY = Math.abs(deltaY) < 12 ? 0 : Math.sign(deltaY);
  if (braking) {
    thrustX = -Math.sign(state.pod.vx);
    thrustY = -Math.sign(state.pod.vy);
  }

  const nearestDrifter = state.drifters.reduce((nearest, drifter) => {
    const distance = Math.hypot(state.pod.x - drifter.x, state.pod.y - drifter.y);
    if (distance < 92 && (!nearest || distance < nearest.distance)) return { drifter, distance };
    return nearest;
  }, null);
  if (nearestDrifter) {
    const awayX = state.pod.x - nearestDrifter.drifter.x;
    const awayY = state.pod.y - nearestDrifter.drifter.y;
    thrustX = Math.sign(awayX);
    thrustY = Math.sign(awayY);
  }

  let cable = 0;
  if (state.cable.tension > 1.45) cable = 1;
  else if (state.cable.tangleTime > 0) cable = -1;
  else if (recovery) cable = -1;
  else if (anchorDistance > state.cable.length - 45) cable = 1;
  else if (anchorDistance < state.cable.length - 280) cable = -1;

  return sanitizeInput({ thrustX, thrustY, cable, tool: target.tool });
}

for (let frame = 0; frame < 9000 && state.status === "playing"; frame += 1) {
  const input = controlFor(state);
  inputs.push(input);
  stepSimulation(state, input);
  hashes.push(hashState(state));
}

const replay = compareTraces(seed, inputs, hashes);
const finalHash = hashes.at(-1) || hashState(state);
console.log(JSON.stringify({
  status: state.status,
  reason: state.failReason,
  frames: inputs.length,
  repaired: state.repairedCount,
  integrity: state.integrity,
  load: state.load,
  pod: { x: Number(state.pod.x.toFixed(2)), y: Number(state.pod.y.toFixed(2)) },
  finalHash,
  replay,
}, null, 2));

if (state.status !== "won" || !replay.ok) process.exitCode = 1;
