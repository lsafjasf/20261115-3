// Geometry helpers. Every rounded shape in the set is produced from the same
// corner-radius parameter so the whole family stays visually consistent.

export function clampRadius(r, w, h) {
  return Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
}

// Rounded rectangle as a single path (so radius works in every renderer).
export function roundRect(x, y, w, h, r) {
  const radius = clampRadius(r, w, h);
  const x2 = x + w;
  const y2 = y + h;
  if (radius === 0) {
    return `M${x} ${y}H${x2}V${y2}H${x}Z`;
  }
  return [
    `M${x + radius} ${y}`,
    `H${x2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2} ${y + radius}`,
    `V${y2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}`,
    `H${x + radius}`,
    `A${radius} ${radius} 0 0 1 ${x} ${y2 - radius}`,
    `V${y + radius}`,
    `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    "Z",
  ].join("");
}

// Rounded polygon: every vertex gets an arc of radius r (r = 0 => sharp polygon).
export function roundPoly(points, r) {
  const n = points.length;
  if (!r) return "M" + points.map((p) => `${p[0]} ${p[1]}`).join("L") + "Z";
  const d = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    const [px, py] = points[(i - 1 + n) % n];
    const [nx, ny] = points[(i + 1) % n];
    const v1Len = Math.hypot(x - px, y - py);
    const v2Len = Math.hypot(nx - x, ny - y);
    const rr = Math.min(r, v1Len / 2, v2Len / 2);
    const s = [x + ((px - x) / v1Len) * rr, y + ((py - y) / v1Len) * rr];
    const e = [x + ((nx - x) / v2Len) * rr, y + ((ny - y) / v2Len) * rr];
    if (i === 0) d.push(`M${s[0].toFixed(2)} ${s[1].toFixed(2)}`);
    else d.push(`L${s[0].toFixed(2)} ${s[1].toFixed(2)}`);
    d.push(
      `Q${x} ${y} ${e[0].toFixed(2)} ${e[1].toFixed(2)}`,
    );
  }
  return d.join("") + "Z";
}

// Partial arc (circle outline with a gap), used for the refresh icon.
export function arcPath(cx, cy, radius, startDeg, endDeg) {
  const polar = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const [sx, sy] = polar(startDeg);
  const [ex, ey] = polar(endDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M${sx.toFixed(2)} ${sy.toFixed(2)} A${radius} ${radius} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}
