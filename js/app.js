// 应用主控：持有单一状态对象（模式切换不触碰坐标），串联画布、实时播放、参数面板与导出。

import { makeState, withMode, computeSpatialModel, MODES } from './engine.js';
import { SpatialCanvas } from './canvas.js';
import { SpatialPlayer } from './player.js';
import { renderToWav } from './renderer.js';

const state = makeState();
const player = new SpatialPlayer();
let canvas;

const $ = (id) => document.getElementById(id);

function currentModel() {
  return computeSpatialModel(state);
}

function refresh() {
  const model = currentModel();
  canvas.setState(state);
  renderParams(model);
  player.update(model);
}

function setMode(mode) {
  const before = { ...state.source };
  const next = withMode(state, mode);
  state.mode = next.mode; // 只改 mode，source/listener/room 引用与值完全不动
  const after = { ...state.source };
  const preserved = before.x === after.x && before.y === after.y;
  $('persistStatus').textContent = preserved
    ? `坐标保持：(${before.x}, ${before.y}) → (${after.x}, ${after.y})`
    : '警告：声源坐标发生变化';
  $('persistStatus').className = preserved ? 'ok' : 'bad';
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  refresh();
}

function renderParams(model) {
  const d = model.direct;
  $('coordBox').innerHTML = `
    <tr><td>声源 S</td><td>(${model.source.x.toFixed(2)}, ${model.source.y.toFixed(2)}) m</td></tr>
    <tr><td>监听器 L</td><td>(${model.listener.x.toFixed(2)}, ${model.listener.y.toFixed(2)}) m, 朝向 ${(model.listener.angle * 180 / Math.PI).toFixed(0)}°</td></tr>
    <tr><td>房间</td><td>${model.room.width.toFixed(1)} × ${model.room.height.toFixed(1)} m</td></tr>
    <tr><td>模式</td><td>${model.modeLabel}（${model.channels} 声道）</td></tr>`;

  $('acousticBox').innerHTML = `
    <tr><td>直达距离</td><td>${d.distance.toFixed(3)} m</td></tr>
    <tr><td>传播延迟</td><td>${d.delayMs.toFixed(3)} ms</td></tr>
    <tr><td>距离增益</td><td>${d.distanceGain.toFixed(4)}</td></tr>
    <tr><td>空气吸收低通</td><td>${d.lowpassHz} Hz</td></tr>
    <tr><td>低/中/高频增益</td><td>${d.bandGains.low} / ${d.bandGains.mid} / ${d.bandGains.high}</td></tr>
    <tr><td>墙面距离(m)</td><td>左 ${model.wallDistances.left} 右 ${model.wallDistances.right} 上 ${model.wallDistances.top} 下 ${model.wallDistances.bottom}</td></tr>`;

  $('channelBox').innerHTML = model.channelSummaries.map((c) => `
    <tr><td>${c.name}</td><td>${c.totalGain.toFixed(4)}</td>
    <td>${c.minDelayMs.toFixed(3)} ms</td><td>${c.minLowpassHz} Hz</td></tr>`).join('');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFiles() {
  const model = currentModel();
  const signalType = $('signalType').value;
  const result = renderToWav(model, { durationSec: Number($('duration').value), signalType });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `spatial_${model.mode}_${stamp}`;
  download(new Blob([result.wav], { type: 'audio/wav' }), `${base}.wav`);

  const payload = buildJson(model, { signalType, durationSec: Number($('duration').value), result });
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${base}.json`);
  $('exportStatus').textContent = `已导出 ${base}.wav（${model.channels} 声道）与 ${base}.json`;
}

function buildJson(model, opts) {
  return {
    schemaVersion: 1,
    exportedAt: model.generatedAt,
    mode: model.mode,
    modeLabel: model.modeLabel,
    channels: model.channels,
    sampleRate: opts.result.sampleRate,
    signal: { type: opts.signalType, durationSec: opts.durationSec },
    geometry: {
      room: model.room,
      listener: model.listener,
      source: model.source,
      wallDistances: model.wallDistances,
    },
    options: model.options,
    direct: model.direct,
    reflections: model.reflections,
    channelSummaries: model.channelSummaries,
  };
}

function bindControls() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('playBtn').addEventListener('click', () => {
    player.start(currentModel(), $('signalType').value);
    $('playBtn').textContent = '播放中（再次点击重启）';
  });
  $('stopBtn').addEventListener('click', () => {
    player.stop();
    $('playBtn').textContent = '实时播放';
  });
  $('exportBtn').addEventListener('click', exportFiles);
  $('angleRange').addEventListener('input', (e) => {
    state.listener.angle = Number(e.target.value) * Math.PI / 180;
    refresh();
  });
  $('rolloffRange').addEventListener('input', (e) => {
    state.options.rolloff = Number(e.target.value);
    refresh();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  canvas = new SpatialCanvas($('stage'), state, refresh);
  bindControls();
  setMode('stereo');
});

// 暴露给页面内自检与控制台使用
export { state, currentModel, setMode };
export const modes = MODES;
