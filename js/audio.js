/*
 * 轻量 Web Audio 反馈：播放/落关键帧时发出短促音效。
 * 全程受 enabled 开关控制，关闭后不创建任何声音，也不恢复 AudioContext。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AUDIO_NS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class AudioFX {
    constructor() {
      this.enabled = false; // 默认关闭，需用户显式开启(浏览器自动播放策略)
      this.ctx = null;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.enabled) this.ensureContext();
      return this.enabled;
    }

    ensureContext() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return this.ctx;
      }
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      this.ctx = new AC();
      return this.ctx;
    }

    blip(freq, dur, type, gainValue) {
      if (!this.enabled) return;
      const ctx = this.ensureContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq || 440;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainValue || 0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.12));
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (dur || 0.12) + 0.02);
    }

    playTick() {
      this.blip(520, 0.07, "triangle", 0.05);
    }

    playKeyframe() {
      this.blip(720, 0.1, "sine", 0.09);
    }

    playLoop() {
      this.blip(330, 0.14, "square", 0.035);
    }
  }

  return { AudioFX };
});
