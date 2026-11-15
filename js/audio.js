/* Web Audio: wind noise follows network pressure; alarms beep while active. */
(function (root) {
  'use strict';

  function MineAudio() {
    this.ctx = null;
    this.muted = false;
  }

  MineAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    var length = this.ctx.sampleRate * 2;
    var buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 480;
    this.filter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.noise.connect(this.filter).connect(this.windGain).connect(this.ctx.destination);
    this.noise.start();
  };

  MineAudio.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (this.windGain && this.ctx) {
      this.windGain.gain.setTargetAtTime(muted ? 0 : this._wind || 0,
        this.ctx.currentTime, 0.1);
    }
  };

  MineAudio.prototype.update = function (sim) {
    if (!this.ctx || this.muted) return;
    var pressure = Math.abs(sim.nodeById.OUT.p - sim.nodeById.IN.p);
    var flow = 0;
    sim.edges.forEach(function (e) { flow += Math.abs(e.flow); });
    var level = sim.fans.main.on ? Math.min(0.14, 0.012 + pressure * 0.0011) : 0.004;
    this._wind = level;
    this.windGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.15);
    this.filter.frequency.setTargetAtTime(380 + flow * 12, this.ctx.currentTime, 0.2);
    this.beep(sim.alarms.shortCircuit ? 300 : 660,
      sim.alarms.shortCircuit || sim.alarms.list.length > 0);
  };

  MineAudio.prototype.beep = function (freq, active) {
    var now = this.ctx.currentTime;
    if (active && (!this._lastBeep || now - this._lastBeep > 0.9)) {
      this._lastBeep = now;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    }
    if (!active) this._lastBeep = 0;
  };

  MineAudio.prototype.click = function () {
    this.ensure();
    if (this.muted) return;
    var now = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  };

  root.MineAudio = MineAudio;
})(window);
