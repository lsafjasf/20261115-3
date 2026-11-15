// 离屏渲染 Worker：持有 OffscreenCanvas，独立运行渲染循环。
// 主线程只发输入状态（相机/暂停/显隐），不参与逐帧绘制。
importScripts('scene.js');

let canvas = null;
let ctx = null;
const scene = createScene();
const state = {
  camX: 0, camY: 0,
  paused: false,
  visible: [true, true, true],
};

let frameCount = 0;
let renderMsAccum = 0;
let lastFrameTs = 0;
let maxGap = 0;
let windowStart = 0;

function frame(ts) {
  if (lastFrameTs) {
    const gap = ts - lastFrameTs;
    if (gap > maxGap) maxGap = gap;
  }
  lastFrameTs = ts;

  if (!state.paused) scene.update(1 / 60);
  const t0 = performance.now();
  scene.draw(ctx, state.camX, state.camY, state.visible, canvas.width, canvas.height);
  renderMsAccum += performance.now() - t0;
  frameCount++;

  // 每 500ms 上报一次统计，避免消息风暴。
  if (!windowStart) windowStart = ts;
  if (ts - windowStart > 500) {
    postMessage({
      type: 'stats',
      fps: frameCount * 1000 / (ts - windowStart),
      renderMs: renderMsAccum / Math.max(1, frameCount),
      maxGap,
    });
    frameCount = 0;
    renderMsAccum = 0;
    maxGap = 0;
    windowStart = ts;
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(frame);
  } else {
    setTimeout(() => frame(performance.now()), 16);
  }
}

onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      canvas = m.canvas;
      canvas.width = m.width;
      canvas.height = m.height;
      ctx = canvas.getContext('2d');
      requestAnimationFrame(frame);
      break;
    case 'input':
      state.camX = m.camX;
      state.camY = m.camY;
      state.paused = m.paused;
      state.visible = m.visible;
      break;
    case 'resize':
      canvas.width = m.width;
      canvas.height = m.height;
      break;
    case 'ping':
      postMessage({ type: 'pong', t: m.t });
      break;
  }
};
