/* Palette generation with lock support and cross-view safety constraints.
 * UMD; depends on ColorKit (color.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color.js'));
  else root.PaletteGen = factory(root.ColorKit);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

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

  // Distance metrics of two sRGB colors under a given view.
  function pairMetrics(rgb1, rgb2, view, severity) {
    const a = C.simulate(rgb1, view, severity);
    const b = C.simulate(rgb2, view, severity);
    return { view, contrast: C.contrastRatio(a, b), deltaE: C.deltaE(a, b) };
  }

  // Minimum margin (>=0 means safe) of a candidate against all accepted colors.
  function candidateMargins(rgb, accepted, severity, minContrast, minDeltaE) {
    let worstContrast = Infinity;
    let worstDeltaE = Infinity;
    let worstView = null;
    for (const other of accepted) {
      for (const view of C.VIEWS) {
        const m = pairMetrics(rgb, other, view, severity);
        const cm = m.contrast - minContrast;
        const em = m.deltaE - minDeltaE;
        if (m.contrast < worstContrast) { worstContrast = m.contrast; worstView = view; }
        if (m.deltaE < worstDeltaE) worstDeltaE = m.deltaE;
      }
    }
    return {
      worstContrast,
      worstDeltaE,
      worstView,
      safe: worstContrast >= minContrast && worstDeltaE >= minDeltaE,
    };
  }

  // Each slot owns a band on the lightness ladder so gray/relative-luminance
  // separation is built in; golden-angle hue spacing keeps hues apart.
  const L_MIN = 0.2;
  const L_MAX = 0.87;
  function candidate(rng, slot, count, baseHue) {
    const band = (L_MAX - L_MIN) / count;
    const l = L_MIN + band * (slot + 0.5) + (rng() - 0.5) * band * 0.55;
    const h = (baseHue + slot * 137.508 + (rng() - 0.5) * 18 + 360) % 360;
    const s = 0.6 + rng() * 0.2;
    return C.hslToRgb(h, s, Math.max(0.18, Math.min(0.87, l)));
  }

  // Worst margins across all views/pairs; larger is safer.
  function paletteMargins(hexes, severity, minContrast, minDeltaE) {
    const rgbs = hexes.map((h) => C.hexToRgb(h));
    let worstContrast = Infinity;
    let worstDeltaE = Infinity;
    for (let i = 0; i < rgbs.length; i++) {
      for (let j = i + 1; j < rgbs.length; j++) {
        for (const view of C.VIEWS) {
          const m = pairMetrics(rgbs[i], rgbs[j], view, severity);
          worstContrast = Math.min(worstContrast, m.contrast);
          worstDeltaE = Math.min(worstDeltaE, m.deltaE);
        }
      }
    }
    return {
      worstContrast,
      worstDeltaE,
      score: Math.min((worstContrast - minContrast) * 10, worstDeltaE - minDeltaE),
      safe: worstContrast >= minContrast && worstDeltaE >= minDeltaE,
    };
  }

  /*
   * opts: { count, locked: [null|hex, ...], minContrast, minDeltaE, severity, seed, attempts }
   * Locked slots keep their exact hex and never move.
   */
  function generatePalette(opts) {
    const count = opts.count || 6;
    const locked = opts.locked || new Array(count).fill(null);
    const severity = opts.severity == null ? 1 : opts.severity;
    const minContrast = opts.minContrast == null ? 1.15 : opts.minContrast;
    const minDeltaE = opts.minDeltaE == null ? 7 : opts.minDeltaE;
    const restarts = opts.restarts || 60;
    const refinePasses = opts.refinePasses || 12;
    const rng = opts.rng || mulberry32(opts.seed == null ? 1 : opts.seed);

    let best = null;
    for (let r = 0; r < restarts; r++) {
      const baseHue = rng() * 360;
      const hexes = new Array(count).fill(null);
      locked.forEach((hex, i) => { if (hex) hexes[i] = hex; });
      for (let slot = 0; slot < count; slot++) {
        if (hexes[slot]) continue;
        hexes[slot] = C.rgbToHex(...candidate(rng, slot, count, baseHue));
      }
      let m = paletteMargins(hexes, severity, minContrast, minDeltaE);
      // Hill-climb each unlocked slot a few times to escape the local minimum.
      for (let pass = 0; pass < refinePasses && !m.safe; pass++) {
        for (let slot = 0; slot < count; slot++) {
          if (locked[slot]) continue;
          const trial = hexes.slice();
          trial[slot] = C.rgbToHex(...candidate(rng, slot, count, baseHue));
          const tm = paletteMargins(trial, severity, minContrast, minDeltaE);
          if (tm.score > m.score) { hexes[slot] = trial[slot]; m = tm; }
        }
      }
      if (!best || m.score > best.margins.score) best = { hexes: hexes.slice(), margins: m };
      if (m.safe) break;
    }

    const report = evaluatePalette(best.hexes, severity, {
      minContrast, minDeltaE,
    });
    return {
      colors: best.hexes.slice(),
      locked: locked.slice(),
      passed: report.passed,
      report,
      thresholds: { minContrast, minDeltaE, severity },
    };
  }

  // Full safety evaluation of a palette (array of hex) under every view.
  function evaluatePalette(hexes, severity, thresholds) {
    thresholds = thresholds || { minContrast: 1.15, minDeltaE: 7 };
    const rgbs = hexes.map((h) => C.hexToRgb(h));
    const views = {};
    const failures = [];
    const pairs = [];
    for (const view of C.VIEWS) {
      let minContrast = Infinity;
      let minDeltaE = Infinity;
      for (let i = 0; i < rgbs.length; i++) {
        for (let j = i + 1; j < rgbs.length; j++) {
          const m = pairMetrics(rgbs[i], rgbs[j], view, severity);
          if (view === 'normal') pairs.push({ i, j, contrast: m.contrast, deltaE: m.deltaE });
          minContrast = Math.min(minContrast, m.contrast);
          minDeltaE = Math.min(minDeltaE, m.deltaE);
        }
      }
      views[view] = { minContrast, minDeltaE };
    }
    for (const view of C.VIEWS) {
      const v = views[view];
      if (v.minContrast < thresholds.minContrast || v.minDeltaE < thresholds.minDeltaE) {
        failures.push({
          view,
          minContrast: v.minContrast,
          minDeltaE: v.minDeltaE,
          reason: v.minContrast < thresholds.minContrast ? 'contrast' : 'deltaE',
        });
      }
    }
    return { views, failures, passed: failures.length === 0, pairs };
  }

  // Check a single user-picked color against the palette (for manual swatch edits).
  function checkColor(hex, otherHexes, severity, minContrast, minDeltaE) {
    const rgb = C.hexToRgb(hex);
    const others = otherHexes.map((h) => C.hexToRgb(h));
    if (!others.length) return { safe: true, worstContrast: Infinity, worstDeltaE: Infinity, conflicts: [] };
    const m = candidateMargins(rgb, others, severity, minContrast, minDeltaE);
    const conflicts = [];
    others.forEach((other, idx) => {
      for (const view of C.VIEWS) {
        const pm = pairMetrics(rgb, other, view, severity);
        if (pm.contrast < minContrast || pm.deltaE < minDeltaE) {
          conflicts.push({ index: idx, view, contrast: pm.contrast, deltaE: pm.deltaE });
        }
      }
    });
    return { ...m, conflicts };
  }

  return { mulberry32, generatePalette, evaluatePalette, checkColor, pairMetrics };
});
