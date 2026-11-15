import { FAULTS, REEFS, TOOLS, WORLD, currentAt } from "./sim.js";

const TAU = Math.PI * 2;
const CABLE_PATH = [
  [66, 842],
  [252, 813],
  [365, 705],
  [520, 748],
  [645, 775],
  [846, 812],
  [1018, 791],
  [1175, 710],
  [1310, 756],
  [1532, 806],
];

const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function tensionColor(state) {
  const tension = state.cable.tension;
  if (tension > 1.48) return "#ff5f57";
  if (tension > 1.26) return "#ffad63";
  return "#62ded0";
}

function smoothPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    ctx.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function cablePoint(state, t) {
  const distance = Math.hypot(state.pod.x - WORLD.anchorX, state.pod.y - WORLD.anchorY);
  const slack = Math.max(0, state.cable.length - distance);
  const sag = Math.min(145, slack * 0.48);
  const sway = Math.min(38, slack * 0.1);
  const bow = Math.sin(t * Math.PI);
  return {
    x:
      lerp(WORLD.anchorX, state.pod.x, t) +
      bow * sway * Math.sin(state.time * 0.42 + t * 4.4),
    y:
      lerp(WORLD.anchorY, state.pod.y, t) +
      bow * (sag + Math.sin(state.time * 0.7 + t * 6) * 4),
  };
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.scale = Math.min(width / WORLD.width, height / WORLD.height);
    this.offsetX = (width - WORLD.width * this.scale) / 2;
    this.offsetY = (height - WORLD.height * this.scale) / 2;
  }

  draw(state, nearbyFault = null) {
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#020f13";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    this.drawBackground(state);
    this.drawCurrent(state);
    this.drawRockWalls();
    this.drawSeabedCable(state);
    this.drawFaults(state, nearbyFault);
    this.drawUmbilical(state);
    this.drawDrifters(state);
    this.drawPod(state);
    this.drawShip(state);
    this.drawSurfaceParticles(state);
    this.drawWorldFrame();
    ctx.restore();
  }

  drawBackground(state) {
    const ctx = this.ctx;
    const water = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    water.addColorStop(0, "#0d3a43");
    water.addColorStop(0.24, "#082a32");
    water.addColorStop(0.62, "#041b22");
    water.addColorStop(1, "#020f14");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const glow = ctx.createRadialGradient(800, 60, 10, 800, 250, 650);
    glow.addColorStop(0, "rgba(122, 227, 211, 0.14)");
    glow.addColorStop(0.45, "rgba(34, 121, 127, 0.05)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WORLD.width, 720);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let ray = 0; ray < 5; ray += 1) {
      const originX = 300 + ray * 250 + Math.sin(state.time * 0.08 + ray) * 80;
      const drift = Math.sin(state.time * 0.11 + ray * 1.9) * 90;
      const rayGradient = ctx.createLinearGradient(originX, 40, originX + drift, 650);
      rayGradient.addColorStop(0, "rgba(142, 245, 229, 0.085)");
      rayGradient.addColorStop(0.55, "rgba(82, 196, 187, 0.026)");
      rayGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = rayGradient;
      ctx.beginPath();
      ctx.moveTo(originX - 18, 30);
      ctx.lineTo(originX + 36, 30);
      ctx.lineTo(originX + drift + 150, 680);
      ctx.lineTo(originX + drift - 105, 680);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#6cc8c1";
    ctx.lineWidth = 1;
    for (let line = 0; line < 8; line += 1) {
      const y = 220 + line * 78;
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(line * 2.7) * 8);
      ctx.bezierCurveTo(420, y - 18, 980, y + 16, 1600, y - 3);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(161, 231, 221, 0.24)";
    for (let particle = 0; particle < 64; particle += 1) {
      const x = mod(particle * 229.3 + state.time * (2.2 + (particle % 5) * 0.5), WORLD.width);
      const y = 115 + ((particle * 83.7) % 680);
      const size = 0.45 + (particle % 4) * 0.25;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
  }

  drawCurrent(state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    for (let stream = 0; stream < 11; stream += 1) {
      const baseY = 145 + stream * 59;
      ctx.beginPath();
      for (let x = -40; x <= 1640; x += 40) {
        const wave =
          Math.sin(x * 0.007 + state.time * (0.34 + stream * 0.014) + stream * 1.4) * (9 + (stream % 3) * 3) +
          Math.sin(x * 0.019 - state.time * 0.5 + stream) * 2.5;
        if (x === -40) ctx.moveTo(x, baseY + wave);
        else ctx.lineTo(x, baseY + wave);
      }
      ctx.strokeStyle = stream % 4 === 0 ? "rgba(99, 224, 209, 0.14)" : "rgba(88, 194, 187, 0.065)";
      ctx.lineWidth = stream % 4 === 0 ? 1.15 : 0.7;
      ctx.setLineDash(stream % 4 === 0 ? [2, 23] : [1, 29]);
      ctx.lineDashOffset = -state.time * (32 + stream * 2.2) - stream * 11;
      ctx.stroke();
    }
    ctx.restore();

    const px = state.pod.x;
    const py = state.pod.y;
    const local = currentAt(state, px, py);
    ctx.save();
    ctx.translate(px + 68, py - 5);
    ctx.strokeStyle = "rgba(117, 229, 215, 0.5)";
    ctx.fillStyle = "rgba(117, 229, 215, 0.5)";
    ctx.lineWidth = 1.2;
    const length = 22 + Math.abs(local.x) * 1.3;
    const direction = local.x >= 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(-length / 2, 0);
    ctx.lineTo(length / 2, 0);
    ctx.lineTo(length / 2 - direction * 5, -3);
    ctx.moveTo(length / 2, 0);
    ctx.lineTo(length / 2 - direction * 5, 3);
    ctx.stroke();
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.fillText("CURRENT", -length / 2, -8);
    ctx.restore();
  }

  drawRockWalls() {
    const ctx = this.ctx;
    const left = [
      [0, 326], [45, 348], [66, 402], [96, 431], [77, 485], [126, 520],
      [109, 581], [142, 624], [119, 678], [155, 724], [124, 789], [94, 841],
      [0, 860],
    ];
    const right = [
      [1600, 298], [1554, 332], [1527, 388], [1488, 425], [1510, 475], [1466, 521],
      [1484, 580], [1450, 632], [1471, 687], [1439, 735], [1462, 794], [1490, 845],
      [1600, 868],
    ];

    for (const side of [left, right]) {
      ctx.save();
      const gradient = ctx.createLinearGradient(side === left ? 0 : 1600, 300, side === left ? 160 : 1440, 860);
      gradient.addColorStop(0, "#061b20");
      gradient.addColorStop(1, "#020b0e");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(side[0][0], side[0][1]);
      side.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(111, 164, 158, 0.17)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = "rgba(81, 136, 131, 0.37)";
      ctx.lineWidth = 1;
      for (let ridge = 0; ridge < 6; ridge += 1) {
        const anchor = side[Math.min(side.length - 2, ridge + 2)];
        const edge = side === left ? 160 : 1440;
        ctx.beginPath();
        ctx.moveTo(anchor[0], anchor[1]);
        ctx.quadraticCurveTo(anchor[0] + (edge - anchor[0]) * 0.3, anchor[1] + 20, edge, anchor[1] + 35 + ridge * 38);
        ctx.stroke();
      }
      ctx.restore();
    }

    const floor = ctx.createLinearGradient(0, 760, 0, 900);
    floor.addColorStop(0, "#051a1d");
    floor.addColorStop(1, "#020a0c");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.moveTo(0, 810);
    for (let x = 0; x <= 1600; x += 50) {
      ctx.lineTo(x, 812 + Math.sin(x * 0.009) * 10 + Math.sin(x * 0.027) * 5);
    }
    ctx.lineTo(1600, 900);
    ctx.lineTo(0, 900);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(108, 171, 161, 0.24)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= 1600; x += 24) {
      const y = 812 + Math.sin(x * 0.009) * 10 + Math.sin(x * 0.027) * 5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (const [index, reef] of REEFS.entries()) {
      ctx.save();
      ctx.translate(reef.x, reef.y);
      ctx.fillStyle = index % 2 ? "#04171a" : "#061c1f";
      ctx.strokeStyle = "rgba(83, 143, 137, 0.18)";
      ctx.beginPath();
      for (let point = 0; point < 18; point += 1) {
        const angle = (point / 18) * TAU;
        const radius = reef.r * (0.82 + Math.sin(point * 3.7 + index) * 0.12);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.52;
        if (point === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "rgba(102, 165, 156, 0.2)";
      for (let twig = 0; twig < 6; twig += 1) {
        const x = -reef.r * 0.55 + twig * reef.r * 0.21;
        ctx.beginPath();
        ctx.moveTo(x, -reef.r * 0.14);
        ctx.quadraticCurveTo(x + Math.sin(twig) * 12, -reef.r * 0.3, x + Math.sin(twig) * 19, -reef.r * 0.48);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawSeabedCable(state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    smoothPath(ctx, CABLE_PATH);
    ctx.strokeStyle = "rgba(0, 7, 8, 0.8)";
    ctx.lineWidth = 11;
    ctx.stroke();
    smoothPath(ctx, CABLE_PATH);
    ctx.strokeStyle = "rgba(47, 105, 102, 0.55)";
    ctx.lineWidth = 5;
    ctx.stroke();
    smoothPath(ctx, CABLE_PATH);
    ctx.strokeStyle = "rgba(119, 182, 172, 0.24)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.setLineDash([3, 13]);
    ctx.lineDashOffset = -state.time * 12;
    smoothPath(ctx, CABLE_PATH);
    ctx.strokeStyle = "rgba(92, 218, 203, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawFaults(state, nearbyFault) {
    const ctx = this.ctx;
    for (const fault of state.faults) {
      const active = nearbyFault && nearbyFault.id === fault.id;
      const pulse = (Math.sin(state.time * 2.2 + fault.x * 0.01) + 1) / 2;
      ctx.save();
      ctx.translate(fault.x, fault.y);

      if (fault.done) {
        ctx.strokeStyle = "rgba(99, 224, 209, 0.75)";
        ctx.fillStyle = "rgba(99, 224, 209, 0.13)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#a8f2e7";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(-2, 8);
        ctx.lineTo(11, -9);
        ctx.stroke();
        ctx.fillStyle = "rgba(99, 224, 209, 0.8)";
        ctx.font = "600 9px 'Noto Sans SC', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${fault.code} / SPLICED`, 0, 43);
        ctx.restore();
        continue;
      }

      const innerGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 70);
      innerGlow.addColorStop(0, "rgba(255, 126, 61, 0.25)");
      innerGlow.addColorStop(0.5, "rgba(255, 142, 68, 0.05)");
      innerGlow.addColorStop(1, "rgba(255, 142, 68, 0)");
      ctx.fillStyle = innerGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 70 + pulse * 8, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = active ? "#ff9c55" : "rgba(255, 156, 85, 0.5)";
      ctx.lineWidth = active ? 1.8 : 1;
      ctx.setLineDash([7, 8, 2, 8]);
      ctx.lineDashOffset = -state.time * 18;
      ctx.beginPath();
      ctx.arc(0, 0, fault.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      const bracket = active ? 12 : 8;
      ctx.strokeStyle = active ? "rgba(255, 170, 99, 0.9)" : "rgba(255, 156, 85, 0.48)";
      ctx.lineWidth = 1.2;
      for (let corner = 0; corner < 4; corner += 1) {
        const sx = corner % 2 === 0 ? -1 : 1;
        const sy = corner < 2 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(sx * (fault.radius - bracket), sy * fault.radius);
        ctx.lineTo(sx * fault.radius, sy * fault.radius);
        ctx.lineTo(sx * fault.radius, sy * (fault.radius - bracket));
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(255, 164, 90, 0.62)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-20, -3);
      ctx.lineTo(-5, 1);
      ctx.lineTo(2, -7);
      ctx.lineTo(12, 5);
      ctx.lineTo(23, -2);
      ctx.stroke();

      if (fault.progress > 0) {
        ctx.strokeStyle = "#ffcf96";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, fault.radius + 8, -Math.PI / 2, -Math.PI / 2 + TAU * fault.progress);
        ctx.stroke();
      }

      ctx.fillStyle = active ? "#ffd1a6" : "rgba(255, 181, 117, 0.68)";
      ctx.font = "600 10px 'Noto Sans SC', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${fault.id} 断点`, 0, fault.radius + 17);
      ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
      ctx.fillStyle = active ? "rgba(255,222,193,.8)" : "rgba(197,151,117,.6)";
      ctx.fillText(`需要 ${TOOLS[fault.tool - 1].name}`, 0, fault.radius + 29);
      ctx.restore();
    }
  }

  drawUmbilical(state) {
    const ctx = this.ctx;
    const color = tensionColor(state);
    const broken = state.status === "failed" && state.cable.tensionTime >= 0.5;
    const endT = broken ? 0.74 : 1;
    const points = [];
    const segments = 30;
    for (let index = 0; index <= segments; index += 1) {
      points.push(cablePoint(state, (index / segments) * endT));
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = state.cable.tension > 1.35 ? 14 : 7;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = state.cable.tension > 1.4 ? 3.5 : 2.7;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = "#d7fff7";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    if (!broken) {
      ctx.globalAlpha = 1;
      for (let pulse = 0; pulse < 3; pulse += 1) {
        const t = mod(state.time * 0.19 + pulse / 3, 1);
        const point = cablePoint(state, t);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.2, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(210, 255, 249, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 6, 0, TAU);
        ctx.stroke();
      }
    } else {
      const end = points[points.length - 1];
      ctx.fillStyle = "#ff5f57";
      ctx.shadowColor = "#ff5f57";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, TAU);
      ctx.fill();
      for (let spark = 0; spark < 8; spark += 1) {
        const angle = spark * 1.9 + state.time * 4;
        const radius = 7 + (spark % 3) * 5;
        ctx.fillRect(end.x + Math.cos(angle) * radius, end.y + Math.sin(angle) * radius, 1.5, 1.5);
      }
    }
    ctx.restore();

    const end = cablePoint(state, endT);
    ctx.save();
    ctx.strokeStyle = "rgba(160, 220, 213, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 10, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawDrifters(state) {
    const ctx = this.ctx;
    for (const drifter of state.drifters) {
      ctx.save();
      ctx.translate(drifter.x, drifter.y);
      ctx.rotate(drifter.angle);

      const danger = drifter.cooldown > 0;
      ctx.shadowColor = danger ? "rgba(255, 95, 87, 0.8)" : "rgba(255, 156, 85, 0.36)";
      ctx.shadowBlur = danger ? 20 : 9;

      if (drifter.type === 0) {
        ctx.fillStyle = "#183335";
        ctx.strokeStyle = "rgba(228, 187, 122, 0.5)";
        ctx.lineWidth = 1;
        roundedRect(ctx, -drifter.r * 0.8, -drifter.r * 0.55, drifter.r * 1.6, drifter.r * 1.1, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 164, 85, 0.65)";
        ctx.fillRect(-drifter.r * 0.8, -2, drifter.r * 1.6, 4);
      } else if (drifter.type === 1) {
        ctx.fillStyle = "#172d30";
        ctx.strokeStyle = "rgba(107, 202, 189, 0.48)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, drifter.r * 0.58, drifter.r, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(110, 207, 195, 0.38)";
        ctx.beginPath();
        ctx.ellipse(0, -drifter.r * 0.15, drifter.r * 0.58, drifter.r * 0.78, 0, 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#1b302f";
        ctx.strokeStyle = "rgba(205, 176, 117, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let point = 0; point < 8; point += 1) {
          const angle = (point / 8) * TAU;
          const radius = drifter.r * (0.84 + Math.sin(point * 2.4) * 0.12);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (point === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.strokeStyle = danger ? "#ff5f57" : "rgba(255, 156, 85, 0.48)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, drifter.r + 4, 0, TAU);
      ctx.stroke();
      const blinker = (state.time * 1.7 + drifter.id * 0.3) % 1;
      if (blinker < 0.08) {
        ctx.fillStyle = "#ff8d5b";
        ctx.fillRect(drifter.r * 0.35, -drifter.r * 0.5, 2, 2);
      }
      ctx.restore();
    }
  }

  drawPod(state) {
    const ctx = this.ctx;
    const pod = state.pod;
    ctx.save();
    ctx.translate(pod.x, pod.y);

    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 60);
    glow.addColorStop(0, "rgba(115, 237, 220, 0.17)");
    glow.addColorStop(0.5, "rgba(255, 157, 82, 0.06)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, TAU);
    ctx.fill();

    ctx.rotate(pod.angle - Math.PI / 2);
    const sputtering = Math.min(1, Math.hypot(pod.vx, pod.vy) / 90);
    ctx.fillStyle = "rgba(110, 235, 220, 0.42)";
    for (let bubble = 0; bubble < 5; bubble += 1) {
      const phase = mod(state.time * 1.2 + bubble * 0.23, 1);
      ctx.beginPath();
      ctx.arc(-22 - bubble * 2, 19 + phase * 20, 1.4 + phase * 1.6, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(22 + bubble, 18 + phase * 17, 1 + phase * 1.2, 0, TAU);
      ctx.fill();
    }

    ctx.shadowColor = "rgba(255, 156, 85, 0.45)";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "#132b2d";
    ctx.strokeStyle = "#ff9c55";
    ctx.lineWidth = 1.2;
    roundedRect(ctx, -19, -25, 38, 50, 9);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    const body = ctx.createLinearGradient(-18, 0, 19, 0);
    body.addColorStop(0, "#5d3b25");
    body.addColorStop(0.35, "#d47736");
    body.addColorStop(0.62, "#bd642c");
    body.addColorStop(1, "#382a22");
    ctx.fillStyle = body;
    roundedRect(ctx, -14, -19, 28, 37, 6);
    ctx.fill();

    ctx.fillStyle = "#d8d5bc";
    roundedRect(ctx, -8, -11, 16, 12, 2);
    ctx.fill();
    ctx.fillStyle = "#092126";
    ctx.fillRect(-6, -8, 12, 3);
    ctx.fillRect(-6, -3, 8, 2);

    ctx.fillStyle = "#ffb76f";
    ctx.fillRect(-15, 9, 30, 3);
    ctx.fillStyle = "#07181c";
    ctx.fillRect(-12, 13, 10, 5);
    ctx.fillRect(4, 13, 10, 5);
    ctx.strokeStyle = "rgba(95, 223, 207, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, 14);
    ctx.lineTo(-12, 18);
    ctx.moveTo(4, 14);
    ctx.lineTo(4, 18);
    ctx.stroke();

    ctx.fillStyle = "#ffd6a2";
    ctx.beginPath();
    ctx.arc(-8, 22, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 230, 183, 0.15)";
    ctx.beginPath();
    ctx.arc(-8, 28, 14, 0.1, Math.PI - 0.1);
    ctx.fill();

    ctx.fillStyle = "#ecad62";
    ctx.strokeStyle = "#221811";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-17, -17);
    ctx.lineTo(-24, -9);
    ctx.lineTo(-21, -4);
    ctx.lineTo(-16, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(17, -17);
    ctx.lineTo(24, -9);
    ctx.lineTo(21, -4);
    ctx.lineTo(16, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(171, 230, 220, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -27, 6, Math.PI, TAU);
    ctx.stroke();
    ctx.fillStyle = "#ff9c55";
    ctx.beginPath();
    ctx.arc(0, -33, 1.5, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(0, 25);
    this.drawToolGlyph(state.selectedTool, 8, "#ffbd77");
    ctx.restore();

    if (sputtering > 0.25) {
      ctx.strokeStyle = "rgba(104, 221, 208, 0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 27 + sputtering * 4, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    if (state.cable.tension > 1.3) {
      ctx.save();
      ctx.translate(pod.x, pod.y);
      ctx.strokeStyle = state.cable.tension > 1.48 ? "rgba(255,95,87,.85)" : "rgba(255,175,99,.7)";
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 36, state.time * 2, state.time * 2 + Math.PI * 1.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawToolGlyph(tool, size, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.3;
    if (tool === 1) {
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.55);
      ctx.lineTo(size * 0.2, 0);
      ctx.lineTo(-size, size * 0.55);
      ctx.moveTo(size * 0.2, 0);
      ctx.lineTo(size, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(size * 0.65, 0, size * 0.28, 0, TAU);
      ctx.stroke();
    } else if (tool === 2) {
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.7);
      ctx.lineTo(-size * 0.3, 0);
      ctx.lineTo(-size, size * 0.7);
      ctx.moveTo(size, -size * 0.7);
      ctx.lineTo(size * 0.3, 0);
      ctx.lineTo(size, size * 0.7);
      ctx.stroke();
      ctx.fillRect(-size * 0.25, -size * 0.16, size * 0.5, size * 0.32);
    } else {
      ctx.beginPath();
      ctx.moveTo(-size, size * 0.2);
      ctx.lineTo(size * 0.6, -size * 0.5);
      ctx.stroke();
      ctx.fillRect(size * 0.35, -size * 0.66, size * 0.5, size * 0.48);
      ctx.beginPath();
      ctx.arc(-size, size * 0.3, size * 0.18, 0, TAU);
      ctx.fill();
    }
  }

  drawShip(state) {
    const ctx = this.ctx;
    const bob = Math.sin(state.time * 0.32) * 1.5;
    ctx.save();
    ctx.translate(0, bob);

    const surface = ctx.createLinearGradient(0, 0, 0, 120);
    surface.addColorStop(0, "rgba(143, 238, 226, 0.16)");
    surface.addColorStop(0.15, "rgba(54, 139, 141, 0.08)");
    surface.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, 1600, 120);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const lamp of [690, 910]) {
      const beam = ctx.createLinearGradient(lamp, 86, lamp + (lamp < 800 ? -90 : 90), 420);
      beam.addColorStop(0, "rgba(255, 228, 174, 0.12)");
      beam.addColorStop(1, "rgba(255, 218, 156, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(lamp - 8, 88);
      ctx.lineTo(lamp + 8, 88);
      ctx.lineTo(lamp + (lamp < 800 ? -130 : 130), 430);
      ctx.lineTo(lamp + (lamp < 800 ? -220 : 220), 430);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "#0a2125";
    ctx.strokeStyle = "rgba(160, 220, 210, 0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(626, 53);
    ctx.lineTo(688, 33);
    ctx.lineTo(765, 31);
    ctx.lineTo(784, 16);
    ctx.lineTo(870, 16);
    ctx.lineTo(886, 32);
    ctx.lineTo(966, 38);
    ctx.lineTo(1014, 58);
    ctx.lineTo(982, 90);
    ctx.lineTo(920, 104);
    ctx.lineTo(842, 108);
    ctx.lineTo(760, 106);
    ctx.lineTo(682, 94);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#d7d5bd";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(681, 59);
    ctx.lineTo(748, 47);
    ctx.lineTo(760, 72);
    ctx.lineTo(699, 77);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#263c3c";
    ctx.beginPath();
    ctx.moveTo(783, 33);
    ctx.lineTo(855, 33);
    ctx.lineTo(865, 65);
    ctx.lineTo(775, 65);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ff9c55";
    ctx.fillRect(804, 23, 34, 3);
    ctx.fillStyle = "#142a2d";
    ctx.fillRect(720, 78, 164, 13);
    ctx.fillStyle = "#08171a";
    ctx.beginPath();
    ctx.ellipse(800, 91, 34, 8, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 156, 85, 0.68)";
    ctx.stroke();

    ctx.fillStyle = "#0b1d20";
    ctx.strokeStyle = "rgba(137, 206, 198, 0.35)";
    ctx.beginPath();
    ctx.arc(800, 93, 13, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#ff9c55";
    ctx.beginPath();
    ctx.arc(800, 93, 7, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = "#ffcf92";
    for (const lamp of [690, 910]) {
      ctx.beginPath();
      ctx.arc(lamp, 86, 2.5, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(180, 225, 218, 0.52)";
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("DSV  KESTREL  /  WINCH 01", 800, 122);

    ctx.strokeStyle = "rgba(170, 224, 216, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(608, 55);
    ctx.lineTo(670, 96);
    ctx.moveTo(1032, 59);
    ctx.lineTo(974, 98);
    ctx.stroke();
    ctx.restore();

    if (state.repairedCount === state.faults.length) {
      const ctx2 = this.ctx;
      const pulse = (Math.sin(state.time * 2.6) + 1) / 2;
      ctx2.save();
      ctx2.translate(800, 158);
      ctx2.strokeStyle = `rgba(99, 224, 209, ${0.35 + pulse * 0.25})`;
      ctx2.lineWidth = 1.5;
      ctx2.setLineDash([4, 9]);
      ctx2.lineDashOffset = -state.time * 16;
      ctx2.beginPath();
      ctx2.arc(0, 0, 76, 0, TAU);
      ctx2.stroke();
      if (state.recoveryProgress > 0) {
        ctx2.strokeStyle = "#9ff3e7";
        ctx2.lineWidth = 3;
        ctx2.setLineDash([]);
        ctx2.beginPath();
        ctx2.arc(0, 0, 79, -Math.PI / 2, -Math.PI / 2 + TAU * (state.recoveryProgress / 2.2));
        ctx2.stroke();
      }
      ctx2.fillStyle = "rgba(159, 243, 231, 0.78)";
      ctx2.font = "8px ui-monospace, monospace";
      ctx2.textAlign = "center";
      ctx2.fillText("RECOVERY WINDOW", 0, 94);
      ctx2.restore();
    }
  }

  drawSurfaceParticles(state) {
    const ctx = this.ctx;
    ctx.save();
    for (let bubble = 0; bubble < 22; bubble += 1) {
      const phase = (state.time * (0.08 + (bubble % 4) * 0.02) + bubble * 0.071) % 1;
      const x = 580 + mod(bubble * 91.7, 440) + Math.sin(state.time + bubble) * 4;
      const y = 120 + phase * (650 + (bubble % 5) * 18);
      ctx.strokeStyle = `rgba(123, 225, 213, ${0.2 * (1 - phase)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, 1.3 + (bubble % 3) * 0.45, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(103, 181, 169, 0.2)";
    for (let mote = 0; mote < 48; mote += 1) {
      const x = mod(mote * 167.1 + state.time * 1.3, 1600);
      const y = 220 + ((mote * 47.9) % 590);
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  }

  drawWorldFrame() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(132, 206, 198, 0.21)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 9]);
    for (const depth of [300, 600]) {
      ctx.beginPath();
      ctx.moveTo(38, depth);
      ctx.lineTo(82, depth);
      ctx.moveTo(1518, depth);
      ctx.lineTo(1562, depth);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(164, 218, 211, 0.34)";
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("D-300", 39, 294);
    ctx.fillText("D-600", 39, 594);

    ctx.strokeStyle = "rgba(132, 206, 198, 0.24)";
    ctx.beginPath();
    ctx.moveTo(36, 38);
    ctx.lineTo(36, 64);
    ctx.moveTo(32, 49);
    ctx.lineTo(40, 49);
    ctx.moveTo(1564, 38);
    ctx.lineTo(1564, 64);
    ctx.moveTo(1560, 49);
    ctx.lineTo(1568, 49);
    ctx.stroke();
    ctx.restore();
  }
}
