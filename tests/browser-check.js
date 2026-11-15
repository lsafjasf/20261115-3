"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const S = require("../src/core.js");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    const fallback = process.env.PLAYWRIGHT_MODULE;
    if (!fallback) throw error;
    return require(fallback);
  }
}

function serve() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const port = server.address().port;
  let browser;

  try {
    const launchOptions = { headless: true, args: ["--no-sandbox"] };
    if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1020 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const api = window.__FRAME_SYNC__;
      return api && api.snapshot().renderedFrame >= 0 && !api.snapshot().pending;
    });

    await page.click("#btnRapid");
    await page.waitForFunction(() => window.__lastScrubCheck && window.__lastScrubCheck.passed,
      null, { timeout: 6000 });
    const report = await page.evaluate(() => window.__lastScrubCheck);
    assert.equal(report.finalFrame, 558);
    assert.equal(report.audioTime, 18.6);
    assert.equal(report.subtitle.id, "CUE-04");
    assert.ok(report.abortedRequests >= 4);

    const rapidDom = await page.evaluate(() => ({
      frame: document.querySelector("#verifyFrame").textContent,
      audio: document.querySelector("#verifyAudio").textContent,
      cue: document.querySelector("#verifyCue").textContent,
      badge: document.querySelector("#verifyBadge").textContent
    }));
    assert.match(rapidDom.frame, /#0558/);
    assert.match(rapidDom.frame, /00:18\.600/);
    assert.match(rapidDom.audio, /00:18\.600/);
    assert.match(rapidDom.cue, /CUE-04/);
    assert.equal(rapidDom.badge, "通过");

    await page.evaluate(async () => {
      const range = document.querySelector("#playhead");
      for (const value of [200, 800, 350, 1000, 600]) {
        range.value = String(value);
        range.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const state = window.__FRAME_SYNC__.snapshot();
      return state.renderedFrame === 600 && !state.pending;
    });
    const dragged = await page.evaluate(() => window.__FRAME_SYNC__.snapshot());
    assert.equal(dragged.audioTime, 20);
    assert.equal(dragged.cue.id, S.resolveCue(600).id);

    await page.click("#btnPlay");
    await page.waitForTimeout(220);
    await page.click("#btnPause");
    const frozen = await page.evaluate(() => {
      const state = window.__FRAME_SYNC__.snapshot();
      return {
        frame: state.renderedFrame,
        target: state.targetFrame,
        audio: state.audioTime,
        cue: state.cue.id,
        frameText: document.querySelector("#frameValue").textContent,
        audioText: document.querySelector("#audioValue").textContent
      };
    });
    await page.waitForTimeout(420);
    const afterPause = await page.evaluate(() => {
      const state = window.__FRAME_SYNC__.snapshot();
      return {
        frame: state.renderedFrame,
        target: state.targetFrame,
        audio: state.audioTime,
        cue: state.cue.id,
        frameText: document.querySelector("#frameValue").textContent,
        audioText: document.querySelector("#audioValue").textContent
      };
    });
    assert.deepEqual(afterPause, frozen);

    const artifacts = path.join(ROOT, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, "player-check.png"), fullPage: true });
    const result = {
      passed: true,
      rapidReport: report,
      rapidDom,
      rangeDragFinalFrame: dragged.renderedFrame,
      rangeDragAudioTime: dragged.audioTime,
      rangeDragCue: dragged.cue.id,
      pausedState: frozen,
      errors
    };
    fs.writeFileSync(path.join(artifacts, "browser-check.json"), JSON.stringify(result, null, 2));
    console.log("browser check: PASS");
    console.log(`rapid final: frame ${report.finalFrame}, audio ${report.audioTime}, ${report.subtitle.id}`);
    console.log(`range drag: frame ${dragged.renderedFrame}, audio ${dragged.audioTime}, ${dragged.cue.id}`);
    console.log(`pause freeze: frame ${frozen.frame}, audio ${frozen.audio}, ${frozen.cue}`);
    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
