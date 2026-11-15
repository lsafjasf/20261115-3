// Procedural sound material: five distinct spatial sources plus ambient
// layers and an impulse response. No audio assets are required.
// A seeded PRNG keeps the Node verification render fully deterministic.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SOURCE_VOICES = [
  { id: "fountain", type: "water", base: 220, seed: 101 },
  { id: "birds", type: "chirp", base: 1760, seed: 202 },
  { id: "bell", type: "bell", base: 440, seed: 303 },
  { id: "drone", type: "drone", base: 110, seed: 404 },
  { id: "crickets", type: "insect", base: 4200, seed: 505 },
];

export const AMBIENT_TYPES = ["wind", "traffic", "stream", "crowd", "leaves"];

// One sample of a spatial source voice at time t (seconds).
export function voiceSample(voice, t, rand) {
  const phase = 2 * Math.PI * voice.base * t;
  switch (voice.type) {
    case "water":
      return 0.35 * Math.sin(phase) + 0.4 * (rand() * 2 - 1);
    case "chirp": {
      const period = 1.4;
      const m = t % period;
      if (m > 0.16) return 0;
      const env = Math.sin((m / 0.16) * Math.PI);
      return 0.55 * env * Math.sin(2 * Math.PI * (voice.base + 400 * m) * t);
    }
    case "bell": {
      const strike = t % 2.5;
      const env = Math.exp(-2.2 * strike);
      return (
        0.5 *
        env *
        (Math.sin(phase) + 0.5 * Math.sin(2 * phase + 0.4) +
          0.25 * Math.sin(2.9 * phase))
      );
    }
    case "drone":
      return (
        0.4 * Math.sin(phase) +
        0.25 * Math.sin(phase * 1.5 + Math.sin(t * 0.7))
      );
    case "insect": {
      const trill = 0.5 + 0.5 * Math.sin(2 * Math.PI * 7 * t);
      return 0.3 * trill * Math.sin(2 * Math.PI * voice.base * t);
    }
    default:
      return 0;
  }
}

// One sample of an ambient bed at time t for a segment.
export function ambientSample(type, t, rand) {
  switch (type) {
    case "wind":
      return 0.5 * (rand() * 2 - 1) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.13 * t));
    case "traffic":
      return 0.4 * Math.sin(2 * Math.PI * 55 * t) + 0.2 * (rand() * 2 - 1);
    case "stream":
      return 0.45 * (rand() * 2 - 1) + 0.15 * Math.sin(2 * Math.PI * 180 * t);
    case "crowd": {
      const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.21 * t + 1.3);
      return 0.4 * (rand() * 2 - 1) * swell;
    }
    case "leaves":
      return 0.35 * (rand() * 2 - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.31 * t + 2));
    default:
      return 0;
  }
}

// Decaying-noise impulse response for the convolution reverb.
export function impulseResponse(sampleRate, { seconds = 1.8, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const len = Math.floor(seconds * sampleRate);
  const ir = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    ir[i] = (rand() * 2 - 1) * Math.exp(-3.2 * (i / len));
  }
  return ir;
}
