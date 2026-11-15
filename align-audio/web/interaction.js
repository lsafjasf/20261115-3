'use strict';

const slider = document.getElementById('lagSlider');
let dragging = false;

function lagFromEvent(ev) {
  const rect = wave.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const maxAbs = Math.max(+slider.max, 1);
  const norm = (x - rect.width / 2) / (rect.width / 2 - 12);
  return Math.round(norm * maxAbs);
}

wave.addEventListener('mousedown', ev => {
  if (!App.a) return;
  dragging = true;
  setLag(lagFromEvent(ev));
});
window.addEventListener('mousemove', ev => { if (dragging) setLag(lagFromEvent(ev)); });
window.addEventListener('mouseup', () => { dragging = false; });
wave.addEventListener('dblclick', () => setLag(0));
wave.addEventListener('wheel', ev => {
  if (!App.a) return;
  ev.preventDefault();
  setLag(App.lag + (ev.deltaY > 0 ? 1 : -1));
}, { passive: false });

slider.addEventListener('input', () => { App.lag = +slider.value; renderAll(); });
document.querySelectorAll('.steppers button').forEach(btn => {
  btn.addEventListener('click', () => setLag(App.lag + +btn.dataset.step));
});
document.getElementById('polarity').addEventListener('change', ev => {
  App.polarity = ev.target.checked ? -1 : 1;
  renderAll();
});

document.getElementById('demoBtn').addEventListener('click', loadDemo);
document.getElementById('fileA').addEventListener('change', e => loadFile(e.target, 'a'));
document.getElementById('fileB').addEventListener('change', e => loadFile(e.target, 'b'));

document.getElementById('autoBtn').addEventListener('click', () => {
  if (!App.a || !App.b) return;
  const maxL = Math.min(2400, Math.floor(App.a.length / 4));
  const r = window.AlignMetrics.findBestLag(App.a, App.b, maxL);
  App.autoLag = r.bestLag;
  App.autoPolarity = r.polarity;
  App.polarity = r.polarity;
  document.getElementById('polarity').checked = r.polarity === -1;
  setLag(r.bestLag);
});

document.getElementById('exportBtn').addEventListener('click', exportMix);

let activeSource = null;
function stopPlayback() {
  if (activeSource) { try { activeSource.stop(); } catch (_) {} activeSource = null; }
}

function playBuffer(buffer) {
  stopPlayback();
  if (!App.audioCtx) App.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = App.audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(App.audioCtx.destination);
  src.start();
  activeSource = src;
}

function makeBuffer(sig) {
  const buf = App.audioCtx.createBuffer(1, sig.length, App.sr);
  buf.copyToChannel(Float32Array.from(sig), 0);
  return buf;
}

function playMode(mode) {
  if (!App.a || !App.b) return;
  if (!App.audioCtx) App.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const al = window.AlignMetrics.align(App.a, App.b, App.lag, App.polarity);
  let out;
  if (mode === 'sum') {
    out = new Float64Array(al.len);
    for (let i = 0; i < al.len; i++) out[i] = (al.a[i] + al.b[i]) * 0.5;
  } else if (mode === 'diff') {
    out = new Float64Array(al.len);
    for (let i = 0; i < al.len; i++) out[i] = (al.a[i] - al.b[i]) * 0.5;
  } else if (mode === 'a') {
    out = al.a;
  } else {
    out = al.b;
  }
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
  if (pk > 0.98) for (let i = 0; i < out.length; i++) out[i] *= 0.98 / pk;
  playBuffer(makeBuffer(out));
}

document.getElementById('playSum').addEventListener('click', () => playMode('sum'));
document.getElementById('playDiff').addEventListener('click', () => playMode('diff'));
document.getElementById('playA').addEventListener('click', () => playMode('a'));
document.getElementById('playB').addEventListener('click', () => playMode('b'));
document.getElementById('stopBtn').addEventListener('click', stopPlayback);
window.addEventListener('resize', () => { if (App.a) renderAll(); });
renderAll();
