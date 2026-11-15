// End-to-end demonstration of the map requirements without a browser.
// Run: node scripts/verify.mjs
import { writeFileSync } from 'node:fs';
import { generateCity } from '../src/generate.js';
import { createLabels, layoutLabels, getLabelRect, togglePin } from '../src/labels.js';
import { worldToScreen, screenToWorld, zoomAt, rectsOverlap } from '../src/geometry.js';
import { buildGeoJson } from '../src/geoexport.js';
import { renderHighResolutionPng } from '../src/pngexport.js';
import { StubCanvas } from '../test/canvas-stub.js';

const view = { center: { x: 0, y: 0 }, scale: 0.22, width: 1200, height: 800 };
const city = generateCity();
const labels = createLabels(city.pois);

layoutLabels(labels, view);
const before = labels.map((label) => ({
  name: label.name,
  anchor: { ...label.anchor },
  screen: worldToScreen(label.anchor.x, label.anchor.y, view),
  rect: getLabelRect(label, view),
}));

const zoomed = zoomAt(view, 4, 600, 400);
layoutLabels(labels, zoomed);

const rows = labels.map((label, i) => {
  const screen = worldToScreen(label.anchor.x, label.anchor.y, zoomed);
  const roundTrip = screenToWorld(screen.x, screen.y, zoomed);
  const drift = Math.hypot(
    roundTrip.x - label.anchor.x,
    roundTrip.y - label.anchor.y,
  );
  return {
    name: label.name,
    worldX: label.anchor.x.toFixed(1),
    worldY: label.anchor.y.toFixed(1),
    screenBefore: `(${before[i].screen.x.toFixed(1)}, ${before[i].screen.y.toFixed(1)})`,
    screenAfter4x: `(${screen.x.toFixed(1)}, ${screen.y.toFixed(1)})`,
    worldDriftMeters: drift.toExponential(2),
  };
});
console.table(rows);

const maxDrift = Math.max(...labels.map((label) => {
  const screen = worldToScreen(label.anchor.x, label.anchor.y, zoomed);
  const back = screenToWorld(screen.x, screen.y, zoomed);
  return Math.hypot(back.x - label.anchor.x, back.y - label.anchor.y);
}));
console.log(`最大世界坐标漂移: ${maxDrift.toExponential(2)} m (浮点精度内为 0)`);

const dense = { ...view, scale: 0.07 };
layoutLabels(labels, dense);
let overlaps = 0;
for (let i = 0; i < labels.length; i += 1) {
  for (let j = i + 1; j < labels.length; j += 1) {
    if (rectsOverlap(getLabelRect(labels[i], dense), getLabelRect(labels[j], dense))) {
      overlaps += 1;
    }
  }
}
console.log(`密集缩放下重叠标签对数: ${overlaps}`);

togglePin(labels[0]);
const frozen = { x: labels[0].offsetX, y: labels[0].offsetY };
for (const factor of [0.5, 2, 5]) {
  layoutLabels(labels, zoomAt(dense, factor, 300, 300));
}
const pinOk = labels[0].offsetX === frozen.x && labels[0].offsetY === frozen.y;
console.log(`固定标签「${labels[0].name}」偏移保持不变: ${pinOk}`);

const geo = buildGeoJson(city, labels);
writeFileSync(new URL('../artifacts/sample-map.geojson', import.meta.url), JSON.stringify(geo, null, 2));
console.log(`GeoJSON 要素数: ${geo.features.length} (1 路线 + 5 标注)`);

const source = new StubCanvas(1200, 800);
const png = renderHighResolutionPng(source, 3, (w, h) => new StubCanvas(w, h));
console.log(`3x PNG 导出尺寸: ${png.width} x ${png.height} px`);
