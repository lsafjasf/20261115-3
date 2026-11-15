/* Audio repair DSP core. UMD-style: works in browsers and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioRepair = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAMPLE_RATE = 44100;
  var DURATION_SEC = 10;
  var LENGTH = SAMPLE_RATE * DURATION_SEC;
  var TWO_PI = Math.PI * 2;

  function makeBuffer(length) {
    return new Float32Array(length);
  }

  function peakOf(samples) {
    var peak = 0;
    for (var i = 0; i < samples.length; i++) {
      var a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    return peak;
  }

  function rmsOf(samples) {
    var sum = 0;
    for (var i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  function countOver(samples, level) {
    var n = 0;
    for (var i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > level) n++;
    }
    return n;
  }

  /* Deterministic PRNG so every session synthesizes the same damaged take. */
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* One-pole RBJ filters. LP: y = b1*x + (1-b1)*y1.
     HP: y = a*(y1 + x - x1), a = exp(-2*pi*fc/fs). */
  function applyOnePole(samples, cutoff, mode) {
    var out = makeBuffer(samples.length);
    var prevIn = 0, prevOut = 0;
    if (mode === 'lp') {
      var b1 = 1 - Math.exp(-TWO_PI * cutoff / SAMPLE_RATE);
      for (var i = 0; i < samples.length; i++) {
        prevOut = b1 * samples[i] + (1 - b1) * prevOut;
        out[i] = prevOut;
      }
    } else {
      var a = Math.exp(-TWO_PI * cutoff / SAMPLE_RATE);
      for (var j = 0; j < samples.length; j++) {
        var x = samples[j];
        prevOut = a * (prevOut + x - prevIn);
        prevIn = x;
        out[j] = prevOut;
      }
    }
    return out;
  }

  /* 10 s mono take: tone + sibilance + floor noise + pops + hard clip. */
  function synthesizeDamaged() {
    var rng = mulberry32(20261115);
    var out = makeBuffer(LENGTH);
    var pinkB0 = 0, pinkB1 = 0, pinkB2 = 0;
    var sibilanceBpPrev = 0;
    var popTimes = [1.2, 3.7, 6.4, 8.8];
    var sibilanceTimes = [2.0, 4.5, 7.1, 9.3];
    for (var n = 0; n < LENGTH; n++) {
      var t = n / SAMPLE_RATE;

      /* Musical-ish base: 220 Hz plus a fifth, gentle vibrato, with
         periodic rests so the noise gate has real silence to close on. */
      var vibrato = 1 + 0.004 * Math.sin(TWO_PI * 5 * t);
      var phrase = t % 1.6;
      var noteEnvelope = phrase < 1.15 ? 1 : Math.max(0, 1 - (phrase - 1.15) / 0.12);
      var tone = noteEnvelope * (
        0.42 * Math.sin(TWO_PI * 220 * vibrato * t) +
        0.22 * Math.sin(TWO_PI * 330 * vibrato * t));

      /* Phase problem: a delayed, inverted copy smears the low end. */
      var delayedIndex = n - Math.round(SAMPLE_RATE * 0.012);
      var delayed = delayedIndex >= 0 ? toneAt(delayedIndex) : 0;
      var phaseComponent = -0.5 * delayed;

      /* Sibilance bursts: band-limited noise around 7 kHz. */
      var sibilance = 0;
      for (var s = 0; s < sibilanceTimes.length; s++) {
        var dt = t - sibilanceTimes[s];
        if (dt >= 0 && dt < 0.35) {
          var white = rng() * 2 - 1;
          sibilanceBpPrev = 0.85 * sibilanceBpPrev + 0.15 * white;
          var env = Math.sin(Math.PI * dt / 0.35);
          sibilance += 0.55 * env * sibilanceBpPrev;
        }
      }

      /* Floor noise: shaped white/pink-ish noise, constant low level. */
      var white = rng() * 2 - 1;
      pinkB0 = 0.99765 * pinkB0 + white * 0.099046;
      pinkB1 = 0.964 * pinkB1 + white * 0.2965164;
      pinkB2 = 0.57 * pinkB2 + white * 1.0526913;
      var noise = 0.05 * (pinkB0 + pinkB1 + pinkB2 + white * 0.1848);

      /* Pops/clicks: short full-band impulses. */
      var pop = 0;
      for (var p = 0; p < popTimes.length; p++) {
        var pdt = t - popTimes[p];
        if (pdt >= 0 && pdt < 0.012) {
          var decay = Math.exp(-pdt * 900);
          var polarity = p % 2 === 0 ? 1 : -1;
          pop += polarity * 1.35 * decay * Math.cos(TWO_PI * 90 * pdt);
        }
      }

      var mix = tone + phaseComponent + sibilance + noise + pop;

      /* Hard clipping: the take hit the recorder ceiling at +/- 0.92. */
      if (mix > 0.92) mix = 0.92;
      else if (mix < -0.92) mix = -0.92;
      out[n] = mix;
    }
    return out;
  }

  /* The phase component needs the pre-delay tone value; recompute cheaply. */
  function toneAt(delayedIndex) {
    if (delayedIndex < 0) return 0;
    var dt = delayedIndex / SAMPLE_RATE;
    var vibrato = 1 + 0.004 * Math.sin(TWO_PI * 5 * dt);
    var phrase = dt % 1.6;
    var noteEnvelope = phrase < 1.15 ? 1 : Math.max(0, 1 - (phrase - 1.15) / 0.12);
    return (
      noteEnvelope * (
        0.42 * Math.sin(TWO_PI * 220 * vibrato * dt) +
        0.22 * Math.sin(TWO_PI * 330 * vibrato * dt))
    );
  }

  /* ---- Repair nodes. Each takes Float32Array and returns a new one. ---- */

  /* Node 1: 80 Hz HPF (rumble) + 12 kHz LPF (hiss), then inverse-comb
     phase alignment undoing the -0.5 * z^-529 damage term. Stable because
     |0.5| < 1. Bypassed entirely when enabled is false. */
  function filterPhaseNode(samples, enabled) {
    if (!enabled) return samples;
    var stage = applyOnePole(samples, 40, 'hp');
    stage = applyOnePole(stage, 12000, 'lp');
    var out = makeBuffer(stage.length);
    var delaySamples = Math.round(SAMPLE_RATE * 0.012);
    /* y[n] = x[n] + 0.5 * x[n-D]: FIR inverse of 1 - 0.5 z^-D. */
    var ring = new Float32Array(delaySamples);
    var head = 0;
    for (var i = 0; i < stage.length; i++) {
      var x = stage[i];
      var delayed = ring[head];
      var y = x + 0.5 * delayed;
      ring[head] = x;
      head = (head + 1) % delaySamples;
      out[i] = y;
    }
    return out;
  }

  /* Node 2: de-esser. Side-chain measures energy above 5 kHz; when it
     exceeds the threshold a smooth gain reduction ducks the whole signal. */
  function deEsserNode(samples, enabled) {
    if (!enabled) return samples;
    var out = makeBuffer(samples.length);
    var env = 0, gain = 1;
    var attack = 1 - Math.exp(-1 / (SAMPLE_RATE * 0.002));
    var release = 1 - Math.exp(-1 / (SAMPLE_RATE * 0.05));
    var threshold = 0.035;
    var maxDuck = 0.25;
    var hpPrevIn = 0, hpPrevOut = 0;
    var hpB1 = Math.exp(-TWO_PI * 5000 / SAMPLE_RATE);
    for (var i = 0; i < samples.length; i++) {
      var x = samples[i];
      hpPrevOut = hpB1 * (hpPrevOut + x - hpPrevIn);
      hpPrevIn = x;
      var detector = Math.abs(hpPrevOut);
      var coef = detector > env ? attack : release;
      env = coef * env + (1 - coef) * detector;
      var target = 1;
      if (env > threshold) {
        target = Math.max(maxDuck, threshold / env);
      }
      gain += (target - gain) * 0.2;
      out[i] = x * gain;
    }
    return out;
  }

  /* Node 3: noise gate with envelope follower. Silence below threshold
     fades to zero; attack/release keep the closure click-free. */
  function gateNode(samples, enabled, threshold) {
    if (!enabled) return samples;
    if (threshold === undefined) threshold = 0.08;
    var out = makeBuffer(samples.length);
    var env = 0, gain = 0;
    var attackCoef = 1 - Math.exp(-1 / (SAMPLE_RATE * 0.005));
    var releaseCoef = 1 - Math.exp(-1 / (SAMPLE_RATE * 0.02));
    for (var i = 0; i < samples.length; i++) {
      var x = samples[i];
      var level = Math.abs(x);
      var coef = level > env ? attackCoef : releaseCoef;
      env = coef * env + (1 - coef) * level;
      var target = env >= threshold ? 1 : 0;
      gain += (target - gain) * (target > gain ? 0.3 : 0.2);
      out[i] = x * gain;
    }
    return out;
  }

  /* Node 4: soft clipper (tanh saturation). tanh guarantees |y| < 1 for
     every finite input, which is the hard clipping block guarantee. */
  function softClipNode(samples, enabled, drive) {
    if (!enabled) return samples;
    if (drive === undefined) drive = 1.6;
    var out = makeBuffer(samples.length);
    for (var i = 0; i < samples.length; i++) {
      /* Clamp inside full scale: float32 tanh can round +/-1 for huge x. */
      var y = Math.tanh(samples[i] * drive);
      if (y > 1 - 1e-6) y = 1 - 1e-6;
      else if (y < -1 + 1e-6) y = -1 + 1e-6;
      out[i] = y;
    }
    return out;
  }

  /* Full chain. Bypassing any node skips it with zero extra processing. */
  function runRepairChain(samples, bypass) {
    bypass = bypass || {};
    var s = samples;
    s = filterPhaseNode(s, !bypass.filter);
    s = deEsserNode(s, !bypass.deesser);
    s = gateNode(s, !bypass.gate);
    s = softClipNode(s, !bypass.softclip);
    return s;
  }

  /* ---- Spectrum: magnitude FFT, N=4096 Hann window, average frames. ---- */
  function computeSpectrum(samples, fftSize) {
    if (fftSize === undefined) fftSize = 4096;
    var window = new Float32Array(fftSize);
    for (var i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(TWO_PI * i / (fftSize - 1)));
    }
    var re = new Float32Array(fftSize);
    var im = new Float32Array(fftSize);
    var bins = fftSize / 2;
    var mag = new Float64Array(bins);
    var frames = 0;
    var hop = fftSize / 2;
    for (var start = 0; start + fftSize <= samples.length; start += hop) {
      for (var j = 0; j < fftSize; j++) {
        re[j] = samples[start + j] * window[j];
        im[j] = 0;
      }
      fft(re, im);
      for (var k = 0; k < bins; k++) {
        mag[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }
      frames++;
    }
    var freqs = new Float32Array(bins);
    var db = new Float32Array(bins);
    var norm = frames * fftSize / 4;
    for (var b = 0; b < bins; b++) {
      freqs[b] = b * SAMPLE_RATE / fftSize;
      var m = mag[b] / norm;
      db[b] = 20 * Math.log10(m + 1e-9);
    }
    return { freqs: freqs, db: db, fftSize: fftSize, frames: frames };
  }

  /* Iterative radix-2 in-place FFT (Cooley-Tukey). */
  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -TWO_PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      var half = len >> 1;
      for (var base = 0; base < n; base += len) {
        var cr = 1, ci = 0;
        for (var q = 0; q < half; q++) {
          var ur = re[base + q], ui = im[base + q];
          var vr = re[base + q + half] * cr - im[base + q + half] * ci;
          var vi = re[base + q + half] * ci + im[base + q + half] * cr;
          re[base + q] = ur + vr;
          im[base + q] = ui + vi;
          re[base + q + half] = ur - vr;
          im[base + q + half] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  return {
    SAMPLE_RATE: SAMPLE_RATE,
    DURATION_SEC: DURATION_SEC,
    LENGTH: LENGTH,
    makeBuffer: makeBuffer,
    peakOf: peakOf,
    rmsOf: rmsOf,
    countOver: countOver,
    mulberry32: mulberry32,
    synthesizeDamaged: synthesizeDamaged,
    filterPhaseNode: filterPhaseNode,
    deEsserNode: deEsserNode,
    gateNode: gateNode,
    softClipNode: softClipNode,
    runRepairChain: runRepairChain,
    computeSpectrum: computeSpectrum
  };
});
