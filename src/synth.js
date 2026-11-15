import { STEPS_PER_BEAT, STEP_COUNT, clamp } from "./project.js";

export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

function polyBlep(phase, step) {
  if (phase < step) {
    const t = phase / step;
    return t + t - t * t - 1;
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step;
    return t * t + t + t + 1;
  }
  return 0;
}

function oscillator(waveform, phase, step) {
  if (waveform === "sine") return Math.sin(phase * Math.PI * 2);
  if (waveform === "triangle") return 1 - 4 * Math.abs(phase - 0.5);
  if (waveform === "square") {
    let value = phase < 0.5 ? 1 : -1;
    value += polyBlep(phase, step);
    value -= polyBlep((phase + 0.5) % 1, step);
    return value;
  }
  return 2 * phase - 1 - polyBlep(phase, step);
}

function noiseAt(stateRef) {
  let state = stateRef.value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  stateRef.value = state || 0x1234567;
  return (state >>> 0) / 2147483647.5 - 1;
}

function envelopeAt(time, gate, synth) {
  const attack = Math.max(0.001, synth.attack);
  const decay = Math.max(0.001, synth.decay);
  if (time < attack) return time / attack;
  if (time < attack + decay) {
    return 1 - (1 - synth.sustain) * ((time - attack) / decay);
  }
  return synth.sustain;
}

function filterCoefficients(cutoff, resonance, sampleRate) {
  const frequency = clamp(cutoff, 20, sampleRate * 0.44);
  const omega = (Math.PI * 2 * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * Math.max(0.4, resonance));
  const cosine = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosine) / 2) / a0,
    b1: (1 - cosine) / a0,
    b2: ((1 - cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function renderVoice(synth, note, gateSeconds, sampleRate, seed = 1) {
  const gate = Math.max(0.025, gateSeconds);
  const release = Math.max(0.01, synth.release);
  const totalSeconds = gate + release + 0.025;
  const sampleCount = Math.max(1, Math.ceil(totalSeconds * sampleRate));
  const output = new Float32Array(sampleCount);
  const frequency = midiToFrequency(note + (synth.transpose || 0));
  const detuneRatio = Math.pow(2, (synth.detune || 0) / 1200);
  const isNoise = synth.waveform === "noise";
  const noiseState = { value: (seed | 0) || 1 };
  let phase = 0;
  let detunedPhase = 0;
  let subPhase = 0;
  let coefficient = filterCoefficients(synth.cutoff, synth.resonance, sampleRate);
  let filter1 = 0;
  let filter2 = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    let envelope = envelopeAt(time, gate, synth);
    const startLevel =
      time >= gate ? envelopeAt(gate, gate, synth) : envelope;
    if (time >= gate) {
      const progress = clamp((time - gate) / release, 0, 1);
      envelope = startLevel * Math.pow(1 - progress, 1.25);
    }

    if (index % 24 === 0) {
      const cutoff =
        synth.cutoff + synth.filterEnv * envelopeAt(time, gate, synth);
      coefficient = filterCoefficients(cutoff, synth.resonance, sampleRate);
    }

    let input;
    if (isNoise) {
      input = noiseAt(noiseState) * 0.92;
    } else {
      const mainStep = Math.min(0.49, frequency / sampleRate);
      const detunedStep = Math.min(0.49, (frequency * detuneRatio) / sampleRate);
      phase = (phase + mainStep) % 1;
      detunedPhase = (detunedPhase + detunedStep) % 1;
      subPhase = (subPhase + Math.min(0.49, frequency / sampleRate / 2)) % 1;
      input =
        oscillator(synth.waveform, phase, mainStep) * 0.72 +
        oscillator(synth.waveform, detunedPhase, detunedStep) * 0.18 +
        oscillator("sine", subPhase, 0) * 0.12;
    }

    const filtered = coefficient.b0 * input + filter1;
    filter1 = coefficient.b1 * input - coefficient.a1 * filtered + filter2;
    filter2 = coefficient.b2 * input - coefficient.a2 * filtered;
    const safeFiltered = Number.isFinite(filtered) ? clamp(filtered, -3, 3) : 0;
    output[index] = safeFiltered * envelope * synth.volume;
  }
  return output;
}

export function renderProjectToStereo(project, options = {}) {
  const sampleRate = options.sampleRate || 48000;
  const cycles = clamp(Math.round(options.cycles || 1), 1, 8);
  const stepSeconds = 60 / project.bpm / STEPS_PER_BEAT;
  const cycleSeconds = stepSeconds * STEP_COUNT;
  const maxTail = Math.max(
    0.15,
    ...project.tracks.map((track) => track.synth.release),
  );
  const totalSeconds = cycleSeconds * cycles + maxTail;
  const frameCount = Math.max(1, Math.ceil(totalSeconds * sampleRate));
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const voiceCache = new Map();

  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex];
    if (track.mute) continue;
    const pan = clamp(track.synth.pan, -1, 1);
    const panLeft = Math.cos(((pan + 1) * Math.PI) / 4);
    const panRight = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      for (let stepIndex = 0; stepIndex < STEP_COUNT; stepIndex += 1) {
        const step = track.steps[stepIndex];
        if (!step.on) continue;
        const gate = step.sustain * stepSeconds * 0.96;
        const cacheKey = [
          trackIndex,
          stepIndex,
          step.note,
          gate.toFixed(5),
          JSON.stringify(track.synth),
        ].join(":");
        let voice = voiceCache.get(cacheKey);
        if (!voice) {
          const seed = 0x9e3779b9 ^ (trackIndex + 1) * 2654435761 ^ stepIndex;
          voice = renderVoice(track.synth, step.note, gate, sampleRate, seed);
          voiceCache.set(cacheKey, voice);
        }
        const frameOffset = Math.round(
          (cycle * STEP_COUNT + stepIndex) * stepSeconds * sampleRate,
        );
        const available = Math.min(voice.length, frameCount - frameOffset);
        for (let frame = 0; frame < available; frame += 1) {
          const value = voice[frame];
          left[frameOffset + frame] += value * panLeft;
          right[frameOffset + frame] += value * panRight;
        }
      }
    }
  }

  let peak = 0;
  const masterGain = Number.isFinite(Number(project.master?.gain))
    ? Number(project.master.gain)
    : 0.78;
  for (let index = 0; index < frameCount; index += 1) {
    left[index] *= masterGain;
    right[index] *= masterGain;
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  const scale = peak > 0.93 ? 0.93 / peak : 1;
  const fadeFrames = Math.min(Math.round(sampleRate * 0.08), frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    const fade =
      index >= frameCount - fadeFrames
        ? (frameCount - index) / fadeFrames
        : 1;
    left[index] = Math.tanh(left[index] * scale * 1.05) * 0.94 * fade;
    right[index] = Math.tanh(right[index] * scale * 1.05) * 0.94 * fade;
  }

  return { left, right, sampleRate, frameCount, duration: frameCount / sampleRate };
}
