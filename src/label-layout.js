import {
  WORLD,
  landAt,
  lineSegments,
  coastlineSegments,
  borderSegments,
  waterSegments,
} from "./map-data.js";

export const LABEL_FONT_SIZE = 13;
export const LABEL_HEIGHT = 28;
export const LABEL_PADDING_X = 12;
export const LABEL_LINE_PADDING = 3;

export const CANDIDATE_DIRECTIONS = [
  { key: "N", vector: [0, -1], label: "北" },
  { key: "NE", vector: [1, -1], label: "东北" },
  { key: "E", vector: [1, 0], label: "东" },
  { key: "SE", vector: [1, 1], label: "东南" },
  { key: "S", vector: [0, 1], label: "南" },
  { key: "SW", vector: [-1, 1], label: "西南" },
  { key: "W", vector: [-1, 0], label: "西" },
  { key: "NW", vector: [-1, -1], label: "西北" },
];

const CANDIDATE_PRIORITY = ["E", "W", "NE", "NW", "SE", "SW", "N", "S"];
const LABEL_GAP = 19;
const LABEL_MARGIN = 4;

export function labelFont(city, selected = false) {
  return `${selected ? 700 : 600} ${LABEL_FONT_SIZE}px "Noto Sans SC", sans-serif`;
}

export function measureCityLabel(ctx, city, selected = false) {
  ctx.save();
  ctx.font = labelFont(city, selected);
  const textWidth = Math.ceil(ctx.measureText(city.name).width);
  ctx.restore();
  return {
    width: Math.max(48, textWidth + LABEL_PADDING_X * 2 + 15),
    height: LABEL_HEIGHT,
    textWidth,
  };
}

export function screenToWorld(point, view) {
  return {
    x: (point.x - view.panX) / view.scale,
    y: (point.y - view.panY) / view.scale,
  };
}

export function worldToScreen(point, view) {
  return {
    x: point.x * view.scale + view.panX,
    y: point.y * view.scale + view.panY,
  };
}

export function rectFromCenter(cx, cy, width, height) {
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    cx,
    cy,
    right: cx + width / 2,
    bottom: cy + height / 2,
  };
}

export function candidateOffset(direction, metrics) {
  const [vx, vy] = direction.vector;
  const horizontal = vx === 0 ? 0 : metrics.width / 2 + LABEL_GAP + LABEL_MARGIN;
  const vertical = vy === 0 ? 0 : metrics.height / 2 + LABEL_GAP;
  return {
    x: vx * (vx === 0 ? 0 : horizontal),
    y: vy * (vy === 0 ? 0 : vertical),
  };
}

export function buildCandidateBoxes(city, anchor, metrics) {
  return CANDIDATE_DIRECTIONS.map((direction, slot) => {
    const offset = candidateOffset(direction, metrics);
    const cx = anchor.x + offset.x;
    const cy = anchor.y + offset.y;
    return {
      slot,
      direction,
      offset,
      box: rectFromCenter(cx, cy, metrics.width, metrics.height),
    };
  });
}

function rectsOverlap(a, b, padding = 0) {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointInsideRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const ccw = (p, q, r) => (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x);
  return (
    ccw(a1, b1, b2) !== ccw(a2, b1, b2) &&
    ccw(a1, a2, b1) !== ccw(a1, a2, b2)
  );
}

function segmentTouchesRect(start, end, rect) {
  if (pointInsideRect(start, rect) || pointInsideRect(end, rect)) return true;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.right, y: rect.y },
    { x: rect.right, y: rect.bottom },
    { x: rect.x, y: rect.bottom },
  ];
  for (let index = 0; index < 4; index += 1) {
    if (segmentsIntersect(start, end, corners[index], corners[(index + 1) % 4])) {
      return true;
    }
  }
  return false;
}

function segmentNearRect(start, end, rect, buffer) {
  const expanded = {
    x: rect.x - buffer,
    y: rect.y - buffer,
    width: rect.width + buffer * 2,
    height: rect.height + buffer * 2,
    right: rect.x + rect.width + buffer,
    bottom: rect.y + rect.height + buffer,
  };
  if (segmentTouchesRect(start, end, expanded)) return true;
  const corners = [
    { x: expanded.x, y: expanded.y },
    { x: expanded.right, y: expanded.y },
    { x: expanded.right, y: expanded.bottom },
    { x: expanded.x, y: expanded.bottom },
  ];
  return corners.some((corner) => pointSegmentDistance(corner, start, end) < buffer);
}

function worldRectFromScreen(rect, view) {
  const topLeft = screenToWorld({ x: rect.x, y: rect.y }, view);
  const bottomRight = screenToWorld({ x: rect.right, y: rect.bottom }, view);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
    cx: topLeft.x + (bottomRight.x - topLeft.x) / 2,
    cy: topLeft.y + (bottomRight.y - topLeft.y) / 2,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

function sameLandSamples(rect, land) {
  const insetX = Math.min(5, rect.width * 0.1);
  const insetY = Math.min(3, rect.height * 0.1);
  const samples = [
    { x: rect.x + insetX, y: rect.y + insetY },
    { x: rect.cx, y: rect.y + insetY },
    { x: rect.right - insetX, y: rect.y + insetY },
    { x: rect.x + insetX, y: rect.cy },
    { x: rect.cx, y: rect.cy },
    { x: rect.right - insetX, y: rect.cy },
    { x: rect.x + insetX, y: rect.bottom - insetY },
    { x: rect.cx, y: rect.bottom - insetY },
    { x: rect.right - insetX, y: rect.bottom - insetY },
  ];
  return samples.every((sample) => {
    const sampleLand = landAt(sample);
    return sampleLand?.id === land.id;
  });
}

function lineCrossingReason(worldRect, view) {
  const pad = LABEL_LINE_PADDING / view.scale;
  const checks = [
    { segments: coastlineSegments, reason: "压到海岸线" },
    { segments: borderSegments, reason: "压到行政边界" },
    { segments: waterSegments, reason: "压到水系" },
  ];
  for (const check of checks) {
    for (const [start, end] of check.segments) {
      if (
        Math.min(start.x, end.x) > worldRect.right + pad ||
        Math.max(start.x, end.x) < worldRect.x - pad ||
        Math.min(start.y, end.y) > worldRect.bottom + pad ||
        Math.max(start.y, end.y) < worldRect.y - pad
      ) {
        continue;
      }
      if (segmentNearRect(start, end, worldRect, pad)) return check.reason;
    }
  }
  return null;
}

export function evaluateBox({
  box,
  city,
  land,
  view,
  labels = [],
  ignoreCityId = null,
  checkViewport = true,
}) {
  if (checkViewport) {
    if (
      box.x < 10 ||
      box.y < 10 ||
      box.right > view.width - 10 ||
      box.bottom > view.height - 10
    ) {
      return { valid: false, reason: "越出视口" };
    }
  }

  const worldRect = worldRectFromScreen(box, view);
  if (!land || !sameLandSamples(worldRect, land)) {
    return { valid: false, reason: "跨入水体" };
  }

  const crossing = lineCrossingReason(worldRect, view);
  if (crossing) return { valid: false, reason: crossing };

  for (const other of labels) {
    if (other.cityId === city.id || other.cityId === ignoreCityId) continue;
    if (rectsOverlap(box, other.box, 5)) {
      return { valid: false, reason: `与「${other.name}」重叠`, blockedBy: other.cityId };
    }
    const anchorBox = rectFromCenter(other.anchor.x, other.anchor.y, 15, 15);
    if (rectsOverlap(box, anchorBox, 2)) {
      return { valid: false, reason: `靠近「${other.name}」城市点`, blockedBy: other.cityId };
    }
  }
  return { valid: true, reason: "可用" };
}

function candidateScore(candidate, city) {
  let score = CANDIDATE_PRIORITY.indexOf(candidate.direction.key) * 10;
  if (city.rank === 1 && candidate.direction.key === "E") score -= 8;
  if (city.kind === "port" && ["W", "N", "S"].includes(candidate.direction.key)) score -= 2;
  return score;
}

export function evaluateCandidates({
  city,
  anchor,
  metrics,
  view,
  land,
  labels,
  ignoreCityId = null,
}) {
  return buildCandidateBoxes(city, anchor, metrics)
    .map((candidate) => ({
      ...candidate,
      ...evaluateBox({
        box: candidate.box,
        city,
        land,
        view,
        labels,
        ignoreCityId,
      }),
      score: candidateScore(candidate, city),
    }))
    .sort((a, b) => {
      if (a.valid !== b.valid) return a.valid ? -1 : 1;
      return a.score - b.score;
    });
}

export function labelFromBox(city, box, view, extra = {}) {
  const center = screenToWorld({ x: box.cx, y: box.cy }, view);
  return {
    cityId: city.id,
    name: city.name,
    box,
    anchor: { x: 0, y: 0 },
    worldX: center.x,
    worldY: center.y,
    valid: true,
    hidden: false,
    ...extra,
  };
}

export function layoutLabels({
  ctx,
  cities,
  view,
  pinnedWorld = {},
  selectedId = null,
  manualSlots = {},
}) {
  const metrics = new Map(cities.map((city) => [city.id, measureCityLabel(ctx, city)]));
  const anchorById = new Map(
    cities.map((city) => [
      city.id,
      worldToScreen({ x: city.x, y: city.y }, view),
    ]),
  );
  const landById = new Map(cities.map((city) => [city.id, landAt({ x: city.x, y: city.y })]));
  const labels = [];

  for (const city of cities) {
    const pinned = pinnedWorld[city.id];
    if (!pinned) continue;
    const center = worldToScreen({ x: pinned.x, y: pinned.y }, view);
    const metric = metrics.get(city.id);
    const box = rectFromCenter(center.x, center.y, metric.width, metric.height);
    labels.push(
      labelFromBox(city, box, view, {
        pinned: true,
        slot: pinned.slot ?? null,
        anchor: anchorById.get(city.id),
      }),
    );
  }

  const unordered = cities
    .filter((city) => !pinnedWorld[city.id])
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  for (const city of unordered) {
    const anchor = anchorById.get(city.id);
    const land = landById.get(city.id);
    const metric = metrics.get(city.id);
    const manualSlot = manualSlots[city.id];
    const candidates = evaluateCandidates({
      city,
      anchor,
      metrics: metric,
      view,
      land,
      labels,
    });
    let chosen = null;
    if (Number.isInteger(manualSlot)) {
      const manual = candidates.find((candidate) => candidate.slot === manualSlot);
      if (manual?.valid) chosen = manual;
    }
    chosen ??= candidates.find((candidate) => candidate.valid);

    if (chosen) {
      labels.push(
        labelFromBox(city, chosen.box, view, {
          pinned: false,
          slot: chosen.slot,
          anchor,
        }),
      );
    } else {
      labels.push({
        cityId: city.id,
        name: city.name,
        box: rectFromCenter(anchor.x, anchor.y, metric.width, metric.height),
        anchor,
        worldX: city.x,
        worldY: city.y,
        pinned: false,
        slot: null,
        valid: false,
        hidden: true,
      });
    }
  }

  const selectedCity = cities.find((city) => city.id === selectedId) ?? null;
  let selectedCandidates = [];
  if (selectedCity) {
    selectedCandidates = evaluateCandidates({
      city: selectedCity,
      anchor: anchorById.get(selectedCity.id),
      metrics: metrics.get(selectedCity.id),
      view,
      land: landById.get(selectedCity.id),
      labels,
      ignoreCityId: selectedCity.id,
    });
  }

  return {
    labels,
    metrics,
    candidates: selectedCandidates,
    selectedCity,
    anchorById,
  };
}

export function checkLabelCollisions(labels) {
  const visible = labels.filter((label) => !label.hidden);
  const pairs = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      if (rectsOverlap(visible[i].box, visible[j].box, 0)) {
        pairs.push([visible[i].cityId, visible[j].cityId]);
      }
    }
  }
  return pairs;
}

export function verifyLabelGeometry(labels, view) {
  return labels
    .filter((label) => !label.hidden)
    .map((label) => {
      const anchorWorld = screenToWorld(label.anchor, view);
      const land = landAt(anchorWorld);
      const result = evaluateBox({
        box: label.box,
        city: { id: label.cityId, name: label.name },
        land,
        view,
        labels: [],
        checkViewport: false,
      });
      return {
        cityId: label.cityId,
        name: label.name,
        landId: land?.id ?? null,
        valid: result.valid,
        reason: result.reason,
      };
    });
}

export function getReadabilityStats() {
  let landSamples = 0;
  let waterSamples = 0;
  let lineSamples = 0;
  const columns = 56;
  const rows = 34;
  for (let y = 1; y < rows; y += 1) {
    for (let x = 1; x < columns; x += 1) {
      const point = {
        x: (x / columns) * WORLD.width,
        y: (y / rows) * WORLD.height,
      };
      if (!landAt(point)) {
        waterSamples += 1;
        continue;
      }
      landSamples += 1;
      const nearCoast = coastlineSegments.some(
        ([start, end]) => pointSegmentDistance(point, start, end) < 17,
      );
      const nearBorder = borderSegments.some(
        ([start, end]) => pointSegmentDistance(point, start, end) < 14,
      );
      if (nearCoast || nearBorder) lineSamples += 1;
    }
  }
  const total = landSamples + waterSamples;
  return {
    built: lineSamples,
    water: waterSamples,
    line: lineSamples,
    land: landSamples,
    unreadableRatio: (waterSamples + lineSamples) / total,
  };
}

export function segmentsForLand(land) {
  return lineSegments(land.points, true);
}
