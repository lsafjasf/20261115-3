/*
 * layers.js — deterministic procedural texture generators for the four
 * layer kinds: background / frost(磨砂) / stain(污渍) / highlight(高光).
 * Every generator is seeded, so a layer can be rebuilt bit-identically
 * from its serialized params (that is what makes project save/load and
 * undo/redo cheap and exact).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LayerFactory = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const LAYER_TYPES = ["background", "frost", "stain", "highlight"];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeBuffer(width, height) {
    return new Uint8ClampedArray(width * height * 4);
  }

  // Opaque vertical gradient between two colors.
  function genBackground(width, height, params) {
    const { top = [64, 92, 140], bottom = [18, 24, 38] } = params;
    const out = makeBuffer(width, height);
    for (let y = 0; y < height; y++) {
      const t = height <= 1 ? 0 : y / (height - 1);
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      }
    }
    return out;
  }

  // Frosted film: smoothed value noise, semi-transparent milky white.
  function genFrost(width, height, params) {
    const { seed = 1, cell = 8, alpha = 90, tint = [235, 240, 245] } = params;
    const rand = mulberry32(seed);
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const out = makeBuffer(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const v00 = grid[y0 * gw + x0];
        const v10 = grid[y0 * gw + x0 + 1];
        const v01 = grid[(y0 + 1) * gw + x0];
        const v11 = grid[(y0 + 1) * gw + x0 + 1];
        const v =
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy;
        const i = (y * width + x) * 4;
        out[i] = tint[0];
        out[i + 1] = tint[1];
        out[i + 2] = tint[2];
        out[i + 3] = alpha * (0.55 + 0.45 * v);
      }
    }
    return out;
  }

  // Stains: soft dark blobs with irregular alpha falloff.
  function genStain(width, height, params) {
    const { seed = 7, count = 6, color = [46, 32, 20], maxAlpha = 170 } = params;
    const rand = mulberry32(seed);
    const out = makeBuffer(width, height);
    for (let b = 0; b < count; b++) {
      const cx = rand() * width;
      const cy = rand() * height;
      const radius = (0.06 + rand() * 0.16) * Math.min(width, height);
      const strength = 0.5 + rand() * 0.5;
      const wobble = 2 + Math.floor(rand() * 3);
      const phase = rand() * Math.PI * 2;
      const x0 = Math.max(0, Math.floor(cx - radius * 1.4));
      const x1 = Math.min(width - 1, Math.ceil(cx + radius * 1.4));
      const y0 = Math.max(0, Math.floor(cy - radius * 1.4));
      const y1 = Math.min(height - 1, Math.ceil(cy + radius * 1.4));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const ang = Math.atan2(dy, dx);
          const r =
            radius * (1 + 0.25 * Math.sin(ang * wobble + phase));
          const d = Math.sqrt(dx * dx + dy * dy) / r;
          if (d >= 1) continue;
          const fall = 1 - d;
          const a = maxAlpha * strength * fall * fall;
          const i = (y * width + x) * 4;
          // merge overlapping stains by keeping the stronger alpha
          if (a > out[i + 3]) {
            out[i] = color[0];
            out[i + 1] = color[1];
            out[i + 2] = color[2];
            out[i + 3] = a;
          }
        }
      }
    }
    return out;
  }

  // Highlight: bright radial sheen, additive-friendly.
  function genHighlight(width, height, params) {
    const {
      seed = 3,
      color = [255, 250, 230],
      maxAlpha = 200,
      spots = 2,
    } = params;
    const rand = mulberry32(seed);
    const out = makeBuffer(width, height);
    for (let s = 0; s < spots; s++) {
      const cx = (0.2 + rand() * 0.6) * width;
      const cy = (0.15 + rand() * 0.5) * height;
      const radius = (0.25 + rand() * 0.3) * Math.min(width, height);
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(width - 1, Math.ceil(cx + radius));
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(height - 1, Math.ceil(cy + radius));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / radius;
          const dy = (y - cy) / radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          const a = maxAlpha * (1 - d2) * (1 - d2);
          const i = (y * width + x) * 4;
          if (a > out[i + 3]) {
            out[i] = color[0];
            out[i + 1] = color[1];
            out[i + 2] = color[2];
            out[i + 3] = a;
          }
        }
      }
    }
    return out;
  }

  const GENERATORS = {
    background: genBackground,
    frost: genFrost,
    stain: genStain,
    highlight: genHighlight,
  };

  function generate(type, width, height, params) {
    const gen = GENERATORS[type];
    if (!gen) throw new Error("unknown layer type: " + type);
    return gen(width, height, params || {});
  }

  return { LAYER_TYPES, GENERATORS, generate, mulberry32 };
});
