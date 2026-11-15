'use strict';

const assert = require('assert');
const dsp = require('./dsp');

function mk(n, seed = 0x12345678) {
  const x = new Float64Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    x[i] = s / 4294967296 - 0.5;
  }
  return x;
}

function bruteCorr(a, b, lag) {
  let s = 0;
  for (let i = 0; i < b.length; i++) {
    const j = i + lag;
    if (j >= 0 && j < a.length) s += a[j] * b[i];
  }
  return s;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok -', name);
}

check('FFT cross-correlation matches brute force', () => {
  const a = mk(128), b = mk(96);
  const c = dsp.fullCrossCorrelation(a, b);
  let err = 0;
  for (let lag = -(b.length - 1); lag <= a.length - 1; lag++) {
    err = Math.max(err, Math.abs(c[lag + b.length - 1] - bruteCorr(a, b, lag)));
  }
  assert.ok(err < 1e-9, 'err=' + err);
});

check('detects positive delay (B delayed 5)', () => {
  const a = mk(256);
  const b = new Float64Array(200);
  for (let i = 0; i < 200; i++) b[i] = i >= 5 ? a[i - 5] : 0;
  const r = dsp.findBestLag(a, b, 32);
  assert.strictEqual(r.bestLag, 5);
  assert.strictEqual(r.polarity, 1);
  assert.ok(Math.abs(r.correlation - 1) < 1e-9);
});

check('detects negative delay (B leads 9)', () => {
  const a = mk(256);
  const b = new Float64Array(200);
  for (let i = 0; i < 200; i++) b[i] = a[i + 9];
  const r = dsp.findBestLag(a, b, 32);
  assert.strictEqual(r.bestLag, -9);
  assert.strictEqual(r.polarity, 1);
});

check('detects inverted polarity', () => {
  const a = mk(256);
  const b = new Float64Array(200);
  for (let i = 0; i < 200; i++) b[i] = i >= 5 ? -a[i - 5] : 0;
  const r = dsp.findBestLag(a, b, 32);
  assert.strictEqual(r.bestLag, 5);
  assert.strictEqual(r.polarity, -1);
  assert.ok(r.correlation < -0.9999);
});

check('aligned overlap is identical for exact copy', () => {
  const a = mk(128);
  const b = new Float64Array(100);
  for (let i = 0; i < 100; i++) b[i] = i >= 7 ? a[i - 7] : 0;
  const r = dsp.alignSignals(a, b, 7, 1);
  assert.strictEqual(r.len, 93);
  for (let i = 0; i < r.len; i++) assert.ok(Math.abs(r.a[i] - r.b[i]) < 1e-12);
});

check('cancellation depth grows with alignment', () => {
  const a = mk(4096);
  const b = new Float64Array(4096);
  for (let i = 0; i < 4096; i++) b[i] = i >= 11 ? a[i - 11] : 0;
  const mis = dsp.evaluate(a, b, 0, 1);
  const good = dsp.evaluate(a, b, 11, 1);
  assert.ok(good.cancelDepthDb > 100);
  assert.ok(good.cancelDepthDb > mis.cancelDepthDb + 50);
  assert.ok(good.correlation > 0.9999);
});

check('wav round trip preserves samples', () => {
  const { writeWav, readWav } = require('./wav');
  const os = require('os'), fs = require('fs'), path = require('path');
  const f = path.join(os.tmpdir(), 'rt-' + Date.now() + '.wav');
  const sig = new Float64Array(1000);
  for (let i = 0; i < 1000; i++) sig[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 8000);
  writeWav(f, [sig], 8000);
  const back = readWav(f);
  assert.strictEqual(back.sampleRate, 8000);
  assert.strictEqual(back.frameCount, 1000);
  let err = 0;
  for (let i = 0; i < 1000; i++) err = Math.max(err, Math.abs(back.channels[0][i] - sig[i]));
  assert.ok(err < 2e-4, 'roundtrip err=' + err);
  fs.unlinkSync(f);
});

console.log(passed + ' tests passed');
