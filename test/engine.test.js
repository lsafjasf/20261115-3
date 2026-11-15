import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ViewTransform, dataBounds } from '../src/viewTransform.js';
import { AnnotationStore, sampleSeries, initialAnnotations } from '../src/chart.js';
import { layoutAnnotations } from '../src/layout.js';
import { renderSvg } from '../src/render.js';

function freshView(width = 900, height = 560) {
  const view = new ViewTransform({ width, height });
  view.fit(dataBounds(sampleSeries));
  return view;
}

function threeAnnotations() {
  const store = new AnnotationStore();
  initialAnnotations.forEach((ann) => store.add(ann));
  assert.equal(store.items.length, 3, '应实际存在三个标注');
  const types = store.items.map((item) => item.type).sort();
  assert.deepEqual(types, ['arrow', 'region', 'text']);
  return store;
}

test('缩放与平移后标注锚点仍映射回原数据点', () => {
  const view = freshView();
  const store = threeAnnotations();
  const original = store.items.map((item) => ({ id: item.id, anchor: item.anchor }));

  const states = [
    (v) => v.zoomAt([450, 280], 2.4),
    (v) => v.zoomAt([120, 90], 3.1),
    (v) => v.pan(-140, 88),
    (v) => {
      v.zoomAt([600, 400], 0.35);
      v.pan(210, -60);
    },
  ];

  for (const mutate of states) {
    mutate(view);
    const layout = layoutAnnotations(store.items, view);
    assert.equal(layout.items.length, 3);
    for (const result of layout.items) {
      const source = original.find((item) => item.id === result.id);
      // 数据坐标中的锚点从未被布局引擎修改
      assert.deepEqual(result.anchor, source.anchor);
      // 屏幕位置反向投影必须精确回到原数据点（容忍浮点误差）
      const back = view.toData(result.anchorScreen);
      assert.ok(Math.abs(back[0] - source.anchor[0]) < 1e-9);
      assert.ok(Math.abs(back[1] - source.anchor[1]) < 1e-9);
    }
  }
});

test('箭头尖端始终等于数据锚点的屏幕投影，不会被避让挪走', () => {
  const view = freshView();
  const store = threeAnnotations();
  for (const factor of [1, 1.8, 4.2, 0.4]) {
    view.zoomAt([300, 300], factor);
    const layout = layoutAnnotations(store.items, view);
    const arrow = layout.items.find((item) => item.type === 'arrow');
    const expected = view.toScreen(arrow.anchor);
    assert.deepEqual(arrow.anchorScreen, expected);
    assert.ok(Math.hypot(
      arrow.anchorScreen[0] - expected[0],
      arrow.anchorScreen[1] - expected[1],
    ) < 1e-12);
    // 引线从标签边缘连到锚点，方向由锚点决定
    const [sx, sy] = arrow.connectorStart;
    const [ax, ay] = arrow.anchorScreen;
    assert.ok(Math.hypot(ax - sx, ay - sy) > 1);
  }
});

test('碰撞避让按优先级占位，标签之间无重叠', () => {
  const view = new ViewTransform({ width: 420, height: 300 });
  view.fit(dataBounds(sampleSeries));
  const store = new AnnotationStore();
  // 两个同位置标注强制发生碰撞
  store.add({ type: 'text', anchor: [7, 25], text: '低优先级', priority: 1, labelWidth: 90, labelHeight: 28 });
  store.add({ type: 'text', anchor: [7, 25], text: '高优先级', priority: 8, labelWidth: 90, labelHeight: 28 });
  const layout = layoutAnnotations(store.items, view, { padding: 4 });
  assert.ok(layout.collisionMoves >= 1, '应触发至少一次避让移动');
  const [a, b] = layout.items;
  const intersects =
    a.labelRect.x < b.labelRect.x + b.labelRect.w &&
    a.labelRect.x + a.labelRect.w > b.labelRect.x &&
    a.labelRect.y < b.labelRect.y + b.labelRect.h &&
    a.labelRect.y + a.labelRect.h > b.labelRect.y;
  assert.equal(intersects, false, '避让后标签框不得重叠');
  const high = layout.items.find((item) => item.priority === 8);
  const low = layout.items.find((item) => item.priority === 1);
  // 高优先级直接占用首选位置（锚点右上方），低优先级被推到别处
  const anchor = view.toScreen([7, 25]);
  const preferred = { x: anchor[0] + 14, y: anchor[1] - 38, w: 90, h: 28 };
  assert.equal(high.labelRect.x, preferred.x);
  assert.equal(high.labelRect.y, preferred.y);
  assert.ok(low.labelRect.x !== preferred.x || low.labelRect.y !== preferred.y);
});

test('区域标注矩形随数据坐标缩放，且包含其数据锚点', () => {
  const view = freshView();
  const store = threeAnnotations();
  view.zoomAt([450, 280], 2.5);
  const layout = layoutAnnotations(store.items, view);
  const region = layout.items.find((item) => item.type === 'region');
  const r = region.regionRect;
  const [ax, ay] = region.anchorScreen;
  assert.ok(ax >= r.x && ax <= r.x + r.w);
  assert.ok(ay >= r.y && ay <= r.y + r.h);
  const topLeft = view.toData([r.x, r.y]);
  const bottomRight = view.toData([r.x + r.w, r.y + r.h]);
  assert.ok(Math.abs(topLeft[0] - 11.5) < 1e-9);
  assert.ok(Math.abs(topLeft[1] - 30) < 1e-9, '屏幕左上角对应数据矩形下界 y=30');
  assert.ok(Math.abs(bottomRight[0] - 14.5) < 1e-9);
  assert.ok(Math.abs(bottomRight[1] - 43) < 1e-9, '屏幕右下角对应数据矩形上界 y=43');
});

test('SVG 导出包含三个标注且箭头多边形尖端落在锚点上', () => {
  const view = freshView();
  const store = threeAnnotations();
  const layout = layoutAnnotations(store.items, view);
  const svg = renderSvg(sampleSeries, layout, view);
  assert.ok(svg.startsWith('<?xml'));
  assert.ok(svg.includes('峰值突破 25'));
  assert.ok(svg.includes('季节性回升'));
  assert.ok(svg.includes('高位震荡区'));
  assert.equal((svg.match(/<g class="label">/g) || []).length, 3);
  assert.ok(svg.includes('<polygon'));
  const arrow = layout.items.find((item) => item.type === 'arrow');
  const [ax, ay] = arrow.anchorScreen;
  const polygon = svg.match(/<polygon points="([^"]+)"/)[1];
  assert.ok(polygon.startsWith(`${ax.toFixed(2)},${ay.toFixed(2)}`));
});

test('极端放大后锚点超出视口，反向投影依然正确', () => {
  const view = freshView();
  view.zoomAt([10, 10], 20);
  const store = threeAnnotations();
  const layout = layoutAnnotations(store.items, view);
  for (const item of layout.items) {
    const back = view.toData(item.anchorScreen);
    assert.ok(Math.abs(back[0] - item.anchor[0]) < 1e-9);
    assert.ok(Math.abs(back[1] - item.anchor[1]) < 1e-9);
  }
});
