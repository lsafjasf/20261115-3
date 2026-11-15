import { SfxEngine } from './src/engine.js';
import { PRESETS, PRESET_ORDER } from './src/presets.js';
import { encodeWav, concatenateBuffers } from './src/wav.js';

let engine = null;
const nodeCountEl = document.getElementById('nodeCount');
const savedListEl = document.getElementById('savedList');

function ensureEngine() {
  if (!engine) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    engine = new SfxEngine(ctx, window.localStorage);
  }
  if (engine.ctx.state === 'suspended') engine.ctx.resume();
  return engine;
}

function refreshNodeCount() {
  nodeCountEl.textContent = engine ? engine.activeNodeCount : 0;
}

function refreshSavedList() {
  const all = engine ? engine.loadAllChains() : JSON.parse(localStorage.getItem('sfx-chains') || '{}');
  const names = Object.keys(all);
  savedListEl.textContent = names.length
    ? names.map((n) => `${n}: ${all[n].modules.length} 个模块`).join('\n')
    : '（暂无）';
}

const cardsEl = document.getElementById('cards');
for (const name of PRESET_ORDER) {
  const def = PRESETS[name];
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>${def.label} <small>${name}</small></h2>
    <p>${def.modules.map((m) => m.type).join(' → ')}</p>
    <button data-act="play">播放</button>
    <button data-act="save">保存模块链</button>
  `;
  card.querySelector('[data-act=play]').addEventListener('click', () => {
    const eng = ensureEngine();
    eng.play(name, def); // 切换时自动停止并销毁旧链
    refreshNodeCount();
    setTimeout(refreshNodeCount, (def.duration + 0.3) * 1000);
  });
  card.querySelector('[data-act=save]').addEventListener('click', () => {
    const eng = ensureEngine();
    eng.saveChain(name, def);
    refreshSavedList();
  });
  cardsEl.appendChild(card);
}

document.getElementById('stopAll').addEventListener('click', () => {
  if (engine) engine.stop();
  refreshNodeCount();
});

document.getElementById('exportMix').addEventListener('click', async () => {
  const SR = 44100;
  const buffers = [];
  for (const name of PRESET_ORDER) {
    const def = PRESETS[name];
    const off = new OfflineAudioContext(1, Math.ceil((def.duration + 0.3) * SR), SR);
    const offEngine = new SfxEngine(off);
    offEngine.play(name, def, 0);
    buffers.push(await off.startRendering());
    offEngine.stop();
  }
  const mixCtx = new OfflineAudioContext(1, SR, SR);
  const wav = encodeWav(concatenateBuffers(mixCtx, buffers, 0.2));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  a.download = 'mix.wav';
  a.click();
  URL.revokeObjectURL(a.href);
});

refreshSavedList();
