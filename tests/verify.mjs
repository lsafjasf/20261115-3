import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = Number(process.env.TEST_PORT || 4331);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn("python3", ["-m", "http.server", String(port)], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The HTTP server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Server did not start on ${baseUrl}`);
}

function shadowAreas(summary) {
  return summary.flatMap((light) => light.objects.map((object) => ({
    id: `${light.id}:${object.id}`,
    area: object.exists ? object.area : 0,
  })));
}

let browser;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__shadowLab));
  await page.waitForTimeout(450);

  assert.equal(await page.locator("[data-light-id]").count(), 3, "three light sources");
  assert.equal(await page.locator("[data-object-id]").count(), 3, "three objects");
  assert.equal(await page.locator("#scene").count(), 1, "one Canvas 2D scene");

  const initial = await page.evaluate(() => window.__shadowLab.runDiagnostics());
  assert.equal(initial.dual.pass, true, "dual-light boundary audit passes");
  assert.equal(initial.dual.boundaryErrors, 0, "all shadow contours close inside beams");
  assert.equal(initial.dual.invalidCompositePixels, 0, "single/dual composite alpha is correct");
  assert.equal(initial.dual.outsideUnionPixels, 0, "no shadow escapes the two-beam union");
  assert.ok(initial.dual.overlapPixels > 0, "the two active lights share shadow pixels");
  assert.equal(initial.range.pass, true, "out-of-range culling audit passes");
  assert.equal(initial.range.othersStable, true, "only the probed object is culled");

  const beforeDrag = await page.evaluate(() => ({
    state: window.__shadowLab.getState(),
    areas: window.__shadowLab.getShadowSummary(),
  }));
  const light = beforeDrag.state.lights.find((entry) => entry.id === "key");
  const angle = (light.angle * Math.PI) / 180;
  const handle = await page.evaluate(
    ({ x, y }) => window.__shadowLab.worldToScreen(x, y),
    { x: light.x + Math.cos(angle) * 79, y: light.y + Math.sin(angle) * 79 },
  );
  const target = await page.evaluate(
    ({ x, y }) => window.__shadowLab.worldToScreen(x, y),
    { x: light.x + Math.cos(Math.PI / 3) * 79, y: light.y + Math.sin(Math.PI / 3) * 79 },
  );
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterDrag = await page.evaluate(() => ({
    state: window.__shadowLab.getState(),
    areas: window.__shadowLab.getShadowSummary(),
  }));
  assert.ok(afterDrag.state.lights[0].angle > 50, "aim handle rotates the source");
  assert.notDeepEqual(
    shadowAreas(beforeDrag.areas),
    shadowAreas(afterDrag.areas),
    "all derived shadow geometry rebuilds after rotation",
  );

  await page.evaluate(() => window.__shadowLab.setLight("key", { angle: 4, enabled: true }));
  const pairAudit = await page.evaluate(() => window.__shadowLab.verifyDualLights());
  assert.equal(pairAudit.pass, true, "dual-light audit still passes after a rotation round-trip");

  const outOfRange = await page.evaluate(() => {
    const state = window.__shadowLab.getState();
    const key = state.lights.find((light) => light.id === "key");
    const distance = key.range + 220;
    const angle = (key.angle * Math.PI) / 180;
    window.__shadowLab.setObject("orb", {
      x: key.x + Math.cos(angle) * distance,
      y: key.y + Math.sin(angle) * distance,
    });
    const summary = window.__shadowLab.getShadowSummary();
    const keySummary = summary.find((light) => light.id === "key");
    return {
      distance,
      range: key.range,
      orb: keySummary.objects.find((object) => object.id === "orb"),
      prism: keySummary.objects.find((object) => object.id === "prism"),
      capsule: keySummary.objects.find((object) => object.id === "capsule"),
    };
  });
  assert.ok(outOfRange.distance > outOfRange.range, "probe object is outside source reach");
  assert.equal(outOfRange.orb.exists, false, "moved object casts no shadow");
  assert.equal(outOfRange.prism.exists, true, "other object shadows remain");
  assert.equal(outOfRange.capsule.exists, true, "other object shadows remain");

  const exportResult = await page.evaluate(async () => {
    const url = window.__shadowLab.exportDataURL();
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      prefix: url.slice(0, 22),
      signature: Array.from(bytes.slice(0, 8)),
      width: view.getUint32(16),
      height: view.getUint32(20),
      decoded: [image.naturalWidth, image.naturalHeight],
      length: bytes.length,
    };
  });
  assert.equal(exportResult.prefix, "data:image/png;base64,", "PNG data URL is produced");
  assert.deepEqual(exportResult.signature, [137, 80, 78, 71, 13, 10, 26, 10], "valid PNG signature");
  assert.deepEqual(exportResult.decoded, [2000, 1400], "export resolution is 2000 × 1400");
  assert.ok(exportResult.length > 100_000, "export contains a complete raster composition");

  assert.deepEqual(errors, [], "no runtime or console errors");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/final-desktop.png", fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(500);
  const overflow = await mobile.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    canvas: document.querySelector("#scene").getBoundingClientRect().toJSON(),
  }));
  assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, "mobile layout has no horizontal overflow");
  assert.ok(overflow.canvas.width > 300, "mobile canvas remains usable");
  await mobile.screenshot({ path: "artifacts/final-mobile.png", fullPage: true });
  await mobile.close();

  console.log(JSON.stringify({
    dual: {
      pair: initial.dual.pair,
      overlapArea: Math.round(initial.dual.overlapArea),
      boundaryErrors: initial.dual.boundaryErrors,
      invalidCompositePixels: initial.dual.invalidCompositePixels,
    },
    range: {
      object: initial.range.objectId,
      light: initial.range.lightId,
      distance: Math.round(initial.range.distance),
      reach: initial.range.range,
      othersStable: initial.range.othersStable,
    },
    interaction: {
      rotatedTo: Math.round(afterDrag.state.lights[0].angle),
      shadowGeometryChanged: true,
    },
    export: {
      width: exportResult.decoded[0],
      height: exportResult.decoded[1],
      bytes: exportResult.length,
    },
    mobile: {
      width: overflow.clientWidth,
      canvasWidth: Math.round(overflow.canvas.width),
    },
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
