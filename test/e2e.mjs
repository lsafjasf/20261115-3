// 浏览器端冒烟验证：真实折痕透视、角度切换世界坐标不变、安全区阻止导出。
// 运行前：python3 -m http.server 8765（在仓库根目录）
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:8765/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE);
await page.waitForSelector('.panel');
let passed = 0;
const ok = (name) => { passed++; console.log(`  ok ${name}`); };

// 1. 三个面板渲染，且左右面板带 3D 旋转（真实折痕透视）
const transforms = await page.$$eval('.panel', (ps) => ps.map((p) => p.style.transform));
assert.match(transforms[0], /rotateY\(60deg\)/);
assert.match(transforms[2], /rotateY\(-60deg\)/);
assert.equal(await page.locator('.panel .el').count(), 3);
ok('三面板渲染，左右面板按折痕 3D 旋转');

// 2. 切换折叠角度：世界坐标不变，屏幕位置变化
const before = await page.evaluate(() => ({
  world: window.__app.state.elements.map((e) => ({ id: e.id, x: e.x, y: e.y })),
  screen: document.querySelector('.el span').getBoundingClientRect().toJSON(),
}));
await page.locator('#angleRange').fill('120');
const after = await page.evaluate(() => ({
  world: window.__app.state.elements.map((e) => ({ id: e.id, x: e.x, y: e.y })),
  screen: document.querySelector('.el span').getBoundingClientRect().toJSON(),
}));
assert.deepEqual(after.world, before.world, '切换角度后世界坐标必须一致');
assert.ok(
  Math.abs(after.screen.x - before.screen.x) > 1 ||
  Math.abs(after.screen.width - before.screen.width) > 1,
  '屏幕投影应随角度变化'
);
ok('切换角度后文字世界坐标一致、透视投影变化');

// 3. 拖出安全区 -> 阻止导出；拖回 -> 放行
await page.evaluate(() => {
  const st = window.__app.state;
  st.elements[1].x = 96; // 压过第一条折痕（pw=99）
  window.__app.render();
});
assert.equal(await page.locator('#exportSvgBtn').isDisabled(), true);
assert.equal(await page.locator('#exportPngBtn').isDisabled(), true);
assert.match(await page.locator('#status').textContent(), /禁止导出/);
ok('元素越过安全区时导出按钮被禁用');

await page.evaluate(() => {
  const st = window.__app.state;
  st.elements[1].x = 10;
  window.__app.render();
});
assert.equal(await page.locator('#exportSvgBtn').isDisabled(), false);
ok('移回安全区后恢复可导出');

// 4. 真实指针拖拽：折叠态下拖动文字，世界坐标按屏幕方向变化
await page.locator('#angleRange').fill('60'); // 避免 120° 时侧面板遮挡中面板
const dragBefore = await page.evaluate(() => {
  const el = window.__app.state.elements[0];
  return { x: el.x, y: el.y };
});
const box = await page.locator('.panel:nth-child(2) .el').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 5);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 30, box.y + 5, { steps: 5 });
await page.mouse.up();
const dragAfter = await page.evaluate(() => {
  const el = window.__app.state.elements[0];
  return { x: el.x, y: el.y };
});
assert.ok(dragAfter.x > dragBefore.x, '中面板向右拖动应增大世界 x');
assert.ok(Math.abs(dragAfter.y - dragBefore.y) < 1, '水平拖动不应明显改变 y');
ok('折叠态指针拖拽正确写回世界坐标');

// 5. 导出 SVG 下载
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#exportSvgBtn').click(),
]);
assert.match(download.suggestedFilename(), /trifold-flat\.svg/);
ok('展开 SVG 可正常导出下载');

// 6. 截图两种折叠角度供人工核对
await page.locator('#angleRange').fill('30');
await page.screenshot({ path: 'artifacts/screenshot-30deg.png' });
await page.locator('#angleRange').fill('120');
await page.screenshot({ path: 'artifacts/screenshot-120deg.png' });
ok('已输出两种折叠角度截图');

await browser.close();
console.log(`\n浏览器端 ${passed} 项验证通过`);
