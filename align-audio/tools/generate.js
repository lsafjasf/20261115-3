'use strict';

const fs = require('fs');
const path = require('path');
const { writeWav } = require('./wav');

function xorshift32(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function buildSource(sampleRate, seconds, seed) {
  const n = Math.floor(sampleRate * seconds);
  const x = new Float64Array(n);
  const rand = xorshift32(seed);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 2);
    const harmonic =
      0.55 * Math.sin(2 * Math.PI * 220 * t) +
      0.28 * Math.sin(2 * Math.PI * 440 * t + 0.6) +
      0.14 * Math.sin(2 * Math.PI * 660 * t + 1.3) +
      0.08 * Math.sin(2 * Math.PI * 880 * t);
    const sweep = 0.18 * Math.sin(2 * Math.PI * (180 + 260 * t / seconds) * t);
    const noise = (rand() - 0.5) * 0.05;
    x[i] = env * (harmonic + sweep + noise);
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) x[i] *= 0.9 / peak;
  return x;
}

function delayCopy(source, delaySamples, gainDb) {
  const g = Math.pow(10, gainDb / 20);
  const out = new Float64Array(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = (i >= delaySamples ? source[i - delaySamples] : 0) * g;
  }
  return out;
}

function main() {
  const outDir = path.join(__dirname, '..', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const sampleRate = 48000;
  const seconds = 4;
  const delayB = 317;
  const source = buildSource(sampleRate, seconds, 20261115);
  const takeA = delayCopy(source, 0, 0);
  const takeB = delayCopy(source, delayB, -0.7);
  writeWav(path.join(outDir, 'take_a.wav'), [takeA], sampleRate);
  writeWav(path.join(outDir, 'take_b.wav'), [takeB], sampleRate);
  const meta = {
    sampleRate,
    frames: source.length,
    durationSec: seconds,
    trueDelaySamplesB: delayB,
    trueDelayMsB: +(delayB / sampleRate * 1000).toFixed(4),
    gainB_db: -0.7,
    note: 'take_b is take_a delayed by trueDelaySamplesB samples (same synthesis source)',
  };
  fs.writeFileSync(path.join(outDir, 'generation.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
}

if (require.main === module) main();
module.exports = { buildSource, delayCopy, xorshift32 };
