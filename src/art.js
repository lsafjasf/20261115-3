export const ART_WIDTH = 600;
export const ART_HEIGHT = 750;

export const ART_SPECS = [
  {
    id: "tidal",
    number: "01",
    title: "潮汐切片",
    english: "TIDAL CUT",
    kind: "bloom",
    bg: "#eee7d5",
    ink: "#171713",
    accent: "#f15a3a",
    paper: "#f7f1df",
    seed: 191,
  },
  {
    id: "echo",
    number: "02",
    title: "蓝色回响",
    english: "BLUE ECHO",
    kind: "current",
    bg: "#123ba5",
    ink: "#f4f0e4",
    accent: "#9fd9ff",
    paper: "#e9e4d6",
    seed: 628,
  },
  {
    id: "field",
    number: "03",
    title: "野地网格",
    english: "FIELD GRID",
    kind: "field",
    bg: "#cfe350",
    ink: "#1a1b14",
    accent: "#ee4a2f",
    paper: "#f6f0dc",
    seed: 311,
  },
  {
    id: "orbit",
    number: "04",
    title: "粉色轨道",
    english: "PINK ORBIT",
    kind: "echo",
    bg: "#efb5c8",
    ink: "#211a1d",
    accent: "#e63573",
    paper: "#fbe8ed",
    seed: 874,
  },
  {
    id: "garden",
    number: "05",
    title: "墨色花园",
    english: "INK GARDEN",
    kind: "ink",
    bg: "#f1ede2",
    ink: "#171713",
    accent: "#527c53",
    paper: "#fbf8ee",
    seed: 105,
  },
  {
    id: "citrus",
    number: "06",
    title: "柑橘脉冲",
    english: "CITRUS PULSE",
    kind: "citrus",
    bg: "#ffd326",
    ink: "#17233f",
    accent: "#f15a3a",
    paper: "#fff1b5",
    seed: 460,
  },
  {
    id: "aqua",
    number: "07",
    title: "青绿折面",
    english: "AQUA FOLD",
    kind: "fold",
    bg: "#a6dfd0",
    ink: "#123c3b",
    accent: "#f15a3a",
    paper: "#e7f5ec",
    seed: 737,
  },
  {
    id: "night",
    number: "08",
    title: "夜间信号",
    english: "NIGHT SIGNAL",
    kind: "night",
    bg: "#14121f",
    ink: "#f1eee5",
    accent: "#d9ff47",
    paper: "#222033",
    seed: 992,
  },
];

function randomFactory(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function registrationMarks(ctx, spec) {
  ctx.save();
  ctx.strokeStyle = spec.ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.62;
  const inset = 24;
  for (const [x, y] of [
    [inset, inset],
    [ART_WIDTH - inset, inset],
    [inset, ART_HEIGHT - inset],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();
  }
  ctx.restore();
}

function artOverlay(ctx, spec) {
  const lightArt = hasLightBackground(spec);
  const textColor = lightArt ? "#171713" : "#f7f3e8";
  ctx.save();
  ctx.fillStyle = textColor;
  ctx.globalAlpha = 0.92;
  ctx.font = '500 15px "DM Mono", "Courier New", monospace';
  ctx.letterSpacing = "2px";
  ctx.fillText(`FRAME ${spec.number}`, 42, 677);
  ctx.font = '800 32px "Manrope", "Noto Sans SC", "Helvetica Neue", sans-serif';
  ctx.letterSpacing = "-1px";
  ctx.fillText(spec.title, 42, 714);
  ctx.globalAlpha = 0.56;
  ctx.font = '500 10px "DM Mono", "Courier New", monospace';
  ctx.letterSpacing = "1.5px";
  ctx.textAlign = "right";
  ctx.fillText("PROGRAM GENERATED / 2026", ART_WIDTH - 42, 714);
  ctx.textAlign = "left";
  ctx.restore();
}

function hasLightBackground(spec) {
  return ["bloom", "field", "ink", "citrus", "fold"].includes(spec.kind);
}

function addGrain(ctx, seed, spec) {
  const random = randomFactory(seed);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 4200; i += 1) {
    const x = Math.floor(random() * ART_WIDTH);
    const y = Math.floor(random() * ART_HEIGHT);
    ctx.globalAlpha = 0.02 + random() * 0.055;
    ctx.fillStyle = hasLightBackground(spec) ? "#322d24" : "#ffffff";
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.restore();
}

function drawBloom(ctx, spec, random) {
  const { bg, ink, accent } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 13; i += 1) {
    ctx.beginPath();
    ctx.arc(315, 340, 92 + i * 19, -0.25 + i * 0.015, Math.PI * 1.34);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const gradient = ctx.createRadialGradient(286, 290, 30, 340, 350, 270);
  gradient.addColorStop(0, "#ffb543");
  gradient.addColorStop(0.5, accent);
  gradient.addColorStop(1, "#d73522");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(323, 322, 224, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(250, 258, 127, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(250, 258, 112, 0, Math.PI * 1.56);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(462, 522, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(462, 522, 20, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 16; i += 1) {
    const y = 92 + i * 31;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.64;
    ctx.fillRect(48 + random() * 4, y, 40 + random() * 74, 2);
  }
  ctx.globalAlpha = 1;
}

function drawCurrent(ctx, spec) {
  const { bg, paper, accent, ink } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  const gradient = ctx.createLinearGradient(0, 0, ART_WIDTH, ART_HEIGHT);
  gradient.addColorStop(0, "#09267d");
  gradient.addColorStop(1, "#1d60cf");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ART_WIDTH, 450);

  ctx.lineJoin = "round";
  for (let band = 0; band < 9; band += 1) {
    ctx.beginPath();
    ctx.strokeStyle = band % 3 === 0 ? accent : paper;
    ctx.lineWidth = 9 + (band % 4) * 7;
    ctx.globalAlpha = 0.88 - band * 0.05;
    for (let x = -40; x <= 650; x += 6) {
      const y =
        186 +
        band * 31 +
        Math.sin(x * 0.018 + band * 0.54) * 49 +
        Math.sin(x * 0.043 + band) * 17;
      if (x === -40) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.moveTo(0, 492);
  ctx.bezierCurveTo(170, 438, 348, 527, 600, 460);
  ctx.lineTo(600, 750);
  ctx.lineTo(0, 750);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(435, 592, 88, 0.08, Math.PI * 1.82);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(435, 592, 38, 0, Math.PI * 2);
  ctx.fill();
}

function drawField(ctx, spec, random) {
  const { bg, ink, accent, paper } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.fillStyle = paper;
  ctx.globalAlpha = 0.64;
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(50 + i * 110, 0, 38 + random() * 46, ART_HEIGHT);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  for (let x = 48; x <= 552; x += 84) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x, 514);
    ctx.stroke();
  }
  for (let y = 64; y <= 514; y += 75) {
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(552, y);
    ctx.stroke();
  }

  const leaves = [
    [112, 139, 52, -0.7],
    [280, 102, 64, 0.1],
    [438, 212, 48, 1.1],
    [180, 329, 68, -0.45],
    [388, 432, 58, 0.35],
    [506, 319, 32, 0.2],
  ];
  leaves.forEach(([x, y, size, rotation], index) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = index === 1 ? accent : ink;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.9, -size * 0.4, size * 0.9, size * 0.5, 0, size);
    ctx.bezierCurveTo(-size * 0.9, size * 0.5, -size * 0.9, -size * 0.4, 0, -size);
    ctx.fill();
    ctx.strokeStyle = bg;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -size + 4);
    ctx.lineTo(0, size - 4);
    ctx.stroke();
    ctx.restore();
  });

  ctx.fillStyle = ink;
  for (let i = 0; i < 7; i += 1) {
    ctx.fillRect(60 + i * 75, 497, 34, 17);
  }
  ctx.fillStyle = accent;
  ctx.fillRect(48, 544, 223, 9);
  ctx.fillRect(48, 562, 173, 3);
}

function drawEcho(ctx, spec) {
  const { bg, ink, accent, paper } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  const glow = ctx.createRadialGradient(180, 220, 10, 230, 260, 330);
  glow.addColorStop(0, "#ffd6e2");
  glow.addColorStop(0.5, "#f3a9c3");
  glow.addColorStop(1, bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.globalAlpha = 0.54;
  for (let i = 0; i < 7; i += 1) {
    ctx.save();
    ctx.translate(310 + i * 8, 277 - i * 15);
    ctx.rotate(-0.34 + i * 0.025);
    ctx.fillStyle = i % 2 === 0 ? accent : ink;
    roundedRect(ctx, -157, -76, 314, 152, 76);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(56, 420);
  ctx.bezierCurveTo(240, 310, 510, 448, 312, 596);
  ctx.stroke();

  ctx.fillStyle = paper;
  roundedRect(ctx, 62, 480, 214, 136, 9);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  roundedRect(ctx, 62, 480, 214, 136, 9);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = '500 11px "DM Mono", monospace';
  ctx.fillText("LIGHT / FREQUENCY", 82, 509);
  ctx.font = '800 38px "Manrope", "Noto Sans SC", sans-serif';
  ctx.fillText("04", 82, 572);
}

function drawInk(ctx, spec, random) {
  const { bg, ink, accent } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  for (let i = 0; i < 10; i += 1) {
    const startX = 90 + random() * 390;
    const startY = 92 + random() * 360;
    ctx.lineWidth = 5 + random() * 20;
    ctx.globalAlpha = 0.28 + random() * 0.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX - 100 + random() * 80,
      startY + 90,
      startX + 60 + random() * 110,
      startY + 160,
      startX - 70 + random() * 130,
      startY + 250,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(463, 139, 87, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath();
    ctx.arc(463, 139, 17 + i * 11, 0.15, Math.PI * 1.65);
    ctx.stroke();
  }

  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.78;
  ctx.beginPath();
  ctx.moveTo(40, 566);
  ctx.bezierCurveTo(145, 479, 234, 673, 340, 552);
  ctx.bezierCurveTo(412, 472, 473, 514, 560, 478);
  ctx.lineTo(560, 563);
  ctx.bezierCurveTo(450, 598, 412, 543, 341, 607);
  ctx.bezierCurveTo(218, 711, 139, 531, 40, 633);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(52, 290);
  ctx.lineTo(295, 290);
  ctx.moveTo(52, 308);
  ctx.lineTo(218, 308);
  ctx.stroke();
}

function drawCitrus(ctx, spec) {
  const { bg, ink, accent, paper } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.36;
  for (let x = 23; x < ART_WIDTH; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 620);
    ctx.stroke();
  }
  for (let y = 23; y < 620; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ART_WIDTH, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(316, 304, 217, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.arc(316, 304, 193, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(316, 304);
    ctx.lineTo(316 + Math.cos(angle) * 170, 304 + Math.sin(angle) * 170);
    ctx.stroke();
  }
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(316, 304, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(545, 105, 44, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(36, 545);
  ctx.lineTo(570, 479);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 564);
  ctx.lineTo(570, 498);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = '500 12px "DM Mono", monospace';
  ctx.fillText("C-06 / 100%", 48, 90);
}

function drawFold(ctx, spec) {
  const { bg, ink, accent, paper } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  const folds = [
    { x: -60, y: 70, width: 480, height: 235, rotate: -0.32, color: "#2c817c" },
    { x: 110, y: 250, width: 510, height: 198, rotate: 0.28, color: paper },
    { x: -40, y: 423, width: 560, height: 168, rotate: -0.17, color: "#18605f" },
  ];
  folds.forEach((fold, index) => {
    ctx.save();
    ctx.translate(fold.x, fold.y);
    ctx.rotate(fold.rotate);
    ctx.fillStyle = fold.color;
    ctx.fillRect(0, 0, fold.width, fold.height);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, fold.width, fold.height);
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 70 + 50, 0);
      ctx.lineTo(i * 70 - 80, fold.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (index === 2) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(100, 497, 46, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(455, 176, 74, 0.2, Math.PI * 1.55);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(455, 176, 95, 0.1, Math.PI * 1.67);
  ctx.stroke();
}

function drawNight(ctx, spec, random) {
  const { bg, ink, accent, paper } = spec;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  const glow = ctx.createRadialGradient(294, 307, 20, 294, 307, 340);
  glow.addColorStop(0, "#47346d");
  glow.addColorStop(0.55, "#25213d");
  glow.addColorStop(1, bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 1;
  for (let x = 0; x < ART_WIDTH; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 74);
    ctx.lineTo(x, 613);
    ctx.stroke();
  }
  for (let y = 74; y < 613; y += 42) {
    ctx.beginPath();
    ctx.moveTo(38, y);
    ctx.lineTo(562, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    const y = 155 + i * 57;
    ctx.beginPath();
    ctx.moveTo(56, y);
    ctx.lineTo(180 + random() * 280, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#ff5e7e";
  ctx.beginPath();
  ctx.arc(324, 272, 126, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(324, 272, 88, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(324, 272, 61, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(324, 272, 61, 0.2, Math.PI * 1.78);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(48, 51, 8, 8);
  ctx.globalAlpha = 1;
}

const RENDERERS = {
  bloom: drawBloom,
  current: drawCurrent,
  field: drawField,
  echo: drawEcho,
  ink: drawInk,
  citrus: drawCitrus,
  fold: drawFold,
  night: drawNight,
};

export function createArtworkCanvas(spec) {
  const canvas = document.createElement("canvas");
  canvas.width = ART_WIDTH;
  canvas.height = ART_HEIGHT;
  const ctx = canvas.getContext("2d");
  const random = randomFactory(spec.seed);

  RENDERERS[spec.kind](ctx, spec, random);
  addGrain(ctx, spec.seed + 17, spec);
  registrationMarks(ctx, spec);
  artOverlay(ctx, spec);

  const edge = ctx.createLinearGradient(0, 0, ART_WIDTH, ART_HEIGHT);
  edge.addColorStop(0, "rgba(255,255,255,0.12)");
  edge.addColorStop(0.5, "rgba(255,255,255,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.08)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);

  return canvas;
}

export function buildArtworkAssets() {
  return ART_SPECS.map((spec) => {
    const canvas = createArtworkCanvas(spec);
    return {
      spec,
      canvas,
      url: canvas.toDataURL("image/png"),
    };
  });
}
