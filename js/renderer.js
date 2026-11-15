import {
  CLEAR_POINT,
  DESTINATIONS,
  ROUTE_LENGTH,
  routeForDestination,
} from "./simulation.js";

const WORLD = { width: 1000, height: 700 };
const LANE_Y = [180, 350, 520];
const LANE_START_X = 400;
const LANE_END_X = 916;
const FEED_X = 118;
const FEED_START_Y = 350;
const CREST_Y = 250;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

function sampleCubic(p0, p1, p2, p3, count = 36) {
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const one = 1 - t;
    points.push({
      x: one ** 3 * p0.x + 3 * one ** 2 * t * p1.x + 3 * one * t ** 2 * p2.x + t ** 3 * p3.x,
      y: one ** 3 * p0.y + 3 * one ** 2 * t * p1.y + 3 * one * t ** 2 * p2.y + t ** 3 * p3.y,
    });
  }
  return points;
}

function buildPath(route) {
  const laneY = LANE_Y[route];
  const trunk = [
    { x: FEED_X, y: FEED_START_Y },
    { x: FEED_X, y: CREST_Y },
    { x: 210, y: CREST_Y },
    { x: 262, y: CREST_Y },
  ];
  const branch = sampleCubic(
    { x: 262, y: CREST_Y },
    { x: 304, y: CREST_Y },
    { x: 318, y: laneY },
    { x: LANE_START_X, y: laneY },
  );
  const lane = [
    { x: LANE_START_X, y: laneY },
    { x: LANE_END_X, y: laneY },
  ];
  const points = [...trunk, ...branch.slice(1), ...lane.slice(1)];
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    cumulative.push(total);
  }

  return {
    route,
    laneY,
    points,
    cumulative,
    total,
    at(fraction) {
      const target = clamp(fraction, 0, 1) * total;
      let index = 1;
      while (index < cumulative.length - 1 && cumulative[index] < target) index += 1;
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = cumulative[index] - cumulative[index - 1] || 1;
      const t = clamp((target - cumulative[index - 1]) / segmentLength, 0, 1);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      return {
        x: lerp(start.x, end.x, t),
        y: lerp(start.y, end.y, t),
        angle: Math.atan2(dy, dx),
        nx: -dy / segmentLength,
        ny: dx / segmentLength,
      };
    },
  };
}

function offsetPoints(points, offset) {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (-dy / length) * offset,
      y: point.y + (dx / length) * offset,
    };
  });
}

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

export class YardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.paths = LANE_Y.map((_, route) => buildPath(route));
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.dpr = dpr;
    this.scale = Math.max(this.width / WORLD.width, this.height / WORLD.height);
    this.offsetX = (this.width - WORLD.width * this.scale) / 2;
    this.offsetY = (this.height - WORLD.height * this.scale) / 2;
  }

  draw(frame, ui = {}) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#091012";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const shake = this.getShake(frame);
    ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      this.dpr * this.scale,
      this.dpr * (this.offsetX + shake.x),
      this.dpr * (this.offsetY + shake.y),
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD.width, WORLD.height);
    ctx.clip();
    this.drawBackground(ctx, frame, ui);
    this.drawTracks(ctx, frame, ui);
    this.drawGuides(ctx, frame, ui);
    this.drawCars(ctx, frame, ui);
    this.drawEffects(ctx, frame, ui);
    this.drawLabels(ctx, frame, ui);
    ctx.restore();
  }

  getShake(frame) {
    if (frame.phase !== "failure" || frame.failure?.reason !== "rear-end") return { x: 0, y: 0 };
    const age = frame.elapsed - (frame.failure.at ?? frame.elapsed);
    if (age > 0.55 || age < 0) return { x: 0, y: 0 };
    const strength = (1 - age / 0.55) * 6;
    return {
      x: Math.sin(frame.elapsed * 89) * strength,
      y: Math.cos(frame.elapsed * 73) * strength * 0.7,
    };
  }

  progressToWorld(progress, route) {
    const fraction = clamp(progress / ROUTE_LENGTH, 0, 1);
    return this.paths[route].at(fraction);
  }

  drawBackground(ctx, frame, ui) {
    const backdrop = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    backdrop.addColorStop(0, "#0e1718");
    backdrop.addColorStop(0.52, "#0a1213");
    backdrop.addColorStop(1, "#0d1414");
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const light = ctx.createRadialGradient(620, 265, 20, 620, 265, 380);
    light.addColorStop(0, "rgba(80, 126, 112, 0.095)");
    light.addColorStop(1, "rgba(80, 126, 112, 0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.strokeStyle = "rgba(203, 218, 210, 0.045)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.height);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
    ctx.fillRect(28, 31, 310, 90);
    ctx.fillRect(386, 128, 550, 98);
    ctx.fillRect(386, 298, 550, 98);
    ctx.fillRect(386, 468, 550, 98);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
    ctx.strokeRect(28, 31, 310, 90);
    ctx.strokeRect(386, 128, 550, 98);
    ctx.strokeRect(386, 298, 550, 98);
    ctx.strokeRect(386, 468, 550, 98);

    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = "#c6a55d";
    for (let index = 0; index < 7; index += 1) {
      ctx.lineWidth = index % 2 ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(16 + index * 18, 690);
      ctx.lineTo(54 + index * 18, 652);
      ctx.stroke();
    }
    ctx.restore();

    const windDirection = frame.environment.windDirection || 1;
    const speed = frame.environment.windSpeed || 0;
    ctx.save();
    ctx.strokeStyle = "rgba(149, 186, 177, 0.11)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 9; index += 1) {
      const phase = (frame.elapsed * (0.18 + speed * 0.02) + index * 1.7) % 9;
      const x = windDirection > 0 ? phase * 116 - 80 : WORLD.width - phase * 116 + 80;
      const y = 70 + ((index * 73) % 560);
      const length = 22 + (index % 3) * 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length * windDirection, y + 5);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(215, 198, 163, 0.28)";
    ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.letterSpacing = "2px";
    ctx.fillText("NORTH CLASSIFICATION YARD · TRACK MAP 07", 30, 145);
    ctx.fillStyle = "rgba(215, 198, 163, 0.14)";
    ctx.fillText("RETARDER ZONE", 432, 152);
    ctx.fillText("WAGON STORAGE", 432, 679);
    ctx.restore();
  }

  drawTracks(ctx, frame, ui) {
    this.drawFeedTrack(ctx);
    this.drawHump(ctx, frame);
    for (let route = 0; route < DESTINATIONS.length; route += 1) {
      this.drawLaneTrack(ctx, route, route === frame.selectedRoute, ui);
    }
    this.drawSwitch(ctx, frame);
  }

  drawFeedTrack(ctx) {
    const top = 246;
    const bottom = 652;
    ctx.save();
    ctx.fillStyle = "#34403e";
    ctx.fillRect(101, top, 34, bottom - top);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(105, top, 10, bottom - top);

    for (let y = 344; y <= bottom; y += 17) {
      ctx.fillStyle = y % 34 === 0 ? "#4a4b42" : "#3c4039";
      ctx.fillRect(96, y, 44, 4);
    }
    ctx.strokeStyle = "#7b8177";
    ctx.lineWidth = 1.4;
    for (const x of [106, 130]) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(216, 227, 218, 0.55)";
    ctx.lineWidth = 0.6;
    for (const x of [106, 130]) {
      ctx.beginPath();
      ctx.moveTo(x - 0.4, top);
      ctx.lineTo(x - 0.4, bottom);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(211, 166, 83, 0.23)";
    ctx.fillRect(96, 334, 44, 2);
    ctx.restore();
  }

  drawHump(ctx, frame) {
    const gradient = ctx.createLinearGradient(118, 360, 118, 244);
    gradient.addColorStop(0, "rgba(211, 166, 83, 0.04)");
    gradient.addColorStop(0.55, "rgba(211, 166, 83, 0.16)");
    gradient.addColorStop(1, "rgba(240, 200, 121, 0.25)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(76, 365);
    ctx.lineTo(160, 365);
    ctx.lineTo(142, 244);
    ctx.lineTo(94, 244);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(240, 200, 121, 0.24)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.translate(118, 293);
    ctx.strokeStyle = "rgba(237, 193, 109, 0.36)";
    ctx.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      const y = index * 21;
      ctx.beginPath();
      ctx.moveTo(-12, y + 8);
      ctx.lineTo(0, y);
      ctx.lineTo(12, y + 8);
      ctx.stroke();
    }
    ctx.restore();

    const grade = frame.environment.gradePercent;
    ctx.save();
    ctx.fillStyle = "rgba(235, 209, 157, 0.72)";
    ctx.font = "600 9px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("HUMP", 54, 229);
    ctx.fillStyle = "rgba(235, 209, 157, 0.36)";
    ctx.font = "7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText(`GRADE ${grade.toFixed(2)}%`, 42, 241);
    ctx.restore();
  }

  drawLaneTrack(ctx, route, active, ui) {
    const path = this.paths[route];
    const color = DESTINATIONS[route].color;
    ctx.save();

    ctx.strokeStyle = "rgba(8, 12, 12, 0.7)";
    ctx.lineWidth = 28;
    ctx.beginPath();
    path.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    if (active) {
      ctx.strokeStyle = `${color}24`;
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.strokeStyle = `${color}88`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    for (let index = 0; index < path.cumulative.length; index += 2) {
      const point = path.at(path.cumulative[index] / path.total);
      const sleeper = Math.atan2(Math.cos(point.angle), Math.sin(point.angle));
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(sleeper);
      ctx.fillStyle = index % 8 === 0 ? "#49483d" : "#393d37";
      ctx.fillRect(-16, -1.5, 32, 3);
      ctx.restore();
    }

    const left = offsetPoints(path.points, -4.2);
    const right = offsetPoints(path.points, 4.2);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#758078";
    for (const rail of [left, right]) {
      ctx.beginPath();
      rail.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }

    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "rgba(218, 228, 219, 0.58)";
    for (const rail of [left, right]) {
      ctx.beginPath();
      rail.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y - 0.65);
        else ctx.lineTo(point.x, point.y - 0.65);
      });
      ctx.stroke();
    }

    const bufferX = LANE_END_X + 3;
    ctx.fillStyle = "#2a302d";
    ctx.fillRect(bufferX, path.laneY - 20, 13, 40);
    for (let index = 0; index < 4; index += 1) {
      ctx.fillStyle = index % 2 ? "#d7c49e" : "#b6433c";
      ctx.fillRect(bufferX + 1, path.laneY - 18 + index * 9, 10, 7);
    }

    ctx.fillStyle = `${color}d0`;
    ctx.font = "600 12px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText(`${DESTINATIONS[route].code} · ${DESTINATIONS[route].name}`, 435, path.laneY - 25);
    ctx.font = "8px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillStyle = "rgba(214, 222, 214, 0.4)";
    ctx.fillText(`CAP 0${DESTINATIONS[route].capacity}  /  ${route === 0 ? "EAST" : route === 1 ? "MIDDLE" : "WEST"}`, 435, path.laneY - 13);

    const clearPoint = this.progressToWorld(CLEAR_POINT, route);
    ctx.save();
    ctx.translate(clearPoint.x, clearPoint.y);
    ctx.rotate(Math.atan2(Math.cos(clearPoint.angle), Math.sin(clearPoint.angle)));
    ctx.strokeStyle = "rgba(236, 118, 110, 0.62)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.stroke();
    ctx.restore();

    const target = ui.targets?.[route];
    if (Number.isFinite(target)) {
      this.drawTargetBracket(ctx, target, route, color, route === ui.selectedRoute);
    }
    ctx.restore();
  }

  drawTargetBracket(ctx, target, route, color, active) {
    const point = this.progressToWorld(target, route);
    ctx.save();
    ctx.translate(point.x, point.y);
    const angle = Math.atan2(Math.cos(point.angle), Math.sin(point.angle));
    ctx.rotate(angle);
    ctx.strokeStyle = active ? `${color}ac` : `${color}55`;
    ctx.lineWidth = active ? 1.4 : 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeRect(-3, -13, 6, 26);
    if (active) {
      ctx.setLineDash([]);
      ctx.fillStyle = `${color}28`;
      ctx.fillRect(-9, -12, 18, 24);
    }
    ctx.restore();
  }

  drawSwitch(ctx, frame) {
    const active = frame.selectedRoute;
    const color = DESTINATIONS[active].color;
    ctx.save();
    ctx.translate(262, CREST_Y);
    ctx.fillStyle = "#171d1c";
    ctx.strokeStyle = "rgba(210, 190, 151, 0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#9a9d8c";
    ctx.lineWidth = 2.2;
    const targetY = LANE_Y[active];
    const leverAngle = Math.atan2(targetY - CREST_Y, LANE_START_X - 262);
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(Math.cos(leverAngle) * 19, Math.sin(leverAngle) * 19);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(Math.cos(leverAngle) * 21, Math.sin(leverAngle) * 21, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(9, 14, 14, 0.88)";
    ctx.fillRect(-24, 23, 48, 16);
    ctx.strokeStyle = "rgba(217, 196, 158, 0.18)";
    ctx.strokeRect(-24, 23, 48, 16);
    ctx.fillStyle = color;
    ctx.font = "700 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`01 ↔ ${DESTINATIONS[active].short}`, 0, 34);
    ctx.restore();
  }

  drawGuides(ctx, frame, ui) {
    const route = frame.selectedRoute;
    const color = DESTINATIONS[route].color;
    const target = ui.targets?.[route];
    const preview = ui.preview;
    const clearPoint = this.progressToWorld(CLEAR_POINT, route);

    ctx.save();
    ctx.strokeStyle = `${color}50`;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 10]);
    const path = this.paths[route];
    ctx.beginPath();
    path.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(240, 118, 104, 0.82)";
    ctx.font = "600 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("CLEAR", clearPoint.x, clearPoint.y - 18);
    ctx.fillStyle = "rgba(240, 118, 104, 0.42)";
    ctx.font = "6px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText(`${CLEAR_POINT} m`, clearPoint.x, clearPoint.y + 25);
    ctx.restore();

    if (Number.isFinite(target)) {
      const targetPoint = this.progressToWorld(target, route);
      ctx.save();
      ctx.fillStyle = `${color}c0`;
      ctx.font = "600 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillText("TARGET", targetPoint.x, targetPoint.y + 32);
      ctx.fillStyle = "rgba(218, 227, 219, 0.36)";
      ctx.font = "6px 'SFMono-Regular', 'Noto Sans SC', monospace";
      ctx.fillText(`${Math.round(target)} m`, targetPoint.x, targetPoint.y + 40);
      ctx.restore();
    }

    if (preview && Number.isFinite(preview.progress) && !ui.replay) {
      const point = this.progressToWorld(clamp(preview.progress, 0, ROUTE_LENGTH), route);
      const near = Number.isFinite(target) ? Math.abs(preview.progress - target) : 99;
      const tone = near <= 5 ? "#75c7a4" : near <= 11 ? "#e8a64d" : "#f06455";
      ctx.save();
      ctx.globalAlpha = 0.6;
      this.drawCarBody(ctx, point.x + 21, point.y, point.angle, {
        destination: DESTINATIONS[route].id,
        code: "预计",
        ghost: true,
        length: 34,
        width: 19,
      });
      ctx.globalAlpha = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = tone;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x + 21, point.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (frame.failure?.carId) {
      const car = frame.cars.find((item) => item.id === frame.failure.carId);
      if (car && car.route !== null) {
        const point = this.progressToWorld(car.progress, car.route);
        const age = frame.elapsed - frame.failure.at;
        const alpha = clamp(1 - age / 2.2, 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#f06455";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 14 + age * 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawCars(ctx, frame, ui) {
    const staged = frame.cars.filter((car) => car.status === "staged");
    for (const car of staged) {
      const offset = car.index - frame.nextIndex;
      const y = FEED_START_Y + Math.max(0, offset) * 27;
      this.drawCarBody(ctx, FEED_X, y, Math.PI / 2, {
        destination: car.destination,
        code: car.code,
        staged: true,
        current: car.index === frame.nextIndex,
        length: 23,
        width: 36,
      });
    }

    const placed = frame.cars
      .filter((car) => car.status !== "staged" && car.route !== null)
      .sort((a, b) => (a.status === "rolling" ? 1 : 0) - (b.status === "rolling" ? 1 : 0));
    for (const car of placed) {
      const point = this.progressToWorld(car.progress, car.route);
      const destination = DESTINATIONS[routeForDestination(car.destination)];
      this.drawCarBody(ctx, point.x, point.y, point.angle, {
        destination: car.destination,
        code: car.code,
        rolling: car.status === "rolling",
        collided: car.status === "collided",
        stalled: car.status === "stalled",
        assisted: car.assisted,
        length: 34,
        width: 19,
      });
      if (car.status === "rolling") {
        this.drawSpeedTag(ctx, point, car, destination.color);
      }
      if (car.assisted) {
        ctx.save();
        ctx.strokeStyle = "rgba(117, 199, 164, 0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(point.x - 17, point.y);
        ctx.lineTo(point.x - 42, point.y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawCarBody(ctx, x, y, angle, options) {
    const { destination, code, rolling, collided, stalled, ghost, staged, current } = options;
    const length = options.length;
    const width = options.width;
    const color = DESTINATIONS[routeForDestination(destination)].color;
    const pulse = collided ? 0.65 + Math.sin((performance.now() / 140) % (Math.PI * 2)) * 0.25 : 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    roundedRect(ctx, -length / 2 + 3, -width / 2 + 5, length, width, 3);
    ctx.fill();

    const body = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    if (ghost) {
      body.addColorStop(0, "rgba(120, 139, 132, 0.2)");
      body.addColorStop(1, "rgba(50, 65, 62, 0.15)");
    } else {
      body.addColorStop(0, "#4b5250");
      body.addColorStop(0.18, "#313837");
      body.addColorStop(0.8, "#232a29");
      body.addColorStop(1, "#141a1a");
    }
    ctx.fillStyle = body;
    roundedRect(ctx, -length / 2, -width / 2, length, width, 3);
    ctx.fill();
    ctx.strokeStyle = ghost
      ? "rgba(207, 220, 211, 0.4)"
      : collided
        ? `rgba(240, 100, 85, ${0.55 * pulse})`
        : "rgba(218, 221, 204, 0.35)";
    ctx.lineWidth = collided ? 1.5 : 0.8;
    ctx.stroke();

    ctx.fillStyle = collided ? `rgba(240, 100, 85, ${0.7 * pulse})` : `${color}aa`;
    ctx.fillRect(-length / 2 + 3, -width / 2 + 2, length - 6, 2.2);
    ctx.fillRect(-length / 2 + 3, width / 2 - 4, length - 6, 1.5);

    ctx.strokeStyle = "rgba(9, 13, 13, 0.72)";
    ctx.lineWidth = 0.7;
    for (let rib = -0.45; rib <= 0.45; rib += 0.22) {
      ctx.beginPath();
      ctx.moveTo(length * rib, -width / 2 + 4);
      ctx.lineTo(length * rib, width / 2 - 5);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(212, 205, 180, 0.12)";
    ctx.fillRect(-length / 2 + 5, -3.5, length - 10, 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    ctx.fillRect(-length / 2 + 3, width / 2 - 7, length - 6, 3);

    ctx.fillStyle = "#121817";
    for (const axle of [-length * 0.29, length * 0.29]) {
      for (const wheel of [-width / 2 - 1, width / 2 - 1]) {
        ctx.beginPath();
        ctx.arc(axle, wheel + (wheel < 0 ? 1 : -1), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#7b8178";
    ctx.fillRect(-length / 2 - 3, -3, 3, 6);
    ctx.fillRect(length / 2, -3, 3, 6);

    if (stalled) {
      ctx.strokeStyle = "#e8a64d";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(-length / 2 - 3, -width / 2 - 3, length + 6, width + 6);
    }
    if (current && staged) {
      ctx.strokeStyle = "rgba(240, 200, 121, 0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-length / 2 - 2.5, -width / 2 - 2.5, length + 5, width + 5);
    }

    if (!ghost && width >= 18) {
      ctx.save();
      ctx.rotate(-angle);
      ctx.fillStyle = current ? "rgba(247, 225, 180, 0.92)" : "rgba(210, 218, 204, 0.48)";
      ctx.font = "600 5.4px 'SFMono-Regular', 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(code, 0, 0.3);
      ctx.restore();
    }

    if (rolling && !ghost) {
      ctx.strokeStyle = "rgba(240, 200, 121, 0.72)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-length / 2 - 7, -3);
      ctx.lineTo(-length / 2 - 2, 0);
      ctx.lineTo(-length / 2 - 7, 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSpeedTag(ctx, point, car, color) {
    const speed = car.velocity * 3.6;
    const x = point.x;
    const y = point.y - 28;
    ctx.save();
    ctx.strokeStyle = `${color}66`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y + 11);
    ctx.lineTo(x, point.y - 10);
    ctx.stroke();

    const label = `${speed.toFixed(1)} km/h`;
    ctx.font = "600 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    const width = ctx.measureText(label).width + 14;
    ctx.fillStyle = "rgba(8, 14, 14, 0.9)";
    ctx.fillRect(x - width / 2, y - 7, width, 15);
    ctx.strokeStyle = `${color}88`;
    ctx.strokeRect(x - width / 2, y - 7, width, 15);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 0.8);

    const vectorLength = clamp(car.velocity * 3.4, 5, 22);
    const endX = point.x + Math.cos(point.angle) * (16 + vectorLength);
    const endY = point.y + Math.sin(point.angle) * (16 + vectorLength);
    const startX = point.x + Math.cos(point.angle) * 17;
    const startY = point.y + Math.sin(point.angle) * 17;
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - Math.cos(point.angle - 0.45) * 4,
      endY - Math.sin(point.angle - 0.45) * 4,
    );
    ctx.lineTo(
      endX - Math.cos(point.angle + 0.45) * 4,
      endY - Math.sin(point.angle + 0.45) * 4,
    );
    ctx.closePath();
    ctx.fillStyle = `${color}aa`;
    ctx.fill();
    ctx.restore();
  }

  drawEffects(ctx, frame) {
    for (const car of frame.cars) {
      if (car.route === null || car.status === "staged") continue;
      const point = this.progressToWorld(car.progress, car.route);
      if (car.status === "rolling" && car.brakeStarted && car.velocity > 0.35) {
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.rotate(point.angle);
        ctx.strokeStyle = "rgba(246, 171, 74, 0.68)";
        ctx.lineWidth = 0.8;
        for (let spark = 0; spark < 5; spark += 1) {
          const phase = frame.elapsed * 14 + spark * 2.1 + car.index;
          const x = -18 - (spark % 3) * 2;
          const y = (spark % 2 ? 1 : -1) * (8 + ((phase * 3) % 4));
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 4 - (spark % 2) * 3, y + Math.sin(phase) * 4);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (car.status === "collided") {
        const seed = car.index * 7 + 1;
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.strokeStyle = "rgba(247, 146, 91, 0.82)";
        ctx.fillStyle = "rgba(247, 146, 91, 0.72)";
        for (let index = 0; index < 9; index += 1) {
          const angle = seed + index * 0.82;
          const distance = 5 + ((index * 13 + seed) % 16);
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          ctx.fillRect(x, y, 1.6, 1.6);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(angle) * 7, y + Math.sin(angle) * 7);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (frame.phase === "success") {
      ctx.save();
      ctx.strokeStyle = "rgba(117, 199, 164, 0.35)";
      ctx.lineWidth = 1;
      for (const car of frame.cars) {
        if (car.route === null) continue;
        const point = this.progressToWorld(car.progress, car.route);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 13 + Math.sin(frame.elapsed * 4 + car.index) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawLabels(ctx, frame, ui) {
    ctx.save();
    ctx.fillStyle = "rgba(217, 198, 160, 0.35)";
    ctx.font = "600 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.translate(65, 520);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("INFEED · PUSH LINE", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(210, 219, 208, 0.35)";
    ctx.font = "7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("RETARDER", 93, 645);
    ctx.fillStyle = "rgba(210, 219, 208, 0.22)";
    ctx.fillText("10 CARS", 150, 645);
    ctx.restore();

    for (let route = 0; route < DESTINATIONS.length; route += 1) {
      const count = frame.laneCounts?.[route] ?? 0;
      const capacity = DESTINATIONS[route].capacity;
      const color = DESTINATIONS[route].color;
      ctx.save();
      ctx.textAlign = "right";
      ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', monospace";
      ctx.fillStyle = count === capacity ? "#75c7a4" : `${color}9c`;
      ctx.fillText(`${count}/${capacity}`, 902, LANE_Y[route] - 25);
      ctx.restore();
    }

    const gate = ui.releaseGate;
    if (gate && !gate.open && frame.phase !== "failure") {
      const progress = frame.cars.find((car) => car.id === gate.carId);
      const point = progress?.route !== null && progress ? this.progressToWorld(progress.progress, progress.route) : null;
      if (point) {
        const pulse = 0.55 + Math.sin(frame.elapsed * 5) * 0.18;
        ctx.save();
        ctx.strokeStyle = `rgba(232, 166, 77, ${pulse})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(232, 166, 77, ${pulse})`;
        ctx.font = "600 6px 'SFMono-Regular', 'Noto Sans SC', monospace";
        ctx.textAlign = "center";
        ctx.fillText("WAIT", point.x, point.y + 28);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.fillStyle = "rgba(211, 201, 177, 0.17)";
    ctx.font = "6px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("0", 420, 656);
    ctx.fillText("50 m", 505, 656);
    ctx.fillText("100 m", 607, 656);
    ctx.strokeStyle = "rgba(211, 201, 177, 0.2)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(420, 648);
    ctx.lineTo(650, 648);
    ctx.stroke();
    ctx.restore();
  }
}
