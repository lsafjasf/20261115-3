// 验证三折页核心需求：
// 1. 切换折叠角度不改变元素世界坐标（两种角度下文字位置一致）
// 2. 折叠角度改变透视投影（屏幕坐标确实变化）
// 3. 屏幕->世界局部反解在两种角度下都能还原同一世界点（拖拽准确性）
// 4. 越过分页安全区会阻止导出，回到安全区后放行
// 5. 展开 SVG 只反映世界坐标，与折叠角度无关
import assert from 'node:assert/strict';
import {
  createState, panelWidth, safeRect, validateExport,
  addText, moveElement, worldToScreen, toSVG,
} from '../model.js';

const FOCAL = 900;
let passed = 0;
function ok(name) { passed++; console.log(`  ✓ ${name}`); }

// --- 准备：A4 三折页，三个面板各放一段文字 ---
const state = createState('A4');
const pw = panelWidth(state);
assert.equal(pw, 99);
const t1 = addText(state, '三折页标题', pw + 10, 20, { fontSize: 8 });
const t2 = addText(state, '左侧面板文案', 10, 40, { fontSize: 5 });
const t3 = addText(state, '右侧面板文案', 2 * pw + 10, 40, { fontSize: 5 });

// --- 1. 两种折叠角度下文字世界坐标一致 ---
state.foldAngle = 30;
const at30 = state.elements.map((el) => ({ id: el.id, x: el.x, y: el.y }));
const screen30 = state.elements.map((el) =>
  worldToScreen(state, el.x + el.w / 2, el.y + el.h / 2, FOCAL));

state.foldAngle = 120;
const at120 = state.elements.map((el) => ({ id: el.id, x: el.x, y: el.y }));
const screen120 = state.elements.map((el) =>
  worldToScreen(state, el.x + el.w / 2, el.y + el.h / 2, FOCAL));

assert.deepEqual(at120, at30, '切换折叠角度后世界坐标必须完全一致');
ok('30° 与 120° 下全部文字世界坐标一致');

// --- 2. 透视确实随角度变化（侧面板元素屏幕坐标不同） ---
assert.notDeepEqual(screen120[1], screen30[1], '左面板文字屏幕坐标应随角度变化');
assert.notDeepEqual(screen120[2], screen30[2], '右面板文字屏幕坐标应随角度变化');
assert.ok(Math.abs(screen120[1].x - screen30[1].x) > 1, '变化幅度应显著');
ok('折叠角度驱动真实透视变化');

// --- 3. 屏幕->世界雅可比反解（与 app.js 拖拽同一算法） ---
function screenDeltaToWorld(st, el, dxPx, dyPx, scale) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const s0 = worldToScreen(st, cx, cy, FOCAL);
  const sx = worldToScreen(st, cx + 1, cy, FOCAL);
  const sy = worldToScreen(st, cx, cy + 1, FOCAL);
  const a = (sx.x - s0.x) * scale, b = (sy.x - s0.x) * scale;
  const c = (sx.y - s0.y) * scale, d = (sy.y - s0.y) * scale;
  const det = a * d - b * c || 1e-9;
  return { dx: (d * dxPx - b * dyPx) / det, dy: (-c * dxPx + a * dyPx) / det };
}
for (const angle of [30, 120]) {
  state.foldAngle = angle;
  const before = { x: t2.x, y: t2.y };
  // 模拟把左面板文字拖动 1mm 对应的屏幕像素，应还原 1mm 的世界位移
  const s0 = worldToScreen(state, t2.x + t2.w / 2, t2.y + t2.h / 2, FOCAL);
  const s1 = worldToScreen(state, t2.x + t2.w / 2 + 1, t2.y + t2.h / 2, FOCAL);
  const { dx, dy } = screenDeltaToWorld(
    state, t2, (s1.x - s0.x) * 3, (s1.y - s0.y) * 3, 3); // SCALE = 3
  moveElement(state, t2.id, t2.x + dx, t2.y + dy);
  assert.ok(Math.abs(t2.x - (before.x + 1)) < 1e-9, `${angle}° 下拖拽反解应精确`);
  assert.ok(Math.abs(t2.y - before.y) < 1e-9, `${angle}° 下拖拽反解应精确`);
  moveElement(state, t2.id, before.x, before.y); // 还原
}
ok('两种角度下拖拽反解均还原相同世界位移');

// --- 4. 安全区：越过阻止导出，回到区内放行 ---
state.foldAngle = 60;
assert.deepEqual(validateExport(state), []);
ok('初始内容全部在安全区内，允许导出');

moveElement(state, t2.id, pw - t2.w / 2 - 0.5, 40); // 中心压到折痕左侧、右缘越过折痕
let errors = validateExport(state);
assert.equal(errors.length, 1);
assert.match(errors[0], /安全区/);
ok('文字越过折痕安全区时校验报错并阻止导出');

moveElement(state, t2.id, 10, 40);
assert.deepEqual(validateExport(state), []);
moveElement(state, t3.id, state.paper.width - 2, 40); // 越出纸张右缘
assert.equal(validateExport(state).length, 1);
moveElement(state, t3.id, 2 * pw + 10, 40);
assert.deepEqual(validateExport(state), []);
ok('越出纸面被拦截，移回安全区后恢复可导出');

// --- 5. 展开 SVG 与折叠角度无关，且坐标为世界坐标 ---
state.foldAngle = 30;
const svg30 = toSVG(state);
state.foldAngle = 120;
const svg120 = toSVG(state);
assert.equal(svg30, svg120, 'SVG 导出不得受折叠角度影响');
assert.match(svg30, new RegExp(`<text x="${t1.x}" y="${t1.y + t1.fontSize}"`));
assert.match(svg30, /stroke-dasharray="3 2"/); // 折痕线
assert.match(svg30, /viewBox="0 0 297 210"/);
ok('两种角度导出的展开 SVG 完全一致且含折痕线与世界坐标');

// --- 6. 切换纸张尺寸重新生成三折版面 ---
state.paperKey = 'A5';
state.paper = { width: 210, height: 148 };
assert.equal(panelWidth(state), 70);
const r = safeRect(state, 2);
assert.deepEqual(r, { x: 145, y: 5, w: 60, h: 138 });
ok('纸张尺寸切换后版面与安全区正确重算');

console.log(`\n全部 ${passed} 项验证通过`);
