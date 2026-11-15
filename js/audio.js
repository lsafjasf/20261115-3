/* Web Audio：风声随风速变化，发电机运转时叠加低频轰鸣。 */
(function () {
  'use strict';
  let ctx = null, windGain, windFilter, genOsc, genGain, started = false;

  function init() {
    if (started) return;
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // 风：循环噪声 → 带通滤波 → 增益
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 300;
    windFilter.Q.value = 0.8;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(windFilter).connect(windGain).connect(ctx.destination);
    src.start();

    // 发电机轰鸣
    genOsc = ctx.createOscillator();
    genOsc.type = 'sawtooth';
    genOsc.frequency.value = 55;
    genGain = ctx.createGain();
    genGain.gain.value = 0;
    genOsc.connect(genGain).connect(ctx.destination);
    genOsc.start();
  }

  window.CampAudio = {
    start() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    update(sim) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      const gust = 1 + 0.25 * Math.sin(t * 1.7) * sim.blizzard;
      const freq = 180 + sim.wind * 14 * gust;
      const vol = Math.min(0.5, 0.02 + sim.wind * 0.008) * gust;
      windFilter.frequency.setTargetAtTime(freq, t, 0.15);
      windGain.gain.setTargetAtTime(vol, t, 0.2);
      const genOn = sim.gen.state === 'ONLINE';
      genGain.gain.setTargetAtTime(genOn ? 0.05 : 0, t, 0.3);
      if (genOsc) genOsc.frequency.setTargetAtTime(genOn && sim.gen.loadConnected ? 62 : 55, t, 0.4);
    }
  };
})();
