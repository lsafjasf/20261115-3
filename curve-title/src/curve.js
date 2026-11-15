// Curve model: cubic Bezier with arc-length parameterization.
// Pure module (no DOM) so it can be unit-tested in Node.

export function cubicBezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export class ArcLengthCurve {
  // points: array of {x, y} sampled densely along the curve.
  constructor(points) {
    if (points.length < 2) throw new Error('need at least 2 points');
    this.points = points;
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(dx, dy));
    }
    this.length = this.cumulative[this.cumulative.length - 1];
  }

  static fromBezier(p0, p1, p2, p3, samples = 720) {
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      pts.push(cubicBezierPoint(p0, p1, p2, p3, i / samples));
    }
    return new ArcLengthCurve(pts);
  }

  // Offset every sample along its normal by `dist` (positive = left of travel).
  offset(dist, samples = 720) {
    const pts = this.points.map((p, i) => {
      const t = this._tangentAtIndex(i);
      return { x: p.x - t.y * dist, y: p.y + t.x * dist };
    });
    return new ArcLengthCurve(pts);
  }

  _indexAtLength(s) {
    const c = this.cumulative;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(1, lo);
  }

  _tangentAtIndex(i) {
    const pts = this.points;
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  }

  // Position + tangent at arc length s. `smooth` = arc-length window used to
  // average the tangent (protects glyphs from raw kinks at sharp bends).
  at(s, smooth = 0) {
    const clamped = Math.max(0, Math.min(this.length, s));
    const i = this._indexAtLength(clamped);
    const c = this.cumulative;
    const seg = c[i] - c[i - 1] || 1;
    const t = (clamped - c[i - 1]) / seg;
    const p0 = this.points[i - 1];
    const p1 = this.points[i];
    const pos = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };

    let tangent;
    if (smooth > 0) {
      const a = this.at(clamped - smooth / 2, 0);
      const b = this.at(clamped + smooth / 2, 0);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      tangent = len > 1e-6
        ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
        : a.tangent;
    } else {
      tangent = this._tangentAtIndex(i);
    }
    return { x: pos.x, y: pos.y, tx: tangent.x, ty: tangent.y };
  }
}

// Preset curves as Bezier control points for a canvas of `width` x `height`.
// `strength` in [0, 1] morphs between a flat baseline and the full shape.
export function presetControls(kind, width, height, strength) {
  const y0 = height * 0.5;
  const flat = [
    { x: 0, y: y0 },
    { x: width / 3, y: y0 },
    { x: (2 * width) / 3, y: y0 },
    { x: width, y: y0 },
  ];
  const amp = height * 0.38 * strength;
  let shaped;
  switch (kind) {
    case 'arc':
      shaped = [
        { x: 0, y: y0 },
        { x: width / 3, y: y0 - amp },
        { x: (2 * width) / 3, y: y0 - amp },
        { x: width, y: y0 },
      ];
      break;
    case 'wave':
      shaped = [
        { x: 0, y: y0 },
        { x: width * 0.25, y: y0 - amp },
        { x: width * 0.75, y: y0 + amp },
        { x: width, y: y0 },
      ];
      break;
    case 'hook': // sharp bend: runs flat then hooks down hard
      shaped = [
        { x: 0, y: y0 - amp * 0.4 },
        { x: width * 0.55, y: y0 - amp * 0.4 },
        { x: width * 0.72, y: y0 + amp * 1.1 },
        { x: width, y: y0 + amp * 0.55 },
      ];
      break;
    default:
      shaped = flat;
  }
  return flat.map((f, i) => ({
    x: f.x + (shaped[i].x - f.x),
    y: f.y + (shaped[i].y - f.y),
  }));
}
