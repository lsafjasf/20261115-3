// Headless end-to-end check:
//   1. play one full game (scripted policy), recording inputs+hashes
//   2. replay the recording and validate -> must be ok
//   3. tamper with ONE recorded input -> validator must locate the
//      exact tick of first divergence
import { initialState, update, hashState, INPUTS, WIDTH, HEIGHT } from './src/game.js';
import { createRecording, recordTick, finalize } from './src/recorder.js';
import { validate } from './src/replay.js';
import { writeFileSync } from 'node:fs';

const SEED = 20261115;
const MAX_TICKS = 300;

// Deterministic greedy policy: score each candidate move by nearby
// obstacle danger, prefer coin columns, pick the best safe move.
function policy(state) {
  const py = HEIGHT - 1;
  const danger = (x) => {
    if (x < 0 || x >= WIDTH) return 1e9;
    let d = 0;
    for (const o of state.obstacles) {
      if (o.x !== x) continue;
      const dist = py - o.y; // rows until it reaches the player
      if (dist >= 0 && dist <= 2) d += 1000 / (dist + 1);
    }
    return d;
  };
  const coin = state.coins.filter((c) => c.y < py).sort((a, b) => b.y - a.y)[0];
  let best = INPUTS.STAY;
  let bestScore = -Infinity;
  for (const move of [INPUTS.LEFT, INPUTS.STAY, INPUTS.RIGHT]) {
    const nx = state.playerX + move;
    let s = -danger(nx);
    if (coin) s -= Math.abs(nx - coin.x);
    if (s > bestScore) { bestScore = s; best = move; }
  }
  return best;
}

// ---- 1. play a full game, recording everything ----
const state = initialState(SEED);
const recording = createRecording(SEED);
while (!state.over && state.tick < MAX_TICKS) {
  const input = policy(state);
  update(state, input);
  recordTick(recording, input, state);
}
finalize(recording, state);
writeFileSync('artifacts/recording.json', JSON.stringify(recording, null, 2));
console.log(`[play] seed=${SEED} ticks=${state.tick} score=${state.score} ` +
  `over=${state.over} finalHash=${recording.finalHash}`);

// ---- 2. replay & validate the clean recording ----
const clean = validate(recording);
console.log(`[replay] ok=${clean.ok} ticks=${clean.ticks} finalHash=${clean.finalHash}`);
if (!clean.ok) {
  console.error('FAIL: clean replay diverged at', clean.firstDivergence);
  process.exit(1);
}

// ---- 3. tamper with one input and re-validate ----
// Pick a tick where flipping the input actually moves the player
// (player not pinned against a wall), so divergence is guaranteed
// exactly at that tick.
const tampered = JSON.parse(JSON.stringify(recording));
let tamperIndex = -1;
{
  const probe = initialState(SEED);
  const mid = Math.floor(recording.inputs.length / 2);
  for (let i = 0; i < recording.inputs.length; i++) {
    if (tamperIndex < 0 && i >= mid && probe.playerX > 0
        && probe.playerX < WIDTH - 1 && recording.inputs[i] !== INPUTS.LEFT) {
      tamperIndex = i; // flip to LEFT: playerX will differ immediately
    }
    update(probe, recording.inputs[i]);
  }
}
const original = tampered.inputs[tamperIndex];
tampered.inputs[tamperIndex] = INPUTS.LEFT;
console.log(`[tamper] input[${tamperIndex}] ${original} -> ${INPUTS.LEFT}`);

const result = validate(tampered);
const expectTick = tamperIndex + 1; // inputs[i] drives the transition into tick i+1
console.log(`[validate] ok=${result.ok} firstDivergence=` +
  (result.firstDivergence ? `tick ${result.firstDivergence.tick}` : 'none'));

if (result.ok) {
  console.error('FAIL: tampered recording passed validation');
  process.exit(1);
}
if (result.firstDivergence.tick !== expectTick) {
  console.error(`FAIL: expected divergence at tick ${expectTick}, ` +
    `got ${result.firstDivergence.tick}`);
  process.exit(1);
}
console.log(`PASS: validator located the tampered input at tick ${expectTick} ` +
  `(expected hash ${result.firstDivergence.expected}, ` +
  `got ${result.firstDivergence.actual})`);
