const MIN_DIMENSION = 1;

export function normalizeDpr(value) {
  const dpr = Number(value);
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function getViewportMetrics(rect, devicePixelRatio) {
  const dpr = normalizeDpr(devicePixelRatio);
  const cssWidth = Math.max(0, Number(rect?.width) || 0);
  const cssHeight = Math.max(0, Number(rect?.height) || 0);
  const backingWidth = Math.max(
    MIN_DIMENSION,
    Math.round(cssWidth * dpr),
  );
  const backingHeight = Math.max(
    MIN_DIMENSION,
    Math.round(cssHeight * dpr),
  );

  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    cssWidth,
    cssHeight,
    dpr,
    backingWidth,
    backingHeight,
    renderWidth: backingWidth / dpr,
    renderHeight: backingHeight / dpr,
  };
}

export function clientToCanvasPoint(clientX, clientY, metrics) {
  const scaleX = metrics.cssWidth > 0
    ? metrics.backingWidth / metrics.cssWidth
    : 0;
  const scaleY = metrics.cssHeight > 0
    ? metrics.backingHeight / metrics.cssHeight
    : 0;

  return {
    x: ((clientX - metrics.left) * scaleX) / metrics.dpr,
    y: ((clientY - metrics.top) * scaleY) / metrics.dpr,
  };
}

export function canvasToClientPoint(x, y, metrics) {
  const scaleX = metrics.backingWidth > 0
    ? metrics.cssWidth / metrics.backingWidth
    : 0;
  const scaleY = metrics.backingHeight > 0
    ? metrics.cssHeight / metrics.backingHeight
    : 0;

  return {
    clientX: metrics.left + x * metrics.dpr * scaleX,
    clientY: metrics.top + y * metrics.dpr * scaleY,
  };
}

export function syncCanvasBackingStore(canvas, metrics) {
  const changed = canvas.width !== metrics.backingWidth
    || canvas.height !== metrics.backingHeight;

  if (changed) {
    canvas.width = metrics.backingWidth;
    canvas.height = metrics.backingHeight;
  }

  return changed;
}
