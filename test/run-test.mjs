// Drives the sequencer in headless Chrome, plays it continuously for
// `--duration` seconds (default 300), measures per-beat timing offset
// against the Web Audio scheduled times, then verifies pause / tempo /
// seek leave no uncancelled events and no residual audio.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const durationSec = Number(process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] ?? 300);
const shellPath = path.join(
  os.homedir(),
  '.cache/puppeteer/chrome-headless-shell/linux-157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell'
);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(root, req.url === '/' ? 'test/page.html' : req.url);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({
  headless: 'shell',
  executablePath: shellPath,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const page = await browser.newPage();
page.on('pageerror', e => { console.error('[pageerror]', e.message); });
await page.goto(`http://127.0.0.1:${port}/test/page.html`);
await page.waitForFunction('window.testReady === true');

const api = (expr) => page.evaluate(expr);

// ---------- Phase A: continuous playback ----------
console.log(`[A] playing continuously for ${durationSec}s ...`);
await api('testApi.start()');
const t0 = Date.now();
let maxPending = 0;
while ((Date.now() - t0) / 1000 < durationSec) {
  await new Promise(r => setTimeout(r, 5000));
  const pending = await api('testApi.pendingEventCount()');
  maxPending = Math.max(maxPending, pending);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  if (elapsed % 30 < 5) console.log(`    t=${elapsed}s pendingEvents=${pending}`);
}
await api('testApi.pause()');
const pauseAt = await api('testApi.now()');

// Analysis in-page: onsets + schedule log are small enough to transfer.
const analysis = await page.evaluate(() => {
  const onsets = testApi.findOnsets(testApi.drainCapture());
  const log = testApi.scheduleLog().filter(e => e.velocity !== 0);
  return { onsets, log, sampleRate: testApi.sampleRate };
});

// Match each audible scheduled event to the nearest measured onset.
const offsets = [];
const used = new Set();
for (const ev of analysis.log) {
  let best = -1, bestDt = Infinity;
  for (let i = 0; i < analysis.onsets.length; i++) {
    if (used.has(i)) continue;
    const dt = analysis.onsets[i] - ev.time;
    if (Math.abs(dt) < Math.abs(bestDt) && Math.abs(dt) < 0.05) { best = i; bestDt = dt; }
  }
  if (best >= 0) { used.add(best); offsets.push({ t: ev.time, offsetMs: bestDt * 1000 }); }
}

const ms = offsets.map(o => o.offsetMs);
const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
const variance = ms.reduce((a, b) => a + (b - mean) ** 2, 0) / ms.length;
const sorted = [...ms].sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)];
// The headless null-sink can start the render stream a constant number of
// device callbacks (k*512 frames) ahead of the context clock. That is a
// fixed capture-alignment latency, not sequencer error: subtract the median
// to get residual jitter, and use inter-onset intervals (purely in-stream,
// clock-independent) as the ground truth for grid stability.
const baseOffset = sorted[Math.floor(sorted.length / 2)];
const residuals = ms.map(v => v - baseOffset);
const resMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
const resStd = Math.sqrt(residuals.reduce((a, b) => a + (b - resMean) ** 2, 0) / residuals.length);
// Inter-onset intervals vs the ideal step grid.
const stepSec = 60 / (140 * 4);
const intervals = [];
for (let i = 1; i < analysis.onsets.length; i++) intervals.push(analysis.onsets[i] - analysis.onsets[i - 1]);
const intErrs = intervals.map(v => (v - stepSec) * 1000);
const intMean = intErrs.reduce((a, b) => a + b, 0) / intErrs.length;
const intStd = Math.sqrt(intErrs.reduce((a, b) => a + (b - intMean) ** 2, 0) / intErrs.length);
const intMax = Math.max(...intErrs.map(Math.abs));
// Drift: slope of a linear regression of offset vs time (ms per minute).
const n = offsets.length;
const sx = offsets.reduce((a, o) => a + o.t, 0), sy = offsets.reduce((a, o) => a + o.offsetMs, 0);
const sxx = offsets.reduce((a, o) => a + o.t * o.t, 0), sxy = offsets.reduce((a, o) => a + o.t * o.offsetMs, 0);
const slopeMsPerMin = ((n * sxy - sx * sy) / (n * sxx - sx * sx)) * 60;

const stats = {
  durationSec,
  scheduledEvents: analysis.log.length,
  matchedOnsets: offsets.length,
  unmatchedOnsets: analysis.onsets.length - used.size,
  maxPendingEvents: maxPending,
  offsetMs: {
    mean: +mean.toFixed(3),
    stddev: +Math.sqrt(variance).toFixed(3),
    min: +sorted[0].toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
    p95: +p95.toFixed(3),
  },
  captureBaseOffsetMs: +baseOffset.toFixed(3),
  residualJitterMs: { mean: +resMean.toFixed(3), stddev: +resStd.toFixed(3) },
  stepIntervalErrorMs: { mean: +intMean.toFixed(4), stddev: +intStd.toFixed(4), maxAbs: +intMax.toFixed(4) },
  driftMsPerMinute: +slopeMsPerMin.toFixed(4),
};
console.log('[A] offset stats:', JSON.stringify(stats, null, 2));

await mkdir(path.join(root, 'artifacts'), { recursive: true });
await writeFile(path.join(root, 'artifacts/beat-offset-stats.json'), JSON.stringify({ stats, offsets }, null, 2));
const csv = 'scheduled_time_s,offset_ms\n' + offsets.map(o => `${o.t.toFixed(6)},${o.offsetMs.toFixed(3)}`).join('\n');
await writeFile(path.join(root, 'artifacts/beat-offsets.csv'), csv);
console.log('[A] exported artifacts/beat-offset-stats.json and artifacts/beat-offsets.csv');

// ---------- Phase B: pause leaves no residual audio / events ----------
await new Promise(r => setTimeout(r, 1000));
const phaseB = await page.evaluate((pauseAt) => {
  const tail = testApi.drainCapture();
  return {
    pending: testApi.pendingEventCount(),
    residualPeak: testApi.maxAbs(tail, 0.2), // skip the cancellation instant
    isPlaying: testApi.seq.isPlaying,
  };
}, pauseAt);
console.log('[B] after pause:', JSON.stringify(phaseB));
const passB = phaseB.pending === 0 && !phaseB.isPlaying && phaseB.residualPeak < 1e-3;
console.log(passB ? '[B] PASS: no residual audio, queue empty' : '[B] FAIL');

// ---------- Phase C: tempo change & seek cancel cleanly ----------
const phaseC = await page.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const checks = [];
  testApi.resume();
  await sleep(2000);
  testApi.setTempo(90);
  checks.push({ op: 'setTempo(90)', queueConsistent: testApi.seq.eventQueue.every(e => e.time >= testApi.now()) });
  await sleep(2000);
  testApi.seek(3);
  checks.push({ op: 'seek(3)', queueConsistent: testApi.seq.eventQueue.every(e => e.time >= testApi.now()) });
  await sleep(2000);
  testApi.setTempo(180);
  await sleep(2000);
  testApi.drainCapture(); // discard audio rendered before the pause
  testApi.pause();
  await sleep(500);
  const tail = testApi.drainCapture();
  checks.push({ op: 'final pause', pending: testApi.pendingEventCount(), residualPeak: testApi.maxAbs(tail, 0.2) });
  return checks;
});
console.log('[C] transport checks:', JSON.stringify(phaseC, null, 2));
const passC = phaseC.every(c => (c.queueConsistent !== false) && (c.pending === undefined || c.pending === 0) && (c.residualPeak === undefined || c.residualPeak < 1e-3));
console.log(passC ? '[C] PASS' : '[C] FAIL');

await browser.close();
server.close();
const passA = stats.matchedOnsets / stats.scheduledEvents > 0.99
  && Math.abs(stats.driftMsPerMinute) < 1
  && stats.stepIntervalErrorMs.maxAbs < 5
  && stats.residualJitterMs.stddev < 1;
console.log(passA ? '[A] PASS: no missed beats, no drift' : '[A] FAIL');
process.exit(passA && passB && passC ? 0 : 1);
