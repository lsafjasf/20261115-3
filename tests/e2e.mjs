import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = join(ROOT, "artifacts");
const CHECKS = [];

function check(condition, message, details) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}${details ? ` — ${JSON.stringify(details)}` : ""}`);
  CHECKS.push(message);
  console.log(`✓ ${message}`);
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/tmp/chrome-test/chrome-linux64/chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome not found. Set CHROME_PATH.");
  return found;
}

async function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server timeout: ${output}`)), 8000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`Server exited ${code}: ${output}`)));
  });
  return { child, url };
}

async function setNumberField(page, index, field, value) {
  const input = page.locator(`[data-field="${field}"][data-index="${index}"]`);
  await input.fill(String(value));
  await input.evaluate((element) => element.dispatchEvent(new Event("change", { bubbles: true })));
  await page.waitForTimeout(80);
}

mkdirSync(ARTIFACTS, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath(),
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--allow-file-access-from-files",
  ],
});

const pageErrors = [];
let finalState;
let playbackEvidence;

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      pageErrors.push(message.text());
    }
  });

  await page.goto(server.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__FRAMECUT__));
  await page.waitForTimeout(350);

  const initial = await page.evaluate(() => window.__FRAMECUT__.getState());
  check(initial.clips.length === 3, "默认提供三个入点、出点与转场槽位", initial.clips.length);
  check(Math.abs(initial.totalDuration - 9.8) < 0.02, "三段默认序列总时长正确显示", initial.totalDuration);
  check(await page.locator("#export-button").isDisabled(), "黑帧检查前 WebM 导出被锁定");

  const strips = page.locator(".clip-strip");
  await strips.nth(2).dragTo(strips.nth(0));
  await page.waitForTimeout(250);
  const reordered = await page.evaluate(() => window.__FRAMECUT__.getState());
  check(reordered.clips[0].id === "clip-c", "时间线片段可拖动重排", reordered.clips.map((clip) => clip.id));
  check(
    Math.abs(reordered.totalDuration - initial.totalDuration) < 0.02,
    "拖动重排后总时长实时重算",
    reordered.totalDuration,
  );

  await page.locator("#reset-button").click();
  await page.waitForFunction(() => window.__FRAMECUT__.getState().clips.length === 3);
  await page.locator('[data-remove="2"]').click();
  await page.waitForFunction(() => window.__FRAMECUT__.getState().clips.length === 2);

  await setNumberField(page, 0, "inPoint", 2.2);
  await setNumberField(page, 0, "outPoint", 6.0);
  await setNumberField(page, 1, "inPoint", 10.4);
  await setNumberField(page, 1, "outPoint", 14.0);
  await page.locator('[data-field="transition"][data-index="1"]').selectOption("crossfade");
  await page.waitForTimeout(150);

  const cutState = await page.evaluate(() => window.__FRAMECUT__.getState());
  check(cutState.clips.length === 2, "实际保留两段素材", cutState.clips.length);
  check(
    cutState.clips[0].inPoint === 2.2 &&
      cutState.clips[0].outPoint === 6.0 &&
      cutState.clips[1].inPoint === 10.4 &&
      cutState.clips[1].outPoint === 14.0,
    "两段入点和出点已写入序列",
    cutState.clips,
  );
  check(cutState.clips[1].transition === "crossfade", "第二段使用交叉淡化转场");
  check(Math.abs(cutState.totalDuration - 6.7) < 0.02, "两段成片总时长为 6.70s", cutState.totalDuration);
  check((await page.locator("#total-duration").textContent()) === "00:06.70", "时间线显示更新后的总时长");
  check(cutState.captions.length >= 2, "字幕轨随裁切后源区间重新生成", cutState.captions);
  check(
    cutState.syncPoints.every(
      (point) => Boolean(point.subtitle) && Math.abs(point.audioClock - point.sourceTime) < 1e-9,
    ),
    "字幕与音频共用同一裁切源时间映射",
    cutState.syncPoints,
  );

  await page.screenshot({ path: join(ARTIFACTS, "timeline-before-export.png"), fullPage: true });
  await page.locator("#check-button").click();
  await page.waitForFunction(() => window.__FRAMECUT__.getState().gate !== "checking", null, {
    timeout: 30000,
  });
  const checked = await page.evaluate(() => window.__FRAMECUT__.getState());
  check(checked.gate === "pass", "黑帧检查通过");
  check(checked.checkResult.black === 0, "全部成片采样帧均非黑帧", checked.checkResult);
  check(checked.checkResult.samples >= 200, "以 30fps 扫描全部成片帧", checked.checkResult.samples);
  check(!(await page.locator("#export-button").isDisabled()), "检查通过后导出按钮解锁");

  await page.locator("#export-button").click();
  await page.waitForFunction(() => document.body.dataset.exportReady === "true", null, {
    timeout: 30000,
  });
  await page.waitForFunction(
    () => {
      const video = document.querySelector("#result-video");
      return video && video.readyState >= 1 && Number.isFinite(video.duration) && video.currentTime > 0.15;
    },
    null,
    { timeout: 10000 },
  );
  const exported = await page.evaluate(() => window.__FRAMECUT__.getState());
  check(exported.exportReady, "WebM 已生成并可在页面内回放");
  check(exported.exportInfo.clips === 2, "导出文件包含实际裁出的两段", exported.exportInfo);
  check(exported.exportInfo.mimeType.includes("vp9") && exported.exportInfo.mimeType.includes("opus"), "编码为 VP9 + Opus WebM");
  check(exported.exportInfo.size > 500000, "WebM 文件包含真实媒体数据", exported.exportInfo.size);
  check(
    Number.isFinite(exported.playback.resultDuration) && exported.playback.resultDuration > 6.5,
    "导出文件含有效总时长元数据",
    exported.playback.resultDuration,
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(ARTIFACTS, "verification-editor.png"), fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-link").click(),
  ]);
  const exportedPath = join(ARTIFACTS, "framecut-two-cuts.webm");
  await download.saveAs(exportedPath);
  check(statSync(exportedPath).size > 500000, "导出的 WebM 已落盘", statSync(exportedPath).size);

  const audioEvidence = await page.evaluate(async () => {
    const response = await fetch("/artifacts/framecut-two-cuts.webm?audio=1");
    const buffer = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const decoded = await audioContext.decodeAudioData(buffer);
    const data = decoded.getChannelData(0);
    const windowSize = Math.floor(decoded.sampleRate * 0.1);
    let activeWindows = 0;
    let totalWindows = 0;
    let maxRms = 0;
    for (let offset = 0; offset + windowSize < data.length; offset += windowSize) {
      let sum = 0;
      for (let index = offset; index < offset + windowSize; index += 1) {
        sum += data[index] * data[index];
      }
      const rms = Math.sqrt(sum / windowSize);
      if (rms > 0.005) activeWindows += 1;
      maxRms = Math.max(maxRms, rms);
      totalWindows += 1;
    }
    await audioContext.close();
    return {
      duration: decoded.duration,
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
      activeRatio: activeWindows / totalWindows,
      maxRms,
    };
  });
  check(
    audioEvidence.channels >= 1 && audioEvidence.maxRms > 0.02,
    "导出 WebM 内嵌真实 Opus 音轨",
    audioEvidence,
  );
  check(
    audioEvidence.activeRatio > 0.45 &&
      Math.abs(audioEvidence.duration - exported.exportInfo.recordedDuration) < 0.2,
    "音频时长与视频回放时间轴一致",
    audioEvidence,
  );

  await page.locator("#replay-export-button").click();
  await page.waitForFunction(() => document.querySelector("#result-video").currentTime > 0.1, null, {
    timeout: 4000,
  });
  check(true, "点击重播后页面内导出文件继续播放");

  playbackEvidence = await page.evaluate(async () => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = "/artifacts/framecut-two-cuts.webm?verify=1";
    video.style.width = "720px";
    video.style.display = "none";
    document.body.append(video);
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("Exported WebM failed to load"));
      setTimeout(() => reject(new Error("Metadata timeout")), 6000);
    });
    const metadata = {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
    };
    const frames = [];
    const captureTimes = [0.8, 4.6];
    let captureIndex = 0;
    const captureFrame = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      frames.push({ dataUrl: canvas.toDataURL("image/png"), at: video.currentTime });
      captureIndex += 1;
    };
    await video.play();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Playback timeout")), 12000);
      const onFrame = () => {
        if (
          captureIndex < captureTimes.length &&
          video.currentTime >= captureTimes[captureIndex]
        ) {
          captureFrame();
        }
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      video.onended = resolve;
      video.requestVideoFrameCallback(onFrame);
      video.addEventListener(
        "ended",
        () => {
          clearTimeout(timer);
          if (captureIndex < captureTimes.length) captureFrame();
          resolve();
        },
        { once: true },
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      metadata,
      ended: video.ended,
      finalTime: video.currentTime,
      frames,
    };
  });

  check(
    Number.isFinite(playbackEvidence.metadata.duration) && playbackEvidence.metadata.duration > 6.5,
    "落盘文件首次加载即可读取有限时长",
    playbackEvidence.metadata,
  );
  check(
    playbackEvidence.metadata.width === 1280 && playbackEvidence.metadata.height === 720,
    "落盘文件分辨率保持 1280 × 720",
    playbackEvidence.metadata,
  );
  check(playbackEvidence.ended, "落盘 WebM 从头播放到自然结束");
  check(
    Math.abs(playbackEvidence.finalTime - playbackEvidence.metadata.duration) < 0.3,
    "实际回放进度抵达文件末尾",
    playbackEvidence,
  );
  playbackEvidence.frames.forEach((frame, index) => {
    writeFileSync(
      join(ARTIFACTS, `exported-frame-${index + 1}.png`),
      Buffer.from(frame.dataUrl.split(",")[1], "base64"),
    );
  });
  check(playbackEvidence.frames.length === 2, "从导出文件抽取两段画面作为验收证据");

  finalState = await page.evaluate(() => window.__FRAMECUT__.getState());
  check(pageErrors.length === 0, "页面运行无脚本错误", pageErrors);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceDuration: 30,
    clips: finalState.clips,
    timelineDuration: Number(finalState.totalDuration.toFixed(3)),
    subtitleTrack: finalState.captions,
    syncPoints: finalState.syncPoints,
    blackFrameCheck: {
      ...finalState.checkResult,
      minLuma: Number(finalState.checkResult.minLuma.toFixed(2)),
    },
    export: finalState.exportInfo,
    audio: audioEvidence,
    exportedFile: {
      path: "artifacts/framecut-two-cuts.webm",
      bytes: statSync(exportedPath).size,
      duration: playbackEvidence.metadata.duration,
      width: playbackEvidence.metadata.width,
      height: playbackEvidence.metadata.height,
      playedToEnd: playbackEvidence.ended,
    },
    checks: CHECKS,
  };
  writeFileSync(join(ARTIFACTS, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nVerification complete: ${CHECKS.length} checks passed.`);
} finally {
  await browser.close();
  server.child.kill("SIGTERM");
}
