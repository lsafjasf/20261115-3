// Offline pure-JS stereo renderer. It consumes the exact same PlaybackEngine
// telemetry as the live graph, so the exported binaural mix matches what the
// user hears. Reverb is a small Schroeder network (4 combs + all-pass).

import { LoopPath } from "./path.js";
import { PlaybackEngine } from "./engine.js";
import {
  SOURCE_VOICES,
  ambientSample,
  impulseResponse,
  mulberry32,
  voiceSample,
} from "./sounds.js";
import { encodeWav } from "./wav.js";

class Reverb {
  constructor(sampleRate, ir) {
    const delays = [0.0297, 0.0371, 0.0411, 0.0437].map((s) =>
      Math.floor(s * sampleRate)
    );
    this.combs = delays.map((d) => ({ buffer: new Float32Array(d), index: 0 }));
    this.feedback = 0.84;
    this.apDelay = Math.floor(0.005 * sampleRate);
    this.ap = { buffer: new Float32Array(this.apDelay), index: 0 };
    this.apGain = 0.7;
    this.irLevel = ir[0] ? 1 : 0;
  }

  process(input) {
    let sum = 0;
    for (const comb of this.combs) {
      const delayed = comb.buffer[comb.index];
      const next = input + delayed * this.feedback;
      comb.buffer[comb.index] = next;
      comb.index = (comb.index + 1) % comb.buffer.length;
      sum += delayed;
    }
    sum /= this.combs.length;
    const ap = this.ap;
    const delayed = ap.buffer[ap.index];
    const v = sum + delayed * -this.apGain;
    ap.buffer[ap.index] = v;
    ap.index = (ap.index + 1) % ap.buffer.length;
    return delayed + v * this.apGain;
  }
}

export function renderBinaural(config, { sampleRate = 44100, duration } = {}) {
  const path = new LoopPath(config.controlPoints);
  const engine = new PlaybackEngine(path, config.sources, config.segments, {
    speed: config.speed,
    radius: config.radius,
  });
  const total = duration ?? 1 / engine.speed; // default: exactly one full loop
  const frames = Math.floor(total * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const reverb = new Reverb(sampleRate, impulseResponse(sampleRate));
  const rands = SOURCE_VOICES.map((v) => mulberry32(v.seed));
  const ambientRand = mulberry32(909);
  const frameRate = 60;
  const blockSamples = Math.round(sampleRate / frameRate);

  engine.play();
  let telemetry = engine.frame();

  for (let n = 0; n < frames; n++) {
    if (n % blockSamples === 0) {
      telemetry = engine.update(blockSamples / sampleRate);
    }
    const t = n / sampleRate;
    let dryL = 0;
    let dryR = 0;

    telemetry.sources.forEach((state, idx) => {
      const voice = SOURCE_VOICES.find((v) => v.id === state.id) ?? SOURCE_VOICES[idx];
      const sample = voiceSample(voice, t, rands[idx]);
      dryL += sample * state.gain * state.stereo.left;
      dryR += sample * state.gain * state.stereo.right;
    });

    const seg = telemetry.segment;
    const amb =
      ambientSample(seg.ambient, t, ambientRand) * 0.18 * seg.ambientGain +
      ambientSample(seg.nextAmbient, t, ambientRand) *
        0.18 *
        (1 - seg.ambientGain);
    dryL += amb;
    dryR += amb;

    const mono = (dryL + dryR) * 0.5;
    const wet = reverb.process(mono) * seg.reverb;
    left[n] = dryL * (1 - 0.5 * seg.reverb) + wet;
    right[n] = dryR * (1 - 0.5 * seg.reverb) + wet;
  }

  return {
    sampleRate,
    duration: total,
    channels: [left, right],
    wav: encodeWav([left, right], sampleRate),
  };
}

export function exportRoute(config) {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date(0).toISOString(),
      ...config,
    },
    null,
    2
  );
}
