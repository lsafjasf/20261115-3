import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startServer } from "../scripts/serve.mjs";

const root = new URL("..", import.meta.url);
const artifacts = new URL("artifacts/", root);
await mkdir(artifacts, { recursive: true });

function findChromium() {
  const candidates = [
    process.env.CHROME_PATH,
    "/tmp/chrome-test/chrome-linux64/chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const results = [];
const check = (label, condition, detail = "") => {
  assert.ok(condition, detail ? `${label}: ${detail}` : label);
  results.push({ label, status: "passed", detail });
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
};

const waitFor = (page, predicate, message, timeout = 16000) =>
  page.waitForFunction(predicate, undefined, { timeout }).catch(() => {
    throw new Error(`Timed out: ${message}`);
  });

const server = await startServer();
const executablePath = findChromium();
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ],
});

const page = await browser.newPage({
  viewport: { width: 1440, height: 1120 },
  locale: "zh-CN",
});
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

let report;
try {
  await page.goto(server.url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitFor(
    page,
    () => document.documentElement.dataset.appReady === "true",
    "application bootstrap",
  );
  check("应用启动", await page.isVisible("#stage-channel"));
  await page.screenshot({ path: new URL("calibration-start.png", artifacts).pathname, fullPage: true });

  await page.click("#start-channel");
  await waitFor(
    page,
    () => document.documentElement.dataset.channelState === "awaiting",
    "first channel cue",
  );
  check("首段左声道提示已结束并等待作答", true);

  await page.click("#answer-right");
  await page.locator("#channel-error").waitFor({ state: "visible" });
  const warning = await page.locator("#channel-error").innerText();
  check("左右声道接反错误提示", warning.includes("左右声道接反"), warning.replace(/\s+/g, " "));
  check("提示包含自动交换入口", warning.includes("自动交换声道"));
  await page.screenshot({
    path: new URL("channel-reversed-error.png", artifacts).pathname,
    fullPage: true,
  });

  await page.click("#swap-retry");
  await waitFor(
    page,
    () => document.documentElement.dataset.channelState === "awaiting",
    "retest left channel after swap",
  );
  await page.click("#answer-left");
  await waitFor(
    page,
    () => document.documentElement.dataset.channelState === "between",
    "left channel confirmed",
    5000,
  );
  await waitFor(
    page,
    () => document.documentElement.dataset.channelState === "awaiting",
    "right channel cue after swap",
  );
  await page.click("#answer-right");
  await waitFor(
    page,
    () => document.documentElement.dataset.channelState === "passed",
    "both channels confirmed",
    5000,
  );
  check("交换声道后左右声道重测通过", true);

  await page.click("#to-tone");
  await waitFor(
    page,
    () => document.documentElement.dataset.stage === "2",
    "tone stage",
  );
  const targets = await page.evaluate(() => ({
    hz: document.querySelector("#pitch-slider").dataset.target,
    db: document.querySelector("#level-slider").dataset.target,
  }));
  for (const [selector, value] of [
    ["#pitch-slider", targets.hz],
    ["#level-slider", targets.db],
  ]) {
    await page.locator(selector).evaluate((element, nextValue) => {
      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }
  await page.click("#check-tone");
  await waitFor(
    page,
    () => document.documentElement.dataset.toneState === "passed",
    "pitch and level match",
    5000,
  );
  const toneResult = await page.locator("#tone-result").innerText();
  check("连续音高与响度匹配通过", toneResult.includes("通过"), toneResult);
  await page.screenshot({ path: new URL("tone-matched.png", artifacts).pathname, fullPage: true });

  await page.click("#to-spatial");
  await waitFor(
    page,
    () => document.documentElement.dataset.stage === "3",
    "spatial stage",
  );
  const spatialAnswers = [];
  for (let trial = 0; trial < 3; trial += 1) {
    await page.click("#play-spatial");
    await waitFor(
      page,
      () => document.documentElement.dataset.spatialState === "awaiting",
      `spatial cue ${trial + 1}`,
    );
    const expected = await page.evaluate(
      () => document.documentElement.dataset.spatialExpected,
    );
    spatialAnswers.push(expected);
    await page.click(expected === "front" ? "#answer-front" : "#answer-back");
    if (trial < 2) {
      await waitFor(
        page,
        () => document.documentElement.dataset.spatialState === "between",
        `spatial trial ${trial + 1} accepted`,
        5000,
      );
    }
  }
  await waitFor(
    page,
    () => document.documentElement.dataset.spatialState === "passed",
    "all spatial trials passed",
    5000,
  );
  check("三段移动声源前后方向通过", spatialAnswers.length === 3, spatialAnswers.join(" / "));
  check("校准完成卡片出现", await page.isVisible("#calibration-complete"));
  await page.screenshot({
    path: new URL("calibration-complete.png", artifacts).pathname,
    fullPage: true,
  });

  await page.click("#save-calibration");
  await waitFor(
    page,
    () => document.documentElement.dataset.screen === "scene",
    "investigation scene after save",
    10000,
  );
  const savedProfile = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("echo-file.binaural-calibration.v1")),
  );
  check("校准参数写入 localStorage", savedProfile?.spatial?.passed === true);
  check("保存参数包含声道交换", savedProfile.channels.swap === true);
  const applied = await page.evaluate(() => ({
    swap: document.querySelector("#scene-profile").dataset.swap,
    gain: document.querySelector("#scene-profile").dataset.gainDb,
    hz: document.querySelector("#scene-profile").dataset.alertHz,
    spatial: document.querySelector("#scene-profile").dataset.spatial,
  }));
  check("调查场景应用声道与增益", applied.swap === "true" &&
    applied.gain === String(savedProfile.applied.masterGainDb));
  check("调查场景应用参考音高", applied.hz === String(savedProfile.applied.alertHz));
  await page.click('[data-clue="door"]');
  await waitFor(
    page,
    () => document.querySelector("#scene-feedback").textContent.includes("校准矩阵"),
    "scene clue playback",
  );
  check("调查场景线索使用校准音频链", true);
  await page.screenshot({
    path: new URL("investigation-scene.png", artifacts).pathname,
    fullPage: true,
  });

  await page.reload({ waitUntil: "networkidle" });
  await waitFor(
    page,
    () => document.documentElement.dataset.appReady === "true",
    "application reload",
  );
  await page.locator("#profile-restored").waitFor({ state: "visible" });
  const restoredText = await page.locator("#restored-detail").innerText();
  check("重开后恢复校准参数提示", restoredText.includes(`${savedProfile.tone.matchHz.toFixed(1)} Hz`), restoredText);
  const storedAfterReload = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("echo-file.binaural-calibration.v1")),
  );
  check("重开后 localStorage 参数未丢失", storedAfterReload.createdAt === savedProfile.createdAt);
  await page.screenshot({
    path: new URL("profile-restored.png", artifacts).pathname,
    fullPage: true,
  });

  await page.click("#resume-scene");
  await waitFor(
    page,
    () => document.documentElement.dataset.screen === "scene",
    "restored profile applied to scene",
  );
  const restoredApplied = await page.evaluate(() => ({
    swap: document.querySelector("#scene-profile").dataset.swap,
    gain: document.querySelector("#scene-profile").dataset.gainDb,
    hz: document.querySelector("#scene-profile").dataset.alertHz,
  }));
  check("重开后场景仍使用保存参数",
    restoredApplied.swap === applied.swap &&
    restoredApplied.gain === applied.gain &&
    restoredApplied.hz === applied.hz,
    JSON.stringify(restoredApplied));

  const output = await page.evaluate(() => window.__echoCalibration.getOutputState());
  check("Web Audio 已实际初始化", output.state === "running", JSON.stringify(output));
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);

  report = {
    status: "passed",
    completedAt: new Date().toISOString(),
    browser: executablePath,
    server: server.url,
    spatialAnswers,
    channelReversalWarning: warning.replace(/\s+/g, " ").trim(),
    savedProfile,
    restoredApplied,
    audioOutput: output,
    checks: results,
    consoleErrors,
    screenshots: [
      "calibration-start.png",
      "channel-reversed-error.png",
      "tone-matched.png",
      "calibration-complete.png",
      "investigation-scene.png",
      "profile-restored.png",
    ],
  };
} catch (error) {
  report = {
    status: "failed",
    completedAt: new Date().toISOString(),
    error: error.message,
    pageErrors,
    consoleErrors,
    checks: results,
  };
  throw error;
} finally {
  await writeFile(new URL("verification.json", artifacts), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await server.close();
}

console.log(`\nVerified ${results.length} checks. Artifacts: artifacts/verification.json`);
