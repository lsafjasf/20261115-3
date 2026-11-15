import { SOURCE_DURATION } from "./scene.js";

const noiseBuffers = new WeakMap();

function envelopeAt(sequence, clip, outputTime) {
  let value = 1;
  if (clip.index > 0 && clip.overlap > 0) {
    const fadeInEnd = clip.start + clip.overlap;
    if (outputTime < fadeInEnd) {
      value *= Math.max(0, (outputTime - clip.start) / clip.overlap);
    }
  }
  const next = sequence.clips[clip.index + 1];
  if (next && next.overlap > 0) {
    const fadeOutStart = clip.end - next.overlap;
    if (outputTime > fadeOutStart) {
      value *= Math.max(0, (clip.end - outputTime) / next.overlap);
    }
  }
  return Math.max(0.001, value);
}

function scheduleEnvelope(sequence, clip, gainParam, absoluteStart, fromOutput) {
  const startTime = absoluteStart + Math.max(0, clip.start - fromOutput);
  gainParam.setValueAtTime(envelopeAt(sequence, clip, Math.max(fromOutput, clip.start)), startTime);
  const points = new Set([clip.start, clip.start + clip.overlap, clip.end, fromOutput]);
  const next = sequence.clips[clip.index + 1];
  if (next) {
    points.add(clip.end - next.overlap);
  }
  for (const point of [...points].sort((a, b) => a - b)) {
    if (point <= fromOutput || point > clip.end) continue;
    gainParam.linearRampToValueAtTime(
      envelopeAt(sequence, clip, point),
      absoluteStart + point - fromOutput,
    );
  }
  gainParam.setValueAtTime(0, absoluteStart + clip.end - fromOutput);
}

function getNoiseBuffer(ctx) {
  if (noiseBuffers.has(ctx)) return noiseBuffers.get(ctx);
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 1234567;
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[index] = (seed / 4294967296) * 2 - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

function scheduleKick(ctx, destination, at, level) {
  if (at < ctx.currentTime + 0.015) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(118, at);
  oscillator.frequency.exponentialRampToValueAtTime(44, at + 0.15);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.28 * level, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
  oscillator.connect(gain).connect(destination);
  oscillator.start(at);
  oscillator.stop(at + 0.2);
}

function scheduleHat(ctx, destination, at, level, noise) {
  if (at < ctx.currentTime + 0.015) return;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noise;
  filter.type = "highpass";
  filter.frequency.value = 4200;
  gain.gain.setValueAtTime(0.09 * level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
  source.connect(filter).connect(gain).connect(destination);
  source.start(at);
  source.stop(at + 0.07);
}

function scheduleTone(ctx, destination, at, level, frequency, duration, type = "triangle") {
  if (at < ctx.currentTime + 0.015) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.075 * level, at + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

function addClipAudio(ctx, sequence, clip, destination, absoluteStart, fromOutput, noise) {
  const clipGain = ctx.createGain();
  clipGain.gain.value = 0;
  clipGain.connect(destination);
  scheduleEnvelope(sequence, clip, clipGain.gain, absoluteStart, fromOutput);

  const beatInterval = SOURCE_DURATION / 60;
  const firstBeat = Math.floor(clip.inPoint / beatInterval);
  const lastBeat = Math.ceil(clip.outPoint / beatInterval);
  const bassNotes = [110, 146.8, 174.6, 130.8, 196, 164.8, 123.4, 146.8];

  for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
    const sourceTime = beat * beatInterval;
    if (sourceTime < clip.inPoint || sourceTime > clip.outPoint) continue;
    const outputTime = clip.start + (sourceTime - clip.inPoint);
    if (outputTime < fromOutput || outputTime >= clip.end) continue;
    const at = absoluteStart + outputTime - fromOutput;
    scheduleKick(ctx, clipGain, at, beat % 4 === 0 ? 1 : 0.62);
    const note = bassNotes[beat % bassNotes.length];
    scheduleTone(ctx, clipGain, at + 0.005, 0.8, note, 0.23, "triangle");
    scheduleTone(ctx, clipGain, at + 0.12, 0.28, note * 2, 0.12, "sine");
    scheduleHat(ctx, clipGain, at, 1, noise);
    scheduleHat(ctx, clipGain, at + beatInterval * 0.5, 0.55, noise);
  }

  const leadEvery = 1.0;
  for (let sourceTime = 0; sourceTime <= SOURCE_DURATION; sourceTime += leadEvery) {
    if (sourceTime < clip.inPoint || sourceTime > clip.outPoint) continue;
    const outputTime = clip.start + (sourceTime - clip.inPoint);
    if (outputTime < fromOutput || outputTime >= clip.end) continue;
    const at = absoluteStart + outputTime - fromOutput;
    const frequency = 440 + Math.sin(sourceTime * 1.3) * 130;
    scheduleTone(ctx, clipGain, at + 0.04, 0.46, frequency, 0.34, "sine");
  }
}

export function scheduleSequenceAudio(ctx, destination, sequence, absoluteStart, options = {}) {
  const fromOutput = Math.max(0, options.fromOutput || 0);
  const noise = getNoiseBuffer(ctx);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 16;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.22;
  compressor.connect(destination);

  for (const clip of sequence.clips) {
    if (clip.end <= fromOutput) continue;
    addClipAudio(ctx, sequence, clip, compressor, absoluteStart, fromOutput, noise);
  }
  return { compressor };
}

export function drawWaveform(canvas, sequence, color = "#ff9b54") {
  const width = Math.max(300, Math.round(canvas.clientWidth * devicePixelRatio));
  const height = Math.max(30, Math.round(canvas.clientHeight * devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const middle = height / 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const samples = Math.max(120, Math.floor(width / 4));
  for (let index = 0; index <= samples; index += 1) {
    const x = (index / samples) * width;
    const t = (index / samples) * sequence.total;
    const active = sequence.clips.some((clip) => t >= clip.start && t <= clip.end);
    const pulse = active ? 1 : 0.22;
    const wave =
      (Math.sin(index * 0.29) * 0.36 +
        Math.sin(index * 0.83 + 1.4) * 0.24 +
        Math.sin(index * 1.91 + 0.2) * 0.14) *
      pulse;
    const y = middle + wave * height * 0.6;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.16;
  for (let index = 0; index < samples; index += 4) {
    const x = (index / samples) * width;
    const amplitude = Math.abs(Math.sin(index * 0.38) * Math.cos(index * 0.12));
    const barHeight = 2 + amplitude * (height - 8);
    ctx.fillStyle = color;
    ctx.fillRect(x, middle - barHeight / 2, 1.5, barHeight);
  }
}

export async function createAudioContext() {
  const context = new AudioContext({ latencyHint: "interactive" });
  if (context.state === "suspended") await context.resume();
  return context;
}
