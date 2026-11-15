import { getChildren, getValues } from "./model.js";

const RAD = Math.PI / 180;

function localMatrix(values) {
  const matrix = new DOMMatrix();
  matrix.translateSelf(values.x, values.y);
  matrix.rotateSelf(values.rotation || 0);
  matrix.scaleSelf(values.scaleX || 0.0001, values.scaleY || 0.0001);
  return matrix;
}

export function getWorldMatrices(project, time) {
  const matrices = new Map();
  const roots = project.objects.filter((object) => !object.parentId);
  const visit = (object, parentMatrix) => {
    if (!object.visible || time < object.start || time > object.end) return;
    const values = getValues(object, time);
    const matrix = parentMatrix.multiply(localMatrix(values));
    matrices.set(object.id, { object, matrix, values });
    for (const child of getChildren(project, object.id)) visit(child, matrix);
  };
  for (const root of roots) visit(root, new DOMMatrix());
  return matrices;
}

function activeAt(object, time) {
  return object.visible && time >= object.start && time <= object.end;
}

function paintFor(ctx, object, width, height) {
  const style = object.style || {};
  if (style.gradient && Array.isArray(style.gradient.colors) && style.gradient.colors.length > 1) {
    const gradient = ctx.createLinearGradient(0, -height / 2, width, height / 2);
    style.gradient.colors.forEach((color, index) => {
      gradient.addColorStop(index / (style.gradient.colors.length - 1), color);
    });
    return gradient;
  }
  return style.fill || "transparent";
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(Math.max(Number(radius) || 0, 0), width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawText(ctx, object) {
  const style = object.style || {};
  const width = Number(style.width) || 300;
  const height = Number(style.height) || 80;
  const fontSize = Number(style.fontSize) || 48;
  const weight = style.fontWeight || 700;
  const lines = String(style.text ?? object.name).split("\n");
  ctx.fillStyle = paintFor(ctx, object, width, height);
  ctx.font = `${weight} ${fontSize}px "Noto Sans SC UI", "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textAlign = style.align === "left" ? "left" : style.align === "right" ? "right" : "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${Number(style.letterSpacing) || 1.5}px`;
  const x = ctx.textAlign === "left" ? -width / 2 : ctx.textAlign === "right" ? width / 2 : 0;
  const lineHeight = fontSize * 1.12;
  const startY = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => ctx.fillText(line, x, startY + index * lineHeight));
  if (style.stroke && style.stroke !== "transparent" && Number(style.strokeWidth) > 0) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = Number(style.strokeWidth);
    lines.forEach((line, index) => ctx.strokeText(line, x, startY + index * lineHeight));
  }
}

function drawShape(ctx, object) {
  const style = object.style || {};
  const width = Math.max(1, Number(style.width) || 100);
  const height = Math.max(1, Number(style.height) || 100);
  if (object.type === "text") {
    drawText(ctx, object);
    return;
  }
  ctx.save();
  if (style.stroke && style.stroke !== "transparent" && Number(style.strokeWidth) > 0) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = Number(style.strokeWidth);
    if (style.dash) ctx.setLineDash(style.dash);
  }
  if (object.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else {
    roundedRect(ctx, -width / 2, -height / 2, width, height, style.radius);
  }
  const fill = paintFor(ctx, object, width, height);
  if (fill !== "transparent" && fill !== "none") ctx.fillStyle = fill;
  if (fill !== "transparent" && fill !== "none") ctx.fill();
  if (style.stroke && style.stroke !== "transparent" && Number(style.strokeWidth) > 0) ctx.stroke();
  ctx.restore();
}

function drawObject(ctx, project, object, time) {
  if (!activeAt(object, time)) return;
  const values = getValues(object, time);
  ctx.save();
  ctx.translate(values.x, values.y);
  ctx.rotate(values.rotation * RAD);
  ctx.scale(values.scaleX, values.scaleY);
  const styleAlpha = Number(object.style?.opacity);
  ctx.globalAlpha *= values.opacity * (Number.isFinite(styleAlpha) ? styleAlpha : 1);
  if (object.type !== "group") drawShape(ctx, object);
  for (const child of getChildren(project, object.id)) drawObject(ctx, project, child, time);
  ctx.restore();
}

export function beatInfo(time, interval, offset = 0) {
  const safeInterval = Math.max(0.05, Number(interval) || 0.5);
  const shifted = time - offset;
  if (shifted < 0) {
    return { index: -1, phase: 1, pulse: 0, beat: 0 };
  }
  const index = Math.floor(shifted / safeInterval);
  const phase = (shifted % safeInterval) / safeInterval;
  return {
    index,
    phase,
    pulse: Math.max(0, 1 - phase * 4.5),
    beat: index % 4
  };
}

function drawBackground(ctx, project, time) {
  const width = project.width;
  const height = project.height;
  const beat = beatInfo(time, project.audio.beatInterval, project.audio.offset);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, project.background || "#0a0f1d");
  gradient.addColorStop(0.58, "#0b1120");
  gradient.addColorStop(1, "#070a14");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, height * 0.52, 0, width / 2, height * 0.52, width * 0.5);
  glow.addColorStop(0, `rgba(46, 78, 128, ${0.13 + beat.pulse * 0.045})`);
  glow.addColorStop(0.55, "rgba(21, 34, 61, 0.06)");
  glow.addColorStop(1, "rgba(5, 8, 17, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(126, 155, 197, 0.055)";
  ctx.lineWidth = 1;
  for (let x = 64; x < width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 64; y < height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBeatWash(ctx, project, time) {
  const beat = beatInfo(time, project.audio.beatInterval, project.audio.offset);
  if (beat.pulse <= 0) return;
  const gradient = ctx.createRadialGradient(
    project.width * 0.5,
    project.height * 0.52,
    project.width * 0.13,
    project.width * 0.5,
    project.height * 0.52,
    project.width * 0.62
  );
  gradient.addColorStop(0, "rgba(255,107,122,0)");
  gradient.addColorStop(0.95, `rgba(255,107,122,${beat.pulse * 0.035})`);
  gradient.addColorStop(1, "rgba(255,107,122,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, project.width, project.height);
}

export function renderScene(canvas, project, time, options = {}) {
  if (!canvas) return;
  if (canvas.width !== project.width || canvas.height !== project.height) {
    canvas.width = project.width;
    canvas.height = project.height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  drawBackground(ctx, project, time);
  for (const object of project.objects) {
    if (!object.parentId) drawObject(ctx, project, object, time);
  }
  drawBeatWash(ctx, project, time);
  if (options.selectedId) drawSelection(ctx, project, options.selectedId, time);
}

function worldBounds(project, objectId, matrices) {
  const entries = [];
  for (const [id, item] of matrices) {
    if (id === objectId || isInside(project, id, objectId)) entries.push(item);
  }
  const points = [];
  for (const item of entries) {
    if (item.object.type === "group") {
      points.push(item.matrix.transformPoint(new DOMPoint(0, 0)));
      continue;
    }
    const width = Number(item.object.style?.width) || 100;
    const height = Number(item.object.style?.height) || 100;
    for (const [x, y] of [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]) {
      points.push(item.matrix.transformPoint(new DOMPoint(x, y)));
    }
  }
  if (!points.length) return null;
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y))
  };
}

function isInside(project, objectId, ancestorId) {
  let current = project.objects.find((object) => object.id === objectId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = project.objects.find((object) => object.id === current.parentId);
  }
  return false;
}

function drawSelection(ctx, project, objectId, time) {
  const matrices = getWorldMatrices(project, time);
  if (!matrices.has(objectId)) return;
  const bounds = worldBounds(project, objectId, matrices);
  if (!bounds) return;
  const pad = 7;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 107, 122, 0.9)";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(bounds.left - pad, bounds.top - pad, bounds.right - bounds.left + pad * 2, bounds.bottom - bounds.top + pad * 2);
  ctx.setLineDash([]);
  const handles = [
    [bounds.left - pad, bounds.top - pad],
    [bounds.right + pad, bounds.top - pad],
    [bounds.right + pad, bounds.bottom + pad],
    [bounds.left - pad, bounds.bottom + pad]
  ];
  ctx.fillStyle = "#ff8c96";
  for (const [x, y] of handles) {
    ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
  }
  ctx.restore();
}

export function hitTest(project, time, x, y, selectedId = null) {
  const matrices = getWorldMatrices(project, time);
  const ids = [...matrices.keys()].sort((a, b) => {
    if (a === selectedId) return -1;
    if (b === selectedId) return 1;
    return project.objects.findIndex((object) => object.id === a) - project.objects.findIndex((object) => object.id === b);
  });
  for (const id of ids.reverse()) {
    const item = matrices.get(id);
    if (item.object.type === "group" || item.object.locked) continue;
    const inverse = item.matrix.inverse();
    const point = inverse.transformPoint(new DOMPoint(x, y));
    const width = Math.max(1, Number(item.object.style?.width) || 100);
    const height = Math.max(1, Number(item.object.style?.height) || 100);
    if (Math.abs(point.x) <= width / 2 && Math.abs(point.y) <= height / 2) return item.object;
  }
  return null;
}

export function parentLocalDelta(project, objectId, time, worldDeltaX, worldDeltaY) {
  const object = project.objects.find((item) => item.id === objectId);
  if (!object?.parentId) return { x: worldDeltaX, y: worldDeltaY };
  const matrices = getWorldMatrices(project, time);
  const parent = matrices.get(object.parentId);
  if (!parent) return { x: worldDeltaX, y: worldDeltaY };
  const inverse = parent.matrix.inverse();
  const origin = inverse.transformPoint(new DOMPoint(0, 0));
  const delta = inverse.transformPoint(new DOMPoint(worldDeltaX, worldDeltaY));
  return { x: delta.x - origin.x, y: delta.y - origin.y };
}
