import { NUMERIC_PROPS } from './model.js';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function ease(t, mode) {
  if (mode === 'step') return 0;
  if (mode === 'ease-in') return t * t;
  if (mode === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (mode === 'ease-in-out') return (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  return t;
}

// Resolve a layer's effective params at a time from base + keyframes.
export function resolveParams(layer, time) {
  const params = { ...layer.base };
  const frames = [...layer.keyframes].sort((a, b) => a.time - b.time);
  if (!frames.length) return params;
  const first = frames[0];
  for (const key of Object.keys(first.props)) params[key] = first.props[key];
  if (time <= frames[0].time) return { ...params, ...frames[0].props };
  const last = frames[frames.length - 1];
  if (time >= last.time) return { ...params, ...last.props };
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i];
    const b = frames[i + 1];
    if (time < a.time || time > b.time) continue;
    const span = b.time - a.time || 1;
    const raw = (time - a.time) / span;
    const t = ease(raw, b.easing);
    for (const key of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
      if (NUMERIC_PROPS.includes(key) && typeof a.props[key] === 'number' && typeof b.props[key] === 'number') {
        params[key] = lerp(a.props[key], b.props[key], t);
      } else {
        params[key] = raw >= 1 ? b.props[key] : a.props[key];
      }
    }
    return params;
  }
  return params;
}

function drawAsset(ctx, asset, params) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, params.opacity));
  if (params.blur > 0) ctx.filter = `blur(${params.blur}px)`;
  const cx = params.x + params.width / 2;
  const cy = params.y + params.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((params.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  if (params.fill) ctx.fillStyle = params.fill;
  if (params.stroke) {
    ctx.strokeStyle = params.stroke;
    ctx.lineWidth = params.strokeWidth || 0;
  }
  if (asset.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(cx, cy, params.width / 2, params.height / 2, 0, 0, Math.PI * 2);
    if (params.fill) ctx.fill();
    if (params.strokeWidth > 0) ctx.stroke();
  } else if (asset.kind === 'text') {
    ctx.font = `${params.fontSize}px ${params.fontFamily}`;
    ctx.textBaseline = 'top';
    if (params.fill) ctx.fillText(params.text, params.x, params.y, params.width);
    if (params.strokeWidth > 0) ctx.strokeText(params.text, params.x, params.y, params.width);
  } else {
    roundRect(ctx, params.x, params.y, params.width, params.height, params.radius);
    if (params.fill) ctx.fill();
    if (params.strokeWidth > 0) ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function renderScene(canvas, store, time = store.timeline.playhead) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = store.canvas.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const assetsById = new Map(store.assets.map((a) => [a.id, a]));
  for (const layer of store.layers) {
    if (!layer.visible) continue;
    const asset = assetsById.get(layer.assetId);
    if (!asset) continue;
    drawAsset(ctx, asset, resolveParams(layer, time));
  }
}
