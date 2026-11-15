// 纯几何核心：形状生成、等弧长重采样、顶点自动匹配、关键帧插值与安全性检查。
// 同时供浏览器编辑器 (ES module) 与 Node 无头管线使用。

export const VB = 400;
export const CENTER = { x: 200, y: 200 };

export const easeFns = {
  linear: (u) => u,
  inOutQuad: (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2),
  inOutCubic: (u) =>
    u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2,
  inOutSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  inOutQuint: (u) =>
    u < 0.5 ? 16 * u ** 5 : 1 - ((-2 * u + 2) ** 5) / 2,
};

export const easeBezier = {
  linear: "0 0 1 1",
  inOutQuad: "0.45 0 0.55 1",
  inOutCubic: "0.65 0 0.35 1",
  inOutSine: "0.37 0 0.63 1",
  inOutQuint: "0.83 0 0.17 1",
};

export function circlePoints(radius = 130, n = 64) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    pts.push({ x: CENTER.x + radius * Math.cos(a), y: CENTER.y + radius * Math.sin(a) });
  }
  return pts;
}

export function starPoints(outer = 150, inner = 62, arms = 5) {
  const pts = [];
  for (let k = 0; k < arms * 2; k++) {
    const r = k % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (Math.PI * k) / arms;
    pts.push({ x: CENTER.x + r * Math.cos(a), y: CENTER.y + r * Math.sin(a) });
  }
  return pts;
}

export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

// 统一为正向（shoelace 面积为正），保证两个形状环绕方向一致，杜绝突然翻转。
export function ensurePositiveWinding(pts) {
  const out = pts.map((p) => ({ ...p }));
  if (signedArea(out) < 0) out.reverse();
  return out;
}

export function perimeter(pts) {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    len += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return len;
}

// 等弧长重采样：输出恰好 n 个顶点，起点保持为原多边形起点。
export function resampleArc(pts, n) {
  const total = perimeter(pts);
  const targets = Array.from({ length: n }, (_, k) => (k * total) / n);
  const out = [];
  let seg = 0;
  let acc = 0;
  for (const target of targets) {
    while (seg < pts.length - 1) {
      const p = pts[seg];
      const q = pts[(seg + 1) % pts.length];
      const segLen = Math.hypot(q.x - p.x, q.y - p.y);
      if (acc + segLen >= target - 1e-9) break;
      acc += segLen;
      seg++;
    }
    const p = pts[seg];
    const q = pts[(seg + 1) % pts.length];
    const segLen = Math.hypot(q.x - p.x, q.y - p.y) || 1e-12;
    const t = (target - acc) / segLen;
    out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  }
  return out;
}

function shiftEnergy(a, b, shift) {
  const n = a.length;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const p = a[i];
    const q = b[(i + shift) % n];
    e += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
  }
  return e;
}

// 顶点数不一致时的自动匹配：等弧长重采样到相同数量后，
// 枚举循环位移取最小整体位移能量，避免扭转/翻转对应。
export function autoMatch(srcPts, dstPts, n = 160) {
  const a = resampleArc(ensurePositiveWinding(srcPts), n);
  const bRaw = resampleArc(ensurePositiveWinding(dstPts), n);
  let best = 0;
  let bestEnergy = Infinity;
  for (let s = 0; s < n; s++) {
    const e = shiftEnergy(a, bRaw, s);
    if (e < bestEnergy) {
      bestEnergy = e;
      best = s;
    }
  }
  const b = bRaw.map((_, i) => ({ ...bRaw[(i + best) % n] }));
  const naiveEnergy = shiftEnergy(a, bRaw, 0);
  return {
    a,
    b,
    shift: best,
    energy: bestEnergy / n,
    naiveEnergy: naiveEnergy / n,
  };
}

export function lerpPt(p, q, t) {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

// 关键帧序列：[{ t, points, easing }]，easing 表示到下一帧的缓动。
export function frameAt(keyframes, t) {
  if (t <= keyframes[0].t) return keyframes[0].points.map((p) => ({ ...p }));
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.points.map((p) => ({ ...p }));
  let k = 0;
  while (k < keyframes.length - 1 && keyframes[k + 1].t <= t) k++;
  const k0 = keyframes[k];
  const k1 = keyframes[k + 1];
  const u = (t - k0.t) / (k1.t - k0.t);
  const v = easeFns[k1.easing || k0.easing || "linear"](u);
  return k0.points.map((p, i) => lerpPt(p, k1.points[i], v));
}

export function pointsToPath(pts) {
  const f = (v) => Math.round(v * 100) / 100;
  return (
    "M " +
    pts.map((p) => `${f(p.x)} ${f(p.y)}`).join(" L ") +
    " Z"
  );
}
