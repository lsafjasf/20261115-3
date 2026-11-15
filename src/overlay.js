// Draws screen-space overlays: annotation labels, scale bar, north arrow.
import { getLabelRect, screenAnchor } from './labels.js';
import { computeScaleBar, formatMeters } from './controls.js';

export function renderOverlay(ctx, labels, view) {
  for (const label of labels) {
    drawLeader(ctx, label, view);
    drawLabel(ctx, label, view);
  }
  drawScaleBar(ctx, view);
  drawNorthArrow(ctx, view);
}

function drawLeader(ctx, label, view) {
  if (Math.hypot(label.offsetX, label.offsetY) < 40) return;
  const anchor = screenAnchor(label, view);
  const rect = getLabelRect(label, view);
  ctx.strokeStyle = '#7a7f86';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLabel(ctx, label, view) {
  const rect = getLabelRect(label, view);
  ctx.fillStyle = label.pinned ? '#fff4d6' : '#ffffff';
  ctx.strokeStyle = label.pinned ? '#c98a16' : '#5b6068';
  ctx.lineWidth = label.pinned ? 2 : 1;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#23262b';
  ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.name, rect.x + 14, rect.y + rect.h / 2 + 1);

  if (label.pinned) {
    ctx.fillStyle = '#c98a16';
    ctx.beginPath();
    ctx.arc(rect.x + rect.w - 10, rect.y + rect.h / 2, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScaleBar(ctx, view) {
  const bar = computeScaleBar(view);
  const x = 24;
  const y = view.height - 34;
  ctx.strokeStyle = '#23262b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + bar.px, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x + bar.px / 2, y);
  ctx.lineTo(x + bar.px / 2, y + 4);
  ctx.moveTo(x + bar.px, y - 5);
  ctx.lineTo(x + bar.px, y + 5);
  ctx.stroke();

  ctx.fillStyle = '#23262b';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(formatMeters(bar.meters), x, y - 9);
}

function drawNorthArrow(ctx, view) {
  const cx = view.width - 44;
  const cy = 60;
  const radius = 20;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = '#5b6068';
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#d94f4f';
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx - 7, cy + 6);
  ctx.lineTo(cx, cy + 1);
  ctx.lineTo(cx + 7, cy + 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#23262b';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - radius - 11);
}

function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
