import { MusicClock } from "./clock.js";
import { STEP_COUNT, clamp } from "./project.js";
import { renderVoice } from "./synth.js";

export class AudioEngine {
  constructor(getProject, callbacks = {}) {
    this.getProject = getProject;
    this.callbacks = callbacks;
    this.context = null;
    this.master = null;
    this.state = "stopped";
    this.savedPhase = 0;
    this.nextRawStep = 0;
    this.activeVoices = new Set();
    this.voiceCache = new Map();
    this.timer = null;
    this.lookahead = 0.1;
    this.clock = new MusicClock({
      bpm: getProject().bpm,
      loop: getProject().loop,
    });
  }

  async _ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("此浏览器不支持 Web Audio API");
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.getProject().master.gain;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  _emitState() {
    this.callbacks.onState?.(this.state, this.getPosition());
  }

  _setState(state) {
    this.state = state;
    this._emitState();
  }

  getPosition() {
    if (!this.context || this.state === "stopped" || this.state === "paused") {
      return ((this.savedPhase % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
    }
    return this.clock.phaseAt(this.context.currentTime);
  }

  getTransportTime() {
    if (!this.context) return 0;
    return this.context.currentTime;
  }

  async play() {
    if (this.state === "playing") return;
    await this._ensureContext();
    const project = this.getProject();
    const now = this.context.currentTime;
    const startingFresh =
      this.state === "stopped" && project.resumeMode === "start";
    let phase = startingFresh ? 0 : this.savedPhase;
    if (phase >= STEP_COUNT) phase = 0;
    this.master.gain.setValueAtTime(project.master.gain, now);
    const startTime = now + 0.035;
    this.clock = new MusicClock({
      bpm: project.bpm,
      loop: project.loop,
      stepCount: STEP_COUNT,
      position: phase,
      time: startTime,
    });
    this.nextRawStep =
      startingFresh || phase < 0.0001 ? 0 : Math.ceil(phase + 0.00001);
    this.savedPhase = phase;
    this._setState("playing");
    this._schedule();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this._schedule(), 18);
  }

  _stopVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.activeVoices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + 0.012);
        voice.source.stop(now + 0.014);
      } catch {
        // A source may already have ended between scheduling and stopping.
      }
    }
  }

  pause() {
    if (this.state !== "playing") return;
    this.savedPhase = this.clock.phaseAt(this.context.currentTime);
    clearInterval(this.timer);
    this.timer = null;
    this._stopVoices();
    this._setState("paused");
  }

  stop() {
    if (this.state === "playing") {
      this.savedPhase = this.clock.phaseAt(this.context.currentTime);
    }
    clearInterval(this.timer);
    this.timer = null;
    this._stopVoices();
    if (this.getProject().resumeMode === "start") this.savedPhase = 0;
    this._setState("stopped");
  }

  setBpm(bpm) {
    if (this.state === "playing") {
      this.clock.setTempo(bpm, this.context.currentTime);
    } else {
      this.clock.bpm = clamp(Number(bpm) || 112, 40, 240);
    }
  }

  setLoop(loop) {
    if (
      this.state === "playing" &&
      this.clock.loop &&
      !loop &&
      this.context
    ) {
      const now = this.context.currentTime;
      const phase = this.clock.phaseAt(now);
      this.clock.seek(phase, now);
      this.nextRawStep = Math.ceil(phase + 0.00001);
    }
    this.clock.setLoop(loop);
  }

  setMasterGain(gain) {
    if (!this.context) return;
    this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.02);
  }

  invalidateVoices() {
    this.voiceCache.clear();
  }

  _getBuffer(track, trackIndex, stepIndex, step, gateSeconds) {
    const key = [
      trackIndex,
      stepIndex,
      step.note,
      gateSeconds.toFixed(5),
      JSON.stringify(track.synth),
    ].join(":");
    if (this.voiceCache.has(key)) return this.voiceCache.get(key);
    const seed = 0x9e3779b9 ^ (trackIndex + 1) * 2654435761 ^ stepIndex;
    const samples = renderVoice(
      track.synth,
      step.note,
      gateSeconds,
      this.context.sampleRate,
      seed,
    );
    const buffer = this.context.createBuffer(
      1,
      samples.length,
      this.context.sampleRate,
    );
    buffer.copyToChannel(samples, 0);
    this.voiceCache.set(key, buffer);
    if (this.voiceCache.size > 320) {
      this.voiceCache.delete(this.voiceCache.keys().next().value);
    }
    return buffer;
  }

  _scheduleStep(stepIndex, when, project) {
    const stepSeconds = this.clock.stepDuration;
    for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
      const track = project.tracks[trackIndex];
      const step = track.steps[stepIndex];
      if (!step?.on || track.mute) continue;
      const gate = step.sustain * stepSeconds * 0.96;
      const source = this.context.createBufferSource();
      source.buffer = this._getBuffer(
        track,
        trackIndex,
        stepIndex,
        step,
        gate,
      );
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner();
      panner.pan.value = track.synth.pan;
      source.connect(gain);
      gain.connect(panner);
      panner.connect(this.master);
      const voice = { source, gain, panner };
      source.onended = () => {
        this.activeVoices.delete(voice);
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
      };
      this.activeVoices.add(voice);
      source.start(when);
    }
  }

  _schedule = () => {
    if (this.state !== "playing" || !this.context) return;
    const project = this.getProject();
    const now = this.context.currentTime;
    const rawNow = this.clock.rawAt(now);
    if (!project.loop && rawNow >= STEP_COUNT) {
      this.savedPhase = 0;
      clearInterval(this.timer);
      this.timer = null;
      this._stopVoices();
      this._setState("stopped");
      return;
    }
    if (this.nextRawStep < rawNow - 0.5) {
      this.nextRawStep = Math.ceil(rawNow + 0.005);
    }
    const horizon = now + this.lookahead;
    const rawEnd = this.clock.rawAt(horizon);
    let scheduled = 0;
    while (this.nextRawStep <= rawEnd && scheduled < 64) {
      if (!project.loop && this.nextRawStep >= STEP_COUNT) break;
      const when = this.clock.timeAtRaw(this.nextRawStep);
      const stepIndex =
        ((this.nextRawStep % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
      if (when >= now - 0.01) this._scheduleStep(stepIndex, when, project);
      this.nextRawStep += 1;
      scheduled += 1;
    }
  };
}
