import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const artifactDir = resolve("artifacts");
await mkdir(artifactDir, { recursive: true });

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}

let serverProcess = null;
let baseUrl = process.env.PROGRAM_URL;
if (!baseUrl) {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore"
  });
  await waitForServer(baseUrl);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage({ viewport: { width: 1480, height: 980 }, deviceScaleFactor: 1 });

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__PROGRAM__));
  await page.waitForTimeout(700);

  const initial = await page.evaluate(() => {
    const api = window.__PROGRAM__;
    const validation = api.getValidation();
    const shots = api.getShots();
    const cuts = api.getCutPoints();
    return {
      shots,
      cuts,
      validation,
      blocks: document.querySelectorAll(".shot-block").length,
      checkRows: document.querySelectorAll(".cut-check").length,
      checkIcons: [...document.querySelectorAll(".check-icon")].map((node) => node.textContent.trim()),
      title: document.title
    };
  });

  if (initial.shots.length !== 4) throw new Error(`Expected 4 shots, got ${initial.shots.length}`);
  if (initial.cuts.length !== 3) throw new Error(`Expected 3 cuts, got ${initial.cuts.length}`);
  if (!initial.validation.passed) throw new Error("Validation did not pass");
  if (initial.checkRows !== 3 || initial.checkIcons.some((icon) => icon !== "✓")) {
    throw new Error("Cut validation UI is not showing three passed rows");
  }

  const cutAudit = await page.evaluate(() => {
    const api = window.__PROGRAM__;
    return api.getCutPoints().map((cut) => {
      const before = api.getSceneSignature(cut.time - 0.001);
      const after = api.getSceneSignature(cut.time + 0.001);
      const delta = Math.hypot(after.x - before.x, after.y - before.y);
      return {
        timeSeconds: cut.time,
        fromCameraId: cut.fromCamera,
        toCameraId: cut.toCamera,
        transition: cut.transition,
        beatAligned: api.getValidation().checks.find((check) => check.time === cut.time)?.beatAligned,
        sceneDeltaPx: Number(delta.toFixed(4))
      };
    });
  });

  await page.click('[data-pick-camera="cam-c"]');
  const editedCamera = await page.evaluate(() => window.__PROGRAM__.getState().shots.find((shot) => shot.id === "shot-2").camera);
  if (editedCamera !== "cam-c") throw new Error("Camera picker did not update the selected shot");
  await page.click('[data-pick-camera="cam-b"]');

  await page.selectOption("#transitionSelect", "slide");
  const editedTransition = await page.evaluate(() => window.__PROGRAM__.getState().shots.find((shot) => shot.id === "shot-2").transition);
  if (editedTransition !== "slide") throw new Error("Transition selector did not update the selected shot");
  await page.selectOption("#transitionSelect", "wipe");

  await page.fill("#cutTimeInput", "4.5");
  await page.press("#cutTimeInput", "Enter");
  await page.waitForTimeout(150);
  const editedTime = await page.evaluate(() => window.__PROGRAM__.getState().shots.find((shot) => shot.id === "shot-2").start);
  if (editedTime !== 4.5) throw new Error(`Expected snapped cut time 4.5, got ${editedTime}`);
  await page.fill("#cutTimeInput", "4.0");
  await page.press("#cutTimeInput", "Enter");
  await page.waitForTimeout(150);

  await page.click("#playBtn");
  await page.waitForTimeout(1000);
  const playback = await page.evaluate(() => window.__PROGRAM__.getState());
  if (!playback.playing || playback.playhead < 0.7) {
    throw new Error(`Playback clock did not advance correctly: ${JSON.stringify(playback)}`);
  }
  await page.click("#playBtn");
  await page.evaluate(() => window.__PROGRAM__.seek(0));
  await page.evaluate(() => document.querySelector("#toast").classList.remove("is-visible"));
  await page.waitForTimeout(260);

  await page.screenshot({ path: resolve(artifactDir, "program-deck.png"), fullPage: true });

  const shotTimes = [4.12, 8.14, 12.14];
  for (let index = 0; index < shotTimes.length; index += 1) {
    await page.evaluate((time) => window.__PROGRAM__.seek(time), shotTimes[index]);
    await page.waitForTimeout(90);
    await page.locator("#monitorFrame").screenshot({
      path: resolve(artifactDir, `cut-${String(index + 1).padStart(2, "0")}.png`)
    });
  }

  const jsonDownloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await page.click("#exportJsonBtn");
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = resolve(artifactDir, "orbit-shot-list.json");
  await jsonDownload.saveAs(jsonPath);

  const webmDownloadPromise = page.waitForEvent("download", { timeout: 35000 });
  await page.click("#exportWebmBtn");
  const webmDownload = await webmDownloadPromise;
  const webmPath = resolve(artifactDir, "orbit-three-camera-15s.webm");
  await webmDownload.saveAs(webmPath);
  await page.waitForTimeout(400);

  const mediaAudit = await page.evaluate(async () => {
    const url = `/artifacts/orbit-three-camera-15s.webm?audit=${Date.now()}`;
    const video = await new Promise((resolve, reject) => {
      const element = document.createElement("video");
      element.preload = "metadata";
      element.src = url;
      element.onloadedmetadata = () => resolve({
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight
      });
      element.onerror = () => reject(new Error("Could not read WebM metadata"));
    });

    const bytes = await (await fetch(url)).arrayBuffer();
    const audioContext = new OfflineAudioContext(1, 48000, 48000);
    const audio = await audioContext.decodeAudioData(bytes);
    const samples = audio.getChannelData(0);
    const sampleRate = audio.sampleRate;
    const windowSize = 240;
    const energy = [];
    for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
      let sum = 0;
      for (let index = 0; index < windowSize; index += 1) {
        sum += samples[start + index] ** 2;
      }
      energy.push(Math.sqrt(sum / windowSize));
    }
    const rawOnsets = [];
    for (let index = 1; index < energy.length - 1; index += 1) {
      if (energy[index] > energy[index - 1] * 1.45 && energy[index] > 0.005 && energy[index] >= energy[index + 1]) {
        rawOnsets.push({ time: (index * windowSize) / sampleRate, energy: energy[index] });
      }
    }
    const onsets = [];
    rawOnsets.forEach((onset) => {
      if (!onsets.length || onset.time - onsets[onsets.length - 1].time > 0.18) {
        onsets.push(onset);
      }
    });
    const cuts = [4, 8, 12].map((cut) => {
      const nearest = onsets.reduce(
        (best, onset) => Math.abs(onset.time - cut) < Math.abs(best.time - cut) ? onset : best,
        onsets[0]
      );
      return {
        cutSeconds: cut,
        nearestOnsetSeconds: Number(nearest.time.toFixed(3)),
        offsetSeconds: Number(Math.abs(nearest.time - cut).toFixed(3))
      };
    });
    return {
      video,
      audio: { duration: audio.duration, channels: audio.numberOfChannels, sampleRate },
      cuts,
      passed: cuts.every((cut) => cut.offsetSeconds <= 0.15)
    };
  });
  if (!mediaAudit.passed) {
    throw new Error(`Audio cuts are not close enough to beat onsets: ${JSON.stringify(mediaAudit.cuts)}`);
  }

  const report = {
    verifiedAt: new Date().toISOString(),
    pageTitle: initial.title,
    programDurationSeconds: 15,
    shotCount: initial.shots.length,
    cutCount: initial.cuts.length,
    validationPassed: initial.validation.passed,
    continuity: initial.validation.continuity,
    cuts: cutAudit,
    media: mediaAudit,
    outputs: {
      shotTable: "artifacts/orbit-shot-list.json",
      webm: "artifacts/orbit-three-camera-15s.webm",
      deckScreenshot: "artifacts/program-deck.png",
      cutScreenshots: shotTimes.map((_, index) => `artifacts/cut-${String(index + 1).padStart(2, "0")}.png`)
    },
    errors
  };
  await writeFile(resolve(artifactDir, "verification.json"), JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
  serverProcess?.kill();
}
