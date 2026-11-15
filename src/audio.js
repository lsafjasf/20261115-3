// Web Audio：随水位变化的滤波水噪声、事件提示音与语音广播。

export class FloodAudio {
  constructor() {
    this.ctx = null;
    this.waterGain = null;
    this.filter = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    // 循环棕色噪声模拟水流
    const len = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0.04;
    src.connect(this.filter).connect(this.waterGain).connect(this.ctx.destination);
    src.start();
  }

  setWater(level, maxLevel) {
    if (!this.ctx || this.muted) return;
    const p = Math.min(1, level / maxLevel);
    this.waterGain.gain.setTargetAtTime(0.03 + p * 0.16, this.ctx.currentTime, 0.3);
    this.filter.frequency.setTargetAtTime(350 + p * 1400, this.ctx.currentTime, 0.3);
  }

  blip(freq = 660, duration = 0.12, type = 'sine', vol = 0.12) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  alert() { this.blip(880, 0.18, 'square', 0.08); setTimeout(() => this.blip(880, 0.18, 'square', 0.08), 220); }
  success() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'triangle', 0.1), i * 140)); }
  fail() { [400, 300, 200].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'sawtooth', 0.08), i * 160)); }

  announce(text) {
    if (this.muted || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.waterGain) this.waterGain.gain.value = this.muted ? 0 : 0.05;
    return this.muted;
  }
}
