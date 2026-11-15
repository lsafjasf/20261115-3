export const SAMPLE_RATE = 44100;
export const DURATION = 32;

export const BROADCAST_SEGMENTS = [
  { id: "b1", start: 6.8, end: 12.2, title: "开场播报", subtitle: "LOCAL UPDATE" },
  { id: "b2", start: 17.4, end: 23.8, title: "路况快讯", subtitle: "TRAFFIC NOTE" },
  { id: "b3", start: 27.2, end: 31.5, title: "尾段口播", subtitle: "OUTRO READ" }
];

const TAU = Math.PI * 2;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function raisedWindow(x, start, end, fade = 0.04) {
  if (x <= start || x >= end) return 0;
  const inEdge = Math.min(1, (x - start) / fade);
  const outEdge = Math.min(1, (end - x) / fade);
  const edge = Math.min(inEdge, outEdge);
  return Math.sin(edge * Math.PI * 0.5) ** 2;
}

function peakOf(values) {
  let peak = 0;
  for (let i = 0; i < values.length; i += 1) {
    const abs = Math.abs(values[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

const CHORDS = [
  [220, 261.63, 329.63, 392],
  [174.61, 220, 261.63, 349.23],
  [196, 261.63, 329.63, 392],
  [196, 246.94, 293.66, 392]
];

function createMusic(sampleRate, duration) {
  const length = Math.round(sampleRate * duration);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const random = mulberry32(910);
  const beat = 60 / 92;
  const eighth = beat / 2;
  const padPhase = [0, 0.2, 0.5, 0.7];

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const chord = CHORDS[Math.floor(t / 4) % CHORDS.length];
    const globalFade = raisedWindow(t, 0, duration, 0.6);
    const padLfo = 0.92 + 0.08 * Math.sin(TAU * 0.11 * t);

    let padLeft = 0;
    let padRight = 0;
    for (let voice = 0; voice < chord.length; voice += 1) {
      const frequency = chord[voice];
      const phase = TAU * frequency * t + padPhase[voice] + 0.12 * Math.sin(TAU * 0.18 * t + voice);
      const level = 0.042 + voice * 0.006;
      padLeft += Math.sin(phase + voice * 0.12) * level;
      padRight += Math.sin(phase - voice * 0.16) * level;
    }

    const bassFrequency = chord[0] * 0.5;
    const bass = Math.sin(TAU * bassFrequency * t + 0.35 * Math.sin(TAU * 0.4 * t)) * 0.055;

    const eighthIndex = Math.floor(t / eighth);
    const eighthPhase = (t % eighth) / eighth;
    const arpFrequency = chord[(eighthIndex + 1) % chord.length] * 1.5;
    const pluck = Math.sin(TAU * arpFrequency * t) * Math.exp(-eighthPhase * 4.8) * 0.062;
    const arpPan = eighthIndex % 2 === 0 ? -1 : 1;

    const beatPhase = (t % beat) / beat;
    let kick = 0;
    if (beatPhase < 0.24) {
      const local = beatPhase / 0.24;
      kick = Math.sin(TAU * (48 * (t % beat) - 16 * (t % beat) ** 2)) * (1 - local) ** 3 * 0.075;
    }

    const hatPhase = (t % eighth) / eighth;
    const noise = random() * 2 - 1;
    const hat = hatPhase < 0.13 ? noise * (1 - hatPhase / 0.13) ** 5 * 0.022 : 0;

    const leftMix = (padLeft + bass + pluck * (1 - arpPan * 0.25) + kick + hat) * globalFade;
    const rightMix = (padRight + bass + pluck * (1 + arpPan * 0.25) + kick + hat * 0.8) * globalFade;
    left[i] = leftMix * padLfo;
    right[i] = rightMix * padLfo;
  }

  const combinedPeak = Math.max(peakOf(left), peakOf(right));
  const scale = combinedPeak ? 0.37 / combinedPeak : 1;
  for (let i = 0; i < length; i += 1) {
    left[i] *= scale;
    right[i] *= scale;
  }
  return { left, right };
}

function addSpeechBursts(amplitude, sampleRate, duration, seed) {
  const random = mulberry32(seed);
  let cursor = 0.11 + random() * 0.08;
  let syllables = 0;

  while (cursor < duration - 0.2) {
    const syllable = 0.1 + random() * 0.22;
    const gap = 0.035 + random() * 0.11;
    const emphasis = 0.62 + random() * 0.38;
    const start = cursor;
    const end = Math.min(duration, start + syllable);
    const first = Math.floor(start * sampleRate);
    const last = Math.ceil(end * sampleRate);
    const windowSamples = Math.max(2, last - first);

    for (let i = first; i < last; i += 1) {
      const phase = (i - first) / windowSamples;
      const shape = Math.sin(Math.PI * phase) ** 1.4;
      amplitude[i] += shape * emphasis;
    }

    syllables += 1;
    cursor = end + gap;
    if (syllables % 5 === 0) cursor += 0.18 + random() * 0.28;
  }
}

function createBroadcast(sampleRate, duration) {
  const length = Math.round(sampleRate * duration);
  const samples = new Float32Array(length);
  const random = mulberry32(4409);

  for (let segmentIndex = 0; segmentIndex < BROADCAST_SEGMENTS.length; segmentIndex += 1) {
    const segment = BROADCAST_SEGMENTS[segmentIndex];
    const segmentStart = Math.round(segment.start * sampleRate);
    const segmentLength = Math.round((segment.end - segment.start) * sampleRate);
    const localAmplitude = new Float32Array(segmentLength);
    addSpeechBursts(localAmplitude, sampleRate, segment.end - segment.start, 812 + segmentIndex * 97);

    let phase = 0;
    let noiseState = 0;
    for (let i = 0; i < segmentLength; i += 1) {
      const localTime = i / sampleRate;
      const globalIndex = segmentStart + i;
      const articulation = Math.min(1, localAmplitude[i]);
      const f0 = 112 + 10 * Math.sin(TAU * 0.67 * localTime)
        + 6 * Math.sin(TAU * 2.3 * localTime + 0.8);
      phase += TAU * f0 / sampleRate;

      const voiced = Math.sin(phase) * 0.55
        + Math.sin(phase * 2 + 0.3) * 0.29
        + Math.sin(phase * 3 + 1.2) * 0.17
        + Math.sin(phase * 5 + 0.7) * 0.08;
      const noise = random() * 2 - 1;
      noiseState = noiseState * 0.72 + noise * 0.28;
      const sibilant = (noise - noiseState * 0.45) * 0.12 * Math.max(0, articulation - 0.3);
      const room = Math.sin(TAU * 91 * localTime + 0.2) * 0.035;
      samples[globalIndex] = (voiced + sibilant + room) * articulation * 0.2;
    }
  }

  const peak = peakOf(samples);
  if (peak) {
    const scale = 0.30 / peak;
    for (let i = 0; i < samples.length; i += 1) samples[i] *= scale;
  }
  return samples;
}

export function createDemoTracks(sampleRate = SAMPLE_RATE, duration = DURATION) {
  const music = createMusic(sampleRate, duration);
  const broadcast = createBroadcast(sampleRate, duration);
  return {
    sampleRate,
    duration,
    segments: BROADCAST_SEGMENTS,
    music,
    broadcast
  };
}
