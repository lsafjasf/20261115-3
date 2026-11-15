'use strict';

// Synthesis of the reference beat track and independent envelope
// onset detection used to verify the exported, offset audio.

const BEAT_DURATION_S = 0.08;
const BEAT_FREQ_HZ = 150;

function synthesizeBeatTrack(beatTimes, sampleRate, durationSeconds) {
  const total = Math.round(durationSeconds * sampleRate);
  const samples = new Float64Array(total);
  const burstLength = Math.round(BEAT_DURATION_S * sampleRate);
  for (const beatTime of beatTimes) {
    const start = Math.round(beatTime * sampleRate);
    for (let i = 0; i < burstLength && start + i < total; i += 1) {
      const t = i / sampleRate;
      // Short attack plus exponential decay gives a crisp, detectable onset.
      const attack = Math.min(1, t / 0.004);
      const decay = Math.exp(-t * 18);
      const tone = Math.sin(2 * Math.PI * BEAT_FREQ_HZ * t);
      samples[start + i] += 0.8 * attack * decay * tone;
    }
  }
  return samples;
}

// Peak-picking onset detector: an onset is the first frame whose RMS
// exceeds an adaptive threshold, followed by a refractory gap.
function detectOnsets(samples, sampleRate, options = {}) {
  const windowMs = options.windowMs || 10;
  const windowSize = Math.round((windowMs / 1000) * sampleRate);
  const hop = Math.max(1, Math.floor(windowSize / 2));
  const envelope = [];
  for (let start = 0; start + windowSize <= samples.length; start += hop) {
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j += 1) {
      const v = samples[start + j];
      sumSquares += v * v;
    }
    envelope.push({
      start,
      time: start / sampleRate,
      rms: Math.sqrt(sumSquares / windowSize),
    });
  }
  const peak = envelope.reduce((max, frame) => Math.max(max, frame.rms), 0);
  const threshold = options.thresholdRatio
    ? peak * options.thresholdRatio
    : peak * 0.15;
  const refractoryMs = options.refractoryMs || 120;
  const refractorySamples = (refractoryMs / 1000) * sampleRate;
  const onsets = [];
  let lastOnsetStart = -Infinity;
  for (const frame of envelope) {
    if (frame.rms < threshold) continue;
    if (frame.start - lastOnsetStart < refractorySamples) continue;
    onsets.push(frame.time);
    lastOnsetStart = frame.start;
  }
  return onsets;
}

module.exports = {
  BEAT_DURATION_S,
  BEAT_FREQ_HZ,
  synthesizeBeatTrack,
  detectOnsets,
};
