/*
 * 默认资产：七段骨骼定义 + 五关键帧挥手循环。
 * 角度约定：0 指向 +x(右)，正角度顺时针(向下)；
 * 局部角 = 相对父骨方向的角度，restAngle 为静止姿态局部角。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DEFAULTS_NS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PI = Math.PI;

  const CANVAS = { width: 560, height: 560 };

  const BONE_DEFS = [
    {
      id: "pelvis",
      name: "骨盆(根骨)",
      parent: null,
      length: 30,
      restAngle: -PI / 2,
      color: "#e8603c",
      skin: { w0: 20, w1: 22 },
    },
    {
      id: "spine",
      name: "躯干",
      parent: "pelvis",
      length: 65,
      restAngle: 0,
      color: "#ff8a3d",
      skin: { w0: 22, w1: 26 },
    },
    {
      id: "head",
      name: "头部",
      parent: "spine",
      length: 32,
      restAngle: 0,
      color: "#ffd23d",
      skin: { radius: 18 },
    },
    {
      id: "upperArmL",
      name: "左上臂",
      parent: "spine",
      length: 58,
      restAngle: 2.69,
      color: "#4fa3ff",
      skin: { w0: 11, w1: 9 },
    },
    {
      id: "foreArmL",
      name: "左前臂",
      parent: "upperArmL",
      length: 52,
      restAngle: 0.35,
      color: "#7cc0ff",
      skin: { w0: 9, w1: 7 },
    },
    {
      id: "upperArmR",
      name: "右上臂(挥手)",
      parent: "spine",
      length: 58,
      restAngle: -2.69,
      color: "#35c46a",
      skin: { w0: 11, w1: 9 },
    },
    {
      id: "foreArmR",
      name: "右前臂(摆动)",
      parent: "upperArmR",
      length: 52,
      restAngle: -0.35,
      color: "#7fe0a3",
      skin: { w0: 9, w1: 7 },
    },
  ];

  const ROOT = { x: 280, y: 330 };

  function basePose(over) {
    const pose = {
      pelvis: 0,
      spine: 0,
      head: 0,
      upperArmL: 0,
      foreArmL: 0,
      upperArmR: -2.85, // 右臂从下垂举到头部右侧上方(略向外，避免遮头)
      foreArmR: -0.25,
    };
    return Object.assign(pose, over || {});
  }

  // 第 0 帧与最后一帧姿态完全一致，保证循环首尾连续。
  const WAVE_KEYFRAMES = [
    { time: 0.0, pose: basePose() },
    {
      time: 0.3,
      pose: basePose({ pelvis: 0.02, spine: 0.03, head: -0.08, foreArmR: 0.35 }),
    },
    {
      time: 0.6,
      pose: basePose({ pelvis: -0.02, spine: -0.02, head: 0.06, foreArmR: -0.55 }),
    },
    {
      time: 0.9,
      pose: basePose({ pelvis: 0.02, spine: 0.03, head: -0.08, foreArmR: 0.35 }),
    },
    { time: 1.2, pose: basePose() },
  ];

  const DURATION = 1.2;

  return { CANVAS, BONE_DEFS, ROOT, WAVE_KEYFRAMES, DURATION, basePose };
});
