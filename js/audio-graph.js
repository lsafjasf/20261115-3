// Live Web Audio graph driven by PlaybackEngine telemetry.
// Uses HRTF PannerNodes for true binaural monitoring when available, with
// an equal-power StereoPanner fallback. Reverb is a shared convolver whose
// wet level follows the per-segment setting.

import { SOURCE_VOICES, voiceSample, ambientSample, impulseResponse, mulberry32 } from "./sounds.js";

export class LiveAudio {
  constructor() {
    this.ctx = null;
    this.running = false;
  }

  async start(config) {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.config = config;

    const master = ctx.createGain();
    master.gain.value = 0.9;

    // Shared convolution reverb.
    const convolver = ctx.createConvolver();
    const ir = impulseResponse(ctx.sampleRate);
    convolver.buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate);
    convolver.buffer.getChannelData(0).set(ir);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.25;
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1;
    convolver.connect(wetGain).connect(master);
    dryGain.connect(master);
    master.connect(ctx.destination);

    // Five spatial source voices.
    this.voices = config.sources.map((source, idx) => {
      const voice = SOURCE_VOICES.find((v) => v.id === source.id) ?? SOURCE_VOICES[idx];
      const buffer = this._makeVoiceBuffer(voice);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      const input = ctx.createGain();
      input.gain.value = 0;
      node.connect(input);

      let panner = null;
      let fallback = null;
      try {
        panner = ctx.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "linear";
        panner.refDistance = 40;
        panner.maxDistance = 400;
        panner.rolloffFactor = 1;
        input.connect(panner);
        panner.connect(dryGain);
        panner.connect(convolver);
      } catch {
        fallback = ctx.createStereoPanner();
        input.connect(fallback);
        fallback.connect(dryGain);
        fallback.connect(convolver);
      }
      node.start();
      return { source, voice, input, panner, fallback, rand: mulberry32(voice.seed) };
    });

    // Per-segment ambient bed (crossfaded by the engine's blend weights).
    this.ambientNodes = [];
    const ambientRand = mulberry32(909);
    for (const type of ["wind", "traffic", "stream", "crowd", "leaves"]) {
      const buffer = this._makeAmbientBuffer(type, ambientRand);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain).connect(dryGain);
      node.start();
      this.ambientNodes.push({ type, gain });
    }

    Object.assign(this, { master, convolver, wetGain, dryGain });
    this.running = true;
    if (ctx.state === "suspended") await ctx.resume();
  }

  _makeVoiceBuffer(voice) {
    const ctx = this.ctx;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rand = mulberry32(voice.seed + 77);
    for (let i = 0; i < data.length; i++) {
      data[i] = voiceSample(voice, i / ctx.sampleRate, rand);
    }
    return buffer;
  }

  _makeAmbientBuffer(type, rand) {
    const ctx = this.ctx;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = ambientSample(type, i / ctx.sampleRate, rand) * 0.5;
    }
    return buffer;
  }

  // Push one telemetry frame. All params use setTargetAtTime for zipper-free
  // smoothing; the canvas y axis points down, so z is flipped for the panner.
  applyFrame(frame) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    const tau = 0.05;
    this.voices.forEach((entry, idx) => {
      const state = frame.sources[idx];
      entry.input.gain.setTargetAtTime(state.gain * 0.5, t, tau);
      if (entry.panner) {
        const s = entry.source;
        entry.panner.positionX.setTargetAtTime(s.x, t, tau);
        entry.panner.positionY.setTargetAtTime(-s.y, t, tau);
        entry.panner.positionZ.setTargetAtTime(0, t, tau);
        if (entry.panner.orientationX) {
          entry.panner.orientationX.setTargetAtTime(frame.heading.x, t, tau);
          entry.panner.orientationY.setTargetAtTime(-frame.heading.y, t, tau);
        }
      } else if (entry.fallback) {
        entry.fallback.pan.setTargetAtTime(state.pan, t, tau);
      }
    });
    // Listener orientation (forward + up) for the HRTF model.
    const listener = this.ctx.listener;
    if (listener.forwardX) {
      listener.forwardX.setTargetAtTime(frame.heading.x, t, tau);
      listener.forwardY.setTargetAtTime(-frame.heading.y, t, tau);
      listener.forwardZ.setTargetAtTime(0, t, tau);
      listener.upX.setTargetAtTime(0, t, tau);
      listener.upY.setTargetAtTime(0, t, tau);
      listener.upZ.setTargetAtTime(1, t, tau);
    }
    this.wetGain.gain.setTargetAtTime(frame.segment.reverb, t, tau);
    const active = new Map();
    active.set(frame.segment.ambient, frame.segment.ambientGain);
    active.set(frame.segment.nextAmbient, 1 - frame.segment.ambientGain);
    for (const amb of this.ambientNodes) {
      const value = (active.get(amb.type) ?? 0) * 0.18;
      amb.gain.setTargetAtTime(value, t, tau);
    }
  }

  async suspend() {
    if (this.ctx && this.ctx.state === "running") await this.ctx.suspend();
  }

  async resume() {
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  dispose() {
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.running = false;
  }
}
