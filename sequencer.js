/*
 * StepSequencer — drift-free step sequencer built on the Web Audio clock.
 *
 * Timing model:
 *  - A lookahead timer (setInterval) only *wakes up* the scheduler; it never
 *    carries timing information itself.
 *  - Note times are computed on the audio clock (ctx.currentTime) and every
 *    note is started with source.start(when), so scheduling jitter of the
 *    JS timer never accumulates into the music.
 *  - Every scheduled note is registered in an event queue. pause(), seek()
 *    and setTempo() cancel and drain the whole queue, so no orphaned
 *    oscillator can keep ringing after a transport change.
 */
(function (global) {
  'use strict';

  class StepSequencer {
    /**
     * @param {BaseAudioContext} ctx
     * @param {object} opts
     *   steps:        number of steps per bar (default 16)
     *   bpm:          tempo (default 120)
     *   stepsPerBeat: subdivision (default 4 -> 16th notes)
     *   lookaheadMs:  scheduler wake interval (default 25)
     *   scheduleAheadTime: how far ahead notes are scheduled, seconds (default 0.1)
     *   pattern:      array of bool/velocity per step
     *   voice:        function(ctx, destination, time, step, velocity) -> AudioNode[]
     *                 must return every node it starts, so they can be cancelled.
     */
    constructor(ctx, opts = {}) {
      this.ctx = ctx;
      this.destination = opts.destination || ctx.destination;
      this.steps = opts.steps || 16;
      this.bpm = opts.bpm || 120;
      this.stepsPerBeat = opts.stepsPerBeat || 4;
      this.lookaheadMs = opts.lookaheadMs || 25;
      this.scheduleAheadTime = opts.scheduleAheadTime || 0.1;
      this.pattern = opts.pattern || new Array(this.steps).fill(true);
      this.voice = opts.voice || StepSequencer.defaultVoice;

      this.isPlaying = false;
      this.currentStep = 0;
      this.nextNoteTime = 0;

      // The event queue: every note that has been scheduled but not yet
      // played lives here. Transport changes drain it completely.
      this.eventQueue = [];

      // Diagnostic log of everything ever scheduled (for tests/analysis).
      this.scheduleLog = [];

      this._timerId = null;
      this._scheduler = this._scheduler.bind(this);
    }

    static defaultVoice(ctx, destination, time, step, velocity) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = step % 4 === 0 ? 1760 : 880;
      gain.gain.setValueAtTime(0.6 * velocity, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      osc.connect(gain).connect(destination);
      osc.start(time);
      osc.stop(time + 0.05);
      return [osc, gain];
    }

    get secondsPerStep() {
      return 60.0 / (this.bpm * this.stepsPerBeat);
    }

    /** Number of events still waiting in the queue (should be 0 when paused). */
    get pendingEventCount() {
      return this.eventQueue.length;
    }

    start(fromStep = 0) {
      if (this.isPlaying) return;
      this.isPlaying = true;
      this.currentStep = ((fromStep % this.steps) + this.steps) % this.steps;
      this.nextNoteTime = this.ctx.currentTime + 0.05;
      this._timerId = setInterval(this._scheduler, this.lookaheadMs);
    }

    _scheduler() {
      while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
        this._scheduleStep(this.currentStep, this.nextNoteTime);
        this.nextNoteTime += this.secondsPerStep;
        this.currentStep = (this.currentStep + 1) % this.steps;
      }
    }

    _scheduleStep(step, time) {
      const velocity = this.pattern[step] ? 1 : 0;
      const event = { step, time, velocity, nodes: [], cancelled: false };
      if (velocity > 0) {
        event.nodes = this.voice(this.ctx, this.destination, time, step, velocity) || [];
        for (const node of event.nodes) {
          if (typeof node.addEventListener === 'function') {
            node.addEventListener('ended', () => this._reap(event), { once: true });
          }
        }
      }
      this.eventQueue.push(event);
      this.scheduleLog.push({ step, time, bpm: this.bpm });
    }

    _reap(event) {
      const idx = this.eventQueue.indexOf(event);
      if (idx !== -1) this.eventQueue.splice(idx, 1);
    }

    /**
     * Cancel every pending event: stop all sources and drain the queue.
     * After this returns, nothing scheduled by this sequencer can still sound.
     */
    _cancelAllPending() {
      const now = this.ctx.currentTime;
      for (const event of this.eventQueue) {
        event.cancelled = true;
        for (const node of event.nodes) {
          try {
            if (typeof node.stop === 'function') node.stop(now);
            if (node.gain && typeof node.gain.cancelScheduledValues === 'function') {
              node.gain.cancelScheduledValues(now);
              node.gain.setValueAtTime(0, now);
            }
          } catch (err) {
            /* node already stopped — fine */
          }
          try { node.disconnect(); } catch (err) { /* already disconnected */ }
        }
      }
      this.eventQueue.length = 0;
    }

    pause() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      clearInterval(this._timerId);
      this._timerId = null;
      this._cancelAllPending();
    }

    resume() {
      if (this.isPlaying) return;
      this.start(this.currentStep);
    }

    stop() {
      this.pause();
      this.currentStep = 0;
    }

    /** Change tempo without leaving half-scheduled notes behind. */
    setTempo(bpm) {
      this.bpm = bpm;
      if (!this.isPlaying) return;
      this._cancelAllPending();
      // Re-anchor the grid on the audio clock at the current step.
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }

    /** Jump to an arbitrary step; all previously queued events are cancelled. */
    seek(step) {
      const wasPlaying = this.isPlaying;
      if (wasPlaying) this.pause();
      this.currentStep = ((step % this.steps) + this.steps) % this.steps;
      if (wasPlaying) this.start(this.currentStep);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StepSequencer };
  } else {
    global.StepSequencer = StepSequencer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
