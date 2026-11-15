'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  frameToTime,
  timeToFrame,
  TransportClock,
  createProject,
  evaluateAll,
  calibrate,
  applyManualShift,
  writeWav,
  readWav,
  shiftSamples,
  detectOnsets,
  synthesizeBeatTrack,
  FLASH_TIMES,
  BEAT_TIMES,
} = require('../src/core');

test('frame/time conversions are exact inverses at 24 fps', () => {
  assert.equal(frameToTime(24), 1);
  assert.equal(timeToFrame(1, 24), 24);
  assert.equal(frameToTime(13), 13 / 24);
});

test('transport clock shares one timebase across play/seek/step', () => {
  let t = 0;
  const clock = new TransportClock({
    fps: 24,
    durationSeconds: 20,
    now: () => t,
  });
  clock.seekToFrame(48);
  assert.equal(clock.position, 2);
  clock.play();
  t += 0.5;
  assert.ok(Math.abs(clock.position - 2.5) < 1e-9);
  clock.stepFrames(1);
  assert.equal(clock.playing, false);
  assert.equal(clock.frame, 61); // 2.5 s = frame 60, plus one
  clock.stepFrames(-2);
  assert.equal(clock.frame, 59);
});

test('calibration moves all events inside the 2-frame tolerance', () => {
  const project = createProject({
    flashTimes: FLASH_TIMES,
    beatTimes: BEAT_TIMES,
  });
  const before = evaluateAll(project);
  assert.equal(before.withinCount, 0);
  calibrate(project);
  const after = evaluateAll(project);
  assert.equal(after.withinCount, 12);
  assert.equal(after.allWithinTolerance, true);
  assert.equal(project.offset.frameShift, 13);
  assert.ok(after.maxAbsErrorFrames <= 2);
});

test('manual marker drag quantizes to whole frames', () => {
  const project = createProject({
    flashTimes: FLASH_TIMES,
    beatTimes: BEAT_TIMES,
  });
  const offset = applyManualShift(project, 100);
  assert.equal(offset.frameShift, Math.round(0.1 * 24));
  assert.equal(offset.ms, (2 / 24) * 1000);
  assert.equal(offset.source, 'manual');
});

test('WAV write/read round-trip preserves sample content', () => {
  const samples = Float64Array.from([0, 0.25, -0.5, 0.99, -1]);
  const buffer = writeWav(samples, 48000);
  const parsed = readWav(buffer);
  assert.equal(parsed.sampleRate, 48000);
  assert.equal(parsed.samples.length, samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    // Within one PCM16 quantization step (write uses 32767, read 32768).
    assert.ok(Math.abs(parsed.samples[i] - samples[i]) <= 2 / 32768);
  }
});

test('sample shift delays and pads with silence', () => {
  const samples = Float64Array.from([1, 2, 3, 4]);
  const delayed = shiftSamples(samples, 2);
  assert.deepEqual(Array.from(delayed), [0, 0, 1, 2]);
  const advanced = shiftSamples(samples, -1);
  assert.deepEqual(Array.from(advanced), [2, 3, 4, 0]);
});

test('onset detection finds every synthesized beat', () => {
  const sampleRate = 48000;
  const samples = synthesizeBeatTrack(BEAT_TIMES, sampleRate, 20);
  const onsets = detectOnsets(samples, sampleRate);
  assert.equal(onsets.length, 12);
  BEAT_TIMES.forEach((beatTime, index) => {
    assert.ok(Math.abs(onsets[index] - beatTime) < 0.02);
  });
});
