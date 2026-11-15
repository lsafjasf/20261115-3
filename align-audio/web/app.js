'use strict';

const wave = document.getElementById('wave');
const corrPlot = document.getElementById('corrPlot');
const wctx = wave.getContext('2d');
const cctx = corrPlot.getContext('2d');

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  cv.width = w * dpr;
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return w;
}

function drawTrack(ctx, sig, top, h, color) {
  const w = ctx.canvas.clientWidth;
  const mid = top + h / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(sig.length / w));
  for (let x = 0; x < w; x++) {
    let mn = 1, mx = -1;
    const base = x * step;
    for (let i = 0; i < step && base + i < sig.length; i++) {
      const v = sig[base + i];
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    ctx.moveTo(x + 0.5, mid - mx * h * 0.45);
    ctx.lineTo(x + 0.5, mid - mn * h * 0.45);
  }
  ctx.stroke();
  ctx.strokeStyle = '#2a3856';
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
}

function drawWave() {
  const w = fitCanvas(wave);
  wctx.clearRect(0, 0, w, wave.height);
  if (!App.a || !App.b) {
    wctx.fillStyle = '#5f7093';
    wctx.fillText('载入音频后在此显示双轨波形', 16, 30);
    return;
  }
  drawTrack(wctx, App.a, 8, 110, '#6ea8ff');
  drawTrack(wctx, App.b, 132, 110, '#7fd1a3');
  wctx.fillStyle = '#8ea0bd';
  wctx.font = '11px sans-serif';
  wctx.fillText('A', 8, 20);
  wctx.fillText('B', 8, 144);
  const maxAbs = Math.max(+document.getElementById('lagSlider').max, 1);
  const x = w / 2 + (App.lag / maxAbs) * (w / 2 - 12);
  wctx.strokeStyle = '#ffd166';
  wctx.lineWidth = 2;
  wctx.setLineDash([6, 4]);
  wctx.beginPath(); wctx.moveTo(x, 6); wctx.lineTo(x, wave.height - 6); wctx.stroke();
  wctx.setLineDash([]);
  wctx.fillStyle = '#ffd166';
  wctx.fillText('相位标记 lag=' + App.lag, Math.min(x + 6, w - 150), 18);
  if (App.autoLag !== null) {
    const xa = w / 2 + (App.autoLag / maxAbs) * (w / 2 - 12);
    wctx.fillStyle = '#4ade80';
    wctx.beginPath(); wctx.arc(xa, wave.height - 14, 4, 0, Math.PI * 2); wctx.fill();
  }
}

function drawCorr() {
  const w = fitCanvas(corrPlot);
  cctx.clearRect(0, 0, w, corrPlot.height);
  if (!App.a || !App.b) return;
  const win = Math.min(App.maxLag, Math.floor(App.a.length / 4));
  const D = window.AlignDSP;
  const raw = D.fullCrossCorrelation(App.a, App.b);
  const vals = [];
  for (let lag = -win; lag <= win; lag++) vals.push(raw[(App.b.length - 1) - lag]);
  const mid = corrPlot.height / 2;
  const maxV = Math.max(...vals.map(Math.abs), 1e-9);
  cctx.strokeStyle = '#6ea8ff';
  cctx.lineWidth = 1.2;
  cctx.beginPath();
  vals.forEach((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = mid - (v / maxV) * (mid - 10);
    i ? cctx.lineTo(x, y) : cctx.moveTo(x, y);
  });
  cctx.stroke();
  const xm = w / 2 + (App.lag / win) * (w / 2);
  cctx.strokeStyle = '#ffd166';
  cctx.setLineDash([5, 4]);
  cctx.beginPath(); cctx.moveTo(xm, 4); cctx.lineTo(xm, corrPlot.height - 4); cctx.stroke();
  cctx.setLineDash([]);
  if (App.autoLag !== null) {
    const xa = w / 2 + (App.autoLag / win) * (w / 2);
    cctx.fillStyle = '#4ade80';
    cctx.beginPath(); cctx.arc(xa, 12, 4, 0, Math.PI * 2); cctx.fill();
  }
  cctx.fillStyle = '#5f7093';
  cctx.font = '10px sans-serif';
  cctx.fillText('-' + win + ' 采样', 4, corrPlot.height - 4);
  cctx.fillText('+' + win, w - 52, corrPlot.height - 4);
}

function renderMetrics() {
  const m = currentMetrics();
  if (!m) return;
  document.getElementById('mLag').textContent =
    `${App.lag} 采样 / ${(App.lag / App.sr * 1000).toFixed(3)} ms`;
  document.getElementById('mCorr').textContent = m.correlation.toFixed(5);
  document.getElementById('mCancel').textContent = m.cancelDepthDb.toFixed(2) + ' dB';
  document.getElementById('mPeakSum').textContent = m.peakSum.toFixed(5);
  document.getElementById('mPeakDiff').textContent = m.peakDiff.toFixed(5);
  document.getElementById('mOverlap').textContent = m.overlapFrames + ' 采样';
}

function renderAll() {
  renderMetrics();
  drawWave();
  drawCorr();
}

function onDataChanged() { renderAll(); }
window.onDataChanged = onDataChanged;
window.renderAll = renderAll;
