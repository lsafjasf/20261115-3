// Renders every chart type to artifacts/ so output can be inspected directly.
import { writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const { Chart } = await import('../src/chart.js');

const values = [120, 135, 98, null, 160, 1200, 150, NaN, 172, -600, 165, 180];
const points = values.map((y, i) => ({ x: i + 1, y: Number.isFinite(y) ? y : null }));

mkdirSync('artifacts', { recursive: true });

for (const [chartType, axisType] of [
  ['line', 'linear'],
  ['area', 'linear'],
  ['scatter', 'symlog'],
]) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const chart = new Chart(svg, {
    width: 820,
    height: 480,
    title: `示例：${chartType} / ${axisType}`,
    chartType,
    axisType,
    series: [
      { name: '指标A', color: '#2563eb', visible: true, points },
      {
        name: '指标B',
        color: '#dc2626',
        visible: true,
        points: points.map((p) => (p.y === null ? p : { x: p.x, y: p.y * 0.4 + 30 })),
      },
    ],
  });
  const file = `artifacts/sample-${chartType}-${axisType}.svg`;
  writeFileSync(file, chart.toSVGString());
  console.log('wrote', file);
}
