const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2"
};

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const filename = path.resolve(ROOT, relativePath);
    if (!filename.startsWith(ROOT) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filename)] || "application/octet-stream"
    });
    fs.createReadStream(filename).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = process.env.APP_URL ? null : await startServer();
  const appUrl = process.env.APP_URL || `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#chartStageA svg");
  await page.waitForSelector("#chartStageB svg");

  const labels = await page.evaluate(() => {
    const read = (stage) => Array.from(document.querySelectorAll(`${stage} .value-labels text`))
      .map((node) => node.textContent);
    return {
      a: read("#chartStageA"),
      b: read("#chartStageB"),
      pill: document.getElementById("verifyPill").textContent,
      count: document.getElementById("labelCount").textContent,
      totals: [document.getElementById("totalA").textContent, document.getElementById("totalB").textContent]
    };
  });
  assert.ok(labels.a.length >= 20, "chart A should contain numeric labels");
  assert.deepEqual(labels.a, labels.b, "default line/bar labels must match");
  assert.equal(labels.pill, "已通过");
  assert.equal(labels.count, String(labels.a.length));
  assert.deepEqual(labels.totals, ["2,835.2", "2,835.2"]);

  await page.locator('[data-field="channel"]').dragTo(page.locator('[data-slot="series"]'));
  await page.waitForFunction(() =>
    document.getElementById("legendA").textContent.includes("线上") &&
    document.getElementById("legendB").textContent.includes("线上")
  );
  assert.equal(await page.locator("#chartATitle").textContent(), "渠道销售额趋势");
  assert.equal(await page.locator("#verifyPill").textContent(), "已通过");

  await page.locator("#sortSelect").selectOption("y-desc");
  await page.waitForFunction(() => document.getElementById("verifyCopy").textContent.includes("逐一匹配"));
  const firstMonth = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#chartStageA .axes text"))
      .map((node) => node.textContent)
      .find((text) => text.endsWith("月"))
  );
  assert.equal(firstMonth, "6月", "Y-desc sort should place the largest category first");
  assert.equal(await page.locator("#verifyPill").textContent(), "已通过");

  await page.locator('[data-field="orders"]').dragTo(page.locator('[data-slot="series"]'));
  await page.waitForSelector(".toast.error");
  assert.match(await page.locator("#mappingMessage").textContent(), /数值字段/);
  assert.match(await page.locator("#legendA").textContent(), /线上/);

  await page.locator('[data-chart="b"][data-type="scatter"]').click();
  await page.waitForSelector("#chartStageB .chart-empty.error");
  assert.match(await page.locator("#chartStageB .chart-empty.error").textContent(), /散点图要求 X、Y 均为数值字段/);
  assert.equal(await page.locator("#verifyPill").textContent(), "待修复");

  await page.locator('[data-field="orders"]').dragTo(page.locator('[data-slot="x"]'));
  await page.waitForSelector("#chartStageB svg");
  assert.equal(await page.locator("#verifyPill").textContent(), "已通过");
  assert.equal(await page.locator('[data-slot="x"] .slot-field strong').textContent(), "订单数");

  const svgDownload = page.waitForEvent("download");
  await page.locator('[data-chart-card="a"] .export-trigger').click();
  await page.locator('[data-chart-card="a"] [data-export="svg"]').click();
  const svgFile = await svgDownload;
  assert.match(svgFile.suggestedFilename(), /\.svg$/);
  await svgFile.saveAs("/tmp/fieldnote-export.svg");

  const pngDownload = page.waitForEvent("download");
  await page.locator('[data-chart-card="b"] .export-trigger').click();
  await page.locator('[data-chart-card="b"] [data-export="png"]').click();
  const pngFile = await pngDownload;
  assert.match(pngFile.suggestedFilename(), /\.png$/);
  await pngFile.saveAs("/tmp/fieldnote-export.png");

  await page.locator(".switch-control").click();
  assert.equal(await page.locator("#verifyPill").textContent(), "已通过");
  assert.equal(await page.locator("#chartStageA .value-labels").getAttribute("style"), "display:none");

  await page.locator("#verifyDetailsBtn").click();
  const verifyRows = await page.locator("#verifyTable tbody tr").count();
  assert.equal(verifyRows, 23);
  await page.locator("#closeVerifyBtn").click();

  await page.locator("#previewDataBtn").click();
  assert.equal(await page.locator("#sourceTable tbody tr").count(), 24);
  await page.locator("#closeDataBtn").click();

  await page.locator("#resetBtn").click();
  await page.waitForFunction(() => document.getElementById("verifyPill").textContent === "已通过");
  assert.equal(await page.locator("#chartStageA .value-labels text").count(), 23);
  assert.equal(await page.locator("#chartStageB .value-labels text").count(), 23);
  assert.deepEqual(errors, []);

  await page.screenshot({ path: "/tmp/fieldnote-smoke.png", fullPage: true });
  console.log("smoke: 23 labels matched, mapping/sort/validation/export passed");
  await browser.close();
  if (server) server.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
