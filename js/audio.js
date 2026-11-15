const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class RailAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.rumbleGain = null;
    this.railGain = null;
    this.railOsc = null;
    this.noiseFilter = null;
    this.brakeGain = null;
    this.brakeOsc = null;
    this.noiseBuffer = null;
    this.enabled = false;
    this.muted = false;
    this.nextClack = 0;
    this.lastSpeed = 0;
  }

  async enable() {
    if (this.enabled) {
      if (this.context?.state === "suspended") await this.context.resume();
      return true;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    this.context = new AudioContextClass();
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.62;
    this.master.connect(context.destination);

    this.noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }

    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    this.noiseFilter = context.createBiquadFilter();
    this.noiseFilter.type = "lowpass";
    this.noiseFilter.frequency.value = 260;
    this.noiseFilter.Q.value = 0.7;
    this.rumbleGain = context.createGain();
    this.rumbleGain.gain.value = 0;
    noise.connect(this.noiseFilter).connect(this.rumbleGain).connect(this.master);
    noise.start();

    this.railOsc = context.createOscillator();
    this.railOsc.type = "triangle";
    this.railOsc.frequency.value = 48;
    const railFilter = context.createBiquadFilter();
    railFilter.type = "lowpass";
    railFilter.frequency.value = 160;
    this.railGain = context.createGain();
    this.railGain.gain.value = 0;
    this.railOsc.connect(railFilter).connect(this.railGain).connect(this.master);
    this.railOsc.start();

    this.brakeOsc = context.createOscillator();
    this.brakeOsc.type = "sawtooth";
    this.brakeOsc.frequency.value = 680;
    const brakeFilter = context.createBiquadFilter();
    brakeFilter.type = "bandpass";
    brakeFilter.frequency.value = 1280;
    brakeFilter.Q.value = 4.8;
    this.brakeGain = context.createGain();
    this.brakeGain.gain.value = 0;
    this.brakeOsc.connect(brakeFilter).connect(this.brakeGain).connect(this.master);
    this.brakeOsc.start();

    this.enabled = true;
    if (context.state === "suspended") await context.resume();
    return true;
  }

  async suspend() {
    if (this.context?.state === "running") await this.context.suspend();
  }

  async resume() {
    if (this.enabled && this.context?.state === "suspended") await this.context.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.62, now, 0.035);
  }

  update({ cars = [], paused = false, active = true } = {}) {
    if (!this.enabled || !this.context || this.master === null) return;
    const now = this.context.currentTime;
    const moving = cars.filter((car) => car.status === "rolling");
    const speed = moving.reduce((max, car) => Math.max(max, car.velocity || 0), 0);
    const braking = moving.some((car) => car.brakeStarted && (car.velocity || 0) > 0.25);
    const activity = paused || !active ? 0 : clamp(speed / 5.2, 0, 1);
    this.lastSpeed = speed;

    this.rumbleGain.gain.setTargetAtTime(activity * 0.12, now, 0.07);
    this.railGain.gain.setTargetAtTime(activity * 0.028, now, 0.08);
    this.noiseFilter.frequency.setTargetAtTime(190 + activity * 780, now, 0.1);
    this.railOsc.frequency.setTargetAtTime(42 + activity * 55, now, 0.12);

    const squeal = braking && !paused ? clamp(0.018 + speed * 0.002, 0, 0.036) : 0;
    this.brakeGain.gain.setTargetAtTime(squeal, now, 0.05);
    this.brakeOsc.frequency.setTargetAtTime(580 + speed * 38, now, 0.09);

    if (!paused && activity > 0.08 && now >= this.nextClack) {
      this.clack(0.22 + activity * 0.38);
      this.nextClack = now + 0.2 + 0.82 / (1.4 + speed);
    }
  }

  clack(strength = 0.4) {
    if (!this.enabled || this.muted) return;
    const context = this.context;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1450;
    filter.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(clamp(strength, 0.05, 0.8), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now, Math.random());
    source.stop(now + 0.06);

    const knock = context.createOscillator();
    knock.type = "square";
    knock.frequency.setValueAtTime(92, now);
    knock.frequency.exponentialRampToValueAtTime(46, now + 0.07);
    const knockGain = context.createGain();
    knockGain.gain.setValueAtTime(clamp(strength * 0.4, 0.01, 0.25), now);
    knockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    knock.connect(knockGain).connect(this.master);
    knock.start(now);
    knock.stop(now + 0.1);
  }

  switchClack() {
    this.clack(0.28);
    window.setTimeout(() => this.clack(0.17), 85);
  }

  coupler() {
    this.clack(0.32);
    window.setTimeout(() => this.clack(0.2), 110);
  }

  impact() {
    if (!this.enabled || this.muted) return;
    const context = this.context;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.5);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.6);

    const thud = context.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(74, now);
    thud.frequency.exponentialRampToValueAtTime(31, now + 0.5);
    const thudGain = context.createGain();
    thudGain.gain.setValueAtTime(0.42, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    thud.connect(thudGain).connect(this.master);
    thud.start(now);
    thud.stop(now + 0.7);
  }

  chime(success = true) {
    if (!this.enabled || this.muted) return;
    const context = this.context;
    const notes = success ? [523.25, 659.25, 783.99] : [220, 174.61];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.13;
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + 0.5);
    });
  }
}
