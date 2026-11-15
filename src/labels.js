// Annotation model and overlap-avoidance layout.
//
// Every label stores an immutable world-space anchor. Its screen box is
// recomputed from the current view on each layout pass. Unpinned labels may be
// displaced by the declutter routine; pinned labels keep their offset forever
// and act as immovable obstacles for the remaining labels.
import { rectsOverlap, worldToScreen, labelRect } from './geometry.js';

const LABEL_HEIGHT = 22;
const CHAR_WIDTH = 13;
const PADDING_X = 14;
const MARGIN = 8;
const MAX_OFFSET = 260;
const SPIRAL_STEP = 6;

export function createLabels(pois) {
  return pois.map((poi, index) => ({
    id: poi.id,
    name: poi.name,
    anchor: { x: poi.x, y: poi.y },
    width: measureText(poi.name) + PADDING_X * 2,
    height: LABEL_HEIGHT,
    offsetX: 0,
    offsetY: -28 - (index % 2) * 18,
    pinned: false,
  }));
}

export function measureText(text) {
  // Each CJK glyph occupies one em; ASCII characters are roughly half-width.
  let width = 0;
  for (const ch of text) {
    width += ch.charCodeAt(0) > 255 ? CHAR_WIDTH : CHAR_WIDTH * 0.58;
  }
  return width;
}

export function screenAnchor(label, view) {
  return worldToScreen(label.anchor.x, label.anchor.y, view);
}

export function getLabelRect(label, view) {
  const anchor = screenAnchor(label, view);
  return labelRect(anchor, label);
}

// Recompute screen positions after pan/zoom. World anchors never move; only
// unpinned labels get new displacement offsets to resolve overlaps.
export function layoutLabels(labels, view) {
  const placed = [];

  // Pinned labels first: their offsets are frozen and cannot be changed.
  for (const label of labels.filter((item) => item.pinned)) {
    placed.push(label);
  }

  for (const label of labels.filter((item) => !item.pinned)) {
    const candidate = { ...label, offsetX: 0, offsetY: -28 };
    const freeOffset = findFreeOffset(candidate, view, placed);
    label.offsetX = freeOffset.x;
    label.offsetY = freeOffset.y;
    placed.push(label);
  }
  return labels;
}

function findFreeOffset(label, view, placed) {
  let fallback = { x: label.offsetX, y: label.offsetY };
  for (let radius = 0; radius <= MAX_OFFSET; radius += SPIRAL_STEP) {
    for (const [dx, dy] of spiralRing(radius)) {
      const candidate = { ...label, offsetX: dx, offsetY: dy };
      const rect = getLabelRect(candidate, view);
      const onScreen = insideViewport(rect, view);
      const collisionFree = placed.every(
        (other) => !rectsOverlap(rect, getLabelRect(other, view)),
      );
      if (onScreen && collisionFree) {
        return { x: dx, y: dy };
      }
      if (collisionFree && radius === MAX_OFFSET) fallback = { x: dx, y: dy };
    }
  }
  return fallback;
}

// Expanding square ring of candidate offsets, starting at the anchor.
function* spiralRing(radius) {
  if (radius === 0) {
    yield [0, -28];
    return;
  }
  const step = SPIRAL_STEP;
  for (let dx = -radius; dx <= radius; dx += step) {
    yield [dx, -28 - radius];
    yield [dx, -28 + radius];
  }
  for (let dy = -radius + step; dy < radius; dy += step) {
    yield [-radius, -28 + dy];
    yield [radius, -28 + dy];
  }
}

function insideViewport(rect, view) {
  return (
    rect.x >= MARGIN &&
    rect.y >= MARGIN &&
    rect.x + rect.w <= view.width - MARGIN &&
    rect.y + rect.h <= view.height - MARGIN
  );
}

export function labelAtPoint(labels, view, x, y) {
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const rect = getLabelRect(labels[i], view);
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      return labels[i];
    }
  }
  return null;
}

export function togglePin(label) {
  label.pinned = !label.pinned;
  return label.pinned;
}
