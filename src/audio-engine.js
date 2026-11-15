const dbToGain = (db) => Math.pow(10, db / 20);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const VOWELS = [
  { f1: 620, f2: 1180, f3: 2450 },
  { f1: 440, f2: 980, f3: 2200 },
  { f1: 760, f2: 1420, f3: 2650 },
  { f1: 510, f2: 1660, f3: 2800 },
  { f1: 390, f2: 840, f3: 2350 },
  { f1: 690, f2: 1320, f3: 2500 },
  { f1: 330, f2: 1260, f3: 2550 },
];

export class BinauralAudioEngine {
  constructor() {
    this.context = null;
    this.masterInput = null;
    this.analyser = null;
    this.channelSwap = false;
    this.masterGainDb = 0;
    this.liveTone = null;
    this.noiseBuffer = null;
  }

  async ensureReady() {
    if (!this.context) {
      this.#buildGraph();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  #buildGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("当前浏览器不支持 Web Audio");
    }

    this.context = new AudioContextClass({ latencyHint: "interactive" });
    const context = this.context;
    this.masterInput = context.createGain();
    this.splitter = context.createChannelSplitter(2);
    this.merger = context.createChannelMerger(2);
    this.masterGain = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.analyser = context.createAnalyser();

    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.02;
    this.compressor.release.value = 0.25;

    this.masterInput.connect(this.splitter);
    this.#wireChannelMatrix();
    this.merger.connect(this.masterGain);
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(context.destination);
    this.setMasterGainDb(this.masterGainDb);
    this.noiseBuffer = this.#makeNoiseBuffer(2.5);
  }

  #wireChannelMatrix() {
    this.splitter.disconnect();
    if (this.channelSwap) {
      this.splitter.connect(this.merger, 0, 1);
      this.splitter.connect(this.merger, 1, 0);
    } else {
      this.splitter.connect(this.merger, 0, 0);
      this.splitter.connect(this.merger, 1, 1);
    }
  }

  setChannelSwap(swap) {
    const next = Boolean(swap);
    if (this.channelSwap === next) return;
    this.channelSwap = next;
    if (this.context) this.#wireChannelMatrix();
  }

  setMasterGainDb(db) {
    this.masterGainDb = clamp(Number(db) || 0, -42, 6);
    if (!this.masterGain) return;
    const now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(dbToGain(this.masterGainDb), now, 0.08);
  }

  getOutputState() {
    return {
      swap: this.channelSwap,
      masterGainDb: this.masterGainDb,
      state: this.context?.state ?? "uninitialized",
      sampleRate: this.context?.sampleRate ?? 0,
    };
  }

  #makeNoiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.76 + white * 0.24;
      data[index] = previous;
    }
    return buffer;
  }

  #tone({ hz, db, duration = 0.6, pan = 0, when = 0, type = "sine", attack = 0.035 }) {
    const context = this.context;
    const start = context.currentTime + Math.max(0, when);
    const end = start + duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const panner = context.createStereoPanner();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, start);
    panner.pan.setValueAtTime(clamp(pan, -1, 1), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(dbToGain(db), start + attack);
    gain.gain.setValueAtTime(dbToGain(db), Math.max(start + attack, end - 0.13));
    gain.gain.linearRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterInput);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    return end;
  }

  playChannelCue(side) {
    const context = this.context;
    const now = context.currentTime + 0.015;
    const pan = side === "left" ? -1 : 1;
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const mix = context.createGain();
    const envelope = context.createGain();
    const panner = context.createStereoPanner();

    oscillator.type = "sine";
    overtone.type = "triangle";
    oscillator.frequency.setValueAtTime(360, now);
    oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.48);
    oscillator.frequency.exponentialRampToValueAtTime(420, now + 0.78);
    overtone.frequency.setValueAtTime(1080, now);
    overtone.frequency.exponentialRampToValueAtTime(2160, now + 0.48);
    panner.pan.setValueAtTime(pan, now);
    mix.gain.setValueAtTime(0.48, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.13, now + 0.05);
    envelope.gain.setValueAtTime(0.13, now + 0.56);
    envelope.gain.linearRampToValueAtTime(0.0001, now + 0.82);

    oscillator.connect(mix);
    overtone.connect(mix);
    mix.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.masterInput);
    oscillator.start(now);
    overtone.start(now);
    oscillator.stop(now + 0.84);
    overtone.stop(now + 0.84);
    return 0.84;
  }

  playReferenceTone(hz, db, duration = 0.9) {
    return this.#tone({ hz, db, duration, type: "sine", attack: 0.09 });
  }

  playMatchTone(hz, db, duration = 0.9) {
    return this.#tone({ hz, db, duration, type: "triangle", attack: 0.09 });
  }

  toggleCompareTone(reference, match, cycles = 3) {
    const cycle = 1.35;
    for (let index = 0; index < cycles; index += 1) {
      const offset = index * cycle;
      this.#tone({ hz: reference.hz, db: reference.db, duration: 0.6, when: offset, type: "sine", attack: 0.12 });
      this.#tone({ hz: match.hz, db: match.db, duration: 0.6, when: offset + 0.68, type: "triangle", attack: 0.12 });
    }
    return cycle * cycles;
  }

  startLiveTone(hz, db) {
    if (this.liveTone) {
      this.updateLiveTone(hz, db);
      return;
    }
    const context = this.context;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(hz, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(dbToGain(db), now + 0.08);
    oscillator.connect(gain);
    gain.connect(this.masterInput);
    oscillator.start(now);
    this.liveTone = { oscillator, gain };
  }

  updateLiveTone(hz, db) {
    if (!this.liveTone) return;
    const now = this.context.currentTime;
    this.liveTone.oscillator.frequency.setTargetAtTime(hz, now, 0.025);
    this.liveTone.gain.gain.setTargetAtTime(dbToGain(db), now, 0.025);
  }

  stopLiveTone() {
    if (!this.liveTone) return;
    const { oscillator, gain } = this.liveTone;
    const now = this.context.currentTime;
    gain.gain.setTargetAtTime(0.0001, now, 0.035);
    oscillator.stop(now + 0.18);
    this.liveTone = null;
  }

  #voiceSyllable(character, start, duration, options) {
    const context = this.context;
    const code = character.codePointAt(0) || 0;
    const vowel = VOWELS[code % VOWELS.length];
    const basePitch = 172 + (code % 7) * 5;
    const oscillator = context.createOscillator();
    const syllableGain = context.createGain();
    const panner = context.createStereoPanner();
    const formantGains = [];
    const formants = [
      [vowel.f1, 6.5, 0.9],
      [vowel.f2, 8.5, 0.58],
      [vowel.f3, 11, 0.26],
    ];

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(basePitch * 0.94, start);
    oscillator.frequency.linearRampToValueAtTime(basePitch, start + duration * 0.34);
    oscillator.frequency.linearRampToValueAtTime(basePitch * 0.88, start + duration);
    panner.pan.setValueAtTime(options.pan, start);

    for (const [frequency, resonance, weight] of formants) {
      const filter = context.createBiquadFilter();
      const formantGain = context.createGain();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(frequency, start);
      filter.Q.setValueAtTime(resonance, start);
      formantGain.gain.setValueAtTime(weight, start);
      oscillator.connect(filter);
      filter.connect(formantGain);
      formantGain.connect(syllableGain);
      formantGains.push(formantGain);
    }

    syllableGain.gain.setValueAtTime(0.0001, start);
    syllableGain.gain.linearRampToValueAtTime(options.level, start + 0.025);
    syllableGain.gain.setValueAtTime(options.level * 0.88, start + duration * 0.7);
    syllableGain.gain.linearRampToValueAtTime(0.0001, start + duration);
    syllableGain.connect(panner);
    panner.connect(this.masterInput);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);

    if (code % 3 === 0) {
      const breath = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const breathGain = context.createGain();
      breath.buffer = this.noiseBuffer;
      filter.type = "highpass";
      filter.frequency.setValueAtTime(1800 + (code % 5) * 320, start);
      breathGain.gain.setValueAtTime(0.0001, start);
      breathGain.gain.linearRampToValueAtTime(0.026, start + 0.012);
      breathGain.gain.linearRampToValueAtTime(0.0001, start + 0.075);
      breath.connect(filter);
      filter.connect(breathGain);
      breathGain.connect(panner);
      breath.start(start, Math.random() * 1.5, 0.08);
    }
  }

  speak(text, { when = 0, pan = 0, level = 0.14 } = {}) {
    const context = this.context;
    const characters = Array.from(String(text));
    const startBase = context.currentTime + 0.04 + Math.max(0, when);
    let cursor = 0;
    for (const character of characters) {
      if (/[\s，。！？、：；]/.test(character)) {
        cursor += character === "，" || character === "。" ? 0.13 : 0.035;
        continue;
      }
      const duration = 0.1 + ((character.codePointAt(0) || 1) % 5) * 0.012;
      this.#voiceSyllable(character, startBase + cursor, duration, {
        pan: clamp(pan, -1, 1),
        level,
      });
      cursor += duration + 0.025;
    }
    return cursor;
  }

  playConfirm() {
    this.#tone({ hz: 660, db: -21, duration: 0.14, when: 0, type: "sine" });
    this.#tone({ hz: 990, db: -22, duration: 0.22, when: 0.1, type: "sine" });
    return 0.34;
  }

  playError() {
    this.#tone({ hz: 180, db: -22, duration: 0.18, when: 0, type: "square" });
    this.#tone({ hz: 145, db: -23, duration: 0.26, when: 0.18, type: "square" });
    return 0.46;
  }

  playTick() {
    return this.#tone({ hz: 780, db: -30, duration: 0.075, type: "sine", attack: 0.005 });
  }

  #schedulePannerPosition(panner, zone, start, duration) {
    const xValues = new Float32Array(32);
    for (let index = 0; index < xValues.length; index += 1) {
      xValues[index] = -2.4 + (4.8 * index) / (xValues.length - 1);
    }
    panner.positionX.setValueAtTime(-2.4, start);
    panner.positionY.setValueAtTime(0.05, start);
    panner.positionZ.setValueAtTime(zone === "front" ? -1.65 : 1.65, start);
    if (typeof panner.positionX.setValueCurveAtTime === "function") {
      panner.positionX.setValueCurveAtTime(xValues, start, duration);
    } else {
      panner.positionX.linearRampToValueAtTime(2.4, start + duration);
    }
  }

  playSpatialSegment(zone, duration = 2.05) {
    const context = this.context;
    const start = context.currentTime + 0.06;
    const end = start + duration;
    const panner = context.createPanner();
    const mix = context.createGain();
    const envelope = context.createGain();
    const tone = context.createOscillator();
    const highTone = context.createOscillator();
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();

    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 20;
    panner.rolloffFactor = 1.05;
    this.#schedulePannerPosition(panner, zone, start, duration);

    tone.type = "sine";
    highTone.type = "triangle";
    tone.frequency.setValueAtTime(235, start);
    tone.frequency.linearRampToValueAtTime(294, start + duration * 0.45);
    tone.frequency.linearRampToValueAtTime(220, end);
    highTone.frequency.setValueAtTime(470, start);
    highTone.frequency.linearRampToValueAtTime(588, start + duration * 0.45);
    highTone.frequency.linearRampToValueAtTime(440, end);
    noise.buffer = this.noiseBuffer;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(zone === "front" ? 1350 : 850, start);
    noiseFilter.Q.setValueAtTime(0.7, start);
    noiseGain.gain.setValueAtTime(0.07, start);

    mix.gain.setValueAtTime(0.2, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(0.2, start + 0.15);
    envelope.gain.setValueAtTime(0.2, end - 0.35);
    envelope.gain.linearRampToValueAtTime(0.0001, end);

    tone.connect(mix);
    highTone.connect(mix);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(mix);
    mix.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.masterInput);

    tone.start(start);
    highTone.start(start);
    noise.start(start, Math.random() * 0.4, duration);
    tone.stop(end + 0.02);
    highTone.stop(end + 0.02);
    return duration;
  }

  playSceneCue(clue, hz = 330) {
    const context = this.context;
    const presets = {
      door: { x: -1.35, y: 0, z: -1.9, pan: -0.58 },
      recorder: { x: 1.25, y: 0, z: -1.75, pan: 0.52 },
      steps: { x: -0.7, y: -0.15, z: 2.05, pan: -0.42 },
    };
    const preset = presets[clue] || presets.door;
    const panner = context.createPanner();
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime + 0.04;

    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.positionX.setValueAtTime(preset.x, now);
    panner.positionY.setValueAtTime(preset.y, now);
    panner.positionZ.setValueAtTime(preset.z, now);
    oscillator.type = "sine";
    overtone.type = "triangle";
    oscillator.frequency.setValueAtTime(hz, now);
    oscillator.frequency.exponentialRampToValueAtTime(hz * 1.32, now + 0.28);
    oscillator.frequency.exponentialRampToValueAtTime(hz * 0.86, now + 0.82);
    overtone.frequency.setValueAtTime(hz * 2.03, now);
    overtone.frequency.exponentialRampToValueAtTime(hz * 1.42, now + 0.8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.17, now + 0.04);
    gain.gain.setValueAtTime(0.17, now + 0.55);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.86);
    oscillator.connect(gain);
    overtone.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterInput);
    oscillator.start(now);
    overtone.start(now);
    oscillator.stop(now + 0.9);
    overtone.stop(now + 0.9);
    return { duration: 0.9, pan: preset.pan };
  }

  playRoomTone() {
    const context = this.context;
    const now = context.currentTime;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(540, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.025, now + 0.5);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterInput);
    noise.start(now);
    return { stop: () => {
      gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.15);
      noise.stop(context.currentTime + 0.6);
    } };
  }
}
