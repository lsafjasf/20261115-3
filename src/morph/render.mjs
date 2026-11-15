// 输出：逐帧 SVG 字符串、resvg 栅格化、ffmpeg 编码 WebM、SMIL 动画 SVG。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { pointsToPath, easeBezier, VB } from "./core.mjs";
import ffmpegBin from "./ffmpeg-path.cjs";

export function frameSvg(pts, opts = {}) {
  const fill = opts.fill ?? "#6c5ce7";
  const stroke = opts.stroke ?? "#2d2a5e";
  const bg = opts.bg ?? "#0f1020";
  const d = pointsToPath(pts);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}">
  <rect width="${VB}" height="${VB}" fill="${bg}"/>
  <path d="${d}" fill="${fill}" fill-opacity="0.92" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
}

export function renderPng(svg, scale = 2) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: VB * scale },
    background: "#0f1020",
  });
  return resvg.render().asPng();
}

// 调用 ffmpeg-static 将 PNG 帧序列编码为 VP9 WebM。
export function encodeWebm(pngFrames, outPath, fps = 30) {
  const dir = mkdtempSync(join(tmpdir(), "morph-"));
  try {
    pngFrames.forEach((png, i) => {
      writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.png`), png);
    });
    const ffmpeg = ffmpegBin;
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-framerate", String(fps),
        "-i", join(dir, "f%04d.png"),
        "-c:v", "libvpx-vp9",
        "-b:v", "2M",
        "-pix_fmt", "yuv420p",
        "-auto-alt-ref", "0",
        outPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 往返无缝循环的 SMIL 动画 SVG（circle -> mid -> star -> mid -> circle）。
export function smilSvg(keyframes, opts = {}) {
  const duration = opts.duration ?? 4;
  const poses = [
    keyframes[0],
    keyframes[1],
    keyframes[2],
    keyframes[1],
    keyframes[0],
  ];
  const values = poses.map((k) => pointsToPath(k.points)).join(";");
  const keyTimes = "0;0.25;0.5;0.75;1";
  const e01 = easeBezier[keyframes[0].easing] ?? easeBezier.linear;
  const e12 = easeBezier[keyframes[1].easing] ?? easeBezier.linear;
  const keySplines = `${e01};${e12};${e12};${e01}`;
  const fill = opts.fill ?? "#6c5ce7";
  const stroke = opts.stroke ?? "#2d2a5e";
  const bg = opts.bg ?? "#0f1020";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}">
  <rect width="${VB}" height="${VB}" fill="${bg}"/>
  <path d="${pointsToPath(poses[0].points)}" fill="${fill}" fill-opacity="0.92" stroke="${stroke}" stroke-width="2" stroke-linejoin="round">
    <animate attributeName="d" dur="${duration}s" repeatCount="indefinite"
      calcMode="spline" keyTimes="${keyTimes}" keySplines="${keySplines}"
      values="${values}"/>
  </path>
</svg>`;
}

export function staticSvg(pts, opts = {}) {
  return frameSvg(pts, opts).replace(
    "<svg ",
    '<svg xmlns:shape="morph/export" shape:pose="final-star" '
  );
}
