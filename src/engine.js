import { renderAccompaniment, SAMPLE_RATE } from "./synth.js";
import { songDuration } from "./model.js";

// Web Audio 播放引擎：音频时钟与 Transport 共享同一位置/速率，seek/变速即重锚
export class AudioEngine {
  constructor(song) {
    this.song = song;
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.rate = 1;
    this.startCtxTime = 0;
    this.startSongPos = 0;
    this.onEnded = null;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ sampleRate: SAMPLE_RATE });
      const rendered = renderAccompaniment(this.song);
      this.buffer = this.ctx.createBuffer(1, rendered.length, SAMPLE_RATE);
      this.buffer.copyToChannel(rendered, 0);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  // 引擎视角的歌曲位置，应与 Transport.position 一致
  songPosition() {
    if (!this.ctx || !this.source) return null;
    return this.startSongPos + (this.ctx.currentTime - this.startCtxTime) * this.rate;
  }

  #startSource(offset, when) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.ctx.destination);
    source.onended = () => {
      if (this.source === source) {
        this.source = null;
        if (this.onEnded) this.onEnded();
      }
    };
    this.startCtxTime = when;
    this.startSongPos = offset;
    source.start(when, Math.max(0, offset));
    this.source = source;
  }

  async play(offset) {
    await this.ensureContext();
    this.stopSource();
    const when = this.ctx.currentTime + 0.05;
    this.#startSource(Math.min(offset, songDuration(this.song)), when);
  }

  // 变速不重启音源，直接改 playbackRate 并重锚，避免空隙与错位
  setRate(rate, currentPosition) {
    this.rate = rate;
    if (!this.ctx || !this.source) return;
    const now = this.ctx.currentTime;
    this.source.playbackRate.setValueAtTime(rate, now);
    this.startSongPos = currentPosition;
    this.startCtxTime = now;
  }

  seek(offset, playing) {
    if (!this.ctx) return;
    this.stopSource();
    if (playing) {
      this.#startSource(Math.max(0, offset), this.ctx.currentTime + 0.05);
    }
  }

  stopSource() {
    if (this.source) {
      const old = this.source;
      this.source = null;
      old.onended = null;
      try {
        old.stop();
      } catch {
        // 已停止的音源忽略
      }
    }
  }

  pause() {
    this.stopSource();
  }
}
