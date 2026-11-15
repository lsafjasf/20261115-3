export class WarehouseAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.drone = null;
    this.pad = null;
    this.padFilter = null;
    this.noiseGain = null;
    this.enabled = false;
    this.density = 0;
    this.pulseTimer = null;
    this.lastDensity = -1;
  }

  create() {
    if (this.context) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    this.context = context;

    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    this.master = master;

    const drone = context.createOscillator();
    const droneGain = context.createGain();
    drone.type = "sine";
    drone.frequency.value = 48;
    droneGain.gain.value = 0.065;
    drone.connect(droneGain).connect(master);
    drone.start();
    this.drone = drone;

    const pad = context.createOscillator();
    const padFilter = context.createBiquadFilter();
    const padGain = context.createGain();
    pad.type = "triangle";
    pad.frequency.value = 92;
    padFilter.type = "lowpass";
    padFilter.frequency.value = 380;
    padFilter.Q.value = 2.5;
    padGain.gain.value = 0.022;
    pad.connect(padFilter).connect(padGain).connect(master);
    pad.start();
    this.pad = pad;
    this.padFilter = padFilter;

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * 0.36;
    }
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 760;
    noiseFilter.Q.value = 0.7;
    noiseGain.gain.value = 0.004;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start();
    this.noiseGain = noiseGain;
  }

  async toggle() {
    this.create();
    if (!this.context) return false;
    if (this.enabled) {
      this.enabled = false;
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      return false;
    }

    await this.context.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(0.34, this.context.currentTime, 0.28);
    this.setDensity(this.density, true);
    this.schedulePulse();
    return true;
  }

  setDensity(density, force = false) {
    this.density = Math.max(0, Math.min(1, density));
    if (!this.context || !this.enabled) return;
    if (!force && Math.abs(this.density - this.lastDensity) < 0.015) return;
    this.lastDensity = this.density;
    const now = this.context.currentTime;
    this.drone.frequency.setTargetAtTime(46 + this.density * 30, now, 0.45);
    this.pad.frequency.setTargetAtTime(88 + this.density * 42, now, 0.6);
    this.padFilter.frequency.setTargetAtTime(280 + this.density * 1450, now, 0.5);
    this.noiseGain.gain.setTargetAtTime(0.002 + this.density * 0.011, now, 0.7);
  }

  schedulePulse() {
    if (this.pulseTimer) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => {
      if (!this.enabled || !this.context) return;
      if (this.density > 0.12) {
        this.chime(210 + this.density * 260, 0.035, 0.08);
      }
      this.schedulePulse();
    }, Math.max(750, 2350 - this.density * 1250));
  }

  chime(frequency = 620, volume = 0.045, duration = 0.1) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequency * 0.82),
      now + duration,
    );
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.04);
  }

  alarm() {
    if (!this.enabled) return;
    this.chime(320, 0.075, 0.18);
    window.setTimeout(() => this.chime(255, 0.06, 0.2), 180);
  }

  success() {
    if (!this.enabled) return;
    this.chime(520, 0.05, 0.15);
    window.setTimeout(() => this.chime(680, 0.045, 0.2), 120);
    window.setTimeout(() => this.chime(820, 0.04, 0.28), 250);
  }
}
