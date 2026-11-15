// 形变安全性检查：自交、环绕方向翻转、极角扭转、关键帧/循环首尾姿态。
import { signedArea, CENTER } from "./core.mjs";

function segIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false;
  const u =
    ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v =
    ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return u > 1e-7 && u < 1 - 1e-7 && v > 1e-7 && v < 1 - 1e-7;
}

// O(n^2) 边-边相交检查，相邻边（含闭合边）不计。
export function findSelfIntersections(pts) {
  const n = pts.length;
  const hits = [];
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const p3 = pts[j];
      const p4 = pts[(j + 1) % n];
      if (segIntersect(p1, p2, p3, p4)) {
        hits.push({ edgeA: i, edgeB: j });
      }
    }
  }
  return hits;
}

export function orientationSign(pts) {
  return Math.sign(signedArea(pts));
}

// 相对画布中心的极角（连续、未展开）。
export function polarAngles(pts) {
  return pts.map((p) => Math.atan2(p.y - CENTER.y, p.x - CENTER.x));
}

// 顶点相对中心的极角应保持严格单调（允许微小容差），
// 非单调意味着个别点绕中心“打卷”，是自交/翻转的前兆。
export function angleMonotonic(pts) {
  const a = polarAngles(pts);
  const n = a.length;
  let minStep = Infinity;
  for (let i = 0; i < n; i++) {
    let step = a[(i + 1) % n] - a[i];
    if (step <= -Math.PI) step += 2 * Math.PI;
    if (step > Math.PI) step -= 2 * Math.PI;
    minStep = Math.min(minStep, step);
  }
  return { ok: minStep > -1e-6, minStep };
}

export function maxDeviation(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  }
  return max;
}

// 对整段动画逐帧体检。
export function auditFrames(frames) {
  const report = {
    frameCount: frames.length,
    selfIntersections: [],
    orientationFlips: [],
    angleViolations: [],
    areaMin: Infinity,
  };
  const baseSign = orientationSign(frames[0]);
  frames.forEach((pts, i) => {
    const hits = findSelfIntersections(pts);
    if (hits.length) report.selfIntersections.push({ frame: i, hits });
    if (orientationSign(pts) !== baseSign || signedArea(pts) <= 0) {
      report.orientationFlips.push({ frame: i, area: signedArea(pts) });
    }
    const mono = angleMonotonic(pts);
    if (!mono.ok) report.angleViolations.push({ frame: i, minStep: mono.minStep });
    report.areaMin = Math.min(report.areaMin, Math.abs(signedArea(pts)));
  });
  report.ok =
    report.selfIntersections.length === 0 &&
    report.orientationFlips.length === 0 &&
    report.angleViolations.length === 0;
  return report;
}

// 循环首尾姿态检查：往返动画结束帧必须回到起始姿态（容差单位：SVG 用户单位 px）。
export function loopClosure(first, last, tolerance = 0.5) {
  const max = maxDeviation(first, last);
  return {
    maxDeviationPx: Math.round(max * 1000) / 1000,
    tolerancePx: tolerance,
    ok: max <= tolerance,
  };
}

// 周期采样视频的无缝循环判据：末帧→首帧（环绕）的步长，
// 不应大于序列内部相邻帧的典型步长（中位数的 1.5 倍）。
export function periodicBoundary(frames) {
  const steps = [];
  for (let i = 0; i < frames.length; i++) {
    steps.push(maxDeviation(frames[i], frames[(i + 1) % frames.length]));
  }
  const wrap = steps[steps.length - 1];
  const interior = steps.slice(0, -1).sort((a, b) => a - b);
  const median = interior[Math.floor(interior.length / 2)];
  const maxInterior = interior[interior.length - 1];
  return {
    wrapStepPx: Math.round(wrap * 1000) / 1000,
    medianStepPx: Math.round(median * 1000) / 1000,
    maxInteriorStepPx: Math.round(maxInterior * 1000) / 1000,
    ok: wrap <= median * 1.5,
  };
}
