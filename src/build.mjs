// 无头构建管线：生成圆形→星形往返形变，完成全部安全检查并导出产物。
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { pointsToPath, signedArea } from "./morph/core.mjs";
import { buildDemoKeyframes, buildLoopFrames } from "./morph/demo.mjs";
import { auditFrames, loopClosure, periodicBoundary, maxDeviation } from "./morph/checks.mjs";
import { frameSvg, renderPng, encodeWebm, smilSvg, staticSvg } from "./morph/render.mjs";
import ffmpegBin from "./morph/ffmpeg-path.cjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = join(root, "artifacts");
const fps = 30;
const samplesPerLeg = 60; // 单程 60 帧 -> 往返共 120 帧 = 4.0s @30fps

const { keyframes, match } = buildDemoKeyframes();
const loopFrames = buildLoopFrames(keyframes, samplesPerLeg);

// 1) 逐帧安全审计：自交 / 翻转 / 极角扭转。
const audit = auditFrames(loopFrames);

// 2) 循环首尾姿态检查（末帧必须与首帧一致）。
const closure = loopClosure(loopFrames[0], loopFrames[loopFrames.length - 1], 0.5);
const boundary = periodicBoundary(loopFrames);

// 3) 关键帧姿态之间的最大顶点位移（供报告参考）。
const legDev = {
  circleToMid: Math.round(maxDeviation(keyframes[0].points, keyframes[1].points) * 100) / 100,
  midToStar: Math.round(maxDeviation(keyframes[1].points, keyframes[2].points) * 100) / 100,
};

// 4) 渲染 PNG 帧并编码 VP9 WebM。
const pngs = loopFrames.map((pts) => renderPng(frameSvg(pts), 2));
const webmPath = join(artifacts, "morph-circle-star.webm");
encodeWebm(pngs, webmPath, fps);

// 5) 导出 SMIL 往返动画 SVG 与最终静态星形 SVG。
const animSvgPath = join(artifacts, "morph-circle-star.svg");
writeFileSync(animSvgPath, smilSvg(keyframes, { duration: 4 }));
const finalSvgPath = join(artifacts, "final-star.svg");
writeFileSync(finalSvgPath, staticSvg(keyframes[2].points));

// 6) ffmpeg 自查编码结果（读取容器/码流元数据）。
let ffInfo = "";
try {
  ffInfo = execFileSync(
    ffmpegBin,
    ["-i", webmPath, "-hide_banner"],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] }
  );
} catch (e) {
  ffInfo = (e.stderr || e.message).toString();
}
const streamLine = ffInfo.split("\n").find((l) => l.includes("Video:")) || "";
const durLine = ffInfo.split("\n").find((l) => l.includes("Duration")) || "";

const report = {
  shapes: {
    source: "circle r=130 (64 raw vertices)",
    target: "5-point star R=150 r=62 (10 raw vertices)",
  },
  vertexMatching: {
    resampledVertexCount: match.a.length,
    chosenCyclicShift: match.shift,
    matchedMeanSqEnergy: Math.round(match.energy * 100) / 100,
    naiveMeanSqEnergy: Math.round(match.naiveEnergy * 100) / 100,
  },
  easing: {
    circleToMid: keyframes[0].easing,
    midToStar: keyframes[1].easing,
  },
  keyframeMaxDeviationPx: legDev,
  loop: {
    fps,
    frames: loopFrames.length,
    nominalDurationSec: loopFrames.length / fps,
    closure,
    periodicBoundary: boundary,
  },
  frameAudit: {
    ok: audit.ok,
    selfIntersectionFrames: audit.selfIntersections.map((x) => x.frame),
    orientationFlipFrames: audit.orientationFlips.map((x) => x.frame),
    angleViolationFrames: audit.angleViolations.map((x) => x.frame),
    minAbsArea: Math.round(audit.areaMin * 100) / 100,
    startArea: Math.round(signedArea(loopFrames[0]) * 100) / 100,
    endArea: Math.round(signedArea(loopFrames[loopFrames.length - 1]) * 100) / 100,
  },
  outputs: {
    webm: "artifacts/morph-circle-star.webm",
    animatedSvg: "artifacts/morph-circle-star.svg",
    finalStaticSvg: "artifacts/final-star.svg",
  },
  ffmpeg: { duration: durLine.trim(), stream: streamLine.trim() },
  sampleFirstPath: pointsToPath(loopFrames[0]).slice(0, 80) + "…",
  sampleLastPath: pointsToPath(loopFrames.at(-1)).slice(0, 80) + "…",
};

writeFileSync(join(artifacts, "audit-report.json"), JSON.stringify(report, null, 2));

console.log("== 构建完成 ==");
console.log("顶点匹配:", JSON.stringify(report.vertexMatching));
console.log("逐帧审计 ok:", audit.ok,
  "| 自交帧:", audit.selfIntersections.length,
  "| 翻转帧:", audit.orientationFlips.length,
  "| 扭转帧:", audit.angleViolations.length);
console.log("循环首尾:", JSON.stringify(closure));
console.log("周期边界步长:", JSON.stringify(boundary));
console.log("ffmpeg:", streamLine.trim());
if (!audit.ok || !closure.ok || !boundary.ok) process.exit(1);
