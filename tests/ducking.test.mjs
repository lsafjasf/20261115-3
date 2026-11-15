import test from "node:test";
import assert from "node:assert/strict";
import { createDemoTracks } from "../src/demo.js";
import {
  DEFAULT_PARAMS,
  analyzeRelease,
  computeDetectionEnvelope,
  computeGainEnvelope,
  encodeWav,
  envelopeValueAt,
  measurePeak,
  renderMix
} from "../src/ducking.js";

const tracks = createDemoTracks();
const baseDetection = computeDetectionEnvelope({
  broadcast: tracks.broadcast,
  sampleRate: tracks.sampleRate,
  segments: tracks.segments
});

test("broadcast activity ducks music and hold avoids syllable chatter", () => {
  const envelope = computeGainEnvelope(baseDetection, DEFAULT_PARAMS);
  const duringFirst = envelopeValueAt(envelope, 8);
  const duringCheck = envelopeValueAt(envelope, 10.5);
  const beforeFirst = envelopeValueAt(envelope, 4);
  const afterRelease = envelopeValueAt(envelope, 14.5);

  assert.ok(beforeFirst > -0.1, `expected open music, got ${beforeFirst}`);
  assert.ok(duringFirst < -10, `expected ducked music, got ${duringFirst}`);
  assert.ok(duringCheck < -10, `expected sustained ducking, got ${duringCheck}`);
  assert.ok(afterRelease > -1, `expected recovered music, got ${afterRelease}`);
  assert.equal(Math.min(...envelope.gainDb), -DEFAULT_PARAMS.maxAttenuationDb);
});

test("skipping a broadcast segment recomputes the envelope without ducking", () => {
  const skippedIds = new Set(["b2"]);
  const detection = computeDetectionEnvelope({
    broadcast: tracks.broadcast,
    sampleRate: tracks.sampleRate,
    segments: tracks.segments,
    skippedIds
  });
  const envelope = computeGainEnvelope(detection, DEFAULT_PARAMS);
  const insideSkipped = envelopeValueAt(envelope, 20.5);
  const nextActiveSegment = envelopeValueAt(envelope, 20.5);
  const followingActiveSegment = envelopeValueAt(envelope, 30);

  assert.ok(insideSkipped > -0.15, `skipped section should be open, got ${insideSkipped}`);
  assert.equal(nextActiveSegment, insideSkipped);
  assert.ok(followingActiveSegment < -10, `following broadcast should still duck, got ${followingActiveSegment}`);
  assert.equal(envelope.ranges.length, 1);
});

test("values before and after a pause stay on the same deterministic envelope", () => {
  const envelope = computeGainEnvelope(baseDetection, DEFAULT_PARAMS);
  const pausedAt = 12.9;
  const valuesBefore = [12.4, 12.6, pausedAt].map((time) => envelopeValueAt(envelope, time));
  const valuesAfter = [pausedAt, 13.2, 13.6].map((time) => envelopeValueAt(envelope, time));

  assert.equal(valuesBefore[2], valuesAfter[0]);
  assert.ok(valuesBefore[1] > valuesBefore[0]);
  assert.ok(valuesAfter[1] > valuesAfter[0]);
});

test("maximum attenuation and threshold respond to user controls", () => {
  const shallow = computeGainEnvelope(baseDetection, {
    ...DEFAULT_PARAMS,
    maxAttenuationDb: 6
  });
  const disabled = computeGainEnvelope(baseDetection, {
    ...DEFAULT_PARAMS,
    thresholdDb: 0
  });

  assert.ok(Math.min(...shallow.gainDb) <= -5.9);
  assert.ok(Math.min(...disabled.gainDb) > -0.05);
});

test("150 ms and 650 ms releases render without clipping", () => {
  const common = {
    tracks,
    detection: baseDetection,
    params: DEFAULT_PARAMS,
    skippedIds: new Set()
  };
  const fast = analyzeRelease({ ...common, releaseMs: 150 });
  const smooth = analyzeRelease({ ...common, releaseMs: 650 });

  assert.equal(fast.peak.clippedSamples, 0);
  assert.equal(smooth.peak.clippedSamples, 0);
  assert.ok(fast.peak.peakDb < -6, `fast peak ${fast.peak.peakDb}`);
  assert.ok(smooth.peak.peakDb < -6, `smooth peak ${smooth.peak.peakDb}`);
  assert.ok(smooth.gain.recoveryMs > fast.gain.recoveryMs);
  assert.ok(smooth.gain.maximumRecoverySlewDbPerSecond < fast.gain.maximumRecoverySlewDbPerSecond * 0.5);
});

test("WAV export has a valid stereo PCM header and no clipped samples", () => {
  const envelope = computeGainEnvelope(baseDetection, DEFAULT_PARAMS);
  const mix = renderMix({ tracks, envelope });
  const peak = measurePeak(mix);
  const bytes = encodeWav(mix, tracks.sampleRate);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedSize = 44 + tracks.music.left.length * 4;

  assert.equal(bytes.length, expectedSize);
  assert.equal(view.getUint32(24, true), tracks.sampleRate);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), expectedSize - 44);
  assert.equal(peak.clippedSamples, 0);
});
