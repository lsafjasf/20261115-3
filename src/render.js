import {
  PALETTES,
  SOURCE_CUES,
  SOURCE_DURATION,
  cueAtOutputTime,
  cueAtSourceTime,
  formatClock,
  hash,
  mixHex,
  transitionProgress,
} from "./scene.js";

const buffers = new Map();

function getBuffer(key, width, height) {
  const id = `${key}-${width}x${height}`;
  let entry = buffers.get(id);
  if (!entry) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    entry = { canvas, ctx: canvas.getContext("2d", { alpha: false }) };
    buffers.set(id, entry);
  }
  return entry;
}

function paletteAt(time) {
  const index = Math.min(PALETTES.length - 1, Math.floor(time / 10));
  const nextIndex = Math.min(PALETTES.length - 1, index + 1);
  const phase = Math.min(1, Math.max(0, (time % 10) / 9));
  const a = PALETTES[index];
  const b = PALETTES[nextIndex];
  return {
    a: mixHex(a.a, b.a, phase * 0.45),
    b: mixHex(a.b, b.b, phase * 0.45),
    glow: mixHex(a.glow, b.glow, phase),
    accent: mixHex(a.accent, b.accent, phase),
    warm: mixHex(a.warm, b.warm, phase),
  };
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

function drawCaption(ctx, width, height, text, accent) {
  if (!text) return;
  const fontSize = Math.max(15, Math.round(height * 0.034));
  ctx.save();
  ctx.font = `600 ${fontSize}px "Framecut Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(text);
  const boxWidth = metrics.width + fontSize * 2.4;
  const boxHeight = fontSize * 2.15;
  const x = (width - boxWidth) / 2;
  const y = height - boxHeight - height * 0.095;
  roundRect(ctx, x, y, boxWidth, boxHeight, 3);
  ctx.fillStyle = "rgba(4, 8, 7, 0.76)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, Math.max(3, width * 0.003), boxHeight);
  ctx.fillStyle = "#f5f8f6";
  ctx.fillText(text, width / 2, y + boxHeight / 2 + 1);
  ctx.restore();
}

function drawSceneBackground(ctx, width, height, time, palette) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.a);
  gradient.addColorStop(0.62, palette.b);
  gradient.addColorStop(1, "#050807");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cx = width * (0.71 + Math.sin(time * 0.31) * 0.035);
  const cy = height * 0.31;
  const sunRadius = height * 0.19;
  const sunGlow = ctx.createRadialGradient(cx, cy, 4, cx, cy, sunRadius * 1.8);
  sunGlow.addColorStop(0, `${palette.glow}aa`);
  sunGlow.addColorStop(0.28, `${palette.glow}44`);
  sunGlow.addColorStop(1, `${palette.glow}00`);
  ctx.fillStyle = sunGlow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.3;
  for (let ring = 0; ring < 4; ring += 1) {
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      sunRadius * (1.15 + ring * 0.22),
      sunRadius * (0.28 + ring * 0.06),
      -0.22 + Math.sin(time * 0.17 + ring) * 0.08,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = ring % 2 ? palette.glow : palette.warm;
    ctx.lineWidth = Math.max(1, width * 0.0011);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, sunRadius, 0, Math.PI * 2);
  const sunFill = ctx.createLinearGradient(cx, cy - sunRadius, cx, cy + sunRadius);
  sunFill.addColorStop(0, palette.accent);
  sunFill.addColorStop(0.52, palette.glow);
  sunFill.addColorStop(1, `${palette.glow}33`);
  ctx.fillStyle = sunFill;
  ctx.globalAlpha = 0.83;
  ctx.fill();
  for (let band = 0; band < 5; band += 1) {
    const y = cy + sunRadius * (0.04 + band * 0.18);
    ctx.fillStyle = palette.a;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(cx - sunRadius, y, sunRadius * 2, sunRadius * 0.035);
  }
  ctx.restore();

  const horizon = height * 0.57;
  ctx.save();
  ctx.strokeStyle = `${palette.glow}33`;
  ctx.lineWidth = 1;
  for (let index = -8; index <= 8; index += 1) {
    ctx.beginPath();
    ctx.moveTo(width / 2 + index * width * 0.009, horizon);
    ctx.lineTo(width / 2 + index * width * 0.082, height);
    ctx.stroke();
  }
  for (let index = 0; index < 11; index += 1) {
    const phase = ((index / 11 + time * 0.035) % 1) ** 2.2;
    const y = horizon + (height - horizon) * phase;
    ctx.globalAlpha = 0.22 + phase * 0.48;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  drawSkyline(ctx, width, height, time, horizon, palette);
  drawParticles(ctx, width, height, time, palette);
  drawWaveform(ctx, width, height, time, palette);
  drawScanlines(ctx, width, height);
}

function drawSkyline(ctx, width, height, time, horizon, palette) {
  const count = 13;
  const buildingWidth = width / count;
  for (let index = 0; index < count; index += 1) {
    const wobble = Math.sin(index * 2.13 + 0.4) * 0.5 + 0.5;
    const buildingHeight = height * (0.055 + wobble * 0.106);
    const x = index * buildingWidth + Math.sin(time * 0.21 + index) * 2;
    const y = horizon - buildingHeight;
    ctx.fillStyle = "rgba(3, 8, 7, 0.72)";
    ctx.fillRect(x, y, buildingWidth + 1, buildingHeight);
    if (index % 2 === 0) {
      ctx.fillStyle = `${palette.glow}55`;
      ctx.fillRect(x + buildingWidth * 0.4, y + buildingHeight * 0.2, 2, 3);
    }
  }
}

function drawParticles(ctx, width, height, time, palette) {
  ctx.save();
  for (let index = 0; index < 44; index += 1) {
    const speed = 0.012 + hash(index + 91) * 0.028;
    const x = ((hash(index + 12) + time * speed * (index % 3 ? 1 : -1)) % 1 + 1) % 1;
    const y = hash(index + 121) * height * 0.67;
    const radius = 0.6 + hash(index + 53) * 1.8;
    ctx.globalAlpha = 0.14 + hash(index + 7) * 0.48;
    ctx.fillStyle = index % 4 === 0 ? palette.accent : palette.glow;
    ctx.beginPath();
    ctx.arc(x * width, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWaveform(ctx, width, height, time, palette) {
  const baseY = height * 0.75;
  const barCount = 56;
  const barWidth = width / barCount;
  ctx.save();
  for (let index = 0; index < barCount; index += 1) {
    const wave =
      Math.sin(index * 0.73 + time * 5.4) * 0.34 +
      Math.sin(index * 0.31 - time * 2.2) * 0.26 +
      hash(index + Math.floor(time * 8)) * 0.4;
    const barHeight = height * (0.018 + Math.max(0, wave) * 0.09);
    ctx.fillStyle = index % 7 === 0 ? palette.accent : `${palette.glow}88`;
    ctx.fillRect(index * barWidth + barWidth * 0.32, baseY - barHeight, barWidth * 0.34, barHeight);
  }
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = palette.glow;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 10) {
    const normalized = x / width;
    const y =
      height * 0.64 +
      Math.sin(normalized * 15 + time * 3.1) * height * 0.018 +
      Math.sin(normalized * 37 - time * 2.4) * height * 0.008;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawScanlines(ctx, width, height) {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#000";
  for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    height * 0.25,
    width / 2,
    height / 2,
    width * 0.67,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.58)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawSourceHud(ctx, width, height, time, palette) {
  const scale = width / 1280;
  const pad = 30 * scale;
  ctx.save();
  ctx.font = `600 ${10 * scale}px "SFMono-Regular", monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.46)";
  ctx.fillText("GENERATED SOURCE", pad, height - 47 * scale);
  ctx.fillStyle = palette.accent;
  ctx.fillText(`TC ${formatClock(time)} / 30.00`, pad, height - 31 * scale);
  const progressWidth = width * 0.2;
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(width - pad - progressWidth, height - 35 * scale, progressWidth, 2 * scale);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(
    width - pad - progressWidth,
    height - 35 * scale,
    progressWidth * (time / SOURCE_DURATION),
    2 * scale,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.fillText(`SHOT 0${Math.min(3, Math.floor(time / 10) + 1)}`, width - pad, height - 47 * scale);
  ctx.restore();
}

export function renderSourceFrame(ctx, width, height, time, options = {}) {
  const palette = paletteAt(time);
  const safeTime = ((time % SOURCE_DURATION) + SOURCE_DURATION) % SOURCE_DURATION;
  ctx.save();
  drawSceneBackground(ctx, width, height, safeTime, palette);
  if (options.sourceHud !== false) {
    drawSourceHud(ctx, width, height, safeTime, palette);
  }
  if (options.captions !== false) {
    const cue = cueAtSourceTime(safeTime);
    drawCaption(ctx, width, height, cue?.text, palette.accent);
  }
  ctx.restore();
}

function drawCompositeLayer(ctx, width, height, clip, outputTime, options) {
  if (!clip) return;
  renderSourceFrame(ctx, width, height, clip.inPoint + (outputTime - clip.start), {
    captions: false,
    sourceHud: false,
    ...options,
  });
}

export function renderSequenceFrame(ctx, width, height, sequence, outputTime, options = {}) {
  const time = Math.max(0, Math.min(Math.max(0, sequence.total - 0.001), outputTime));
  const transition = transitionProgress(sequence, time);
  const { incoming, outgoing, progress, type } = transition;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  if (!outgoing) {
    drawCompositeLayer(ctx, width, height, incoming, time, options);
  } else if (type === "wipe") {
    drawCompositeLayer(ctx, width, height, outgoing, time, options);
    const edge = Math.round(width * progress);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, edge, height);
    ctx.clip();
    drawCompositeLayer(ctx, width, height, incoming, time, options);
    ctx.restore();
    ctx.fillStyle = "rgba(217,255,67,0.72)";
    ctx.fillRect(Math.max(0, edge - 1), 0, 2, height);
  } else if (type === "slide") {
    drawCompositeLayer(ctx, width, height, outgoing, time, options);
    ctx.save();
    ctx.translate(width * (1 - progress), 0);
    drawCompositeLayer(ctx, width, height, incoming, time, options);
    ctx.restore();
  } else {
    drawCompositeLayer(ctx, width, height, outgoing, time, options);
    ctx.save();
    ctx.globalAlpha = progress;
    drawCompositeLayer(ctx, width, height, incoming, time, options);
    ctx.restore();
  }

  if (options.captions !== false) {
    const cue = cueAtOutputTime(sequence, time);
    const palette = paletteAt(incoming?.inPoint ?? 0);
    drawCaption(ctx, width, height, cue?.text, palette.accent);
    drawSequenceHud(ctx, width, height, time, sequence, incoming, palette);
  }
  ctx.restore();
}

function drawSequenceHud(ctx, width, height, time, sequence, incoming, palette) {
  const scale = width / 1280;
  ctx.save();
  ctx.font = `600 ${9 * scale}px "SFMono-Regular", monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.fillText(`EDIT / ${String(incoming?.index + 1).padStart(2, "0")}`, 30 * scale, 26 * scale);
  ctx.textAlign = "right";
  ctx.fillStyle = palette.accent;
  ctx.fillText(
    `${formatClock(time)} / ${formatClock(sequence.total)}`,
    width - 30 * scale,
    26 * scale,
  );
  ctx.restore();
}

export function drawPosterFrame(canvas, time, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  renderSourceFrame(ctx, width, height, time, { captions: false });
}

export function renderThumbnail(time, width = 96, height = 54) {
  const entry = getBuffer("thumbnail", width, height);
  const ctx = entry.ctx;
  renderSourceFrame(ctx, width, height, time, { captions: false });
  return entry.canvas.toDataURL("image/jpeg", 0.72);
}
