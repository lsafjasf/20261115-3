// Browser-layer integration test using jsdom (dev-only, not a runtime dependency).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const { Chart } = await import('../src/chart.js');

const points = (values) =>
  values.map((y, i) => ({ x: i + 1, y: Number.isFinite(y) ? y : null }));
const revenue = [120, 135, 98, 142, null, 160, 1200, 150, 138, NaN, 172, 165];
const cost = [80, 92, 88, 95, 102, 97, 110, 200, 105, 98, -600, 101];

function makeChart() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  return new Chart(svg, {
    width: 820,
    height: 480,
    title: '集成测试图表',
    series: [
      { name: '营收', color: '#2563eb', visible: true, points: points(revenue) },
      { name: '成本', color: '#dc2626', visible: true, points: points(cost) },
    ],
  });
}

test('renders editable SVG nodes: real text, paths and no raster images', () => {
  const chart = makeChart();
  const svg = chart.svg;
  assert.ok(svg.querySelector('text.chart-title').textContent.includes('集成测试图表'));
  assert.ok(svg.querySelectorAll('text.axis-label').length > 4);
  // revenue has 2 gaps -> 3 segments; cost has none -> 1 segment.
  assert.equal(svg.querySelectorAll('path.line-path').length, 4);
  assert.equal(svg.querySelectorAll('image').length, 0);
});

test('series toggle recomputes domains and removes its geometry', () => {
  const chart = makeChart();
  let eventCount = 0;
  chart.svg.addEventListener('chart:update', () => { eventCount += 1; });
  const fullMax = chart.fullYDomain[1];

  chart.setSeriesVisibility('营收', false);
  assert.equal(chart.svg.querySelectorAll('g.series').length, 1);
  assert.ok(chart.fullYDomain[1] < fullMax, 'outlier axis padding dropped');
  assert.ok(eventCount >= 1);

  chart.setSeriesVisibility('营收', true);
  assert.equal(chart.svg.querySelectorAll('g.series').length, 2);
});

test('chart types switch between paths, area fills and circles', () => {
  const chart = makeChart();
  chart.setChartType('area');
  assert.ok(chart.svg.querySelectorAll('path.area-path').length >= 2);
  chart.setChartType('scatter');
  const definedCount =
    revenue.filter(Number.isFinite).length + cost.filter(Number.isFinite).length;
  assert.equal(chart.svg.querySelectorAll('circle.scatter-point').length, definedCount);
  chart.setChartType('line');
  assert.ok(chart.svg.querySelectorAll('path.line-path').length >= 4);
});

test('symlog axis renders a zero label and keeps negative ticks', () => {
  const chart = makeChart();
  chart.setAxisType('symlog');
  const labels = [...chart.svg.querySelectorAll('text.y-label')].map((n) => n.textContent);
  assert.ok(labels.includes('0'));
  assert.ok(labels.some((text) => text.startsWith('-')));
});

test('wheel zoom narrows domains and double-click reset restores them', () => {
  const chart = makeChart();
  const originalX = chart.fullXDomain.slice();
  const fakeWheel = (deltaY, clientX, clientY) =>
    chart.handleWheel({
      preventDefault() {}, deltaY, clientX, clientY,
    });
  for (let i = 0; i < 3; i += 1) fakeWheel(-100, 400, 240);
  assert.ok(chart.zoom.x[1] - chart.zoom.x[0] < originalX[1] - originalX[0]);
  assert.ok(chart.zoom.y !== null);

  chart.resetZoom();
  assert.deepEqual(chart.xScale.domain(), originalX);
  assert.equal(chart.zoom.x, null);
});

test('exported SVG is standalone XML with editable text and paths', () => {
  const chart = makeChart();
  const output = chart.toSVGString();
  assert.ok(output.startsWith('<?xml version="1.0"'));
  assert.ok(output.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(output.includes('<text'));
  assert.ok(output.includes('<path'));
  assert.ok(!output.includes('data:image'), 'no embedded raster data');
  assert.ok(output.includes('集成测试图表'));
});
