import { ArcLengthCurve, presetControls } from './curve.js';
import { layoutTitle } from './text-layout.js';
import { makeFontAdapter } from './font-adapter.js';
import { exportSVG } from './svg-export.js';

const W = 960;
const H = 420;
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

let adapter = null;
let lastLayout = null;
let lastCurve = null;

const params = () => ({
  text: $('text').value,
  preset: $('preset').value,
  strength: $('strength').value / 100,
  fontSize: +$('fontSize').value,
  spacing: +$('spacing').value,
  baseline: +$('baseline').value,
  weight: +$('weight').value,
  maxLines: +$('maxLines').value,
});

function buildCurve(p) {
  const [p0, p1, p2, p3] = presetControls(p.preset, W, H, p.strength);
  return ArcLengthCurve.fromBezier(p0, p1, p2, p3);
}

function render() {
  if (!adapter) return;
  const p = params();
  const curve = buildCurve(p);
  const layout = layoutTitle(p.text, curve, adapter, {
    fontSize: p.fontSize,
    letterSpacing: p.spacing,
    baselineOffset: p.baseline,
    maxLines: p.maxLines,
    align: 'center',
  });
  lastLayout = layout;
  lastCurve = curve;

  ctx.clearRect(0, 0, W, H);

  // guide curve
  ctx.beginPath();
  curve.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.strokeStyle = '#2b3852';
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // glyphs
  const pathCache = new Map();
  for (const line of layout.lines) {
    for (const g of line.glyphs) {
      if (g.x === undefined) continue;
      let p2d = pathCache.get(g.ch);
      if (!p2d) {
        p2d = new Path2D(adapter.glyphPath(g.ch, 0, 0, p.fontSize).toPathData(2));
        pathCache.set(g.ch, p2d);
      }
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate((g.angle * Math.PI) / 180);
      ctx.fillStyle = '#e8edf7';
      ctx.fill(p2d);
      if (p.weight > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = p.weight;
        ctx.strokeStyle = '#e8edf7';
        ctx.stroke(p2d);
      }
      ctx.restore();
    }
  }

  // stats + status
  const clamped = layout.lines.reduce((s, l) => s + l.stats.clampedTurns, 0);
  const boosts = layout.lines.reduce((s, l) => s + l.stats.spacingBoosts, 0);
  const dropped = layout.lines.reduce((s, l) => s + l.stats.dropped, 0);
  const glyphs = layout.lines.reduce(
    (s, l) => s + l.glyphs.filter((g) => g.x !== undefined).length, 0);
  const overflow = layout.overflow.reduce((s, t) => s + [...t.text].length, 0) + dropped;
  $('s-len').textContent = curve.length.toFixed(0);
  $('s-lines').textContent = layout.lines.length;
  $('s-glyphs').textContent = glyphs;
  $('s-clamp').textContent = clamped;
  $('s-boost').textContent = boosts;
  $('s-overflow').textContent = overflow;
  const status = $('status');
  if (overflow > 0) {
    status.textContent = `⚠ 越界：${overflow} 个字符超出曲线可容纳范围，请增大曲线长度/行数或减小字号。`;
    status.className = 'warn';
  } else {
    status.textContent = '布局正常，未越界。';
    status.className = '';
  }
}

function updateOutputs() {
  const p = params();
  $('o-strength').textContent = `${Math.round(p.strength * 100)}%`;
  $('o-fontSize').textContent = `${p.fontSize}px`;
  $('o-spacing').textContent = `${p.spacing}px`;
  $('o-baseline').textContent = `${p.baseline}px`;
  $('o-weight').textContent = `${p.weight}px`;
  $('o-maxLines').textContent = p.maxLines;
}

function onInput() {
  updateOutputs();
  render();
}

for (const id of ['text', 'preset', 'strength', 'fontSize', 'spacing', 'baseline', 'weight', 'maxLines']) {
  $(id).addEventListener('input', onInput);
}

$('export').addEventListener('click', () => {
  if (!lastLayout) return;
  const p = params();
  const d = 'M' + lastCurve.points.map((pt) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' L');
  const svg = exportSVG(lastLayout, adapter, {
    fontSize: p.fontSize,
    strokeWidth: p.weight,
    fill: '#1a1a2e',
    width: W,
    height: H,
    showCurve: true,
    curvePathD: d,
  });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'curve-title.svg';
  a.click();
  URL.revokeObjectURL(a.href);
});

opentype.load('assets/NotoSansSC-Regular.otf', (err, font) => {
  if (err) {
    $('status').textContent = '字体加载失败: ' + err;
    $('status').className = 'warn';
    return;
  }
  adapter = makeFontAdapter(font);
  updateOutputs();
  render();
});
