/* UI controller: synthesis, live bypass, meters, spectrum, playback, export. */
(function () {
  'use strict';
  var R = window.AudioRepair;
  var W = window.AudioWav;

  var NODES = [
    { key: 'filter', label: '滤波 / 相位' },
    { key: 'deesser', label: '去齿音' },
    { key: 'gate', label: '门限' },
    { key: 'softclip', label: '软削波' }
  ];

  var state = {
    original: null,
    processed: null,
    bypass: { filter: false, deesser: false, gate: false, softclip: false },
    source: null,
    audioCtx: null
  };

  function $(id) { return document.getElementById(id); }

  function rebuild() {
    state.processed = R.runRepairChain(state.original, state.bypass);
    renderMeters();
    drawSpectrum();
  }

  function renderMeters() {
    var o = state.original, p = state.processed;
    $('origPeak').textContent = R.peakOf(o).toFixed(4);
    $('procPeak').textContent = R.peakOf(p).toFixed(4);
    $('origRms').textContent = R.rmsOf(o).toFixed(4);
    $('procRms').textContent = R.rmsOf(p).toFixed(4);
    $('origClips').textContent = R.countOver(o, 0.919).toLocaleString();
    $('procClips').textContent = R.countOver(p, 0.999).toLocaleString();
    $('origDur').textContent = (o.length / R.SAMPLE_RATE).toFixed(2) + ' s';
    $('procDur').textContent = (p.length / R.SAMPLE_RATE).toFixed(2) + ' s';
  }

  function drawSpectrum() {
    var canvas = $('spectrum');
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f1620';
    ctx.fillRect(0, 0, w, h);
    var minDb = -70, maxDb = -10;
    ctx.strokeStyle = '#22303f';
    ctx.fillStyle = '#5d7186';
    ctx.font = '10px monospace';
    for (var db = maxDb; db >= minDb; db -= 10) {
      var y = h * (1 - (db - minDb) / (maxDb - minDb));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(db + 'dB', 4, y - 2);
    }
    var labels = [100, 300, 1000, 3000, 10000];
    for (var li = 0; li < labels.length; li++) {
      var fx = freqToX(labels[li], w);
      ctx.fillText(labels[li] >= 1000 ? (labels[li] / 1000) + 'k' : labels[li], fx + 2, h - 4);
    }
    drawTrace(ctx, R.computeSpectrum(state.original), '#e06c5f', w, h, minDb, maxDb);
    drawTrace(ctx, R.computeSpectrum(state.processed), '#4cc2a5', w, h, minDb, maxDb);
  }

  function freqToX(freq, width) {
    var minF = 20, maxF = 20000;
    var lo = Math.log(minF), hi = Math.log(maxF);
    return width * (Math.log(freq) - lo) / (hi - lo);
  }

  function drawTrace(ctx, spec, color, w, h, minDb, maxDb) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < spec.freqs.length; i++) {
      if (spec.freqs[i] < 20 || spec.freqs[i] > 20000) continue;
      var x = freqToX(spec.freqs[i], w);
      var v = Math.max(minDb, Math.min(maxDb, spec.db[i]));
      var y = h * (1 - (v - minDb) / (maxDb - minDb));
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  function ensureCtx() {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return state.audioCtx;
  }

  function play(samples) {
    var ctx = ensureCtx();
    ctx.resume();
    if (state.source) {
      try { state.source.stop(); } catch (e) {}
      state.source = null;
    }
    var buffer = ctx.createBuffer(1, samples.length, R.SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    state.source = src;
  }

  function exportWav() {
    var blob = new Blob([W.encodeWav(state.processed, R.SAMPLE_RATE)],
      { type: 'audio/wav' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'repaired-10s.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function buildBypassButtons() {
    var bar = $('bypassBar');
    NODES.forEach(function (node) {
      var btn = document.createElement('button');
      btn.className = 'bypass on';
      btn.dataset.key = node.key;
      btn.textContent = node.label + '：启用';
      btn.addEventListener('click', function () {
        state.bypass[node.key] = !state.bypass[node.key];
        var bypassed = state.bypass[node.key];
        btn.classList.toggle('on', !bypassed);
        btn.classList.toggle('bypassed', bypassed);
        btn.textContent = node.label + '：' + (bypassed ? '旁路' : '启用');
        rebuild();
      });
      bar.appendChild(btn);
    });
  }

  function init() {
    state.original = R.synthesizeDamaged();
    buildBypassButtons();
    rebuild();
    $('playOrig').addEventListener('click', function () { play(state.original); });
    $('playProc').addEventListener('click', function () { play(state.processed); });
    $('repairAll').addEventListener('click', function () {
      NODES.forEach(function (node) {
        state.bypass[node.key] = false;
        var btn = document.querySelector('[data-key="' + node.key + '"]');
        btn.classList.add('on');
        btn.classList.remove('bypassed');
        btn.textContent = node.label + '：启用';
      });
      rebuild();
    });
    $('exportWav').addEventListener('click', exportWav);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
