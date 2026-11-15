export class DeepAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.tensionGain = null;
    this.tensionOsc = null;
    this.ambientGain = null;
    this.muted = false;
    this.lastWarning = -1;
  }

  ensureStarted() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.82;
    this.master.connect(this.ctx.destination);

    const ambient = this.ctx.createOscillator();
    ambient.type = "triangle";
    ambient.frequency.value = 49;
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.055;
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 135;
    ambient.connect(lowpass).connect(this.ambientGain).connect(this.master);
    ambient.start();

    const currentNoise = this.ctx.createBufferSource();
    currentNoise.buffer = this.makeNoiseBuffer();
    currentNoise.loop = true;
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 260;
    band.Q.value = 0.45;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.018;
    currentNoise.connect(band).connect(noiseGain).connect(this.master);
    currentNoise.start();

    this.tensionOsc = this.ctx.createOscillator();
    this.tensionOsc.type = "sine";
    this.tensionOsc.frequency.value = 112;
    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0.04;
    const tensionFilter = this.ctx.createBiquadFilter();
    tensionFilter.type = "bandpass";
    tensionFilter.frequency.value = 380;
    tensionFilter.Q.value = 1.5;
    this.tensionOsc.connect(tensionFilter).connect(this.tensionGain).connect(this.master);
    this.tensionOsc.start();
  }

  makeNoiseBuffer() {
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      channel[i] = (seed / 2147483648 - 1) * 0.72;
    }
    return buffer;
  }

  update(tension, status) {
    if (!this.ctx || !this.tensionGain || !this.tensionOsc) return;
    const active = status === "playing";
    const pressure = Math.max(0, Math.min(1.8, tension));
    const now = this.ctx.currentTime;
    this.tensionOsc.frequency.setTargetAtTime(108 + pressure * 168, now, 0.08);
    this.tensionGain.gain.setTargetAtTime(active ? 0.025 + pressure * 0.028 : 0.014, now, 0.12);
    this.ambientGain.gain.setTargetAtTime(active ? 0.055 : 0.036, now, 0.15);

    const warningBucket = pressure > 1.46 ? Math.floor(pressure * 10) : -1;
    if (warningBucket !== this.lastWarning && warningBucket >= 0) {
      this.tone(680, 0.12, "square", 0.045);
      this.lastWarning = warningBucket;
    } else if (warningBucket < 0) {
      this.lastWarning = -1;
    }
  }

  tone(frequency, duration, type = "sine", volume = 0.07, delay = 0) {
    if (!this.ctx || this.muted) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.62), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  noiseBurst(duration = 0.18, volume = 0.06) {
    if (!this.ctx || this.muted) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.makeNoiseBuffer();
    source.playbackRate.value = 0.7;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    const gain = this.ctx.createGain();
    const start = this.ctx.currentTime;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  event(type) {
    if (!this.ctx || this.muted) return;
    if (type === "tool") {
      this.tone(440, 0.07, "triangle", 0.045);
    } else if (type === "repair-start") {
      this.tone(220, 0.16, "sawtooth", 0.026);
    } else if (type === "repair-done") {
      this.tone(330, 0.18, "sine", 0.075);
      this.tone(495, 0.24, "sine", 0.055, 0.12);
      this.tone(660, 0.3, "sine", 0.04, 0.25);
    } else if (type === "collision") {
      this.noiseBurst(0.23, 0.095);
      this.tone(88, 0.18, "square", 0.03);
    } else if (type === "failure") {
      this.tone(185, 0.55, "sawtooth", 0.065);
      this.tone(96, 0.75, "square", 0.03, 0.18);
    } else if (type === "success") {
      [392, 523, 659, 784].forEach((note, index) => this.tone(note, 0.45, "sine", 0.05, index * 0.15));
    } else if (type === "warning") {
      this.tone(520, 0.1, "square", 0.035);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.82, this.ctx.currentTime, 0.1);
    }
  }
}
