/*
 * Canvas 渲染：先画皮肤轮廓(头/躯干/四肢)，再叠加骨骼与关节手柄。
 * 纯函数式，接收 2d 上下文，便于在 Node 中用 mock context 做冒烟测试。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./skeleton.js"));
  } else {
    root.RENDER_NS = factory(root.SKELETON_NS);
  }
})(typeof self !== "undefined" ? self : this, function (skel) {
  "use strict";

  function roundedLimb(ctx, x1, y1, x2, y2, w1, w2) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    ctx.beginPath();
    ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
    ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
    ctx.arc(x2, y2, w2, ang + Math.PI / 2, ang - Math.PI / 2);
    ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
    ctx.arc(x1, y1, w1, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawSkin(ctx, skeleton, solved) {
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;

    // 先画后侧的左臂，再画躯干，最后画挥动的右臂，形成简单前后层次
    const drawArm = (upperId, foreId, color) => {
      const u = solved.get(upperId);
      const f = solved.get(foreId);
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(40,40,60,0.55)";
      roundedLimb(ctx, u.sx, u.sy, u.ex, u.ey, 11, 9);
      roundedLimb(ctx, f.sx, f.sy, f.ex, f.ey, 9, 7);
      ctx.beginPath();
      ctx.arc(f.ex, f.ey, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    if (skeleton.bones.has("upperArmL")) {
      drawArm("upperArmL", "foreArmL", "#ffd9b0");
    }

    const pelvis = solved.get("pelvis") || solved.get("spine");
    const spine = solved.get("spine");
    const head = solved.get("head");
    ctx.fillStyle = "#7fb3ff";
    ctx.strokeStyle = "rgba(30,50,90,0.6)";
    if (solved.get("pelvis")) {
      ctx.fillStyle = "#5b8bd8";
      roundedLimb(ctx, pelvis.sx, pelvis.sy, pelvis.ex, pelvis.ey, 20, 22);
      ctx.fillStyle = "#7fb3ff";
    }
    roundedLimb(ctx, spine.sx, spine.sy, spine.ex, spine.ey, 22, 26);

    // 骨盆
    ctx.fillStyle = "#5b8bd8";
    ctx.beginPath();
    ctx.arc(pelvis.sx, pelvis.sy, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 头部
    ctx.fillStyle = "#ffe2c2";
    ctx.beginPath();
    ctx.arc(head.ex, head.ey, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 朝右的眼睛，随头方向
    const look = head.worldAngle;
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(head.ex + Math.cos(look) * 7 - 3, head.ey + Math.sin(look) * 7 - 2, 2.2, 0, Math.PI * 2);
    ctx.arc(head.ex + Math.cos(look) * 7 + 5, head.ey + Math.sin(look) * 7 - 2, 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (skeleton.bones.has("upperArmR")) {
      drawArm("upperArmR", "foreArmR", "#ffd9b0");
    }
  }

  function drawSkeleton(ctx, skeleton, solved, opts) {
    opts = opts || {};
    for (const id of skeleton.order) {
      const s = solved.get(id);
      const bone = skeleton.getBone(id);
      ctx.strokeStyle = bone.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy);
      ctx.lineTo(s.ex, s.ey);
      ctx.stroke();
    }
    // 关节
    for (const h of skeleton.handles(solved)) {
      const selected = opts.selected && opts.selected.id === h.id;
      ctx.beginPath();
      ctx.arc(h.x, h.y, selected ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "#ff5d5d" : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = selected ? "#a01818" : "#2b4f7a";
      ctx.stroke();
    }
  }

  function render(ctx, skeleton, opts) {
    opts = opts || {};
    const solved = skeleton.solve();
    if (!opts.skinOnly) drawSkin(ctx, skeleton, solved);
    if (!opts.bonesHidden) drawSkeleton(ctx, skeleton, solved, opts);
    return solved;
  }

  return { render, drawSkin, drawSkeleton, roundedLimb };
});
