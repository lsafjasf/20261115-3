import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'artifacts');
await mkdir(outDir, { recursive: true });

const server = spawn(process.execPath, [join(here, 'static-server.js')], {
  env: { ...process.env, PORT: '8931' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', resolve));

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('http://localhost:8931/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#chart .label');

  // 1) 页面初始即有三个标注：文字、箭头、区域
  const initial = await page.evaluate(() => {
    const chart = window.__chart;
    return {
      count: chart.store.items.length,
      types: chart.store.items.map((i) => i.type).sort(),
      anchors: chart.store.items.map((i) => [...i.anchor]),
      svgLabels: document.querySelectorAll('#chart .label').length,
    };
  });
  assert.equal(initial.count, 3);
  assert.deepEqual(initial.types, ['arrow', 'region', 'text']);
  assert.equal(initial.svgLabels, 3);

  // 记录缩放前箭头锚点的屏幕位置
  const before = await page.evaluate(() => {
    const layout = window.__chart.layout();
    const arrow = layout.items.find((i) => i.type === 'arrow');
    return { anchorScreen: arrow.anchorScreen, transform: { ...window.__chart.view.snapshot() } };
  });

  // 2) 滚轮放大两次（以画布中心为锚），再平移
  const box = await page.$eval('#chart', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const scaleAfterFit = before.transform.scaleX;
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel({ deltaY: -400 });
  }
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y - 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('#chart .label').length === 3);

  const after = await page.evaluate(() => {
    const chart = window.__chart;
    const layout = chart.layout();
    const result = {
      scale: chart.view.scaleX,
      items: layout.items.map((item) => ({
        id: item.id,
        type: item.type,
        anchor: item.anchor,
        anchorScreen: item.anchorScreen,
        backToData: chart.view.toData(item.anchorScreen),
      })),
      noLabelOverlap: true,
      arrowTipOnAnchor: null,
    };
    const rects = layout.items.map((i) => i.labelRect);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          result.noLabelOverlap = false;
        }
      }
    }
    const arrow = layout.items.find((i) => i.type === 'arrow');
    const polygon = document.querySelector('#chart polygon');
    if (polygon) {
      const first = polygon.getAttribute('points').trim().split(/\s+/)[0].split(',').map(Number);
      result.arrowTipOnAnchor =
        Math.abs(first[0] - arrow.anchorScreen[0]) < 0.01 &&
        Math.abs(first[1] - arrow.anchorScreen[1]) < 0.01;
    }
    return result;
  });

  assert.ok(after.scale > scaleAfterFit * 2, '视图应被放大到两倍以上');
  assert.equal(after.items.length, 3);
  assert.equal(after.noLabelOverlap, true, '避让后标签不能重叠');
  assert.equal(after.arrowTipOnAnchor, true, '箭头尖端必须等于锚点屏幕位置');
  for (const item of after.items) {
    assert.ok(Math.abs(item.backToData[0] - item.anchor[0]) < 1e-9, `${item.id} x 回到原数据点`);
    assert.ok(Math.abs(item.backToData[1] - item.anchor[1]) < 1e-9, `${item.id} y 回到原数据点`);
  }

  // 3) 实际导出 SVG 文件
  const svg = await page.evaluate(() => {
    const chart = window.__chart;
    return chart.renderSvg(chart.sampleSeries, chart.layout(), chart.view);
  });
  const svgPath = join(outDir, 'annotated-chart.zoom.svg');
  await writeFile(svgPath, svg);
  assert.ok(svg.includes('峰值突破 25') && svg.includes('季节性回升') && svg.includes('高位震荡区'));
  assert.equal((svg.match(/<g class="label">/g) || []).length, 3);

  // 4) 实际导出 3x 高清 PNG，并校验尺寸与非空白像素
  const pngBundle = await page.evaluate(async () => {
    const { drawToCanvas } = await import('/src/pngExport.js');
    const chart = window.__chart;
    const canvas = drawToCanvas(chart.sampleSeries, chart.layout(), chart.view, 3);
    const ctx = canvas.getContext('2d');
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < image.length; i += 4) {
      if (image[i] < 245 || image[i + 1] < 245 || image[i + 2] < 245) colored += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      colored,
      dataUrl: canvas.toDataURL('image/png'),
    };
  });
  assert.equal(pngBundle.width, (await page.evaluate(() => window.__chart.view.width)) * 3);
  assert.equal(pngBundle.height, (await page.evaluate(() => window.__chart.view.height)) * 3);
  assert.ok(pngBundle.colored > 5000, 'PNG 应包含图表与标注内容而非空白图');
  await writeFile(
    join(outDir, 'annotated-chart.zoom.png'),
    Buffer.from(pngBundle.dataUrl.split(',')[1], 'base64'),
  );

  // 5) 交互模型：调优先级并新增标注后重新布局，再刷新确认无脚本错误
  await page.evaluate(() => window.__chart.store.setPriority(
    window.__chart.store.items.find((i) => i.type === 'arrow').id, 9));
  await page.evaluate(() => window.__chart.store.add({
    type: 'text', anchor: [10, 28], text: '浏览器新增标注', priority: 5,
  }));
  const fourItemLayout = await page.evaluate(() => window.__chart.layout().items.length);
  assert.equal(fourItemLayout, 4, '新增后应有四个标注参与避让布局');
  await page.evaluate(() => location.reload());
  await page.waitForSelector('#chart .label');

  assert.deepEqual(errors, [], `页面不应有 JS 错误: ${errors.join('; ')}`);
  console.log('E2E 通过：缩放/平移后三个标注锚点均回到原数据点；箭头尖端未偏移；SVG 与 3x PNG 已写入 artifacts/');
  console.log('导出文件:', svgPath, join(outDir, 'annotated-chart.zoom.png'));
} finally {
  await browser.close();
  server.kill();
}
