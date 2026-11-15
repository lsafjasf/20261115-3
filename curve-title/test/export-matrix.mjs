// Generate the full test matrix as SVG files in artifacts/svg/.
// Run: node test/export-matrix.mjs
import opentype from 'opentype.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { ArcLengthCurve, presetControls } from '../src/curve.js';
import { layoutTitle } from '../src/text-layout.js';
import { makeFontAdapter } from '../src/font-adapter.js';
import { exportSVG } from '../src/svg-export.js';

const font = await opentype.load(
  new URL('../assets/NotoSansSC-Regular.otf', import.meta.url).pathname
);
const adapter = makeFontAdapter(font);

const W = 960;
const H = 420;
const cases = [
  { name: '1-short-arc', text: 'Hello世界，曲线标题2026！', preset: 'arc', strength: 0.9, fontSize: 52 },
  { name: '2-medium-wave', text: 'Hello世界，这是Curve标题排版Engine测试2026！', preset: 'wave', strength: 0.7, fontSize: 48 },
  { name: '3-long-arc', text: '曲线上排布标题文字needs careful处理，中英文混排要自动换行并检查越界。Sharp bends must not flip！', preset: 'arc', strength: 0.5, fontSize: 44, maxLines: 3 },
  { name: '4-sharp-hook', text: 'Hello世界，急弯测试Turn！', preset: 'hook', strength: 1.0, fontSize: 46 },
  { name: '5-fontsize-small', text: 'Hello世界，曲线标题2026！', preset: 'wave', strength: 0.7, fontSize: 24 },
  { name: '6-fontsize-large', text: 'Hello世界，曲线标题2026！', preset: 'wave', strength: 0.7, fontSize: 96 },
  { name: '7-weight-bold', text: 'Hello世界，曲线标题2026！', preset: 'arc', strength: 0.65, fontSize: 52, weight: 3 },
  { name: '8-overflow', text: '这段文字实在太长太长了，definitely超出短曲线可容纳的范围，必须触发越界检查机制！', preset: 'arc', strength: 0.9, fontSize: 48, maxLines: 1 },
];

await mkdir('../artifacts/svg', { recursive: true });
for (const c of cases) {
  const [p0, p1, p2, p3] = presetControls(c.preset, W, H, c.strength);
  const curve = ArcLengthCurve.fromBezier(p0, p1, p2, p3);
  const layout = layoutTitle(c.text, curve, adapter, {
    fontSize: c.fontSize,
    letterSpacing: 4,
    maxLines: c.maxLines ?? 2,
    align: 'center',
  });
  const d = 'M' + curve.points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
  const svg = exportSVG(layout, adapter, {
    fontSize: c.fontSize,
    strokeWidth: c.weight ?? 0,
    width: W,
    height: H,
    showCurve: true,
    curvePathD: d,
  });
  const overflow = layout.overflow.reduce((s, t) => s + [...t.text].length, 0);
  const clamped = layout.lines.reduce((s, l) => s + l.stats.clampedTurns, 0);
  console.log(
    c.name.padEnd(20),
    `lines=${layout.lines.length} overflow=${overflow} clamped=${clamped}`
  );
  await writeFile(`../artifacts/svg/${c.name}.svg`, svg);
}
console.log('SVG matrix written to artifacts/svg/');
