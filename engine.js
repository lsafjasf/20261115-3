/* 自适应游戏音乐引擎
 * 核心思想:三层(探索/警戒/战斗)共用同一条走带(transport),
 * 所有层的音符都由同一个 16 分音符调度器持续生成,
 * 切换只是改变各层增益 —— 因此回到探索层时旋律从当前相位继续,绝不从头播放。
 */
"use strict";

const BPM = 112;
const STEPS_PER_BAR = 16;          // 16 分音符
const LOOP_BARS = 4;
const LOOP_STEPS = STEPS_PER_BAR * LOOP_BARS;
const STEP_DUR = 60 / BPM / 4;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.15;

const LAYERS = ["explore", "alert", "combat"];
const LAYER_NAMES = { explore: "探索", alert: "警戒", combat: "战斗" };

// 和弦进行: Am - F - C - G (每小节一个)
const CHORDS = [
  [45, 57, 60, 64],  // A2 A3 C4 E4
  [41, 53, 57, 60],  // F2 F3 A3 C4
  [48, 55, 60, 64],  // C3 G3 C4 E4
  [43, 55, 59, 62],  // G2 G3 B3 D4
];
const SCALE = [57, 60, 62, 64, 67, 69, 72]; // A 小调五声 + 扩展

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// 确定性伪随机,保证每次加载旋律一致
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MusicEngine {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.danger = 0;
    this.th1 = 33;
    this.th2 = 66;
    this.fadeTime = 0.8;
    this.accentEvery = 4;
    this.accentGain = 0.5;

    this.step = 0;               // 全局步进,永不重置(只对 LOOP_STEPS 取模)
    this.totalSteps = 0;         // 单调递增,用于验证"未从头播放"
    this.nextStepTime = 0;
    this.timer = null;
    this.stepLog = [];           // {total, time} 调度日志,用于空洞验证
    this.gainLog = [];           // {time, w:[e,a,c]} 增益采样,用于验证无静默空洞
    this.onStep = null;

    // 预生成整条循环旋律(确定性)
    const rand = mulberry32(20261115);
    this.melody = [];
    let degree = 3;
    for (let i = 0; i < LOOP_STEPS; i++) {
      degree += Math.floor(rand() * 5) - 2;
      degree = Math.max(0, Math.min(SCALE.length - 1, degree));
      const play = rand() < (i % 4 === 0 ? 0.95 : 0.55);
      this.melody.push({ midi: SCALE[degree] + 12, play });
    }
  }

  start() {
    if (this.running) return;
    if (!this.ctx) this._buildGraph();
    this.ctx.resume();
    this.running = true;
    this.step = 0;
    this.totalSteps = 0;
    this.stepLog = [];
    this.gainLog = [];
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this._applyLayerGains(true);
    this.timer = setInterval(() => this._scheduler(), LOOKAHEAD_MS);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    if (this.ctx) this.ctx.suspend();
  }

  _buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.comp = this.ctx.createDynamicsCompressor();
    this.master.connect(this.comp).connect(this.ctx.destination);

    this.layerGain = {};
    this.analyser = {};
    for (const name of LAYERS) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      g.connect(an).connect(this.master);
      this.layerGain[name] = g;
      this.analyser[name] = an;
    }
    // 共享噪声源缓冲(军鼓/踩镲)
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  currentLayer() {
    if (this.danger >= this.th2) return "combat";
    if (this.danger >= this.th1) return "alert";
    return "explore";
  }

  _applyLayerGains(immediate) {
    if (!this.ctx) return;
    const active = this.currentLayer();
    const t = this.ctx.currentTime;
    for (const name of LAYERS) {
      const p = this.layerGain[name].gain;
      const target = name === active ? 1 : 0;
      p.cancelScheduledValues(t);
      if (immediate) { p.setValueAtTime(target, t); continue; }
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(target, t + this.fadeTime); // 等功率交叉淡化,总和恒为 1
    }
  }

  setDanger(v) {
    const prev = this.currentLayer();
    this.danger = v;
    if (this.currentLayer() !== prev) this._applyLayerGains(false);
  }
  setThresholds(a, b) {
    this.th1 = Math.min(a, b - 1);
    this.th2 = Math.max(b, a + 1);
    this._applyLayerGains(false);
  }
  setFade(t) { this.fadeTime = t; }
  setAccent(every, gain) { this.accentEvery = every; this.accentGain = gain; }

  _scheduler() {
    if (!this.running) return;
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      this._scheduleStep(this.step, this.nextStepTime);
      this.stepLog.push({ total: this.totalSteps, time: this.nextStepTime });
      if (this.stepLog.length > 4096) this.stepLog.splice(0, 2048);
      const beat = Math.floor(this.step / 4);
      const accent = beat % this.accentEvery === 0 && this.step % 4 === 0;
      if (this.onStep) this.onStep(this.step, this.nextStepTime, accent);
      this.step = (this.step + 1) % LOOP_STEPS;
      this.totalSteps++;
      this.nextStepTime += STEP_DUR;
    }
    this._sampleGains();
  }

  _sampleGains() {
    const w = LAYERS.map(n => this.layerGain[n].gain.value);
    this.gainLog.push({ time: this.ctx.currentTime, w });
    if (this.gainLog.length > 8192) this.gainLog.splice(0, 4096);
  }

  _velocity(step) {
    const beat = Math.floor(step / 4);
    const accent = step % 4 === 0 && beat % this.accentEvery === 0;
    return accent ? 1 + this.accentGain : 1;
  }

  _scheduleStep(step, t) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chord = CHORDS[bar];
    const vel = this._velocity(step);
    this._scheduleExplore(step, t, chord, vel);
    this._scheduleAlert(step, t, chord, vel);
    this._scheduleCombat(step, t, chord, vel);
  }

  // ---- 探索层: 柔和长音垫 + 稀疏拨弦旋律 ----
  _scheduleExplore(step, t, chord, vel) {
    const out = this.layerGain.explore;
    if (step % STEPS_PER_BAR === 0) {
      for (const m of chord.slice(1)) this._pad(out, m, t, STEP_DUR * STEPS_PER_BAR);
    }
    const note = this.melody[step];
    if (note.play && step % 2 === 0) {
      this._pluck(out, note.midi, t, 0.22 * vel, 0.9);
    }
  }

  // ---- 警戒层: 脉冲低音 + 反拍踩镲 + 同一旋律的短促版 ----
  _scheduleAlert(step, t, chord, vel) {
    const out = this.layerGain.alert;
    if (step % 2 === 0) this._bassPulse(out, chord[0], t, 0.16 * vel);
    if (step % 4 === 2) this._hat(out, t, 0.10);
    const note = this.melody[step];
    if (note.play && step % 2 === 0) {
      this._pluck(out, note.midi, t, 0.15 * vel, 0.18);
    }
  }

  // ---- 战斗层: 鼓组 + 16 分琶音 + 锯齿低音 ----
  _scheduleCombat(step, t, chord, vel) {
    const out = this.layerGain.combat;
    if (step % 4 === 0) this._kick(out, t, 0.5 * vel);
    if (step % 8 === 4) this._snare(out, t, 0.3);
    if (step % 4 === 2) this._hat(out, t, 0.14);
    const arpNote = chord[1 + (step % 3)] + 12;
    this._pluck(out, arpNote, t, 0.10 * vel, 0.12, "square");
    if (step % 2 === 0) this._sawBass(out, chord[0] - 12, t, 0.14 * vel);
  }

  // ---- 合成原语 ----
  _pad(out, midi, t, dur) {
    const ctx = this.ctx;
    for (const det of [-4, 3]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = midiToFreq(midi);
      o.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
      g.gain.setValueAtTime(0.05, t + dur * 0.8);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  _pluck(out, midi, t, peak, release, type = "sine") {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + release);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + release + 0.05);
  }

  _bassPulse(out, midi, t, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = midiToFreq(midi);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 500; f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 1.8);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + STEP_DUR * 2);
  }

  _sawBass(out, midi, t, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = midiToFreq(midi);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 1.9);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + STEP_DUR * 2);
  }

  _kick(out, t, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.3);
  }

  _snare(out, t, peak) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(g).connect(out);
    src.start(t); src.stop(t + 0.2);
  }

  _hat(out, t, peak) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f).connect(g).connect(out);
    src.start(t); src.stop(t + 0.06);
  }
}
