// 离线空间渲染器：读取 computeSpatialModel 的参数，逐声道叠加直达声与反射，
// 每个声径独立做分数/整数采样延迟、距离增益、低通滤波。浏览器导出与 Node 验证共用。

import { encodeWav } from './wav.js';

export const RENDER_SAMPLE_RATE = 48000;

// 简单一阶低通（RC 近似），由截止频率实时求系数
function makeLowpass(sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let y = 0;
  return (x) => {
    y += alpha * (x - y);
    return y;
  };
}

// 内置测试信号源
export function synthesizeSignal(type, sampleRate, durationSec) {
  const n = Math.floor(sampleRate * durationSec);
  const out = new Float32Array(n);
  const fade = Math.floor(sampleRate * 0.01);

  if (type === 'sine') {
    for (let i = 0; i < n; i++) out[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / sampleRate);
  } else if (type === 'sweep') {
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const f = 100 + (3500 - 100) * (t / durationSec);
      out[i] = 0.5 * Math.sin(2 * Math.PI * f * t);
    }
  } else if (type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      out[i] = 0.25 * (b0 + b1 + b2 + white * 0.1848);
    }
  } else {
    for (let i = 0; i < n; i++) out[i] = 0.4 * (Math.random() * 2 - 1);
  }

  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }
  return out;
}

// 主渲染函数：model 来自 computeSpatialModel
export function renderModel(model, options = {}) {
  const sampleRate = options.sampleRate || RENDER_SAMPLE_RATE;
  const durationSec = options.durationSec ?? 2;
  const signal = options.signal
    || synthesizeSignal(options.signalType || 'sine', sampleRate, durationSec);
  const frames = Math.min(signal.length, Math.floor(sampleRate * durationSec));
  const channels = Array.from(
    { length: model.channels },
    () => new Float32Array(frames));

  for (const tap of model.taps) {
    for (let ch = 0; ch < model.channels; ch++) {
      const cp = tap.perChannel[ch];
      if (cp.gain <= 0.000001) continue;
      const delaySamples = cp.delaySec * sampleRate;
      const integerDelay = Math.floor(delaySamples);
      const frac = delaySamples - integerDelay;
      const filter = makeLowpass(sampleRate, cp.lowpassHz);
      const output = channels[ch];

      for (let i = 0; i < frames; i++) {
        const srcIndex = i - integerDelay;
        if (srcIndex < 1 || srcIndex >= frames) continue;
        // 线性插值实现亚采样延迟（双耳 ITD 需要）
        const x = signal[srcIndex - 1] * frac + signal[srcIndex] * (1 - frac);
        output[i] += filter(x * cp.gain);
      }
    }
  }

  normalize(channels);
  return { channels, sampleRate, frames, signalType: options.signalType || 'sine' };
}

function normalize(channels, targetPeak = 0.85) {
  let peak = 0;
  for (const ch of channels) {
    for (const v of ch) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  if (peak <= 0.000001) return;
  const k = targetPeak / peak;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] *= k;
  }
}

export function renderToWav(model, options = {}) {
  const rendered = renderModel(model, options);
  const bytes = encodeWav(rendered.channels, rendered.sampleRate);
  return { ...rendered, wav: bytes };
}

// 读取 WAV 头部，用于 Node 端验证声道数与采样率
export function readWavHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    riff: String.fromCharCode(...new Uint8Array(bytes.buffer, bytes.byteOffset, 4)),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
    totalSize: bytes.byteLength,
  };
}
