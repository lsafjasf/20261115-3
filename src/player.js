import { clamp, dbToAmplitude, envelopeValueAt, isSkippedAt, skippedRanges } from "./ducking.js";

export class DuckingPlayer {
  constructor(tracks, { onEnd } = {}) {
    this.tracks = tracks;
    this.onEnd = onEnd;
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.musicGain = null;
    this.broadcastGain = null;
    this.musicSource = null;
    this.broadcastSource = null;
    this.musicBuffer = null;
    this.broadcastBuffer = null;
    this.envelope = null;
    this.ranges = [];
    this.playing = false;
    this.stopping = false;
    this.position = 0;
    this.anchorPosition = 0;
    this.anchorContextTime = 0;
    this.analyserData = null;
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.musicGain = this.context.createGain();
      this.broadcastGain = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyserData = new Float32Array(this.analyser.fftSize);
      this.musicGain.connect(this.master);
      this.broadcastGain.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.createBuffers();
    }
    if (this.context.state !== "running") await this.context.resume();
  }

  createBuffers() {
    const { sampleRate, music, broadcast } = this.tracks;
    const frames = music.left.length;
    this.musicBuffer = this.context.createBuffer(2, frames, sampleRate);
    this.musicBuffer.copyToChannel(music.left, 0);
    this.musicBuffer.copyToChannel(music.right, 1);
    this.broadcastBuffer = this.context.createBuffer(1, frames, sampleRate);
    this.broadcastBuffer.copyToChannel(broadcast, 0);
  }

  async play(envelope, skippedIds) {
    await this.ensureContext();
    if (this.playing) return;
    this.envelope = envelope;
    this.ranges = skippedRanges(this.tracks.segments, skippedIds);
    if (this.position >= this.tracks.duration - 0.01) this.position = 0;
    this.startSources(this.position);
  }

  startSources(position) {
    const now = this.context.currentTime;
    const startAt = now + 0.015;
    this.stopping = false;
    this.musicSource = this.context.createBufferSource();
    this.broadcastSource = this.context.createBufferSource();
    this.musicSource.buffer = this.musicBuffer;
    this.broadcastSource.buffer = this.broadcastBuffer;
    this.musicSource.connect(this.musicGain);
    this.broadcastSource.connect(this.broadcastGain);
    this.scheduleMusicGain(startAt, position);
    this.scheduleBroadcastGain(startAt, position);

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(1, now + 0.025);
    this.musicSource.start(startAt, position);
    this.broadcastSource.start(startAt, position);
    this.musicSource.onended = () => this.handleSourceEnded();

    this.anchorPosition = position;
    this.anchorContextTime = startAt;
    this.position = position;
    this.playing = true;
  }

  scheduleMusicGain(startAt, position) {
    const { step, sampleRate, gainDb } = this.envelope;
    const gain = this.musicGain.gain;
    gain.cancelScheduledValues(startAt);
    gain.setValueAtTime(dbToAmplitude(envelopeValueAt(this.envelope, position)), startAt);
    const firstIndex = Math.ceil(position * sampleRate / step);
    const stride = 3;
    for (let index = firstIndex; index < gainDb.length; index += stride) {
      const time = startAt + (index * step / sampleRate - position);
      gain.linearRampToValueAtTime(dbToAmplitude(gainDb[index]), time);
    }
    gain.linearRampToValueAtTime(
      dbToAmplitude(gainDb[gainDb.length - 1]),
      startAt + this.tracks.duration - position
    );
  }

  scheduleBroadcastGain(startAt, position) {
    const gain = this.broadcastGain.gain;
    gain.cancelScheduledValues(startAt);
    const insideSkipped = isSkippedAt(position, this.ranges);
    gain.setValueAtTime(insideSkipped ? 0 : 1, startAt);

    for (const [start, end] of this.ranges) {
      if (end <= position) continue;
      if (start > position) {
        gain.setValueAtTime(1, startAt + start - position - 0.008);
        gain.linearRampToValueAtTime(0, startAt + start - position);
      }
      if (end > position) {
        gain.setValueAtTime(0, startAt + end - position - 0.008);
        gain.linearRampToValueAtTime(1, startAt + end - position);
      }
    }
  }

  reschedule(envelope, skippedIds) {
    this.envelope = envelope;
    this.ranges = skippedRanges(this.tracks.segments, skippedIds);
    if (!this.playing || !this.context) return;
    const position = this.getPosition();
    const now = this.context.currentTime;
    this.scheduleMusicGain(now, position);
    this.scheduleBroadcastGain(now, position);
  }

  async pause() {
    if (!this.playing || !this.context) return;
    const position = this.getPosition();
    this.playing = false;
    this.position = position;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.02);
    this.stopSources(now + 0.025);
  }

  stopSources(when) {
    this.stopping = true;
    for (const source of [this.musicSource, this.broadcastSource]) {
      if (!source) continue;
      try {
        source.stop(when);
      } catch {
        // A source can only be stopped once.
      }
    }
    this.musicSource = null;
    this.broadcastSource = null;
  }

  handleSourceEnded() {
    if (this.stopping || !this.playing) return;
    this.playing = false;
    this.position = this.tracks.duration;
    this.master.gain.setValueAtTime(0, this.context.currentTime);
    this.onEnd?.();
  }

  async seek(position) {
    const target = clamp(position, 0, this.tracks.duration);
    if (this.playing) {
      this.playing = false;
      this.stopSources(this.context.currentTime);
      this.position = target;
      this.startSources(target);
    } else {
      this.position = target;
    }
  }

  async restart(envelope, skippedIds) {
    this.position = 0;
    this.ranges = skippedRanges(this.tracks.segments, skippedIds);
    this.envelope = envelope;
    if (this.playing) {
      this.playing = false;
      this.stopSources(this.context.currentTime);
      this.startSources(0);
    }
  }

  getPosition() {
    if (!this.playing || !this.context) return this.position;
    const elapsed = Math.max(0, this.context.currentTime - this.anchorContextTime);
    return Math.min(this.tracks.duration, this.anchorPosition + elapsed);
  }

  getMeterPeak() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserData);
    let peak = 0;
    for (let i = 0; i < this.analyserData.length; i += 1) {
      peak = Math.max(peak, Math.abs(this.analyserData[i]));
    }
    return peak;
  }
}
