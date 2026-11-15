const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const requested = decodeURIComponent((request.url || "/").split("?")[0]);
      const relativePath =
        requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
      const filePath = path.resolve(ROOT, relativePath);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type":
          MIME[path.extname(filePath)] || "application/octet-stream",
      });
      fs.createReadStream(filePath).pipe(response);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    const initial = await page.evaluate(() => ({
      paths: document.querySelectorAll("#mainSvg #paths .logo-path").length,
      circles: document.querySelectorAll("#mainSvg #nodes .logo-circle").length,
      duplicateIds: (() => {
        const ids = [...document.querySelectorAll("[id]")].map(
          (element) => element.id,
        );
        return ids.filter((id, index) => ids.indexOf(id) !== index);
      })(),
      activeModes: document.querySelectorAll(".segment.active").length,
    }));
    assert.equal(initial.paths, 6);
    assert.equal(initial.circles, 3);
    assert.deepEqual(initial.duplicateIds, []);
    assert.equal(initial.activeModes, 1);

    const firstPath = await page.evaluate(
      () => document.querySelector("#mainSvg #path-01").getAttribute("d"),
    );
    await page.locator("#radiusRange").evaluate((input) => {
      input.value = "20";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sharpenedPath = await page.evaluate(
      () => document.querySelector("#mainSvg #path-01").getAttribute("d"),
    );
    assert.notEqual(firstPath, sharpenedPath);
    await page.locator("#axisRange").evaluate((input) => {
      input.value = "120";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rotated = await page.evaluate(() => ({
      transform: document.querySelector("#mainSvg #logo-mark").getAttribute(
        "transform",
      ),
      label: document.querySelector("#axisLabel").textContent,
    }));
    assert.match(rotated.transform, /rotate\(30 /);
    assert.equal(rotated.label, "AXIS 120°");
    await page.click("#resetButton");

    await page.click('[data-invert="true"]');
    const negative = await page.evaluate(() => ({
      pathStroke: document.querySelector("#mainSvg #path-01").getAttribute(
        "stroke",
      ),
      circleFill: document.querySelector("#mainSvg #node-a").getAttribute(
        "fill",
      ),
      background: document
        .querySelector("#mainSvg rect")
        .getAttribute("fill"),
    }));
    assert.equal(negative.pathStroke, "#f7f6f0");
    assert.equal(negative.circleFill, "#f7f6f0");
    assert.equal(negative.background, "#171816");
    await page.click('[data-invert="false"]');

    await page.click("#selectAllButton");
    assert.equal(await page.locator("#pathLayerList .selected").count(), 6);
    await page.click("#mergeButton");
    const mergeResult = await page.evaluate(() => {
      const merged = document.querySelector("#mainSvg #path-merged");
      const sources = document.querySelectorAll(
        "#mainSvg #source-paths .logo-path",
      );
      const anchors = merged
        .getAttribute("data-anchors")
        .split(" ")
        .map((anchor) => anchor.trim());
      return {
        d: merged.getAttribute("d"),
        anchors,
        anchorCount: Number(merged.getAttribute("data-anchor-count")),
        sourceCount: sources.length,
        sourceHidden:
          document.querySelector("#mainSvg #source-paths").getAttribute(
            "visibility",
          ),
        toast: document.querySelector("#toast").textContent,
      };
    });
    assert.equal(mergeResult.anchorCount, 6);
    assert.equal(mergeResult.anchors.length, 6);
    assert.equal(new Set(mergeResult.anchors).size, 6);
    assert.equal(mergeResult.sourceCount, 6);
    assert.equal(mergeResult.sourceHidden, "hidden");
    assert.match(mergeResult.d, /^M /);
    assert.match(mergeResult.d, / Z$/);
    assert.equal((mergeResult.d.match(/ C /g) || []).length, 6);
    assert.match(mergeResult.toast, /12 → 6 个锚点/);

    const positiveDownload = page.waitForEvent("download");
    await page.click("#exportButton");
    const positive = await positiveDownload;
    fs.mkdirSync(path.join(ROOT, "exports"), { recursive: true });
    const mergedPath = path.join(
      ROOT,
      "exports",
      "sixfold-trinode-positive.svg",
    );
    await positive.saveAs(mergedPath);
    const exportedText = fs.readFileSync(mergedPath, "utf8");
    const exported = await page.evaluate((text) => {
      const document = new DOMParser().parseFromString(
        text,
        "image/svg+xml",
      );
      const parserError = document.querySelector("parsererror");
      return {
        parserError: parserError?.textContent || null,
        schema: document.documentElement.getAttribute("data-design-schema"),
        paths: document.querySelectorAll("path.logo-path").length,
        pathFills: [
          ...document.querySelectorAll("path.logo-path"),
        ].map((path) => path.getAttribute("fill")),
        sources: document.querySelectorAll("#source-paths path").length,
        circles: document.querySelectorAll("circle.logo-circle").length,
        metadata: JSON.parse(
          document.querySelector("metadata").textContent,
        ),
      };
    }, exportedText);
    assert.equal(exported.parserError, null);
    assert.equal(exported.schema, "sixfold-editable-mark-v1");
    assert.equal(exported.paths, 7);
    assert.deepEqual(exported.pathFills, Array(7).fill("none"));
    assert.equal(exported.sources, 6);
    assert.equal(exported.circles, 3);
    const metadata = exported.metadata;
    assert.equal(metadata.pathCount, 6);
    assert.equal(metadata.circleCount, 3);
    assert.equal(metadata.merged.anchorCount, 6);
    assert.equal(metadata.merged.originalAnchorCount, 12);

    await page.click('[data-invert="true"]');
    const negativeDownload = page.waitForEvent("download");
    await page.click("#exportButton");
    const negativeFile = await negativeDownload;
    await negativeFile.saveAs(
      path.join(ROOT, "exports", "sixfold-trinode-negative.svg"),
    );
    await page.click('[data-invert="false"]');

    await page.click("#unmergeButton");
    assert.equal(
      await page.locator("#mainSvg #paths .logo-path").count(),
      6,
    );
    assert.equal(await page.locator("#mainSvg #path-merged").count(), 0);
    await page.click("#selectAllButton");
    assert.equal(await page.locator('#pathLayerList .selected').count(), 0);
    await page.evaluate(() =>
      document.querySelector("#toast").classList.remove("visible"),
    );
    await page.waitForTimeout(260);

    const smallProof = await page.evaluate(() => {
      const canvas = document.querySelector("#actual24 canvas");
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(0, 0, 24, 24).data;
      let ink = 0;
      let minX = 24;
      let minY = 24;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < 24; y += 1) {
        for (let x = 0; x < 24; x += 1) {
          const alpha = pixels[(y * 24 + x) * 4 + 3];
          if (alpha > 72) {
            ink += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      const alphaAt = (x, y) => pixels[(y * 24 + x) * 4 + 3];
      const centerAlpha = alphaAt(12, 13);
      return {
        width: canvas.width,
        height: canvas.height,
        ink,
        coverage: ink / (24 * 24),
        bbox: [minX, minY, maxX, maxY],
        centerAlpha,
      };
    });
    assert.equal(smallProof.width, 24);
    assert.equal(smallProof.height, 24);
    assert.ok(smallProof.coverage > 0.18, "mark is too light at 24 px");
    assert.ok(smallProof.coverage < 0.5, "mark is too dense at 24 px");
    assert.ok(
      smallProof.bbox[2] - smallProof.bbox[0] >= 16,
      "mark is too narrow at 24 px",
    );
    assert.ok(
      smallProof.bbox[3] - smallProof.bbox[1] >= 16,
      "mark is too short at 24 px",
    );
    assert.ok(
      smallProof.centerAlpha < 40,
      "negative center is lost at 24 px",
    );

    await page.screenshot({
      path: path.join(ROOT, "artifacts", "ui-final.png"),
    });
    const rasterData = await page.evaluate((metrics) => {
      const source = document.querySelector("#actual24 canvas");
      const white = document.createElement("canvas");
      white.width = 24;
      white.height = 24;
      const whiteContext = white.getContext("2d");
      whiteContext.fillStyle = "#fffefa";
      whiteContext.fillRect(0, 0, 24, 24);
      whiteContext.drawImage(source, 0, 0);

      const sheet = document.createElement("canvas");
      sheet.width = 680;
      sheet.height = 300;
      const sheetContext = sheet.getContext("2d");
      sheetContext.fillStyle = "#f3f2ed";
      sheetContext.fillRect(0, 0, 680, 300);
      sheetContext.fillStyle = "#171816";
      sheetContext.font = "700 20px Arial";
      sheetContext.fillText("TRINODE / 24 PX PROOF", 30, 39);
      sheetContext.fillStyle = "#777972";
      sheetContext.font = "11px monospace";
      sheetContext.fillText(
        "ONE GEOMETRY  ·  TWO VIEWING DISTANCES",
        30,
        59,
      );

      sheetContext.fillStyle = "#fffefa";
      sheetContext.strokeStyle = "#d8d7d0";
      sheetContext.lineWidth = 1;
      sheetContext.fillRect(30, 82, 250, 162);
      sheetContext.strokeRect(30.5, 82.5, 249, 161);
      sheetContext.drawImage(white, 143, 139);
      sheetContext.fillStyle = "#171816";
      sheetContext.font = "700 10px monospace";
      sheetContext.fillText("1X / ACTUAL", 30, 231);
      sheetContext.fillStyle = "#fffefa";
      sheetContext.fillRect(322, 82, 240, 170);
      sheetContext.strokeRect(322.5, 82.5, 239, 169);
      sheetContext.imageSmoothingEnabled = false;
      sheetContext.drawImage(source, 346, 93, 192, 192);
      sheetContext.fillStyle = "#171816";
      sheetContext.fillText("8X / PIXELS", 322, 272);
      sheetContext.fillStyle = "#777972";
      sheetContext.font = "10px monospace";
      sheetContext.fillText(
        `INK ${(metrics.coverage * 100).toFixed(1)}%  ·  BBOX ${metrics.bbox.join(
          " ",
        )}  ·  CENTER OPEN`,
        30,
        286,
      );

      return {
        actual: white.toDataURL("image/png"),
        sheet: sheet.toDataURL("image/png"),
      };
    }, smallProof);
    fs.writeFileSync(
      path.join(ROOT, "exports", "sixfold-trinode-24px.png"),
      Buffer.from(rasterData.actual.split(",")[1], "base64"),
    );
    fs.writeFileSync(
      path.join(ROOT, "exports", "sixfold-trinode-24px-proof.png"),
      Buffer.from(rasterData.sheet.split(",")[1], "base64"),
    );

    await page.click("#resetButton");
    const positiveDownload2 = page.waitForEvent("download");
    await page.click("#exportButton");
    const positive2 = await positiveDownload2;
    await positive2.saveAs(
      path.join(ROOT, "exports", "sixfold-trinode-editable.svg"),
    );

    assert.deepEqual(errors, []);
    console.log(
      `Verified: 6 paths + 3 circles, merge 12→6 anchors, structured SVG, 24px coverage ${(
        smallProof.coverage * 100
      ).toFixed(1)}%, bbox ${smallProof.bbox.join(",")}`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
