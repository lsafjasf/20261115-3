(function () {
  "use strict";

  const WORLD_WIDTH = 1720;
  const WORLD_HEIGHT = 720;
  const FRAME_WIDTH = 720;
  const FRAME_HEIGHT = 720;
  const FRAME_X = [0, 500, 1000];
  const OVERLAP = 220;

  function mulberry32(seed) {
    return function random() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function drawCloud(ctx, x, y, scale, alpha, rand) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale * 0.64);
    ctx.globalAlpha = alpha;
    const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, 86);
    gradient.addColorStop(0, "rgba(243, 231, 207, 0.9)");
    gradient.addColorStop(0.45, "rgba(232, 218, 196, 0.4)");
    gradient.addColorStop(1, "rgba(232, 218, 196, 0)");
    ctx.fillStyle = gradient;
    for (let i = 0; i < 9; i += 1) {
      const cx = (rand() - 0.5) * 155;
      const cy = (rand() - 0.5) * 24;
      const radius = 28 + rand() * 42;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSky(ctx, rand) {
    const sky = ctx.createLinearGradient(0, 0, 0, 480);
    sky.addColorStop(0, "#6f9394");
    sky.addColorStop(0.35, "#9ab3ab");
    sky.addColorStop(0.66, "#e2c398");
    sky.addColorStop(0.86, "#e7a469");
    sky.addColorStop(1, "#b8674c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD_WIDTH, 500);

    const horizonGlow = ctx.createLinearGradient(0, 260, 0, 480);
    horizonGlow.addColorStop(0, "rgba(255, 208, 139, 0)");
    horizonGlow.addColorStop(0.7, "rgba(255, 184, 103, 0.22)");
    horizonGlow.addColorStop(1, "rgba(255, 151, 84, 0.08)");
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 260, WORLD_WIDTH, 220);

    drawCloud(ctx, 330, 155, 1.8, 0.3, rand);
    drawCloud(ctx, 965, 105, 2.3, 0.22, rand);
    drawCloud(ctx, 1370, 205, 1.5, 0.32, rand);
    drawCloud(ctx, 675, 255, 1.1, 0.17, rand);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const sunGlow = ctx.createRadialGradient(1112, 292, 4, 1112, 292, 180);
    sunGlow.addColorStop(0, "rgba(255, 245, 198, 0.95)");
    sunGlow.addColorStop(0.12, "rgba(255, 222, 155, 0.68)");
    sunGlow.addColorStop(0.45, "rgba(255, 175, 101, 0.18)");
    sunGlow.addColorStop(1, "rgba(255, 156, 88, 0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(890, 70, 444, 444);
    ctx.restore();

    const sun = ctx.createRadialGradient(1104, 286, 2, 1112, 292, 42);
    sun.addColorStop(0, "#fff8d8");
    sun.addColorStop(0.55, "#ffdda0");
    sun.addColorStop(1, "rgba(255, 201, 129, 0.18)");
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(1112, 292, 43, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMountainLayer(ctx, baseline, amplitude, color, seed, roughness) {
    const rand = mulberry32(seed);
    const points = [];
    for (let x = -40; x <= WORLD_WIDTH + 40; x += 38) {
      const broad = Math.sin(x * 0.006 * roughness + seed) * amplitude * 0.24;
      const detail = (rand() - 0.5) * amplitude * 0.5;
      points.push([x, baseline - Math.abs(broad) - detail]);
    }
    ctx.beginPath();
    ctx.moveTo(-40, WORLD_HEIGHT);
    ctx.lineTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i][0] + points[i + 1][0]) / 2;
      const midY = (points[i][1] + points[i + 1][1]) / 2;
      ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
    }
    ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
    ctx.lineTo(WORLD_WIDTH + 40, WORLD_HEIGHT);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawMountains(ctx) {
    drawMountainLayer(ctx, 398, 128, "#6d8078", 11, 1.2);
    drawMountainLayer(ctx, 430, 96, "#546c65", 27, 2.1);
    drawMountainLayer(ctx, 456, 68, "#405b55", 43, 3.4);

    const haze = ctx.createLinearGradient(0, 350, 0, 470);
    haze.addColorStop(0, "rgba(224, 190, 146, 0)");
    haze.addColorStop(0.6, "rgba(224, 190, 146, 0.12)");
    haze.addColorStop(1, "rgba(228, 192, 145, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 330, WORLD_WIDTH, 160);
  }

  function drawWater(ctx, rand) {
    const water = ctx.createLinearGradient(0, 464, 0, WORLD_HEIGHT);
    water.addColorStop(0, "#344f4e");
    water.addColorStop(0.24, "#1d3738");
    water.addColorStop(0.7, "#102626");
    water.addColorStop(1, "#091817");
    ctx.fillStyle = water;
    ctx.fillRect(0, 457, WORLD_WIDTH, WORLD_HEIGHT - 457);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 150; i += 1) {
      const x = rand() * WORLD_WIDTH;
      const y = 470 + Math.pow(rand(), 1.45) * 236;
      const width = 18 + rand() * 120;
      const alpha = 0.025 + rand() * 0.08;
      ctx.fillStyle = `rgba(245, 191, 119, ${alpha})`;
      ctx.fillRect(x - width / 2, y, width, 0.8 + rand() * 1.2);
    }
    ctx.restore();

    const sunPath = ctx.createLinearGradient(0, 470, 0, 690);
    sunPath.addColorStop(0, "rgba(255, 201, 124, 0.46)");
    sunPath.addColorStop(0.4, "rgba(255, 177, 101, 0.17)");
    sunPath.addColorStop(1, "rgba(255, 159, 85, 0)");
    ctx.fillStyle = sunPath;
    ctx.beginPath();
    ctx.moveTo(1060, 459);
    ctx.lineTo(1166, 459);
    ctx.lineTo(1242, 708);
    ctx.lineTo(976, 708);
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 34; i += 1) {
      const y = 477 + i * 7.2 + rand() * 4;
      const center = 1109 + Math.sin(i * 1.7) * 14;
      const width = 34 + rand() * 115 + i * 1.6;
      ctx.fillStyle = `rgba(255, 219, 160, ${0.15 - i * 0.003})`;
      ctx.fillRect(center - width / 2, y, width, 1);
    }
  }

  function drawIslands(ctx, rand) {
    ctx.fillStyle = "#1c302d";
    ctx.beginPath();
    ctx.moveTo(760, 475);
    ctx.bezierCurveTo(806, 449, 855, 459, 892, 472);
    ctx.bezierCurveTo(936, 488, 973, 479, 1028, 492);
    ctx.lineTo(1045, 514);
    ctx.bezierCurveTo(951, 508, 850, 516, 751, 499);
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 28; i += 1) {
      const x = 792 + rand() * 225;
      const y = 474 + rand() * 24;
      ctx.fillStyle = `rgba(105, 135, 114, ${0.12 + rand() * 0.18})`;
      ctx.fillRect(x, y, 1.5 + rand() * 5, 0.8);
    }
  }

  function drawLighthouse(ctx) {
    const x = 1112;
    const baseY = 470;
    ctx.fillStyle = "#243b37";
    ctx.beginPath();
    ctx.moveTo(x - 33, baseY);
    ctx.lineTo(x + 30, baseY);
    ctx.lineTo(x + 21, baseY + 25);
    ctx.lineTo(x - 24, baseY + 25);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(x + 38, 348);
    ctx.rotate(-0.035);
    ctx.fillStyle = "#d8d5c5";
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(9, 0);
    ctx.lineTo(13, 91);
    ctx.lineTo(-12, 91);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#a84f3d";
    ctx.fillRect(-10, 26, 21, 15);
    ctx.fillRect(-12, 67, 25, 13);
    ctx.fillStyle = "#1b2d2b";
    ctx.fillRect(-7, 84, 15, 15);
    ctx.fillStyle = "#f1c06f";
    ctx.fillRect(-8, -7, 16, 11);
    ctx.fillStyle = "#3b4841";
    ctx.beginPath();
    ctx.moveTo(-11, -7);
    ctx.lineTo(0, -19);
    ctx.lineTo(11, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const lampGlow = ctx.createRadialGradient(x + 38, 350, 0, x + 38, 350, 36);
    lampGlow.addColorStop(0, "rgba(255, 221, 149, 0.52)");
    lampGlow.addColorStop(1, "rgba(255, 193, 94, 0)");
    ctx.fillStyle = lampGlow;
    ctx.fillRect(x - 5, 307, 86, 86);
    ctx.restore();
  }

  function drawPier(ctx, rand) {
    ctx.strokeStyle = "rgba(29, 43, 39, 0.88)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(304, 526);
    ctx.lineTo(390, 501);
    ctx.lineTo(462, 508);
    ctx.stroke();
    for (let i = 0; i < 13; i += 1) {
      const x = 312 + i * 11;
      const y = 524 - i * 1.7;
      ctx.strokeStyle = "rgba(23, 38, 35, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1, y + 17 + rand() * 4);
      ctx.stroke();
    }
  }

  function drawForeground(ctx, rand) {
    ctx.fillStyle = "#0b1716";
    ctx.beginPath();
    ctx.moveTo(0, 522);
    ctx.bezierCurveTo(36, 510, 91, 527, 132, 552);
    ctx.bezierCurveTo(176, 579, 226, 584, 281, 603);
    ctx.bezierCurveTo(344, 625, 391, 646, 431, 720);
    ctx.lineTo(0, 720);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(WORLD_WIDTH, 538);
    ctx.bezierCurveTo(1662, 518, 1577, 540, 1518, 571);
    ctx.bezierCurveTo(1467, 598, 1406, 617, 1369, 654);
    ctx.bezierCurveTo(1341, 682, 1327, 702, 1315, 720);
    ctx.lineTo(WORLD_WIDTH, 720);
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 60; i += 1) {
      const left = i < 32;
      const x = left ? rand() * 350 : 1410 + rand() * 310;
      const base = left ? 592 + rand() * 118 : 610 + rand() * 100;
      const height = 8 + rand() * 42;
      ctx.strokeStyle = `rgba(55, 75, 62, ${0.2 + rand() * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + (rand() - 0.5) * 8, base - height * 0.6, x + (rand() - 0.5) * 15, base - height);
      ctx.stroke();
    }
  }

  function drawDetails(ctx, rand) {
    drawIslands(ctx, rand);
    drawLighthouse(ctx);
    drawPier(ctx, rand);

    ctx.fillStyle = "rgba(21, 35, 32, 0.82)";
    const birds = [
      [460, 216, 1], [483, 205, 0.72], [522, 228, 0.55],
      [1234, 183, 0.8], [1252, 191, 0.55], [987, 156, 0.62]
    ];
    for (const [x, y, scale] of birds) {
      ctx.beginPath();
      ctx.moveTo(x - 7 * scale, y);
      ctx.quadraticCurveTo(x - 3 * scale, y - 4 * scale, x, y);
      ctx.quadraticCurveTo(x + 3 * scale, y - 4 * scale, x + 7 * scale, y);
      ctx.fill();
    }

    for (let i = 0; i < 420; i += 1) {
      const x = rand() * WORLD_WIDTH;
      const y = rand() * WORLD_HEIGHT;
      ctx.fillStyle = `rgba(238, 226, 201, ${rand() * 0.035})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  function drawVignette(ctx) {
    const vignette = ctx.createRadialGradient(
      WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 260,
      WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 980
    );
    vignette.addColorStop(0, "rgba(7, 14, 13, 0)");
    vignette.addColorStop(0.72, "rgba(7, 14, 13, 0.08)");
    vignette.addColorStop(1, "rgba(7, 14, 13, 0.4)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  function generateWorld() {
    const canvas = makeCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rand = mulberry32(5242026);
    drawSky(ctx, rand);
    drawMountains(ctx);
    drawWater(ctx, rand);
    drawDetails(ctx, rand);
    drawForeground(ctx, rand);
    drawVignette(ctx);
    return canvas;
  }

  function applyExposure(world, cropX, exposure) {
    const canvas = makeCanvas(FRAME_WIDTH, FRAME_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.filter = `brightness(${exposure.toFixed(3)}) saturate(0.97)`;
    ctx.drawImage(
      world,
      cropX, 0, FRAME_WIDTH, FRAME_HEIGHT,
      0, 0, FRAME_WIDTH, FRAME_HEIGHT
    );
    ctx.filter = "none";

    const tint = ctx.createLinearGradient(0, 0, 0, FRAME_HEIGHT);
    tint.addColorStop(0, "rgba(13, 31, 35, 0.035)");
    tint.addColorStop(1, "rgba(42, 25, 13, 0.025)");
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    return canvas;
  }

  function generateFrames() {
    const world = generateWorld();
    const exposures = [0.80, 1.0, 1.15];
    const frames = FRAME_X.map((cropX, index) => {
      const canvas = applyExposure(world, cropX, exposures[index]);
      return {
        id: `FRM_0${index + 1}`,
        name: `IMG_${String(index + 1).padStart(4, "0")}.PNG`,
        canvas,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        cropX,
        capturedExposure: exposures[index],
        defaultX: cropX,
        defaultExposure: Number((-Math.log2(exposures[index])).toFixed(2))
      };
    });
    return { world, frames };
  }

  window.PanoScene = {
    WORLD_WIDTH,
    WORLD_HEIGHT,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    FRAME_X,
    OVERLAP,
    generateFrames,
    makeCanvas
  };
})();
