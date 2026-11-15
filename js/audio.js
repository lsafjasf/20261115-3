import { clamp } from "./config.js";

export class IceAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.trackGain = null;
    this.stressOsc = null;
    this.stressOsc2 = null;
    this.stressGain = null;
    this.windGain = null;
    this.started = false;
    this.muted = false;
  }

  async start() {
    if (this.started) {
      await this.ctx?.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.started = true;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.42;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this._makeNoise(2.2);
    this._buildWind();
    this._buildEngine();
    this._buildIceDrone();
    await this.ctx.resume();
  }

  _makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.018 * white) / 1.018;
      data[i] = white * 0.55 + brown * 2.2;
    }
    return buffer;
  }

  _makeNoiseSource() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }

  _buildWind() {
    const source = this._makeNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 470;
    filter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.038;
    source.connect(filter).connect(this.windGain).connect(this.master);
    source.start();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.083;
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    lfo.start();
  }

  _buildEngine() {
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 32;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 180;
    engineFilter.Q.value = 2.6;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.002;
    this.engineOsc.connect(engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    const track = this._makeNoiseSource();
    const trackFilter = this.ctx.createBiquadFilter();
    trackFilter.type = "bandpass";
    trackFilter.frequency.value = 86;
    trackFilter.Q.value = 1.4;
    this.trackGain = this.ctx.createGain();
    this.trackGain.gain.value = 0;
    track.connect(trackFilter).connect(this.trackGain).connect(this.master);
    track.start();
  }

  _buildIceDrone() {
    this.stressGain = this.ctx.createGain();
    this.stressGain.gain.value = 0.001;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 310;
    filter.Q.value = 3.8;
    this.stressOsc = this.ctx.createOscillator();
    this.stressOsc.type = "triangle";
    this.stressOsc.frequency.value = 44;
    this.stressOsc2 = this.ctx.createOscillator();
    this.stressOsc2.type = "sine";
    this.stressOsc2.frequency.value = 69;
    this.stressOsc.connect(filter);
    this.stressOsc2.connect(filter);
    filter.connect(this.stressGain).connect(this.master);
    this.stressOsc.start();
    this.stressOsc2.start();
  }

  update(snapshot, onIce = true) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const speed = Math.abs(snapshot.vehicle.speed);
    const speedNorm = clamp(speed / 180, 0, 1);
    const stressNorm = onIce ? clamp(snapshot.localStress / 104, 0, 1) : 0;
    this.engineOsc.frequency.setTargetAtTime(29 + speedNorm * 48, now, 0.09);
    this.engineGain.gain.setTargetAtTime(0.004 + speedNorm * 0.024, now, 0.08);
    this.trackGain.gain.setTargetAtTime(speedNorm * 0.032, now, 0.07);
    const stressFrequency = 39 + stressNorm * 19;
    this.stressOsc.frequency.setTargetAtTime(stressFrequency, now, 0.18);
    this.stressOsc2.frequency.setTargetAtTime(stressFrequency * 1.58, now, 0.22);
    this.stressGain.gain.setTargetAtTime(0.001 + stressNorm * stressNorm * 0.055, now, 0.18);
  }

  crack(intensity = 0.5) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1250 + Math.random() * 900;
    filter.Q.value = 2.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04 + intensity * 0.11, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + intensity * 0.22);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.5);

    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(72, now);
    thump.frequency.exponentialRampToValueAtTime(29, now + 0.28);
    thumpGain.gain.setValueAtTime(0.08 + intensity * 0.08, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.36);
  }

  chime(kind = "pickup") {
    if (!this.ctx || this.muted) return;
    const notes = kind === "win" ? [392, 523.25, 659.25, 783.99] : kind === "safe" ? [329.63, 440, 554.37] : [523.25, 659.25];
    const now = this.ctx.currentTime;
    notes.forEach((frequency, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + index * 0.09;
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === "win" ? 0.055 : 0.035, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }

  alarm() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i += 1) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const start = now + i * 0.16;
      osc.type = "square";
      osc.frequency.value = 176;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.018, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.12);
    }
  }

  sink() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const source = this._makeNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(70, now + 1.8);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 2.3);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.42, this.ctx.currentTime, 0.05);
    }
  }
}
