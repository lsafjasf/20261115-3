import { CRITICAL_LIMIT_C, HOTSPOT_LIMIT_C, ROWS } from "./simulation.js";

const DESIGN_W = 1000;
const DESIGN_H = 470;
const RACK_START_X = 92;
const RACK_W = 51;
const RACK_GAP = 7.2;
const RACK_H = 59;
const ROW_Y = [72, 194, 316];
const CHILLER = { x: 840, y: 74, w: 112, h: 318 };
const MONO = '"SFMono-Regular", "Cascadia Code", monospace';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function mixColor(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const t = clamp(amount, 0, 1);
  const channel = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${channel(a.r, b.r)}, ${channel(a.g, b.g)}, ${channel(a.b, b.b)})`;
}

export function temperatureColor(temp) {
  if (temp <= 21) return mixColor("#2b9fbd", "#42c6d0", (temp - 18) / 3);
  if (temp <= 24.5) return mixColor("#42c6d0", "#67edbf", (temp - 21) / 3.5);
  if (temp <= HOTSPOT_LIMIT_C) return mixColor("#67edbf", "#e7cc61", (temp - 24.5) / 4);
  if (temp <= CRITICAL_LIMIT_C + 3) {
    return mixColor("#e7cc61", "#ff795f", (temp - HOTSPOT_LIMIT_C) / 5.5);
  }
  return mixColor("#ff795f", "#d63c36", (temp - CRITICAL_LIMIT_C - 3) / 5);
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

function text(ctx, value, x, y, size, color, align = "left", weight = 400, family = MONO) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

export class FacilityRenderer {
  constructor(canvas, sim, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sim = sim;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.hoveredId = null;
    this.onHover = options.onHover;
    this.onSelect = options.onSelect;
    this.bindPointer();
    this.resize();
  }

  bindPointer() {
    this.canvas.addEventListener("pointermove", (event) => {
      const rack = this.hitTest(event.clientX, event.clientY);
      this.hoveredId = rack?.id ?? null;
      this.canvas.style.cursor = rack ? "pointer" : "crosshair";
      this.onHover?.(rack, event);
    });

    this.canvas.addEventListener("pointerleave", () => {
      this.hoveredId = null;
      this.onHover?.(null);
    });

    this.canvas.addEventListener("click", (event) => {
      const rack = this.hitTest(event.clientX, event.clientY);
      if (rack) this.onSelect?.(rack);
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth;
      this.canvas.height = nextHeight;
    }
    this.dpr = dpr;
    this.scale = Math.min(rect.width / DESIGN_W, rect.height / DESIGN_H);
    this.offsetX = (rect.width - DESIGN_W * this.scale) / 2;
    this.offsetY = (rect.height - DESIGN_H * this.scale) / 2;
  }

  rackRect(rack) {
    return {
      x: RACK_START_X + rack.col * (RACK_W + RACK_GAP),
      y: ROW_Y[rack.row],
      w: RACK_W,
      h: RACK_H
    };
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.offsetX) / this.scale;
    const y = (clientY - rect.top - this.offsetY) / this.scale;
    if (x < 0 || y < 0 || x > DESIGN_W || y > DESIGN_H) return null;
    return this.sim.racks.find((rack) => {
      const box = this.rackRect(rack);
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    });
  }

  draw(timeMs = performance.now()) {
    this.resize();
    const ctx = this.ctx;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    this.drawBoard(ctx);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    this.drawInfrastructure(ctx, timeMs);
    this.drawColdAisles(ctx, timeMs);
    this.drawCoolantLoop(ctx, timeMs);
    for (const rack of this.sim.racks) this.drawRack(ctx, rack, timeMs);
    this.drawChiller(ctx, timeMs);
    ctx.restore();
  }

  drawBoard(ctx) {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    const glow = ctx.createRadialGradient(width * 0.76, height * 0.47, 10, width * 0.76, height * 0.47, width * 0.48);
    glow.addColorStop(0, "rgba(75, 150, 159, 0.07)");
    glow.addColorStop(1, "rgba(4, 12, 15, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(148, 196, 183, 0.025)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  drawInfrastructure(ctx) {
    ctx.strokeStyle = "rgba(148, 196, 183, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(42, 34, 688, 400);
    text(ctx, "THERMAL CONTAINMENT / ZONE 7G", 48, 24, 7, "rgba(120, 147, 140, 0.55)");
    text(ctx, "TASK + COOLING TELEMETRY", 725, 24, 7, "rgba(120, 147, 140, 0.4)", "right");

    for (let row = 0; row < ROWS; row += 1) {
      const y = ROW_Y[row] + RACK_H / 2;
      text(ctx, `ROW ${String.fromCharCode(65 + row)}`, 54, y - 7, 9, "rgba(232, 242, 237, 0.72)", "right", 600);
      text(ctx, `FAN ${this.sim.fan[row]}%`, 54, y + 7, 7, "rgba(120, 147, 140, 0.78)", "right");
      ctx.strokeStyle = "rgba(148, 196, 183, 0.16)";
      ctx.beginPath();
      ctx.moveTo(61, y);
      ctx.lineTo(83, y);
      ctx.stroke();
    }
  }

  drawColdAisles(ctx, timeMs) {
    const aisle1Top = ROW_Y[0] + RACK_H;
    const aisle2Top = ROW_Y[1] + RACK_H;
    const aisleHeight = ROW_Y[1] - aisle1Top;
    const startX = RACK_START_X - 7;
    const width = 10 * RACK_W + 9 * RACK_GAP + 14;
    const speed = 0.012 + this.sim.coolant * 0.00012;
    const phase = (timeMs * speed) % 1;

    for (let aisle = 0; aisle < 2; aisle += 1) {
      const top = aisle === 0 ? aisle1Top : aisle2Top;
      const gradient = ctx.createLinearGradient(startX, 0, startX + width, 0);
      gradient.addColorStop(0, "rgba(86, 209, 232, 0.015)");
      gradient.addColorStop(0.55, "rgba(86, 209, 232, 0.055)");
      gradient.addColorStop(1, "rgba(86, 209, 232, 0.015)");
      ctx.fillStyle = gradient;
      ctx.fillRect(startX, top + 4, width, aisleHeight - 8);

      ctx.strokeStyle = "rgba(86, 209, 232, 0.13)";
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(startX, top + aisleHeight / 2);
      ctx.lineTo(startX + width, top + aisleHeight / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let index = 0; index < 17; index += 1) {
        const progress = (index / 17 + phase) % 1;
        const x = startX + (1 - progress) * width;
        const alpha = Math.sin(progress * Math.PI) * 0.55;
        ctx.fillStyle = `rgba(105, 226, 243, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, top + aisleHeight / 2, 1.4, 0, Math.PI * 2);
        ctx.fill();
        if (index % 4 === 0) {
          ctx.strokeStyle = `rgba(105, 226, 243, ${alpha * 0.55})`;
          ctx.beginPath();
          ctx.moveTo(x + 7, top + aisleHeight / 2 - 3);
          ctx.lineTo(x + 3, top + aisleHeight / 2);
          ctx.lineTo(x + 7, top + aisleHeight / 2 + 3);
          ctx.stroke();
        }
      }

      text(
        ctx,
        `COLD AISLE 0${aisle + 1}`,
        startX + 8,
        top + aisleHeight / 2 - 10,
        7,
        "rgba(86, 209, 232, 0.52)"
      );
    }
  }

  drawCoolantLoop(ctx, timeMs) {
    const endX = RACK_START_X + 10 * RACK_W + 9 * RACK_GAP;
    const supplyX = 814;
    const returnX = 782;
    const aisleYs = [
      (ROW_Y[0] + RACK_H + ROW_Y[1]) / 2,
      (ROW_Y[1] + RACK_H + ROW_Y[2]) / 2
    ];
    const pulse = (timeMs * (0.025 + this.sim.coolant * 0.00045)) % 1;

    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(86, 209, 232, 0.18)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(supplyX, 112);
    ctx.lineTo(supplyX, aisleYs[1]);
    ctx.stroke();

    ctx.strokeStyle = "rgba(86, 209, 232, 0.55)";
    ctx.lineWidth = 1.4;
    for (const aisleY of aisleYs) {
      ctx.beginPath();
      ctx.moveTo(endX + 3, aisleY);
      ctx.lineTo(supplyX, aisleY);
      ctx.stroke();

      for (let index = 0; index < 6; index += 1) {
        const progress = (index / 6 + pulse) % 1;
        const x = supplyX - progress * (supplyX - endX);
        ctx.fillStyle = `rgba(111, 230, 246, ${0.35 + progress * 0.55})`;
        ctx.beginPath();
        ctx.arc(x, aisleY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = "rgba(255, 121, 95, 0.16)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(returnX, 100);
    ctx.lineTo(returnX, 410);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 121, 95, 0.42)";
    ctx.lineWidth = 1.2;
    for (let row = 0; row < ROWS; row += 1) {
      const y = ROW_Y[row] + RACK_H / 2;
      ctx.beginPath();
      ctx.moveTo(endX + 3, y);
      ctx.lineTo(returnX, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(86, 209, 232, 0.4)";
    ctx.beginPath();
    ctx.moveTo(CHILLER.x, 112);
    ctx.lineTo(supplyX, 112);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 121, 95, 0.4)";
    ctx.beginPath();
    ctx.moveTo(CHILLER.x, 380);
    ctx.lineTo(returnX, 380);
    ctx.stroke();

    text(ctx, "SUPPLY", supplyX + 13, 106, 6, "rgba(86, 209, 232, 0.55)");
    text(ctx, "RETURN", returnX - 4, 425, 6, "rgba(255, 121, 95, 0.55)", "right");
  }

  drawRack(ctx, rack, timeMs) {
    const box = this.rackRect(rack);
    const color = temperatureColor(rack.tempC);
    const isSelected = this.sim.selectedRackId === rack.id;
    const isHovered = this.hoveredId === rack.id;
    const isHot = rack.tempC >= HOTSPOT_LIMIT_C;

    ctx.save();
    roundRect(ctx, box.x, box.y, box.w, box.h, 2.5);
    ctx.fillStyle = color;
    ctx.globalAlpha = isHot ? 0.92 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;

    const sheen = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    sheen.addColorStop(0.42, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(3, 12, 15, 0.17)");
    ctx.fillStyle = sheen;
    ctx.fill();

    ctx.strokeStyle = isSelected
      ? "#eafff7"
      : isHovered
        ? "rgba(255, 255, 255, 0.75)"
        : "rgba(4, 17, 20, 0.28)";
    ctx.lineWidth = isSelected ? 1.8 : 0.7;
    ctx.stroke();

    text(ctx, rack.id, box.x + 5, box.y + 10, 6.8, "rgba(4, 18, 21, 0.72)");
    text(ctx, `${rack.tempC.toFixed(1)}°`, box.x + box.w / 2, box.y + 29, 12, "#041215", "center", 700);
    text(ctx, `${rack.loadKw.toFixed(1)} kW`, box.x + 5, box.y + 43, 6.8, "rgba(4, 18, 21, 0.68)");

    const dotStart = box.x + 17;
    for (let index = 0; index < Math.min(rack.tasks.length, 6); index += 1) {
      ctx.fillStyle = index === 0 ? "rgba(4, 18, 21, 0.85)" : "rgba(4, 18, 21, 0.45)";
      ctx.beginPath();
      ctx.arc(dotStart + index * 5.2, box.y + 51, 1.45, 0, Math.PI * 2);
      ctx.fill();
    }

    if (rack.hotspotMinutes > 0) {
      const ratio = Math.min(1, rack.hotspotMinutes / 24);
      ctx.fillStyle = "rgba(3, 14, 17, 0.28)";
      ctx.fillRect(box.x + box.w - 4, box.y + 4, 2.5, box.h - 8);
      ctx.fillStyle = ratio >= 1 ? "#fff3d5" : "rgba(255, 250, 224, 0.8)";
      const barH = (box.h - 8) * ratio;
      ctx.fillRect(box.x + box.w - 4, box.y + box.h - 4 - barH, 2.5, barH);
    }

    if (isSelected) {
      ctx.strokeStyle = "rgba(232, 255, 247, 0.5)";
      ctx.lineWidth = 1;
      const offset = 3;
      const tick = 5;
      ctx.beginPath();
      ctx.moveTo(box.x - offset, box.y + tick);
      ctx.lineTo(box.x - offset, box.y - offset);
      ctx.lineTo(box.x + tick, box.y - offset);
      ctx.moveTo(box.x + box.w - tick, box.y - offset);
      ctx.lineTo(box.x + box.w + offset, box.y - offset);
      ctx.lineTo(box.x + box.w + offset, box.y + tick);
      ctx.moveTo(box.x + box.w + offset, box.y + box.h - tick);
      ctx.lineTo(box.x + box.w + offset, box.y + box.h + offset);
      ctx.lineTo(box.x + box.w - tick, box.y + box.h + offset);
      ctx.moveTo(box.x + tick, box.y + box.h + offset);
      ctx.lineTo(box.x - offset, box.y + box.h + offset);
      ctx.lineTo(box.x - offset, box.y + box.h - tick);
      ctx.stroke();
    }

    if (isHot) {
      const alpha = 0.12 + Math.sin(timeMs / 360 + rack.col) * 0.07;
      ctx.strokeStyle = `rgba(255, 255, 245, ${alpha})`;
      ctx.lineWidth = 3;
      roundRect(ctx, box.x - 2, box.y - 2, box.w + 4, box.h + 4, 3.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawChiller(ctx, timeMs) {
    const { x, y, w, h } = CHILLER;
    const online = this.sim.chiller.online;
    const accent = online ? "#67edbf" : "#ff795f";
    ctx.save();
    roundRect(ctx, x, y, w, h, 3);
    ctx.fillStyle = online ? "rgba(9, 28, 32, 0.94)" : "rgba(38, 16, 16, 0.88)";
    ctx.fill();
    ctx.strokeStyle = online ? "rgba(103, 237, 191, 0.25)" : "rgba(255, 121, 95, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();

    text(ctx, "FACILITY / 01", x + 12, y + 17, 6.5, "rgba(120, 147, 140, 0.8)");
    text(ctx, "CHILLER", x + 12, y + 35, 13, "#e8f2ed", "left", 600);
    text(ctx, online ? "ONLINE" : "OFFLINE", x + 12, y + 52, 7, accent, "left", 600);

    ctx.strokeStyle = online ? "rgba(103, 237, 191, 0.18)" : "rgba(255, 121, 95, 0.25)";
    for (let index = 0; index < 7; index += 1) {
      const coilY = y + 75 + index * 10;
      ctx.beginPath();
      ctx.moveTo(x + 13, coilY);
      ctx.lineTo(x + w - 13, coilY);
      ctx.stroke();
    }
    const sweep = (timeMs * (online ? 0.04 + this.sim.coolant * 0.0005 : 0.005)) % 1;
    const sweepY = y + 76 + sweep * 62;
    const gradient = ctx.createLinearGradient(x + 12, 0, x + w - 12, 0);
    gradient.addColorStop(0, "rgba(86, 209, 232, 0)");
    gradient.addColorStop(0.55, online ? "rgba(86, 209, 232, 0.65)" : "rgba(255, 121, 95, 0.18)");
    gradient.addColorStop(1, "rgba(86, 209, 232, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 12, sweepY, w - 24, 2);

    text(ctx, "FLOW", x + 13, y + 163, 6.5, "rgba(120, 147, 140, 0.8)");
    text(ctx, `${this.sim.coolant}%`, x + 13, y + 184, 25, accent, "left", 400);
    text(ctx, "SUPPLY", x + 13, y + 215, 6.5, "rgba(120, 147, 140, 0.8)");
    text(ctx, `${this.sim.supplyTemp().toFixed(1)}°C`, x + 13, y + 232, 14, "#e8f2ed", "left", 500);

    ctx.strokeStyle = online ? "rgba(103, 237, 191, 0.2)" : "rgba(255, 121, 95, 0.35)";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 278, 19, 0, Math.PI * 2);
    ctx.stroke();
    for (let blade = 0; blade < 3; blade += 1) {
      const angle = timeMs / 900 * (this.sim.coolant / 64) + (blade * Math.PI * 2) / 3;
      ctx.fillStyle = online ? "rgba(103, 237, 191, 0.46)" : "rgba(255, 121, 95, 0.2)";
      ctx.beginPath();
      ctx.ellipse(
        x + w / 2 + Math.cos(angle) * 8,
        y + 278 + Math.sin(angle) * 8,
        4,
        9,
        angle,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 278, 2.4, 0, Math.PI * 2);
    ctx.fill();

    if (!online) {
      ctx.strokeStyle = "rgba(255, 121, 95, 0.48)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x + 9, y + 9);
      ctx.lineTo(x + w - 9, y + h - 9);
      ctx.moveTo(x + w - 9, y + 9);
      ctx.lineTo(x + 9, y + h - 9);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

export class TrendRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth;
      this.canvas.height = nextHeight;
    }
    this.dpr = dpr;
  }

  draw(sim) {
    this.resize();
    const ctx = this.ctx;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { left: 38, right: 44, top: 10, bottom: 19 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    if (chartW < 30 || chartH < 30) return;

    const history = sim.history.length ? sim.history : [{ at: 0, totalKw: 0, maxTemp: 25 }];
    const maxPower = Math.max(650, ...history.map((point) => point.totalKw * 1.08));
    const minPower = 250;
    const maxTemp = 35;
    const minTemp = 16;
    const mapX = (minute) => pad.left + (minute / 1440) * chartW;
    const mapPower = (value) => pad.top + chartH - ((value - minPower) / (maxPower - minPower)) * chartH;
    const mapTemp = (value) => pad.top + chartH - ((value - minTemp) / (maxTemp - minTemp)) * chartH;

    ctx.fillStyle = "rgba(3, 11, 14, 0.3)";
    ctx.fillRect(pad.left, pad.top, chartW, chartH);

    ctx.font = `7px ${MONO}`;
    ctx.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const y = pad.top + (chartH / 4) * index;
      const powerValue = maxPower - ((maxPower - minPower) / 4) * index;
      const tempValue = maxTemp - ((maxTemp - minTemp) / 4) * index;
      ctx.strokeStyle = "rgba(148, 196, 183, 0.1)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(120, 147, 140, 0.65)";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(powerValue)}`, pad.left - 7, y);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255, 121, 95, 0.55)";
      ctx.fillText(`${Math.round(tempValue)}°`, pad.left + chartW + 7, y);
    }

    for (let hour = 0; hour <= 24; hour += 4) {
      const x = mapX(hour * 60);
      ctx.strokeStyle = "rgba(148, 196, 183, 0.08)";
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + chartH);
      ctx.stroke();
      ctx.fillStyle = "rgba(120, 147, 140, 0.52)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const clock = (8 + hour) % 24;
      ctx.fillText(`${String(clock).padStart(2, "0")}:00`, x, pad.top + chartH + 6);
    }

    this.drawFaultBands(ctx, sim, mapX, pad, chartH);

    const powerGradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    powerGradient.addColorStop(0, "rgba(86, 209, 232, 0.19)");
    powerGradient.addColorStop(1, "rgba(86, 209, 232, 0.01)");
    ctx.beginPath();
    ctx.moveTo(mapX(history[0].at), pad.top + chartH);
    for (const point of history) {
      ctx.lineTo(mapX(point.at), mapPower(point.totalKw));
    }
    ctx.lineTo(mapX(history[history.length - 1].at), pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = powerGradient;
    ctx.fill();

    ctx.strokeStyle = "#56d1e8";
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    history.forEach((point, index) => {
      const x = mapX(point.at);
      const y = mapPower(point.totalKw);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 121, 95, 0.82)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    history.forEach((point, index) => {
      const x = mapX(point.at);
      const y = mapTemp(point.maxTemp);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const latest = history[history.length - 1];
    const latestX = mapX(latest.at);
    const latestY = mapPower(latest.totalKw);
    ctx.fillStyle = "#56d1e8";
    ctx.beginPath();
    ctx.arc(latestX, latestY, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(86, 209, 232, 0.14)";
    ctx.fillRect(latestX, pad.top, 64, chartH);
    ctx.strokeStyle = "rgba(86, 209, 232, 0.26)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(latestX, pad.top);
    ctx.lineTo(latestX, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(120, 147, 140, 0.65)";
    ctx.font = `7px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("FACILITY kW", 5, 4);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255, 121, 95, 0.7)";
    ctx.fillText("MAX °C", width - 4, 4);
  }

  drawFaultBands(ctx, sim, mapX, pad, chartH) {
    const ordered = [...sim.events].sort((a, b) => a.at - b.at);
    let faultStart = null;
    for (const event of ordered) {
      if (event.type === "fault") faultStart = event.at;
      if (event.type === "recovery" && faultStart !== null) {
        const startX = mapX(faultStart);
        const endX = mapX(event.at);
        ctx.fillStyle = "rgba(255, 121, 95, 0.055)";
        ctx.fillRect(startX, pad.top, Math.max(1, endX - startX), chartH);
        ctx.fillStyle = "rgba(255, 121, 95, 0.75)";
        ctx.fillRect(startX, pad.top, 1, chartH);
        faultStart = null;
      }
    }
    if (faultStart !== null) {
      const startX = mapX(faultStart);
      const endX = mapX(sim.elapsedMin);
      ctx.fillStyle = "rgba(255, 121, 95, 0.07)";
      ctx.fillRect(startX, pad.top, Math.max(1, endX - startX), chartH);
    }
  }
}
