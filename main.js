// 主线程：只负责输入采集、UI 合成与统计展示。
// 离屏模式：渲染全部在 Worker；单线程模式：渲染在主线程，用于对比。
const stage = document.getElementById('stage');
const modeBtn = document.getElementById('modeBtn');
const pauseBtn = document.getElementById('pauseBtn');
const blockBtn = document.getElementById('blockBtn');
const layerBoxes = [0, 1, 2].map(i => document.getElementById('ly' + i));
const statMain = document.getElementById('statMain');
const statRender = document.getElementById('statRender');
const statMsg = document.getElementById('statMsg');
const statBlock = document.getElementById('statBlock');

const input = { camX: 0, camY: 0, paused: false, visible: [true, true, true] };
let offscreenMode = true;
let worker = null;
let singleScene = null;
let singleCtx = null;
let canvasEl = document.getElementById('cv');

// ---- 统计 ----
let mainFrames = 0, mainWindowStart = performance.now(), mainMaxGap = 0, lastMainTs = 0;
let workerStats = null;
let lastRtt = null;
let blockResult = null;

function makeCanvas() {
  const old = canvasEl;
  canvasEl = document.createElement('canvas');
  canvasEl.id = 'cv';
  if (old) old.replaceWith(canvasEl); else stage.appendChild(canvasEl);
  sizeCanvas();
}

function sizeCanvas() {
  canvasEl.width = canvasEl.clientWidth * devicePixelRatio;
  canvasEl.height = canvasEl.clientHeight * devicePixelRatio;
}

function startOffscreen() {
  stopSingle();
  makeCanvas();
  worker = new Worker('worker.js');
  const off = canvasEl.transferControlToOffscreen();
  worker.postMessage({ type: 'init', canvas: off, width: canvasEl.width, height: canvasEl.height }, [off]);
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'stats') {
      workerStats = m;
      if (pendingBlock && pendingBlock.awaitWorker) {
        blockResult.workerMaxGap = m.maxGap;
        pendingBlock = null;
      }
    }
    else if (m.type === 'pong') lastRtt = performance.now() - m.t;
  };
  pushInput();
}

function stopOffscreen() {
  if (worker) { worker.terminate(); worker = null; }
  workerStats = null;
}

function startSingle() {
  stopOffscreen();
  makeCanvas();
  singleCtx = canvasEl.getContext('2d');
  singleScene = createScene();
}

function stopSingle() {
  singleScene = null;
  singleCtx = null;
}

function pushInput() {
  if (worker) worker.postMessage({ type: 'input', ...input });
}

// ---- 输入 ----
addEventListener('wheel', (e) => {
  input.camX = Math.max(0, input.camX + e.deltaY);
  input.camY = Math.max(0, input.camY + e.deltaX);
  pushInput();
}, { passive: true });

pauseBtn.onclick = () => {
  input.paused = !input.paused;
  pauseBtn.textContent = input.paused ? '继续' : '暂停';
  pushInput();
};

layerBoxes.forEach((box, i) => {
  box.onchange = () => { input.visible[i] = box.checked; pushInput(); };
});

modeBtn.onclick = () => {
  offscreenMode = !offscreenMode;
  modeBtn.textContent = offscreenMode ? '模式：离屏 Worker' : '模式：单线程';
  blockResult = null;
  if (offscreenMode) startOffscreen(); else startSingle();
};

// ---- 主线程阻塞测试：忙等 50ms ----
let pendingBlock = null;
blockBtn.onclick = () => {
  const t0 = performance.now();
  while (performance.now() - t0 < 50) { /* busy wait */ }
  const blockedMs = performance.now() - t0;
  pendingBlock = { t0, blockedMs, mode: offscreenMode, awaitWorker: false };
  requestAnimationFrame(() => {
    if (!pendingBlock) return;
    // 用 performance.now() 实测主线程从阻塞到下一帧恢复的真实耗时，
    // rAF 时间戳是调度时间，不能反映事件 handler 造成的卡顿。
    const mainGap = performance.now() - pendingBlock.t0;
    if (pendingBlock.mode) {
      // 离屏模式：主线程同样被阻塞，需等 Worker 下次统计证明画面未冻结。
      blockResult = { mode: true, blockedMs: pendingBlock.blockedMs, mainGap, workerMaxGap: null };
      pendingBlock.awaitWorker = true;
    } else {
      blockResult = { mode: false, blockedMs: pendingBlock.blockedMs, mainGap };
      pendingBlock = null;
    }
  });
};

addEventListener('resize', () => {
  sizeCanvas();
  if (worker) worker.postMessage({ type: 'resize', width: canvasEl.width, height: canvasEl.height });
});

// ---- 主线程 rAF：统计 + 单线程渲染 + ping ----
let lastPing = 0;
function loop(ts) {
  if (lastMainTs) {
    const gap = ts - lastMainTs;
    if (gap > mainMaxGap) mainMaxGap = gap;
  }
  lastMainTs = ts;
  mainFrames++;

  if (!offscreenMode && singleScene) {
    if (!input.paused) singleScene.update(1 / 60);
    const t0 = performance.now();
    singleScene.draw(singleCtx, input.camX, input.camY, input.visible, canvasEl.width, canvasEl.height);
    singleRenderMs = singleRenderMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  if (offscreenMode && worker && ts - lastPing > 500) {
    lastPing = ts;
    worker.postMessage({ type: 'ping', t: performance.now() });
  }

  if (ts - mainWindowStart > 500) {
    updateStats(ts);
    mainFrames = 0;
    mainWindowStart = ts;
    mainMaxGap = 0;
  }
  requestAnimationFrame(loop);
}

let singleRenderMs = 0;
function updateStats() {
  const mainFps = mainFrames * 1000 / Math.max(1, performance.now() - mainWindowStart);
  statMain.textContent = `主线程帧率: ${mainFps.toFixed(0)} fps (主线程最大帧间隔 ${mainMaxGap.toFixed(1)}ms)`;
  if (offscreenMode) {
    statRender.textContent = workerStats
      ? `Worker 渲染: ${workerStats.renderMs.toFixed(2)}ms/帧, ${workerStats.fps.toFixed(0)} fps`
      : 'Worker 渲染: --';
    statRender.className = 'ok';
  } else {
    statRender.textContent = `主线程渲染: ${singleRenderMs.toFixed(2)}ms/帧`;
    statRender.className = 'warn';
  }
  statMsg.textContent = offscreenMode
    ? `Worker 消息往返: ${lastRtt == null ? '--' : lastRtt.toFixed(2) + 'ms'}`
    : 'Worker 消息往返: 单线程模式无 Worker';
  if (blockResult) {
    statBlock.textContent = blockResult.mode
      ? `阻塞 ${blockResult.blockedMs.toFixed(0)}ms: 主线程卡顿 ${blockResult.mainGap.toFixed(1)}ms，Worker 帧间隔 ${blockResult.workerMaxGap == null ? '…' : blockResult.workerMaxGap.toFixed(1) + 'ms'}，画面未冻结`
      : `阻塞 ${blockResult.blockedMs.toFixed(0)}ms: 主线程卡顿 ${blockResult.mainGap.toFixed(1)}ms，期间无帧产出，画面冻结`;
    statBlock.className = blockResult.mode ? 'ok' : 'warn';
  } else {
    statBlock.textContent = '阻塞影响: 点击“阻塞主线程 50ms”测试';
    statBlock.className = '';
  }
}

// ---- 启动 ----
startOffscreen();
requestAnimationFrame(loop);
