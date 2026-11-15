#!/usr/bin/env node
/*
 * 核心行为测试（零依赖，node test/core.test.cjs）：
 * 父子旋转传递、子关节拖拽不拉伸父骨、插值与首尾循环、JSON 保存/重新载入。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Skeleton, normAngle } = require("../js/skeleton.js");
const { KeyframeTrack } = require("../js/animation.js");
const { AudioFX } = require("../js/audio.js");
const renderer = require("../js/renderer.js");
const defs = require("../js/defaults.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

console.log("拓扑与七段骨骼:");
test("正好 7 段骨且单一根", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  assert.strictEqual(sk.order.length, 7);
  assert.strictEqual(sk.rootId, "pelvis");
  for (const id of sk.order) {
    const b = sk.getBone(id);
    if (b.parent) assert.ok(sk.bones.has(b.parent));
  }
});

test("拒绝重复根/循环/父先于子", () => {
  assert.throws(() => new Skeleton([], 0, 0));
  assert.throws(
    () =>
      new Skeleton(
        [
          { id: "a", length: 10, parent: "b" },
          { id: "b", length: 10, parent: "a" },
        ],
        0,
        0
      )
  );
  assert.throws(
    () => new Skeleton([{ id: "a", length: 10, parent: "missing" }], 0, 0)
  );
});

console.log("父子旋转传递(FK):");
test("父骨旋转会带动全部后代，且骨长不变", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  const before = sk.solve().get("foreArmR");
  sk.setRotation("spine", 0.5);
  const after = sk.solve().get("foreArmR");
  assert.ok(Math.abs(before.ex - after.ex) > 1);
  assert.ok(Math.abs(before.ey - after.ey) > 1);
  const len = Math.hypot(after.ex - after.sx, after.ey - after.sy);
  assert.ok(Math.abs(len - sk.getBone("foreArmR").length) < 1e-9);
});

test("子骨旋转的世界角 = 父世界角 + 局部角", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  sk.setRotation("upperArmR", 0.7);
  sk.setRotation("foreArmR", -0.4);
  const solved = sk.solve();
  const u = solved.get("upperArmR");
  const f = solved.get("foreArmR");
  const expect = normAngle(u.worldAngle + sk.getBone("foreArmR").restAngle - 0.4);
  assert.ok(Math.abs(normAngle(f.worldAngle - expect)) < 1e-12);
  assert.ok(Math.abs(f.sx - u.ex) < 1e-12 && Math.abs(f.sy - u.ey) < 1e-12);
});

console.log("关节拖拽:");
test("拖子关节只改该骨角度，父骨长度与姿态保持不变", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  const solved0 = sk.solve();
  const parentBefore = { ...solved0.get("upperArmR") };
  const handle = { id: "end:foreArmR", boneId: "foreArmR" };
  const target = { x: 360, y: 90 };
  sk.dragTo(handle, target.x, target.y);
  const solved1 = sk.solve();
  const parentAfter = solved1.get("upperArmR");
  // 父骨完全不动
  assert.strictEqual(parentAfter.sx, parentBefore.sx);
  assert.strictEqual(parentAfter.sy, parentBefore.sy);
  assert.strictEqual(parentAfter.ex, parentBefore.ex);
  assert.strictEqual(parentAfter.ey, parentBefore.ey);
  // 前臂长度恒定，且末端指向鼠标方向
  const f = solved1.get("foreArmR");
  const len = Math.hypot(f.ex - f.sx, f.ey - f.sy);
  assert.ok(Math.abs(len - sk.getBone("foreArmR").length) < 1e-9);
  const aim = Math.atan2(target.y - f.sy, target.x - f.sx);
  assert.ok(Math.abs(normAngle(f.worldAngle - aim)) < 1e-9);
});

test("任何拖拽都不会拉伸任意骨", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  for (let k = 0; k < 20; k++) {
    sk.dragTo(
      { id: "end:foreArmR", boneId: "foreArmR" },
      120 + k * 17,
      80 + (k % 5) * 40
    );
    const solved = sk.solve();
    for (const id of sk.order) {
      const s = solved.get(id);
      const len = Math.hypot(s.ex - s.sx, s.ey - s.sy);
      assert.ok(Math.abs(len - sk.getBone(id).length) < 1e-9, id + " 被拉伸");
    }
  }
});

test("拖根手柄平移整具骨架而不改变角度", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  const pose0 = sk.pose();
  sk.dragTo({ id: "__root__", boneId: sk.rootId }, 100, 420);
  assert.strictEqual(sk.rootX, 100);
  assert.strictEqual(sk.rootY, 420);
  assert.deepStrictEqual(sk.pose(), pose0);
});

console.log("关键帧与循环:");
test("挥手动画首尾姿态完全一致(零跳变)", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  const track = new KeyframeTrack(sk.order);
  for (const f of defs.WAVE_KEYFRAMES) track.addFrame(f.time, f.pose);
  assert.strictEqual(track.maxLoopGap(), 0);
  // 循环边界两侧采样结果一致
  const pA = track.sample(0, true);
  const pB = track.sample(track.duration, true);
  for (const id of sk.order) {
    assert.ok(Math.abs(normAngle(pA[id] - pB[id])) < 1e-12);
  }
});

test("采样为关键帧精确值，中间帧落在两者之间", () => {
  const track = new KeyframeTrack(["a"]);
  track.addFrame(0, { a: 0 });
  track.addFrame(1, { a: 1 });
  assert.strictEqual(track.sample(0, false).a, 0);
  assert.strictEqual(track.sample(1, false).a, 1);
  assert.ok(Math.abs(track.sample(0.5, false).a - 0.5) < 1e-12);
});

test("最短弧插值正确跨越 ±PI 边界", () => {
  const track = new KeyframeTrack(["a"]);
  track.addFrame(0, { a: 3.0 });
  track.addFrame(1, { a: -3.0 });
  const mid = track.sample(0.5, false).a;
  assert.ok(Math.abs(mid - Math.PI) < 1e-9 || Math.abs(mid + Math.PI) < 1e-9);
});

console.log("保存与重新载入:");
test("skeleton.json / animation.json 可重新载入并复现姿态", () => {
  const skelPath = path.join(__dirname, "..", "data", "skeleton.json");
  const animPath = path.join(__dirname, "..", "data", "animation.json");
  const skelJSON = JSON.parse(fs.readFileSync(skelPath, "utf8"));
  const animJSON = JSON.parse(fs.readFileSync(animPath, "utf8"));
  const sk = Skeleton.fromJSON(skelJSON);
  const track = KeyframeTrack.fromJSON(animJSON, sk.order);
  assert.strictEqual(sk.order.length, 7);
  assert.strictEqual(track.frames.length, 5);

  // 用原始定义直接构建作为对照
  const ref = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  for (const t of [0, 0.25, 0.6, 1.1, 1.2]) {
    const pose = track.sample(t, true);
    sk.applyPose(pose);
    ref.applyPose(pose);
    const a = sk.solve();
    const b = ref.solve();
    for (const id of sk.order) {
      assert.ok(Math.abs(a.get(id).ex - b.get(id).ex) < 1e-10);
      assert.ok(Math.abs(a.get(id).ey - b.get(id).ey) < 1e-10);
    }
  }
});

test("未知/坏数据会被拒绝", () => {
  assert.throws(() => Skeleton.fromJSON({ root: { x: 0, y: 0 }, bones: [] }));
});

console.log("渲染与音频冒烟:");
test("渲染器在 mock 2d 上下文上完成整帧绘制", () => {
  const sk = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (t, prop) => {
        if (prop === "createLinearGradient") return () => ({ addColorStop() {} });
        return (...args) => calls.push([prop, args]);
      },
      set() {
        return true;
      },
    }
  );
  renderer.render(ctx, sk);
  assert.ok(calls.some((c) => c[0] === "arc"));
  assert.ok(calls.some((c) => c[0] === "lineTo"));
});

test("音频默认关闭，关闭时不产生振荡器", () => {
  const fx = new AudioFX();
  assert.strictEqual(fx.enabled, false);
  fx.playTick();
  assert.strictEqual(fx.ctx, null);
  fx.setEnabled(true);
  assert.strictEqual(fx.enabled, true); // Node 无 AudioContext，也不抛错
});

console.log("\n全部通过: " + passed + " 项测试");
