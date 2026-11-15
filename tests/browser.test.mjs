import assert from "node:assert/strict";
import { test, after } from "node:test";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = process.cwd();
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const path = join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    const data = await readFile(path);
    res.writeHead(200, {
      "content-type": types[extname(path)] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${baseUrl}/index.html`);
await page.waitForSelector(".stage svg");

test("页面渲染五档标题，且运行时自检无重叠/越界", async () => {
  const check = await page.evaluate(() => window.TitleMorph.selfCheck());
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(check.rowCount, 5);
  const textCount = await page.locator(".stage svg text").count();
  assert.ok(textCount >= 5);
  const matrices = await page.locator(".stage svg text[transform]").count();
  assert.equal(matrices, 5);
});

test("五档 transform 的 scaleX 依次为 0.70 -> 1.30", async () => {
  const scales = await page.evaluate(() =>
    window.TitleMorph
      .getLayout()
      .rows.map((row) => row.transform.match(/matrix\(([\d.]+)/)[1])
      .map(Number)
  );
  assert.deepEqual(scales, [0.7, 0.85, 1, 1.15, 1.3]);
});

test("字重 900 时每行带 stroke 描边，字重 300 时无 stroke", async () => {
  await page.fill("#weightRange", "900");
  await page.waitForFunction(() => window.TitleMorph.getState().weight === 900);
  const heavyStrokes = await page.locator(".stage svg text[transform][stroke-width]").count();
  assert.equal(heavyStrokes, 5);
  await page.fill("#weightRange", "300");
  const lightStrokes = await page.locator(".stage svg text[transform][stroke-width]").count();
  assert.equal(lightStrokes, 0);
  await page.fill("#weightRange", "700");
});

test("倾斜滑块改变所有行的 skew 分量", async () => {
  await page.fill("#slantRange", "15");
  const tan = await page.evaluate(
    () => window.TitleMorph.getLayout().rows[0].transform.split(" ")[1]
  );
  assert.ok(Number(tan) > 0);
  await page.fill("#slantRange", "-8");
});

test("中英混排文本更新后依然通过五档自检", async () => {
  await page.fill("#titleText", "中英混排 Mixed CJK & Latin 标题 Title 2026");
  const check = await page.evaluate(() => window.TitleMorph.selfCheck());
  assert.equal(check.ok, true, JSON.stringify(check));
  await page.fill("#titleText", "字体实验 Typography Lab 2026");
});

test("拖动水平参考线会更新其位置", async () => {
  await page.check("#showGuides");
  await page.check("#exportGuides");
  await page.waitForFunction(() => window.TitleMorph.getState().showGuides === true);
  const before = await page.evaluate(() => window.TitleMorph.getGuides()[0]);
  const handle = page.locator(".guide-hit").first();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await page.mouse.up();
  const afterGuide = await page.evaluate(() => window.TitleMorph.getGuides()[0]);
  assert.equal(afterGuide.orientation, before.orientation);
  assert.ok(Math.abs(afterGuide.pos - before.pos) > 40);
});

test("双击参考线删除，重置后恢复四条", async () => {
  const countBefore = await page.evaluate(() => window.TitleMorph.getGuides().length);
  await page.evaluate(() => {
    document.querySelector(".guide").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  const countAfter = await page.evaluate(() => window.TitleMorph.getGuides().length);
  assert.equal(countAfter, countBefore - 1);
  await page.click("#resetBtn");
  const countReset = await page.evaluate(() => window.TitleMorph.getGuides().length);
  assert.equal(countReset, 4);
});

test("导出 SVG 为独立 XML，包含五档文本且不引用任何外部字体", async () => {
  await page.check("#showGuides");
  await page.check("#exportGuides");
  await page.waitForFunction(() => window.TitleMorph.getState().showGuides === true);
  const svg = await page.evaluate(() => window.TitleMorph.buildExportSvg());
  assert.match(svg, /^<\?xml version/);
  assert.match(svg, /<svg /);
  assert.equal((svg.match(/<text /g) || []).length, 15);
  assert.doesNotMatch(svg, /@font-face|\.woff|\.ttf|\.otf|url\(/);
  assert.match(svg, /system-ui/);
  assert.match(svg, /class="guide"/);
});

test("关闭参考线导出后 SVG 不含 guide", async () => {
  await page.uncheck("#exportGuides");
  const svg = await page.evaluate(() => window.TitleMorph.buildExportSvg());
  assert.doesNotMatch(svg, /class="guide"/);
  await page.check("#exportGuides");
});

test("下载导出的 SVG 文件", async () => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#exportBtn"),
  ]);
  assert.match(download.suggestedFilename(), /^title-morph-.*\.svg$/);
});

test("保存五档对照截图", async () => {
  await page.screenshot({ path: "artifacts/preview.png", fullPage: true });
  const svg = await page.evaluate(() => window.TitleMorph.buildExportSvg());
  const { writeFile } = await import("node:fs/promises");
  await writeFile("artifacts/sample-export.svg", svg);
});
