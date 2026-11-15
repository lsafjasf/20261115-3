export const WORLD = Object.freeze({ width: 1000, height: 700 });
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const toRadians = (degrees) => degrees * DEG;
export const toDegrees = (radians) => radians / DEG;

export function normalizeAngle(degrees) {
  return ((degrees % 360) + 360) % 360;
}

export function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function regularPolygon(cx, cy, radius, sides = 48, rotation = 0) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * TAU;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

export function roundedRectPolygon(cx, cy, width, height, radius, arcSteps = 5) {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  const corners = [
    { x: halfW - r, y: -halfH + r, start: -Math.PI / 2 },
    { x: halfW - r, y: halfH - r, start: 0 },
    { x: -halfW + r, y: halfH - r, start: Math.PI / 2 },
    { x: -halfW + r, y: -halfH + r, start: Math.PI },
  ];

  return corners.flatMap((corner) => {
    return Array.from({ length: arcSteps + 1 }, (_, index) => {
      const angle = corner.start + (index / arcSteps) * (Math.PI / 2);
      return [cx + corner.x + Math.cos(angle) * r, cy + corner.y + Math.sin(angle) * r];
    });
  });
}

export function rotatePolygon(points, cx, cy, degrees) {
  const angle = toRadians(degrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

export function translatePolygon(points, dx, dy) {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

export function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

export function polygonArea(points) {
  return points?.length >= 3 ? Math.abs(signedArea(points)) : 0;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function lineIntersection(a, b, c, d) {
  const rX = b[0] - a[0];
  const rY = b[1] - a[1];
  const sX = d[0] - c[0];
  const sY = d[1] - c[1];
  const denominator = cross(rX, rY, sX, sY);

  if (Math.abs(denominator) < 1e-9) {
    return b.slice();
  }

  const t = cross(c[0] - a[0], c[1] - a[1], sX, sY) / denominator;
  return [a[0] + rX * t, a[1] + rY * t];
}

export function clipPolygon(subject, clip) {
  if (!subject?.length || !clip?.length) return [];
  let output = subject.map((point) => point.slice());
  const orientation = signedArea(clip) >= 0 ? 1 : -1;

  for (let edgeIndex = 0; edgeIndex < clip.length; edgeIndex += 1) {
    const edgeStart = clip[edgeIndex];
    const edgeEnd = clip[(edgeIndex + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;

    const inside = (point) => {
      const edgeX = edgeEnd[0] - edgeStart[0];
      const edgeY = edgeEnd[1] - edgeStart[1];
      const pointX = point[0] - edgeStart[0];
      const pointY = point[1] - edgeStart[1];
      return cross(edgeX, edgeY, pointX, pointY) * orientation >= -1e-8;
    };

    let previous = input[input.length - 1];
    let previousInside = inside(previous);

    for (const current of input) {
      const currentInside = inside(current);
      if (currentInside) {
        if (!previousInside) {
          output.push(lineIntersection(previous, current, edgeStart, edgeEnd));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersection(previous, current, edgeStart, edgeEnd));
      }
      previous = current;
      previousInside = currentInside;
    }
  }

  return output;
}

/**
 * Beam footprint on the floor. The sector is approximated with short arc
 * segments so it can be reused as a convex clipping polygon.
 */
export function beamPolygon(light, arcSteps = 52) {
  const start = toRadians(light.angle - light.spread / 2);
  const end = toRadians(light.angle + light.spread / 2);
  const points = [[light.x, light.y]];

  for (let index = 0; index <= arcSteps; index += 1) {
    const angle = lerp(start, end, index / arcSteps);
    points.push([
      light.x + Math.cos(angle) * light.range,
      light.y + Math.sin(angle) * light.range,
    ]);
  }

  return points;
}

export function transformObjectPolygon(object) {
  const local = object.localPolygon ?? [];
  const scaled = local.map(([x, y]) => [x * (object.scale ?? 1), y * (object.scale ?? 1)]);
  return rotatePolygon(scaled, 0, 0, object.rotation ?? 0).map(([x, y]) => [
    x + object.x,
    y + object.y,
  ]);
}

export function objectRadius(object) {
  const points = transformObjectPolygon(object);
  return Math.max(...points.map(([x, y]) => Math.hypot(x - object.x, y - object.y)), 0);
}

export function litObjectPolygon(light, object) {
  if (!light.enabled) return [];
  const footprint = transformObjectPolygon(object);
  const clipped = clipPolygon(footprint, beamPolygon(light));
  return polygonArea(clipped) > 0.5 ? clipped : [];
}

export function shadowProjectionScale(light, object) {
  const lightHeight = light.height ?? 3.4;
  const objectHeight = object.height ?? 1;
  return 1 + objectHeight / Math.max(0.2, lightHeight - objectHeight);
}

export function castShadowPolygon(light, object) {
  const lit = litObjectPolygon(light, object);
  if (!lit.length) return null;

  const scale = shadowProjectionScale(light, object);
  const projected = lit.map(([x, y]) => [
    light.x + (x - light.x) * scale,
    light.y + (y - light.y) * scale,
  ]);
  const swept = convexHull([...lit, ...projected]);
  const clipped = clipPolygon(swept, beamPolygon(light));
  return polygonArea(clipped) > 0.5 ? clipped : null;
}

export function convexHull(points) {
  if (points.length < 3) return points.map((point) => point.slice());
  const sorted = points
    .map((point) => point.slice())
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const buildHalf = (source) => {
    const half = [];
    for (const point of source) {
      while (half.length >= 2) {
        const a = half[half.length - 2];
        const b = half[half.length - 1];
        if (cross(b[0] - a[0], b[1] - a[1], point[0] - b[0], point[1] - b[1]) > 1e-8) {
          break;
        }
        half.pop();
      }
      half.push(point);
    }
    half.pop();
    return half;
  };

  return [...buildHalf(sorted), ...buildHalf(sorted.reverse())];
}

export function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonIntersection(polyA, polyB) {
  if (!polyA?.length || !polyB?.length) return [];
  return clipPolygon(polyA, polyB);
}

export function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function distanceToSegment(point, start, end) {
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const wx = point[0] - start[0];
  const wy = point[1] - start[1];
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : clamp((wx * vx + wy * vy) / lengthSquared, 0, 1);
  return Math.hypot(point[0] - (start[0] + vx * t), point[1] - (start[1] + vy * t));
}

export function polygonBounds(polygon) {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
