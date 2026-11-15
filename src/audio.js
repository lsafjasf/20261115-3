(function attachFrameAudio(global) {
  "use strict";

  class SyntheticAudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.voice = null;
      this.time = 0;
      this.playing = false;
      this.scrubbing = false;
      this.muted = false;
    }

    async unlock() {
      if (!this.context) {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextClass) return false;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.035;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      return this.context.state === "running";
    }

    sync(seconds, options) {
      const state = options || {};
      this.time = Math.max(0, Number(seconds) || 0);
      this.playing = Boolean(state.playing);
      this.scrubbing = Boolean(state.scrubbing);
      if (!this.playing || this.scrubbing) {
        this.stopVoice();
        return;
      }
      if (this.context && this.context.state === "running") {
        this.startVoice(this.time);
      }
    }

    startVoice(seconds) {
      if (!this.context || !this.master || this.muted) return;
      this.stopVoice();
      const now = this.context.currentTime;
      const phrase = Math.floor(seconds / 4) % 6;
      const base = 164 + phrase * 28;
      const oscA = this.context.createOscillator();
      const oscB = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();

      oscA.type = "sine";
      oscB.type = "triangle";
      oscA.frequency.value = base;
      oscB.frequency.value = base * 1.5;
      filter.type = "lowpass";
      filter.frequency.value = 920;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.7, now + 0.04);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      oscA.start(now);
      oscB.start(now);
      this.voice = { oscA, oscB, gain };
    }

    stopVoice() {
      if (!this.voice || !this.context) return;
      const voice = this.voice;
      const now = this.context.currentTime;
      this.voice = null;
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        voice.oscA.stop(now + 0.04);
        voice.oscB.stop(now + 0.04);
      } catch (error) {
        return;
      }
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.035, this.context.currentTime, 0.01);
      }
      if (this.muted) this.stopVoice();
    }
  }

  global.FrameAudio = { SyntheticAudioEngine };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SyntheticAudioEngine };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
