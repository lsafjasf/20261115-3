/* Node 无头基准测试：与浏览器共用 engine.js，固定场景对比两种渲染模式 */
'use strict';
const fs = require('fs');
const { createCanvas } = require('canvas');
const E = require('./engine.js');

const OPTS = { count: 2000, frames: 240, seed: 527 };
const env = { createCanvas, now: () => performance.now() };

// 预热（JIT），不计入结果
E.runBenchmarkScene(env, 'dirty', { count: 200, frames: 20, seed: 1 });

const full = E.runBenchmarkScene(env, 'full', OPTS);
const dirty = E.runBenchmarkScene(env, 'dirty', OPTS);

let mismatches = 0;
const a = full.image.data, b = dirty.image.data;
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches++;

const viewArea = E.VIEW_W * E.VIEW_H;
const report = {
  scene: { objects: OPTS.count, frames: OPTS.frames, seed: OPTS.seed,
           world: `${E.WORLD_W}x${E.WORLD_H}`, viewport: `${E.VIEW_W}x${E.VIEW_H}` },
  full: { avgMs: +full.avgMs.toFixed(3), avgAreaPx: Math.round(full.avgArea),
          areaPct: 100, hash: full.hash },
  dirty: { avgMs: +dirty.avgMs.toFixed(3), avgAreaPx: Math.round(dirty.avgArea),
           areaPct: +(dirty.avgArea / viewArea * 100).toFixed(2), hash: dirty.hash },
  speedup: +(full.avgMs / dirty.avgMs).toFixed(2),
  areaReductionPct: +(100 - dirty.avgArea / viewArea * 100).toFixed(2),
  pixelIdentical: mismatches === 0 && full.hash === dirty.hash,
  mismatchedBytes: mismatches,
  totalBytes: a.length,
};

console.log(JSON.stringify(report, null, 2));
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/bench-report.json', JSON.stringify(report, null, 2));

// 可视化产物：一个代表性帧 + 该帧脏矩形叠加图
{
  const layers = E.createLayers(createCanvas);
  const objs = E.generateObjects(OPTS.count, OPTS.seed);
  const view = createCanvas(E.VIEW_W, E.VIEW_H);
  const vctx = view.getContext('2d');
  const cam = { x: -1, y: -1 };
  const dyn = E.makeDynTextState();
  let res;
  for (let f = 0; f <= 25; f++) {   // 停在非整屏脏帧
    const dirty = E.stepScene(objs, cam, layers, dyn, f);
    res = E.renderDirty(vctx, layers, objs, cam, dirty);
  }
  fs.writeFileSync('artifacts/sample-frame.png', view.toBuffer('image/png'));
  vctx.strokeStyle = 'rgba(255,80,80,0.9)';
  vctx.lineWidth = 1;
  for (const r of res.rects) vctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  fs.writeFileSync('artifacts/dirty-rects-overlay.png', view.toBuffer('image/png'));
  console.log(`artifacts: sample-frame.png, dirty-rects-overlay.png (${res.count} rects, ${res.area} px²)`);
}
