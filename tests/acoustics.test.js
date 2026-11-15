import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PARAMS,
  normalizeParams,
  getOpening,
  getWallSegments,
  getEarlyReflectionPaths,
  calculateRoomMetrics,
  generateRoomImpulseResponse,
  buildComparison,
  makeDrySignal,
  convolveStereo,
  measureBinaural,
  encodeStereoWav,
  roomSignature,
  audioSignature,
} from "../acoustics.js";

function assertArraysDiffer(left, right) {
  let difference = Math.abs(left.length - right.length) * 1e-6;
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  assert.ok(difference > 1e-4, `expected noticeable array difference, got ${difference}`);
}

test("opening geometry follows wall dimensions and remains inside the wall", () => {
  const params = normalizeParams({
    ...DEFAULT_PARAMS,
    openingWall: "east",
    openingWidth: 2.2,
    openingOffset: 1,
  });
  const opening = getOpening(params);
  assert.equal(opening.wall, "east");
  assert.ok(opening.start >= 0);
  assert.ok(opening.end <= params.depth);
  assert.ok(Math.abs(opening.width - 2.2) < 1e-9);
  const segments = getWallSegments(params, "east");
  assert.equal(segments.length, 2);
  assert.ok(segments[0].end <= opening.start);
  assert.ok(segments[1].start >= opening.end);
});

test("image-source reflection paths are inside finite room surfaces", () => {
  const params = normalizeParams(DEFAULT_PARAMS);
  const paths = getEarlyReflectionPaths(params, 2);
  assert.ok(paths.length >= 8);
  assert.ok(paths.some((path) => path.order === 1));
  assert.ok(paths.some((path) => path.order === 2));
  for (const path of paths) {
    assert.equal(path.points.length, path.order + 2);
    for (const point of path.points) {
      assert.ok(point.x >= -1e-6 && point.x <= params.width + 1e-6);
      assert.ok(point.y >= -1e-6 && point.y <= params.depth + 1e-6);
      assert.ok(point.z >= -1e-6 && point.z <= params.height + 1e-6);
    }
  }
});

test("room changes produce a new signature and a newly generated response", () => {
  const base = normalizeParams(DEFAULT_PARAMS);
  const changed = normalizeParams({ ...base, width: base.width + 1.1 });
  assert.notEqual(roomSignature(base), roomSignature(changed));
  assert.notEqual(audioSignature(base), audioSignature(changed));

  const first = generateRoomImpulseResponse(base);
  const second = generateRoomImpulseResponse(changed);
  assert.equal(first.signature, roomSignature(base));
  assert.equal(second.signature, roomSignature(changed));
  assert.notEqual(first.signature, second.signature);
  assertArraysDiffer(first.left, second.left);
  assertArraysDiffer(first.right, second.right);
});

test("opening position changes the acoustic response", () => {
  const centered = normalizeParams({ ...DEFAULT_PARAMS, openingOffset: 0 });
  const offset = normalizeParams({ ...DEFAULT_PARAMS, openingOffset: 1.2 });
  assert.notEqual(roomSignature(centered), roomSignature(offset));
  const centeredResponse = generateRoomImpulseResponse(centered);
  const offsetResponse = generateRoomImpulseResponse(offset);
  assertArraysDiffer(centeredResponse.left, offsetResponse.left);
});

test("open and closed rooms have measurably different decay and reflection count", () => {
  const params = normalizeParams(DEFAULT_PARAMS);
  const comparison = buildComparison(params);
  assert.equal(comparison.mode, "open");
  assert.equal(comparison.current, comparison.open);
  assert.ok(comparison.closed.metrics.rt60 > comparison.open.metrics.rt60);
  assert.ok(
    comparison.closed.metrics.reflectionCount > comparison.open.metrics.reflectionCount,
    "opening should remove image-source reflections",
  );
  assert.ok(
    comparison.closed.metrics.openingArea === 0,
    "closed comparison must seal the opening",
  );
  const dry = makeDrySignal("clap");
  const closedWet = convolveStereo(dry, comparison.closed);
  const openWet = convolveStereo(dry, comparison.open);
  assertArraysDiffer(closedWet.left, openWet.left);
});

test("binaural IR and convolution output differ between left and right channels", () => {
  const params = normalizeParams(DEFAULT_PARAMS);
  const response = generateRoomImpulseResponse(params);
  assert.equal(response.metrics.channelCheck.identical, false);
  assert.equal(response.metrics.channelCheck.passed, true);
  assert.ok(response.metrics.channelCheck.correlation < 0.9995);
  assert.ok(Math.abs(response.metrics.channelCheck.leftDb - response.metrics.channelCheck.rightDb) > 0.1);
  assert.ok(Math.abs(response.metrics.itdMicroseconds) > 100);

  const dry = makeDrySignal(params.sourceKind);
  const wet = convolveStereo(dry, response);
  const check = measureBinaural(wet.left, wet.right);
  assert.equal(check.identical, false);
  assert.equal(check.passed, true);
  assert.ok(check.maxDifference > 0.05);
});

test("FFT convolution preserves known impulse response coefficients", () => {
  const dry = new Float32Array([0.2, 0, 0]);
  const left = new Float32Array([0.5]);
  const right = new Float32Array([0.25]);
  const wet = convolveStereo(dry, left, right);
  assert.equal(wet.left.length, 3);
  assert.ok(Math.abs(wet.left[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(wet.right[0] - 0.05) < 1e-6);
  assert.ok(Math.abs(wet.left[1]) < 1e-6);
});

test("exported WAV is 48 kHz 16-bit stereo and channels are not identical", () => {
  const params = normalizeParams(DEFAULT_PARAMS);
  const response = generateRoomImpulseResponse(params);
  const dry = makeDrySignal("clap");
  const wet = convolveStereo(dry, response);
  const bytes = encodeStereoWav([wet.left, wet.right], wet.sampleRate);
  const view = new DataView(bytes.buffer);
  const text = (offset, length) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(12, 4), "fmt ");
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), wet.left.length * 4);

  let channelDifference = 0;
  for (let frame = 0; frame < 5000; frame += 1) {
    const leftSample = view.getInt16(44 + frame * 4, true);
    const rightSample = view.getInt16(46 + frame * 4, true);
    channelDifference += Math.abs(leftSample - rightSample);
  }
  assert.ok(channelDifference > 1000, "encoded stereo channels must contain different PCM data");
});

test("absorption changes shorten RT60 and alter the generated tail", () => {
  const reflective = normalizeParams({ ...DEFAULT_PARAMS, absorption: 0.12 });
  const absorbent = normalizeParams({ ...DEFAULT_PARAMS, absorption: 0.55 });
  const reflectiveMetrics = calculateRoomMetrics(reflective);
  const absorbentMetrics = calculateRoomMetrics(absorbent);
  assert.ok(reflectiveMetrics.rt60 > absorbentMetrics.rt60);
  const first = generateRoomImpulseResponse(reflective);
  const second = generateRoomImpulseResponse(absorbent);
  assertArraysDiffer(first.left, second.left);
});
