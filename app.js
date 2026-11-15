(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const W = 1280;
  const H = 720;
  const BAND_COUNT = 84;
  const WAVE_COUNT = 160;
  const FFT_SIZE = 2048;
  const EXPORT_SECONDS = 10;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => {
    const x = clamp(t);
    return x * x * (3 - 2 * x);
  };

  const canvas = $("#visualCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;

  const ui = {
    engineDot: $("#engineDot"),
    engineStatus: $("#engineStatus"),
    audioDot: $("#audioDot"),
    audioState: $("#audioState"),
    sessionClock: $("#sessionClock"),
    pauseButton: $("#pauseButton"),
    playButton: $("#playButton"),
    playLabel: $("#playLabel"),
    promptStart: $("#promptStart"),
    canvasPrompt: $("#canvasPrompt"),
    canvasMode: $("#canvasMode"),
    canvasSignal: $("#canvasSignal"),
    pauseVeil: $("#pauseVeil"),
    frameCounter: $("#frameCounter"),
    transportState: $("#transportState"),
    timelineTime: $("#timelineTime"),
    timelineFill: $("#timelineFill"),
    timelinePlayhead: $("#timelinePlayhead"),
    smoothingRange: $("#smoothingRange"),
    smoothingValue: $("#smoothingValue"),
    sensitivityRange: $("#sensitivityRange"),
    sensitivityValue: $("#sensitivityValue"),
    envelopeMeter: $("#envelopeMeter"),
    envelopeReadout: $("#envelopeReadout"),
    beatMeter: $("#beatMeter"),
    beatReadout: $("#beatReadout"),
    detailLetter: $("#detailLetter"),
    detailTitle: $("#detailTitle"),
    detailCaption: $("#detailCaption"),
    detailText: $("#detailText"),
    modeFacts: $$(".mode-facts b"),
    modeCards: $$(".mode-card"),
    meterBars: $$(".meter-bars i"),
    audioBars: $$(".audio-status-grid i"),
    exportButton: $("#exportButton"),
    exportLabel: $("#exportLabel"),
    exportFormat: $("#exportFormat"),
    recIndicator: $("#recIndicator"),
    toast: $("#toast"),
  };

  const state = {
    mode: "envelope",
    smoothing: 0.72,
    sensitivity: 0.58,
    started: false,
    paused: false,
    isExporting: false,
    visualTime: 0,
    sessionSeconds: 0,
    resumeMix: 1,
    frame: 0,
    lastFrameTime: performance.now(),
    uiUpdateAt: 0,
    toastTimer: 0,
  };

  const modeContent = {
    envelope: {
      letter: "A",
      title: "连续读取频谱轮廓",
      caption: "CONTINUOUS / FULL-BAND",
      text:
        "将 30 Hz — 16 kHz 的频谱形状连续映射到环形色阶。灵敏度放大幅度，平滑改变轮廓跟随速度；适合观察声音质感与频段结构。",
      facts: ["连续", "无", "塑形"],
      canvasLabel: "A / SPECTRAL ENVELOPE",
      accent: "#dfff63",
    },
    beat: {
      letter: "B",
      title: "只对声音攻击点响应",
      caption: "EVENT-BASED / ONSET",
      text:
        "以低频能量与谱通量组成自适应门限，仅在攻击点产生脉冲。灵敏度降低触发门槛，平滑延长视觉余辉；适合跟随节奏与重音。",
      facts: ["脉冲", "门限", "余辉"],
      canvasLabel: "B / BEAT DETECTION",
      accent: "#ff7957",
    },
  };

  class SyntheticEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.compressor = null;
      this.analyser = null;
      this.captureDestination = null;
      this.noiseBuffer = null;
      this.padNodes = [];
      this.sequenceTimer = 0;
      this.nextStepTime = 0;
      this.step = 0;
      this.kickPulse = 0;
      this.hatPulse = 0;
      this.bassPulse = 0;
    }

    async init() {
      if (this.context) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("此浏览器不支持 Web Audio");

      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.7;

      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.22;

      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.12;
      this.analyser.minDecibels = -92;
      this.analyser.maxDecibels = -12;

      this.master.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.context.destination);

      this.captureDestination = this.context.createMediaStreamDestination();
      this.compressor.connect(this.captureDestination);

      this.noiseBuffer = this.createNoiseBuffer();
      this.createPad();
    }

    createNoiseBuffer() {
      const length = Math.floor(this.context.sampleRate * 1.5);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    createPad() {
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 680;
      filter.Q.value = 0.45;

      const padGain = this.context.createGain();
      padGain.gain.value = 0.028;
      filter.connect(padGain);
      padGain.connect(this.master);

      [55, 82.4, 110].forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        oscillator.type = index === 2 ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        oscillator.detune.value = index === 1 ? 7 : -4;

        const localGain = this.context.createGain();
        localGain.gain.value = index === 2 ? 0.36 : 0.68;
        oscillator.connect(localGain);
        localGain.connect(filter);

        const lfo = this.context.createOscillator();
        const lfoGain = this.context.createGain();
        lfo.frequency.value = 0.09 + index * 0.031;
        lfoGain.gain.value = index === 2 ? 85 : 180;
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);

        oscillator.start();
        lfo.start();
        this.padNodes.push(oscillator, lfo);
      });
    }

    async start() {
      await this.init();
      await this.context.resume();
      this.nextStepTime = this.context.currentTime + 0.07;
      this.startScheduler();
    }

    async pause() {
      if (!this.context) return;
      this.stopScheduler();
      await this.context.suspend();
    }

    async resume() {
      if (!this.context) {
        await this.start();
        return;
      }
      if (this.context.state === "suspended") await this.context.resume();
      this.nextStepTime = this.context.currentTime + 0.06;
      this.startScheduler();
    }

    startScheduler() {
      this.stopScheduler();
      this.scheduleWindow();
      this.sequenceTimer = window.setInterval(() => this.scheduleWindow(), 25);
    }

    stopScheduler() {
      if (this.sequenceTimer) {
        window.clearInterval(this.sequenceTimer);
        this.sequenceTimer = 0;
      }
    }

    scheduleWindow() {
      if (!this.context || this.context.state !== "running") return;
      const now = this.context.currentTime;
      const stepDuration = 60 / 112 / 4;
      while (this.nextStepTime < now + 0.16) {
        this.scheduleStep(this.step, this.nextStepTime);
        this.step = (this.step + 1) % 64;
        this.nextStepTime += stepDuration;
      }
    }

    scheduleStep(step, time) {
      if (step % 4 === 0) this.scheduleKick(time);
      if (step % 2 === 0) this.scheduleHat(time, step % 8 === 4);
      if (step % 4 === 2) this.scheduleBass(time, step);
      if (step === 0 || step === 32) this.scheduleSweep(time);
    }

    scheduleKick(time) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(112, time);
      oscillator.frequency.exponentialRampToValueAtTime(43, time + 0.19);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.46, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.27);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(time);
      oscillator.stop(time + 0.29);
      this.kickPulse = 1;
    }

    scheduleHat(time, accent) {
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "highpass";
      filter.frequency.value = accent ? 5200 : 6800;
      filter.Q.value = 0.7;
      gain.gain.setValueAtTime(accent ? 0.075 : 0.042, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + (accent ? 0.075 : 0.045));
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(time);
      source.stop(time + 0.09);
      this.hatPulse = 1;
    }

    scheduleBass(time, step) {
      const notes = [55, 55, 65.41, 49, 55, 73.42, 65.41, 49];
      const frequency = notes[Math.floor(step / 4) % notes.length];
      const oscillator = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();

      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(440, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + 0.32);
      filter.Q.value = 3.8;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.16, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.42);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      oscillator.start(time);
      oscillator.stop(time + 0.44);
      this.bassPulse = 1;
    }

    scheduleSweep(time) {
      const oscillator = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(160, time);
      oscillator.frequency.exponentialRampToValueAtTime(760, time + 0.7);
      filter.type = "bandpass";
      filter.Q.value = 5;
      filter.frequency.setValueAtTime(480, time);
      filter.frequency.exponentialRampToValueAtTime(2600, time + 0.7);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.021, time + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.78);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      oscillator.start(time);
      oscillator.stop(time + 0.8);
    }

    triggerCue(strength = 1) {
      if (!this.context || this.context.state !== "running") return;
      const time = this.context.currentTime + 0.012;
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const first = this.context.createOscillator();
      const second = this.context.createOscillator();

      filter.type = "bandpass";
      filter.frequency.value = 1550;
      filter.Q.value = 2.4;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.055 * clamp(strength), time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);

      first.type = "sine";
      second.type = "triangle";
      first.frequency.value = 1244;
      second.frequency.value = 1865;
      first.connect(gain);
      second.connect(gain);
      gain.connect(filter);
      filter.connect(this.master);
      first.start(time);
      second.start(time);
      first.stop(time + 0.09);
      second.stop(time + 0.09);
    }

    updatePulses(dt) {
      this.kickPulse *= Math.exp(-dt * 7.5);
      this.hatPulse *= Math.exp(-dt * 12);
      this.bassPulse *= Math.exp(-dt * 4.8);
    }

    getStream() {
      return this.captureDestination ? this.captureDestination.stream : null;
    }
  }

  class SpectralAnalyzer {
    constructor(engine) {
      this.engine = engine;
      this.frequencyData = new Uint8Array(FFT_SIZE / 2);
      this.timeData = new Uint8Array(FFT_SIZE);
      this.previousFrequency = new Float32Array(FFT_SIZE / 2);
      this.bandTargets = new Float32Array(BAND_COUNT);
      this.waveTargets = new Float32Array(WAVE_COUNT);
      this.fluxHistory = [];
      this.previousLow = 0;
      this.previousRms = 0;
      this.safeFrames = 0;
      this.lastBeatAt = -Infinity;
      this.beatStrength = 0;
      this.beatEnvelope = 0;
      this.beatFlash = 0;
      this.envelope = 0;
      this.lowEnergy = 0;
      this.midEnergy = 0;
      this.highEnergy = 0;
      this.rms = 0;
      this.onset = 0;
      this.beatCount = 0;
      this.bursts = [];
      this.bandEdges = this.createLogBandEdges(BAND_COUNT);
    }

    createLogBandEdges(count) {
      const edges = new Uint16Array(count + 1);
      const minFrequency = 30;
      const maxFrequency = 16000;
      const maxBin = 1023;
      for (let i = 0; i <= count; i += 1) {
        const ratio = i / count;
        const frequency = minFrequency * Math.pow(maxFrequency / minFrequency, ratio);
        edges[i] = clamp(Math.round((frequency / 24000) * maxBin), 1, maxBin - 1);
      }
      return edges;
    }

    averageBand(start, end) {
      let sum = 0;
      let count = 0;
      for (let i = start; i <= end && i < this.frequencyData.length; i += 1) {
        sum += this.frequencyData[i];
        count += 1;
      }
      return count ? sum / count / 255 : 0;
    }

    update(dt, smoothing, sensitivity, allowBeat) {
      const analyser = this.engine.analyser;
      if (!analyser) return;

      analyser.getByteFrequencyData(this.frequencyData);
      analyser.getByteTimeDomainData(this.timeData);

      for (let i = 0; i < BAND_COUNT; i += 1) {
        const start = this.bandEdges[i];
        const end = this.bandEdges[i + 1];
        let sum = 0;
        for (let bin = start; bin <= end; bin += 1) sum += this.frequencyData[bin];
        const value = clamp((sum / Math.max(1, end - start + 1)) / 255);
        this.bandTargets[i] = Math.pow(value, 0.72);
      }

      const stride = Math.max(1, Math.floor(this.timeData.length / WAVE_COUNT));
      let squareSum = 0;
      for (let i = 0; i < WAVE_COUNT; i += 1) {
        const value = (this.timeData[i * stride] - 128) / 128;
        this.waveTargets[i] = value;
        squareSum += value * value;
      }
      this.rms = Math.sqrt(squareSum / WAVE_COUNT);

      this.lowEnergy = this.averageBand(1, 23);
      this.midEnergy = this.averageBand(24, 180);
      this.highEnergy = this.averageBand(181, 520);
      this.envelope = clamp(this.lowEnergy * 0.37 + this.midEnergy * 0.45 + this.highEnergy * 0.18);

      let lowFlux = 0;
      let fullFlux = 0;
      for (let i = 1; i < 180; i += 1) {
        const value = this.frequencyData[i] / 255;
        const delta = value - this.previousFrequency[i];
        if (i < 26) lowFlux += Math.max(0, delta);
        fullFlux += Math.max(0, delta);
        this.previousFrequency[i] = value;
      }

      const lowDelta = Math.max(0, this.lowEnergy - this.previousLow);
      const rmsDelta = Math.max(0, this.rms - this.previousRms);
      this.previousLow = this.lowEnergy;
      this.previousRms = this.rms;

      const rawOnset = lowFlux * 0.72 + fullFlux * 0.085 + lowDelta * 2.1 + rmsDelta * 0.32;
      this.onset = rawOnset;
      this.fluxHistory.push(rawOnset);
      if (this.fluxHistory.length > 42) this.fluxHistory.shift();
      this.safeFrames += 1;

      const history = this.fluxHistory;
      const mean = history.reduce((sum, value) => sum + value, 0) / Math.max(1, history.length);
      let variance = 0;
      for (const value of history) variance += (value - mean) ** 2;
      const deviation = Math.sqrt(variance / Math.max(1, history.length));
      const threshold = Math.max(0.008, mean + deviation * (1.4 - sensitivity * 0.92));
      const now = performance.now();
      const refractory = 142 + smoothing * 85;

      const isBeat =
        allowBeat &&
        this.safeFrames > 28 &&
        rawOnset > threshold &&
        rawOnset > 0.026 &&
        now - this.lastBeatAt > refractory;

      if (isBeat) {
        this.lastBeatAt = now;
        this.beatCount += 1;
        this.beatStrength = clamp((rawOnset - threshold) / Math.max(0.04, threshold * 2.8) + 0.52);
        this.beatEnvelope = 1;
        this.beatFlash = 1;
        this.bursts.push({ age: 0, strength: this.beatStrength });
        if (this.bursts.length > 6) this.bursts.shift();
        this.engine.triggerCue(this.beatStrength);
      }

      const decay = 0.13 + smoothing * 0.52;
      this.beatEnvelope *= Math.exp(-dt / decay);
      this.beatFlash *= Math.exp(-dt * (7 - smoothing * 3.6));
      this.beatStrength *= Math.exp(-dt * 5.5);
      for (const burst of this.bursts) burst.age += dt;
      this.bursts = this.bursts.filter((burst) => burst.age < 1.5);
    }
  }

  const engine = new SyntheticEngine();
  const analyzer = new SpectralAnalyzer(engine);

  const visual = {
    bands: new Float32Array(BAND_COUNT),
    wave: new Float32Array(WAVE_COUNT),
    renderBands: new Float32Array(BAND_COUNT),
    renderWave: new Float32Array(WAVE_COUNT),
    envelope: 0,
    renderEnvelope: 0,
    beat: 0,
    renderBeat: 0,
    flash: 0,
    low: 0,
    mid: 0,
    high: 0,
    rms: 0,
    frozen: null,
  };

  const idleState = {
    beatPhase: 0,
  };

  function fillIdleVisual(dt, time) {
    idleState.beatPhase += dt / 1.07;
    if (idleState.beatPhase >= 1) idleState.beatPhase -= 1;
    const pulse = Math.exp(-Math.pow((idleState.beatPhase - 0.08) / 0.12, 2));
    const drift = time * 0.38;
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const p = i / (BAND_COUNT - 1);
      const lowPeak = Math.exp(-Math.pow((p - 0.13) / 0.11, 2)) * 0.74;
      const midPeak = Math.exp(-Math.pow((p - 0.42) / 0.18, 2)) * 0.58;
      const highPeak = Math.exp(-Math.pow((p - 0.79) / 0.25, 2)) * 0.26;
      const ripple = 0.72 + 0.28 * Math.sin(drift + p * 29);
      visual.bands[i] = clamp((lowPeak + midPeak + highPeak) * ripple * (0.72 + pulse * 0.24));
    }
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      const p = i / WAVE_COUNT;
      visual.wave[i] =
        Math.sin(p * TAU * 3 + time * 0.9) * 0.022 +
        Math.sin(p * TAU * 7 - time * 0.45) * 0.011;
    }
    visual.envelope = 0.34 + Math.sin(time * 0.6) * 0.05 + pulse * 0.08;
    visual.beat = pulse * 0.72;
    visual.flash = pulse;
    visual.low = 0.36 + pulse * 0.2;
    visual.mid = 0.31;
    visual.high = 0.22;
    visual.rms = 0.24;
    visual.renderBands.set(visual.bands);
    visual.renderWave.set(visual.wave);
    visual.renderEnvelope = visual.envelope;
    visual.renderBeat = visual.beat;
  }

  function freezeVisual() {
    visual.frozen = {
      bands: new Float32Array(visual.renderBands),
      wave: new Float32Array(visual.renderWave),
      envelope: visual.renderEnvelope,
      beat: visual.renderBeat,
      flash: visual.flash,
      rms: visual.rms,
    };
  }

  function beginSoftTransition() {
    freezeVisual();
    state.resumeMix = 0;
  }

  function updateVisual(dt) {
    if (!state.started) {
      fillIdleVisual(dt, state.visualTime);
      return;
    }

    const allowBeat = state.resumeMix > 0.68;
    analyzer.update(dt, state.smoothing, state.sensitivity, allowBeat);

    const bandTime = 0.032 + state.smoothing * 0.25;
    const waveTime = 0.02 + state.smoothing * 0.13;
    const bandAlpha = 1 - Math.exp(-dt / bandTime);
    const waveAlpha = 1 - Math.exp(-dt / waveTime);
    const envelopeAlpha = 1 - Math.exp(-dt / (0.035 + state.smoothing * 0.2));

    for (let i = 0; i < BAND_COUNT; i += 1) {
      visual.bands[i] += (analyzer.bandTargets[i] - visual.bands[i]) * bandAlpha;
    }
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      visual.wave[i] += (analyzer.waveTargets[i] - visual.wave[i]) * waveAlpha;
    }

    const energyGain = 0.78 + state.sensitivity * 0.58;
    visual.envelope += (clamp(analyzer.envelope * energyGain) - visual.envelope) * envelopeAlpha;
    visual.beat = clamp(analyzer.beatEnvelope * (0.72 + state.sensitivity * 0.62));
    visual.flash = analyzer.beatFlash;
    visual.low = analyzer.lowEnergy;
    visual.mid = analyzer.midEnergy;
    visual.high = analyzer.highEnergy;
    visual.rms = analyzer.rms;

    state.resumeMix = Math.min(1, state.resumeMix + dt / 1.25);
    const mix = smoothstep(state.resumeMix);
    if (visual.frozen && mix < 1) {
      for (let i = 0; i < BAND_COUNT; i += 1) {
        visual.renderBands[i] = lerp(visual.frozen.bands[i], visual.bands[i], mix);
      }
      for (let i = 0; i < WAVE_COUNT; i += 1) {
        visual.renderWave[i] = lerp(visual.frozen.wave[i], visual.wave[i], mix);
      }
      visual.renderEnvelope = lerp(visual.frozen.envelope, visual.envelope, mix);
      visual.renderBeat = lerp(visual.frozen.beat, visual.beat, mix);
    } else {
      visual.renderBands.set(visual.bands);
      visual.renderWave.set(visual.wave);
      visual.renderEnvelope = visual.envelope;
      visual.renderBeat = visual.beat;
      visual.frozen = null;
    }
  }

  function colorMix(colors, t) {
    const scaled = clamp(t) * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(scaled));
    const local = scaled - index;
    const a = colors[index];
    const b = colors[index + 1];
    return [
      Math.round(lerp(a[0], b[0], local)),
      Math.round(lerp(a[1], b[1], local)),
      Math.round(lerp(a[2], b[2], local)),
    ];
  }

  const spectrumPalette = [
    [74, 226, 202],
    [123, 245, 201],
    [216, 247, 105],
    [255, 193, 93],
    [255, 116, 83],
    [244, 67, 130],
  ];

  const beatPalette = [
    [255, 112, 77],
    [255, 169, 91],
    [255, 211, 118],
    [255, 84, 139],
  ];

  function rgba(color, alpha) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
  }

  function spectrumColor(t, alpha = 1) {
    const rgb = colorMix(spectrumPalette, t);
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  function accentForMode() {
    return state.mode === "beat" ? "#ff7957" : "#dfff63";
  }

  function drawBackground(v) {
    ctx.fillStyle = "#050806";
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, H * 0.47, 20, W / 2, H * 0.47, W * 0.58);
    glow.addColorStop(0, `rgba(33, 83, 65, ${0.16 + v.renderEnvelope * 0.11})`);
    glow.addColorStop(0.42, "rgba(14, 35, 27, 0.12)");
    glow.addColorStop(1, "rgba(3, 6, 4, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.62);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGrid(v, time) {
    const cx = W / 2;
    const cy = H * 0.47;
    const energy = v.renderEnvelope;
    const pulse = v.renderBeat;
    const gridAlpha = 0.055 + energy * 0.07 + pulse * 0.105;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(116, 207, 169, ${gridAlpha})`;

    for (let i = 0; i < 36; i += 1) {
      const angle = (i / 36) * TAU + time * 0.008;
      const startRadius = 242 + Math.sin(i * 1.7 + time) * 6;
      const bandValue = v.renderBands[Math.floor((i / 36) * BAND_COUNT)] || 0;
      const endRadius = 650 - bandValue * 44 - pulse * 18;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * startRadius, cy + Math.sin(angle) * startRadius);
      ctx.lineTo(cx + Math.cos(angle) * endRadius, cy + Math.sin(angle) * endRadius);
      ctx.stroke();
    }

    const ringRadii = [258, 322, 414, 522, 638];
    ringRadii.forEach((radius, index) => {
      const radiusPulse = radius + Math.sin(time * 0.5 + index) * 2 + pulse * (index * 1.2);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(116, 207, 169, ${gridAlpha * (0.55 + index * 0.07)})`;
      ctx.setLineDash(index % 2 ? [2, 12] : []);
      ctx.arc(cx, cy, radiusPulse, 0, TAU);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const horizon = cy + 44;
    const floorAlpha = gridAlpha * 0.9;
    for (let i = -16; i <= 16; i += 1) {
      const bottomX = cx + i * 92;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(128, 201, 173, ${floorAlpha * 0.54})`;
      ctx.moveTo(cx, horizon);
      ctx.lineTo(bottomX, H);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i += 1) {
      const progress = ((time * 0.035 + i / 14) % 1) ** 2.25;
      const y = lerp(horizon, H + 20, progress);
      const alpha = floorAlpha * Math.sin(progress * Math.PI) * 0.7;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(128, 201, 173, ${alpha})`;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(213, 255, 111, ${0.035 + pulse * 0.08})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 231 + pulse * 8, -Math.PI * 0.78, Math.PI * 0.17);
    ctx.stroke();
    ctx.restore();
  }

  function drawAuroraBands(v, time) {
    const x0 = 64;
    const x1 = W - 64;
    const layers = [
      { y: 126, height: 44, color: [90, 246, 204], offset: 0.1, strength: 0.72 },
      { y: 191, height: 36, color: [223, 255, 99], offset: -0.2, strength: 0.58 },
      { y: 255, height: 29, color: [255, 103, 85], offset: 0.34, strength: 0.44 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const layer of layers) {
      const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
      gradient.addColorStop(0, rgba(layer.color, 0));
      gradient.addColorStop(0.18, rgba(layer.color, 0.05 + v.renderEnvelope * 0.035));
      gradient.addColorStop(0.52, rgba(layer.color, 0.11 + v.renderEnvelope * 0.1));
      gradient.addColorStop(0.82, rgba(layer.color, 0.045));
      gradient.addColorStop(1, rgba(layer.color, 0));

      ctx.beginPath();
      for (let i = 0; i <= BAND_COUNT; i += 1) {
        const bandIndex = Math.min(BAND_COUNT - 1, i);
        const x = lerp(x0, x1, i / BAND_COUNT);
        const band = v.renderBands[bandIndex];
        const wave = Math.sin(i * 0.26 + time * 0.65 + layer.offset) * 4;
        const y = layer.y + wave - band * 22 * layer.strength - v.renderBeat * 9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = BAND_COUNT; i >= 0; i -= 1) {
        const bandIndex = Math.min(BAND_COUNT - 1, i);
        const x = lerp(x0, x1, i / BAND_COUNT);
        const band = v.renderBands[bandIndex];
        const wave = Math.sin(i * 0.26 + time * 0.65 + layer.offset) * 4;
        const y =
          layer.y +
          wave +
          layer.height +
          band * layer.height * 1.7 * layer.strength +
          v.renderBeat * 16;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = rgba(layer.color, 0.12 + v.renderEnvelope * 0.16 + v.renderBeat * 0.1);
      ctx.lineWidth = 1;
      for (let i = 0; i <= BAND_COUNT; i += 1) {
        const band = v.renderBands[i];
        const x = lerp(x0, x1, i / BAND_COUNT);
        const y =
          layer.y +
          Math.sin(i * 0.26 + time * 0.65 + layer.offset) * 4 -
          band * 22 * layer.strength -
          v.renderBeat * 9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpectrumBands(v, time) {
    const left = 68;
    const right = W - 68;
    const baseline = H - 64;
    const maxHeight = 166;
    const slot = (right - left) / BAND_COUNT;
    const barWidth = Math.max(2, slot - 3.1);
    const envelopeMode = state.mode === "envelope";
    const tops = new Float32Array(BAND_COUNT);

    ctx.save();
    const floorWash = ctx.createLinearGradient(0, baseline - 190, 0, H);
    floorWash.addColorStop(0, "rgba(7, 13, 9, 0)");
    floorWash.addColorStop(0.55, `rgba(22, 51, 37, ${0.08 + v.renderEnvelope * 0.05})`);
    floorWash.addColorStop(1, "rgba(3, 6, 4, 0)");
    ctx.fillStyle = floorWash;
    ctx.fillRect(left - 12, baseline - 190, right - left + 24, H - baseline + 190);

    for (let i = 0; i < BAND_COUNT; i += 1) {
      const p = i / (BAND_COUNT - 1);
      const band = v.renderBands[i];
      let height;
      if (envelopeMode) {
        height = 4 + band * (92 + v.renderEnvelope * 56) + v.renderEnvelope * 8;
      } else {
        const beatProfile = 0.5 + 0.5 * Math.sin(p * Math.PI);
        height = 3 + band * 27 + v.renderBeat * (42 + beatProfile * 72);
      }
      height = clamp(height, 2, maxHeight);
      tops[i] = baseline - height;
      const x = left + i * slot;
      const color = spectrumColor(p, 1);
      const gradient = ctx.createLinearGradient(0, baseline - height, 0, baseline);
      gradient.addColorStop(0, spectrumColor(p, 0.9));
      gradient.addColorStop(0.45, spectrumColor(p, 0.58));
      gradient.addColorStop(1, spectrumColor(p, 0.16));

      ctx.fillStyle = gradient;
      ctx.fillRect(x, baseline - height, barWidth, height);

      ctx.fillStyle = spectrumColor(p, 0.9);
      ctx.fillRect(x, baseline - height, barWidth, Math.min(2.2, height));

      ctx.fillStyle = spectrumColor(p, 0.075 + v.renderEnvelope * 0.05);
      const mirrorHeight = Math.min(34, height * 0.24);
      ctx.fillRect(x, baseline + 3, barWidth, mirrorHeight);

      if (i % 7 === 0) {
        ctx.fillStyle = "rgba(226, 239, 222, 0.48)";
        ctx.fillRect(Math.round(x + barWidth / 2), baseline - height - 9, 1, 5);
      }
    }

    ctx.beginPath();
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const x = left + i * slot + barWidth / 2;
      if (i === 0) ctx.moveTo(x, tops[i]);
      else ctx.lineTo(x, tops[i]);
    }
    ctx.strokeStyle = envelopeMode
      ? `rgba(223, 255, 99, ${0.32 + v.renderEnvelope * 0.26})`
      : `rgba(255, 121, 87, ${0.3 + v.renderBeat * 0.46})`;
    ctx.lineWidth = 1.15;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(left, baseline);
    for (let i = 0; i < BAND_COUNT; i += 1) {
      ctx.lineTo(left + i * slot + barWidth / 2, tops[i]);
    }
    ctx.lineTo(right, baseline);
    ctx.closePath();
    const area = ctx.createLinearGradient(0, baseline - maxHeight, 0, baseline);
    area.addColorStop(0, `rgba(223, 255, 99, ${0.03 + v.renderEnvelope * 0.05})`);
    area.addColorStop(1, "rgba(223, 255, 99, 0)");
    ctx.fillStyle = area;
    ctx.fill();

    ctx.strokeStyle = "rgba(194, 220, 198, 0.17)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, baseline + 0.5);
    ctx.lineTo(right, baseline + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawFrequencyRuler() {
    const left = 68;
    const right = W - 68;
    const y = H - 38;
    const minFrequency = 30;
    const maxFrequency = 16000;
    const marks = [
      [30, "30"],
      [120, "120"],
      [500, "500"],
      [2000, "2K"],
      [8000, "8K"],
      [16000, "16K"],
    ];

    ctx.save();
    ctx.font = "7px 'SFMono-Regular', 'Liberation Mono', monospace";
    ctx.textBaseline = "top";
    for (const [frequency, label] of marks) {
      const ratio = Math.log(frequency / minFrequency) / Math.log(maxFrequency / minFrequency);
      const x = lerp(left, right, ratio);
      ctx.strokeStyle = "rgba(204, 223, 203, 0.17)";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y - 4);
      ctx.lineTo(x + 0.5, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(204, 223, 203, 0.4)";
      ctx.textAlign = ratio > 0.92 ? "right" : ratio < 0.08 ? "left" : "center";
      ctx.fillText(`${label} HZ`, x, y + 4);
    }
    ctx.restore();
  }

  function drawRing(v, time) {
    const cx = W / 2;
    const cy = H * 0.47;
    const beatMode = state.mode === "beat";
    const pulse = v.renderBeat;
    const radius = 172 + (beatMode ? pulse * 20 : v.renderEnvelope * 9);
    const accent = beatMode ? [255, 121, 87] : [223, 255, 99];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.58, cx, cy, radius * 1.75);
    halo.addColorStop(0, `rgba(${accent.join(",")}, ${0.015 + pulse * 0.03})`);
    halo.addColorStop(0.55, `rgba(${accent.join(",")}, ${0.024 + v.renderEnvelope * 0.025})`);
    halo.addColorStop(1, `rgba(${accent.join(",")}, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2 + Math.sin(time * 0.12) * 0.018);

    for (let i = 0; i < BAND_COUNT; i += 1) {
      const p = i / (BAND_COUNT - 1);
      const band = v.renderBands[i];
      const angle = (i / BAND_COUNT) * TAU;
      const length = beatMode
        ? 5 + band * 25 + pulse * (24 + p * 46)
        : 5 + band * (46 + v.renderEnvelope * 30) + v.renderEnvelope * 5;
      const inner = radius + 21;
      const outer = inner + length;
      ctx.beginPath();
      ctx.strokeStyle = spectrumColor(p, 0.35 + band * 0.58 + pulse * 0.08);
      ctx.lineWidth = beatMode ? 1.45 + pulse * 0.9 : 1.25 + band * 0.7;
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.lineWidth = 1;
    ctx.setLineDash([1, 7]);
    ctx.strokeStyle = `rgba(210, 235, 208, ${0.2 + v.renderEnvelope * 0.12})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = `rgba(${accent.join(",")}, ${0.25 + pulse * 0.18})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = "rgba(196, 230, 201, 0.12)";
    ctx.beginPath();
    ctx.arc(0, 0, radius - 49, 0, TAU);
    ctx.stroke();

    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * TAU;
      const major = i % 4 === 0;
      const markerRadius = radius - 101;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(219, 239, 218, ${major ? 0.34 : 0.13})`;
      ctx.lineWidth = major ? 1.3 : 0.7;
      ctx.moveTo(
        Math.cos(angle) * markerRadius,
        Math.sin(angle) * markerRadius,
      );
      ctx.lineTo(
        Math.cos(angle) * (markerRadius - (major ? 7 : 3)),
        Math.sin(angle) * (markerRadius - (major ? 7 : 3)),
      );
      ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i <= WAVE_COUNT; i += 1) {
      const index = i % WAVE_COUNT;
      const angle = (i / WAVE_COUNT) * TAU;
      const wave = v.renderWave[index];
      const wobble = Math.sin(i * 0.18 + time * 1.3) * (0.6 + v.renderEnvelope * 0.9);
      const waveRadius = radius - 26 + wave * 112 + wobble + (beatMode ? pulse * 4 : 0);
      const x = Math.cos(angle) * waveRadius;
      const y = Math.sin(angle) * waveRadius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = beatMode
      ? `rgba(255, 164, 119, ${0.7 + pulse * 0.2})`
      : "rgba(122, 245, 204, 0.76)";
    ctx.lineWidth = 1.35;
    ctx.stroke();

    const innerGlow = ctx.createRadialGradient(0, 0, 12, 0, 0, radius - 38);
    innerGlow.addColorStop(0, "rgba(12, 20, 14, 0.96)");
    innerGlow.addColorStop(0.68, "rgba(8, 14, 10, 0.7)");
    innerGlow.addColorStop(1, "rgba(7, 12, 9, 0)");
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 41, 0, TAU);
    ctx.fill();

    ctx.rotate(Math.PI / 2 - Math.sin(time * 0.12) * 0.018);
    drawRingCore(v, radius, time);
    ctx.restore();

    for (const burst of analyzer.bursts) {
      const progress = clamp(burst.age / 1.3);
      const burstRadius = radius + 28 + progress * 235;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 121, 87, ${(1 - progress) * 0.22 * burst.strength})`;
      ctx.lineWidth = 2.6 * (1 - progress) + 0.4;
      ctx.arc(cx, cy, burstRadius, 0, TAU);
      ctx.stroke();
    }
  }

  function drawRingCore(v, radius, time) {
    const beatMode = state.mode === "beat";
    const accent = beatMode ? [255, 121, 87] : [223, 255, 99];
    const coreRadius = 53;

    ctx.save();
    const disc = ctx.createRadialGradient(0, 0, 4, 0, 0, coreRadius);
    disc.addColorStop(0, "rgba(21, 34, 25, 0.96)");
    disc.addColorStop(1, "rgba(6, 10, 7, 0.94)");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = `rgba(${accent.join(",")}, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius, 0, TAU);
    ctx.stroke();

    const level = beatMode ? v.renderBeat : v.renderEnvelope;
    ctx.strokeStyle = `rgba(${accent.join(",")}, 0.9)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius - 2, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(level));
    ctx.stroke();

    ctx.font = "500 34px 'Arial Narrow', 'Roboto Condensed', sans-serif";
    ctx.fillStyle = `rgb(${accent.join(",")})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(beatMode ? "B" : "A", 0, -2);

    ctx.font = "6px 'SFMono-Regular', 'Liberation Mono', monospace";
    ctx.fillStyle = "rgba(214, 231, 211, 0.54)";
    ctx.letterSpacing = "0.12em";
    ctx.fillText(beatMode ? "ONSET" : "ENVELOPE", 0, 27);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = `rgba(${accent.join(",")}, 0.25)`;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 4; i += 1) {
      const angle = -Math.PI / 2 + i * (TAU / 4);
      const x = Math.cos(angle) * (coreRadius + 9);
      const y = Math.sin(angle) * (coreRadius + 9);
      ctx.beginPath();
      ctx.moveTo(x * 0.96, y * 0.96);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSweep(v, time) {
    const angle = time * 0.26 - Math.PI / 2;
    const length = 245 + v.renderEnvelope * 46 + v.renderBeat * 38;
    ctx.save();
    ctx.translate(W / 2, H * 0.47);
    ctx.rotate(angle);
    const gradient = ctx.createLinearGradient(150, 0, length, 0);
    gradient.addColorStop(0, "rgba(223, 255, 99, 0)");
    gradient.addColorStop(0.62, `rgba(223, 255, 99, ${0.02 + v.renderEnvelope * 0.09})`);
    gradient.addColorStop(1, "rgba(223, 255, 99, 0)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(146, 0);
    ctx.lineTo(length, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawCanvasHud(v, time) {
    const activeLabel = state.mode === "beat" ? "BEAT / EVENT" : "ENVELOPE / CONTINUOUS";
    const activeColor = state.mode === "beat" ? "rgba(255, 143, 107, 0.68)" : "rgba(223, 255, 99, 0.64)";

    ctx.save();
    ctx.font = "7px 'SFMono-Regular', 'Liberation Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = "0.12em";
    ctx.fillStyle = activeColor;
    ctx.textAlign = "left";
    ctx.fillText(activeLabel, 68, 76);

    ctx.fillStyle = "rgba(207, 224, 205, 0.34)";
    ctx.textAlign = "right";
    ctx.fillText(`BEATS  ${String(analyzer.beatCount).padStart(3, "0")}`, W - 68, 76);

    const cx = W / 2;
    const cy = H * 0.47;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(206, 224, 205, 0.29)";
    ctx.fillText(
      state.mode === "beat" ? "ADAPTIVE ONSET GATE" : "LOG SPECTRAL ENVELOPE",
      cx,
      cy + 221,
    );

    ctx.strokeStyle = "rgba(208, 228, 206, 0.13)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - 54, cy + 205);
    ctx.lineTo(cx - 72, cy + 205);
    ctx.moveTo(cx + 54, cy + 205);
    ctx.lineTo(cx + 72, cy + 205);
    ctx.stroke();

    ctx.fillStyle = "rgba(204, 222, 202, 0.26)";
    ctx.textAlign = "left";
    ctx.fillText(`${(30 + v.low * 42).toFixed(0)} HZ`, 68, H - 22);
    ctx.textAlign = "right";
    ctx.fillText(`RMS ${(v.rms * 100).toFixed(1)}`, W - 68, H - 22);

    const scanAlpha = 0.012 + v.renderEnvelope * 0.013;
    ctx.strokeStyle = `rgba(214, 235, 211, ${scanAlpha})`;
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 5) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawScene() {
    const v = visual;
    drawBackground(v);
    drawGrid(v, state.visualTime);
    drawAuroraBands(v, state.visualTime);
    drawSweep(v, state.visualTime);
    drawSpectrumBands(v, state.visualTime);
    drawRing(v, state.visualTime);
    drawFrequencyRuler();
    drawCanvasHud(v, state.visualTime);
  }

  function setMode(mode, announce = false) {
    if (state.isExporting || !modeContent[mode]) return;
    state.mode = mode;
    const content = modeContent[mode];

    for (const card of ui.modeCards) {
      const active = card.dataset.mode === mode;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
    }

    ui.detailLetter.textContent = content.letter;
    ui.detailTitle.textContent = content.title;
    ui.detailCaption.textContent = content.caption;
    ui.detailText.textContent = content.text;
    ui.modeFacts.forEach((fact, index) => {
      fact.textContent = content.facts[index];
    });
    ui.canvasMode.textContent = content.canvasLabel;
    ui.detailLetter.style.background = content.accent;
    ui.detailLetter.style.color = mode === "beat" ? "#190b07" : "#10150d";

    if (announce) {
      showToast(
        mode === "envelope"
          ? "模式 A：连续频谱包络，平滑塑造轮廓"
          : "模式 B：攻击点触发，脉冲与余辉跟随节拍",
      );
    }
  }

  function setControlAvailability(disabled) {
    ui.playButton.disabled = disabled;
    ui.pauseButton.disabled = disabled || !state.started;
    ui.smoothingRange.disabled = disabled;
    ui.sensitivityRange.disabled = disabled;
    for (const card of ui.modeCards) card.disabled = disabled;
    $("#canvasWrap").classList.toggle("is-locked", disabled);
  }

  function syncPlaybackUi() {
    const playing = state.started && !state.paused;
    ui.playButton.classList.toggle("is-playing", playing);
    ui.playButton.disabled = state.isExporting;
    ui.playLabel.textContent = !state.started ? "PLAY" : state.paused ? "RESUME" : "PAUSE";
    ui.playButton.setAttribute("aria-label", playing ? "暂停合成器" : "播放合成器");

    ui.pauseButton.disabled = !state.started || state.isExporting;
    ui.pauseButton.classList.toggle("is-paused", state.paused);
    ui.pauseButton.setAttribute("aria-label", state.paused ? "继续播放" : "暂停画面");

    ui.engineDot.classList.toggle("is-live", playing);
    ui.audioDot.classList.toggle("is-live", playing);
    ui.engineStatus.textContent = !state.started
      ? "ENGINE STANDBY"
      : state.paused
        ? "SIGNAL HELD"
        : "ENGINE LIVE";
    ui.audioState.textContent = !state.started ? "STANDBY" : state.paused ? "SUSPENDED" : "SYNTH LIVE";
    ui.transportState.textContent = !state.started
      ? "READY FOR INPUT"
      : state.paused
        ? "GRAPHICS FROZEN / 等待恢复"
        : "GENERATING / LIVE";
    ui.pauseVeil.classList.toggle("is-visible", state.started && state.paused);
    ui.canvasPrompt.classList.toggle("is-hidden", state.started);
  }

  function resetAnalyzerWindow() {
    analyzer.fluxHistory.length = 0;
    analyzer.safeFrames = 0;
    analyzer.lastBeatAt = performance.now();
    analyzer.beatEnvelope = 0;
    analyzer.beatFlash = 0;
  }

  async function startPlayback() {
    if (state.isExporting) return;
    if (state.started && !state.paused) return;
    if (state.started && state.paused) {
      await resumePlayback();
      return;
    }

    try {
      await engine.start();
      resetAnalyzerWindow();
      state.started = true;
      state.paused = false;
      beginSoftTransition();
      syncPlaybackUi();
      showToast("合成输入已启动。听不到声音时请检查系统音量。", 2600);
    } catch (error) {
      console.error(error);
      showToast(`无法启动音频引擎：${error.message}`, 4200);
    }
  }

  async function pausePlayback() {
    if (!state.started || state.paused || state.isExporting) return;
    freezeVisual();
    state.paused = true;
    syncPlaybackUi();
    try {
      await engine.pause();
    } catch (error) {
      console.error(error);
    }
  }

  async function resumePlayback() {
    if (!state.started || !state.paused || state.isExporting) return;
    beginSoftTransition();
    state.paused = false;
    resetAnalyzerWindow();
    syncPlaybackUi();
    try {
      await engine.resume();
    } catch (error) {
      console.error(error);
      showToast(`恢复播放失败：${error.message}`, 3600);
    }
  }

  async function togglePlayback() {
    if (!state.started) await startPlayback();
    else if (state.paused) await resumePlayback();
    else await pausePlayback();
  }

  function handleSmoothing(value) {
    state.smoothing = clamp(value / 100);
    ui.smoothingValue.textContent = `${Math.round(value)}%`;
    ui.smoothingRange.setAttribute("aria-valuetext", `${Math.round(value)}%，${value > 62 ? "舒缓" : "敏捷"}`);
  }

  function handleSensitivity(value) {
    state.sensitivity = clamp(value / 100);
    ui.sensitivityValue.textContent = `${Math.round(value)}%`;
    ui.sensitivityRange.setAttribute(
      "aria-valuetext",
      `${Math.round(value)}%，${value > 62 ? "敏锐" : "克制"}`,
    );
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
  }

  function updateUi(now) {
    if (now - state.uiUpdateAt < 75) return;
    state.uiUpdateAt = now;

    const live = state.started;
    const envelope = live ? clamp(visual.renderEnvelope) : 0;
    const beat = live ? clamp(visual.renderBeat) : 0;
    ui.envelopeMeter.style.width = `${(envelope * 100).toFixed(1)}%`;
    ui.beatMeter.style.width = `${(beat * 100).toFixed(1)}%`;
    ui.envelopeReadout.textContent = envelope.toFixed(2);
    ui.beatReadout.textContent = beat.toFixed(2);
    ui.sessionClock.textContent = `T+ ${formatDuration(state.sessionSeconds)}`;
    ui.frameCounter.textContent = `FRAME ${String(state.frame).padStart(5, "0")}`;
    ui.canvasSignal.textContent = `SIGNAL / ${String(Math.round(envelope * 99)).padStart(2, "0")}`;

    if (!state.isExporting) {
      const cycle = (state.sessionSeconds % EXPORT_SECONDS) / EXPORT_SECONDS;
      ui.timelineFill.style.width = `${(cycle * 100).toFixed(1)}%`;
      ui.timelinePlayhead.style.left = `${(cycle * 100).toFixed(1)}%`;
      ui.timelineTime.textContent = `${formatDuration(state.sessionSeconds)} / LIVE`;
    }

    const level = clamp(envelope * 1.45 + beat * 0.48 + visual.rms * 0.8);
    const litBars = Math.round(level * ui.meterBars.length);
    ui.meterBars.forEach((bar, index) => bar.classList.toggle("is-hot", index < litBars));

    const pulseValues = [
      engine.kickPulse,
      engine.hatPulse,
      engine.bassPulse,
      clamp(envelope * 1.2),
    ];
    ui.audioBars.forEach((bar, index) => {
      bar.classList.toggle("is-active", pulseValues[index] > 0.11);
    });
  }

  function showToast(message, duration = 3000) {
    window.clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove("is-visible");
    }, duration);
  }

  let mediaRecorder = null;
  let exportProgressTimer = 0;
  let exportStopTimer = 0;
  let exportStartedAt = 0;
  let exportVideoTrack = null;
  let recordingChunks = [];
  let exportStarting = false;

  function chooseVideoMimeType() {
    if (!window.MediaRecorder) return "";
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function downloadRecording(blob, mimeType) {
    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    const stem = `spectral-ritual-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}`;
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `${stem}.${extension}`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
  }

  function cleanupExport() {
    window.clearInterval(exportProgressTimer);
    window.clearTimeout(exportStopTimer);
    exportProgressTimer = 0;
    exportStopTimer = 0;
    if (exportVideoTrack) {
      exportVideoTrack.stop();
      exportVideoTrack = null;
    }
    mediaRecorder = null;
    state.isExporting = false;
    ui.exportButton.disabled = false;
    ui.exportButton.classList.remove("is-recording");
    ui.exportLabel.textContent = "导出 10 秒";
    ui.recIndicator.classList.remove("is-visible");
    ui.recIndicator.innerHTML = "<i></i> REC 00:00";
    setControlAvailability(false);
    syncPlaybackUi();
  }

  function updateExportUi() {
    if (!state.isExporting) return;
    const elapsed = Math.min(EXPORT_SECONDS, (performance.now() - exportStartedAt) / 1000);
    ui.exportLabel.textContent = `录制 ${elapsed.toFixed(1)} / 10s`;
    ui.recIndicator.innerHTML = `<i></i> REC 00:${String(Math.floor(elapsed)).padStart(2, "0")}`;
    ui.timelineFill.style.width = `${(elapsed / EXPORT_SECONDS) * 100}%`;
    ui.timelinePlayhead.style.left = `${(elapsed / EXPORT_SECONDS) * 100}%`;
    ui.timelineTime.textContent = `${formatDuration(elapsed)} / ${EXPORT_SECONDS}.0`;
  }

  async function exportVideo() {
    if (state.isExporting || exportStarting) return;
    if (!window.MediaRecorder || !canvas.captureStream) {
      showToast("当前浏览器不支持 Canvas 录屏，请使用最新版 Chrome、Edge 或 Firefox。", 4600);
      return;
    }

    exportStarting = true;
    try {
      if (!state.started) await startPlayback();
      if (!state.started) throw new Error("合成器未能启动");
      if (state.paused) await resumePlayback();
      if (state.paused) throw new Error("播放未能恢复");

      const audioStream = engine.getStream();
      if (!audioStream || audioStream.getAudioTracks().length === 0) {
        throw new Error("无法获取音频录制流");
      }

      const videoStream = canvas.captureStream(30);
      exportVideoTrack = videoStream.getVideoTracks()[0] || null;
      if (!exportVideoTrack) throw new Error("无法获取 Canvas 视频轨道");

      const stream = new MediaStream([
        exportVideoTrack,
        ...audioStream.getAudioTracks(),
      ]);
      const mimeType = chooseVideoMimeType();
      const options = {
        videoBitsPerSecond: 6_000_000,
        audioBitsPerSecond: 128_000,
      };
      if (mimeType) options.mimeType = mimeType;

      mediaRecorder = new MediaRecorder(stream, options);
      recordingChunks = [];
      state.isExporting = true;
      setControlAvailability(true);
      ui.exportButton.disabled = true;
      ui.exportButton.classList.add("is-recording");
      ui.recIndicator.classList.add("is-visible");
      ui.exportFormat.textContent = (mediaRecorder.mimeType || mimeType || "webm").includes("mp4")
        ? "MP4"
        : "WEBM";
      syncPlaybackUi();

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) recordingChunks.push(event.data);
      });

      mediaRecorder.addEventListener("error", (event) => {
        console.error("MediaRecorder error", event.error);
        showToast(`录制失败：${event.error?.message || "未知错误"}`, 4200);
        cleanupExport();
      });

      mediaRecorder.addEventListener("stop", () => {
        const actualMime = mediaRecorder?.mimeType || mimeType || "video/webm";
        const blob = new Blob(recordingChunks, { type: actualMime });
        cleanupExport();
        if (blob.size > 0) {
          downloadRecording(blob, actualMime);
          showToast(`已导出 ${EXPORT_SECONDS} 秒视频 · ${(blob.size / 1024 / 1024).toFixed(1)} MB`, 3600);
        } else {
          showToast("录制结果为空，请重试或检查浏览器的媒体权限。", 4200);
        }
      });

      mediaRecorder.start(100);
      exportStarting = false;
      exportStartedAt = performance.now();
      updateExportUi();
      exportProgressTimer = window.setInterval(updateExportUi, 100);
      exportStopTimer = window.setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          ui.exportLabel.textContent = "正在封装…";
          mediaRecorder.stop();
        }
      }, EXPORT_SECONDS * 1000);
      showToast("开始录制当前模式；暂停与参数已锁定 10 秒。", 2600);
    } catch (error) {
      exportStarting = false;
      console.error(error);
      if (exportVideoTrack) {
        exportVideoTrack.stop();
        exportVideoTrack = null;
      }
      state.isExporting = false;
      ui.exportButton.disabled = false;
      ui.exportButton.classList.remove("is-recording");
      ui.exportLabel.textContent = "导出 10 秒";
      ui.recIndicator.classList.remove("is-visible");
      setControlAvailability(false);
      syncPlaybackUi();
      showToast(`无法导出视频：${error.message}`, 4600);
    }
  }

  function animationLoop(now) {
    const elapsed = (now - state.lastFrameTime) / 1000;
    state.lastFrameTime = now;
    const dt = clamp(elapsed, 0, 0.05);

    if (!state.paused) {
      state.frame += 1;
      state.visualTime += dt;
      if (state.started) state.sessionSeconds += dt;
      updateVisual(dt);
      engine.updatePulses(dt);
      drawScene();
      updateUi(now);
    }

    requestAnimationFrame(animationLoop);
  }

  function bindEvents() {
    ui.playButton.addEventListener("click", togglePlayback);
    ui.pauseButton.addEventListener("click", togglePlayback);
    ui.promptStart.addEventListener("click", startPlayback);
    ui.exportButton.addEventListener("click", exportVideo);

    for (const card of ui.modeCards) {
      card.addEventListener("click", () => setMode(card.dataset.mode, true));
    }

    ui.smoothingRange.addEventListener("input", (event) => {
      handleSmoothing(Number(event.target.value));
    });
    ui.sensitivityRange.addEventListener("input", (event) => {
      handleSensitivity(Number(event.target.value));
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const interactive =
        target instanceof HTMLInputElement ||
        target instanceof HTMLButtonElement ||
        target instanceof HTMLTextAreaElement;
      if (interactive) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "1") {
        setMode("envelope", true);
      } else if (event.key === "2") {
        setMode("beat", true);
      } else if (event.key.toLowerCase() === "r") {
        exportVideo();
      }
    });
  }

  function initialize() {
    handleSmoothing(Number(ui.smoothingRange.value));
    handleSensitivity(Number(ui.sensitivityRange.value));
    setMode("envelope");
    bindEvents();
    syncPlaybackUi();
    ui.exportFormat.textContent = chooseVideoMimeType().includes("mp4") ? "MP4" : "WEBM";
    fillIdleVisual(0.016, 0);
    drawScene();
    if (new URLSearchParams(window.location.search).has("debug")) {
      window.__SPECTRAL_DEBUG__ = { state, visual, analyzer, engine };
    }
    requestAnimationFrame(animationLoop);
  }

  initialize();
})();
