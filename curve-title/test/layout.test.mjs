// Node test suite for the curve-title layout engine.
// Run: node test/layout.test.mjs
import opentype from 'opentype.js';
import { ArcLengthCurve, presetControls } from '../src/curve.js';
import { tokenize, breakLines, layoutTitle } from '../src/text-layout.js';
import { makeFontAdapter } from '../src/font-adapter.js';
import { exportSVG } from '../src/svg-export.js';

const font = await opentype.load(
  new URL('../assets/NotoSansSC-Regular.otf', import.meta.url).pathname
);
const adapter = makeFontAdapter(font);

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail}`); }
}

const MIXED = 'Hello世界，这是Curve标题2026！排版Engine测试';
const LONG_TEXT =
  '曲线上排布标题文字needs careful处理，中英文混排mixed text要自动换行，' +
  '并且检查是否越界overflow。Sharp bends must not flip glyphs或塌缩间距！';

// Three curve lengths: short / medium / long.
function makeCurve(width, kind = 'arc', strength = 0.8) {
  const [p0, p1, p2, p3] = presetControls(kind, width, 360, strength);
  return ArcLengthCurve.fromBezier(p0, p1, p2, p3);
}
const CURVES = {
  short: makeCurve(360, 'arc', 0.9),
  medium: makeCurve(880, 'wave', 0.7),
  long: makeCurve(1500, 'arc', 0.5),
};
console.log('curve lengths:',
  Object.entries(CURVES).map(([k, c]) => `${k}=${c.length.toFixed(0)}`).join(' '));

// ---------- tokenizer ----------
{
  const toks = tokenize('Hello世界 test');
  check('tokenize words+cjk', toks.map(t => t.text).join('|') === 'Hello|世|界| |test');
  check('tokenize kinds',
    toks.map(t => t.kind).join(',') === 'word,cjk,cjk,space,word');
}

// ---------- line breaking rules ----------
{
  const adv = (t) => [...t.text].length * 10;
  // Latin: break only at spaces, words never split
  const { lines } = breakLines(tokenize('aa bb cc'), adv, 45, 5);
  check('latin word wrap', lines.map(l => l.map(t => t.text).join('')).join('/') === 'aa/bb/cc');
  // CJK: break anywhere
  const r2 = breakLines(tokenize('中文标题字'), adv, 30, 5);
  check('cjk char wrap', r2.lines.length === 2 && r2.lines[0].length === 3);
  // Kinsoku: line must not start with ，。
  const r3 = breakLines(tokenize('标题，测试。文字'), adv, 40, 5);
  const starts = r3.lines.map(l => l[0].text);
  check('kinsoku no leading punct', !starts.some(s => '，。'.includes(s)),
    JSON.stringify(starts));
  // Overflow beyond maxLines
  const r4 = breakLines(tokenize('一二三四五六七八九十'), adv, 30, 2);
  check('overflow detected', r4.overflow.length === 4);
}

// ---------- invariants on curves ----------
function layoutInvariants(name, curve, text, opts) {
  const layout = layoutTitle(text, curve, adapter, opts);
  let allOk = true;
  let minChord = Infinity;
  let maxTurn = 0;
  for (const line of layout.lines) {
    const gs = line.glyphs.filter(g => g.x !== undefined);
    for (let i = 1; i < gs.length; i++) {
      const dTurn = Math.abs(gs[i].angle - gs[i - 1].angle);
      maxTurn = Math.max(maxTurn, dTurn);
      const chord = Math.hypot(gs[i].x - gs[i - 1].x, gs[i].y - gs[i - 1].y);
      const need = 0.55 * (gs[i].advance + gs[i - 1].advance) / 2;
      minChord = Math.min(minChord, chord / need);
      if (dTurn > 32.5) allOk = false;
      if (chord < need - 0.5) allOk = false;
    }
  }
  check(`${name}: no flip / no collapse`, allOk,
    `maxTurn=${maxTurn.toFixed(1)} minChordRatio=${minChord.toFixed(2)}`);
  return layout;
}

for (const [name, curve] of Object.entries(CURVES)) {
  layoutInvariants(name, curve, MIXED, { fontSize: 48, letterSpacing: 2 });
}

// Sharp bend (hook preset at full strength) must not flip glyphs.
{
  const hook = makeCurve(880, 'hook', 1.0);
  layoutInvariants('sharp-hook', hook, MIXED, { fontSize: 44, letterSpacing: 2 });
}

// ---------- font size & stroke width robustness ----------
for (const fs of [20, 48, 96]) {
  layoutInvariants(`fontSize=${fs}`, CURVES.medium, MIXED,
    { fontSize: fs, letterSpacing: fs * 0.05 });
}
// Stroke width is render-only: layout must be identical for 粗细 0..4px.
{
  const base = layoutTitle(MIXED, CURVES.medium, adapter, { fontSize: 48 });
  const svg0 = exportSVG(base, adapter, { fontSize: 48, strokeWidth: 0 });
  const svg4 = exportSVG(base, adapter, { fontSize: 48, strokeWidth: 4 });
  const pos0 = [...svg0.matchAll(/translate\(([\d. -]+)\)/g)].map(m => m[1]);
  const pos4 = [...svg4.matchAll(/translate\(([\d. -]+)\)/g)].map(m => m[1]);
  check('stroke width does not change layout',
    JSON.stringify(pos0) === JSON.stringify(pos4));
  check('svg uses editable outlines',
    !svg0.includes('<text') && svg0.includes('<path'));
}

// ---------- auto wrap & overflow ----------
{
  const layout = layoutTitle(LONG_TEXT, CURVES.short, adapter,
    { fontSize: 40, maxLines: 2 });
  check('auto wrap produces multiple lines', layout.lines.length >= 2,
    `lines=${layout.lines.length}`);
  check('overflow flagged on short curve', layout.overflow.length > 0,
    `overflow=${layout.overflow.length}`);
  const layoutLong = layoutTitle(LONG_TEXT, CURVES.long, adapter,
    { fontSize: 40, maxLines: 3 });
  check('long curve fits more text',
    layoutLong.overflow.length < layout.overflow.length);
}

// ---------- baseline offset & letter spacing ----------
{
  const a = layoutTitle(MIXED, CURVES.medium, adapter,
    { fontSize: 48, baselineOffset: 0 });
  const b = layoutTitle(MIXED, CURVES.medium, adapter,
    { fontSize: 48, baselineOffset: 30 });
  const ya = a.lines[0].glyphs[0].y;
  const yb = b.lines[0].glyphs[0].y;
  check('baseline offset shifts glyphs', Math.abs(ya - yb) > 20,
    `dy=${(yb - ya).toFixed(1)}`);
  const short = 'AB世界';
  const c0 = layoutTitle(short, CURVES.medium, adapter,
    { fontSize: 48, letterSpacing: 0 });
  const c1 = layoutTitle(short, CURVES.medium, adapter,
    { fontSize: 48, letterSpacing: 20 });
  const grown = c1.lines[0].total - c0.lines[0].total;
  check('letter spacing widens line', grown > 70 && grown < 90,
    `d=${grown.toFixed(0)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
