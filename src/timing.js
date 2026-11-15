import { beatDuration, flattenSyllables, songDuration } from "./model.js";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 节拍相位：0..1，用于整行随节拍脉冲；位置始终由 transport 时间直接计算
export function beatPhase(song, position) {
  const beat = beatDuration(song);
  const phase = (position % beat) / beat;
  return phase < 0 ? phase + 1 : phase;
}

export function currentBeatIndex(song, position) {
  return Math.floor(position / beatDuration(song));
}

// 给定 transport 位置，返回逐字高亮状态
export function getPlaybackState(song, position) {
  const duration = songDuration(song);
  const pos = clamp(position, 0, duration);
  const syllables = flattenSyllables(song);

  let activeIndex = -1;
  let progress = 0;
  for (let i = 0; i < syllables.length; i += 1) {
    if (pos >= syllables[i].start && pos < syllables[i].start + syllables[i].duration) {
      activeIndex = i;
      progress = (pos - syllables[i].start) / syllables[i].duration;
      break;
    }
  }
  // 处于字间空隙或恰好落在字尾时，高亮推进到下一字（进度 0），避免同位置抖动
  if (activeIndex === -1 && pos < duration) {
    activeIndex = syllables.findIndex((syllable) => pos < syllable.start + syllable.duration);
    progress = 0;
  }

  return {
    position: pos,
    activeIndex,
    progress: clamp(progress, 0, 1),
    beatPhase: beatPhase(song, pos),
    beatIndex: currentBeatIndex(song, pos),
    barIndex: Math.floor(currentBeatIndex(song, pos) / 4),
  };
}

// transport：单一时间源。UI 只读 position，不做任何独立计时
export class Transport {
  #clock;
  #position = 0;
  #playing = false;
  #rate = 1;
  #anchorWall = 0;
  #anchorPosition = 0;
  #listeners = new Set();

constructor(clock = { now: () => Date.now() / 1000 }) {
    this.#clock = clock;
  }

  get position() {
    return this.#playing
      ? this.#anchorPosition + (this.#clock.now() - this.#anchorWall) * this.#rate
      : this.#position;
  }

  get playing() {
    return this.#playing;
  }

  get rate() {
    return this.#rate;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners) listener(event, this);
  }

  #snapshot() {
    if (this.#playing) this.#position = this.position;
  }

  play() {
    if (this.#playing) return;
    this.#anchorWall = this.#clock.now();
    this.#anchorPosition = this.#position;
    this.#playing = true;
    this.#emit("play");
  }

  pause() {
    if (!this.#playing) return;
    this.#snapshot();
    this.#playing = false;
    this.#emit("pause");
  }

  seek(position) {
    this.#position = clamp(position, 0, Number.POSITIVE_INFINITY);
    if (this.#playing) {
      this.#anchorWall = this.#clock.now();
      this.#anchorPosition = this.#position;
    }
    this.#emit("seek");
  }

  setRate(rate) {
    const next = Number(rate);
    if (!Number.isFinite(next) || next <= 0) return;
    this.#snapshot();
    this.#rate = next;
    if (this.#playing) {
      this.#anchorWall = this.#clock.now();
      this.#anchorPosition = this.#position;
    }
    this.#emit("rate");
  }

  stop() {
    this.pause();
    this.seek(0);
  }
}

export function formatClock(seconds) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const whole = Math.floor(value % 60);
  const tenths = Math.floor((value * 10) % 10);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${tenths}`;
}
