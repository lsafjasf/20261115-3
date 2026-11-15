// Pure geometry and coordinate-transform helpers shared by rendering and layout.

export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// World (meters) -> viewport (CSS pixels).
export function worldToScreen(wx, wy, view) {
  return {
    x: (wx - view.center.x) * view.scale + view.width / 2,
    y: (wy - view.center.y) * view.scale + view.height / 2,
  };
}

// Viewport (CSS pixels) -> world (meters).
export function screenToWorld(sx, sy, view) {
  return {
    x: (sx - view.width / 2) / view.scale + view.center.x,
    y: (sy - view.height / 2) / view.scale + view.center.y,
  };
}

// Zoom around an anchored screen point, keeping the world point under the
// cursor stationary after the scale change.
export function zoomAt(view, factor, anchorX, anchorY) {
  const before = screenToWorld(anchorX, anchorY, view);
  const next = { ...view, scale: clamp(view.scale * factor, 0.2, 8) };
  const after = screenToWorld(anchorX, anchorY, next);
  next.center = {
    x: view.center.x + (before.x - after.x),
    y: view.center.y + (before.y - after.y),
  };
  return next;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Axis-aligned bounding box of a screen-space label plus its displacement.
export function labelRect(anchorScreen, label) {
  return {
    x: anchorScreen.x + label.offsetX - label.width / 2,
    y: anchorScreen.y + label.offsetY - label.height / 2,
    w: label.width,
    h: label.height,
  };
}
