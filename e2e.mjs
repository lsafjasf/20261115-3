// 端到端验证：在真实浏览器中加载拼贴工程、模拟重排、检查标题安全区、
// 测试 undo/redo，并导出 PNG（保留裁切与透明度）。
// 运行：node e2e.mjs
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL(".", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = createServer((req, res) => {
  const path = join(ROOT, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  try {
    const body = readFileSync(path);
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.Collage);

// 1) 加载已完成的拼贴工程
const project = JSON.parse(readFileSync(join(ROOT, "artifacts/collage-project.json"), "utf8"));
await page.evaluate((p) => window.Collage.setState(p), project);
const v1 = await page.evaluate(() => window.Collage.violations());
check("浏览器中加载拼贴：不遮挡主标题安全区", v1.length === 0, v1.join(","));

// 2) 模拟一次重排：调整位置/旋转/层级
await page.evaluate(() => {
  const s = window.Collage.getState();
  const [a, b, c] = s.layers;
  [a.x, a.y, a.rotation] = [255, 415, -5];
  [b.x, b.y, b.rotation] = [505, 495, -2];
  [c.x, c.y, c.rotation] = [695, 390, 6];
  s.layers = [c, a, b]; // 调整层级顺序
  window.Collage.commit();
  window.Collage.setState(s);
});
const v2 = await page.evaluate(() => window.Collage.violations());
check("浏览器中重排后：不遮挡主标题安全区", v2.length === 0, v2.join(","));

// 3) undo/redo 可用
const undoOk = await page.evaluate(() => {
  const before = JSON.stringify(window.Collage.getState().layers);
  window.Collage.undo();
  const afterUndo = JSON.stringify(window.Collage.getState().layers);
  window.Collage.redo();
  const afterRedo = JSON.stringify(window.Collage.getState().layers);
  return afterUndo !== before && afterRedo === before;
});
check("undo/redo 正确还原图层状态", undoOk);

// 4) 导出 PNG：尺寸正确，且裁切与透明度被保留
const exportInfo = await page.evaluate(() => {
  const url = window.Collage.exportDataURL(2);
  const img = new Image();
  return new Promise((resolve) => {
    img.onload = () => {
      // 用 1x 导出做像素级校验
      const checkUrl = window.Collage.exportDataURL(1);
      const cimg = new Image();
      cimg.onload = () => {
        const c = document.createElement("canvas");
        c.width = cimg.width;
        c.height = cimg.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(cimg, 0, 0);
        // 安全区内（标题区域）不应有任何图层像素 -> alpha 应为 0
        const z = window.Collage.SAFE_ZONE;
        const px = ctx.getImageData(z.x + z.width / 2, z.y + z.height / 2, 1, 1).data;
        // 舞台下方图层覆盖区应有内容
        const px2 = ctx.getImageData(480, 500, 1, 1).data;
        resolve({
          width: img.width,
          height: img.height,
          safeZoneAlpha: px[3],
          bodyAlpha: px2[3],
          bytes: Math.round(url.length * 0.75),
        });
      };
      cimg.src = checkUrl;
    };
    img.src = url;
  });
});
check("导出 PNG 尺寸为 1920×1280（2x）", exportInfo.width === 1920 && exportInfo.height === 1280);
check("导出图中标题安全区无图层像素（透明）", exportInfo.safeZoneAlpha === 0, `alpha=${exportInfo.safeZoneAlpha}`);
check("导出图中拼贴主体区域有内容", exportInfo.bodyAlpha > 0, `alpha=${exportInfo.bodyAlpha}`);

// 5) 恢复为已保存的工程状态，再导出 PNG 与页面截图
await page.evaluate((p) => window.Collage.setState(p), project);
const dataURL = await page.evaluate(() => window.Collage.exportDataURL(2));
writeFileSync(join(ROOT, "artifacts/collage.png"), Buffer.from(dataURL.split(",")[1], "base64"));
await page.screenshot({ path: join(ROOT, "artifacts/editor-screenshot.png") });
console.log("\n已导出 artifacts/collage.png 与 artifacts/editor-screenshot.png");

await browser.close();
server.close();
if (failures) {
  console.error(`\n${failures} 项检查失败`);
  process.exit(1);
}
console.log("\n端到端验证全部通过。");
