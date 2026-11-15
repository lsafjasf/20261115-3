const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/dsp.js');
const W = require('../js/wav.js');

function bandEnergy(samples, fLow, fHi) {
  const spec = R.computeSpectrum(samples, 4096);
  let sum = 0, n = 0;
  for (let i = 0; i < spec.freqs.length; i++) {
    if (spec.freqs[i] >= fLow && spec.freqs[i] <= fHi) {
      sum += Math.pow(10, spec.db[i] / 10);
      n++;
    }
  }
  return sum / n;
}

const damaged = R.synthesizeDamaged();

test('synthesis: deterministic 10 s mono take containing all four defects', () => {
  assert.equal(damaged.length, R.LENGTH);
  assert.equal(damaged.length / R.SAMPLE_RATE, 10);
  assert.ok(R.peakOf(damaged) <= 0.92 + 1e-6);
  assert.ok(R.countOver(damaged, 0.919) > 1000, 'hard-clipped samples present');
  const again = R.synthesizeDamaged();
  assert.deepEqual(Array.from(damaged), Array.from(again));
});

test('full repair: no sample reaches the +/-1 ceiling and clipping is cleared', () => {
  const repaired = R.runRepairChain(damaged, {});
  assert.equal(repaired.length, damaged.length);
  assert.ok(R.peakOf(repaired) < 1.0, 'peak strictly below full scale');
  assert.equal(R.countOver(repaired, 0.999), 0);
  assert.equal(R.countOver(repaired, 1.0), 0);
});

test('soft clipper blocks clipping even for extreme over-drive inputs', () => {
  const extreme = R.makeBuffer(8192);
  for (let i = 0; i < extreme.length; i++) {
    extreme[i] = (i % 2 === 0 ? 1 : -1) * (5 + (i % 7));
  }
  const safe = R.softClipNode(extreme, true, 1.6);
  for (let i = 0; i < safe.length; i++) {
    assert.ok(Math.abs(safe[i]) < 1.0, `sample ${i} exceeds full scale`);
  }
  assert.ok(R.peakOf(safe) > 0.99, 'tanh saturates close to full scale');
});

test('bypass: each node can be skipped and all-bypass equals the input', () => {
  const keys = ['filter', 'deesser', 'gate', 'softclip'];
  for (const key of keys) {
    const bypass = { [key]: true };
    const out = R.runRepairChain(damaged, bypass);
    assert.equal(out.length, damaged.length);
    const fullyOn = R.runRepairChain(damaged, {});
    assert.notDeepEqual(Array.from(out), Array.from(fullyOn),
      `bypassing ${key} must change the output immediately`);
  }
  const passthrough = R.runRepairChain(damaged, {
    filter: true, deesser: true, gate: true, softclip: true
  });
  assert.deepEqual(Array.from(passthrough), Array.from(damaged));
});

test('filter/phase node aligns the delayed copy back toward the clean tone', () => {
  /* Controlled case: tone damaged only by the -0.5 delayed copy. The
     inverse-comb stage must drive the residual against the clean tone down. */
  const D = Math.round(R.SAMPLE_RATE * 0.012);
  const clean = R.makeBuffer(R.SAMPLE_RATE * 2);
  const phaseDamaged = R.makeBuffer(clean.length);
  for (let n = 0; n < clean.length; n++) {
    const t = n / R.SAMPLE_RATE;
    clean[n] = 0.42 * Math.sin(2 * Math.PI * 220 * t) +
      0.22 * Math.sin(2 * Math.PI * 330 * t);
    phaseDamaged[n] = clean[n] - 0.5 * (n >= D ? clean[n - D] : 0);
  }
  function rms(s) { return R.rmsOf(s); }
  function residual(a, b) {
    const e = R.makeBuffer(a.length);
    for (let i = 0; i < a.length; i++) e[i] = a[i] - b[i];
    return rms(e);
  }
  /* Isolate the inverse comb via the public node on this phase-only input;
     HPF/LPF at 40 Hz/12 kHz barely touch 220/330 Hz content. */
  const repaired = R.filterPhaseNode(phaseDamaged, true);
  const before = residual(phaseDamaged, clean);
  const after = residual(repaired, clean);
  assert.ok(after < before * 0.85,
    `phase residual should shrink: before=${before} after=${after}`);
});

test('de-esser reduces energy in the 5-10 kHz sibilance band', () => {
  const deessed = R.deEsserNode(damaged, true);
  const before = bandEnergy(damaged, 5000, 10000);
  const after = bandEnergy(deessed, 5000, 10000);
  assert.ok(after < before * 0.95,
    `sibilance band should drop: before=${before} after=${after}`);
});

test('gate silences the constant floor noise between signal events', () => {
  const gated = R.gateNode(damaged, true, 0.06);
  let quiet = 0;
  for (let i = 0; i < gated.length; i++) {
    if (Math.abs(gated[i]) < 0.005) quiet++;
  }
  assert.ok(quiet > gated.length * 0.05,
    'a substantial region of the rests is gated near zero');
  assert.ok(R.rmsOf(gated) < R.rmsOf(damaged));
});

test('spectrum: matching bins/frame count and finite dB values for both takes', () => {
  for (const src of [damaged, R.runRepairChain(damaged, {})]) {
    const spec = R.computeSpectrum(src);
    assert.equal(spec.freqs.length, 2048);
    assert.ok(spec.frames > 200);
    for (const v of spec.db) assert.ok(Number.isFinite(v));
  }
});

test('WAV export: decoded file matches the preview buffer sample-for-sample', () => {
  const processed = R.runRepairChain(damaged, {});
  const encoded = W.encodeWav(processed, R.SAMPLE_RATE);
  assert.ok(encoded instanceof ArrayBuffer);
  assert.equal(encoded.byteLength, 44 + processed.length * 2);
  const decoded = W.decodeWav(encoded);
  assert.equal(decoded.sampleRate, R.SAMPLE_RATE);
  assert.equal(decoded.samples.length, processed.length);
  let maxErr = 0;
  for (let i = 0; i < processed.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(decoded.samples[i] - processed[i]));
  }
  assert.ok(maxErr <= 2 / 0x8000 + 1e-9,
    `16-bit quantization bound exceeded: ${maxErr}`);
  assert.ok(R.peakOf(decoded.samples) < 1.0, 'exported file cannot clip');
});
