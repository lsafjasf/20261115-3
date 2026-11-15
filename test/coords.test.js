import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasToClientPoint,
  clientToCanvasPoint,
  getViewportMetrics,
  normalizeDpr,
  syncCanvasBackingStore,
} from "../src/coords.js";

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};

test("maps pointer coordinates correctly at DPR 1 and DPR 2", () => {
  for (const dpr of [1, 2]) {
    const metrics = getViewportMetrics(
      { left: 40, top: 72, width: 1200, height: 700 },
      dpr,
    );
    const point = clientToCanvasPoint(640, 422, metrics);

    closeTo(point.x, 600);
    closeTo(point.y, 350);
    assert.equal(metrics.backingWidth, 1200 * dpr);
    assert.equal(metrics.backingHeight, 700 * dpr);
  }
});

test("accounts for CSS-scaled canvas elements and fractional DPR", () => {
  const metrics = getViewportMetrics(
    { left: 10.5, top: 20.25, width: 801.3, height: 601.7 },
    1.25,
  );
  const point = clientToCanvasPoint(410.15, 320.1, metrics);

  closeTo(point.x, ((410.15 - 10.5) / 801.3) * metrics.renderWidth);
  closeTo(point.y, ((320.1 - 20.25) / 601.7) * metrics.renderHeight);
});

test("round-trips the visual cursor through every supported DPR", () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    const metrics = getViewportMetrics(
      { left: -12.4, top: 8.7, width: 1377.35, height: 811.2 },
      dpr,
    );
    const source = { clientX: 603.21, clientY: 419.87 };
    const point = clientToCanvasPoint(
      source.clientX,
      source.clientY,
      metrics,
    );
    const roundTrip = canvasToClientPoint(point.x, point.y, metrics);

    closeTo(roundTrip.clientX, source.clientX, 1e-10);
    closeTo(roundTrip.clientY, source.clientY, 1e-10);
  }
});

test("resizes the backing store only when its rounded dimensions change", () => {
  const canvas = { width: 0, height: 0 };
  const first = getViewportMetrics({ width: 900.2, height: 500.4 }, 1.5);
  const same = getViewportMetrics({ width: 900.2, height: 500.4 }, 1.5);
  const resized = getViewportMetrics({ width: 1400, height: 800 }, 2);

  assert.equal(syncCanvasBackingStore(canvas, first), true);
  assert.deepEqual(
    { width: canvas.width, height: canvas.height },
    { width: first.backingWidth, height: first.backingHeight },
  );
  assert.equal(syncCanvasBackingStore(canvas, same), false);
  assert.equal(syncCanvasBackingStore(canvas, resized), true);
  assert.deepEqual(
    { width: canvas.width, height: canvas.height },
    { width: 2800, height: 1600 },
  );
});

test("sanitizes invalid DPR values and empty rectangles", () => {
  assert.equal(normalizeDpr(0), 1);
  assert.equal(normalizeDpr(Number.NaN), 1);
  assert.equal(normalizeDpr(1.5), 1.5);

  const metrics = getViewportMetrics({ width: 0, height: 0 }, 0);
  assert.equal(metrics.backingWidth, 1);
  assert.equal(metrics.backingHeight, 1);
  assert.deepEqual(clientToCanvasPoint(50, 50, metrics), { x: 0, y: 0 });
});
