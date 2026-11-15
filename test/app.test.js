import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { StubCanvas } from './canvas-stub.js';

// The app touches window only for resize events; provide a minimal stub.
globalThis.window = globalThis.window || {
  devicePixelRatio: 1,
  addEventListener() {},
};

test('app renders five annotations and preserves anchors across interactive zoom', () => {
  const canvas = new StubCanvas(1200, 800);
  const app = createApp(canvas);
  assert.equal(app.state.labels.length, 5);

  const labels = app.state.labels;
  const initialAnchors = labels.map((label) => ({ ...label.anchor }));
  const initialScale = app.state.view.scale;

  app.zoom(2, 600, 400);
  app.zoom(2, 600, 400);
  assert.ok(Math.abs(app.state.view.scale - initialScale * 4) < 1e-9);

  labels.forEach((label, i) => {
    assert.deepEqual(label.anchor, initialAnchors[i], 'world anchor never changes');
  });

  const pinnedLabel = labels[1];
  pinnedLabel.pinned = true;
  const frozen = { x: pinnedLabel.offsetX, y: pinnedLabel.offsetY };
  app.zoom(0.35, 200, 100);
  app.render();
  assert.equal(pinnedLabel.offsetX, frozen.x);
  assert.equal(pinnedLabel.offsetY, frozen.y);

  const drawTexts = canvas.context.calls
    .filter(([name]) => name === 'fillText')
    .map(([, text]) => text);
  for (const label of labels) {
    assert.ok(drawTexts.includes(label.name));
  }
});
