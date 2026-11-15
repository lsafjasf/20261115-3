import { ICE, WORLD, clamp } from "./config.js";
import { SeededRng } from "./rng.js";

const TAU = Math.PI * 2;
const SANS = "'Whiteout Sans', 'Noto Sans CJK SC', sans-serif";
const MONO = "'Whiteout Sans', 'DejaVu Sans Mono', monospace";

function pathThrough(points, ctx) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
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

export class SceneRenderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sim = simulation;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.portrait = false;
    this.cameraX = 0;
    this.time = 0;
    this.waypoint = null;
    this.pointer = null;
    this.shake = 0;
    this.lastImpactAt = -10;
    this.snow = [];
    this.background = this._buildBackground();
    this._seedSnow();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.portrait = this.width < 880 && this.height > this.width * 1.12;
    if (this.portrait) {
      this.scale = this.height / WORLD.height;
      this.cameraX = this.sim.vehicle.x;
      this.offsetY = 0;
      this._updateCamera(true);
    } else {
      this.scale = Math.min(this.width / WORLD.width, this.height / WORLD.height);
      this.offsetX = (this.width - WORLD.width * this.scale) / 2;
      this.offsetY = (this.height - WORLD.height * this.scale) / 2;
    }
  }

  _updateCamera(immediate = false) {
    if (!this.portrait) return;
    const follow = immediate ? 1 : 0.2;
    this.cameraX += (this.sim.vehicle.x - this.cameraX) * follow;
    const worldWidth = WORLD.width * this.scale;
    this.offsetX = clamp(
      this.width / 2 - this.cameraX * this.scale,
      this.width - worldWidth,
      0
    );
    this.offsetY = 0;
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.offsetX) / this.scale;
    const y = (clientY - rect.top - this.offsetY) / this.scale;
    return { x: clamp(x, 0, WORLD.width), y: clamp(y, 0, WORLD.height) };
  }

  _buildBackground() {
    const canvas = document.createElement("canvas");
    canvas.width = WORLD.width;
    canvas.height = WORLD.height;
    const ctx = canvas.getContext("2d");
    const rng = new SeededRng(WORLD.seed ^ 0x41c64e6d);

    const sky = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    sky.addColorStop(0, "#06141a");
    sky.addColorStop(0.34, "#0c2a31");
    sky.addColorStop(0.79, "#123c43");
    sky.addColorStop(1, "#0a252c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const lakeGlow = ctx.createRadialGradient(800, 430, 80, 800, 520, 720);
    lakeGlow.addColorStop(0, "rgba(79, 142, 146, 0.14)");
    lakeGlow.addColorStop(0.55, "rgba(22, 70, 77, 0.05)");
    lakeGlow.addColorStop(1, "rgba(0, 0, 0, 0.2)");
    ctx.fillStyle = lakeGlow;
    ctx.fillRect(0, 0, WORLD.width, WORLD.shoreY + 20);

    for (let i = 0; i < 54; i += 1) {
      const x = rng.range(-110, WORLD.width + 110);
      const y = rng.range(40, WORLD.shoreY + 10);
      const radiusX = rng.range(50, 220);
      const radiusY = rng.range(28, 112);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng.range(-0.3, 0.3));
      const patch = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
      patch.addColorStop(0, `rgba(122, 190, 190, ${rng.range(0.014, 0.045)})`);
      patch.addColorStop(0.7, "rgba(85, 153, 158, 0.015)");
      patch.addColorStop(1, "rgba(10, 39, 45, 0)");
      ctx.fillStyle = patch;
      ctx.beginPath();
      ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.lineCap = "round";
    for (let i = 0; i < 170; i += 1) {
      const x = rng.range(20, WORLD.width - 20);
      const y = rng.range(60, WORLD.shoreY - 10);
      const length = rng.range(10, 92);
      const angle = rng.range(-0.22, 0.22);
      ctx.strokeStyle = `rgba(194, 231, 227, ${rng.range(0.012, 0.05)})`;
      ctx.lineWidth = rng.range(0.4, 1.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }

    for (let i = 0; i < 26; i += 1) {
      const x = rng.range(80, WORLD.width - 80);
      const y = rng.range(WORLD.shoreY - 120, WORLD.shoreY + 4);
      const radius = rng.range(20, 66);
      const drift = ctx.createRadialGradient(x, y, 0, x, y, radius);
      drift.addColorStop(0, "rgba(218, 241, 235, 0.028)");
      drift.addColorStop(1, "rgba(218, 241, 235, 0)");
      ctx.fillStyle = drift;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.8, radius * 0.34, -0.1, 0, TAU);
      ctx.fill();
    }

    this._drawShore(ctx, rng);
    this._drawBackgroundWind(ctx, rng);
    return canvas;
  }

  _drawShore(ctx, rng) {
    const edgePoints = [];
    for (let x = -20; x <= WORLD.width + 20; x += 28) {
      const y = WORLD.shoreY + Math.sin(x * 0.012) * 16 + Math.sin(x * 0.033) * 5 + rng.range(-4, 4);
      edgePoints.push({ x, y });
    }
    ctx.beginPath();
    ctx.moveTo(-20, WORLD.height + 20);
    for (const point of edgePoints) ctx.lineTo(point.x, point.y);
    ctx.lineTo(WORLD.width + 20, WORLD.height + 20);
    ctx.closePath();
    const shore = ctx.createLinearGradient(0, WORLD.shoreY - 20, 0, WORLD.height);
    shore.addColorStop(0, "#29494c");
    shore.addColorStop(0.09, "#6e8783");
    shore.addColorStop(0.2, "#9bac9f");
    shore.addColorStop(0.45, "#6b8179");
    shore.addColorStop(1, "#304c4c");
    ctx.fillStyle = shore;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-20, WORLD.height + 20);
    for (const point of edgePoints) ctx.lineTo(point.x, point.y);
    ctx.lineTo(WORLD.width + 20, WORLD.height + 20);
    ctx.closePath();
    ctx.clip();
    for (let i = 0; i < 220; i += 1) {
      const x = rng.range(0, WORLD.width);
      const y = rng.range(WORLD.shoreY - 4, WORLD.height);
      const radius = rng.range(1, 7);
      ctx.fillStyle = rng.chance(0.38)
        ? `rgba(215, 231, 221, ${rng.range(0.04, 0.16)})`
        : `rgba(17, 34, 35, ${rng.range(0.06, 0.2)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radius * rng.range(0.35, 0.8), rng.range(-0.4, 0.4), 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 22; i += 1) {
      const x = rng.range(30, WORLD.width - 30);
      const y = rng.range(WORLD.shoreY + 28, WORLD.height - 10);
      ctx.strokeStyle = `rgba(226, 239, 230, ${rng.range(0.012, 0.04)})`;
      ctx.lineWidth = rng.range(8, 30);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(80, 220), y + rng.range(-4, 4));
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(189, 226, 219, 0.28)";
    ctx.lineWidth = 2;
    pathThrough(edgePoints, ctx);
    ctx.stroke();
    ctx.strokeStyle = "rgba(2, 16, 21, 0.55)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-20, WORLD.shoreY + 23);
    for (const point of edgePoints) ctx.lineTo(point.x, point.y + 22);
    ctx.stroke();

    this._drawShoreLights(ctx);
  }

  _drawShoreLights(ctx) {
    for (const x of [570, 1042]) {
      const glow = ctx.createRadialGradient(x, WORLD.shoreY + 28, 0, x, WORLD.shoreY + 28, 115);
      glow.addColorStop(0, "rgba(255, 178, 81, 0.22)");
      glow.addColorStop(1, "rgba(255, 178, 81, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 120, WORLD.shoreY - 10, 240, 180);
      ctx.fillStyle = "#ffc26d";
      ctx.beginPath();
      ctx.arc(x, WORLD.shoreY + 32, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 216, 159, 0.48)";
      ctx.fillRect(x - 1, WORLD.shoreY + 35, 2, 20);
    }
  }

  _drawBackgroundWind(ctx, rng) {
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 48; i += 1) {
      const x = rng.range(-80, WORLD.width);
      const y = rng.range(0, WORLD.height);
      const length = rng.range(120, 360);
      const gradient = ctx.createLinearGradient(x, y, x + length, y - length * 0.16);
      gradient.addColorStop(0, "rgba(230, 247, 244, 0)");
      gradient.addColorStop(0.6, `rgba(230, 247, 244, ${rng.range(0.008, 0.022)})`);
      gradient.addColorStop(1, "rgba(230, 247, 244, 0)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = rng.range(1, 5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length, y - length * 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  _seedSnow() {
    const rng = new SeededRng(WORLD.seed ^ 0x9e3779b9);
    this.snow = Array.from({ length: 310 }, () => ({
      x: rng.range(0, WORLD.width),
      y: rng.range(0, WORLD.height),
      length: rng.range(2, 14),
      speed: rng.range(90, 280),
      alpha: rng.range(0.08, 0.42),
      depth: rng.range(0.3, 1)
    }));
  }

  update(dt) {
    this.time += dt;
    this._updateCamera();
    const wind = 90 + Math.sin(this.time * 0.17) * 28;
    for (const flake of this.snow) {
      flake.x += (wind + flake.speed * 0.28) * flake.depth * dt;
      flake.y += flake.speed * flake.depth * dt * 0.24;
      if (flake.x > WORLD.width + 30 || flake.y > WORLD.height + 30) {
        flake.x = -30 - Math.random() * 140;
        flake.y = Math.random() * WORLD.height * 0.9 - 30;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 3.2);
    if (this.sim.lastIce?.shock > 0.2) {
      this.shake = Math.max(this.shake, clamp(this.sim.lastIce.shock, 0, 1.2));
    }
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const outer = ctx.createRadialGradient(this.width / 2, this.height / 2, 50, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.72);
    outer.addColorStop(0, "#07191f");
    outer.addColorStop(1, "#02080b");
    ctx.fillStyle = outer;
    ctx.fillRect(0, 0, this.width, this.height);

    const shakeX = (Math.random() - 0.5) * this.shake * 5;
    const shakeY = (Math.random() - 0.5) * this.shake * 5;
    const s = this.scale * dpr;
    ctx.setTransform(s, 0, 0, s, (this.offsetX + shakeX) * dpr, (this.offsetY + shakeY) * dpr);
    ctx.drawImage(this.background, 0, 0);
    this._drawStressField(ctx);
    this._drawTracks(ctx);
    this._drawCracks(ctx);
    this._drawRoute(ctx);
    this._drawSurvivors(ctx);
    this._drawVehicle(ctx);
    this._drawSnow(ctx);
    this._drawAtmosphere(ctx);
    this._drawWorldLabels(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawCompass(ctx);
    this._drawMinimap(ctx);
    this._drawOffscreenMarkers(ctx);
    this._drawScreenVignette(ctx);
  }

  _drawOffscreenMarkers(ctx) {
    if (!this.portrait) return;
    for (const person of this.sim.survivors) {
      if (person.status !== "waiting") continue;
      const screenX = this.offsetX + person.x * this.scale;
      const screenY = this.offsetY + person.y * this.scale;
      if (screenX > 16 && screenX < this.width - 16) continue;
      const left = screenX <= 16;
      const x = left ? 22 : this.width - 22;
      const y = clamp(screenY, 150, this.height - 128);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = "rgba(4, 17, 21, 0.82)";
      roundedRect(ctx, left ? -5 : -50, -12, 55, 24, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 180, 84, 0.3)";
      ctx.stroke();
      ctx.fillStyle = "#ffb454";
      ctx.beginPath();
      if (left) {
        ctx.moveTo(0, 0);
        ctx.lineTo(7, -5);
        ctx.lineTo(7, 5);
      } else {
        ctx.moveTo(0, 0);
        ctx.lineTo(-7, -5);
        ctx.lineTo(-7, 5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255, 220, 164, 0.85)";
      ctx.font = `9px ${MONO}`;
      ctx.textAlign = left ? "start" : "end";
      ctx.fillText(person.name, left ? 13 : -13, 3);
      ctx.textAlign = "start";
      ctx.restore();
    }
  }

  _drawStressField(ctx) {
    for (const cell of this.sim.ice.cells) {
      if (cell.stress < 55 && !cell.broken) continue;
      const strength = clamp((cell.stress - 48) / 56, 0, 1);
      if (cell.broken) {
        this._drawOpenWater(ctx, cell);
        continue;
      }
      const gradient = ctx.createRadialGradient(cell.x, cell.y, 0, cell.x, cell.y, 94);
      gradient.addColorStop(0, `rgba(145, 220, 213, ${strength * 0.035})`);
      gradient.addColorStop(0.55, `rgba(255, 154, 91, ${strength * 0.023})`);
      gradient.addColorStop(1, "rgba(255, 154, 91, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cell.x, cell.y, 104, 82, 0, 0, TAU);
      ctx.fill();
    }
  }

  _drawOpenWater(ctx, cell) {
    ctx.save();
    ctx.translate(cell.x, cell.y);
    ctx.beginPath();
    const points = 15;
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * TAU;
      const wobble = 0.78 + Math.sin(i * 7.1 + cell.col) * 0.08 + Math.sin(i * 3.3 + cell.row) * 0.08;
      const x = Math.cos(angle) * ICE.cellW * 0.48 * wobble;
      const y = Math.sin(angle) * ICE.cellH * 0.48 * wobble;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const water = ctx.createRadialGradient(0, 0, 2, 0, 0, 74);
    water.addColorStop(0, "#01080c");
    water.addColorStop(0.72, "#03131a");
    water.addColorStop(1, "rgba(5, 28, 33, 0.82)");
    ctx.fillStyle = water;
    ctx.fill();
    ctx.strokeStyle = "rgba(179, 228, 221, 0.28)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = "rgba(199, 238, 231, 0.1)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 38, 18, 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _drawCracks(ctx) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const crack of this.sim.ice.cracks) {
      const cell = this.sim.ice.cells[this.sim.ice.indexFor(crack.cellCol, crack.cellRow)];
      const stress = clamp((cell.stress - 30) / 65, 0, 1);
      const visibleLength = crack.totalLength * crack.visible;
      ctx.shadowColor = `rgba(167, 233, 226, ${0.14 + stress * 0.24})`;
      ctx.shadowBlur = 6 + stress * 9;
      this._strokeCrackPath(ctx, crack.points, visibleLength, 3.2, `rgba(1, 12, 16, ${0.48 + stress * 0.18})`);
      this._strokeCrackPath(ctx, crack.points, visibleLength, 1.05, `rgba(188, 235, 228, ${0.46 + stress * 0.4})`);
      const branchProgress = clamp((crack.visible - crack.baseVisible) / Math.max(0.01, 1 - crack.baseVisible), 0, 1);
      if (branchProgress > 0.015) {
        for (const branch of crack.branches) {
          const branchLength = branch.totalLength * clamp(branchProgress * 1.25, 0, 1);
          this._strokeCrackPath(ctx, branch.points, branchLength, 2.3, "rgba(1, 13, 16, 0.4)");
          this._strokeCrackPath(ctx, branch.points, branchLength, 0.75, `rgba(205, 242, 234, ${0.35 + stress * 0.42})`);
        }
      }
    }
    for (const crack of this.sim.ice.microCracks) {
      ctx.shadowColor = "rgba(228, 249, 242, 0.24)";
      ctx.shadowBlur = 4;
      pathThrough(crack.points, ctx);
      ctx.strokeStyle = "rgba(1, 11, 14, 0.5)";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      pathThrough(crack.points, ctx);
      ctx.strokeStyle = "rgba(220, 244, 237, 0.68)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  _strokeCrackPath(ctx, points, targetLength, width, color) {
    let length = 0;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const point = points[i];
      const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (length + segment <= targetLength) {
        ctx.lineTo(point.x, point.y);
        length += segment;
      } else {
        const remainder = Math.max(0, targetLength - length);
        if (remainder > 0) {
          const t = remainder / segment;
          ctx.lineTo(previous.x + (point.x - previous.x) * t, previous.y + (point.y - previous.y) * t);
        }
        break;
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  _drawTracks(ctx) {
    const trail = this.sim.trail;
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const side of ["left", "right"]) {
      ctx.beginPath();
      ctx.moveTo(trail[0][`${side}X`], trail[0][`${side}Y`]);
      for (let i = 1; i < trail.length; i += 1) {
        ctx.lineTo(trail[i][`${side}X`], trail[i][`${side}Y`]);
      }
      ctx.strokeStyle = "rgba(2, 15, 19, 0.37)";
      ctx.lineWidth = 8.5;
      ctx.stroke();
      ctx.strokeStyle = "rgba(131, 195, 191, 0.11)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(168, 220, 214, 0.12)";
    ctx.lineWidth = 0.8;
    for (let i = 5; i < trail.length; i += 6) {
      const pose = trail[i];
      const sideX = Math.cos(pose.heading + Math.PI / 2);
      const sideY = Math.sin(pose.heading + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(pose.x - sideX * 16, pose.y - sideY * 16);
      ctx.lineTo(pose.x + sideX * 16, pose.y + sideY * 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawRoute(ctx) {
    if (!this.waypoint || this.sim.mode !== "running") return;
    const vehicle = this.sim.vehicle;
    const target = this.waypoint;
    const distance = Math.hypot(target.x - vehicle.x, target.y - vehicle.y);
    ctx.save();
    ctx.setLineDash([7, 10]);
    ctx.lineDashOffset = -this.time * 22;
    ctx.strokeStyle = "rgba(156, 220, 216, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(vehicle.x, vehicle.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const pulse = 12 + Math.sin(this.time * 4) * 2;
    ctx.strokeStyle = "rgba(255, 188, 101, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(target.x, target.y, pulse, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 188, 101, 0.2)";
    ctx.beginPath();
    ctx.arc(target.x, target.y, pulse + 7, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(6, 20, 24, 0.76)";
    roundedRect(ctx, target.x + 17, target.y - 18, 69, 18, 2);
    ctx.fill();
    ctx.fillStyle = "rgba(236, 246, 241, 0.66)";
    ctx.font = `9px ${MONO}`;
    ctx.fillText(`${Math.round(distance * 0.4)} m`, target.x + 25, target.y - 6);
    ctx.restore();
  }

  _drawSurvivors(ctx) {
    for (const person of this.sim.survivors) {
      if (person.status !== "waiting") continue;
      const vehicle = this.sim.vehicle;
      const distance = Math.hypot(person.x - vehicle.x, person.y - vehicle.y);
      const pulse = 0.5 + Math.sin(this.time * 2.6 + person.x * 0.01) * 0.5;
      ctx.save();
      ctx.translate(person.x, person.y);

      const flare = ctx.createRadialGradient(0, 0, 0, 0, 0, 74 + pulse * 12);
      flare.addColorStop(0, "rgba(255, 183, 91, 0.14)");
      flare.addColorStop(0.42, "rgba(255, 150, 64, 0.045)");
      flare.addColorStop(1, "rgba(255, 150, 64, 0)");
      ctx.fillStyle = flare;
      ctx.beginPath();
      ctx.arc(0, 0, 90, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 178, 85, ${0.13 + pulse * 0.16})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 28 + pulse * 13, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 219, 166, 0.35)";
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(1, 10, 13, 0.44)";
      ctx.beginPath();
      ctx.ellipse(2, 10, 16, 8, -0.3, 0, TAU);
      ctx.fill();

      ctx.rotate(-0.28);
      ctx.fillStyle = "#f3a14f";
      roundedRect(ctx, -5, -3, 10, 15, 4);
      ctx.fill();
      ctx.fillStyle = "#b65830";
      ctx.fillRect(-4, 4, 8, 2);
      ctx.strokeStyle = "#df8d43";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-10, 7);
      ctx.moveTo(4, 0);
      ctx.lineTo(10, 6);
      ctx.stroke();
      ctx.fillStyle = "#e9c6a0";
      ctx.beginPath();
      ctx.arc(0, -7, 4.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#d29660";
      ctx.beginPath();
      ctx.arc(0, -8, 4.4, Math.PI, TAU);
      ctx.fill();
      ctx.restore();

      this._drawPersonLabel(ctx, person, distance, pulse);
    }
  }

  _drawPersonLabel(ctx, person, distance, pulse) {
    const x = person.x + 25;
    const y = person.y - 28;
    const width = 108;
    ctx.fillStyle = "rgba(4, 18, 22, 0.78)";
    roundedRect(ctx, x, y, width, 34, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 183, 88, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 34);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 208, 143, 0.92)";
    ctx.font = `600 11px ${SANS}`;
    ctx.fillText(person.name, x + 9, y + 14);
    ctx.fillStyle = "rgba(216, 234, 230, 0.4)";
    ctx.font = `9px ${MONO}`;
    ctx.fillText(`${person.role} · ${Math.round(distance * 0.4)} m`, x + 9, y + 26);
    if (distance < 120) {
      ctx.fillStyle = `rgba(255, 185, 90, ${0.55 + pulse * 0.3})`;
      ctx.font = `8px ${MONO}`;
      ctx.fillText("减速接近", x + 64, y - 7);
    }
  }

  _drawVehicle(ctx) {
    const vehicle = this.sim.vehicle;
    const speed = Math.abs(vehicle.speed);
    const support = this.sim.lastIce?.support ?? 100;
    const danger = support < 34;
    const sinking = this.sim.mode === "lost";
    ctx.save();
    ctx.translate(vehicle.x, vehicle.y);
    ctx.rotate(vehicle.heading);

    if (sinking) {
      const water = ctx.createRadialGradient(0, 0, 0, 0, 0, 72);
      water.addColorStop(0, "#01080b");
      water.addColorStop(1, "rgba(2, 13, 17, 0)");
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.arc(0, 0, 72, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.32;
      ctx.rotate(this.time * 0.08);
    }

    if (speed > 4) {
      const wakeAlpha = clamp(speed / 190, 0, 1) * 0.1;
      ctx.strokeStyle = `rgba(191, 232, 224, ${wakeAlpha})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        const offset = 32 + i * 9 + ((this.time * speed * 0.16) % 9);
        ctx.beginPath();
        ctx.ellipse(-offset, 0, 18 + i * 6, 22 + i * 5, 0, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(0, 8, 10, 0.48)";
    ctx.beginPath();
    ctx.ellipse(-1, 2, 35, 23, 0, 0, TAU);
    ctx.fill();

    for (const side of [-1, 1]) {
      ctx.fillStyle = "#111a1a";
      roundedRect(ctx, -27, side === -1 ? -19 : 10, 54, 9, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(154, 191, 181, 0.28)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.strokeStyle = "rgba(137, 172, 163, 0.2)";
      for (let x = -23; x <= 23; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, side === -1 ? -18 : 11);
        ctx.lineTo(x + 1.5, side === -1 ? -11 : 18);
        ctx.stroke();
      }
    }

    const body = ctx.createLinearGradient(-24, -14, 25, 14);
    body.addColorStop(0, "#5d492e");
    body.addColorStop(0.45, "#c47b36");
    body.addColorStop(1, "#734323");
    ctx.fillStyle = body;
    roundedRect(ctx, -24, -14, 48, 28, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 196, 109, 0.36)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#182728";
    roundedRect(ctx, -16, -10, 17, 20, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(201, 230, 217, 0.15)";
    roundedRect(ctx, -14, -8, 12, 16, 2);
    ctx.fill();

    const glass = ctx.createLinearGradient(3, -10, 20, 9);
    glass.addColorStop(0, "#8fbab0");
    glass.addColorStop(0.45, "#385a58");
    glass.addColorStop(1, "#172b2b");
    ctx.fillStyle = glass;
    roundedRect(ctx, 3, -10, 15, 20, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(226, 247, 236, 0.24)";
    ctx.fillRect(6, -8, 2, 16);

    ctx.fillStyle = "#2b2320";
    ctx.fillRect(-21, -16, 31, 2);
    ctx.fillRect(-21, 14, 31, 2);
    ctx.fillStyle = "#ba7439";
    roundedRect(ctx, -8, -4, 7, 8, 1);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 235, 201, 0.65)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-6.5, -2);
    ctx.lineTo(-6.5, 2);
    ctx.moveTo(-8.5, 0);
    ctx.lineTo(-4.5, 0);
    ctx.stroke();

    ctx.fillStyle = "#f2bc6b";
    ctx.beginPath();
    ctx.arc(21, -10, 2.3, 0, TAU);
    ctx.arc(21, 10, 2.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 196, 101, 0.16)";
    ctx.beginPath();
    ctx.moveTo(22, -13);
    ctx.lineTo(90, -34);
    ctx.lineTo(90, 34);
    ctx.lineTo(22, 13);
    ctx.closePath();
    ctx.fill();

    const beaconPulse = 0.5 + Math.sin(this.time * 5.2) * 0.5;
    const beacon = ctx.createRadialGradient(-2, 0, 0, -2, 0, 24);
    beacon.addColorStop(0, `rgba(255, 180, 81, ${0.4 + beaconPulse * 0.35})`);
    beacon.addColorStop(1, "rgba(255, 180, 81, 0)");
    ctx.fillStyle = beacon;
    ctx.beginPath();
    ctx.arc(-2, 0, 24, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffc26e";
    ctx.beginPath();
    ctx.arc(-3, 0, 3.2, 0, TAU);
    ctx.fill();

    if (vehicle.aboard.length) {
      for (let i = 0; i < vehicle.aboard.length; i += 1) {
        ctx.fillStyle = "#8dd1cc";
        ctx.beginPath();
        ctx.arc(-11 + i * 6, 0, 2, 0, TAU);
        ctx.fill();
      }
    }

    if (danger && !sinking) {
      const ring = 30 + Math.sin(this.time * 7) * 4;
      ctx.strokeStyle = `rgba(255, 91, 62, ${0.35 + beaconPulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, ring, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    if (!sinking) {
      ctx.save();
      ctx.fillStyle = "rgba(3, 14, 18, 0.72)";
      roundedRect(ctx, vehicle.x - 26, vehicle.y + 34, 52, 16, 2);
      ctx.fill();
      ctx.fillStyle = danger ? "#ff8a69" : "rgba(220, 239, 233, 0.66)";
      ctx.font = `8px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText(danger ? "承载力低" : "R-07", vehicle.x, vehicle.y + 45);
      ctx.textAlign = "start";
      ctx.restore();
    }
  }

  _drawSnow(ctx) {
    ctx.save();
    ctx.lineCap = "round";
    for (const flake of this.snow) {
      ctx.strokeStyle = `rgba(224, 244, 239, ${flake.alpha})`;
      ctx.lineWidth = 0.55 + flake.depth;
      ctx.beginPath();
      ctx.moveTo(flake.x, flake.y);
      ctx.lineTo(flake.x + flake.length * 1.5, flake.y + flake.length * 0.45);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawAtmosphere(ctx) {
    const top = ctx.createLinearGradient(0, 0, 0, 270);
    top.addColorStop(0, "rgba(1, 8, 12, 0.65)");
    top.addColorStop(0.45, "rgba(5, 19, 23, 0.17)");
    top.addColorStop(1, "rgba(5, 19, 23, 0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, WORLD.width, 280);
    const side = ctx.createLinearGradient(WORLD.width - 380, 0, WORLD.width, 0);
    side.addColorStop(0, "rgba(2, 9, 12, 0)");
    side.addColorStop(1, "rgba(2, 9, 12, 0.48)");
    ctx.fillStyle = side;
    ctx.fillRect(WORLD.width - 380, 0, 380, WORLD.height);
  }

  _drawWorldLabels(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 170, 102, 0.19)";
    ctx.fillStyle = "rgba(255, 196, 135, 0.27)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(758, 470);
    ctx.lineTo(685, 548);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `8px ${MONO}`;
    ctx.letterSpacing = "2px";
    ctx.fillText("CENTRAL RIFT", 602, 568);
    ctx.fillStyle = "rgba(255, 196, 135, 0.14)";
    ctx.fillText("中央裂隙 · 高应力区", 602, 581);

    ctx.fillStyle = "rgba(230, 241, 233, 0.3)";
    ctx.font = `9px ${MONO}`;
    ctx.fillText("SOUTH RESCUE CAMP  /  南岸救援站", 678, 930);
    ctx.strokeStyle = "rgba(237, 245, 236, 0.25)";
    ctx.beginPath();
    ctx.moveTo(108, 914);
    ctx.lineTo(188, 914);
    ctx.stroke();
    ctx.fillStyle = "rgba(230, 241, 233, 0.25)";
    ctx.fillText("50 m", 122, 907);
    ctx.strokeStyle = "rgba(181, 224, 217, 0.22)";
    ctx.beginPath();
    ctx.moveTo(90, 830);
    ctx.lineTo(90, 790);
    ctx.stroke();
    ctx.fillStyle = "rgba(207, 235, 229, 0.42)";
    ctx.font = `10px ${MONO}`;
    ctx.fillText("N", 86, 778);
    ctx.restore();
  }

  _drawCompass(ctx) {
    if (this.width < 740) return;
    const x = this.width / 2;
    const y = 33;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(157, 213, 210, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(4, 2);
    ctx.lineTo(0, 0);
    ctx.lineTo(-4, 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 180, 84, 0.75)";
    ctx.fill();
    ctx.fillStyle = "rgba(215, 235, 230, 0.42)";
    ctx.font = `7px ${MONO}`;
    ctx.textAlign = "center";
    ctx.fillText("N", 0, -23);
    ctx.textAlign = "start";
    ctx.restore();
  }

  _drawMinimap(ctx) {
    if (this.width < 980) return;
    const width = 206;
    const height = 132;
    const x = this.width - width - 48;
    const y = this.height - height - 40;
    const pad = 10;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2 - 13;
    ctx.save();
    ctx.fillStyle = "rgba(4, 17, 21, 0.7)";
    roundedRect(ctx, x, y, width, height, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(160, 215, 211, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(190, 225, 218, 0.38)";
    ctx.font = `7px ${MONO}`;
    ctx.fillText("LAKE MAP / R-07", x + pad, y + 13);
    ctx.fillStyle = "rgba(255, 181, 86, 0.45)";
    ctx.fillText("SEED 20261115", x + width - 82, y + 13);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + pad, y + 19, innerW, innerH);
    ctx.clip();
    ctx.fillStyle = "rgba(33, 77, 82, 0.55)";
    ctx.fillRect(x + pad, y + 19, innerW, innerH);
    const sx = innerW / WORLD.width;
    const sy = innerH / WORLD.shoreY;
    for (const crack of this.sim.ice.cracks) {
      const cell = this.sim.ice.cells[this.sim.ice.indexFor(crack.cellCol, crack.cellRow)];
      ctx.strokeStyle = cell.stress > 72 ? "rgba(255, 140, 91, 0.6)" : "rgba(173, 224, 219, 0.22)";
      ctx.lineWidth = cell.stress > 72 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + crack.points[0].x * sx, y + 19 + crack.points[0].y * sy);
      const end = crack.points[Math.floor(crack.points.length * crack.visible)];
      ctx.lineTo(x + pad + end.x * sx, y + 19 + end.y * sy);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(205, 233, 225, 0.44)";
    ctx.fillRect(x + pad, y + 19 + WORLD.shoreY * sy - 1, innerW, 2);
    for (const person of this.sim.survivors) {
      if (person.status === "safe") continue;
      ctx.fillStyle = person.status === "aboard" ? "#8bd5ce" : "#ffb454";
      ctx.beginPath();
      ctx.arc(x + pad + person.x * sx, y + 19 + person.y * sy, 2.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 190, 102, 0.2)";
      ctx.beginPath();
      ctx.arc(x + pad + person.x * sx, y + 19 + person.y * sy, 5, 0, TAU);
      ctx.stroke();
    }
    const vehicle = this.sim.vehicle;
    ctx.save();
    ctx.translate(x + pad + vehicle.x * sx, y + 19 + vehicle.y * sy);
    ctx.rotate(vehicle.heading);
    ctx.fillStyle = "#ffd18d";
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3, -3);
    ctx.lineTo(-3, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (this.waypoint) {
      ctx.strokeStyle = "rgba(255, 190, 100, 0.7)";
      ctx.beginPath();
      ctx.arc(x + pad + this.waypoint.x * sx, y + 19 + this.waypoint.y * sy, 3, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(176, 224, 217, 0.15)";
    ctx.strokeRect(x + pad, y + 19, innerW, innerH);
    ctx.restore();
  }

  _drawScreenVignette(ctx) {
    const gradient = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.2,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.68
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(0.72, "rgba(0, 4, 6, 0.16)");
    gradient.addColorStop(1, "rgba(0, 4, 6, 0.7)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    const stress = this.sim.lastIce?.localStress || 0;
    if (stress > 76) {
      const danger = clamp((stress - 76) / 26, 0, 1);
      const edge = ctx.createRadialGradient(
        this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.28,
        this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.62
      );
      edge.addColorStop(0, "rgba(255, 64, 35, 0)");
      edge.addColorStop(1, `rgba(196, 44, 27, ${danger * 0.18})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }
}
