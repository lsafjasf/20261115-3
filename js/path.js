// Closed-loop curved path built from user-drawn control points.
// A closed Catmull-Rom spline is re-parameterized by arc length so that
// playback speed is constant and the u=0/1 seam stays continuous.

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export class LoopPath {
  constructor(controlPoints, { subSegments = 96 } = {}) {
    if (!Array.isArray(controlPoints) || controlPoints.length < 3) {
      throw new Error("LoopPath needs at least 3 control points");
    }
    this.points = controlPoints.map((p) => ({ x: p.x, y: p.y }));
    this.subSegments = subSegments;
    this._buildTable();
  }

  _buildTable() {
    const pts = this.points;
    const n = pts.length;
    const at = (i) => pts[((i % n) + n) % n];
    const table = [];
    for (let i = 0; i < n; i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      for (let k = 0; k < this.subSegments; k++) {
        table.push(catmull(p0, p1, p2, p3, k / this.subSegments));
      }
    }
    // Explicit closing sample: the final spline span ends exactly on the
    // first control point, so the loop closes with no seam gap.
    table.push(catmull(at(n - 2), at(n - 1), at(0), at(1), 1));
    const cum = [0];
    for (let i = 1; i < table.length; i++) {
      const dx = table[i].x - table[i - 1].x;
      const dy = table[i].y - table[i - 1].y;
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    this._table = table;
    this._cum = cum;
    this.length = cum[cum.length - 1];
  }

  static wrap(u) {
    return ((u % 1) + 1) % 1;
  }

  _locate(u) {
    let target = LoopPath.wrap(u) * this.length;
    // Floating-point rounding can land a value just under this.length; treat
    // it as the seam (distance 0) rather than a zero-length final span.
    if (this.length - target < 1e-9 * this.length) target = 0;
    const cum = this._cum;
    // Last index whose cumulative distance does not exceed target, so the
    // target always falls inside [cum[lo], cum[lo+1]) with frac in [0, 1).
    let lo = 0;
    let hi = cum.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    lo = Math.max(0, lo - 1);
    if (lo >= cum.length - 1) {
      // Wrapping span from the closing sample back to the first sample.
      return { lo: cum.length - 1, next: 0, frac: 0 };
    }
    const span = cum[lo + 1] - cum[lo] || 1;
    return { lo, next: lo + 1, frac: (target - cum[lo]) / span };
  }

  pointAt(u) {
    const { lo, next, frac } = this._locate(u);
    const a = this._table[lo];
    const b = this._table[next];
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  // Raw unit tangent at u. Continuous by construction (closed spline).
  headingAt(u) {
    const step = 0.5 / (this._cum.length - 1);
    const a = this.pointAt(u - step);
    const b = this.pointAt(u + step);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }
}
