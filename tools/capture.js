const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const URL = process.env.PANO_URL || "http://127.0.0.1:4193/";

function saveDataUrl(dataUrl, filename) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(path.join(ARTIFACTS, filename), Buffer.from(base64, "base64"));
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1180 },
    deviceScaleFactor: 1
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.panoLab && window.panoLab.getState().seams.length === 2);
  await page.waitForTimeout(600);

  const initial = await page.evaluate(() => window.panoLab.getState());
  const initialGate = await page.locator("#exportButton").getAttribute("aria-disabled");

  await page.evaluate(() => window.panoLab.setTransform(1, "rotation", 2));
  await page.waitForTimeout(250);
  const blockedState = await page.evaluate(() => window.panoLab.getState());
  const blockedGate = await page.locator("#exportButton").getAttribute("aria-disabled");
  const blockedBundle = await page.evaluate(() => window.panoLab.exportFiles());
  const blockedToast = await page.locator("#toast").textContent();

  await page.locator("#autoAlignButton").click();
  await page.waitForTimeout(300);
  const finalState = await page.evaluate(() => window.panoLab.getState());
  const finalGate = await page.locator("#exportButton").getAttribute("aria-disabled");
  const bundled = await page.evaluate(() => {
    const bundle = window.panoLab.createExportBundle();
    return {
      pngDataUrl: bundle.pngDataUrl,
      jsonText: bundle.jsonText,
      zoomADataUrl: bundle.zoomADataUrl,
      zoomBDataUrl: bundle.zoomBDataUrl,
      params: bundle.params
    };
  });

  saveDataUrl(bundled.pngDataUrl, "panorama.png");
  saveDataUrl(bundled.zoomADataUrl, "zoom-a.png");
  saveDataUrl(bundled.zoomBDataUrl, "zoom-b.png");
  fs.writeFileSync(
    path.join(ARTIFACTS, "transform-params.json"),
    `${JSON.stringify(bundled.params, null, 2)}\n`
  );

  await page.locator('[data-view="difference"]').click();
  await page.waitForTimeout(250);
  await page.locator(".canvas-panel").screenshot({
    path: path.join(ARTIFACTS, "error-view.png")
  });
  await page.locator('[data-view="stitch"]').click();
  await page.waitForTimeout(3100);
  await page.screenshot({
    path: path.join(ARTIFACTS, "stitch-preview.png"),
    fullPage: true
  });
  await page.locator(".microscope").screenshot({
    path: path.join(ARTIFACTS, "continuity-comparison.png")
  });

  const pngBuffer = fs.readFileSync(path.join(ARTIFACTS, "panorama.png"));
  const panoramaSize = {
    width: pngBuffer.readUInt32BE(16),
    height: pngBuffer.readUInt32BE(20)
  };

  const validation = {
    url: URL,
    browser: "Chromium (Playwright)",
    pageErrors: errors,
    initial: {
      maxErrorPct: initial.maxError,
      minContinuityPct: initial.minContinuity,
      gateDisabled: initialGate
    },
    blockedTest: {
      changedRotationDeg: 2,
      maxErrorPct: blockedState.maxError,
      gateDisabled: blockedGate,
      exportReturned: blockedBundle,
      toast: blockedToast
    },
    final: {
      maxErrorPct: finalState.maxError,
      minContinuityPct: finalState.minContinuity,
      gateDisabled: finalGate,
      seams: finalState.seams
    },
    panoramaPng: panoramaSize,
    files: [
      "panorama.png",
      "transform-params.json",
      "zoom-a.png",
      "zoom-b.png",
      "continuity-comparison.png",
      "error-view.png",
      "stitch-preview.png"
    ]
  };
  fs.writeFileSync(
    path.join(ARTIFACTS, "validation.json"),
    `${JSON.stringify(validation, null, 2)}\n`
  );

  console.log(JSON.stringify(validation, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
