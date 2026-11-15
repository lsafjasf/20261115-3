#!/usr/bin/env node
/*
 * 生成 data/skeleton.json 与 data/animation.json，
 * 并在写入前校验：七段骨、单一根、循环首尾姿态连续。
 */
const fs = require("fs");
const path = require("path");
const { Skeleton } = require("../js/skeleton.js");
const { KeyframeTrack } = require("../js/animation.js");
const defs = require("../js/defaults.js");

const outDir = path.join(__dirname, "..", "data");
fs.mkdirSync(outDir, { recursive: true });

const skeleton = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
if (skeleton.order.length !== 7) {
  throw new Error("期望 7 段骨骼，实际 " + skeleton.order.length);
}

const track = new KeyframeTrack(skeleton.order);
track.duration = defs.DURATION;
for (const frame of defs.WAVE_KEYFRAMES) track.addFrame(frame.time, frame.pose);

const gap = track.maxLoopGap();
if (gap > 1e-9) {
  throw new Error("挥手循环首尾不连续，最大角度跳变 " + gap);
}

const skeletonJSON = skeleton.toJSON();
const animationJSON = track.toJSON();

fs.writeFileSync(
  path.join(outDir, "skeleton.json"),
  JSON.stringify(skeletonJSON, null, 2) + "\n"
);
fs.writeFileSync(
  path.join(outDir, "animation.json"),
  JSON.stringify(animationJSON, null, 2) + "\n"
);

// 顺便做一次“从 JSON 重新载入”的往返校验
const reloaded = Skeleton.fromJSON(JSON.parse(JSON.stringify(skeletonJSON)));
const reloadedTrack = KeyframeTrack.fromJSON(
  JSON.parse(JSON.stringify(animationJSON)),
  reloaded.order
);
const a = reloaded.solve();
const b = skeleton.solve();
for (const id of skeleton.order) {
  if (Math.abs(a.get(id).ex - b.get(id).ex) > 1e-12 ||
      Math.abs(a.get(id).ey - b.get(id).ey) > 1e-12) {
    throw new Error("重新载入后 FK 结果不一致: " + id);
  }
}

console.log("骨骼段数:", reloaded.order.length);
console.log("关键帧数:", reloadedTrack.frames.length, "时长(s):", reloadedTrack.duration);
console.log("循环最大跳变(rad):", reloadedTrack.maxLoopGap());
console.log("已写入 data/skeleton.json 与 data/animation.json");
