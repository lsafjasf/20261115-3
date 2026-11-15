// 三种内置音效：全部仅由 oscillator / noise / envelope / filter 模块组合而成。

export const PRESETS = {
  door: {
    label: '开门',
    duration: 1.6,
    gain: 0.9,
    modules: [
      // 门轴吱呀：锯齿波缓慢下滑 + 低通扫频
      { type: 'osc', wave: 'sawtooth', freq: 320, freqEnd: 90, glide: 1.4, gain: 0.5 },
      { type: 'osc', wave: 'triangle', freq: 160, freqEnd: 60, glide: 1.4, detune: 8, gain: 0.35 },
      // 门锁咔哒：短噪声
      { type: 'noise', gain: 0.5 },
      { type: 'filter', mode: 'lowpass', freq: 2400, freqEnd: 300, glide: 1.5, q: 4 },
      { type: 'filter', mode: 'highpass', freq: 60, q: 0.7 },
      { type: 'envelope', attack: 0.08, decay: 0.4, sustain: 0.35, release: 0.5, peak: 0.9 },
    ],
  },
  footsteps: {
    label: '脚步',
    duration: 2.0,
    hits: [0, 0.5, 1.0, 1.5],
    hitLength: 0.32,
    gain: 0.9,
    modules: [
      // 脚步闷响：低通噪声 + 低频正弦 thump
      { type: 'noise', gain: 0.8 },
      { type: 'osc', wave: 'sine', freq: 95, freqEnd: 45, glide: 0.18, gain: 0.9 },
      { type: 'filter', mode: 'lowpass', freq: 700, q: 1.2 },
      { type: 'filter', mode: 'highpass', freq: 40, q: 0.7 },
      { type: 'envelope', attack: 0.004, decay: 0.12, sustain: 0.05, release: 0.14, peak: 1.0 },
    ],
  },
  metal: {
    label: '金属碰撞',
    duration: 1.2,
    gain: 0.85,
    modules: [
      // 金属泛音：多组非谐波方波/三角波 + 高通噪声击打
      { type: 'osc', wave: 'square', freq: 1244, gain: 0.3 },
      { type: 'osc', wave: 'square', freq: 1879, detune: 6, gain: 0.22 },
      { type: 'osc', wave: 'triangle', freq: 2637, gain: 0.18 },
      { type: 'osc', wave: 'sine', freq: 311, gain: 0.4 },
      { type: 'noise', gain: 0.35 },
      { type: 'filter', mode: 'bandpass', freq: 1800, q: 1.1 },
      { type: 'filter', mode: 'highpass', freq: 150, q: 0.7 },
      { type: 'envelope', attack: 0.002, decay: 0.5, sustain: 0.02, release: 0.45, peak: 1.0 },
    ],
  },
};

export const PRESET_ORDER = ['door', 'footsteps', 'metal'];
