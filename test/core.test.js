import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/generate.js';
import { createLabels, layoutLabels, togglePin } from '../src/labels.js';
import { worldToScreen, zoomAt, screenToWorld } from '../src/geometry.js';
import { computeScaleBar } from '../src/controls.js';

const baseView = { center: { x: 0, y: 0 }, scale: 0.22, width: 1000, height: 700 };

test('procedural city is deterministic and contains five POIs', () => {
  const a = generateCity(42);
  const b = generateCity(42);
  assert.equal(a.pois.length, 5);
  assert.deepEqual(a.pois, b.pois);
  assert.deepEqual(a.graph.nodes.map((n) => [n.x, n.y]), b.graph.nodes.map((n) => [n.x, n.y]));
});

test('route follows the road graph and connects the two endpoints', () => {
  const city = generateCity(42);
  assert.ok(city.route.length >= 2);
  assert.deepEqual(city.route[0], { x: city.pois[0].x, y: city.pois[0].y });
  const last = city.route[city.route.length - 1];
  assert.equal(last.x, city.pois[3].x);
  assert.equal(last.y, city.pois[3].y);

  const nodes = new Set(city.graph.nodes.map((n) => `${n.x},${n.y}`));
  for (const point of city.route) {
    assert.ok(nodes.has(`${point.x},${point.y}`), 'route point must be a road node');
  }
});

test('exactly five annotations are created with world anchors', () => {
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  assert.equal(labels.length, 5);
  labels.forEach((label, i) => {
    assert.equal(label.anchor.x, city.pois[i].x);
    assert.equal(label.anchor.y, city.pois[i].y);
    assert.equal(label.pinned, false);
  });
});

test('zoom keeps the anchored world point at the same screen position', () => {
  const anchor = { x: 320, y: 240 };
  const worldBefore = screenToWorld(anchor.x, anchor.y, baseView);
  const zoomed = zoomAt(baseView, 2.5, anchor.x, anchor.y);
  const screenAfter = worldToScreen(worldBefore.x, worldBefore.y, zoomed);
  assert.ok(Math.abs(screenAfter.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(screenAfter.y - anchor.y) < 1e-9);
  assert.ok(Math.abs(zoomed.scale - baseView.scale * 2.5) < 1e-9);
});

test('five label anchors map back to identical world coordinates after zoom', () => {
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  const zoomed = zoomAt(baseView, 3.2, 500, 350);
  for (const label of labels) {
    const before = worldToScreen(label.anchor.x, label.anchor.y, baseView);
    const after = worldToScreen(label.anchor.x, label.anchor.y, zoomed);
    const roundTrip = screenToWorld(after.x, after.y, zoomed);
    assert.ok(Math.abs(roundTrip.x - label.anchor.x) < 1e-9);
    assert.ok(Math.abs(roundTrip.y - label.anchor.y) < 1e-9);
    assert.notDeepEqual(
      [before.x, before.y].map((v) => v.toFixed(2)),
      [after.x, after.y].map((v) => v.toFixed(2)),
      'screen position changes while world anchor is preserved',
    );
  }
});

test('declutter displaces overlapping labels without changing their anchors', () => {
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  const denseView = { ...baseView, scale: 0.08 };
  const anchorsBefore = labels.map((l) => ({ ...l.anchor }));
  layoutLabels(labels, denseView);

  for (let i = 0; i < labels.length; i += 1) {
    assert.deepEqual(labels[i].anchor, anchorsBefore[i]);
  }
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const ri = labelScreenRect(labels[i], denseView);
      const rj = labelScreenRect(labels[j], denseView);
      assert.equal(overlaps(ri, rj), false, `labels ${i} and ${j} must not overlap`);
    }
  }
});

test('pinned labels never move during declutter or zoom', () => {
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  layoutLabels(labels, baseView);
  const pinned = labels[2];
  togglePin(pinned);
  const frozen = { x: pinned.offsetX, y: pinned.offsetY };

  for (const factor of [0.4, 1.8, 4.0]) {
    const view = zoomAt(baseView, factor, 500, 350);
    layoutLabels(labels, view);
    assert.equal(pinned.offsetX, frozen.x, 'pinned offsetX is immutable');
    assert.equal(pinned.offsetY, frozen.y, 'pinned offsetY is immutable');
    assert.equal(pinned.pinned, true);
  }
});

test('scale bar reports a round metric length matching its pixel size', () => {
  const bar = computeScaleBar(baseView);
  assert.ok(bar.px >= 90 && bar.px <= 200);
  assert.ok(Math.abs(bar.px - bar.meters * baseView.scale) < 1e-9);
  const zoomed = { ...baseView, scale: baseView.scale * 4 };
  const barZoomed = computeScaleBar(zoomed);
  assert.ok(Math.abs(barZoomed.px - barZoomed.meters * zoomed.scale) < 1e-9);
  assert.ok(barZoomed.px >= 90 && barZoomed.px <= 200);
});

test('layout terminates on a tiny viewport and keeps pinned labels frozen', () => {
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  togglePin(labels[0]);
  const frozen = { x: labels[0].offsetX, y: labels[0].offsetY };
  const tinyView = { center: { x: 0, y: 0 }, scale: 0.04, width: 240, height: 180 };
  assert.doesNotThrow(() => layoutLabels(labels, tinyView));
  assert.equal(labels[0].offsetX, frozen.x);
  assert.equal(labels[0].offsetY, frozen.y);
  labels.forEach((label) => {
    assert.ok(Number.isFinite(label.offsetX) && Number.isFinite(label.offsetY));
  });
});

function labelScreenRect(label, view) {
  const screen = worldToScreen(label.anchor.x, label.anchor.y, view);
  return {
    x: screen.x + label.offsetX - label.width / 2,
    y: screen.y + label.offsetY - label.height / 2,
    w: label.width,
    h: label.height,
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
