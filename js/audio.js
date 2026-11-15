/* Web Audio：风速驱动的风声 + 事件告警 */
(function (root) {
  'use strict';

  class WindAudio {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.lastAlarm = 0;
    }

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        data[i] = brown * 3.5;
      }
      this.noise = this.ctx.createBufferSource();
      this.noise.buffer = buffer;
      this.noise.loop = true;
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 320;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.04;
      this.noise.connect(this.filter).connect(this.gain).connect(this.ctx.destination);
      this.noise.start();
      this.enabled = true;
    }

    resume() {
      this.init();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // 风速越大，滤波截止频率与音量越高
    update(snap) {
      if (!this.enabled || !this.ctx) return;
      const t = this.ctx.currentTime;
      const cut = 220 + snap.v * 55;
      this.filter.frequency.setTargetAtTime(Math.min(2400, cut), t, 0.15);
      const g = 0.03 + Math.min(0.16, snap.v * 0.008);
      this.gain.gain.setTargetAtTime(g, t, 0.2);
      const now = performance.now();
      if (now - this.lastAlarm < 2600) return;
      if (snap.blackoutMw > 0.001) { this.beep(880, 0.35, 'square', 0.12); this.lastAlarm = now; }
      else if (snap.temp > 65) { this.beep(660, 0.3, 'sawtooth', 0.1); this.lastAlarm = now; }
      else if (snap.trip > 0) { this.beep(440, 0.25, 'triangle', 0.1); this.lastAlarm = now; }
    }

    beep(freq, dur, type, vol) {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.1, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    }

    fanfare(success) {
      if (!this.enabled) return;
      const notes = success ? [523, 659, 784] : [392, 311, 233];
      notes.forEach((f, i) => setTimeout(() => this.beep(f, 0.4, 'triangle', 0.12), i * 320));
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.ctx) this.gain.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 0.1);
    }
  }

  root.WindAudio = WindAudio;
})(window);
