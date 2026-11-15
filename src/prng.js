// Deterministic pseudo-random number generator (mulberry32).
// A fixed seed makes every generated city identical across reloads and tests.
export function createRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function intRange(rng, min, max) {
  return Math.floor(range(rng, min, max + 1));
}

export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}
