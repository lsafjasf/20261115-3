import { QR_TEXT, analyzeQr, drawQr, hexToRgb } from "./qr.js";

export const POSTER_WIDTH = 1200;
export const POSTER_HEIGHT = 1600;

export const PALETTES = [
  {
    id: "acid",
    name: "酸性纸",
    posterBg: "#EFE7D6",
    ink: "#141512",
    accent: "#D8FF43",
    secondary: "#F05B3C",
    qrDark: "#141512",
    qrLight: "#F8F1E1",
  },
  {
    id: "cobalt",
    name: "钴蓝夜",
    posterBg: "#E8E5DC",
    ink: "#101D51",
    accent: "#FF5B35",
    secondary: "#B7C7FF",
    qrDark: "#101D51",
    qrLight: "#F7F4EA",
  },
  {
    id: "mono",
    name: "黑白场",
    posterBg: "#F0EEE8",
    ink: "#101010",
    accent: "#F0FF5A",
    secondary: "#D6D2C7",
    qrDark: "#101010",
    qrLight: "#FFFFFF",
  },
  {
    id: "ember",
    name: "余烬红",
    posterBg: "#241E1A",
    ink: "#F2E8D5",
    accent: "#FF633D",
    secondary: "#AFA08A",
    qrDark: "#17130F",
    qrLight: "#F4E8D2",
  },
];

export const DEFAULT_STATE = {
  palette: "acid",
  posterBg: "#EFE7D6",
  ink: "#141512",
  accent: "#D8FF43",
  secondary: "#F05B3C",
  qrDark: "#141512",
  qrLight: "#F8F1E1",
  logoArtwork: "asterisk",
  logoSize: 24,
  noiseStyle: "grain",
  noiseAmount: 34,
  seed: 20261121,
  content: QR_TEXT,
  logoImage: null,
};

const FONT_SANS = '"Ubuntu Sans", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif';
const FONT_MONO = '"Ubuntu Mono", "Noto Sans SC", "Courier New", monospace';
const FONT_SERIF = '"DejaVu Serif", "Noto Sans SC", Georgia, serif';

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function text(ctx, value, x, y, options = {}) {
  const { size = 18, color, weight = 500, family = FONT_SANS, align = "left", baseline = "alphabetic", spacing = 0 } = options;
  ctx.save();
  ctx.fillStyle = color || ctx.fillStyle;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(value, x, y);
  ctx.restore();
}

function line(ctx, x1, y1, x2, y2, color, width = 1, dash = []) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.restore();
}

function drawNoise(ctx, state) {
  const amount = state.noiseAmount / 100;
  if (amount <= 0.01) return;
  const random = seededRandom(state.seed);
  ctx.save();

  if (state.noiseStyle === "grain") {
    const count = Math.round(2600 + amount * 7200);
    for (let i = 0; i < count; i += 1) {
      const alpha = 0.018 + random() * 0.13 * amount;
      ctx.fillStyle = random() > 0.52 ? rgba(state.ink, alpha) : rgba("#FFFFFF", alpha * 0.7);
      const size = 0.35 + random() * 1.2;
      ctx.fillRect(random() * POSTER_WIDTH, random() * POSTER_HEIGHT, size, size);
    }
  } else if (state.noiseStyle === "fiber") {
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 780; i += 1) {
      const x = random() * POSTER_WIDTH;
      const y = random() * POSTER_HEIGHT;
      const length = 3 + random() * 38;
      ctx.strokeStyle = rgba(state.ink, (0.018 + random() * 0.075) * amount);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + length * 0.5, y + random() * 2 - 1, x + length, y + random() * 1.4 - 0.7);
      ctx.stroke();
    }
  } else {
    const gap = 9 + (1 - amount) * 7;
    for (let y = 0; y < POSTER_HEIGHT; y += gap) {
      for (let x = (y / gap) % 2 === 0 ? 0 : gap / 2; x < POSTER_WIDTH; x += gap) {
        ctx.fillStyle = rgba(state.ink, 0.035 + amount * 0.085);
        ctx.beginPath();
        ctx.arc(x, y, 0.45 + amount * 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawRegistrationMark(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = rgba("#000000", 0.32);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.moveTo(x - 17, y);
  ctx.lineTo(x + 17, y);
  ctx.moveTo(x, y - 17);
  ctx.lineTo(x, y + 17);
  ctx.stroke();
  ctx.restore();
}

function drawOrb(ctx, state) {
  const cx = 1005;
  const cy = 492;
  const radius = 264;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = state.accent;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  const random = seededRandom(state.seed + 19);
  for (let y = cy - radius; y < cy + radius; y += 14) {
    for (let x = cx - radius; x < cx + radius; x += 14) {
      const distance = Math.hypot(x - cx, y - cy) / radius;
      if (random() > distance * 0.66) {
        ctx.fillStyle = rgba(state.ink, 0.16 + distance * 0.18);
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + distance * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.strokeStyle = rgba(state.ink, 0.7);
  ctx.lineWidth = 1.4;
  for (let ring = 1; ring <= 3; ring += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.29 + ring * 0.15), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.2);
  ctx.fillStyle = state.ink;
  ctx.font = `900 42px ${FONT_SANS}`;
  ctx.textAlign = "center";
  ctx.letterSpacing = "-1px";
  ctx.fillText("NO SIGNAL", 0, -80);
  ctx.fillText("NO ENTRY", 0, 116);
  ctx.restore();
}

function drawHeader(ctx, state) {
  const left = 64;
  const right = 1136;
  ctx.fillStyle = state.ink;
  text(ctx, "SIGNAL / FORM®", left, 66, { size: 22, weight: 800, color: state.ink, spacing: 0.5 });
  text(ctx, "SHANGHAI · CN", right, 64, { size: 15, weight: 600, color: state.ink, family: FONT_MONO, align: "right" });
  text(ctx, "31°13′N / 121°28′E", right, 86, { size: 12, weight: 500, color: state.ink, family: FONT_MONO, align: "right" });
  line(ctx, left, 106, right, 106, state.ink, 1.5);

  ctx.fillStyle = state.ink;
  ctx.fillRect(left, 129, 218, 28);
  text(ctx, "AUDIO / VISUAL / CULTURE", left + 13, 148, { size: 11, weight: 700, color: state.posterBg, family: FONT_MONO, spacing: 0.8 });
  text(ctx, "VOL. 03 — TWO NIGHTS ONLY", right, 148, { size: 11, weight: 600, color: state.ink, family: FONT_MONO, align: "right", spacing: 0.6 });
}

function drawHeroType(ctx, state) {
  ctx.save();
  ctx.fillStyle = state.ink;
  ctx.font = `900 250px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.letterSpacing = "-13px";
  ctx.fillText("FORM", 48, 414);

  ctx.font = `italic 124px ${FONT_SERIF}`;
  ctx.letterSpacing = "-7px";
  ctx.fillText("in the", 570, 493);

  ctx.font = `900 242px ${FONT_SANS}`;
  ctx.letterSpacing = "-15px";
  ctx.fillText("STATIC", 48, 690);
  ctx.restore();

  ctx.save();
  ctx.translate(1052, 325);
  ctx.rotate(Math.PI / 2);
  text(ctx, "A TRANSMISSION IN FOUR PARTS", 0, 0, {
    size: 11, weight: 700, color: state.ink, family: FONT_MONO, spacing: 1.6,
  });
  ctx.restore();
}

function drawHeroMeta(ctx, state) {
  const left = 64;
  const right = 1136;
  line(ctx, left, 763, right, 763, state.ink, 1.4);
  text(ctx, "21—22 / 11 / 2026", left, 813, { size: 38, weight: 800, color: state.ink, family: FONT_MONO, spacing: -1.6 });
  text(ctx, "20:00 — LATE", right, 813, { size: 29, weight: 700, color: state.ink, family: FONT_MONO, align: "right" });
  line(ctx, left, 835, right, 835, rgba(state.ink, 0.5), 0.8);
  text(ctx, "WEST BUND WAREHOUSE 07 · SHANGHAI", left, 867, { size: 12, weight: 600, color: state.ink, family: FONT_MONO, spacing: 0.8 });
  text(ctx, "18 ARTISTS / 02 STAGES / 01 NIGHT", right, 867, { size: 12, weight: 600, color: state.ink, family: FONT_MONO, align: "right", spacing: 0.3 });
}

export function renderPoster(canvas, state, options = {}) {
  const { scale = 1, showSafeZones = false } = options;
  const metrics = analyzeQr(state);
  canvas.width = Math.round(POSTER_WIDTH * scale);
  canvas.height = Math.round(POSTER_HEIGHT * scale);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.save();
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = state.posterBg;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  const gradient = ctx.createLinearGradient(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  gradient.addColorStop(0, rgba("#FFFFFF", 0.1));
  gradient.addColorStop(0.54, rgba(state.posterBg, 0));
  gradient.addColorStop(1, rgba(state.ink, 0.055));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  drawNoise(ctx, state);
  drawOrb(ctx, state);
  drawHeader(ctx, state);
  drawHeroType(ctx, state);
  drawHeroMeta(ctx, state);
  drawRegistrationMark(ctx, 56, 502);
  drawRegistrationMark(ctx, 56, 738);

  drawBody(ctx, state, metrics);

  ctx.restore();
  return metrics;
}

function drawBody(ctx, state, metrics) {
  const left = 64;
  const right = 1136;
  line(ctx, left, 908, right, 908, state.ink, 1.4);

  ctx.fillStyle = state.accent;
  ctx.fillRect(left, 929, 52, 9);
  text(ctx, "TWO NIGHTS / ONE TRANSMISSION", left + 66, 940, {
    size: 13, weight: 700, color: state.ink, family: FONT_MONO, spacing: 0.8,
  });

  ctx.save();
  ctx.fillStyle = state.ink;
  ctx.font = `900 61px ${FONT_SANS}`;
  ctx.letterSpacing = "-2.8px";
  ctx.fillText("SOUND,", left, 1004);
  ctx.fillText("MOVEMENT", left, 1067);
  ctx.fillText("& CODE.", left, 1130);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = rgba(state.ink, 0.24);
  ctx.lineWidth = 1;
  for (let x = left; x <= 658; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 1160);
    ctx.lineTo(x, 1167);
    ctx.stroke();
  }
  ctx.restore();

  const description = [
    "Live audiovisual performance, modular sound",
    "and open-source image making. Bring your",
    "body; leave with a new signal.",
  ];
  description.forEach((row, index) => {
    text(ctx, row, left, 1199 + index * 23, {
      size: 17, weight: 450, color: state.ink, family: FONT_SANS,
    });
  });

  text(ctx, "FEATURING", left, 1291, {
    size: 11, weight: 700, color: state.ink, family: FONT_MONO, spacing: 1.4,
  });
  text(ctx, "MIRA CHEN · NOCTURNE 404 · PLASTIC INDEX · YUAN 2:22", left, 1312, {
    size: 12, weight: 700, color: state.ink, family: FONT_MONO,
  });

  ctx.fillStyle = state.ink;
  ctx.fillRect(left, 1344, 577, 144);
  ctx.fillStyle = state.accent;
  ctx.fillRect(left, 1344, 12, 144);
  text(ctx, "SCAN / LISTEN / MOVE", left + 34, 1391, {
    size: 34, weight: 900, color: state.posterBg, family: FONT_SANS, spacing: -0.7,
  });
  text(ctx, "DOORS 20:00  ·  18+  ·  LIMITED CAPACITY", left + 34, 1423, {
    size: 12, weight: 600, color: state.posterBg, family: FONT_MONO, spacing: 0.45,
  });
  line(ctx, left + 34, 1444, left + 543, 1444, rgba(state.posterBg, 0.38), 0.8);
  text(ctx, "ONE CODE. THE WHOLE PROGRAM.", left + 34, 1470, {
    size: 10, weight: 500, color: state.posterBg, family: FONT_MONO, spacing: 1.1,
  });

  drawQrPanel(ctx, state, metrics);
  drawFooter(ctx, state);
}

function drawQrPanel(ctx, state, metrics) {
  const x = 714;
  const y = 1072;
  const width = 422;
  const height = 470;

  ctx.save();
  ctx.fillStyle = state.qrLight;
  ctx.strokeStyle = state.ink;
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = state.ink;
  ctx.fillRect(x, y, width, 42);
  text(ctx, "SCAN TO ENTER / 入口", x + 17, y + 27, {
    size: 13, weight: 700, color: state.posterBg, family: FONT_MONO, spacing: 0.55,
  });
  text(ctx, "↗", x + width - 18, y + 29, {
    size: 25, weight: 700, color: state.accent, align: "right",
  });
  ctx.restore();

  const qrSize = 376;
  drawQr(ctx, state, metrics, x + 23, y + 61, qrSize, state.showSafeZones);

  text(ctx, "H · 30% ECC", x + 22, y + height - 14, {
    size: 9, weight: 700, color: state.qrDark, family: FONT_MONO, spacing: 0.5,
  });
  text(ctx, "FINDERS LOCKED / 定位块已锁定", x + width - 22, y + height - 14, {
    size: 9, weight: 700, color: state.qrDark, family: FONT_MONO, align: "right", spacing: 0.3,
  });

  ctx.save();
  ctx.translate(676, 1189);
  ctx.rotate(-Math.PI / 2);
  text(ctx, `${Math.round(metrics.occlusion * 10) / 10}% CENTER OCCLUSION`, 0, 0, {
    size: 9, weight: 700, color: state.ink, family: FONT_MONO, align: "left", spacing: 0.7,
  });
  ctx.restore();
}

function drawFooter(ctx, state) {
  const left = 64;
  const right = 1136;
  line(ctx, left, 1558, right, 1558, state.ink, 0.9);
  text(ctx, "© 2026 SIGNAL / FORM COLLECTIVE", left, 1581, {
    size: 9, weight: 600, color: state.ink, family: FONT_MONO, spacing: 0.55,
  });
  text(ctx, "PRINTED IN SHANGHAI  —  1200 × 1600", right, 1581, {
    size: 9, weight: 600, color: state.ink, family: FONT_MONO, align: "right", spacing: 0.45,
  });
  drawRegistrationMark(ctx, 1104, 1568);
}
