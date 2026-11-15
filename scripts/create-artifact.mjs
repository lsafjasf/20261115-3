import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, "artifacts");
const port = 5188;
const baseUrl = `http://127.0.0.1:${port}`;
const chromeCandidates = [
  process.env.CHROME_EXECUTABLE,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
].filter(Boolean);

fs.mkdirSync(artifacts, { recursive: true });

const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

async function waitForServer(timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The dev server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Vite server did not start in time");
}

let browser;
try {
  await waitForServer();
  const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const node = document.querySelector("#decodeText");
    return node && node.textContent.includes("已识别");
  }, { timeout: 10000 });

  const posterDownload = page.waitForEvent("download");
  await page.locator("#exportPng").click();
  const poster = await posterDownload;
  await poster.saveAs(path.join(artifacts, "signal-form-access-poster.png"));

  const jsonDownload = page.waitForEvent("download");
  await page.locator("#exportJson").click();
  const params = await jsonDownload;
  await params.saveAs(path.join(artifacts, "signal-form-access-params.json"));

  await page.waitForTimeout(2800);
  await page.mouse.move(28, 300);
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({
    path: path.join(artifacts, "poster-studio.png"),
    fullPage: false,
  });

  const summary = await page.evaluate(() => ({
    content: document.querySelector("#contentInput").value,
    contrast: document.querySelector("#contrastValue").textContent,
    occlusion: document.querySelector("#occlusionValue").textContent,
    risk: document.querySelector("#riskLabel").textContent,
    decoder: document.querySelector("#decodeText").textContent,
  }));

  if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  console.log(JSON.stringify({
    poster: "artifacts/signal-form-access-poster.png",
    params: "artifacts/signal-form-access-params.json",
    studioScreenshot: "artifacts/poster-studio.png",
    browserCheck: summary,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
