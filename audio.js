(function (global) {
  "use strict";

  class ControlAudio {
    constructor() {
      this.context = null;
      this.enabled = false;
      this.started = false;
      this.lastLoad = 0;
    }

    async enable() {
      if (!this.context) this.build();
      if (!this.context) return false;
      await this.context.resume();
      this.enabled = true;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master.gain.exponentialRampToValueAtTime(0.54, now + 0.8);
      this.startAmbience();
      this.playStart();
      return true;
    }

    disable() {
      this.enabled = false;
      if (!this.context) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    }

    async toggle() {
      if (this.enabled) {
        this.disable();
        return false;
      }
      return this.enable();
    }

    build() {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.0001;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.01;
      this.compressor.release.value = 0.3;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);

      this.motorGain = this.context.createGain();
      this.motorGain.gain.value = 0.035;
      this.motorFilter = this.context.createBiquadFilter();
      this.motorFilter.type = "lowpass";
      this.motorFilter.frequency.value = 230;
      this.motorFilter.Q.value = 2.2;
      this.motorGain.connect(this.motorFilter);
      this.motorFilter.connect(this.master);

      this.humA = this.context.createOscillator();
      this.humA.type = "sine";
      this.humA.frequency.value = 54;
      this.humA.connect(this.motorGain);
      this.humA.start();

      this.humB = this.context.createOscillator();
      this.humB.type = "triangle";
      this.humB.frequency.value = 83;
      const humBGain = this.context.createGain();
      humBGain.gain.value = 0.28;
      this.humB.connect(humBGain);
      humBGain.connect(this.motorGain);
      this.humB.start();

      this.noiseGain = this.context.createGain();
      this.noiseGain.gain.value = 0.012;
      this.noiseFilter = this.context.createBiquadFilter();
      this.noiseFilter.type = "bandpass";
      this.noiseFilter.frequency.value = 520;
      this.noiseFilter.Q.value = 0.7;
      this.noiseGain.connect(this.noiseFilter);
      this.noiseFilter.connect(this.master);

      const length = this.context.sampleRate * 2;
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const channel = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.94 + white * 0.06;
        channel[index] = last * 2.6;
      }
      this.noise = this.context.createBufferSource();
      this.noise.buffer = buffer;
      this.noise.loop = true;
      this.noise.connect(this.noiseGain);
      this.noise.start();

      this.pulse = this.context.createOscillator();
      this.pulse.type = "sine";
      this.pulse.frequency.value = 1.2;
      this.pulseGain = this.context.createGain();
      this.pulseGain.gain.value = 0;
      this.pulse.connect(this.pulseGain);
      this.pulseGain.connect(this.motorGain.gain);
      this.pulse.start();
    }

    startAmbience() {
      if (!this.context || this.started) return;
      this.started = true;
      const now = this.context.currentTime;
      this.pulseGain.gain.setValueAtTime(0.004, now);
    }

    setLoad(load, snapshot) {
      if (!this.context || !this.enabled) return;
      const now = this.context.currentTime;
      const safeLoad = Math.max(0, Math.min(1, load));
      const jam = snapshot && (snapshot.jam.active || snapshot.jam.clearing);
      const move = Math.abs(safeLoad - this.lastLoad);
      this.lastLoad = safeLoad;
      const smoothing = move > 0.16 ? 0.08 : 0.28;

      this.motorGain.gain.setTargetAtTime(0.026 + safeLoad * 0.06 + (jam ? 0.018 : 0), now, smoothing);
      this.noiseGain.gain.setTargetAtTime(0.009 + safeLoad * 0.036 + (jam ? 0.018 : 0), now, smoothing);
      this.motorFilter.frequency.setTargetAtTime(185 + safeLoad * 620 + (jam ? 120 : 0), now, 0.3);
      this.noiseFilter.frequency.setTargetAtTime(410 + safeLoad * 950, now, 0.3);
      this.humA.frequency.setTargetAtTime(48 + safeLoad * 26, now, 0.25);
      this.humB.frequency.setTargetAtTime(72 + safeLoad * 38, now, 0.25);
      this.pulse.frequency.setTargetAtTime(0.75 + safeLoad * 3.1, now, 0.3);
      this.pulseGain.gain.setTargetAtTime(0.0025 + safeLoad * 0.006, now, 0.3);

      if (snapshot && snapshot.running && !snapshot.paused && !snapshot.ended && Math.random() < 0.008 + safeLoad * 0.012) {
        this.clack(safeLoad);
      }
    }

    tone(frequency, duration, level, type, slide) {
      if (!this.context || !this.enabled) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, slide), now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.03);
    }

    playStart() {
      if (!this.enabled) return;
      this.tone(220, 0.4, 0.08, "sine", 330);
      setTimeout(() => this.tone(330, 0.5, 0.06, "sine", 440), 120);
      setTimeout(() => this.tone(660, 0.28, 0.035, "sine"), 260);
    }

    clack(load) {
      if (!this.context || !this.enabled) return;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const length = Math.floor(this.context.sampleRate * 0.035);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 3);
      }
      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = 320 + load * 480;
      filter.Q.value = 1.4;
      gain.gain.value = 0.012 + load * 0.018;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(now);
    }

    event(type, level) {
      if (!this.context || !this.enabled) return;
      if (type === "picker" || type === "recovery") {
        this.tone(740, 0.18, 0.045, "sine");
        setTimeout(() => this.tone(980, 0.22, 0.035, "sine"), 90);
      } else if (type === "wrong") {
        this.tone(180, 0.34, 0.05, "square", 120);
      } else if (type === "jam") {
        this.alarm();
      } else if (type === "overflow") {
        this.tone(110, 0.5, 0.08, "sawtooth", 68);
      } else if (type === "result") {
        const success = level !== "danger";
        this.tone(success ? 392 : 146, 0.45, 0.06, "sine", success ? 784 : 92);
      }
    }

    alarm() {
      if (!this.context || !this.enabled) return;
      this.tone(440, 0.2, 0.075, "square");
      setTimeout(() => this.tone(330, 0.24, 0.065, "square"), 240);
      setTimeout(() => this.tone(440, 0.2, 0.06, "square"), 520);
    }
  }

  global.ControlAudio = ControlAudio;
})(typeof window !== "undefined" ? window : globalThis);
