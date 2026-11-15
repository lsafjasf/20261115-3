// Deterministic seeded PRNG (mulberry32). Pure and serializable:
// the whole generator state is a single uint32, so it can be
// hashed / restored as part of the game state.
export function createRng(seed) {
  return { state: seed >>> 0 };
}

export function nextUint(rng) {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0);
}

// Random integer in [0, n)
export function nextInt(rng, n) {
  return nextUint(rng) % n;
}
