import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = join(root, "artifacts");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const file = normalize(join(root, requested));
    if (!file.startsWith(root)) throw new Error("outside root");
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(20000);

const errors = [];
const loadedImages = [];
const requestedUrls = new Set();
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.stack || error.message));
page.on("request", (request) => requestedUrls.add(request.url()));
page.on("response", (response) => {
  if (response.request().resourceType() === "image" && response.status() < 400) {
    loadedImages.push(response.url());
  }
});

const hideOverlays = () =>
  page.evaluate(() => {
    document.getElementById("toast").classList.remove("is-visible");
    document.getElementById("dragHint").classList.add("is-hidden");
    document.getElementById("toast").style.display = "none";
    document.getElementById("dragHint").style.display = "none";
  });

async function screenshot(name) {
  await hideOverlays();
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(artifacts, name) });
  console.log(`captured ${name}`);
}

async function pose(camera, quality) {
  await page.evaluate(
    ({ cameraValue, qualityValue }) => {
      const scene = window.__mistValley;
      scene.setPaused(true);
      scene.setTime(9.4);
      scene.setAutoPan(false);
      scene.setCamera(cameraValue);
      if (scene.getSceneState().quality !== qualityValue) scene.setQuality(qualityValue);
      scene.setPaused(true);
      scene.setTime(9.4);
      scene.setCamera(cameraValue);
    },
    { cameraValue: camera, qualityValue: quality },
  );
  await page.waitForTimeout(950);
}

function hashSignature(signature) {
  const text = JSON.stringify(signature);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function ridgeShift(left, right) {
  return left.map((points, ridgeIndex) =>
    Number((right[ridgeIndex][0][0] - points[0][0]).toFixed(2)),
  );
}

async function measureFps(quality) {
  await page.evaluate((value) => {
    const scene = window.__mistValley;
    scene.setPaused(false);
    scene.setAutoPan(false);
    if (scene.getSceneState().quality !== value) scene.setQuality(value);
    scene.setCamera(0.24);
  }, quality);
  await page.waitForTimeout(1100);
  const readings = [];
  for (let index = 0; index < 4; index += 1) {
    await page.waitForTimeout(850);
    readings.push(await page.evaluate(() => window.__mistValley.getSceneState().fps));
  }
  readings.sort((a, b) => a - b);
  return {
    median: readings[2],
    samples: readings,
  };
}

await page.goto(origin, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__mistValley));
await page.evaluate(async () => {
  await document.fonts.ready;
  return true;
});
await page.waitForTimeout(700);

console.log("capturing high quality camera poses");
await pose(-0.58, "high");
await screenshot("camera-high-left.png");
const highLeft = await page.evaluate(() => window.__mistValley.getRidgeSignature());
const highLeftState = await page.evaluate(() => window.__mistValley.getSceneState());

await pose(0.62, "high");
await screenshot("camera-high-right.png");
const highRight = await page.evaluate(() => window.__mistValley.getRidgeSignature());
const highState = await page.evaluate(() => window.__mistValley.getSceneState());

await pose(0.62, "low");
await screenshot("quality-low-right.png");
const lowRight = await page.evaluate(() => window.__mistValley.getRidgeSignature());
const lowState = await page.evaluate(() => window.__mistValley.getSceneState());

await pose(-0.58, "low");
await screenshot("quality-low-left.png");

console.log("testing layer sliders and capture API");
const controlTest = await page.evaluate(() => {
  const fireInput = (id, value) => {
    const input = document.getElementById(id);
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.nextElementSibling.textContent;
  };
  const distributionOutput = fireInput("canopyDistribution", 84);
  const speedOutput = fireInput("distantSpeed", 2.4);
  fireInput("farClearance", 67);
  const clarityOutput = document.getElementById("farClearanceValue").textContent;
  const state = window.__mistValley.getSceneState();
  const capture = window.__mistValley.captureDataURL();
  fireInput("canopyDistribution", 72);
  fireInput("distantSpeed", 0.8);
  fireInput("farClearance", 42);
  return {
    canopyDistribution: state.layers[0].distribution,
    distantSpeed: state.layers[2].speed,
    farClearance: state.farClearance,
    outputs: { distributionOutput, speedOutput, clarityOutput },
    capturePrefix: capture.slice(0, 22),
    captureBytes: Math.round((capture.length * 3) / 4),
  };
});

console.log("testing pointer drag");
await page.evaluate(() => {
  window.__mistValley.setPaused(false);
  window.__mistValley.setAutoPan(false);
  window.__mistValley.setCamera(0);
});
const dragBefore = await page.evaluate(() => window.__mistValley.getSceneState().camera);
await page.mouse.move(900, 440);
await page.mouse.down();
await page.mouse.move(720, 440, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(450);
const dragAfter = await page.evaluate(() => window.__mistValley.getSceneState().camera);

console.log("measuring performance tiers");
const performance = {
  high: await measureFps("high"),
  low: await measureFps("low"),
};

const highHash = hashSignature(highRight);
const lowHash = hashSignature(lowRight);
const report = {
  capturedAt: new Date().toISOString(),
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  cameraComparison: {
    highLeft: highLeftState.camera,
    highRight: highState.camera,
    ridgePixelShiftLeftToRight: ridgeShift(highLeft, highRight),
  },
  qualityComparison: {
    sameCamera: highState.camera === lowState.camera,
    highSilhouetteHash: highHash,
    lowSilhouetteHash: lowHash,
    identical: highHash === lowHash,
    highDpr: highState.dpr,
    lowDpr: lowState.dpr,
  },
  dragTest: {
    before: dragBefore,
    after: dragAfter,
    moved: Math.abs(dragAfter - dragBefore) > 0.05,
  },
  controlTest,
  performance,
  assets: {
    loadedImages,
    externalRequests: [...requestedUrls].filter((url) => !url.startsWith(origin)),
  },
  consoleErrors: errors,
};

await writeFile(join(artifacts, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log(JSON.stringify(report, null, 2));
