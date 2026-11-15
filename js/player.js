// Web Audio 实时播放：按 computeSpatialModel 的参数实时驱动每通道
// 延迟(DelayNode)、低通(BiquadFilter)与增益(GainNode)，拖拽时平滑更新。

import { synthesizeSignal } from './renderer.js';

const MAX_DELAY_SEC = 0.5;

export class SpatialPlayer {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.sourceNode = null;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  start(model, signalType) {
    const ctx = this.ensureContext();
    this.stop();
    this.running = true;
    this.signalType = signalType;

    const buffer = this.makeBuffer(ctx, signalType);
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.loop = true;

    this.buildGraph(model);
    this.sourceNode.start();
  }

  makeBuffer(ctx, signalType) {
    const seconds = 2;
    const data = synthesizeSignal(signalType, ctx.sampleRate, seconds);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    return buffer;
  }

  buildGraph(model) {
    const ctx = this.ctx;
    this.merger = ctx.createChannelMerger(model.channels);
    this.paramNodes = [];
    for (let ch = 0; ch < model.channels; ch++) {
      for (const tap of model.taps) {
        const cp = tap.perChannel[ch];
        if (cp.gain <= 0.000001) continue;
        const delay = ctx.createDelay(MAX_DELAY_SEC);
        delay.delayTime.value = Math.min(cp.delaySec, MAX_DELAY_SEC);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cp.lowpassHz;
        filter.Q.value = 0.5;
        const gain = ctx.createGain();
        gain.gain.value = cp.gain;
        this.sourceNode.connect(delay);
        delay.connect(filter);
        filter.connect(gain);
        gain.connect(this.merger, 0, ch);
        this.paramNodes.push({ delay, filter, gain });
      }
    }
    // 4 声道在仅支持立体声的设备上折叠为双声道输出，保证可听
    if (model.channels === 4 && typeof ctx.createChannelSplitter === 'function') {
      const splitter = ctx.createChannelSplitter(4);
      const foldMerger = ctx.createChannelMerger(2);
      this.merger.connect(splitter);
      splitter.connect(foldMerger, 0, 0); // FL -> L
      splitter.connect(foldMerger, 3, 0); // BL -> L
      splitter.connect(foldMerger, 1, 1); // FR -> R
      splitter.connect(foldMerger, 2, 1); // BR -> R
      foldMerger.connect(ctx.destination);
    } else {
      this.merger.connect(ctx.destination);
    }
    this.graphSignature = model.mode;
  }

  // 拖拽过程中实时更新参数（不重建图，避免声源/模式重置感）
  update(model) {
    if (!this.running || !this.ctx) return;
    // 参数数量随模式变化时重建图；同模式仅参数变化时平滑更新
    if (this.graphSignature !== model.mode ||
        this.paramNodes.length !== this.countActive(model)) {
      this.rebuild(model);
      return;
    }
    this.applyParams(model);
  }

  countActive(model) {
    let n = 0;
    for (let ch = 0; ch < model.channels; ch++) {
      for (const tap of model.taps) {
        if (tap.perChannel[ch].gain > 0.000001) n++;
      }
    }
    return n;
  }

  rebuild(model) {
    const wasRunning = this.running;
    const signalType = this.signalType;
    this.stop();
    if (!wasRunning) return;
    this.start(model, signalType);
  }

  applyParams(model) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    let index = 0;
    const active = [];
    for (let ch = 0; ch < model.channels; ch++) {
      for (const tap of model.taps) {
        const cp = tap.perChannel[ch];
        if (cp.gain <= 0.000001) continue;
        active.push(cp);
      }
    }
    for (const node of this.paramNodes || []) {
      const cp = active[index];
      if (!cp) break;
      node.delay.delayTime.setTargetAtTime(Math.min(cp.delaySec, MAX_DELAY_SEC), t, 0.03);
      node.filter.frequency.setTargetAtTime(cp.lowpassHz, t, 0.03);
      node.gain.gain.setTargetAtTime(cp.gain, t, 0.03);
      index++;
    }
  }

  stop() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch { /* 已停止 */ }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.merger) {
      this.merger.disconnect();
      this.merger = null;
    }
    this.paramNodes = [];
    this.graphSignature = null;
    this.running = false;
  }
}
