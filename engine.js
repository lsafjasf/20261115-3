/* 共享渲染引擎：浏览器页面与 Node 基准测试共用同一套场景/渲染逻辑，
 * 保证两种环境下对比的是完全相同的算法。 */
(function (global) {
'use strict';

const WORLD_W = 3200;   // 虚拟大画布（世界）尺寸
const WORLD_H = 2400;
const VIEW_W = 960;     // 视口（屏幕画布）尺寸
const VIEW_H = 600;
const OBJ_PAD = 4;      // 对象脏矩形外扩：描边宽度 + 抗锯齿余量
const MAX_RECTS = 64;   // 每帧最多保留的脏矩形数量（超过则合并）
const CONTAIN_PAD = 4;  // 裁剪包含余量：描边 + 抗锯齿 + 裁剪安全距离

/* ---------- 确定性随机数（固定场景可复现） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

function hsla(h, s, l, a) {
  const c = hslToRgb(h, s, l);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/* ---------- 动态对象 ---------- */
function generateObjects(count, seed) {
  const rand = mulberry32(seed);
  const objs = [];
  for (let i = 0; i < count; i++) {
    const r = 4 + rand() * 12;
    const hue = Math.floor(rand() * 360);
    const moving = rand() < 0.3;   // 约 30% 对象活动，其余静止（典型场景）
    objs.push({
      x: r + rand() * (WORLD_W - 2 * r),
      y: r + rand() * (WORLD_H - 2 * r),
      vx: moving ? (rand() - 0.5) * 6 : 0,
      vy: moving ? (rand() - 0.5) * 6 : 0,
      r,
      fill: hsla(hue, 0.7, 0.55, 1),
      stroke: hsla(hue, 0.8, 0.3, 1),
      px: 0, py: 0,
    });
  }
  for (const o of objs) { o.px = o.x; o.py = o.y; }
  return objs;
}

function updateObjects(objs) {
  for (const o of objs) {
    o.px = o.x; o.py = o.y;
    if (o.vx === 0 && o.vy === 0) continue;
    o.x += o.vx; o.y += o.vy;
    if (o.x < o.r) { o.x = o.r; o.vx = -o.vx; }
    else if (o.x > WORLD_W - o.r) { o.x = WORLD_W - o.r; o.vx = -o.vx; }
    if (o.y < o.r) { o.y = o.r; o.vy = -o.vy; }
    else if (o.y > WORLD_H - o.r) { o.y = WORLD_H - o.r; o.vy = -o.vy; }
  }
}

function objMoved(o) { return o.x !== o.px || o.y !== o.py; }

/* ---------- 脏矩形工具 ---------- */
function objWorldRect(o) {
  const x0 = Math.min(o.px, o.x) - o.r - OBJ_PAD;
  const y0 = Math.min(o.py, o.y) - o.r - OBJ_PAD;
  const x1 = Math.max(o.px, o.x) + o.r + OBJ_PAD;
  const y1 = Math.max(o.py, o.y) + o.r + OBJ_PAD;
  const fx = Math.floor(x0), fy = Math.floor(y0);
  return { x: fx, y: fy, w: Math.ceil(x1) - fx, h: Math.ceil(y1) - fy };
}

function worldToScreen(r, cam) {
  return { x: r.x - cam.x, y: r.y - cam.y, w: r.w, h: r.h };
}

function clipRect(r, w, h) {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function unionRect(a, b) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function overlaps(a, b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w &&
         a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/* 插入矩形并吸收所有重叠项，保证集合内矩形互不重叠。
 * 若允许重叠，同一像素会被绘制两次：不透明背景无碍，
 * 但抗锯齿边缘与半透明文字会被二次叠加，破坏与全量重绘的像素一致性。 */
function insertMerging(out, r) {
  let cur = r, merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length; i++) {
      if (overlaps(out[i], cur)) {
        cur = unionRect(out[i], cur);
        out.splice(i, 1);
        merged = true;
        break;
      }
    }
  }
  out.push(cur);
}

function mergeRects(rects, maxCount) {
  const out = [];
  for (const r of rects) insertMerging(out, r);
  while (out.length > maxCount) {
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const u = unionRect(out[i], out[j]);
        const cost = u.w * u.h - out[i].w * out[i].h - out[j].w * out[j].h;
        if (cost < best) { best = cost; bi = i; bj = j; }
      }
    }
    const u = unionRect(out[bi], out[bj]);
    out.splice(bj, 1); out.splice(bi, 1);
    insertMerging(out, u);   // 并集可能覆盖其他矩形，需重新吸收
  }
  return out;
}

/* 对象在屏幕坐标下的完整边缘 bbox（含描边、抗锯齿与裁剪安全余量） */
function objFringeScreenRect(o, cam) {
  const e = o.r + CONTAIN_PAD;
  const x = Math.max(0, Math.floor(o.x - cam.x - e));
  const y = Math.max(0, Math.floor(o.y - cam.y - e));
  const x1 = Math.min(VIEW_W, Math.ceil(o.x - cam.x + e));
  const y1 = Math.min(VIEW_H, Math.ceil(o.y - cam.y + e));
  if (x1 <= x || y1 <= y) return null;
  return { x, y, w: x1 - x, h: y1 - y };
}

function strictIntersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w &&
         a.y < b.y + b.h && b.y < a.y + a.h;
}

function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
         inner.x + inner.w <= outer.x + outer.w &&
         inner.y + inner.h <= outer.y + outer.h;
}

/* 扩展脏矩形，使任何与之相交的对象边缘都被完整包含。
 * 若被绘制的形状跨越裁剪边界，cairo/Skia 的裁剪量化会让边界内侧
 * 约 2px 内的像素产生 ±1~±5 的偏差，破坏与全量重绘的像素一致性。
 * 迭代不收敛时回退为整屏矩形（整屏裁剪经验证是精确的）。 */
function containObjects(rects, objs, fringes) {
  let out = rects;
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (let i = 0; i < objs.length; i++) {
      const b = fringes[i];
      if (!b) continue;
      for (const R of out) {
        if (!strictIntersects(b, R) || containsRect(R, b)) continue;
        const x = Math.min(R.x, b.x), y = Math.min(R.y, b.y);
        const x1 = Math.max(R.x + R.w, b.x + b.w);
        const y1 = Math.max(R.y + R.h, b.y + b.h);
        R.x = x; R.y = y; R.w = x1 - x; R.h = y1 - y;
        changed = true;
      }
    }
    if (!changed) return out;
    out = mergeRects(out, MAX_RECTS * 4);
  }
  return [{ x: 0, y: 0, w: VIEW_W, h: VIEW_H }];
}

/* ---------- 静态背景层（只绘制一次，永久缓存） ---------- */
function renderBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
  g.addColorStop(0, '#101828');
  g.addColorStop(1, '#1c2b45');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  const rand = mulberry32(20261115);
  for (let i = 0; i < 900; i++) {           // 星空
    const x = rand() * WORLD_W, y = rand() * WORLD_H;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + rand() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120,160,255,0.10)'; // 网格
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WORLD_W; x += 100) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, WORLD_H); }
  for (let y = 0; y <= WORLD_H; y += 100) { ctx.moveTo(0, y + 0.5); ctx.lineTo(WORLD_W, y + 0.5); }
  ctx.stroke();
  for (let i = 0; i < 60; i++) {            // 装饰色块
    ctx.fillStyle = hsla(Math.floor(rand() * 360), 0.6, 0.5, 0.12);
    ctx.fillRect(rand() * WORLD_W, rand() * WORLD_H, 40 + rand() * 160, 40 + rand() * 160);
  }
}

/* ---------- 文字层（独立缓存，内容变化时才重绘对应区域） ---------- */
function renderStaticText(ctx) {
  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'rgba(200,220,255,0.85)';
  ctx.textBaseline = 'top';
  for (let gy = 200; gy < WORLD_H; gy += 400) {
    for (let gx = 200; gx < WORLD_W; gx += 400) {
      ctx.fillText(`区域 ${String.fromCharCode(65 + (gy / 400 | 0))}${gx / 400 | 0}`, gx, gy);
    }
  }
}

const DYN_TEXT_POS = { x: 500, y: 360 };

function makeDynTextState() { return { rect: null, tick: -1 }; }

/* 更新动态文字，返回世界坐标脏矩形（旧区域 ∪ 新区域） */
function updateDynText(textCtx, state, tick) {
  const text = `TICK ${tick}`;
  textCtx.font = 'bold 28px sans-serif';
  textCtx.textBaseline = 'top';
  const newRect = {
    x: DYN_TEXT_POS.x - 4,
    y: DYN_TEXT_POS.y - 4,
    w: Math.ceil(textCtx.measureText(text).width) + 8,
    h: 36,
  };
  let dirty = newRect;
  if (state.rect) {
    textCtx.clearRect(state.rect.x, state.rect.y, state.rect.w, state.rect.h);
    dirty = unionRect(state.rect, newRect);
  }
  textCtx.fillStyle = 'rgba(10,14,24,0.55)';
  textCtx.fillRect(newRect.x, newRect.y, newRect.w, newRect.h);
  textCtx.fillStyle = '#ffd166';
  textCtx.fillText(text, DYN_TEXT_POS.x, DYN_TEXT_POS.y);
  state.rect = newRect;
  state.tick = tick;
  return dirty;
}

function createLayers(createCanvas) {
  const bg = createCanvas(WORLD_W, WORLD_H);
  renderBackground(bg.getContext('2d'));
  const text = createCanvas(WORLD_W, WORLD_H);
  const textCtx = text.getContext('2d');
  renderStaticText(textCtx);
  return { bg, text, textCtx };
}

/* ---------- 对象绘制 ---------- */
function drawObject(ctx, o, cam) {
  ctx.beginPath();
  ctx.arc(o.x - cam.x, o.y - cam.y, o.r, 0, Math.PI * 2);
  ctx.fillStyle = o.fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = o.stroke;
  ctx.stroke();
}

/* ---------- 模式一：全量重绘 ---------- */
function renderFull(ctx, layers, objs, cam) {
  ctx.drawImage(layers.bg, cam.x, cam.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(layers.text, cam.x, cam.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  const x0 = cam.x - 32, y0 = cam.y - 32;
  const x1 = cam.x + VIEW_W + 32, y1 = cam.y + VIEW_H + 32;
  for (const o of objs) {
    if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
    drawObject(ctx, o, cam);
  }
}

/* ---------- 模式二：脏矩形局部重绘 ----------
 * 关键正确性约束（均由 containObjects 保证）：
 * 1. 逐矩形渲染，每个矩形一次 bg/text 子块 blit + 单矩形裁剪绘制对象；
 * 2. 任何被绘制对象的完整边缘必须包含在裁剪矩形内——跨越裁剪边界的
 *    形状会被 cairo/Skia 的裁剪量化改变，产生 ±1~±5 的像素偏差；
 * 3. 背景/文字层用子块 drawImage（无裁剪），采样与整层 blit 完全一致。 */
function renderDirty(ctx, layers, objs, cam, dirtyWorld) {
  const clipped = [];
  for (const r of dirtyWorld) {
    const c = clipRect(worldToScreen(r, cam), VIEW_W, VIEW_H);
    if (c) clipped.push(c);
  }
  const fringes = new Array(objs.length);
  for (let i = 0; i < objs.length; i++) fringes[i] = objFringeScreenRect(objs[i], cam);
  const rects = containObjects(mergeRects(clipped, MAX_RECTS), objs, fringes);
  let area = 0;
  for (const r of rects) {
    area += r.w * r.h;
    const sx = r.x + cam.x, sy = r.y + cam.y;
    ctx.drawImage(layers.bg, sx, sy, r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.drawImage(layers.text, sx, sy, r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    for (let i = 0; i < objs.length; i++) {
      const b = fringes[i];
      if (b && strictIntersects(b, r)) drawObject(ctx, objs[i], cam);
    }
    ctx.restore();
  }
  return { area, count: rects.length, rects };
}

/* ---------- 固定基准场景（两种模式跑完全相同的帧序列） ---------- */
function benchCamera(f) {
  // 突发式平移：每 60 帧的前 10 帧移动视口，其余时间静止
  const phase = f % 60;
  const burst = Math.floor(f / 60) * 10 + Math.min(phase, 10);
  return { x: 300 + (burst * 37) % 1800, y: 200 + (burst * 23) % 1400 };
}

function hashImageData(img, h) {
  const d = img.data;
  h = h >>> 0;
  for (let i = 0; i < d.length; i += 16) {
    h ^= d[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* 单帧场景推进：更新对象/视口/动态文字，返回世界坐标脏矩形列表 */
function stepScene(objs, cam, layers, dyn, f) {
  const dirty = [];
  updateObjects(objs);
  for (const o of objs) if (objMoved(o)) dirty.push(objWorldRect(o));
  const nc = benchCamera(f);
  if (nc.x !== cam.x || nc.y !== cam.y) {
    cam.x = nc.x; cam.y = nc.y;
    dirty.push({ x: cam.x, y: cam.y, w: VIEW_W, h: VIEW_H });
  }
  if (f % 30 === 0) dirty.push(updateDynText(layers.textCtx, dyn, f));
  return dirty;
}

function runBenchmarkScene(env, mode, opts) {
  const layers = createLayers(env.createCanvas);
  const objs = generateObjects(opts.count, opts.seed);
  const view = env.createCanvas(VIEW_W, VIEW_H);
  const ctx = view.getContext('2d');
  const cam = { x: -1, y: -1 };
  const dyn = makeDynTextState();
  let totalMs = 0, totalArea = 0, hash = 0x811c9dc5;
  for (let f = 0; f < opts.frames; f++) {
    const dirty = stepScene(objs, cam, layers, dyn, f);
    let area;
    const t0 = env.now();
    if (mode === 'full') {
      renderFull(ctx, layers, objs, cam);
      area = VIEW_W * VIEW_H;
    } else {
      area = renderDirty(ctx, layers, objs, cam, dirty).area;
    }
    totalMs += env.now() - t0;
    totalArea += area;
    hash = hashImageData(ctx.getImageData(0, 0, VIEW_W, VIEW_H), hash);
  }
  return {
    avgMs: totalMs / opts.frames,
    avgArea: totalArea / opts.frames,
    hash,
    image: ctx.getImageData(0, 0, VIEW_W, VIEW_H),
  };
}

const Engine = {
  WORLD_W, WORLD_H, VIEW_W, VIEW_H, MAX_RECTS,
  mulberry32, generateObjects, updateObjects,
  objWorldRect, objMoved, worldToScreen, clipRect, unionRect, mergeRects,
  objFringeScreenRect, containObjects,
  createLayers, makeDynTextState, updateDynText,
  drawObject, renderFull, renderDirty,
  benchCamera, stepScene, hashImageData, runBenchmarkScene,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
global.CanvasEngine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
