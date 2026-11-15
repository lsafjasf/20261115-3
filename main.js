/* 浏览器端：交互、实时渲染循环、基准测试 UI */
(function () {
'use strict';
const E = window.CanvasEngine;

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const state = {
  mode: 'dirty',
  objects: E.generateObjects(1500, 527),
  cam: { x: 400, y: 300 },
  layers: E.createLayers((w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }),
  dyn: E.makeDynTextState(),
  frame: 0,
  camMoved: true,   // 首帧整屏绘制
  emaMs: 0, emaArea: 0, rectCount: 0,
  fps: 0, fpsCount: 0, fpsTime: performance.now(),
};

function clampCam() {
  state.cam.x = Math.max(0, Math.min(E.WORLD_W - E.VIEW_W, Math.round(state.cam.x)));
  state.cam.y = Math.max(0, Math.min(E.WORLD_H - E.VIEW_H, Math.round(state.cam.y)));
}

/* ---------- 视口拖动 ---------- */
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const nx = state.cam.x - (e.clientX - drag.x);
  const ny = state.cam.y - (e.clientY - drag.y);
  drag = { x: e.clientX, y: e.clientY };
  const ox = state.cam.x, oy = state.cam.y;
  state.cam.x = nx; state.cam.y = ny;
  clampCam();
  if (state.cam.x !== ox || state.cam.y !== oy) state.camMoved = true;
});
canvas.addEventListener('pointerup', () => { drag = null; });

/* ---------- 控件 ---------- */
document.querySelectorAll('#modeSeg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
  });
});
$('objCount').addEventListener('input', (e) => {
  const n = +e.target.value;
  $('objCountVal').textContent = n;
  state.objects = E.generateObjects(n, 527);
  state.camMoved = true;   // 对象集合重建，下一帧整屏重绘
});

/* ---------- 实时渲染循环 ---------- */
function frame() {
  const dirty = [];
  E.updateObjects(state.objects);
  for (const o of state.objects) if (E.objMoved(o)) dirty.push(E.objWorldRect(o));
  if (state.camMoved) {
    dirty.push({ x: state.cam.x, y: state.cam.y, w: E.VIEW_W, h: E.VIEW_H });
    state.camMoved = false;
  }
  if (state.frame % 30 === 0) {
    dirty.push(E.updateDynText(state.layers.textCtx, state.dyn, state.frame));
  }
  state.frame++;

  const t0 = performance.now();
  let area, count = 0;
  if (state.mode === 'full') {
    E.renderFull(ctx, state.layers, state.objects, state.cam);
    area = E.VIEW_W * E.VIEW_H;
  } else {
    const r = E.renderDirty(ctx, state.layers, state.objects, state.cam, dirty);
    area = r.area; count = r.count;
  }
  const ms = performance.now() - t0;

  state.emaMs = state.emaMs ? state.emaMs * 0.9 + ms * 0.1 : ms;
  state.emaArea = state.emaArea ? state.emaArea * 0.9 + area * 0.1 : area;
  state.rectCount = count;
  state.fpsCount++;
  const now = performance.now();
  if (now - state.fpsTime >= 500) {
    state.fps = state.fpsCount * 1000 / (now - state.fpsTime);
    state.fpsCount = 0; state.fpsTime = now;
    updateStats();
  }
  requestAnimationFrame(frame);
}

function updateStats() {
  const pct = state.emaArea / (E.VIEW_W * E.VIEW_H) * 100;
  $('statFps').textContent = state.fps.toFixed(0);
  $('statMs').textContent = state.emaMs.toFixed(2) + ' ms';
  $('statArea').textContent =
    `${Math.round(state.emaArea).toLocaleString()} px²（${pct.toFixed(1)}%）`;
  $('statRects').textContent = state.mode === 'dirty' ? state.rectCount : '—';
}

requestAnimationFrame(frame);

/* ---------- 固定场景基准测试（两种模式跑相同帧序列并逐像素比对） ---------- */
const BENCH = { count: 2000, frames: 240, seed: 527 };

function runBenchMode(mode) {
  return new Promise((resolve) => {
    const layers = E.createLayers((w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    });
    const objs = E.generateObjects(BENCH.count, BENCH.seed);
    const view = document.createElement('canvas');
    view.width = E.VIEW_W; view.height = E.VIEW_H;
    const vctx = view.getContext('2d');
    const cam = { x: -1, y: -1 };
    const dyn = E.makeDynTextState();
    let f = 0, totalMs = 0, totalArea = 0, hash = 0x811c9dc5;
    (function step() {
      const dirty = E.stepScene(objs, cam, layers, dyn, f);
      const t0 = performance.now();
      let area;
      if (mode === 'full') {
        E.renderFull(vctx, layers, objs, cam);
        area = E.VIEW_W * E.VIEW_H;
      } else {
        area = E.renderDirty(vctx, layers, objs, cam, dirty).area;
      }
      totalMs += performance.now() - t0;
      totalArea += area;
      hash = E.hashImageData(vctx.getImageData(0, 0, E.VIEW_W, E.VIEW_H), hash);
      if (++f < BENCH.frames) requestAnimationFrame(step);
      else resolve({
        avgMs: totalMs / BENCH.frames,
        avgArea: totalArea / BENCH.frames,
        hash,
        image: vctx.getImageData(0, 0, E.VIEW_W, E.VIEW_H),
      });
    })();
  });
}

async function runBenchmark() {
  $('benchBtn').disabled = true;
  $('verifyBadge').classList.add('hidden');
  const full = await runBenchMode('full');
  const dirty = await runBenchMode('dirty');

  let mismatches = 0;
  const a = full.image.data, b = dirty.image.data;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches++;
  const identical = mismatches === 0 && full.hash === dirty.hash;

  const viewArea = E.VIEW_W * E.VIEW_H;
  $('fullMs').textContent = full.avgMs.toFixed(2) + ' ms';
  $('fullArea').textContent = Math.round(full.avgArea).toLocaleString() + ' px²';
  $('dirtyMs').textContent = dirty.avgMs.toFixed(2) + ' ms';
  $('dirtyArea').textContent = Math.round(dirty.avgArea).toLocaleString() + ' px²';
  $('dirtyPct').textContent = (dirty.avgArea / viewArea * 100).toFixed(1) + '%';
  $('speedup').textContent =
    `帧时间 ×${(full.avgMs / dirty.avgMs).toFixed(2)} · 重绘面积减少 ${(100 - dirty.avgArea / viewArea * 100).toFixed(1)}%`;

  const badge = $('verifyBadge');
  badge.classList.remove('hidden', 'ok', 'fail');
  badge.classList.add(identical ? 'ok' : 'fail');
  badge.textContent = identical
    ? `像素一致性校验通过（0/${a.length} 字节差异）`
    : `像素不一致：${mismatches} 字节差异`;
  $('benchBtn').disabled = false;
  return { full, dirty, identical, mismatches };
}

$('benchBtn').addEventListener('click', runBenchmark);

if (new URLSearchParams(location.search).has('autobench')) {
  runBenchmark().then((r) => {
    const pre = document.createElement('pre');
    pre.id = 'bench-json';
    pre.textContent = JSON.stringify({
      full: { avgMs: r.full.avgMs, avgArea: r.full.avgArea, hash: r.full.hash },
      dirty: { avgMs: r.dirty.avgMs, avgArea: r.dirty.avgArea, hash: r.dirty.hash },
      identical: r.identical, mismatches: r.mismatches,
    });
    document.body.appendChild(pre);
    document.title = 'BENCH_DONE';
  });
}
})();
