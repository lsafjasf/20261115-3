'use strict';

const fs = require('fs');
const path = require('path');
const { readWav, writeWav } = require('./wav');
const dsp = require('./dsp');

function parseArgs(argv) {
  const args = { maxMs: 50, polarity: 'auto' };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--a') args.a = argv[++i];
    else if (t === '--b') args.b = argv[++i];
    else if (t === '--out') args.out = argv[++i];
    else if (t === '--max-ms') args.maxMs = parseFloat(argv[++i]);
    else if (t === '--polarity') args.polarity = argv[++i];
  }
  return args;
}

function db(x) { return 20 * Math.log10(x + 1e-12); }

function main() {
  const args = parseArgs(process.argv);
  const root = path.join(__dirname, '..');
  const aPath = args.a || path.join(root, 'output', 'take_a.wav');
  const bPath = args.b || path.join(root, 'output', 'take_b.wav');
  const outDir = args.out || path.join(root, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const wa = readWav(aPath);
  const wb = readWav(bPath);
  if (wa.sampleRate !== wb.sampleRate) {
    throw new Error('sample rate mismatch');
  }
  const sr = wa.sampleRate;
  const a = wa.channels[0];
  const b = wb.channels[0];
  const maxLag = Math.round(args.maxMs / 1000 * sr);

  const found = dsp.findBestLag(a, b, maxLag);
  let polarity = found.polarity;
  if (args.polarity === 'normal') polarity = 1;
  if (args.polarity === 'invert') polarity = -1;
  const lag = found.bestLag;

  const before = dsp.evaluate(a, b, 0, 1);
  const after = dsp.evaluate(a, b, lag, polarity);

  const aligned = dsp.alignSignals(a, b, lag, polarity);
  const mixSum = new Float64Array(aligned.len);
  const mixDiff = new Float64Array(aligned.len);
  const stereo = [new Float64Array(aligned.len), new Float64Array(aligned.len)];
  let mixPeak = 0;
  for (let i = 0; i < aligned.len; i++) {
    mixSum[i] = (aligned.a[i] + aligned.b[i]) * 0.5;
    mixDiff[i] = (aligned.a[i] - aligned.b[i]) * 0.5;
    stereo[0][i] = aligned.a[i];
    stereo[1][i] = aligned.b[i];
    mixPeak = Math.max(mixPeak, Math.abs(mixSum[i]));
  }
  const norm = mixPeak > 0 ? 0.95 / mixPeak : 1;
  for (let i = 0; i < aligned.len; i++) {
    mixSum[i] *= norm; mixDiff[i] *= norm;
    stereo[0][i] *= norm; stereo[1][i] *= norm;
  }

  writeWav(path.join(outDir, 'aligned_sum.wav'), [mixSum], sr);
  writeWav(path.join(outDir, 'aligned_diff.wav'), [mixDiff], sr);
  writeWav(path.join(outDir, 'aligned_stereo.wav'), stereo, sr);

  const result = {
    sampleRate: sr,
    inputs: { a: path.relative(root, aPath), b: path.relative(root, bPath) },
    estimated: {
      delaySamples: lag,
      delayMs: +(lag / sr * 1000).toFixed(4),
      polarity: polarity === -1 ? 'inverted' : 'normal',
    },
    overlapFrames: after.overlapFrames,
    before: {
      lagSamples: 0,
      channelCorrelation: +before.correlation.toFixed(6),
      peakA: +before.peakA.toFixed(6),
      peakB: +before.peakB.toFixed(6),
      peakSum: +before.peakSum.toFixed(6),
      peakDiff: +before.peakDiff.toFixed(6),
      rmsA: +before.rmsA.toFixed(6),
      rmsDiff: +before.rmsDiff.toFixed(6),
      cancellationDepthDb: +before.cancelDepthDb.toFixed(2),
    },
    after: {
      lagSamples: lag,
      channelCorrelation: +after.correlation.toFixed(6),
      peakA: +after.peakA.toFixed(6),
      peakB: +after.peakB.toFixed(6),
      peakSum: +after.peakSum.toFixed(6),
      peakDiff: +after.peakDiff.toFixed(6),
      rmsA: +after.rmsA.toFixed(6),
      rmsDiff: +after.rmsDiff.toFixed(6),
      cancellationDepthDb: +after.cancelDepthDb.toFixed(2),
    },
    exports: {
      sum: 'output/aligned_sum.wav',
      difference: 'output/aligned_diff.wav',
      stereo: 'output/aligned_stereo.wav',
    },
  };
  fs.writeFileSync(path.join(outDir, 'alignment_result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();
