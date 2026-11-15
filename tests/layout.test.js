import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WIDTH_STEPS,
  FONT_STACK,
  LAYOUT,
  computeLayout,
  findRowOverlaps,
  findOutOfBounds,
  strokeEmForWeight,
  baseFontWeight,
  morphMatrix,
  transformBox,
  inkBox,
  defaultGuides,
} from "../js/layout.js";
import { buildSvg } from "../js/svg.js";

// 近似浏览器 canvas 测量：中文全角 ~1em，拉丁/数字 ~0.56em，空格 ~0.3em。
function fakeMeasure(text, fontSize) {
  let units = 0;
  for (const char of text) {
    if (/\s/.test(char)) units += 0.3;
    else if (/[\u3400-\u9fff\uff00-\uffef]/.test(char)) units += 1;
    else units += 0.56;
  }
  return units * fontSize;
}

const CN_EN = "字体实验 Typography Lab 2026";
const LONG = "中英混排 Mixed CJK & Latin 标题设计 Title Design — 测试 Test 0123456789";

test("宽度档位固定为五档且顺序正确", () => {
  assert.deepEqual(WIDTH_STEPS, [0.7, 0.85, 1, 1.15, 1.3]);
});

test("五档宽度在默认参数下无重叠、不越界（中英混排）", () => {
  const layout = computeLayout(
    { text: CN_EN, fontSize: 64, weight: 700, slant: -8 },
    fakeMeasure
  );
  assert.equal(layout.rows.length, 5);
  assert.deepEqual(findRowOverlaps(layout), []);
  assert.deepEqual(findOutOfBounds(layout), []);
});

test("长文本 + 大字号 + 最大倾斜 + 最粗字重仍然无重叠", () => {
  const layout = computeLayout(
    { text: LONG, fontSize: 120, weight: 900, slant: 20 },
    fakeMeasure
  );
  assert.deepEqual(findRowOverlaps(layout), []);
  assert.deepEqual(findOutOfBounds(layout), []);
});

test("反向倾斜同样无重叠", () => {
  const layout = computeLayout(
    { text: CN_EN, fontSize: 96, weight: 500, slant: -20 },
    fakeMeasure
  );
  assert.deepEqual(findRowOverlaps(layout), []);
});

test("小字号下限 28px 无重叠", () => {
  const layout = computeLayout(
    { text: CN_EN, fontSize: 28, weight: 300, slant: 0 },
    fakeMeasure
  );
  assert.deepEqual(findRowOverlaps(layout), []);
  assert.deepEqual(findOutOfBounds(layout), []);
});

test("字重只通过 stroke 模拟，且随字重单调增加", () => {
  assert.equal(baseFontWeight(300), 300);
  assert.equal(baseFontWeight(400), 400);
  assert.equal(baseFontWeight(700), 400);
  assert.equal(baseFontWeight(900), 400);
  assert.equal(strokeEmForWeight(400), 0);
  assert.ok(strokeEmForWeight(500) > 0);
  assert.ok(strokeEmForWeight(700) > strokeEmForWeight(500));
  assert.equal(strokeEmForWeight(900), LAYOUT.maxStrokeEm);
});

test("形变矩阵同时编码字宽与倾斜", () => {
  assert.equal(morphMatrix(1, 0), "matrix(1 0 0 1 0 0)");
  const matrix = morphMatrix(0.7, -8);
  assert.match(matrix, /^matrix\(0\.7 -0\.\d+ 0 1 0 0\)$/);
});

test("倾斜包围盒包含 skew 产生的横向位移", () => {
  const box = inkBox(100, 10, 0);
  const straight = transformBox(box, 1, 0, 0, 50);
  const slanted = transformBox(box, 1, -20, 0, 50);
  assert.ok(slanted.minX < straight.minX || slanted.maxX > straight.maxX);
});

test("默认参考线全部落在画布范围内", () => {
  const layout = computeLayout(
    { text: CN_EN, fontSize: 64, weight: 700, slant: -8 },
    fakeMeasure
  );
  for (const guide of defaultGuides(layout)) {
    const max = guide.orientation === "h" ? layout.height : layout.width;
    assert.ok(guide.pos >= 0 && guide.pos <= max);
  }
});

test("构建的 SVG 含五档文本、形变矩阵、字体栈且无外部字体引用", () => {
  const state = {
    text: CN_EN,
    fontSize: 64,
    weight: 700,
    slant: -8,
    fillColor: "#15181d",
    bgColor: "#fff",
    guideColor: "#e0533d",
  };
  const layout = computeLayout(state, fakeMeasure);
  const svg = buildSvg({
    layout,
    state,
    guides: defaultGuides(layout),
    options: { showGuides: true, exportGuides: true, showLabels: true, interactive: false },
  });
  assert.equal((svg.match(/<text /g) || []).length, 5 + 10);
  assert.equal((svg.match(/matrix\(/g) || []).length, 5);
  assert.match(svg, /stroke-width="/);
  assert.ok(svg.includes("system-ui"));
  assert.doesNotMatch(svg, /@font-face|url\(|\.woff|\.ttf|\.otf/);
  assert.match(svg, /<svg /);
});

test("关闭参考线导出时 SVG 不含 guide 节点", () => {
  const state = {
    text: CN_EN,
    fontSize: 64,
    weight: 400,
    slant: 0,
    fillColor: "#000",
    bgColor: "#fff",
    guideColor: "#f00",
  };
  const layout = computeLayout(state, fakeMeasure);
  const svg = buildSvg({
    layout,
    state,
    guides: defaultGuides(layout),
    options: { showGuides: true, exportGuides: false, showLabels: false, interactive: false },
  });
  assert.doesNotMatch(svg, /class="guide"/);
  assert.equal((svg.match(/<text /g) || []).length, 5);
});

test("字体栈全部为系统字体名称", () => {
  assert.doesNotMatch(FONT_STACK, /url|data:|http/);
  assert.ok(FONT_STACK.includes("sans-serif"));
});
