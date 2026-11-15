import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeScale, symlog, symexp, niceDomain, ticks, formatTick, tickStep,
} from '../src/scales.js';
import { planXLabels, planYLabels } from '../src/layout.js';
import {
  linePaths, areaPaths, scatterPoints, splitSegments,
  zoomDomain, combinedExtents, projectPoints,
} from '../src/geometry.js';

// Shared fixture: outliers, negative values and missing readings.
const rawA = [10, -8, 3, null, 5, 1200, -600, 9, NaN, 4];
const rawB = [2, 4, 1, 5, -3, 8, 200, -12, 7, 6];
const xs = Array.from({ length: 10 }, (_, i) => i + 1);
const toPoints = (values) =>
  values.map((y, i) => (Number.isFinite(y) ? { x: xs[i], y } : { x: xs[i], y: null }));
const pointsA = toPoints(rawA);
const pointsB = toPoints(rawB);
const width = 664;
const height = 348;

test('linear scale maps endpoints and inverts exactly', () => {
  const scale = makeScale([0, 10], [0, 100], 'linear');
  assert.equal(scale(0), 0);
  assert.equal(scale(10), 100);
  assert.equal(scale(5), 50);
  assert.equal(scale.invert(50), 5);
  assert.equal(scale.invert(scale(7.25)), 7.25);
});

test('symlog handles negative values and zero on the log axis', () => {
  assert.equal(symlog(0), 0);
  assert.ok(symlog(-10) < 0 && symlog(10) > 0);
  assert.ok(Math.abs(symlog(-100) + symlog(100)) < 1e-12);
  for (const v of [-1200, -600, -1, 0, 1, 600, 1200]) {
    assert.ok(Math.abs(symexp(symlog(v)) - v) < 1e-9);
  }
  const scale = makeScale([-1000, 1000], [0, 100], 'symlog');
  assert.equal(scale(0), 50);
  assert.ok(scale(-1000) < scale(-10));
  assert.ok(scale(10) < scale(1000));
  assert.ok(Math.abs(scale.invert(scale(-333)) + 333) < 1e-9);
});

test('niceDomain survives outliers, empty data and constant data', () => {
  const domain = niceDomain(rawA.filter(Number.isFinite), 'linear');
  assert.ok(domain[0] <= -600 && domain[1] >= 1200);
  assert.ok(domain[0] % tickStep(domain[0], domain[1]) === 0);
  const logDomain = niceDomain(rawA.filter(Number.isFinite), 'symlog');
  assert.ok(logDomain[0] <= -1000 && logDomain[1] >= 1000);
  assert.deepEqual(niceDomain([null, NaN, undefined]), [0, 1]);
  const flat = niceDomain([5, 5], 'linear');
  assert.ok(flat[0] < 5 && flat[1] > 5);
});

test('ticks stay inside the domain; symlog includes a zero tick', () => {
  const linear = ticks([-20, 80], 'linear', 6);
  assert.ok(linear.every((t) => t.value >= -20 && t.value <= 80));
  assert.ok(linear.length >= 4 && linear.length <= 8);
  const logTicks = ticks([-1000, 1000], 'symlog');
  assert.ok(logTicks.some((t) => t.value === 0 && !t.minor));
  assert.ok(logTicks.some((t) => t.value === 1000));
  assert.ok(logTicks.some((t) => t.value === -1000));
  assert.ok(logTicks.every((t) => t.value >= -1000 && t.value <= 1000));
  assert.equal(formatTick(10000, 'symlog'), '1e4');
});

test('missing values split lines into disconnected segments', () => {
  const xScale = makeScale([1, 10], [72, 72 + width]);
  const yScale = makeScale([-600, 1200], [48 + height, 48]);
  const projected = projectPoints(pointsA, xScale, yScale);
  assert.equal(projected.length, pointsA.length);
  assert.equal(projected[3], null); // raw null
  assert.equal(projected[8], null); // NaN

  const segments = splitSegments(projected);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((s) => s.length), [3, 4, 1]);

  const lines = linePaths(pointsA, xScale, yScale);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((path) => path.d.startsWith('M')));

  const areas = areaPaths(pointsA, xScale, yScale, yScale(0));
  assert.equal(areas.length, 2);
  assert.ok(areas.every((path) => path.d.includes('Z')));

  const dots = scatterPoints(pointsA, xScale, yScale);
  assert.equal(dots.length, rawA.filter(Number.isFinite).length);
});

test('all three chart types project identical point coordinates', () => {
  const xScale = makeScale([1, 10], [72, 72 + width]);
  const yScale = makeScale([-600, 1200], [48 + height, 48]);
  const expected = pointsA
    .filter((p) => Number.isFinite(p.y))
    .map((p) => ({ cx: xScale(p.x), cy: yScale(p.y) }));

  const dots = scatterPoints(pointsA, xScale, yScale);
  dots.forEach((dot, i) => {
    assert.equal(dot.cx, expected[i].cx);
    assert.equal(dot.cy, expected[i].cy);
  });

  const lineCoordinates = linePaths(pointsA, xScale, yScale)
    .flatMap((path) => path.points)
    .map((p) => ({ cx: p.x, cy: p.y }));
  // A single isolated point cannot define an area, so it is excluded there.
  const areaPoints = pointsA.filter((_, index, arr) => {
    if (!Number.isFinite(arr[index].y)) return false;
    return Number.isFinite(arr[index - 1]?.y) ||
      Number.isFinite(arr[index + 1]?.y);
  });
  const areaCoordinates = areaPoints.map((p) => ({
    cx: xScale(p.x),
    cy: yScale(p.y),
  }));
  assert.deepEqual(lineCoordinates, expected);
  assert.deepEqual(
    areaPaths(pointsA, xScale, yScale, yScale(0))
      .flatMap((path) => path.points)
      .map((p) => ({ cx: p.x, cy: p.y })),
    areaCoordinates,
  );
});

test('x labels never overlap and fall back to rotation when crowded', () => {
  const crowded = ticks([0, 100], 'linear', 40).slice(0, 20);
  const scale = makeScale([0, 100], [0, 300]);
  const plan = planXLabels(crowded, scale, (v) => String(v), {
    measure: (text) => text.length * 7.4,
    fontSize: 12,
    gap: 8,
  });
  const visible = plan.filter((label) => label.visible);
  assert.ok(visible.length < plan.length || visible[0].rotated);
  for (let i = 1; i < visible.length; i += 1) {
    const footprint = visible[i].rotated ? 30 : 20;
    assert.ok(visible[i].position - visible[i - 1].position >= footprint);
  }
  assert.ok(plan.some((label) => label.rotated));

  const sparse = ticks([0, 100], 'linear', 5);
  const sparsePlan = planXLabels(sparse, makeScale([0, 100], [0, 600]), String, {
    measure: (text) => text.length * 7.4,
  });
  assert.ok(sparsePlan.every((label) => !label.rotated));
  assert.ok(sparsePlan.every((label) => label.visible));
});

test('y labels thin out to respect vertical spacing', () => {
  const crowded = ticks([0, 100], 'linear', 30);
  const plan = planYLabels(crowded, makeScale([0, 100], [400, 0]), String, {
    lineHeight: 18,
    gap: 6,
  });
  const visible = plan.filter((label) => label.visible);
  for (let i = 1; i < visible.length; i += 1) {
    assert.ok(visible[i].position - visible[i - 1].position >= 24);
  }
});

test('zoomed ticks and data points stay aligned through invert round-trips', () => {
  const fullX = niceDomain(xs, 'linear');
  const fullY = niceDomain(rawA.filter(Number.isFinite), 'linear');
  const xRange = [72, 72 + width];
  const yRange = [48 + height, 48];
  const baseX = makeScale(fullX, xRange);
  const baseY = makeScale(fullY, yRange);

  // Zoom into the central window on both axes around pixel (360, 200).
  const zoomedXDomain = zoomDomain(fullX, 0.4, 360, xRange, baseX);
  const zoomedYDomain = zoomDomain(fullY, 0.4, 200, yRange, baseY);
  const zoomedX = makeScale(zoomedXDomain, xRange);
  const zoomedY = makeScale(zoomedYDomain, yRange);

  // Ticks drawn in the zoomed view map back to their exact data values.
  const tickCheck = ticks(zoomedXDomain, 'linear', 6).map((tick) => {
    const pixel = zoomedX(tick.value);
    return zoomedX.invert(pixel);
  });
  tickCheck.forEach((value, i) => {
    assert.ok(Math.abs(value - ticks(zoomedXDomain, 'linear', 6)[i].value) < 1e-9);
  });

  // Every visible data point must occupy the same geometry whether it is
  // computed from a line, area or scatter renderer under the zoomed scales.
  const visible = pointsA.filter(
    (p) =>
      Number.isFinite(p.y) &&
      p.x >= zoomedXDomain[0] && p.x <= zoomedXDomain[1] &&
      p.y >= zoomedYDomain[0] && p.y <= zoomedYDomain[1],
  );
  const expected = visible.map((p) => ({
    cx: zoomedX(p.x),
    cy: zoomedY(p.y),
  }));
  const fromScatter = scatterPoints(visible, zoomedX, zoomedY);
  const fromLine = linePaths(visible, zoomedX, zoomedY)
    .flatMap((path) => path.points);
  fromScatter.forEach((dot, i) => {
    assert.equal(dot.cx, expected[i].cx);
    assert.equal(dot.cy, expected[i].cy);
    assert.equal(fromLine[i].x, dot.cx);
    assert.equal(fromLine[i].y, dot.cy);
    // Pixel -> data -> pixel must be identity, proving axis/point consistency.
    assert.ok(Math.abs(zoomedX.invert(dot.cx) - visible[i].x) < 1e-9);
    assert.ok(Math.abs(zoomedY.invert(dot.cy) - visible[i].y) < 1e-9);
  });

  // Zoom clamps inside the full domain and keeps a sane minimum span.
  const clamped = zoomDomain(fullX, 1000, 360, xRange, baseX);
  assert.ok(clamped[0] >= fullX[0] && clamped[1] <= fullX[1]);
  const tiny = zoomDomain(fullX, 0.0001, 360, xRange, baseX);
  assert.ok(tiny[1] - tiny[0] >= (fullX[1] - fullX[0]) * 0.02 - 1e-9);
});

test('toggling a series recomputes combined axis extents', () => {
  const all = combinedExtents([
    { name: 'a', visible: true, points: pointsA },
    { name: 'b', visible: true, points: pointsB },
  ]);
  assert.ok(Math.max(...all.ys) === 1200);
  assert.ok(Math.min(...all.ys) === -600);

  const onlyB = combinedExtents([
    { name: 'a', visible: false, points: pointsA },
    { name: 'b', visible: true, points: pointsB },
  ]);
  assert.ok(Math.max(...onlyB.ys) === 200);
  assert.ok(Math.min(...onlyB.ys) === -12);
  const domain = niceDomain(onlyB.ys, 'linear');
  assert.ok(domain[0] <= -12 && domain[1] >= 200);
  assert.ok(domain[0] > -600, 'outlier-driven padding disappears with the series');
});
