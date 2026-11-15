/*
 * 关键帧动画：按时间对每根骨的局部旋转做最短弧插值；
 * 播放时首尾环绕(loop)，保证挥手循环首尾姿态连续。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./skeleton.js"));
  } else {
    root.ANIM_NS = factory(root.SKELETON_NS);
  }
})(typeof self !== "undefined" ? self : this, function (skel) {
  "use strict";

  const { normAngle, lerpAngle, lerp } = skel;

  class KeyframeTrack {
    constructor(boneOrder) {
      this.boneOrder = boneOrder.slice();
      this.frames = []; // { time, pose: { boneId: angle } }
      this.duration = 1.2; // 秒
    }

    addFrame(time, pose) {
      const frame = { time: Math.max(0, time), pose: Object.assign({}, pose) };
      const i = this.frames.findIndex((f) => f.time >= frame.time);
      if (i >= 0 && this.frames[i].time === frame.time) {
        this.frames[i].pose = frame.pose; // 覆盖同一时刻
      } else if (i >= 0) {
        this.frames.splice(i, 0, frame);
      } else {
        this.frames.push(frame);
      }
      if (this.frames.length) {
        this.duration = Math.max(this.duration, this.frames[this.frames.length - 1].time);
      }
      return frame;
    }

    removeFrameAt(time, eps) {
      eps = eps == null ? 1e-6 : eps;
      const i = this.frames.findIndex((f) => Math.abs(f.time - time) <= eps);
      if (i >= 0) this.frames.splice(i, 1);
    }

    // 取 t 秒处姿态；loop=true 时时间按 duration 取模并在末帧->首帧间环绕
    sample(t, loop) {
      if (!this.frames.length) return {};
      let time = t;
      const dur = this.duration || 1;
      if (loop) time = ((t % dur) + dur) % dur;
      else time = Math.min(Math.max(t, 0), dur);

      let a = this.frames[0];
      let b = this.frames[this.frames.length - 1];
      for (let i = 0; i < this.frames.length - 1; i++) {
        if (time >= this.frames[i].time && time <= this.frames[i + 1].time) {
          a = this.frames[i];
          b = this.frames[i + 1];
          break;
        }
      }

      const span = b.time - a.time;
      const k = span > 1e-9 ? (time - a.time) / span : 0;
      const pose = {};
      for (const id of this.boneOrder) {
        const va = a.pose[id] == null ? 0 : a.pose[id];
        const vb = b.pose[id] == null ? 0 : b.pose[id];
        pose[id] = normAngle(lerpAngle(va, vb, k));
      }
      return pose;
    }

    // 首尾姿态连续性诊断：返回每根骨从末帧环绕回首帧的角度跳变(弧度)
    loopGap() {
      const gaps = {};
      if (this.frames.length < 2) return gaps;
      const first = this.frames[0].pose;
      const last = this.frames[this.frames.length - 1].pose;
      for (const id of this.boneOrder) {
        gaps[id] = Math.abs(normAngle((last[id] || 0) - (first[id] || 0)));
      }
      return gaps;
    }

    maxLoopGap() {
      const gaps = this.loopGap();
      return Math.max(0, ...Object.keys(gaps).map((k) => gaps[k]));
    }

    toJSON() {
      return {
        format: "animation/v1",
        duration: this.duration,
        frames: this.frames.map((f) => ({ time: f.time, pose: f.pose })),
      };
    }

    static fromJSON(json, boneOrder) {
      const track = new KeyframeTrack(boneOrder);
      track.duration = json.duration;
      track.frames = json.frames
        .map((f) => ({ time: f.time, pose: Object.assign({}, f.pose) }))
        .sort((p, q) => p.time - q.time);
      return track;
    }
  }

  return { KeyframeTrack, normAngle, lerp, lerpAngle };
});
