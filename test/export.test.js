import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/generate.js';
import { createLabels, togglePin, layoutLabels } from '../src/labels.js';
import { buildGeoJson, toLonLat } from '../src/geoexport.js';
import { renderHighResolutionPng } from '../src/pngexport.js';
import { StubCanvas, StubContext } from './canvas-stub.js';

const baseView = { center: { x: 0, y: 0 }, scale: 0.22, width: 1000, height: 700 };

test('GeoJSON export contains a route LineString and five point features', () => {
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  togglePin(labels[0]);
  const geo = buildGeoJson(city, labels);

  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.features.length, 6);
  const route = geo.features[0];
  assert.equal(route.geometry.type, 'LineString');
  assert.equal(route.geometry.coordinates.length, city.route.length);
  assert.ok(route.properties.lengthMeters > 0);

  const points = geo.features.slice(1);
  assert.equal(points.length, 5);
  for (const feature of points) {
    assert.equal(feature.geometry.type, 'Point');
    assert.equal(feature.geometry.coordinates.length, 2);
    assert.equal(feature.properties.kind, 'annotation');
  }
  assert.equal(points[0].properties.pinned, true);
  assert.equal(points[1].properties.pinned, false);
});

test('GeoJSON projection is consistent and inside Shanghai bounds', () => {
  const origin = toLonLat({ x: 0, y: 0 });
  assert.ok(Math.abs(origin[0] - 121.4737) < 1e-6);
  assert.ok(Math.abs(origin[1] - 31.2304) < 1e-6);
  const shifted = toLonLat({ x: 1000, y: 1000 });
  assert.ok(shifted[0] > origin[0] && shifted[1] > origin[1]);
});

test('high-resolution PNG pipeline renders at three times the CSS size', () => {
  const source = new StubCanvas(1000, 700);
  const created = [];
  const factory = (width, height) => {
    const canvas = new StubCanvas(width, height);
    created.push(canvas);
    return canvas;
  };

  const output = renderHighResolutionPng(source, 3, factory);
  assert.equal(output.width, 3000);
  assert.equal(output.height, 2100);
  assert.deepEqual(output.__exportMeta, { pixelRatio: 3, cssWidth: 1000, cssHeight: 700 });

  const scaleCalls = output.context.calls.filter(([name]) => name === 'scale');
  assert.deepEqual(scaleCalls[0], ['scale', 3, 3]);
  const drawCalls = output.context.calls.filter(([name]) => name === 'drawImage');
  assert.equal(drawCalls.length, 1);
  assert.deepEqual(drawCalls[0], ['drawImage', source, 0, 0, 1000, 700]);
});

test('full render pipeline draws five labels, scale bar and north arrow', async () => {
  const { renderMap } = await import('../src/maprender.js');
  const { renderOverlay } = await import('../src/overlay.js');
  const city = generateCity(42);
  const labels = createLabels(city.pois);
  layoutLabels(labels, baseView);

  const ctx = new StubContext();
  renderMap(ctx, city, baseView);
  renderOverlay(ctx, labels, baseView);

  const labelTexts = ctx.calls
    .filter(([name]) => name === 'fillText')
    .map(([, text]) => text);
  for (const poi of city.pois) {
    assert.ok(labelTexts.includes(poi.name), `${poi.name} label must be rendered`);
  }
  const north = labelTexts.find((text) => text === 'N');
  assert.ok(north, 'north arrow marker must be rendered');
  const meterLabels = labelTexts.filter((text) => /m$|km$/.test(text));
  assert.ok(meterLabels.length >= 1, 'scale bar caption must be rendered');
});
