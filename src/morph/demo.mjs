// 圆形 → 星形演示关键帧。
// mid 关键帧模拟“用户编辑中间路径”：在 0.5 时刻把顶点向外推出一个
// 与星形同相位的微弱波纹，让过渡更有呼吸感，同时保持不打卷。
import {
  circlePoints,
  starPoints,
  autoMatch,
  lerpPt,
  frameAt,
} from "./core.mjs";

export function buildDemoKeyframes(options = {}) {
  const n = options.n ?? 160;
  const midEaseIn = options.easeIn ?? "inOutCubic";
  const midEaseOut = options.easeOut ?? "inOutSine";
  const midRipple = options.midRipple ?? 14;
  const midT = options.midT ?? 0.5;

  const match = autoMatch(circlePoints(130, 64), starPoints(150, 62, 5), n);

  // 由目标星形半径方向得到 5 瓣波纹相位，作用在中间帧顶点上。
  const mid = match.a.map((p, i) => {
    const base = lerpPt(match.a[i], match.b[i], midT);
    const dx = p.x - 200;
    const dy = p.y - 200;
    const theta = Math.atan2(dy, dx);
    const wave = Math.cos(5 * (theta + Math.PI / 2));
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: base.x + (dx / len) * midRipple * wave,
      y: base.y + (dy / len) * midRipple * wave,
    };
  });

  const keyframes = [
    { t: 0, points: match.a, easing: midEaseIn },
    { t: midT, points: mid, easing: midEaseOut },
    { t: 1, points: match.b },
  ];

  return { keyframes, match };
}

// 往返（ping-pong）帧序列：用于无缝循环，末帧姿态等于首帧。
export function buildLoopFrames(keyframes, samplesPerLeg = 60) {
  const forward = [];
  for (let i = 0; i <= samplesPerLeg; i++) {
    forward.push(frameAt(keyframes, i / samplesPerLeg));
  }
  const back = [];
  for (let i = samplesPerLeg - 1; i >= 1; i--) {
    back.push(frameAt(keyframes, i / samplesPerLeg));
  }
  return [...forward, ...back];
}
