import { CHARGERS, COLS, PRIORITIES, RACKS, ROWS, STATIONS } from "./config.js";

const COLORS = {
  cyan: "#4fe2d0",
  cyanSoft: "rgba(79, 226, 208, 0.18)",
  amber: "#f4b65d",
  amberSoft: "rgba(244, 182, 93, 0.18)",
  blue: "#6ea7ff",
  red: "#ff646b",
  redHot: "#ff3e4e",
  muted: "#78909a",
  floor: "#071017",
  floorLine: "rgba(138, 177, 184, 0.07)",
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

export class WarehouseRenderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sim = sim;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cell = 32;
    this.originX = 0;
    this.originY = 0;
    this.hoverCell = null;
    this.selectedRobotId = "R01";
    this.tool = "inspect";
    this.time = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    const horizontalPadding = Math.max(24, this.width * 0.035);
    const verticalPadding = Math.max(22, this.height * 0.055);
    this.cell = Math.min(
      (this.width - horizontalPadding * 2) / COLS,
      (this.height - verticalPadding * 2) / ROWS,
    );
    this.originX = (this.width - this.cell * COLS) / 2;
    this.originY = (this.height - this.cell * ROWS) / 2;
  }

  center(x, y) {
    return {
      x: this.originX + (x + 0.5) * this.cell,
      y: this.originY + (y + 0.5) * this.cell,
    };
  }

  cellFromPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.originX) / this.cell);
    const y = Math.floor((clientY - rect.top - this.originY) / this.cell);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return { x, y };
  }

  setHover(cell) {
    this.hoverCell = cell;
  }

  setSelected(robotId) {
    this.selectedRobotId = robotId;
  }

  setTool(tool) {
    this.tool = tool;
  }

  draw(timestamp) {
    this.time = timestamp;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();
    this.drawFloor();
    this.drawRacks();
    this.drawStationAndChargers();
    this.drawNoGoZones();
    this.drawRoutes();
    this.drawTrails();
    this.drawChargingQueues();
    this.drawRobots();
    this.drawDeadlock();
    this.drawHover();
  }

  drawBackdrop() {
    const ctx = this.ctx;
    const glow = ctx.createRadialGradient(
      this.width * 0.64,
      this.height * 0.42,
      10,
      this.width * 0.64,
      this.height * 0.42,
      this.width * 0.65,
    );
    glow.addColorStop(0, "rgba(36, 104, 99, 0.12)");
    glow.addColorStop(0.48, "rgba(13, 35, 41, 0.04)");
    glow.addColorStop(1, "rgba(2, 7, 10, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(111, 151, 160, 0.055)";
    ctx.lineWidth = 1;
    const step = this.cell * 4;
    for (let x = this.originX; x <= this.originX + COLS * this.cell; x += step) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, this.originY);
      ctx.lineTo(Math.round(x) + 0.5, this.originY + ROWS * this.cell);
      ctx.stroke();
    }
    for (let y = this.originY; y <= this.originY + ROWS * this.cell; y += step) {
      ctx.beginPath();
      ctx.moveTo(this.originX, Math.round(y) + 0.5);
      ctx.lineTo(this.originX + COLS * this.cell, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  drawFloor() {
    const ctx = this.ctx;
    const padding = this.cell * 0.25;
    const x = this.originX - padding;
    const y = this.originY - padding;
    const width = COLS * this.cell + padding * 2;
    const height = ROWS * this.cell + padding * 2;

    roundRect(ctx, x, y, width, height, 8);
    ctx.fillStyle = "rgba(7, 16, 23, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 163, 171, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.originX, this.originY, COLS * this.cell, ROWS * this.cell);
    ctx.clip();

    ctx.strokeStyle = COLORS.floorLine;
    ctx.lineWidth = 1;
    for (let xCell = 0; xCell <= COLS; xCell += 1) {
      const px = this.originX + xCell * this.cell;
      ctx.beginPath();
      ctx.moveTo(px, this.originY);
      ctx.lineTo(px, this.originY + ROWS * this.cell);
      ctx.stroke();
    }
    for (let yCell = 0; yCell <= ROWS; yCell += 1) {
      const py = this.originY + yCell * this.cell;
      ctx.beginPath();
      ctx.moveTo(this.originX, py);
      ctx.lineTo(this.originX + COLS * this.cell, py);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(121, 168, 175, 0.11)";
    ctx.setLineDash([4, 12]);
    ctx.lineWidth = 1;
    const lanes = [4.5, 9.5, 14.5, 19.5];
    for (const lane of lanes) {
      const py = this.originY + lane * this.cell;
      ctx.beginPath();
      ctx.moveTo(this.originX + this.cell * 0.7, py);
      ctx.lineTo(this.originX + (COLS - 2.4) * this.cell, py);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(119, 160, 168, 0.16)";
    ctx.font = `600 ${Math.max(6, this.cell * 0.18)}px "Roboto Mono", monospace`;
    ctx.textAlign = "left";
    ctx.fillText("AISLE / A", this.originX + this.cell * 0.75, this.originY + this.cell * 5.72);
    ctx.fillText("CROSS / 00", this.originX + this.cell * 10.4, this.originY + this.cell * 5.45);
    ctx.fillText("OUTBOUND", this.originX + this.cell * 21.7, this.originY + this.cell * 13.68);

    this.drawFloorArrows();
    ctx.restore();
  }

  drawFloorArrows() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(109, 151, 159, 0.13)";
    ctx.fillStyle = "rgba(109, 151, 159, 0.13)";
    ctx.lineWidth = 1;
    const arrows = [
      { x: 9.2, y: 0.85, direction: 1 },
      { x: 15.2, y: 0.85, direction: 1 },
      { x: 4.2, y: 5.1, direction: 1 },
      { x: 19.4, y: 8.8, direction: -1 },
      { x: 9.3, y: 13.9, direction: -1 },
    ];
    for (const arrow of arrows) {
      const start = this.center(arrow.x, arrow.y);
      const length = this.cell * 0.55;
      ctx.beginPath();
      ctx.moveTo(start.x - length / 2, start.y);
      ctx.lineTo(start.x + length / 2, start.y);
      ctx.stroke();
      const tipX = start.x + (length / 2) * arrow.direction;
      ctx.beginPath();
      ctx.moveTo(tipX, start.y);
      ctx.lineTo(tipX - this.cell * 0.12 * arrow.direction, start.y - this.cell * 0.08);
      ctx.lineTo(tipX - this.cell * 0.12 * arrow.direction, start.y + this.cell * 0.08);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawRacks() {
    const ctx = this.ctx;
    for (const rack of RACKS) {
      const x = this.originX + rack.x * this.cell + this.cell * 0.09;
      const y = this.originY + rack.y * this.cell + this.cell * 0.09;
      const w = rack.w * this.cell - this.cell * 0.18;
      const h = rack.h * this.cell - this.cell * 0.18;

      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      roundRect(ctx, x, y, w, h, 2.5);
      const fill = ctx.createLinearGradient(x, y, x, y + h);
      fill.addColorStop(0, "#26353b");
      fill.addColorStop(0.2, "#1b292f");
      fill.addColorStop(1, "#101b21");
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(163, 191, 195, 0.16)";
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 2.5);
      ctx.stroke();

      ctx.strokeStyle = "rgba(244, 182, 93, 0.26)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 1);
      ctx.lineTo(x + 4, y + h - 1);
      ctx.stroke();

      ctx.fillStyle = "rgba(139, 161, 164, 0.34)";
      const shelfGap = this.cell * 0.5;
      for (let sy = y + shelfGap; sy < y + h; sy += shelfGap) {
        ctx.fillRect(x + 7, sy, w - 13, 1);
      }
      ctx.fillStyle = "rgba(173, 193, 194, 0.35)";
      ctx.font = `500 ${Math.max(5, this.cell * 0.14)}px "Roboto Mono", monospace`;
      ctx.textAlign = "right";
      ctx.fillText(rack.id, x + w - 4, y + h - 4);
    }
  }

  drawStationAndChargers() {
    const ctx = this.ctx;
    const activeTasks = this.sim.tasks.filter(
      (task) => task.status === "assigned" || task.status === "carrying",
    );
    const sources = new Map();
    const destinations = new Map();
    for (const task of activeTasks) {
      sources.set(task.sourceId, task);
      destinations.set(task.destId, task);
    }

    for (const station of STATIONS) {
      const point = this.center(station.x, station.y);
      const sourceTask = sources.get(station.id);
      const destTask = destinations.get(station.id);
      const active = sourceTask || destTask;
      const size = this.cell * 0.79;
      const pulse = 0.5 + Math.sin(this.time / 380 + station.x) * 0.5;

      if (active) {
        const halo = ctx.createRadialGradient(
          point.x,
          point.y,
          this.cell * 0.16,
          point.x,
          point.y,
          this.cell * 0.67,
        );
        halo.addColorStop(0, "rgba(244, 182, 93, 0.18)");
        halo.addColorStop(1, "rgba(244, 182, 93, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(point.x, point.y, this.cell * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }

      roundRect(
        ctx,
        point.x - size / 2,
        point.y - size / 2,
        size,
        size,
        this.cell * 0.12,
      );
      ctx.fillStyle = active ? "rgba(244, 182, 93, 0.1)" : "rgba(13, 25, 32, 0.92)";
      ctx.fill();
      ctx.strokeStyle = active
        ? `rgba(244, 182, 93, ${0.56 + pulse * 0.28})`
        : "rgba(244, 182, 93, 0.32)";
      ctx.lineWidth = active ? 1.4 : 1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(244, 182, 93, 0.22)";
      ctx.lineWidth = 1;
      roundRect(
        ctx,
        point.x - size * 0.34,
        point.y - size * 0.34,
        size * 0.68,
        size * 0.68,
        2,
      );
      ctx.stroke();

      ctx.fillStyle = active ? COLORS.amber : "rgba(244, 182, 93, 0.78)";
      ctx.font = `600 ${Math.max(7, this.cell * 0.23)}px "Bahnschrift", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(station.id, point.x, point.y + 0.5);

      ctx.fillStyle = "rgba(146, 171, 176, 0.42)";
      ctx.font = `500 ${Math.max(5, this.cell * 0.14)}px "Roboto Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText(station.zone, point.x, point.y + this.cell * 0.55);

      if (sourceTask || destTask) {
        const task = sourceTask || destTask;
        const color = PRIORITIES[task.priority].tone === "red" ? COLORS.red : COLORS.amber;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          point.x + size * 0.43,
          point.y - size * 0.43,
          Math.max(2, this.cell * 0.055),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    for (const charger of CHARGERS) {
      const bay = this.center(charger.bay.x, charger.bay.y);
      const laneStartX = this.originX + 22.7 * this.cell;
      const laneY = this.originY + (charger.bay.y - 0.9) * this.cell;
      const laneH = this.cell * 1.8;
      const charging = this.sim.chargers.find((item) => item.id === charger.id);

      roundRect(ctx, laneStartX, laneY, this.cell * 2.25, laneH, this.cell * 0.14);
      ctx.fillStyle =
        charging?.state === "charging"
          ? "rgba(110, 167, 255, 0.1)"
          : "rgba(110, 167, 255, 0.035)";
      ctx.fill();
      ctx.strokeStyle =
        charging?.state === "charging"
          ? "rgba(110, 167, 255, 0.52)"
          : "rgba(110, 167, 255, 0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(110, 167, 255, 0.32)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(
        bay.x,
        bay.y,
        this.cell * 0.31,
        -Math.PI * 0.4,
        Math.PI * 1.4,
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bay.x + this.cell * 0.2, bay.y - this.cell * 0.28);
      ctx.lineTo(bay.x - this.cell * 0.04, bay.y + this.cell * 0.01);
      ctx.lineTo(bay.x + this.cell * 0.1, bay.y + this.cell * 0.01);
      ctx.lineTo(bay.x - this.cell * 0.13, bay.y + this.cell * 0.28);
      ctx.stroke();

      ctx.fillStyle = "rgba(110, 167, 255, 0.75)";
      ctx.font = `600 ${Math.max(5, this.cell * 0.14)}px "Roboto Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(charger.id, bay.x, bay.y - this.cell * 0.56);

      const queueLength = charging?.queue.length ?? 0;
      if (queueLength > 0) {
        const badgeX = bay.x + this.cell * 0.42;
        const badgeY = bay.y + this.cell * 0.4;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, this.cell * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(244, 182, 93, 0.9)";
        ctx.fill();
        ctx.fillStyle = "#172027";
        ctx.font = `700 ${Math.max(6, this.cell * 0.16)}px "Roboto Mono", monospace`;
        ctx.fillText(String(queueLength), badgeX, badgeY + 0.5);
      }
    }
  }

  drawNoGoZones() {
    const ctx = this.ctx;
    for (const key of this.sim.noGo) {
      const [x, y] = key.split(",").map(Number);
      const px = this.originX + x * this.cell;
      const py = this.originY + y * this.cell;
      ctx.save();
      ctx.fillStyle = "rgba(255, 62, 78, 0.105)";
      ctx.fillRect(px + 1, py + 1, this.cell - 2, this.cell - 2);
      ctx.beginPath();
      ctx.rect(px + 1, py + 1, this.cell - 2, this.cell - 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(255, 90, 99, 0.34)";
      ctx.lineWidth = 1;
      for (let offset = -this.cell; offset < this.cell * 2; offset += 5) {
        ctx.beginPath();
        ctx.moveTo(px + offset, py + this.cell);
        ctx.lineTo(px + offset + this.cell, py);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255, 77, 87, 0.62)";
      ctx.strokeRect(px + 1.5, py + 1.5, this.cell - 3, this.cell - 3);
    }
  }

  drawRoutes() {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const robot of this.sim.robots) {
      if (!robot.route.length) continue;
      const selected = robot.id === this.selectedRobotId;
      const color =
        robot.state === "toCharge" || robot.state === "chargeQueue"
          ? COLORS.blue
          : robot.state === "ring"
            ? COLORS.red
            : COLORS.cyan;
      const start = this.renderPosition(robot);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (const cell of robot.route) {
        const point = this.center(cell.x, cell.y);
        ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = selected ? 0.42 : 0.15;
      ctx.setLineDash(selected ? [3, 5] : [2, 7]);
      ctx.lineWidth = selected ? 1.1 : 0.8;
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTrails() {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const robot of this.sim.robots) {
      if (robot.trail.length < 2) continue;
      const selected = robot.id === this.selectedRobotId;
      const color =
        robot.state === "charging"
          ? COLORS.blue
          : robot.state === "ring"
            ? COLORS.red
            : COLORS.cyan;
      for (let index = 1; index < robot.trail.length; index += 1) {
        const previous = this.center(robot.trail[index - 1].x, robot.trail[index - 1].y);
        const current = this.center(robot.trail[index].x, robot.trail[index].y);
        const alpha = (index / robot.trail.length) * (selected ? 0.2 : 0.08);
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(current.x, current.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = selected ? 1.4 : 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawChargingQueues() {
    const ctx = this.ctx;
    for (const charger of this.sim.chargers) {
      if (!charger.queue.length && charger.state !== "charging") continue;
      const target = this.center(charger.approach.x, charger.approach.y);
      const queued = charger.queue
        .map((id) => this.sim.robots.find((robot) => robot.id === id))
        .filter(Boolean);
      queued.forEach((robot, index) => {
        if (robot.state === "charging") return;
        const point = this.renderPosition(robot);
        ctx.save();
        ctx.strokeStyle = "rgba(110, 167, 255, 0.26)";
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.quadraticCurveTo(
          (point.x + target.x) / 2,
          Math.min(point.y, target.y) - this.cell * 0.35,
          target.x,
          target.y,
        );
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(110, 167, 255, 0.8)";
        ctx.font = `500 ${Math.max(5, this.cell * 0.14)}px "Roboto Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`Q${index + 1}`, target.x, target.y - this.cell * 0.35);
        ctx.restore();
      });
    }
  }

  renderPosition(robot) {
    const origin = this.center(robot.fromX, robot.fromY);
    const destination = this.center(robot.x, robot.y);
    const raw = (this.sim.elapsed - robot.moveStarted) / 0.48;
    const progress = clamp(raw, 0, 1);
    if (progress >= 1) return destination;
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      x: origin.x + (destination.x - origin.x) * eased,
      y: origin.y + (destination.y - origin.y) * eased,
    };
  }

  drawRobots() {
    const ctx = this.ctx;
    const ringIds = new Set(this.sim.deadlockActive?.robotIds ?? []);
    const ordered = [...this.sim.robots].sort((a, b) => {
      if (a.id === this.selectedRobotId) return 1;
      if (b.id === this.selectedRobotId) return -1;
      return 0;
    });

    for (const robot of ordered) {
      const point = this.renderPosition(robot);
      const radius = this.cell * 0.255;
      const selected = robot.id === this.selectedRobotId;
      const inRing = ringIds.has(robot.id);
      const waiting = robot.waitTicks > 2 || robot.state === "chargeQueue";
      const color =
        inRing || robot.state === "ring"
          ? COLORS.red
          : robot.state === "charging"
            ? COLORS.blue
            : robot.state === "toCharge" || robot.state === "chargeQueue"
              ? "#7fb1ff"
              : robot.battery < 30
                ? COLORS.amber
                : COLORS.cyan;

      if (selected) {
        ctx.save();
        ctx.strokeStyle = "rgba(134, 255, 240, 0.58)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, this.cell * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const bracket = this.cell * 0.38;
        const arm = this.cell * 0.08;
        ctx.beginPath();
        ctx.moveTo(point.x - bracket, point.y - bracket + arm);
        ctx.lineTo(point.x - bracket, point.y - bracket);
        ctx.lineTo(point.x - bracket + arm, point.y - bracket);
        ctx.moveTo(point.x + bracket - arm, point.y + bracket);
        ctx.lineTo(point.x + bracket, point.y + bracket);
        ctx.lineTo(point.x + bracket, point.y + bracket - arm);
        ctx.strokeStyle = "rgba(134, 255, 240, 0.82)";
        ctx.stroke();
        ctx.restore();
      }

      if (waiting || inRing) {
        const pulse = 0.5 + Math.sin(this.time / 230) * 0.5;
        ctx.beginPath();
        ctx.arc(
          point.x,
          point.y,
          radius + this.cell * (0.09 + pulse * 0.07),
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = inRing
          ? `rgba(255, 70, 82, ${0.18 + pulse * 0.25})`
          : "rgba(244, 182, 93, 0.11)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.save();
      ctx.shadowColor = inRing ? "rgba(255, 62, 78, 0.65)" : "rgba(0, 0, 0, 0.55)";
      ctx.shadowBlur = inRing ? 12 : 5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      const body = ctx.createRadialGradient(
        point.x - radius * 0.35,
        point.y - radius * 0.4,
        1,
        point.x,
        point.y,
        radius,
      );
      body.addColorStop(0, "#24353c");
      body.addColorStop(0.62, "#101c23");
      body.addColorStop(1, "#071116");
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 1.7 : 1.25;
      ctx.stroke();
      ctx.restore();

      const batteryAngle = Math.PI * 1.5 + (robot.battery / 100) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + this.cell * 0.075, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        radius + this.cell * 0.075,
        Math.PI * 1.5,
        batteryAngle,
      );
      ctx.strokeStyle =
        robot.battery < 25 ? COLORS.amber : inRing ? COLORS.red : COLORS.cyan;
      ctx.lineWidth = 1.3;
      ctx.stroke();

      this.drawRobotHeading(robot, point, radius, color);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1.5, radius * 0.13), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(230, 245, 245, 0.88)";
      ctx.font = `500 ${Math.max(5, this.cell * 0.145)}px "Roboto Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(robot.id.slice(1), point.x, point.y + radius * 0.36);

      if (robot.taskId) {
        const task = this.sim.tasks.find((item) => item.id === robot.taskId);
        if (task) {
          ctx.fillStyle =
            task.priority === 1
              ? COLORS.red
              : task.priority === 2
                ? COLORS.amber
                : "rgba(128, 160, 168, 0.75)";
          ctx.beginPath();
          ctx.arc(
            point.x - radius * 0.62,
            point.y - radius * 0.66,
            Math.max(1.4, this.cell * 0.05),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      if (robot.battery < 25 || robot.state === "charging") {
        ctx.fillStyle = robot.state === "charging" ? COLORS.blue : COLORS.amber;
        ctx.font = `700 ${Math.max(6, this.cell * 0.17)}px "Roboto Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText("ϟ", point.x + radius * 0.74, point.y - radius * 0.63);
      }

      if (robot.state === "charging") {
        const bay = this.center(
          this.sim.chargers.find((charger) => charger.id === robot.chargerId)?.bay.x ??
            robot.x,
          this.sim.chargers.find((charger) => charger.id === robot.chargerId)?.bay.y ??
            robot.y,
        );
        ctx.strokeStyle = "rgba(110, 167, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(point.x + radius, point.y);
        ctx.bezierCurveTo(
          point.x + this.cell * 0.45,
          point.y + this.cell * 0.22,
          bay.x - this.cell * 0.2,
          bay.y + this.cell * 0.2,
          bay.x - this.cell * 0.15,
          bay.y,
        );
        ctx.stroke();
      }
    }
  }

  drawRobotHeading(robot, point, radius, color) {
    const ctx = this.ctx;
    let dx = robot.x - robot.fromX;
    let dy = robot.y - robot.fromY;
    if (!dx && !dy && robot.route.length) {
      dx = robot.route[0].x - robot.x;
      dy = robot.route[0].y - robot.y;
    }
    if (!dx && !dy) {
      dx = 1;
      dy = 0;
    }
    const length = Math.hypot(dx, dy) || 1;
    const nx = dx / length;
    const ny = dy / length;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(point.x + nx * radius * 0.8, point.y + ny * radius * 0.8);
    ctx.lineTo(
      point.x + nx * radius * 0.24 - ny * radius * 0.28,
      point.y + ny * radius * 0.24 + nx * radius * 0.28,
    );
    ctx.lineTo(
      point.x + nx * radius * 0.24 + ny * radius * 0.28,
      point.y + ny * radius * 0.24 - nx * radius * 0.28,
    );
    ctx.closePath();
    ctx.fill();
  }

  drawDeadlock() {
    const active = this.sim.deadlockActive;
    if (!active) return;
    const ctx = this.ctx;
    const robots = active.robotIds
      .map((id) => this.sim.robots.find((robot) => robot.id === id))
      .filter(Boolean);
    if (robots.length < 2) return;

    const points = robots.map((robot) => this.renderPosition(robot));
    const pulse = 0.5 + Math.sin(this.time / 260) * 0.5;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 70, 82, ${0.46 + pulse * 0.32})`;
    ctx.fillStyle = "rgba(255, 62, 78, 0.035)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const angle = Math.atan2(next.y - current.y, next.x - current.x);
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(255, 92, 101, 0.86)";
      ctx.beginPath();
      ctx.moveTo(this.cell * 0.11, 0);
      ctx.lineTo(-this.cell * 0.055, -this.cell * 0.07);
      ctx.lineTo(-this.cell * 0.055, this.cell * 0.07);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    const centroid = points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
      { x: 0, y: 0 },
    );
    const ringRadius = Math.max(
      ...points.map((point) => Math.hypot(point.x - centroid.x, point.y - centroid.y)),
    );
    ctx.beginPath();
    ctx.arc(
      centroid.x,
      centroid.y,
      ringRadius + this.cell * (0.35 + pulse * 0.12),
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(255, 62, 78, ${0.1 + pulse * 0.12})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 100, 107, 0.78)";
    ctx.font = `600 ${Math.max(6, this.cell * 0.16)}px "Roboto Mono", monospace`;
    ctx.textAlign = "center";
    ctx.fillText(
      `RING WAIT / ${String(robots.length).padStart(2, "0")}`,
      centroid.x,
      centroid.y - ringRadius - this.cell * 0.42,
    );
    ctx.restore();
  }

  drawHover() {
    if (!this.hoverCell) return;
    const { x, y } = this.hoverCell;
    const px = this.originX + x * this.cell;
    const py = this.originY + y * this.cell;
    const ctx = this.ctx;
    if (this.tool === "block") {
      ctx.fillStyle = "rgba(255, 62, 78, 0.13)";
      ctx.fillRect(px + 1, py + 1, this.cell - 2, this.cell - 2);
      ctx.strokeStyle = "rgba(255, 100, 107, 0.75)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1.5, py + 1.5, this.cell - 3, this.cell - 3);
      ctx.fillStyle = "rgba(255, 130, 136, 0.7)";
      ctx.font = `500 ${Math.max(6, this.cell * 0.2)}px "Roboto Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText("+", px + this.cell / 2, py + this.cell / 2 + 2);
    } else {
      ctx.strokeStyle = "rgba(134, 255, 240, 0.42)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 2.5, py + 2.5, this.cell - 5, this.cell - 5);
    }
  }
}
