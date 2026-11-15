import { BEAT_INTERVAL, PROGRAM } from "./program.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.recordDestination = null;
    this.activeNodes = new Set();
    this.startContextTime = 0;
    this.offset = 0;
    this.running = false;
    this.noiseBuffer = null;
  }

  async ensure() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("浏览器不支持 Web Audio");
      }
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.16;

      this.master = this.context.createGain();
      this.master.gain.value = 0.82;
      this.compressor.connect(this.master);
      this.master.connect(this.context.destination);

      this.recordDestination = this.context.createMediaStreamDestination();
      this.compressor.connect(this.recordDestination);
      this.noiseBuffer = this.createNoiseBuffer();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  createNoiseBuffer() {
    const length = Math.floor(this.context.sampleRate * 0.12);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    return buffer;
  }

  get audioStream() {
    return this.recordDestination?.stream ?? null;
  }

  clockTime() {
    if (!this.running || !this.context) {
      return this.offset;
    }
    return clamp(this.offset + (this.context.currentTime - this.startContextTime), 0, PROGRAM.durationSeconds);
  }

  async start(offset = 0) {
    await this.ensure();
    this.stop();
    this.running = true;
    this.offset = clamp(offset, 0, PROGRAM.durationSeconds);
    this.startContextTime = this.context.currentTime + 0.035;
    const startAt = this.startContextTime;

    this.schedulePad(startAt, this.offset);
    this.scheduleBeats(startAt, this.offset);
    this.scheduleArpeggio(startAt, this.offset);
  }

  stop() {
    this.running = false;
    this.activeNodes.forEach((node) => {
      try {
        node.stop?.();
      } catch {
        // A node may already have ended naturally.
      }
      try {
        node.disconnect();
      } catch {
        // Disconnection is idempotent enough for cleanup.
      }
    });
    this.activeNodes.clear();
  }

  register(node) {
    this.activeNodes.add(node);
    return node;
  }

  schedulePad(startAt, offset) {
    const ctx = this.context;
    const padGain = this.register(ctx.createGain());
    padGain.gain.setValueAtTime(0.08, startAt);
    padGain.gain.linearRampToValueAtTime(0.13, startAt + 1.2);
    padGain.gain.setValueAtTime(0.13, startAt + PROGRAM.durationSeconds - this.offset - 0.5);
    padGain.gain.linearRampToValueAtTime(0.02, startAt + PROGRAM.durationSeconds - this.offset);
    padGain.connect(this.compressor);

    const frequencies = [55, 82.5, 110, 146.7];
    frequencies.forEach((frequency, index) => {
      const oscillator = this.register(ctx.createOscillator());
      const filter = this.register(ctx.createBiquadFilter());
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (index - 1.5) * 3;
      filter.type = "lowpass";
      filter.frequency.value = 280 + index * 38;
      filter.Q.value = 1.2;
      oscillator.connect(filter);
      filter.connect(padGain);
      oscillator.start(startAt);
      oscillator.stop(startAt + Math.max(0.1, PROGRAM.durationSeconds - offset));
    });
  }

  scheduleBeats(startAt, offset) {
    const firstBeat = Math.max(0, Math.ceil(offset / BEAT_INTERVAL - 1e-8));
    const lastBeat = Math.floor((PROGRAM.durationSeconds - 1e-8) / BEAT_INTERVAL);
    for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
      const beatTime = beat * BEAT_INTERVAL;
      const when = startAt + (beatTime - offset);
      const barBeat = beat % PROGRAM.beatsPerBar;
      this.scheduleKick(when, barBeat === 0);
      this.scheduleTick(when, barBeat === 0);
      this.scheduleHat(when + BEAT_INTERVAL * 0.5, 0.22);
      if (barBeat === 0) {
        this.scheduleBass(when, beat / PROGRAM.beatsPerBar, 0.13);
      }
    }
  }

  scheduleKick(when, accent) {
    const ctx = this.context;
    const oscillator = this.register(ctx.createOscillator());
    const gain = this.register(ctx.createGain());
    const decay = accent ? 0.22 : 0.15;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 112 : 92, when);
    oscillator.frequency.exponentialRampToValueAtTime(42, when + decay);
    gain.gain.setValueAtTime(accent ? 0.52 : 0.38, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + decay);
    oscillator.connect(gain);
    gain.connect(this.compressor);
    oscillator.start(when);
    oscillator.stop(when + decay);
  }

  scheduleTick(when, accent) {
    const ctx = this.context;
    const oscillator = this.register(ctx.createOscillator());
    const gain = this.register(ctx.createGain());
    oscillator.type = "square";
    oscillator.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(accent ? 0.09 : 0.045, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
    oscillator.connect(gain);
    gain.connect(this.compressor);
    oscillator.start(when);
    oscillator.stop(when + 0.05);
  }

  scheduleHat(when, level) {
    const ctx = this.context;
    const source = this.register(ctx.createBufferSource());
    const filter = this.register(ctx.createBiquadFilter());
    const gain = this.register(ctx.createGain());
    source.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = 3100;
    gain.gain.setValueAtTime(level, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.065);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);
    source.start(when);
    source.stop(when + 0.07);
  }

  scheduleBass(when, bar, level) {
    const ctx = this.context;
    const oscillator = this.register(ctx.createOscillator());
    const gain = this.register(ctx.createGain());
    const notes = [55, 73.4, 65.4, 82.5];
    oscillator.type = "triangle";
    oscillator.frequency.value = notes[Math.floor(bar) % notes.length];
    gain.gain.setValueAtTime(0.002, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.002, when + 1.55);
    oscillator.connect(gain);
    gain.connect(this.compressor);
    oscillator.start(when);
    oscillator.stop(when + 1.6);
  }

  scheduleArpeggio(startAt, offset) {
    const step = BEAT_INTERVAL * 0.5;
    const firstStep = Math.max(0, Math.ceil(offset / step - 1e-8));
    const lastStep = Math.floor((PROGRAM.durationSeconds - 1e-8) / step);
    const notes = [220, 246.9, 293.7, 369.6, 329.6, 293.7, 246.9, 196];
    for (let index = firstStep; index <= lastStep; index += 1) {
      const time = index * step;
      const when = startAt + (time - offset);
      const note = notes[index % notes.length];
      this.scheduleSynthNote(when, note, index);
    }
  }

  scheduleSynthNote(when, frequency, index) {
    const ctx = this.context;
    const oscillator = this.register(ctx.createOscillator());
    const filter = this.register(ctx.createBiquadFilter());
    const gain = this.register(ctx.createGain());
    oscillator.type = index % 4 === 0 ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    filter.type = "lowpass";
    filter.frequency.value = 1350;
    filter.Q.value = 1.6;
    gain.gain.setValueAtTime(0.001, when);
    gain.gain.linearRampToValueAtTime(0.018, when + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.34);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);
    oscillator.start(when);
    oscillator.stop(when + 0.36);
  }
}
