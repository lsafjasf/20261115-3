// 无头验证脚本：加载页面 -> 截图各状态 -> 校验 FPS/暂停/调试视图
import puppeteer from "puppeteer-core";
import http from "http";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHELL = process.env.HOME +
  "/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise(r => server.listen(8931, r));

const chrome = spawn(SHELL, ["--no-sandbox", "--remote-debugging-port=9223",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"],
  { stdio: "ignore" });
let browser = null;
for (let i = 0; i < 30; i++) {
  try {
    browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9223" });
    break;
  } catch { await new Promise(r => setTimeout(r, 500)); }
}
if (!browser) throw new Error("cannot connect to chrome");
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto("http://127.0.0.1:8931/", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 2500));

const shot = (name) => page.screenshot({ path: `artifacts/${name}.png` });
const setRange = (id, v) => page.evaluate((id, v) => {
  const el = document.getElementById(id);
  el.value = v; el.dispatchEvent(new Event("input"));
}, id, v);
// 仅取 canvas 像素（排除 DOM 中 FPS 文本的干扰）
const canvasPixels = () => page.evaluate(() =>
  document.getElementById("glcanvas").toDataURL());

// 1. 默认状态 + FPS 读数
await shot("01-default");
const fps1 = await page.$eval("#fps", el => el.textContent);

// 2. 运动检测：运行中两帧 canvas 像素应不同
const pxA = await canvasPixels();
await new Promise(r => setTimeout(r, 400));
const pxB = await canvasPixels();
const moving = pxA !== pxB;

// 3. 暂停：两帧 canvas 像素必须完全一致（水面完全静止）
await page.click("#btnPause");
await new Promise(r => setTimeout(r, 300));
const p1 = await canvasPixels();
await new Promise(r => setTimeout(r, 500));
const p2 = await canvasPixels();
const frozen = p1 === p2;
await shot("02-paused");
const fpsPaused = await page.$eval("#fps", el => el.textContent);
await page.click("#btnPause"); // 恢复

// 4. 风场 B（长涌）+ 高风速
await page.click("#colB");
await setRange("wind", 16);
await new Promise(r => setTimeout(r, 800));
await shot("03-presetB-wind16");

// 5. 低潮位 + 泡沫遮挡检验视图
await setRange("tide", 0.8);
await page.select("#debugView", "4");
await new Promise(r => setTimeout(r, 400));
await shot("04-debug-occlusion");

// 6. 泡沫遮罩 / 仅折射 / 深度雾
await page.select("#debugView", "2");
await new Promise(r => setTimeout(r, 300));
await shot("05-debug-foam");
await page.select("#debugView", "1");
await new Promise(r => setTimeout(r, 300));
await shot("06-debug-refraction");
await page.select("#debugView", "3");
await new Promise(r => setTimeout(r, 300));
await shot("07-debug-depth");

// 7. 太阳位置变化（低角度逆光）
await page.select("#debugView", "0");
await setRange("sunAz", 120); await setRange("sunEl", 8);
await new Promise(r => setTimeout(r, 400));
await shot("08-sunset");

// 8. 风场实测统计（页面内 JS 波形模型）
const stats = await page.evaluate(() => ({
  A: measurePreset("A", 8), B: measurePreset("B", 8),
  A16: measurePreset("A", 16), B16: measurePreset("B", 16),
}));

console.log(JSON.stringify({
  errors, fps1, fpsPaused, moving, frozen, stats,
}, null, 2));

await browser.close();
chrome.kill();
server.close();
