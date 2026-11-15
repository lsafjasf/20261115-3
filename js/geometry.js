// 纯几何工具：编辑器与 Node 验证脚本共用，不依赖 DOM。

export const STAGE = { width: 960, height: 640 };

// 主标题安全区（舞台坐标，单位 px）
export const SAFE_ZONE = { x: 180, y: 36, width: 600, height: 120 };

const DEG = Math.PI / 180;

// 图层裁切窗口（未旋转时）以 (x, y) 为中心，尺寸为 crop * scale。
export function windowSize(layer) {
  const s = layer.scale;
  return { w: layer.crop.w * s, h: layer.crop.h * s };
}

// 旋转后裁切窗口的四个角点（舞台坐标）。
export function rotatedCorners(layer) {
  const { w, h } = windowSize(layer);
  const a = layer.rotation * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  return pts.map((p) => ({
    x: layer.x + p.x * cos - p.y * sin,
    y: layer.y + p.x * sin + p.y * cos,
  }));
}

function project(points, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = p.x * axis.x + p.y * axis.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// 旋转矩形（角点）与轴对齐矩形是否相交（分离轴定理）。
export function rotatedRectIntersectsRect(corners, rect) {
  const rectPts = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const len = Math.hypot(ex, ey) || 1;
    axes.push({ x: -ey / len, y: ex / len });
  }
  for (const axis of axes) {
    const a = project(corners, axis);
    const b = project(rectPts, axis);
    if (a.max < b.min || b.max < a.min) return false;
  }
  return true;
}

// 返回与标题安全区相交的图层 id 列表（layers 需含 id）。
export function findSafeZoneViolations(layers, zone = SAFE_ZONE) {
  const hits = [];
  for (const layer of layers) {
    if (layer.visible === false) continue;
    if (rotatedRectIntersectsRect(rotatedCorners(layer), zone)) hits.push(layer.id);
  }
  return hits;
}
