import { STEPS_PER_BEAT, STEP_COUNT, clamp } from "./project.js";

export class MusicClock {
  constructor(options = {}) {
    this.bpm = clamp(Number(options.bpm) || 112, 40, 240);
    this.stepCount = Math.max(1, Number(options.stepCount) || STEP_COUNT);
    this.stepsPerBeat = Number(options.stepsPerBeat) || STEPS_PER_BEAT;
    this.loop = options.loop !== false;
    this.anchorRaw = Number(options.position) || 0;
    this.anchorTime = Number(options.time) || 0;
  }

  get stepsPerSecond() {
    return (this.bpm / 60) * this.stepsPerBeat;
  }

  get stepDuration() {
    return 1 / this.stepsPerSecond;
  }

  rawAt(time) {
    return (
      this.anchorRaw +
      Math.max(0, time - this.anchorTime) * this.stepsPerSecond
    );
  }

  phaseAt(time) {
    const raw = this.rawAt(time);
    if (!this.loop) return Math.min(raw, this.stepCount);
    return ((raw % this.stepCount) + this.stepCount) % this.stepCount;
  }

  stepAt(time) {
    return Math.floor(this.phaseAt(time));
  }

  timeAtRaw(rawPosition) {
    return (
      this.anchorTime +
      (rawPosition - this.anchorRaw) / this.stepsPerSecond
    );
  }

  setTempo(bpm, time) {
    const currentRaw = this.rawAt(time);
    this.bpm = clamp(Number(bpm) || 112, 40, 240);
    this.anchorRaw = currentRaw;
    this.anchorTime = time;
  }

  seek(position, time) {
    this.anchorRaw = Number(position) || 0;
    this.anchorTime = Number(time) || 0;
  }

  setLoop(loop) {
    this.loop = Boolean(loop);
  }
}
