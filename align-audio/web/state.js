'use strict';

const App = {
  sr: 48000,
  a: null,
  b: null,
  lag: 0,
  polarity: 1,
  autoLag: null,
  autoPolarity: 1,
  maxLag: 2400,
  audioCtx: null,
};

const M = () => window.AlignMetrics;

function buildDemoSource(sr, seconds, seed) {
  const n = Math.floor(sr * seconds);
  const x = new Float64Array(n);
  let s = seed >>> 0;
  const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 2);
    const harmonic = 0.55 * Math.sin(2 * Math.PI * 220 * t) +
      0.28 * Math.sin(2 * Math.PI * 440 * t + 0.6) +
      0.14 * Math.sin(2 * Math.PI * 660 * t + 1.3) +
      0.08 * Math.sin(2 * Math.PI * 880 * t);
    const sweep = 0.18 * Math.sin(2 * Math.PI * (180 + 260 * t / seconds) * t);
    x[i] = env * (harmonic + sweep + (rand() - 0.5) * 0.05);
  }
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < n; i++) x[i] *= 0.9 / pk;
  return x;
}

function delayed(src, delay, gainDb) {
  const g = Math.pow(10, gainDb / 20);
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (i >= delay ? src[i - delay] : 0) * g;
  return out;
}

function loadDemo() {
  const sr = 48000;
  const src = buildDemoSource(sr, 4, 20261115);
  App.sr = sr;
  App.a = src;
  App.b = delayed(src, 317, -0.7);
  App.lag = 0; App.polarity = 1; App.autoLag = null;
  document.getElementById('lagSlider').max = 2400;
  document.getElementById('lagSlider').min = -2400;
  document.getElementById('loadInfo').textContent =
    '已载入内置示例：48 kHz，每轨 192000 采样；真值延迟 317 采样 = 6.604 ms（B 增益 -0.7 dB）';
  onDataChanged();
}

async function loadFile(inputEl, which) {
  const file = inputEl.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  const wav = M().decodeWav(buf);
  App.sr = wav.sampleRate;
  App[which] = wav.channels[0];
  if (App.a && App.b) {
    App.lag = 0; App.polarity = 1; App.autoLag = null;
    const maxL = Math.min(2400, Math.floor(App.a.length / 4));
    const slider = document.getElementById('lagSlider');
    slider.max = maxL; slider.min = -maxL;
    document.getElementById('loadInfo').textContent =
      `已载入 A/B：${wav.sampleRate} Hz，A=${App.a.length} 采样，B=${App.b.length} 采样`;
    onDataChanged();
  }
}

function currentMetrics() {
  if (!App.a || !App.b) return null;
  return M().evaluate(App.a, App.b, App.lag, App.polarity);
}

function setLag(lag) {
  const slider = document.getElementById('lagSlider');
  App.lag = Math.max(+slider.min, Math.min(+slider.max, Math.round(lag)));
  slider.value = App.lag;
  renderAll();
}

function exportMix() {
  if (!App.a || !App.b) return;
  const al = M().align(App.a, App.b, App.lag, App.polarity);
  const n = al.len;
  const sum = new Float64Array(n), diff = new Float64Array(n);
  let pk = 0;
  for (let i = 0; i < n; i++) { sum[i] = (al.a[i] + al.b[i]) * 0.5; pk = Math.max(pk, Math.abs(sum[i])); }
  const norm = pk > 0 ? 0.95 / pk : 1;
  const stereo = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) {
    sum[i] *= norm;
    diff[i] = (al.a[i] - al.b[i]) * 0.5 * norm;
    stereo[0][i] = al.a[i] * norm;
    stereo[1][i] = al.b[i] * norm;
  }
  const meta = {
    sampleRate: App.sr,
    delaySamples: App.lag,
    delayMs: +(App.lag / App.sr * 1000).toFixed(4),
    polarity: App.polarity === -1 ? 'inverted' : 'normal',
    savedAt: new Date().toISOString(),
  };
  const blob = M().encodeWav([sum], App.sr);
  const url = URL.createObjectURL(blob);
  const aTag = document.createElement('a');
  aTag.href = url;
  aTag.download = 'aligned_sum.wav';
  aTag.click();
  URL.revokeObjectURL(url);
  const blobS = M().encodeWav(stereo, App.sr);
  const urlS = URL.createObjectURL(blobS);
  const a2 = document.createElement('a');
  a2.href = urlS; a2.download = 'aligned_stereo.wav'; a2.click();
  URL.revokeObjectURL(urlS);
  document.getElementById('exportInfo').textContent =
    `已保存延迟值 ${meta.delaySamples} 采样（${meta.delayMs} ms，极性 ${meta.polarity}），并导出 aligned_sum.wav 与 aligned_stereo.wav`;
}

window.App = App;
window.loadDemo = loadDemo;
window.loadFile = loadFile;
window.currentMetrics = currentMetrics;
window.setLag = setLag;
window.exportMix = exportMix;
