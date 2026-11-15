import test from "node:test";
import assert from "node:assert/strict";
import {
  HOLES,
  buildField,
  contourColor,
  contourLegendColor,
  contourLevels,
  makeSampleData,
  sampleDomain,
  traceContour
} from "../heatmap-core.js";

const samples = makeSampleData(118);
const domain = sampleDomain(samples, 1.4);

function containsHole(x, y) {
  return HOLES.some((hole) => {
    if ("r" in hole) return (x - hole.x) ** 2 + (y - hole.y) ** 2 < hole.r ** 2;
    return ((x - hole.x) / hole.rx) ** 2 + ((y - hole.y) / hole.ry) ** 2 < 1;
  });
}

test("sample data is finite and leaves both sampling holes empty", () => {
  assert.ok(samples.length >= 100);
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample.x));
    assert.ok(Number.isFinite(sample.y));
    assert.ok(Number.isFinite(sample.value));
    assert.equal(containsHole(sample.x, sample.y), false);
  }
});

test("coverage mask keeps both sampling holes invalid at both bandwidths", () => {
  for (const sigma of [18, 36]) {
    const field = buildField(samples, 320, 360, sigma);
    for (const hole of HOLES) {
      const x = Math.floor(hole.x * field.width);
      const y = Math.floor(hole.y * field.height);
      assert.equal(field.valid[y * field.width + x], 0, `${hole.label} at sigma ${sigma}`);
    }
  }
});

test("contours never enter an invalid sampling hole", () => {
  const field = buildField(samples, 320, 360, 24);
  const levels = contourLevels(domain[0], domain[1], 4);
  for (const level of levels) {
    const segments = traceContour(field, level);
    for (let index = 0; index < segments.length; index += 4) {
      const x1 = segments[index] / field.width;
      const y1 = segments[index + 1] / field.height;
      const x2 = segments[index + 2] / field.width;
      const y2 = segments[index + 3] / field.height;
      assert.equal(containsHole(x1, y1), false, `segment start inside hole at level ${level}`);
      assert.equal(containsHole(x2, y2), false, `segment end inside hole at level ${level}`);
    }
  }
});

test("increasing bandwidth visibly changes coverage and contour complexity", () => {
  const narrow = buildField(samples, 320, 360, 18);
  const wide = buildField(samples, 320, 360, 36);
  const levels = contourLevels(domain[0], domain[1], 4);
  const narrowSegments = levels.reduce((sum, level) => sum + traceContour(narrow, level).length / 4, 0);
  const wideSegments = levels.reduce((sum, level) => sum + traceContour(wide, level).length / 4, 0);
  assert.ok(wide.validCount > narrow.validCount);
  assert.ok(wideSegments < narrowSegments);
  assert.notEqual(wide.rmse, narrow.rmse);
});

test("contour interval produces evenly spaced levels", () => {
  const levels = contourLevels(domain[0], domain[1], 4);
  assert.ok(levels.length >= 6);
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(Math.abs(levels[index] - levels[index - 1] - 4) < 1e-9);
  }
});

test("contour strokes and legend use exactly the same colors", () => {
  for (const level of contourLevels(domain[0], domain[1], 4)) {
    assert.equal(contourColor(level, domain), contourLegendColor(level, domain));
  }
});

test("valid field pixels expose an interpolation error for hover readout", () => {
  const field = buildField(samples, 240, 280, 24);
  const validIndex = field.valid.findIndex((isValid) => isValid);
  assert.notEqual(validIndex, -1);
  assert.ok(Number.isFinite(field.values[validIndex]));
  assert.ok(field.errors[validIndex] >= 0);
  assert.ok(Number.isFinite(field.nearest[validIndex]));
});
