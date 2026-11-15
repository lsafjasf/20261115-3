'use strict';

const { frameToTime, clamp } = require('./timebase');

// One clock per project. All transport actions mutate only this
// object: play(), pause(), seekToTime(), stepFrames(), and the
// playhead drag handler all call the same primitives.
class TransportClock {
  constructor(options = {}) {
    this.fps = options.fps || 24;
    this.durationSeconds = options.durationSeconds || 20;
    this._now =
      options.now ||
      (typeof performance !== 'undefined'
        ? () => performance.now() / 1000
        : () => Date.now() / 1000);
    this._playing = false;
    this._startedAt = 0;
    this._position = 0;
    this._listeners = new Set();
  }

  get playing() {
    return this._playing;
  }

  // Current timeline position in seconds, computed from the wall
  // clock while playing so rAF and the audio scheduler agree.
  get position() {
    if (!this._playing) return this._position;
    const elapsed = this._now() - this._startedAt;
    return clamp(this._position + elapsed, 0, this.durationSeconds);
  }

  get frame() {
    return Math.floor(this.position * this.fps);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event, this);
  }

  play() {
    if (this._playing) return;
    if (this._position >= this.durationSeconds) this._position = 0;
    this._position = this.position;
    this._startedAt = this._now();
    this._playing = true;
    this._emit('play');
  }

  pause() {
    if (!this._playing) return;
    this._position = this.position;
    this._playing = false;
    this._emit('pause');
  }

  toggle() {
    if (this._playing) this.pause();
    else this.play();
  }

  seekToTime(time) {
    const next = clamp(time, 0, this.durationSeconds);
    this._position = next;
    if (this._playing) this._startedAt = this._now();
    this._emit('seek');
  }

  seekToFrame(frame) {
    this.seekToTime(frameToTime(frame, this.fps));
  }

  // Frame stepping always pauses first; this matches NLE behavior and
  // guarantees a deterministic single-frame move.
  stepFrames(deltaFrames) {
    this.pause();
    const currentFrame = Math.round(this._position * this.fps);
    this.seekToFrame(currentFrame + deltaFrames);
  }

  stop() {
    this.pause();
    this.seekToTime(0);
    this._emit('stop');
  }
}

module.exports = { TransportClock };
