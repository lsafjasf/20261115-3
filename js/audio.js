// 根据路网密度变化的程序化音景：低频嗡鸣 + 高通滤波噪声，密度越高越急促
export class TrafficAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  // 浏览器要求用户手势后才能启动 AudioContext
  ensure() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // 1) 引擎嗡鸣：两个失谐锯齿波
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2.type = 'triangle';
    this.osc1.frequency.value = 70;
    this.osc2.frequency.value = 104;
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0.12;
    this.osc1.connect(this.oscGain);
    this.osc2.connect(this.oscGain);
    this.oscGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // 2) 车流噪声：白噪声经带通滤波
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.05;
    this.noise.connect(this.filter);
    this.filter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noise.start();

    this.started = true;
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, ctx.currentTime + 0.4);
  }

  // density: 0..1 归一化拥堵度；queueLive: 当前排队辆数
  update(density01, queueLive) {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const d = Math.max(0, Math.min(1, density01));
    // 密度上升 → 音高、滤波频率、音量同步抬升
    this.osc1.frequency.setTargetAtTime(60 + d * 90, t, 0.3);
    this.osc2.frequency.setTargetAtTime(95 + d * 130, t, 0.3);
    this.filter.frequency.setTargetAtTime(300 + d * 1400, t, 0.3);
    this.oscGain.gain.setTargetAtTime(0.08 + d * 0.16, t, 0.3);
    this.noiseGain.gain.setTargetAtTime(0.03 + d * 0.12, t, 0.3);
    // 排队越长，低频脉冲越明显（用主增益做轻微颤动）
    const pulse = 0.85 - Math.min(0.3, queueLive * 0.012);
    this.master.gain.setTargetAtTime(pulse, t, 0.5);
  }

  // 错误放行/冲突时的警示音
  blip() {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g); g.connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.started) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.1);
    }
    return this.muted;
  }
}
