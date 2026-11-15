import QRCode from "qrcode";

const qrCache = new Map();

export const QR_TEXT = "https://form-noise.studio/access";

export function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function getQrModel(content = QR_TEXT) {
  if (!qrCache.has(content)) {
    const qr = QRCode.create(content, { errorCorrectionLevel: "H" });
    qrCache.set(content, qr);
  }
  return qrCache.get(content);
}

export function isFinderZone(row, col, size) {
  const nearLeft = col < 8;
  const nearRight = col >= size - 8;
  const nearTop = row < 8;
  const nearBottom = row >= size - 8;
  return (nearLeft && nearTop) || (nearRight && nearTop) || (nearLeft && nearBottom);
}

export function analyzeQr(state) {
  const model = getQrModel(state.content);
  const size = model.modules.size;
  const modules = model.modules.data;
  const radius = state.logoSize / 200;
  const center = 0.5;
  let occludedArea = 0;
  let totalDataArea = 0;
  let finderCollision = false;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (isFinderZone(row, col, size)) continue;
      totalDataArea += 1;
      const x = (col + 0.5) / size - center;
      const y = (row + 0.5) / size - center;
      if (x * x + y * y <= radius * radius) occludedArea += 1;
    }
  }

  for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    const x1 = x / size;
    const y1 = y / size;
    const x2 = (x + 7) / size;
    const y2 = (y + 7) / size;
    const nearestX = Math.max(x1, Math.min(center, x2));
    const nearestY = Math.max(y1, Math.min(center, y2));
    if ((nearestX - center) ** 2 + (nearestY - center) ** 2 < radius ** 2) {
      finderCollision = true;
    }
  }

  const occlusion = (occludedArea / totalDataArea) * 100;
  const contrast = contrastRatio(state.qrDark, state.qrLight);
  const contrastRisk = contrast < 3 ? 60 : contrast < 4.5 ? 25 : 0;
  const occlusionRisk = occlusion > 18 ? 50 : occlusion > 11 ? 22 : 0;
  const score = Math.max(0, Math.round(100 - contrastRisk - occlusionRisk - (finderCollision ? 100 : 0)));
  const level = score < 55 ? "high" : score < 82 ? "attention" : "safe";
  const labels = { safe: "安全", attention: "需注意", high: "高风险" };

  return {
    size,
    version: model.version,
    contrast,
    occlusion,
    score,
    level,
    label: finderCollision ? "定位块遮挡" : labels[level],
    finderCollision,
    correction: "H · 30%",
    protected: !finderCollision,
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawMark(ctx, cx, cy, radius, state) {
  if (state.logoArtwork === "none") return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = state.qrLight;
  ctx.fill();

  const core = radius * 0.82;
  ctx.beginPath();
  ctx.arc(cx, cy, core, 0, Math.PI * 2);
  ctx.fillStyle = state.ink;
  ctx.fill();

  if (state.logoArtwork === "upload" && state.logoImage) {
    ctx.beginPath();
    ctx.arc(cx, cy, core * 0.87, 0, Math.PI * 2);
    ctx.clip();
    const image = state.logoImage;
    const scale = Math.max((core * 1.74) / image.width, (core * 1.74) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = Math.max(2, radius * 0.07);
    ctx.stroke();
  } else if (state.logoArtwork === "orbit") {
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = Math.max(2, radius * 0.1);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, core * (0.72 - i * 0.19), core * 0.34, i * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = state.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, core * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.logoArtwork === "wave") {
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = Math.max(2, radius * 0.095);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= 36; i += 1) {
      const px = cx - core * 0.7 + (i / 36) * core * 1.4;
      const py = cy + Math.sin((i / 36) * Math.PI * 4) * core * 0.27;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = state.accent;
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const length = i % 2 === 0 ? core * 0.67 : core * 0.24;
      const px = Math.cos(angle) * length;
      const py = Math.sin(angle) * length;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawQr(ctx, state, metrics, x, y, size, showSafeZones = false) {
  const model = getQrModel(state.content);
  const count = model.modules.size;
  const modules = model.modules.data;
  const module = size / (count + 8);
  const quiet = module * 4;
  const startX = x + quiet;
  const startY = y + quiet;

  ctx.save();
  ctx.fillStyle = state.qrLight;
  roundedRect(ctx, x, y, size, size, module * 2.2);
  ctx.fill();

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!modules[row * count + col] || isFinderZone(row, col, count)) continue;
      const mx = startX + col * module;
      const my = startY + row * module;
      ctx.fillStyle = state.qrDark;
      roundedRect(ctx, mx + module * 0.045, my + module * 0.045, module * 0.91, module * 0.91, module * 0.16);
      ctx.fill();
    }
  }

  for (const [col, row] of [[0, 0], [count - 7, 0], [0, count - 7]]) {
    const mx = startX + col * module;
    const my = startY + row * module;
    ctx.fillStyle = state.qrDark;
    roundedRect(ctx, mx, my, module * 7, module * 7, module * 0.65);
    ctx.fill();
    ctx.fillStyle = state.qrLight;
    roundedRect(ctx, mx + module, my + module, module * 5, module * 5, module * 0.35);
    ctx.fill();
    ctx.fillStyle = state.qrDark;
    roundedRect(ctx, mx + module * 2, my + module * 2, module * 3, module * 3, module * 0.24);
    ctx.fill();
  }

  const markRadius = (size * state.logoSize) / 200;
  drawMark(ctx, x + size / 2, y + size / 2, markRadius, state);

  if (showSafeZones) {
    ctx.strokeStyle = state.accent;
    ctx.lineWidth = Math.max(1.5, module * 0.45);
    ctx.setLineDash([module * 0.75, module * 0.5]);
    for (const [col, row] of [[0, 0], [count - 7, 0], [0, count - 7]]) {
      ctx.strokeRect(
        startX + col * module - module * 0.55,
        startY + row * module - module * 0.55,
        module * 8.1,
        module * 8.1,
      );
    }
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, markRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
