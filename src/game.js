// Deterministic fixed-tick dodge game.
// State is plain JSON-serializable data; update() is a pure function
// of (state, input) — same seed + same inputs => same hashes.
import { createRng, nextInt } from './rng.js';

export const WIDTH = 7;
export const HEIGHT = 14;

export const INPUTS = { LEFT: -1, STAY: 0, RIGHT: 1 };

export function initialState(seed) {
  return {
    tick: 0,
    playerX: Math.floor(WIDTH / 2),
    obstacles: [], // [{x, y}], y grows downward, 0 = top
    coins: [],
    score: 0,
    over: false,
    rng: createRng(seed),
  };
}

// One fixed tick. input is -1 | 0 | 1.
export function update(state, input) {
  if (state.over) return;
  state.tick += 1;

  // 1. move player (clamped)
  state.playerX = clamp(state.playerX + input, 0, WIDTH - 1);

  // 2. fall existing entities
  for (const o of state.obstacles) o.y += 1;
  for (const c of state.coins) c.y += 1;

  // 3. spawn new entities at the top using the recorded RNG stream
  if (nextInt(state.rng, 100) < 35) {
    state.obstacles.push({ x: nextInt(state.rng, WIDTH), y: 0 });
  }
  if (nextInt(state.rng, 100) < 20) {
    state.coins.push({ x: nextInt(state.rng, WIDTH), y: 0 });
  }

  // 4. drop entities that left the field
  state.obstacles = state.obstacles.filter((o) => o.y < HEIGHT);
  state.coins = state.coins.filter((c) => c.y < HEIGHT);

  // 5. resolve player row interactions
  const py = HEIGHT - 1;
  if (state.obstacles.some((o) => o.y === py && o.x === state.playerX)) {
    state.over = true;
  }
  const before = state.coins.length;
  state.coins = state.coins.filter((c) => !(c.y === py && c.x === state.playerX));
  state.score += (before - state.coins.length) * 10 + 1; // +1 per survived tick
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Canonical serialization used for hashing (stable key order).
export function serialize(state) {
  const sortRow = (list) =>
    [...list].sort((a, b) => a.y - b.y || a.x - b.x).map((e) => `${e.x},${e.y}`).join(';');
  return [
    state.tick, state.playerX, state.score, state.over ? 1 : 0,
    state.rng.state, sortRow(state.obstacles), sortRow(state.coins),
  ].join('|');
}

// FNV-1a 32-bit hash of the canonical state string.
export function hashState(state) {
  const s = serialize(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
