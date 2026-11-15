/**
 * Affine mapping between data coordinates and screen (pixel) coordinates.
 *
 *   screen = data * scale + translate
 *
 * Annotations store their anchor in data space, so zoom/pan only change
 * this transform and every anchor keeps pointing at the same data point.
 */
export class ViewTransform {
  constructor({ width = 800, height = 500, minScale = 0.2, maxScale = 40 } = {}) {
    this.width = width;
    this.height = height;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.scaleX = 1;
    this.scaleY = 1;
    this.tx = 0;
    this.ty = 0;
  }

  /** Fit the given data bounds inside the viewport with uniform padding. */
  fit(bounds, padding = 40) {
    const { minX, maxX, minY, maxY } = bounds;
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);
    const sx = (this.width - padding * 2) / spanX;
    const sy = (this.height - padding * 2) / spanY;
    const scale = Math.min(sx, sy);
    this.scaleX = scale;
    this.scaleY = scale;
    this.tx = padding - minX * scale + (this.width - padding * 2 - spanX * scale) / 2;
    this.ty = padding - minY * scale + (this.height - padding * 2 - spanY * scale) / 2;
    return this;
  }

  resize(width, height) {
    const center = this.toData([this.width / 2, this.height / 2]);
    this.width = width;
    this.height = height;
    const c = this.toScreen(center);
    this.pan(width / 2 - c[0], height / 2 - c[1]);
    return this;
  }

  toScreen([x, y]) {
    return [x * this.scaleX + this.tx, y * this.scaleY + this.ty];
  }

  toData([sx, sy]) {
    return [(sx - this.tx) / this.scaleX, (sy - this.ty) / this.scaleY];
  }

  /** Zoom while keeping the data point under `screenPoint` fixed on screen. */
  zoomAt(screenPoint, factor) {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scaleX * factor));
    const applied = next / this.scaleX;
    const [sx, sy] = screenPoint;
    this.tx = sx - (sx - this.tx) * applied;
    this.ty = sy - (sy - this.ty) * applied;
    this.scaleX = next;
    this.scaleY = next;
    return this;
  }

  pan(dxPixels, dyPixels) {
    this.tx += dxPixels;
    this.ty += dyPixels;
    return this;
  }

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      tx: this.tx,
      ty: this.ty,
    };
  }
}

export function dataBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}
