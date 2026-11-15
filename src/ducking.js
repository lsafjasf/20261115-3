export const DEFAULT_PARAMS = Object.freeze({
  thresholdDb: -28,
  releaseMs: 420,
  maxAttenuationDb: 14,
  attackMs: 60,
  holdMs: 500
});

export const CONTROL_STEP = 128;
export const DETECTION_WINDOW_SECONDS = 0.025;

const EPSILON = 1e-7;
const DB_FLOOR = -100;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeParams(params = {}) {
  return {
    thresholdDb: clamp(Number(params.thresholdDb ?? DEFAULT_PARAMS.thresholdDb), -80, 0),
    releaseMs: clamp(Number(params.releaseMs ?? DEFAULT_PARAMS.releaseMs), 20, 5000),
    maxAttenuationDb: clamp(
      Number(params.maxAttenuationDb ?? DEFAULT_PARAMS.maxAttenuationDb),
      0,
      60
    ),
    attackMs: clamp(Number(params.attackMs ?? DEFAULT_PARAMS.attackMs), 1, 1000),
    holdMs: clamp(Number(params.holdMs ?? DEFAULT_PARAMS.holdMs), 0, 3000)
  };
}

export function amplitudeToDb(amplitude) {
  return 20 * Math.log10(Math.max(EPSILON, amplitude));
}

export function dbToAmplitude(db) {
  return 10 ** (db / 20);
}

export function skippedRanges(segments, skippedIds) {
  const skipped = skippedIds instanceof Set ? skippedIds : new Set(skippedIds);
  return segments
    .filter((segment) => skipped.has(segment.id))
    .map((segment) => [segment.start, segment.end])
    .sort((a, b) => a[0] - b[0]);
}

export function isSkippedAt(time, ranges) {
  for (let i = 0; i < ranges.length; i += 1) {
    if (time >= ranges[i][0] && time < ranges[i][1]) return true;
  }
  return false;
}

export function computeDetectionEnvelope({
  broadcast,
  sampleRate,
  segments,
  skippedIds = new Set(),
  step = CONTROL_STEP
}) {
  const ranges = skippedRanges(segments, skippedIds);
  const prefixSquares = new Float64Array(broadcast.length + 1);
  let rangeIndex = 0;

  for (let i = 0; i < broadcast.length; i += 1) {
    const time = i / sampleRate;
    while (rangeIndex < ranges.length && time >= ranges[rangeIndex][1]) rangeIndex += 1;
    const sample = rangeIndex < ranges.length
      && time >= ranges[rangeIndex][0]
      && time < ranges[rangeIndex][1]
      ? 0
      : broadcast[i];
    prefixSquares[i + 1] = prefixSquares[i] + sample * sample;
  }

  const count = Math.ceil(broadcast.length / step) + 1;
  const detectionDb = new Float32Array(count);
  const windowSamples = Math.max(1, Math.round(DETECTION_WINDOW_SECONDS * sampleRate));

  for (let index = 0; index < count; index += 1) {
    const end = Math.min(broadcast.length, index * step + 1);
    const start = Math.max(0, end - windowSamples);
    const sampleCount = Math.max(1, end - start);
    const rms = Math.sqrt((prefixSquares[end] - prefixSquares[start]) / sampleCount);
    detectionDb[index] = Math.max(DB_FLOOR, amplitudeToDb(rms));
  }

  return {
    step,
    sampleRate,
    detectionDb,
    duration: broadcast.length / sampleRate,
    ranges
  };
}

export function computeGainEnvelope(detection, rawParams) {
  const params = normalizeParams(rawParams);
  const { step, sampleRate, detectionDb } = detection;
  const count = detectionDb.length;
  const gainDb = new Float32Array(count);
  const dt = step / sampleRate;
  const attackAlpha = 1 - Math.exp(-dt / (params.attackMs / 1000));
  const releaseAlpha = 1 - Math.exp(-dt / (params.releaseMs / 1000));
  const holdSteps = Math.ceil((params.holdMs / 1000) / dt);
  let holdUntil = -1;
  let gain = 0;

  for (let index = 0; index < count; index += 1) {
    const detected = detectionDb[index] >= params.thresholdDb;
    if (detected) holdUntil = index + holdSteps;
    const active = detected || index <= holdUntil;
    const target = active ? -params.maxAttenuationDb : 0;
    const alpha = target < gain ? attackAlpha : releaseAlpha;
    gain += (target - gain) * alpha;
    gainDb[index] = Math.abs(gain) < 0.00005 ? 0 : gain;
  }

  return {
    step,
    sampleRate,
    detectionDb,
    gainDb,
    thresholdDb: params.thresholdDb,
    maxAttenuationDb: params.maxAttenuationDb,
    releaseMs: params.releaseMs,
    attackMs: params.attackMs,
    holdMs: params.holdMs,
    duration: detection.duration,
    ranges: detection.ranges
  };
}

export function computeDuckingEnvelope(options) {
  const detection = computeDetectionEnvelope(options);
  return computeGainEnvelope(detection, options.params);
}

export function envelopeValueAt(envelope, timeSeconds) {
  const exact = clamp(timeSeconds, 0, envelope.duration) * envelope.sampleRate / envelope.step;
  const index = Math.min(envelope.gainDb.length - 1, Math.floor(exact));
  const next = Math.min(envelope.gainDb.length - 1, index + 1);
  const fraction = exact - index;
  return envelope.gainDb[index] + (envelope.gainDb[next] - envelope.gainDb[index]) * fraction;
}

export function renderMix({ tracks, envelope, skippedIds = new Set() }) {
  const { sampleRate, music, broadcast } = tracks;
  const length = music.left.length;
  const outputLeft = new Float32Array(length);
  const outputRight = new Float32Array(length);
  const ranges = skippedRanges(tracks.segments, skippedIds);
  let rangeIndex = 0;
  let envelopeIndex = 0;

  for (let i = 0; i < length; i += 1) {
    const time = i / sampleRate;
    while (rangeIndex < ranges.length && time >= ranges[rangeIndex][1]) rangeIndex += 1;
    const skipped = rangeIndex < ranges.length
      && time >= ranges[rangeIndex][0]
      && time < ranges[rangeIndex][1];

    const exactEnvelope = i / envelope.step;
    envelopeIndex = Math.min(envelopeIndex, envelope.gainDb.length - 1);
    while (
      envelopeIndex < envelope.gainDb.length - 2
      && exactEnvelope >= envelopeIndex + 1
    ) envelopeIndex += 1;
    const next = Math.min(envelope.gainDb.length - 1, envelopeIndex + 1);
    const fraction = clamp(exactEnvelope - envelopeIndex, 0, 1);
    const gainDb = envelope.gainDb[envelopeIndex]
      + (envelope.gainDb[next] - envelope.gainDb[envelopeIndex]) * fraction;
    const gain = dbToAmplitude(gainDb);
    const voice = skipped ? 0 : broadcast[i];

    outputLeft[i] = music.left[i] * gain + voice;
    outputRight[i] = music.right[i] * gain + voice;
  }

  return { left: outputLeft, right: outputRight, sampleRate };
}

export function measurePeak(channels) {
  let peak = 0;
  let clippedSamples = 0;
  let peakTime = 0;
  const sampleRate = channels.sampleRate;
  const length = channels.left.length;

  for (let i = 0; i < length; i += 1) {
    const left = Math.abs(channels.left[i]);
    const right = Math.abs(channels.right[i]);
    const local = Math.max(left, right);
    if (local > peak) {
      peak = local;
      peakTime = i / sampleRate;
    }
    if (left >= 1 || right >= 1) clippedSamples += 1;
  }

  return {
    peak,
    peakDb: amplitudeToDb(peak),
    peakTime,
    clippedSamples,
    clipping: clippedSamples > 0
  };
}

export function analyzeGainEnvelope(envelope, segments, skippedIds = new Set()) {
  const skipped = skippedIds instanceof Set ? skippedIds : new Set(skippedIds);
  const { gainDb, step, sampleRate } = envelope;
  const stepSeconds = step / sampleRate;
  let minimumGainDb = 0;
  let maximumSlewDbPerSecond = 0;
  let maximumRecoverySlewDbPerSecond = 0;
  let directionChanges = 0;
  let previousDirection = 0;

  for (let i = 1; i < gainDb.length; i += 1) {
    minimumGainDb = Math.min(minimumGainDb, gainDb[i]);
    const delta = gainDb[i] - gainDb[i - 1];
    maximumSlewDbPerSecond = Math.max(maximumSlewDbPerSecond, Math.abs(delta) / stepSeconds);
    maximumRecoverySlewDbPerSecond = Math.max(
      maximumRecoverySlewDbPerSecond,
      Math.max(0, delta) / stepSeconds
    );
    if (Math.abs(delta) > 0.0005) {
      const direction = Math.sign(delta);
      if (previousDirection && direction !== previousDirection) directionChanges += 1;
      previousDirection = direction;
    }
  }

  const recoveryTimes = [];
  for (const segment of segments) {
    if (skipped.has(segment.id)) continue;
    const startIndex = Math.ceil(segment.end * sampleRate / step);
    let recoveredAt = null;
    for (let i = startIndex; i < gainDb.length; i += 1) {
      if (gainDb[i] > -1) {
        recoveredAt = i;
        break;
      }
    }
    if (recoveredAt !== null) {
      recoveryTimes.push((recoveredAt - startIndex) * stepSeconds * 1000);
    }
  }

  return {
    minimumGainDb,
    maximumSlewDbPerSecond,
    maximumRecoverySlewDbPerSecond,
    directionChanges,
    recoveryMs: recoveryTimes.length ? Math.max(...recoveryTimes) : 0
  };
}

export function analyzeRelease({
  tracks,
  detection,
  params,
  skippedIds = new Set(),
  releaseMs
}) {
  const envelope = computeGainEnvelope(detection, { ...params, releaseMs });
  const mix = renderMix({ tracks, envelope, skippedIds });
  const peak = measurePeak(mix);
  const gain = analyzeGainEnvelope(envelope, tracks.segments, skippedIds);
  return { envelope, mix, peak, gain, releaseMs };
}

export function renderAndAnalyze({ tracks, params, skippedIds = new Set() }) {
  const detection = computeDetectionEnvelope({
    broadcast: tracks.broadcast,
    sampleRate: tracks.sampleRate,
    segments: tracks.segments,
    skippedIds
  });
  const envelope = computeGainEnvelope(detection, params);
  const mix = renderMix({ tracks, envelope, skippedIds });
  const peak = measurePeak(mix);
  const gain = analyzeGainEnvelope(envelope, tracks.segments, skippedIds);
  return { detection, envelope, mix, peak, gain };
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function clampPcm(sample) {
  if (sample > 1) return 1;
  if (sample < -1) return -1;
  return sample;
}

export function encodeWav(channels, sampleRate) {
  const left = channels.left;
  const right = channels.right;
  const frameCount = left.length;
  const channelCount = 2;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    const leftInt = Math.round(clampPcm(left[i]) * 32767);
    const rightInt = Math.round(clampPcm(right[i]) * 32767);
    view.setInt16(offset, leftInt, true);
    view.setInt16(offset + 2, rightInt, true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}
