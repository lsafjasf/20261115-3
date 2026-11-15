/**
 * Screen-space annotation layout with priority-based collision avoidance.
 *
 * Anchors are always projected from data coordinates by the current
 * ViewTransform. Collision resolution only moves label boxes; it never moves
 * an anchor, so an arrow tip can never be redirected to another point.
 */

export const DEFAULT_LABEL = { width: 96, height: 30 };

function overlap(a, b, pad = 0) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Candidate label top-left positions on expanding rings around an anchor. */
function* candidatePositions(anchor, box) {
  const cx = anchor[0] - box.w / 2;
  const cy = anchor[1] - box.h / 2;
  yield { x: cx, y: cy - box.h * 1.4 };
  const radii = [box.h, box.h * 2, box.h * 3.2, box.h * 4.6, box.h * 6.2];
  const dirs = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];
  for (const r of radii) {
    for (const [dx, dy] of dirs) {
      yield { x: cx + dx * r, y: cy + dy * r };
    }
  }
};

function overlapsAny(rect, obstacles, pad) {
  return obstacles.some((o) => overlap(rect, o, pad));
}

function overlapArea(a, b) {
  const aw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ah = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return aw > 0 && ah > 0 ? aw * ah : 0;
}

/** Closest point on a rectangle border to `point` — where a connector attaches. */
export function edgePoint(rect, point) {
  const ex = clamp(point[0], rect.x, rect.x + rect.w);
  const ey = clamp(point[1], rect.y, rect.y + rect.h);
  return [ex, ey];
}

/**
 * @param {Array} annotations  text/arrow/region annotations with data anchors
 * @param {ViewTransform} view current data->screen transform
 * @param {object} options {labelWidth, labelHeight, padding}
 */
export function layoutAnnotations(annotations, view, options = {}) {
  const pad = options.padding ?? 6;
  const fixedObstacles = [];
  const prepared = [];

  for (const ann of annotations) {
    const base = {
      id: ann.id,
      type: ann.type,
      priority: ann.priority ?? 0,
      anchor: ann.anchor,
      anchorScreen: view.toScreen(ann.anchor),
      text: ann.text ?? '',
      box: {
        w: ann.labelWidth ?? DEFAULT_LABEL.width,
        h: ann.labelHeight ?? DEFAULT_LABEL.height,
      },
    };
    if (ann.type === 'region') {
    const [x0, y0] = view.toScreen([ann.rect.x, ann.rect.y]);
    const [x1, y1] = view.toScreen([
      ann.rect.x + ann.rect.w,
      ann.rect.y + ann.rect.h,
    ]);
      base.regionRect = {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      };
      fixedObstacles.push(base.regionRect);
    }
    prepared.push(base);
  }

  // Higher priority claims space first; ties resolve by id for determinism.
  const ordered = [...prepared].sort((a, b) =>
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  );
  const placed = [];
  let moves = 0;

  for (const item of ordered) {
    const obstacles = [...fixedObstacles, ...placed.map((p) => p.labelRect)];
    const start = preferredRect(item, view);
    let chosen = null;
    if (!overlapsAny(start, obstacles, pad) && inside(start, view)) {
      chosen = start;
    } else {
      for (const pos of candidatePositions(item.anchorScreen, item.box)) {
        const rect = { x: pos.x, y: pos.y, w: item.box.w, h: item.box.h };
        if (!overlapsAny(rect, obstacles, pad) && inside(rect, view)) {
          chosen = rect;
          break;
        }
      }
      if (!chosen) chosen = leastOverlap(start, item, obstacles, view);
      moves += 1;
    }
    item.labelRect = chosen;
    item.connectorStart = edgePoint(chosen, item.anchorScreen);
    placed.push(item);
  }

  return {
    items: prepared.map((item) => ({
      id: item.id,
      type: item.type,
      priority: item.priority,
      text: item.text,
      anchor: item.anchor,
      anchorScreen: item.anchorScreen,
      labelRect: item.labelRect,
      connectorStart: item.connectorStart,
      regionRect: item.regionRect ?? null,
    })),
    collisionMoves: moves,
  };
}

function inside(rect, view) {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= view.width &&
    rect.y + rect.h <= view.height
  );
}

function preferredRect(item, view) {
  const [ax, ay] = item.anchorScreen;
  if (item.type === 'region' && item.regionRect) {
    return {
      x: clamp(item.regionRect.x, 0, view.width - item.box.w),
      y: clamp(item.regionRect.y - item.box.h - 8, 0, view.height - item.box.h),
      w: item.box.w,
      h: item.box.h,
    };
  }
  return { x: ax + 14, y: ay - item.box.h - 10, w: item.box.w, h: item.box.h };
}

function leastOverlap(start, item, obstacles, view) {
  let best = start;
  let bestScore = Infinity;
  for (const pos of candidatePositions(item.anchorScreen, item.box)) {
    const rect = { x: pos.x, y: pos.y, w: item.box.w, h: item.box.h };
    const score =
      obstacles.reduce((sum, o) => sum + overlapArea(rect, o), 0) +
      offscreenPenalty(rect, view);
    if (score < bestScore) {
      bestScore = score;
      best = rect;
    }
  }
  return best;
}

function offscreenPenalty(rect, view) {
  const dx = Math.max(0, -rect.x, rect.x + rect.w - view.width);
  const dy = Math.max(0, -rect.y, rect.y + rect.h - view.height);
  return (dx + dy) * 1000;
}
