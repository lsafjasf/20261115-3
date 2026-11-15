import { AudioEngine, activeNodeCount } from './audio-engine.js';

const engine = new AudioEngine();
const els = {
  nodeCount: document.getElementById('nodeCount'),
  ctxState: document.getElementById('ctxState'),
  sceneName: document.getElementById('sceneName'),
  rebuildCount: document.getElementById('rebuildCount'),
  pauseBtn: document.getElementById('pauseBtn'),
  rebuildBtn: document.getElementById('rebuildBtn'),
  stopBtn: document.getElementById('stopBtn'),
  scenePanel: document.getElementById('scenePanel'),
  log: document.getElementById('log'),
};

function log(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  els.log.textContent += `[${time}] ${message}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function refresh() {
  els.nodeCount.textContent = String(activeNodeCount());
  els.ctxState.textContent = engine.context ? engine.context.state : '-';
  els.sceneName.textContent = engine.scene ? engine.scene.name : '-';
  els.rebuildCount.textContent = String(engine.rebuildCount);
  els.pauseBtn.textContent =
    engine.context && engine.context.state === 'suspended' ? '继续' : '暂停';
  for (const btn of els.scenePanel.querySelectorAll('button.scene')) {
    btn.classList.toggle(
      'active',
      !!engine.scene && btn.dataset.scene === engine.scene.name
    );
  }
}

engine.onStateChange = refresh;

els.scenePanel.addEventListener('click', (event) => {
  const btn = event.target.closest('button.scene');
  if (!btn) return;
  const before = activeNodeCount();
  engine.switchTo(btn.dataset.scene);
  log(`切换到 ${btn.dataset.scene}:节点 ${before} -> ${activeNodeCount()}`);
  refresh();
});

els.pauseBtn.addEventListener('click', async () => {
  if (engine.context && engine.context.state === 'suspended') {
    await engine.resume();
    log('继续播放');
  } else {
    await engine.pause();
    log('已暂停');
  }
  refresh();
});

els.rebuildBtn.addEventListener('click', () => {
  const before = activeNodeCount();
  engine.rebuild();
  log(`重建声场:节点 ${before} -> ${activeNodeCount()}`);
  refresh();
});

els.stopBtn.addEventListener('click', () => {
  const before = activeNodeCount();
  engine.stopScene();
  log(`停止:节点 ${before} -> ${activeNodeCount()}`);
  refresh();
});

window.addEventListener('pagehide', () => engine.destroy());

refresh();

// 暴露给自动化测试
window.__engine = engine;
window.__activeNodeCount = activeNodeCount;
