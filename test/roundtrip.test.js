import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from './server.js';

const ARTIFACTS = join(new URL('..', import.meta.url).pathname, 'artifacts');
let baseUrl = 'http://127.0.0.1';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition), detail });
  const tag = condition ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function shaFile(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function buildSampleProject(page) {
  await page.evaluate(() => {
    const { state, doCommand, refreshAndRender } = window.editor;
    const store = state.store;
    store.createdAt = 1_700_000_000_000;
    store.counters.asset = 3;
    store.counters.layer = 3;
    store.counters.keyframe = 5;

    doCommand({
      type: 'addAsset',
      index: 0,
      asset: {
        id: 'asset_0001', kind: 'rect', name: 'card', src: null,
        params: {
          text: '', x: 120, y: 110, width: 300, height: 200, rotation: 0,
          opacity: 1, blur: 0, radius: 24, fontSize: 16,
          fill: '#ef476f', stroke: '#ffffff', strokeWidth: 3, fontFamily: 'sans-serif',
        },
      },
    });
    doCommand({
      type: 'addAsset',
      index: 1,
      asset: {
        id: 'asset_0002', kind: 'text', name: 'title', src: null,
        params: {
          text: 'Round Trip', x: 180, y: 170, width: 420, height: 90, rotation: 0,
          opacity: 1, blur: 0, radius: 0, fontSize: 56,
          fill: '#f4f7ff', stroke: '#000000', strokeWidth: 0, fontFamily: 'sans-serif',
        },
      },
    });
    doCommand({
      type: 'addAsset',
      index: 2,
      asset: {
        id: 'asset_0003', kind: 'ellipse', name: 'dot', src: null,
        params: {
          text: '', x: 620, y: 380, width: 180, height: 180, rotation: 0,
          opacity: 0.85, blur: 2, radius: 0, fontSize: 16,
          fill: '#3da9fc', stroke: '#ffd166', strokeWidth: 4, fontFamily: 'sans-serif',
        },
      },
    });

    doCommand({ type: 'addLayer', index: 0, layer: {
      id: 'layer_0001', name: 'card-layer', assetId: 'asset_0001',
      visible: true, locked: false,
      base: { ...store.assets[0].params }, keyframes: [],
    } });
    doCommand({ type: 'addLayer', index: 1, layer: {
      id: 'layer_0002', name: 'title-layer', assetId: 'asset_0002',
      visible: true, locked: false,
      base: { ...store.assets[1].params }, keyframes: [],
    } });
    doCommand({ type: 'addLayer', index: 2, layer: {
      id: 'layer_0003', name: 'dot-layer', assetId: 'asset_0003',
      visible: true, locked: false,
      base: { ...store.assets[2].params }, keyframes: [],
    } });

    doCommand({ type: 'addKeyframe', layerId: 'layer_0001', keyframe: {
      id: 'keyframe_0001', time: 0, easing: 'linear',
      props: { x: 60, y: 90, width: 300, height: 200, rotation: 0, opacity: 1 },
    } });
    doCommand({ type: 'addKeyframe', layerId: 'layer_0001', keyframe: {
      id: 'keyframe_0002', time: 2500, easing: 'ease-in-out',
      props: { x: 240, y: 150, width: 300, height: 200, rotation: 12, opacity: 0.9 },
    } });
    doCommand({ type: 'addKeyframe', layerId: 'layer_0001', keyframe: {
      id: 'keyframe_0003', time: 5000, easing: 'linear',
      props: { x: 480, y: 240, width: 300, height: 200, rotation: 24, opacity: 0.7 },
    } });
    doCommand({ type: 'addKeyframe', layerId: 'layer_0003', keyframe: {
      id: 'keyframe_0004', time: 0, easing: 'linear',
      props: { x: 620, y: 380, width: 180, height: 180, rotation: 0, opacity: 0.85 },
    } });
    doCommand({ type: 'addKeyframe', layerId: 'layer_0003', keyframe: {
      id: 'keyframe_0005', time: 5000, easing: 'ease-out',
      props: { x: 120, y: 120, width: 180, height: 180, rotation: 180, opacity: 0.85 },
    } });

    doCommand({ type: 'updateTimeline',
      before: { duration: 5000, playhead: 0, fps: 30 },
      after: { duration: 5000, playhead: 1250, fps: 30 } });

    refreshAndRender();
  });
}

async function snapshot(page, label) {
  await page.evaluate(() => window.editor.refreshAndRender());
  const counts = await page.evaluate(() => window.editor.projectCounts());
  const hash = await page.evaluate(() => window.editor.docHash());
  const exportText = await page.evaluate(() => window.editor.exportText());
  const screenshot = await page.locator('#stage').screenshot();
  await mkdir(ARTIFACTS, { recursive: true });
  await writeFile(join(ARTIFACTS, `project-${label}.json`), exportText);
  await writeFile(join(ARTIFACTS, `stage-${label}.png`), screenshot);
  return {
    label,
    counts,
    hash,
    exportText,
    screenshotHash: shaFile(screenshot),
    screenshotBytes: screenshot.length,
  };
}

async function freshPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForFunction(() => window.editor !== undefined);
  return { page, errors };
}

const server = await startServer(0);
baseUrl = `http://127.0.0.1:${server.addressPort}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

// --- Session 1: build the project, exercise undo, save -------------------
let session = await freshPage(context);
let page = session.page;
await buildSampleProject(page);

const baselineCounts = await page.evaluate(() => window.editor.projectCounts());
check('sample project object counts',
  baselineCounts.assets === 3 && baselineCounts.layers === 3 &&
  baselineCounts.keyframes === 5 && baselineCounts.undoEntries === 12,
  JSON.stringify(baselineCounts));

// Undo one command, then redo it so the stack itself is exercised.
await page.click('#undo');
const afterUndo = await page.evaluate(() => window.editor.projectCounts());
check('undo removes the timeline command (11 undo entries, 1 redo)',
  afterUndo.undoEntries === 11 && afterUndo.redoEntries === 1,
  JSON.stringify(afterUndo));
await page.click('#redo');
const afterRedo = await page.evaluate(() => window.editor.projectCounts());
check('redo restores the command (12 undo entries, 0 redo)',
  afterRedo.undoEntries === 12 && afterRedo.redoEntries === 0,
  JSON.stringify(afterRedo));

const snap0 = await snapshot(page, 'cycle0-initial');
await page.click('#save');
await page.waitForFunction(() => localStorage.getItem(window.editor.storageKey) !== null);

// Repeated exports must not mutate the live store or duplicate objects.
const repeatExports = await page.evaluate(async () => {
  const texts = [];
  for (let i = 0; i < 3; i += 1) texts.push(await window.editor.exportText());
  return {
    texts,
    counts: window.editor.projectCounts(),
    identical: texts.every((t) => t === texts[0]),
  };
});
check('three consecutive exports are byte-identical', repeatExports.identical);
check('repeated exports do not change object counts',
  JSON.stringify(repeatExports.counts) === JSON.stringify(snap0.counts),
  JSON.stringify(repeatExports.counts));

// --- Cycle 1: brand-new browser context restores from localStorage --------
await page.close();
session = await freshPage(context);
page = session.page;
const snap1 = await snapshot(page, 'cycle1-reloaded');
check('cycle 1 counts match initial',
  JSON.stringify(snap1.counts) === JSON.stringify(snap0.counts),
  `${JSON.stringify(snap0.counts)} vs ${JSON.stringify(snap1.counts)}`);
check('cycle 1 canonical doc hash matches initial',
  snap1.hash === snap0.hash, `${snap0.hash} vs ${snap1.hash}`);
check('cycle 1 screenshot pixels match initial',
  snap1.screenshotHash === snap0.screenshotHash,
  `${snap0.screenshotHash} vs ${snap1.screenshotHash}`);
check('undo history restored (12 entries) after reload',
  snap1.counts.undoEntries === 12 && snap1.counts.redoEntries === 0);

// Undo must work using the persisted history.
await page.click('#undo');
const reloadedUndo = await page.evaluate(() => window.editor.projectCounts());
check('persisted undo stack works after reload',
  reloadedUndo.undoEntries === 11 && reloadedUndo.redoEntries === 1);
await page.click('#redo');
await page.click('#save');

// --- Cycle 2: save/load a second time -------------------------------------
await page.close();
session = await freshPage(context);
page = session.page;
const snap2 = await snapshot(page, 'cycle2-reloaded');
check('cycle 2 counts match initial',
  JSON.stringify(snap2.counts) === JSON.stringify(snap0.counts));
check('cycle 2 canonical doc hash matches initial',
  snap2.hash === snap0.hash);
check('cycle 2 screenshot pixels match initial',
  snap2.screenshotHash === snap0.screenshotHash);
check('undo history still intact after second cycle',
  snap2.counts.undoEntries === 12);

// In-page Load button gives the same result without a reload.
await page.click('#load');
const snap2b = await snapshot(page, 'cycle2-load-button');
check('in-page Load preserves hash and counts',
  snap2b.hash === snap0.hash &&
  JSON.stringify(snap2b.counts) === JSON.stringify(snap0.counts));

// --- Dangling references must be blocked, never silently accepted ---------
const danglingResult = await page.evaluate(() => {
  const good = JSON.parse(localStorage.getItem(window.editor.storageKey));
  const broken = JSON.parse(JSON.stringify(good));
  broken.doc.layers[0].assetId = 'asset_9999';
  try {
    window.editor.importText(JSON.stringify(broken));
    return { blocked: false };
  } catch (err) {
    return { blocked: true, message: err.message };
  }
});
check('import with dangling layer->asset reference is rejected',
  danglingResult.blocked, danglingResult.message);

const duplicateResult = await page.evaluate(() => {
  const good = JSON.parse(localStorage.getItem(window.editor.storageKey));
  const dup = JSON.parse(JSON.stringify(good));
  dup.doc.assets.push({ ...dup.doc.assets[0] });
  try {
    window.editor.importText(JSON.stringify(dup));
    return { blocked: false };
  } catch (err) {
    return { blocked: true, message: err.message };
  }
});
check('import with duplicate entity id is rejected',
  duplicateResult.blocked, duplicateResult.message);

const deleteBlocked = await page.evaluate(() => {
  const { state } = window.editor;
  state.selectedAssetId = 'asset_0001';
  document.getElementById('deleteAsset').click();
  return window.editor.projectCounts();
});
check('deleting an in-use asset is blocked',
  deleteBlocked.assets === 3 && deleteBlocked.layers === 3,
  JSON.stringify(deleteBlocked));

// --- Field-level round trip: timeline, keyframes, asset params ------------
const fieldCheck = await page.evaluate(() => {
  const { state } = window.editor;
  const store = state.store;
  const layer = store.layers.find((l) => l.id === 'layer_0001');
  const asset = store.assets.find((a) => a.id === 'asset_0001');
  return {
    timeline: store.timeline,
    keyframeTimes: layer.keyframes.map((kf) => kf.time),
    keyframeEasings: layer.keyframes.map((kf) => kf.easing),
    midKeyframe: layer.keyframes.find((kf) => kf.time === 2500).props,
    assetParams: asset.params,
    undoDepth: store.undo.length,
    counters: store.counters,
  };
});
check('timeline state round-trips (duration/playhead/fps)',
  fieldCheck.timeline.duration === 5000 &&
  fieldCheck.timeline.playhead === 1250 &&
  fieldCheck.timeline.fps === 30,
  JSON.stringify(fieldCheck.timeline));
check('keyframes round-trip with times and easing modes',
  JSON.stringify(fieldCheck.keyframeTimes) === '[0,2500,5000]' &&
  JSON.stringify(fieldCheck.keyframeEasings) === '["linear","ease-in-out","linear"]');
check('keyframe props round-trip (animated transform/opacity)',
  fieldCheck.midKeyframe.rotation === 12 &&
  fieldCheck.midKeyframe.x === 240 &&
  fieldCheck.midKeyframe.opacity === 0.9);
check('asset parameters round-trip (fill/radius/strokeWidth)',
  fieldCheck.assetParams.fill === '#ef476f' &&
  fieldCheck.assetParams.radius === 24 &&
  fieldCheck.assetParams.strokeWidth === 3);
check('id counters round-trip so new ids never collide',
  fieldCheck.counters.asset >= 3 &&
  fieldCheck.counters.layer >= 3 &&
  fieldCheck.counters.keyframe >= 5,
  JSON.stringify(fieldCheck.counters));

// Exported files on disk across cycles must be identical canonical JSON.
const file0 = await readFile(join(ARTIFACTS, 'project-cycle0-initial.json'), 'utf8');
const file1 = await readFile(join(ARTIFACTS, 'project-cycle1-reloaded.json'), 'utf8');
const file2 = await readFile(join(ARTIFACTS, 'project-cycle2-reloaded.json'), 'utf8');
check('exported JSON files are byte-identical across all three snapshots',
  file0 === file1 && file1 === file2);

const allErrors = session.errors;
check('no browser console/page errors', allErrors.length === 0,
  session.errors.join(' | '));

await browser.close();
await new Promise((resolve) => server.close(resolve));

const failed = results.filter((r) => !r.pass);
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  snapshots: {
    initial: { counts: snap0.counts, docHash: snap0.hash, screenshotHash: snap0.screenshotHash, screenshotBytes: snap0.screenshotBytes },
    cycle1: { counts: snap1.counts, docHash: snap1.hash, screenshotHash: snap1.screenshotHash, screenshotBytes: snap1.screenshotBytes },
    cycle2: { counts: snap2.counts, docHash: snap2.hash, screenshotHash: snap2.screenshotHash, screenshotBytes: snap2.screenshotBytes },
  },
  checks: results,
};
await writeFile(join(ARTIFACTS, 'roundtrip-report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${report.total} checks passed`);
if (failed.length) process.exitCode = 1;
