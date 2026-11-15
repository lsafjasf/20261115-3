import { dataBounds } from './viewTransform.js';

/**
 * Draw the current chart + annotation layout onto a 2D canvas.
 * scale > 1 produces a high-resolution raster; geometry stays in CSS pixels.
 */
export function drawToCanvas(series, layoutResult, view, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(view.width * scale);
  canvas.height = Math.round(view.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  drawScene(ctx, series, layoutResult, view);
  return canvas;
}

export function exportPng(series, layoutResult, view, { scale = 3, filename = 'chart.png' } = {}) {
  const canvas = drawToCanvas(series, layoutResult, view, scale);
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { width: canvas.width, height: canvas.height, filename };
}

export function drawScene(ctx, series, layoutResult, view) {
  const bounds = dataBounds(series);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.strokeStyle = '#e3e7ee';
  ctx.lineWidth = 1;
  for (let x = Math.ceil(bounds.minX); x <= Math.floor(bounds.maxX); x += 1) {
    const [sx] = view.toScreen([x, 0]);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, view.height);
    ctx.stroke();
  }
  for (let y = Math.ceil(bounds.minY); y <= Math.floor(bounds.maxY); y += 5) {
    const [, sy] = view.toScreen([0, y]);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(view.width, sy);
    ctx.stroke();
  }

  const points = series.map((p) => view.toScreen(p));
  ctx.strokeStyle = '#0969da';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  ctx.fillStyle = '#0969da';
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const item of layoutResult.items) {
    const color = item.color ?? '#1f6feb';
    if (item.type === 'region' && item.regionRect) {
      const r = item.regionRect;
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    } else {
      const [sx, sy] = item.connectorStart;
      const [ax, ay] = item.anchorScreen;
      if (Math.hypot(ax - sx, ay - sy) >= 4) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        if (item.type === 'arrow') drawArrowHead(ctx, item.anchorScreen, item.connectorStart, 9, color);
        else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(ax, ay, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    drawLabel(ctx, item);
  }
}

function drawArrowHead(ctx, tip, from, size, color) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] + size * Math.cos(angle + Math.PI - 0.45), tip[1] + size * Math.sin(angle + Math.PI - 0.45));
  ctx.lineTo(tip[0] + size * Math.cos(angle + Math.PI + 0.45), tip[1] + size * Math.sin(angle + Math.PI + 0.45));
  ctx.closePath();
  ctx.fill();
}

function drawLabel(ctx, item) {
  const r = item.labelRect;
  const color = item.color ?? '#1f6feb';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  roundRect(ctx, r.x, r.y, r.w, r.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "600 12px 'Noto Sans SC', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.text, r.x + r.w / 2, r.y + r.h / 2 + 1);
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
