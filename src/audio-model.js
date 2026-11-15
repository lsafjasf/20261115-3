(function () {
  "use strict";

  const DURATION = 16;
  const PREFERRED_SAMPLE_RATE = 48000;
  const MIN_AUTOMATION_DB = -24;
  const MAX_AUTOMATION_DB = 6;

  const TRACKS = [
    {
      id: "drums",
      number: "01",
      name: "鼓组",
      caption: "KICK · HAT · SNARE",
      role: "RHYTHM",
      color: "#efb35f",
      defaults: {
        volumeDb: 0,
        pan: 0,
        cutoff: 15500,
        mute: false,
        automation: [
          { time: 0.3, gainDb: -9 },
          { time: 15.4, gainDb: 0 }
        ]
      }
    },
    {
      id: "bass",
      number: "02",
      name: "低音贝斯",
      caption: "SUB · MID PULSE",
      role: "LOW END",
      color: "#83c8f2",
      defaults: {
        volumeDb: -1,
        pan: -0.12,
        cutoff: 5200,
        mute: false,
        automation: [
          { time: 0.15, gainDb: -10 },
          { time: 15.6, gainDb: -2 }
        ]
      }
    },
    {
      id: "chords",
      number: "03",
      name: "和弦铺底",
      caption: "Fm7 · Cm7 · Abmaj7 · Eb7",
      role: "HARMONY",
      color: "#c6a0f2",
      defaults: {
        volumeDb: -3,
        pan: 0.14,
        cutoff: 9600,
        mute: false,
        automation: [
          { time: 1.2, gainDb: -14 },
          { time: 14.8, gainDb: -2 }
        ]
      }
    },
    {
      id: "arp",
      number: "04",
      name: "琶音脉冲",
      caption: "PLUCK · AIR",
      role: "TOP LINE",
      color: "#87dfb8",
      defaults: {
        volumeDb: -4,
        pan: 0.26,
        cutoff: 13500,
        mute: false,
        automation: [
          { time: 2.0, gainDb: -16 },
          { time: 14.0, gainDb: -4 }
        ]
      }
    }
  ];

  const CHORD_PROGRESSION = [
    { root: 41, notes: [65, 68, 72, 75], name: "Fm7" },
    { root: 36, notes: [60, 63, 67, 70], name: "Cm7" },
    { root: 45, notes: [57, 60, 64, 67], name: "Abmaj7" },
    { root: 39, notes: [55, 58, 62, 64], name: "Eb7" }
  ];

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function midiToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function dbToGain(db) {
    if (db <= -60) return 0;
    return Math.pow(10, db / 20);
  }

  function gainToDb(gain) {
    return gain <= 0 ? -60 : 20 * Math.log10(gain);
  }

  function softLimit(value) {
    const threshold = 0.92;
    const magnitude = Math.abs(value);
    if (magnitude <= threshold) return value;
    const sign = value < 0 ? -1 : 1;
    return sign * (threshold + (1 - threshold) * Math.tanh((magnitude - threshold) / (1 - threshold)));
  }

  function cloneSettings() {
    return Object.fromEntries(TRACKS.map((track) => [
      track.id,
      {
        volumeDb: track.defaults.volumeDb,
        pan: track.defaults.pan,
        cutoff: track.defaults.cutoff,
        mute: track.defaults.mute,
        automation: track.defaults.automation.map((point) => ({ ...point }))
      }
    ]));
  }

  function automationGainAt(settings, time) {
    const points = settings.automation;
    const a = points[0];
    const b = points[1];
    if (!a || !b) return 1;
    if (time <= a.time) return dbToGain(a.gainDb);
    if (time >= b.time) return dbToGain(b.gainDb);
    const progress = (time - a.time) / Math.max(0.001, b.time - a.time);
    const db = a.gainDb + (b.gainDb - a.gainDb) * progress;
    return dbToGain(db);
  }

  function createPrng(seed) {
    let state = seed >>> 0;
    return function random() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function envelope(time, attack, release, duration) {
    const attackGain = attack <= 0 ? 1 : clamp(time / attack, 0, 1);
    const releaseGain = release <= 0 ? 1 : clamp((duration - time) / release, 0, 1);
    return Math.min(attackGain, releaseGain);
  }

  function addKick(samples, sampleRate, start, amplitude) {
    const begin = Math.floor(start * sampleRate);
    const end = Math.min(samples.length, begin + Math.ceil(0.45 * sampleRate));
    let phase = 0;
    for (let index = begin; index < end; index += 1) {
      const time = (index - begin) / sampleRate;
      const frequency = 44 + 112 * Math.exp(-time * 20);
      phase += (Math.PI * 2 * frequency) / sampleRate;
      const attack = clamp(time / 0.004, 0, 1);
      const decay = Math.exp(-time * 9.2);
      const body = Math.sin(phase) * 0.9 + Math.sin(phase * 2) * 0.1;
      const click = Math.exp(-time * 85) * Math.sin(index * 1.618) * 0.06;
      samples[index] += amplitude * attack * decay * (body + click);
    }
  }

  function addHat(samples, sampleRate, start, amplitude, random) {
    const begin = Math.floor(start * sampleRate);
    const end = Math.min(samples.length, begin + Math.ceil(0.075 * sampleRate));
    let lowpassed = 0;
    for (let index = begin; index < end; index += 1) {
      const time = (index - begin) / sampleRate;
      const white = random() * 2 - 1;
      lowpassed += (white - lowpassed) * 0.12;
      const bright = white - lowpassed;
      const decay = Math.exp(-time * 68);
      samples[index] += bright * decay * amplitude;
    }
  }

  function addSnare(samples, sampleRate, start, amplitude, random) {
    const begin = Math.floor(start * sampleRate);
    const end = Math.min(samples.length, begin + Math.ceil(0.24 * sampleRate));
    let lowpassed = 0;
    for (let index = begin; index < end; index += 1) {
      const time = (index - begin) / sampleRate;
      const white = random() * 2 - 1;
      lowpassed += (white - lowpassed) * 0.18;
      const band = white - lowpassed * 0.7;
      const attack = clamp(time / 0.006, 0, 1);
      const decay = Math.exp(-time * 21);
      const shell = Math.sin(Math.PI * 2 * 185 * time) * Math.exp(-time * 37) * 0.28;
      samples[index] += amplitude * attack * (band * decay + shell);
    }
  }

  function addBassNote(samples, sampleRate, start, frequency, amplitude, duration) {
    const begin = Math.floor(start * sampleRate);
    const end = Math.min(samples.length, begin + Math.ceil(duration * sampleRate));
    let phase = 0;
    for (let index = begin; index < end; index += 1) {
      const time = (index - begin) / sampleRate;
      const gain = envelope(time, 0.008, 0.07, duration);
      const glide = 1 + 0.016 * Math.exp(-time * 24);
      phase += (Math.PI * 2 * frequency * glide) / sampleRate;
      const tone =
        Math.sin(phase) * 0.78 +
        Math.sin(phase * 2) * 0.19 +
        Math.sin(phase * 3) * 0.055;
      samples[index] += tone * gain * amplitude;
    }
  }

  function addPluck(samples, sampleRate, start, frequency, amplitude) {
    const begin = Math.floor(start * sampleRate);
    const duration = 0.24;
    const end = Math.min(samples.length, begin + Math.ceil(duration * sampleRate));
    let phase = 0;
    for (let index = begin; index < end; index += 1) {
      const time = (index - begin) / sampleRate;
      const attack = clamp(time / 0.004, 0, 1);
      const decay = Math.exp(-time * 18);
      phase += (Math.PI * 2 * frequency) / sampleRate;
      const tone =
        Math.sin(phase) * 0.65 +
        Math.sin(phase * 2 + 0.4) * 0.22 +
        Math.sin(phase * 3.01) * 0.08;
      samples[index] += tone * attack * decay * amplitude;
    }
  }

  function addPadChord(samples, sampleRate, start, chord, amplitude) {
    const begin = Math.floor(start * sampleRate);
    const duration = 2;
    const end = Math.min(samples.length, begin + Math.ceil(duration * sampleRate));
    const voices = chord.notes.map((note) => midiToFrequency(note));
    const detunes = [0.996, 1.004];
    for (let index = begin; index < end; index += 1) {
      const local = (index - begin) / sampleRate;
      const gain = envelope(local, 0.28, 0.34, duration);
      const movement = 0.92 + 0.08 * Math.sin(local * 2.4 + chord.root);
      let tone = 0;
      for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex += 1) {
        const frequency = voices[voiceIndex];
        for (let detuneIndex = 0; detuneIndex < detunes.length; detuneIndex += 1) {
          const detune = detunes[detuneIndex];
          const phase = Math.PI * 2 * frequency * detune * (start + local);
          tone += Math.sin(phase + voiceIndex * 0.35 + detuneIndex * 0.18) / detunes.length;
        }
      }
      samples[index] += tone * gain * movement * amplitude * 0.25;
    }
  }

  function normalizeStem(samples, targetPeak) {
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
    if (peak <= 0) return samples;
    const scale = targetPeak / peak;
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] *= scale;
    }
    return samples;
  }

  function createDrumStem(sampleRate) {
    const length = Math.round(DURATION * sampleRate);
    const samples = new Float32Array(length);
    const random = createPrng(0x51a7c0de);
    const beat = 0.5;

    for (let step = 0; step < 32; step += 1) {
      const start = step * beat;
      const downbeat = step % 4 === 0;
      addKick(samples, sampleRate, start, downbeat ? 0.74 : 0.57);
      if (step % 4 === 1 || step % 4 === 3) {
        addSnare(samples, sampleRate, start, step % 4 === 1 ? 0.32 : 0.26, random);
      }
      addHat(samples, sampleRate, start + 0.245, 0.075, random);
      if (step % 2 === 1) {
        addHat(samples, sampleRate, start + 0.08, 0.052, random);
      }
    }

    return normalizeStem(samples, 0.88);
  }

  function createBassStem(sampleRate) {
    const length = Math.round(DURATION * sampleRate);
    const samples = new Float32Array(length);
    const stepDuration = 0.25;
    const offsets = [0, 0, 7, 12, 0, 3, 7, 10];

    for (let step = 0; step < 64; step += 1) {
      const bar = Math.floor(step / 8);
      const chord = CHORD_PROGRESSION[bar % CHORD_PROGRESSION.length];
      const note = chord.root + offsets[step % offsets.length];
      const accent = step % 4 === 0 ? 1 : 0.78;
      addBassNote(
        samples,
        sampleRate,
        step * stepDuration + 0.018,
        midiToFrequency(note),
        0.5 * accent,
        0.22
      );
    }

    return normalizeStem(samples, 0.8);
  }

  function createChordStem(sampleRate) {
    const length = Math.round(DURATION * sampleRate);
    const samples = new Float32Array(length);
    const barDuration = 2;

    for (let bar = 0; bar < 8; bar += 1) {
      const chord = CHORD_PROGRESSION[bar % CHORD_PROGRESSION.length];
      addPadChord(samples, sampleRate, bar * barDuration, chord, 0.82);
    }

    return normalizeStem(samples, 0.72);
  }

  function createArpStem(sampleRate) {
    const length = Math.round(DURATION * sampleRate);
    const samples = new Float32Array(length);

    for (let step = 0; step < 64; step += 1) {
      const bar = Math.floor(step / 8);
      const chord = CHORD_PROGRESSION[bar % CHORD_PROGRESSION.length];
      const note = chord.notes[(step * 3 + Math.floor(step / 8)) % chord.notes.length] + 12;
      const accent = step % 8 === 0 ? 1 : step % 2 === 0 ? 0.82 : 0.64;
      addPluck(samples, sampleRate, step * 0.25 + 0.034, midiToFrequency(note), 0.52 * accent);
    }

    return normalizeStem(samples, 0.72);
  }

  function createStems(sampleRate) {
    return {
      drums: createDrumStem(sampleRate),
      bass: createBassStem(sampleRate),
      chords: createChordStem(sampleRate),
      arp: createArpStem(sampleRate)
    };
  }

  function analyzePcm(samples) {
    let peak = 0;
    let sumSquares = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index];
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
    }
    return {
      peak,
      rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0
    };
  }

  window.MixerModel = {
    DURATION,
    PREFERRED_SAMPLE_RATE,
    TRACKS,
    CHORD_PROGRESSION,
    MIN_AUTOMATION_DB,
    MAX_AUTOMATION_DB,
    clamp,
    dbToGain,
    gainToDb,
    softLimit,
    cloneSettings,
    automationGainAt,
    midiToFrequency,
    createPrng,
    addKick,
    addHat,
    addSnare,
    addBassNote,
    addPluck,
    addPadChord,
    createStems,
    analyzePcm
  };
})();
