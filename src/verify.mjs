// 独立验证脚本：重新计算姿态、比对导出产物，并对 WebM 首/尾帧做像素级循环检查。
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { pointsToPath } from "./morph/core.mjs";
import { buildDemoKeyframes, buildLoopFrames } from "./morph/demo.mjs";
import { auditFrames, loopClosure, periodicBoundary } from "./morph/checks.mjs";
import { renderPng, frameSvg } from "./morph/render.mjs";
import ffmpegBin from "./morph/ffmpeg-path.cjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const art = join(root, "artifacts");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
};

const { keyframes } = buildDemoKeyframes();
const frames = buildLoopFrames(keyframes, 60);

// 1. 几何审计独立重算。
const audit = auditFrames(frames);
check("全部帧无自交", audit.selfIntersections.length === 0,
  `自交帧 ${audit.selfIntersections.length}`);
check("全部帧无环绕翻转", audit.orientationFlips.length === 0,
  `翻转帧 ${audit.orientationFlips.length}`);
check("全部帧无极角扭转", audit.angleViolations.length === 0,
  `扭转帧 ${audit.angleViolations.length}`);
const closure = loopClosure(frames[0], frames.at(-1), 0.5);
check("循环首尾姿态一致", closure.ok,
  `最大顶点偏差 ${closure.maxDeviationPx}px (容差 ${closure.tolerancePx}px)`);
const boundary = periodicBoundary(frames);
check("周期边界无跳变（末帧→首帧）", boundary.ok,
  `环绕步长 ${boundary.wrapStepPx}px ≤ 中位步长 ${boundary.medianStepPx}px×1.5（内部最大 ${boundary.maxInteriorStepPx}px）`);
check("中点帧为星形姿态", loopClosure(frames[60], keyframes[2].points, 0.01).ok,
  "t=0.5（第60帧）等于目标星形关键帧");

// 2. 静态 SVG 路径与计算结果逐字符一致。
const finalSvg = readFileSync(join(art, "final-star.svg"), "utf8");
check("final-star.svg 路径匹配",
  finalSvg.includes(pointsToPath(keyframes[2].points)),
  "path d 与 frameAt 计算结果一致");

// 3. 动画 SVG 的 SMIL 首/尾 values 均为圆形姿态，且关键时间/缓动完整。
const animSvg = readFileSync(join(art, "morph-circle-star.svg"), "utf8");
const valuesAttr = animSvg.match(/values="([^"]+)"/)[1].split(";");
check("SMIL 首尾 values 同为圆形",
  valuesAttr[0] === valuesAttr[4] && valuesAttr[0] === pointsToPath(keyframes[0].points),
  `${valuesAttr.length} 个姿态`);
check("SMIL keyTimes 覆盖往返", animSvg.includes("keyTimes=\"0;0.25;0.5;0.75;1\""));
check("SMIL 无限循环", animSvg.includes("repeatCount=\"indefinite\""));

// 4. WebM 抽帧：首帧与末帧像素应近似相同（无缝循环）。
const dir = mkdtempSync(join(tmpdir(), "verify-"));
try {
  const webm = join(art, "morph-circle-star.webm");
  execFileSync(ffmpegBin, ["-y", "-i", webm, "-vsync", "0", join(dir, "f%03d.png")],
    { stdio: ["ignore", "ignore", "pipe"] });
  const probe = spawnSync(ffmpegBin, ["-i", webm, "-hide_banner"], { encoding: "utf8" });
  const extracted = (probe.stderr || "") + (probe.stdout || "");
  const vp9 = /Video: vp9/.test(extracted);
  check("WebM 编码为 VP9", vp9, extracted.match(/Video: [^\n]+/)?.[0] || "");

  // 用 ffmpeg PSNR 滤镜比较首帧与末帧。
  const n = frames.length;
  const psnrRun = spawnSync(ffmpegBin, [
    "-i", join(dir, "f001.png"),
    "-i", join(dir, `f${String(n).padStart(3, "0")}.png`),
    "-filter_complex", "psnr", "-f", "null", "-",
  ], { encoding: "utf8" });
  const psnr = (psnrRun.stderr || "") + (psnrRun.stdout || "");
  const psnrLine = psnr.split("\n").find((l) => l.includes("PSNR")) || "";
  const avg = Number((psnrLine.match(/average:([0-9.]+)/) || [])[1] || 0);
  check("WebM 首/末帧像素一致 (PSNR)", avg > 40,
  `PSNR average=${avg.toFixed(2)} dB（>40dB 视为视觉无跳变）`);

  // 中点帧应呈现星形：渲染计算星形 PNG 与第 61 帧抽帧比对。
  const starPng = join(dir, "star-expected.png");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(starPng, renderPng(frameSvg(keyframes[2].points), 2));
  const psnrMidRun = spawnSync(ffmpegBin, [
    "-i", starPng,
    "-i", join(dir, "f061.png"),
    "-filter_complex", "psnr", "-f", "null", "-",
  ], { encoding: "utf8" });
  const psnrMid = (psnrMidRun.stderr || "") + (psnrMidRun.stdout || "");
  const avgMid = Number((psnrMid.split("\n").find((l) => l.includes("PSNR"))
    .match(/average:([0-9.]+)/) || [])[1] || 0);
  check("WebM 中点帧为星形", avgMid > 40, `PSNR average=${avgMid.toFixed(2)} dB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed ? 1 : 0);
