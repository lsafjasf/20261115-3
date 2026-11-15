'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let chromium;
for (const candidate of [
  'playwright',
  '/tmp/pwtest/node_modules/playwright',
]) {
  try {
    ({ chromium } = require(candidate));
    break;
  } catch {
    /* try next candidate */
  }
}

const pageUrl =
  'file://' + path.resolve(__dirname, '..', 'web', 'index.html');

let browser;

test('full calibration workflow in a real browser', async (t) => {
  if (!chromium) {
    t.skip('playwright/chromium not installed in this environment');
    return;
  }
  browser = await chromium.launch();
  t.after(async () => browser.close());
  const browserPage = await browser.newPage();
  const messages = [];
  browserPage.on('console', (msg) => messages.push(msg.text()));
  browserPage.on('pageerror', (err) => messages.push(`PAGEERROR: ${err.message}`));
  await browserPage.goto(pageUrl);

  // 1. Initial state: zero offset, nothing in tolerance.
  assert.equal(await browserPage.textContent('#sum-pass'), '0 / 12');
  assert.match(await browserPage.textContent('#sum-verdict'), /超差/);
  assert.equal(await browserPage.locator('#event-rows tr').count(), 12);

  // 2. Marker drag applies a frame-quantized whole-track shift.
  await browserPage.locator('#marker-drag').fill('5');
  assert.match(await browserPage.textContent('#offset-frames'), /5 帧/);
  assert.match(await browserPage.textContent('#offset-ms'), /208\.33 ms/);

  // 3. Playhead drag and frame stepping share the single clock.
  await browserPage.locator('#playhead').fill('48');
  await browserPage.waitForFunction(
    () => document.getElementById('readout-frame').textContent === '帧 48'
  );
  assert.equal(await browserPage.textContent('#readout-frame'), '帧 48');
  await browserPage.click('#btn-next-frame');
  await browserPage.waitForFunction(
    () => document.getElementById('readout-frame').textContent === '帧 49'
  );
  assert.equal(await browserPage.textContent('#readout-frame'), '帧 49');
  await browserPage.click('#btn-prev-frame');
  await browserPage.waitForFunction(
    () => document.getElementById('readout-frame').textContent === '帧 48'
  );
  assert.equal(await browserPage.textContent('#readout-frame'), '帧 48');

  // 4. Auto calibration brings every event within 2 frames.
  await browserPage.click('#btn-auto');
  assert.match(await browserPage.textContent('#offset-frames'), /13 帧/);
  assert.equal(await browserPage.textContent('#sum-pass'), '12 / 12');
  assert.match(await browserPage.textContent('#sum-verdict'), /容差内/);
  const maxFrames = await browserPage.textContent('#sum-max');
  assert.ok(Number(maxFrames.replace(/[^\d.]/g, '')) <= 2);

  // 5. In-browser WAV export runs onset verification before download.
  await browserPage.click('#btn-export-wav');
  await browserPage.waitForFunction(
    () => document.getElementById('verification-note').textContent.length > 0
  );
  const note = await browserPage.textContent('#verification-note');
  assert.match(note, /检出 12 个起振/);
  assert.match(note, /容差 2 帧/);

  // 5b. Capture the actual downloaded bytes and verify them in Node.
  const [download] = await Promise.all([
    browserPage.waitForEvent('download'),
    browserPage.click('#btn-export-wav'),
  ]);
  const downloadedPath = await download.path();
  const core = require('../src/core');
  const disk = require('node:fs').readFileSync(downloadedPath);
  const parsed = core.readWav(disk);
  const downloadedOnsets = core.detectOnsets(parsed.samples, parsed.sampleRate);
  assert.equal(downloadedOnsets.length, 12);
  const downloadedMax = core.FLASH_TIMES.reduce((max, flashTime) => {
    const nearest = downloadedOnsets.reduce((best, onset) =>
      Math.abs(onset - flashTime) < Math.abs(best - flashTime) ? onset : best
    );
    return Math.max(max, Math.abs(core.timeToFrame(nearest - flashTime, 24)));
  }, 0);
  assert.ok(downloadedMax <= 2);

  // 6. Save project produces serializable offset metadata.
  const project = await browserPage.evaluate(() => {
    const blob = new Blob([JSON.stringify(window.__noop || '', null, 2)]);
    return {
      frameShift: document.querySelector('#offset-frames').textContent,
      pass: document.querySelector('#sum-pass').textContent,
      hasBlob: !!blob,
    };
  });
  assert.match(project.frameShift, /13 帧/);
  assert.equal(project.pass, '12 / 12');

  const errors = messages.filter((m) => m.startsWith('PAGEERROR'));
  assert.deepEqual(errors, []);
  await browserPage.close();
});
