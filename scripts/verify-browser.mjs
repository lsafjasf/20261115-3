import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const cwd = new URL("..", import.meta.url).pathname;
const port = process.env.VERIFY_PORT ?? "5180";
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/tmp/chrome-test/chrome-linux64/chrome",
  chromium.executablePath(),
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));

const hash = (content) => createHash("sha256").update(content).digest("hex");

async function waitForServer(url, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let server;
if (!process.env.BASE_URL) {
  server = spawn("npm", ["run", "dev", "--", "--port", port, "--strictPort"], {
    cwd,
    stdio: "ignore",
  });
  await waitForServer(baseUrl);
}

if (!executablePath) {
  throw new Error("No Chrome/Chromium executable found. Set CHROME_PATH.");
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__TERRAIN_READY__ === true);
await page.waitForTimeout(700);

const before = await page.evaluate(() => ({
  svg: window.terrainApp.getSectionSVG(),
  obj: window.terrainApp.getOBJ(),
  state: window.terrainApp.getState(),
}));

const dragTarget = await page.evaluate(() => ({
  screen: window.terrainApp.vertexScreenPosition(47),
  beforeHeight: window.terrainApp.model.vertexPosition(47).y,
}));
await page.mouse.move(dragTarget.screen.x, dragTarget.screen.y);
await page.mouse.down();
await page.mouse.move(dragTarget.screen.x, dragTarget.screen.y - 60, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(200);
const afterDrag = await page.evaluate(() => ({
  state: window.terrainApp.getState(),
  height: window.terrainApp.model.vertexPosition(47).y,
  svg: window.terrainApp.getSectionSVG(),
}));

await page.evaluate(() => {
  window.terrainApp.setVertexHeight(49, 1.55);
  window.terrainApp.setVertexHeight(50, 5.2);
});
await page.waitForTimeout(300);

const after = await page.evaluate(() => ({
  svg: window.terrainApp.getSectionSVG(),
  obj: window.terrainApp.getOBJ(),
  state: window.terrainApp.getState(),
  render: window.terrainApp.getRenderInfo(),
  previewRevision: document.querySelector("#section-preview svg")?.dataset.meshRevision,
  editedLabel: document.querySelector("#stat-edited")?.textContent,
  revisionLabel: document.querySelector("#header-revision")?.textContent,
}));

const svgDownloadPromise = page.waitForEvent("download");
await page.click("#export-svg-row");
const svgDownload = await svgDownloadPromise;
const svgDownloadPath = await svgDownload.path();
const downloadedSvg = readFileSync(svgDownloadPath, "utf8");

const objDownloadPromise = page.waitForEvent("download");
await page.click("#export-obj-row");
const objDownload = await objDownloadPromise;
const objDownloadPath = await objDownload.path();
const downloadedObj = readFileSync(objDownloadPath, "utf8");

await page.click("#toggle-model");
await page.waitForTimeout(150);
const hiddenState = await page.evaluate(() => ({
  state: window.terrainApp.getState(),
  render: window.terrainApp.getRenderInfo(),
}));
await page.click("#toggle-model");

const canvas = await page.locator("#viewport").boundingBox();
await page.mouse.move(canvas.x + canvas.width * 0.78, canvas.y + canvas.height * 0.28);
await page.mouse.down();
await page.mouse.move(canvas.x + canvas.width * 0.58, canvas.y + canvas.height * 0.35, {
  steps: 12,
});
await page.mouse.up();
await page.waitForTimeout(500);

mkdirSync(`${cwd}/artifacts`, { recursive: true });
await page.screenshot({ path: `${cwd}/artifacts/terrain-editor.png` });
const report = {
  verifiedAt: new Date().toISOString(),
  stateBefore: before.state,
  stateAfter: after.state,
  ui: {
    editedLabel: after.editedLabel,
    revisionLabel: after.revisionLabel,
    previewRevision: after.previewRevision,
  },
  liveDrag: {
    vertex: 47,
    beforeHeight: dragTarget.beforeHeight,
    afterHeight: afterDrag.height,
    selectedAfterDrag: afterDrag.state.selected,
    contourUpdated: afterDrag.svg !== before.svg,
  },
  exports: {
    svg: {
      filename: svgDownload.suggestedFilename(),
      beforeSha256: hash(before.svg),
      afterSha256: hash(after.svg),
      downloadedSha256: hash(downloadedSvg),
      changed: before.svg !== after.svg,
      downloadMatchesLive: downloadedSvg === after.svg,
    },
    obj: {
      filename: objDownload.suggestedFilename(),
      beforeSha256: hash(before.obj),
      afterSha256: hash(after.obj),
      downloadedSha256: hash(downloadedObj),
      changed: before.obj !== after.obj,
      downloadMatchesLive: downloadedObj === after.obj,
    },
  },
  hiddenModel: {
    modelVisible: hiddenState.render.modelVisible,
    sectionVisible: hiddenState.render.sectionVisible,
    sectionObjects: hiddenState.render.sectionObjects,
    contourRetained: hiddenState.state.sectionLoops > 0,
  },
  rotation: {
    doubleSided: after.render.doubleSided,
    localClipping: after.render.localClipping,
    consoleErrors,
  },
};

writeFileSync(`${cwd}/artifacts/verification.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

await browser.close();
server?.kill("SIGTERM");
