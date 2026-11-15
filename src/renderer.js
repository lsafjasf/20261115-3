import {
  FIELD,
  ROUTES,
  SCENARIO,
  TFR,
  WEATHER,
  pointAt,
  SPEEDS
} from "./scenario.js";

const TAU = Math.PI * 2;

export class AirspaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(
      this.width / SCENARIO.world.width,
      this.height / SCENARIO.world.height
    );
    this.offsetX = (this.width - SCENARIO.world.width * this.scale) / 2;
    this.offsetY = (this.height - SCENARIO.world.height * this.scale) / 2;
  }

  draw(state, visuals = {}) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    this.drawGrid();
    this.drawCorridors();
    this.drawWeather(state);
    this.drawAirport(state);
    this.drawTfr(state);
    this.drawHolds(state);
    this.drawTrails(state);
    this.drawSeparationLinks(state);
    this.drawAircraft(state);
    ctx.restore();
    this.drawFrameCorners(visuals);
  }

  drawBackdrop() {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(
      this.width * 0.65,
      this.height * 0.35,
      10,
      this.width * 0.65,
      this.height * 0.35,
      this.width * 0.72
    );
    gradient.addColorStop(0, "#0b2025");
    gradient.addColorStop(0.55, "#061419");
    gradient.addColorStop(1, "#040c10");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const glow = ctx.createLinearGradient(0, 0, this.width, 0);
    glow.addColorStop(0, "rgba(245,201,94,0.025)");
    glow.addColorStop(0.45, "rgba(117,213,197,0.015)");
    glow.addColorStop(1, "rgba(156,174,247,0.03)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawGrid() {
    const ctx = this.ctx;
    const { width, height } = SCENARIO.world;
    ctx.save();
    ctx.strokeStyle = "rgba(139,176,175,0.055)";
    ctx.lineWidth = 1 / this.scale;
    for (let x = 0; x <= width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(139,176,175,0.095)";
    for (let x = 0; x <= width; x += 200) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 200) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(132,165,164,0.22)";
    ctx.font = "7px ui-monospace, monospace";
    for (let x = 200; x < width; x += 200) {
      for (let y = 200; y < height; y += 200) {
        ctx.fillText(`${String(x).padStart(3, "0")}/${String(y).padStart(3, "0")}`, x + 4, y - 4);
      }
    }
    ctx.restore();
  }

  drawCorridors() {
    const ctx = this.ctx;
    for (const route of Object.values(ROUTES)) {
      const isAlpha = route.id === "alpha";
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = isAlpha
        ? "rgba(245,201,94,0.09)"
        : "rgba(156,174,247,0.08)";
      ctx.lineWidth = 22;
      this.tracePath(route.points, 0, route.fafPoint ? route.fafDist : route.total);
      ctx.stroke();

      ctx.strokeStyle = isAlpha
        ? "rgba(245,201,94,0.38)"
        : "rgba(156,174,247,0.34)";
      ctx.lineWidth = 1.15;
      ctx.setLineDash([7, 8]);
      this.tracePath(route.points, 0, route.landDist);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isAlpha ? "#d8b261" : "#8e9dd4";
      ctx.font = "600 8px ui-monospace, monospace";
      ctx.letterSpacing = "1px";
      const labelPoint = route.points[1];
      ctx.fillText(`${route.label} / INBOUND`, labelPoint.x + 12, labelPoint.y - 16);
      ctx.fillStyle = "rgba(132,150,154,0.5)";
      ctx.font = "7px ui-monospace, monospace";
      ctx.fillText(isAlpha ? "WEST GATE · 090°" : "SOUTH GATE · 355°", labelPoint.x + 12, labelPoint.y - 5);

      const faf = route.points[isAlpha ? 7 : 8];
      ctx.strokeStyle = isAlpha
        ? "rgba(245,201,94,0.55)"
        : "rgba(156,174,247,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(faf.x - 4, faf.y - 4, 8, 8);
      ctx.fillStyle = "rgba(132,150,154,0.58)";
      ctx.fillText("FAF", faf.x + 8, faf.y + 3);
      ctx.restore();
    }
  }

  tracePath(points, minDistance, maxDistance) {
    const ctx = this.ctx;
    ctx.beginPath();
    let drawing = false;
    let accumulated = 0;
    for (let i = 0; i < points.length; i += 1) {
      if (i > 0) {
        accumulated += Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y
        );
      }
      if (accumulated < minDistance) continue;
      if (accumulated > maxDistance) {
        const point = pointAt({ points, lengths: this.lengthsFor(points), total: accumulated }, maxDistance);
        ctx.lineTo(point.x, point.y);
        break;
      }
      if (!drawing) {
        ctx.moveTo(points[i].x, points[i].y);
        drawing = true;
      } else {
        ctx.lineTo(points[i].x, points[i].y);
      }
    }
  }

  lengthsFor(points) {
    let total = 0;
    return points.map((point, index) => {
      if (index > 0) {
        total += Math.hypot(
          point.x - points[index - 1].x,
          point.y - points[index - 1].y
        );
      }
      return total;
    });
  }

  drawAirport(state) {
    const ctx = this.ctx;
    const { x, y, terminalRadius, runway } = FIELD;
    ctx.save();

    ctx.strokeStyle = "rgba(117,213,197,0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.arc(x, y, terminalRadius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(117,213,197,0.03)";
    ctx.beginPath();
    ctx.arc(x, y, terminalRadius, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(117,213,197,0.42)";
    ctx.lineWidth = 9;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(runway.x1, runway.y1);
    ctx.lineTo(runway.x2, runway.y2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(5,14,17,0.85)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = "rgba(237,242,239,0.7)";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([7, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(237,242,239,0.75)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText("09", 1008, 342);
    ctx.fillText("27", 918, 370);

    ctx.fillStyle = "rgba(139,176,175,0.16)";
    ctx.fillRect(942, 258, 92, 30);
    ctx.fillRect(924, 398, 118, 22);
    ctx.strokeStyle = "rgba(139,176,175,0.32)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(942, 258, 92, 30);
    ctx.strokeRect(924, 398, 118, 22);
    ctx.fillStyle = "rgba(117,213,197,0.55)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText("CARGO TERMINAL", 950, 276);
    ctx.fillText("GROUND OPS", 956, 412);

    const pulse = 0.5 + Math.sin(state.time * 0.9) * 0.15;
    ctx.strokeStyle = `rgba(117,213,197,${pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(117,213,197,0.7)";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(132,150,154,0.48)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText("TCA / RWY 09", 886, 205);
    ctx.restore();
  }

  drawWeather(state) {
    const ctx = this.ctx;
    const active = state.weatherActive;
    const drift = Math.sin(state.time * 0.045) * 9;
    const center = { x: WEATHER.center.x + drift, y: WEATHER.center.y };
    ctx.save();

    if (active) {
      const band = ctx.createLinearGradient(270, 0, 700, 0);
      band.addColorStop(0, "rgba(245,201,94,0)");
      band.addColorStop(0.25, "rgba(245,201,94,0.055)");
      band.addColorStop(0.7, "rgba(245,201,94,0.08)");
      band.addColorStop(1, "rgba(245,201,94,0)");
      ctx.fillStyle = band;
      ctx.fillRect(250, 28, 470, 220);
      ctx.strokeStyle = "rgba(245,201,94,0.42)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.moveTo(310, 80);
      ctx.bezierCurveTo(410, 44, 540, 70, 660, 140);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(245,201,94,0.76)";
      ctx.font = "600 8px ui-monospace, monospace";
      ctx.fillText("CB-04 / CORRIDOR ALPHA CLOSED", 338, 54);
    }

    const clouds = [
      { x: -105, y: 10, r: 86, a: 0.11 },
      { x: -40, y: -18, r: 108, a: 0.14 },
      { x: 48, y: 5, r: 93, a: 0.12 },
      { x: 112, y: 28, r: 72, a: 0.1 },
      { x: 20, y: 54, r: 126, a: 0.08 }
    ];
    for (const cloud of clouds) {
      const gradient = ctx.createRadialGradient(
        center.x + cloud.x,
        center.y + cloud.y,
        2,
        center.x + cloud.x,
        center.y + cloud.y,
        cloud.r
      );
      const alpha = active ? cloud.a * 2.1 : cloud.a;
      gradient.addColorStop(0, `rgba(207,215,203,${alpha})`);
      gradient.addColorStop(0.55, `rgba(150,169,164,${alpha * 0.55})`);
      gradient.addColorStop(1, "rgba(100,122,122,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(
        center.x + cloud.x,
        center.y + cloud.y,
        cloud.r * 1.45,
        cloud.r * 0.72,
        -0.12,
        0,
        TAU
      );
      ctx.fill();
    }

    if (active) {
      const t = state.time * 1.7;
      ctx.strokeStyle = `rgba(245,201,94,${0.32 + Math.sin(t) * 0.16})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center.x + 30, center.y + 6, 52 + Math.sin(t * 0.7) * 5, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTfr(state) {
    const ctx = this.ctx;
    const active = state.tfrActive;
    const { center, radius } = TFR;
    const pulse = active ? 1 + Math.sin(state.time * 2.4) * 0.018 : 1;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(pulse, pulse);

    if (active) {
      const fill = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
      fill.addColorStop(0, "rgba(255,118,95,0.13)");
      fill.addColorStop(0.68, "rgba(255,118,95,0.055)");
      fill.addColorStop(1, "rgba(255,118,95,0)");
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,118,95,0.16)";
      ctx.lineWidth = 1;
      for (let i = -radius * 2; i < radius * 2; i += 11) {
        ctx.beginPath();
        ctx.moveTo(i, -radius);
        ctx.lineTo(i + radius * 2, radius);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.strokeStyle = active
      ? "rgba(255,118,95,0.76)"
      : "rgba(255,118,95,0.18)";
    ctx.lineWidth = active ? 1.2 : 0.7;
    ctx.setLineDash(active ? [8, 5] : [3, 6]);
    ctx.lineDashOffset = active ? -state.time * 5 : 0;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = active ? "rgba(255,118,95,0.92)" : "rgba(255,118,95,0.32)";
    ctx.font = "600 7px ui-monospace, monospace";
    ctx.fillText(active ? "TFR-12 / ACTIVE" : "TFR-12 / CLEAR", -42, 4);
    ctx.font = "6px ui-monospace, monospace";
    ctx.fillStyle = "rgba(255,176,159,0.58)";
    ctx.fillText("GROUND CONVOY", -36, 14);

    this.drawGroundConvoy(state.time, active);
    ctx.restore();
  }

  drawGroundConvoy(time, active) {
    const ctx = this.ctx;
    const travel = ((time * 8) % 55) - 24;
    for (let i = 0; i < 3; i += 1) {
      const x = -18 + travel + i * 16;
      ctx.fillStyle = active ? "rgba(255,153,132,0.9)" : "rgba(132,150,154,0.38)";
      ctx.fillRect(x, 22, 9, 5);
      ctx.fillStyle = "rgba(6,15,18,0.85)";
      ctx.fillRect(x + 2, 24, 3, 2);
      ctx.fillStyle = active ? "rgba(255,118,95,0.42)" : "rgba(132,150,154,0.18)";
      ctx.fillRect(x - 1, 22, 11, 1);
    }
  }

  drawHolds(state) {
    const ctx = this.ctx;
    for (const flight of state.flights) {
      const hold = flight.route.holdPoint;
      const radius = flight.config.radius;
      const isHolding = flight.mode === "holding";
      const isReleased = flight.mode === "approach" || flight.mode === "landed";
      ctx.save();
      ctx.translate(hold.x, hold.y);
      ctx.strokeStyle = isHolding
        ? `${flight.color}bb`
        : isReleased
          ? `${flight.color}35`
          : `${flight.color}70`;
      ctx.lineWidth = isHolding ? 1.4 : 0.8;
      ctx.setLineDash(isHolding ? [5, 4] : [2, 4]);
      ctx.lineDashOffset = isHolding ? -state.time * 9 : 0;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = `${flight.color}${isHolding ? "dd" : "88"}`;
      ctx.beginPath();
      ctx.arc(0, 0, 1.7, 0, TAU);
      ctx.fill();
      ctx.font = "6px ui-monospace, monospace";
      ctx.fillStyle = isHolding
        ? `${flight.color}cc`
        : "rgba(132,150,154,0.4)";
      ctx.fillText(
        `${flight.route.label} HOLD / ${flight.config.radius}`,
        -radius,
        radius + 12
      );
      ctx.restore();
    }
  }

  drawTrails(state) {
    const ctx = this.ctx;
    for (const flight of state.flights) {
      const trail = flight.trail;
      if (!trail || trail.length < 2) continue;
      ctx.save();
      ctx.lineWidth = flight.mode === "landed" ? 1.1 : 1.45;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i += 1) {
        const alpha = 0.05 + (i / trail.length) * 0.35;
        ctx.strokeStyle = this.withAlpha(flight.color, alpha);
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      const position = this.visualPosition(flight, state.time);
      ctx.strokeStyle = this.withAlpha(flight.color, 0.38);
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(trail.at(-1).x, trail.at(-1).y);
      ctx.lineTo(position.x, position.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSeparationLinks(state) {
    const ctx = this.ctx;
    const active = state.flights.filter(
      (flight) => flight.mode === "inbound" || flight.mode === "approach"
    );
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const first = active[i];
        const second = active[j];
        const firstPoint = this.visualPosition(first, state.time);
        const secondPoint = this.visualPosition(second, state.time);
        const distance = Math.hypot(
          firstPoint.x - secondPoint.x,
          firstPoint.y - secondPoint.y
        );
        const limit =
          62 + (first.config.radius + second.config.radius) * 0.22;
        if (distance > limit * 1.5) continue;
        const danger = distance < limit;
        ctx.save();
        ctx.strokeStyle = danger
          ? "rgba(255,118,95,0.9)"
          : "rgba(117,213,197,0.38)";
        ctx.lineWidth = danger ? 1.3 : 0.8;
        ctx.setLineDash(danger ? [3, 3] : [2, 5]);
        ctx.beginPath();
        ctx.moveTo(firstPoint.x, firstPoint.y);
        ctx.lineTo(secondPoint.x, secondPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const midX = (firstPoint.x + secondPoint.x) / 2;
        const midY = (firstPoint.y + secondPoint.y) / 2;
        ctx.fillStyle = danger ? "#ff765f" : "#75d5c5";
        ctx.font = "600 6px ui-monospace, monospace";
        ctx.fillText(danger ? `SEP ${distance.toFixed(0)} / VIOLATION` : `SEP ${distance.toFixed(0)}`, midX - 28, midY - 5);
        ctx.restore();
      }
    }
  }

  visualPosition(flight, time) {
    if (flight.mode === "holding") {
      const radius = flight.config.radius;
      const speed = SPEEDS[flight.config.speed].value;
      const phase = (time - (flight.holdStartedAt || 0)) * (speed / radius);
      return {
        x: flight.route.holdPoint.x + Math.cos(phase) * radius,
        y: flight.route.holdPoint.y + Math.sin(phase) * radius,
        heading: phase + Math.PI / 2
      };
    }
    return flight.position;
  }

  drawAircraft(state) {
    const ctx = this.ctx;
    const landed = state.flights.filter((flight) => flight.mode === "landed");
    for (const flight of state.flights) {
      const point = this.visualPosition(flight, state.time);
      const isStaged = flight.mode === "staged";
      const isLost = flight.mode === "lost";
      const landedIndex = landed.findIndex((item) => item.id === flight.id);
      const renderPoint =
        flight.mode === "landed"
          ? {
              x: FIELD.runway.x2 - 38 - landedIndex * 22,
              y: FIELD.runway.y1
            }
          : point;

      ctx.save();
      ctx.translate(renderPoint.x, renderPoint.y);
      if (flight.mode === "landed") {
        this.drawLandedMarker(flight, landedIndex);
        ctx.restore();
        continue;
      }
      if (isLost) {
        ctx.strokeStyle = "rgba(255,118,95,0.9)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(5, 5);
        ctx.moveTo(5, -5);
        ctx.lineTo(-5, 5);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.rotate(point.heading || 0);
      ctx.globalAlpha = isStaged ? 0.55 : 1;
      ctx.shadowColor = flight.color;
      ctx.shadowBlur = flight.mode === "holding" ? 10 : 7;
      ctx.fillStyle = flight.color;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(1, -3.2);
      ctx.lineTo(-5, -6.5);
      ctx.lineTo(-3.3, -1.5);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-3.3, 1.5);
      ctx.lineTo(-5, 6.5);
      ctx.lineTo(1, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(6,18,21,0.78)";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.fillStyle = "rgba(237,242,239,0.82)";
      ctx.beginPath();
      ctx.arc(1.2, 0, 1.1, 0, TAU);
      ctx.fill();
      ctx.restore();

      this.drawAircraftLabel(
        flight,
        renderPoint,
        isStaged,
        state.time
      );
    }
  }

  drawLandedMarker(flight, index) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(6,15,18,0.8)";
    ctx.strokeStyle = this.withAlpha(flight.color, 0.7);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = this.withAlpha(flight.color, 0.95);
    ctx.beginPath();
    ctx.moveTo(-2.4, 0);
    ctx.lineTo(-0.5, 2);
    ctx.lineTo(2.7, -2);
    ctx.stroke();
    ctx.fillStyle = this.withAlpha(flight.color, 0.68);
    ctx.font = "5.5px ui-monospace, monospace";
    ctx.fillText(`${index + 1} · ${flight.id}`, -10, 13);
  }

  drawAircraftLabel(flight, point, isStaged, time) {
    const ctx = this.ctx;
    const labelX = point.x + 12;
    const labelY = point.y - 20;
    const pulse = 0.65 + Math.sin(time * 2 + Number(flight.id.slice(1))) * 0.12;
    ctx.save();
    ctx.translate(labelX, labelY);
    ctx.fillStyle = "rgba(5,15,18,0.82)";
    ctx.strokeStyle = this.withAlpha(flight.color, 0.28);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.roundRect(0, 0, 76, 27, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.withAlpha(flight.color, pulse);
    ctx.fillRect(0, 0, 2, 27);

    ctx.font = "600 7px ui-monospace, monospace";
    ctx.fillStyle = flight.color;
    ctx.fillText(`${flight.id}  ${flight.name}`, 7, 9);
    ctx.font = "5.5px ui-monospace, monospace";
    ctx.fillStyle = "rgba(190,202,199,0.66)";
    ctx.fillText(
      `${flight.route.label} · P${flight.config.priority} · ${Math.round(flight.fuel)}%`,
      7,
      18
    );
    ctx.fillStyle = this.withAlpha(flight.color, 0.52);
    ctx.fillText(
      isStaged
        ? "STAGED"
        : flight.mode === "holding"
          ? "HOLD"
          : flight.mode === "landed"
            ? "LANDED"
            : `INBOUND ${flight.config.radius}`,
      7,
      24
    );
    ctx.restore();
  }

  drawFrameCorners() {
    const ctx = this.ctx;
    const size = 11;
    const inset = 13;
    ctx.save();
    ctx.strokeStyle = "rgba(151,188,184,0.25)";
    ctx.lineWidth = 1;
    const corners = [
      [inset, inset, 1, 1],
      [this.width - inset, inset, -1, 1],
      [inset, this.height - inset, 1, -1],
      [this.width - inset, this.height - inset, -1, -1]
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * size, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * size);
      ctx.stroke();
    }
    ctx.restore();
  }

  withAlpha(hex, alpha) {
    const value = hex.replace("#", "");
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red},${green},${blue},${Math.max(0, Math.min(alpha, 1))})`;
  }
}
