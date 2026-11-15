(function (global) {
  "use strict";

  const WORLD = { width: 1000, height: 560 };
  const EXIT_META = [
    { id: 1, code: "Y1", flight: "CA1831", city: "北京", color: "#f5c06b", x: 830, y: 38, h: 92 },
    { id: 2, code: "Y2", flight: "MU5102", city: "上海", color: "#75e3d5", x: 830, y: 158, h: 92 },
    { id: 3, code: "Y3", flight: "CZ3524", city: "广州", color: "#9db9ff", x: 830, y: 293, h: 92 },
    { id: 4, code: "Y4", flight: "3U8736", city: "成都", color: "#b9ed86", x: 830, y: 413, h: 92 }
  ];

  const ROUTES = {
    entry1: [[62, 92], [330, 92]],
    entry2: [[62, 236], [218, 236]],
    entry3: [[62, 446], [515, 446]],
    merge1: [[330, 92], [370, 108], [411, 134]],
    merge2a: [[218, 236], [276, 198], [350, 158], [411, 142]],
    merge2b: [[218, 236], [318, 284], [466, 315], [584, 339]],
    merge3: [[515, 446], [548, 396], [584, 354]],
    chute1: [[418, 130], [514, 92], [650, 73], [797, 76]],
    chute2: [[418, 143], [534, 176], [674, 205], [797, 204]],
    chute3: [[590, 337], [692, 313], [766, 299], [797, 300]],
    chute4: [[590, 348], [701, 398], [775, 437], [797, 441]]
  };

  const PICKERS = {
    1: { x: 258, y: 92, path: "entry1" },
    2: { x: 162, y: 236, path: "entry2" },
    3: { x: 420, y: 446, path: "entry3" }
  };

  const JAM_ANCHOR = { x: 478, y: 104, angle: -0.42 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const expanded = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
    const number = parseInt(expanded, 16);
    return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
  }

  function preparePath(points) {
    const segments = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      segments.push({ from, to, length, start: total });
      total += length;
    }
    return { points, segments, length: total };
  }

  const PATHS = Object.fromEntries(Object.entries(ROUTES).map(([key, points]) => [key, preparePath(points)]));

  function pointAt(path, progress) {
    const pathData = PATHS[path] || path;
    const target = clamp(progress, 0, 1) * pathData.length;
    const segment = pathData.segments.find((item) => target <= item.start + item.length) || pathData.segments[pathData.segments.length - 1];
    const local = clamp((target - segment.start) / Math.max(0.001, segment.length), 0, 1);
    return {
      x: segment.from[0] + (segment.to[0] - segment.from[0]) * local,
      y: segment.from[1] + (segment.to[1] - segment.from[1]) * local,
      angle: Math.atan2(segment.to[1] - segment.from[1], segment.to[0] - segment.from[0])
    };
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  class SystemRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
    }

    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.cssWidth = bounds.width;
      this.cssHeight = bounds.height;
      this.canvas.width = Math.round(bounds.width * dpr);
      this.canvas.height = Math.round(bounds.height * dpr);
      this.dpr = dpr;
    }

    applyWorldTransform() {
      const dpr = this.dpr || 1;
      const context = this.context;
      const scale = Math.min(this.cssWidth / WORLD.width, this.cssHeight / WORLD.height);
      this.scale = scale;
      this.offsetX = (this.cssWidth - WORLD.width * scale) / 2;
      this.offsetY = (this.cssHeight - WORLD.height * scale) / 2;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.translate(this.offsetX, this.offsetY);
      context.scale(scale, scale);
    }

    draw(snapshot, now, selectedJam) {
      if (!this.context) return;
      if (this.cssWidth !== this.canvas.getBoundingClientRect().width) this.resize();
      const context = this.context;
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.applyWorldTransform();

      this.drawBackground(context, now, snapshot);
      this.drawNetwork(context, snapshot, now);
      this.drawPickup(context, snapshot, now);
      this.drawBags(context, snapshot, now);
      this.drawDiverters(context, snapshot, now);
      this.drawExits(context, snapshot, now);
      this.drawJam(context, snapshot, now, selectedJam);
    }

    drawBackground(context, now, snapshot) {
      context.save();
      context.fillStyle = "rgba(5, 14, 20, 0.18)";
      context.fillRect(0, 0, WORLD.width, WORLD.height);

      context.strokeStyle = "rgba(107, 163, 170, 0.055)";
      context.lineWidth = 0.8;
      for (let x = 40; x < WORLD.width; x += 42) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, WORLD.height);
        context.stroke();
      }
      for (let y = 25; y < WORLD.height; y += 42) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(WORLD.width, y);
        context.stroke();
      }

      context.fillStyle = "rgba(120, 230, 215, 0.3)";
      context.font = "500 7px 'Roboto Mono', monospace";
      context.letterSpacing = "0.12em";
      context.fillText("T2 / SORTATION DECK", 24, 29);
      context.fillText("FLOW EAST →", 888, 535);
      context.strokeStyle = "rgba(120, 230, 215, 0.16)";
      context.beginPath();
      context.moveTo(24, 38);
      context.lineTo(152, 38);
      context.stroke();

      context.fillStyle = "rgba(137, 161, 168, 0.28)";
      context.font = "500 6px 'Roboto Mono', monospace";
      context.fillText("INFEED     MERGE", 62, 528);
      context.fillText("DIVERT", 504, 528);
      context.fillText("FLIGHT EXITS", 838, 528);
      context.setLineDash([2, 5]);
      context.strokeStyle = "rgba(137, 161, 168, 0.15)";
      context.beginPath();
      context.moveTo(355, 528);
      context.lineTo(780, 528);
      context.stroke();
      context.setLineDash([]);
      context.restore();
    }

    drawBelt(context, pathKey, color, now, multiplier, active) {
      const path = PATHS[pathKey];
      if (!path) return;
      const points = path.points;
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";

      context.strokeStyle = "rgba(0, 0, 0, 0.55)";
      context.lineWidth = 27;
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point[0], point[1] + 2) : context.moveTo(point[0], point[1] + 2));
      context.stroke();

      context.strokeStyle = active ? "rgba(43, 77, 85, 0.82)" : "rgba(34, 52, 58, 0.75)";
      context.lineWidth = 22;
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
      context.stroke();

      context.strokeStyle = active ? "rgba(97, 154, 157, 0.22)" : "rgba(72, 96, 99, 0.18)";
      context.lineWidth = 14;
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
      context.stroke();

      const dashOffset = -((now * 0.048 * multiplier) % 20);
      context.strokeStyle = hexToRgba(color, active ? 0.42 : 0.18);
      context.lineWidth = 1.2;
      context.setLineDash([7, 11]);
      context.lineDashOffset = dashOffset;
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
      context.stroke();
      context.setLineDash([]);

      context.strokeStyle = "rgba(185, 218, 217, 0.18)";
      context.lineWidth = 0.8;
      for (const side of [-10, 10]) {
        context.beginPath();
        points.forEach((point, index) => {
          const y = point[1] + side;
          index ? context.lineTo(point[0], y) : context.moveTo(point[0], y);
        });
        context.stroke();
      }
      context.restore();
    }

    drawNetwork(context, snapshot, now) {
      const speeds = snapshot.controls.speeds;
      this.drawBelt(context, "entry1", "#78e6d7", now, speeds[0], snapshot.running);
      this.drawBelt(context, "entry2", "#78e6d7", now, speeds[1], snapshot.running);
      this.drawBelt(context, "entry3", "#78e6d7", now, speeds[2], snapshot.running);
      this.drawBelt(context, "merge1", "#78e6d7", now, speeds[0], snapshot.running);
      this.drawBelt(context, "merge2a", "#78e6d7", now, speeds[1], snapshot.running);
      this.drawBelt(context, "merge2b", "#78e6d7", now, speeds[1], snapshot.running);
      this.drawBelt(context, "merge3", "#78e6d7", now, speeds[2], snapshot.running);
      this.drawBelt(context, "chute1", "#f5c06b", now, 1, snapshot.running);
      this.drawBelt(context, "chute2", "#75e3d5", now, 1, snapshot.running);
      this.drawBelt(context, "chute3", "#9db9ff", now, 1, snapshot.running);
      this.drawBelt(context, "chute4", "#b9ed86", now, 1, snapshot.running);

      this.drawInfeed(context, 1, 92, "B1", "A", "值机岛", speeds[0], snapshot);
      this.drawInfeed(context, 2, 236, "B2", "B", "转盘汇流", speeds[1], snapshot);
      this.drawInfeed(context, 3, 446, "B3", "C", "国际转机", speeds[2], snapshot);

      context.save();
      context.font = "500 6px 'Roboto Mono', monospace";
      context.fillStyle = "rgba(137, 161, 168, 0.5)";
      context.fillText("SHARED MERGE", 244, 211);
      context.fillText("Y1 / Y2", 642, 56);
      context.fillText("Y3 / Y4", 620, 391);
      context.restore();
    }

    drawInfeed(context, lane, y, id, letter, name, speed, snapshot) {
      context.save();
      context.fillStyle = "rgba(13, 28, 35, 0.96)";
      context.strokeStyle = "rgba(120, 230, 215, 0.26)";
      context.lineWidth = 1;
      roundedRect(context, 24, y - 17, 39, 34, 3);
      context.fill();
      context.stroke();
      context.strokeStyle = "rgba(120, 230, 215, 0.12)";
      context.beginPath();
      context.moveTo(24, y + 4);
      context.lineTo(13, y + 4);
      context.stroke();

      context.fillStyle = "#dce9e6";
      context.font = "600 8px 'Roboto Mono', monospace";
      context.textAlign = "center";
      context.fillText(id, 43, y - 3);
      context.fillStyle = "rgba(137, 161, 168, 0.7)";
      context.font = "500 6px 'Roboto Mono', monospace";
      context.fillText(letter, 43, y + 7);
      context.textAlign = "left";

      context.fillStyle = "rgba(5, 12, 16, 0.82)";
      context.fillRect(70, y + 14, 72, 16);
      context.fillStyle = "rgba(137, 161, 168, 0.65)";
      context.font = "400 6px 'Noto Sans SC Subset', sans-serif";
      context.fillText(`${name} · ${speed.toFixed(2)}×`, 75, y + 25);
      context.restore();
    }

    drawPickup(context, snapshot, now) {
      const picker = PICKERS[snapshot.picker.lane];
      if (!picker) return;
      const active = snapshot.running;
      const busy = snapshot.picker.busy;
      context.save();

      context.strokeStyle = hexToRgba(busy ? "#f5b766" : "#78e6d7", active ? 0.3 : 0.12);
      context.lineWidth = 1;
      context.setLineDash([2, 5]);
      context.beginPath();
      context.arc(picker.x, picker.y, busy ? 24 : 20, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);

      if (busy) {
        context.fillStyle = hexToRgba("#f5b766", 0.1);
        context.beginPath();
        context.arc(picker.x, picker.y, 17, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = hexToRgba("#f5b766", 0.55 + Math.sin(now / 120) * 0.2);
        context.beginPath();
        context.arc(picker.x, picker.y, 26 + Math.sin(now / 180) * 2, 0, Math.PI * 2);
        context.stroke();
      }

      const baseY = picker.y - 30;
      context.fillStyle = active ? "#d9e8e5" : "#72888d";
      context.strokeStyle = "rgba(5, 13, 17, 0.9)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(picker.x, baseY, 4.6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.strokeStyle = active ? "#78e6d7" : "#587074";
      context.lineWidth = 2.2;
      context.beginPath();
      context.moveTo(picker.x, baseY + 5);
      context.lineTo(picker.x, baseY + 15);
      context.moveTo(picker.x, baseY + 8);
      context.lineTo(picker.x - 7, baseY + 11);
      context.moveTo(picker.x, baseY + 8);
      context.lineTo(picker.x + 7, baseY + 12);
      context.moveTo(picker.x, baseY + 15);
      context.lineTo(picker.x - 5, baseY + 22);
      context.moveTo(picker.x, baseY + 15);
      context.lineTo(picker.x + 5, baseY + 22);
      context.stroke();

      context.fillStyle = "rgba(5, 12, 16, 0.9)";
      roundedRect(context, picker.x - 27, picker.y + 30, 54, 14, 2);
      context.fill();
      context.fillStyle = busy ? "#f5b766" : "rgba(137, 161, 168, 0.82)";
      context.font = "500 6px 'Roboto Mono', monospace";
      context.textAlign = "center";
      context.fillText(busy ? "REVIEWING" : `MANUAL B${snapshot.picker.lane}`, picker.x, picker.y + 39);
      context.textAlign = "left";
      context.restore();
    }

    bagPose(bag, index) {
      if (bag.stage === "entry" || bag.stage === "manual") {
        return pointAt(`entry${bag.lane}`, bag.progress);
      }
      if (bag.stage === "merge") {
        if (bag.lane === 1) return pointAt("merge1", bag.progress);
        if (bag.lane === 3) return pointAt("merge3", bag.progress);
        return pointAt(bag.group === 1 ? "merge2a" : "merge2b", bag.progress);
      }
      if (bag.stage === "diverter") {
        const anchor = bag.group === 1 ? { x: 408, y: 143 } : { x: 586, y: 355 };
        return {
          x: anchor.x - (index % 4) * 18,
          y: anchor.y + 13 + Math.floor(index / 4) * 10,
          angle: -0.15
        };
      }
      if (bag.stage === "chute") {
        return pointAt(`chute${bag.tagExit}`, bag.progress);
      }
      if (bag.stage === "jam") {
        return {
          x: JAM_ANCHOR.x - (index % 3) * 15 + Math.floor(index / 3) * 2,
          y: JAM_ANCHOR.y + 13 + Math.floor(index / 3) * 10,
          angle: JAM_ANCHOR.angle
        };
      }
      return null;
    }

    drawBag(context, bag, x, y, angle, now, options) {
      const opts = options || {};
      const width = 17 + bag.length * 7.5;
      const height = 8.5 + bag.length * 1.1;
      const exit = EXIT_META[bag.tagExit - 1];
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.shadowColor = "rgba(0, 0, 0, 0.5)";
      context.shadowBlur = 4;
      context.shadowOffsetY = 2;
      context.fillStyle = opts.jammed ? "#3d2220" : "#14252c";
      context.strokeStyle = opts.jammed ? "rgba(255, 108, 93, 0.7)" : "rgba(155, 190, 191, 0.32)";
      context.lineWidth = 0.9;
      roundedRect(context, -width / 2, -height / 2, width, height, 2);
      context.fill();
      context.stroke();
      context.shadowColor = "transparent";

      context.fillStyle = hexToRgba(exit.color, opts.jammed ? 0.78 : 0.9);
      roundedRect(context, -width / 2 + 2, -height / 2 + 2, 3.2, height - 4, 1);
      context.fill();

      context.strokeStyle = "rgba(231, 243, 240, 0.32)";
      context.lineWidth = 0.6;
      const stripeStart = -width / 2 + 8;
      for (let stripe = 0; stripe < 3; stripe += 1) {
        context.beginPath();
        context.moveTo(stripeStart + stripe * 3.3, -height / 2 + 2.5);
        context.lineTo(stripeStart + stripe * 3.3, height / 2 - 2.5);
        context.stroke();
      }
      context.fillStyle = "rgba(220, 237, 234, 0.34)";
      context.font = "500 3.7px 'Roboto Mono', monospace";
      context.fillText(`Y${bag.tagExit}`, width / 2 - 9, 1.3);

      if (bag.fixed) {
        context.fillStyle = "#78e6d7";
        context.beginPath();
        context.arc(width / 2 - 3, -height / 2 + 2, 2.2, 0, Math.PI * 2);
        context.fill();
      }
      if (opts.jammed) {
        context.strokeStyle = hexToRgba("#ff6c5d", 0.55 + Math.sin(now / 130) * 0.25);
        context.lineWidth = 1.2;
        roundedRect(context, -width / 2 - 2, -height / 2 - 2, width + 4, height + 4, 3);
        context.stroke();
      }
      context.restore();
    }
    drawBags(context, snapshot, now) {
      const indexByGroup = {};
      snapshot.bags.forEach((bag) => {
        if (!["active", "manual", "jam"].includes(bag.status)) return;
        indexByGroup[bag.group] = (indexByGroup[bag.group] || 0) + 1;
        const pose = this.bagPose(bag, indexByGroup[bag.group] - 1);
        if (!pose) return;
        this.drawBag(context, bag, pose.x, pose.y, pose.angle, now, { jammed: bag.status === "jam" });
      });
    }

    drawDiverters(context, snapshot, now) {
      const data = [
        { id: 1, x: 411, y: 137, label: "D1", priority: snapshot.controls.priorities[0], jam: snapshot.jam.active },
        { id: 2, x: 584, y: 346, label: "D2", priority: snapshot.controls.priorities[1], jam: false }
      ];
      for (const diverter of data) {
        context.save();
        context.translate(diverter.x, diverter.y);
        context.rotate(Math.PI / 4);
        context.fillStyle = "rgba(8, 21, 27, 0.96)";
        context.strokeStyle = diverter.jam ? "rgba(255, 108, 93, 0.75)" : "rgba(245, 183, 102, 0.48)";
        context.lineWidth = 1;
        roundedRect(context, -13, -13, 26, 26, 2);
        context.fill();
        context.stroke();
        if (diverter.jam) {
          context.strokeStyle = hexToRgba("#ff6c5d", 0.35 + Math.sin(now / 140) * 0.2);
          context.lineWidth = 3;
          context.stroke();
        }
        context.restore();

        context.save();
        context.textAlign = "center";
        context.fillStyle = diverter.jam ? "#ff9a8f" : "#f5c06b";
        context.font = "600 8px 'Roboto Mono', monospace";
        context.fillText(diverter.label, diverter.x, diverter.y + 3);
        context.fillStyle = "rgba(137, 161, 168, 0.65)";
        context.font = "500 5.5px 'Roboto Mono', monospace";
        context.fillText(`${diverter.priority} / ${100 - diverter.priority}`, diverter.x, diverter.y - 24);
        context.textAlign = "left";
        context.restore();
      }
    }

    drawExits(context, snapshot, now) {
      for (const meta of EXIT_META) {
        const exit = snapshot.exits[meta.id - 1];
        const capacity = exit.capacity;
        const ratio = clamp(exit.queueLength / capacity, 0, 1);
        const danger = exit.queueLength >= capacity;
        context.save();

        context.fillStyle = "rgba(8, 20, 26, 0.88)";
        context.strokeStyle = danger ? "rgba(255, 108, 93, 0.85)" : "rgba(148, 189, 195, 0.17)";
        context.lineWidth = 1;
        roundedRect(context, meta.x, meta.y, 145, meta.h, 3);
        context.fill();
        context.stroke();

        context.fillStyle = hexToRgba(meta.color, 0.09);
        roundedRect(context, meta.x + 1, meta.y + 1, 143, 25, 2);
        context.fill();
        context.fillStyle = meta.color;
        context.fillRect(meta.x, meta.y + 1, 2, 25);

        context.fillStyle = meta.color;
        context.font = "600 11px 'Roboto Mono', monospace";
        context.fillText(meta.code, meta.x + 11, meta.y + 16);
        context.fillStyle = "rgba(221, 236, 233, 0.86)";
        context.font = "500 7px 'Roboto Mono', monospace";
        context.fillText(meta.flight, meta.x + 34, meta.y + 15);
        context.fillStyle = "rgba(137, 161, 168, 0.68)";
        context.font = "400 6px 'Noto Sans SC Subset', sans-serif";
        context.textAlign = "right";
        context.fillText(meta.city, meta.x + 133, meta.y + 15);
        context.textAlign = "left";

        context.fillStyle = "rgba(137, 161, 168, 0.48)";
        context.font = "500 5px 'Roboto Mono', monospace";
        context.fillText("EXIT BUFFER", meta.x + 11, meta.y + 37);

        const slotGap = 2;
        const slotWidth = (123 - slotGap * (capacity - 1)) / capacity;
        for (let slot = 0; slot < capacity; slot += 1) {
          const bag = exit.bags[slot];
          const slotX = meta.x + 10 + slot * (slotWidth + slotGap);
          const slotY = meta.y + 43;
          context.fillStyle = bag ? (bag.wrong ? "rgba(255, 108, 93, 0.14)" : "rgba(120, 230, 215, 0.09)") : "rgba(255, 255, 255, 0.018)";
          context.strokeStyle = bag ? hexToRgba(meta.color, 0.42) : "rgba(148, 189, 195, 0.1)";
          context.lineWidth = 0.6;
          roundedRect(context, slotX, slotY, slotWidth, 12, 1.5);
          context.fill();
          context.stroke();
          if (bag) {
            context.fillStyle = bag.wrong ? "rgba(255, 108, 93, 0.75)" : hexToRgba(meta.color, 0.7);
            context.fillRect(slotX + 2, slotY + 2, 2, 8);
            context.fillStyle = "rgba(220, 237, 234, 0.18)";
            context.fillRect(slotX + 5, slotY + 4, Math.max(3, slotWidth - 7), 1);
            context.fillRect(slotX + 5, slotY + 7, Math.max(2, slotWidth - 9), 1);
          }
        }

        context.fillStyle = "rgba(148, 189, 195, 0.09)";
        context.fillRect(meta.x + 10, meta.y + meta.h - 12, 123, 2);
        context.fillStyle = danger ? "#ff6c5d" : meta.color;
        context.fillRect(meta.x + 10, meta.y + meta.h - 12, 123 * ratio, 2);
        context.fillStyle = danger ? "#ff8e83" : "rgba(137, 161, 168, 0.56)";
        context.font = "500 5px 'Roboto Mono', monospace";
        context.fillText(`${exit.queueLength}/${capacity} QUEUED`, meta.x + 10, meta.y + meta.h - 17);
        context.textAlign = "right";
        context.fillText(`${exit.drained} OUT`, meta.x + 133, meta.y + meta.h - 17);
        context.textAlign = "left";

        if (danger) {
          context.strokeStyle = hexToRgba("#ff6c5d", 0.38 + Math.sin(now / 150) * 0.2);
          context.lineWidth = 4;
          roundedRect(context, meta.x - 3, meta.y - 3, 151, meta.h + 6, 4);
          context.stroke();
        }
        context.restore();
      }
    }

    drawJam(context, snapshot, now, selected) {
      if (!snapshot.jam.occurred) return;
      const isRecovering = snapshot.recovery.active;
      const active = snapshot.jam.active || snapshot.jam.clearing;
      const cleared = snapshot.recovery.completed && !active;
      const color = active ? "#ff6c5d" : "#f5b766";
      context.save();
      context.translate(JAM_ANCHOR.x, JAM_ANCHOR.y);

      if (cleared) {
        context.fillStyle = "rgba(245, 183, 102, 0.1)";
        context.strokeStyle = "rgba(245, 183, 102, 0.7)";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(0, 0, 9, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.strokeStyle = "#f5c06b";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(-4, 0);
        context.lineTo(-1, 3.5);
        context.lineTo(5, -4);
        context.stroke();
        context.fillStyle = "rgba(245, 192, 107, 0.8)";
        context.font = "500 5.5px 'Roboto Mono', monospace";
        context.textAlign = "center";
        context.fillText("Y1 CLEARED", 0, -17);
        context.restore();
        return;
      }

      if (active) {
        const pulse = 15 + Math.sin(now / 140) * 3;
        context.fillStyle = hexToRgba("#ff6c5d", 0.08);
        context.beginPath();
        context.arc(0, 0, pulse + 8, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = hexToRgba("#ff6c5d", 0.3);
        context.lineWidth = 1;
        context.setLineDash([2, 4]);
        context.beginPath();
        context.arc(0, 0, pulse, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
      }

      context.fillStyle = "rgba(29, 15, 15, 0.96)";
      context.strokeStyle = color;
      context.lineWidth = selected ? 2 : 1.2;
      context.beginPath();
      context.moveTo(0, -12);
      context.lineTo(11, 7);
      context.lineTo(-11, 7);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = color;
      context.font = "700 9px 'Roboto Mono', monospace";
      context.textAlign = "center";
      context.fillText("!", 0, 4);

      context.fillStyle = "rgba(11, 20, 24, 0.94)";
      roundedRect(context, -54, -40, 108, 20, 2);
      context.fill();
      context.strokeStyle = "rgba(255, 108, 93, 0.24)";
      context.lineWidth = 0.7;
      context.stroke();
      context.fillStyle = active ? "#ff9e93" : "#f5c06b";
      context.font = "500 5.7px 'Roboto Mono', monospace";
      context.fillText(isRecovering ? `RECOVERING ${Math.round(snapshot.recovery.ratio * 100)}%` : `D1 / Y1 SLOT JAM · ${snapshot.jam.queueLength}`, 0, -27);
      context.restore();
    }

    hitJam(clientX, clientY, snapshot) {
      if (!snapshot.jam.occurred) return false;
      const bounds = this.canvas.getBoundingClientRect();
      const x = (clientX - bounds.left - this.offsetX) / this.scale;
      const y = (clientY - bounds.top - this.offsetY) / this.scale;
      return Math.hypot(x - JAM_ANCHOR.x, y - JAM_ANCHOR.y) <= 38;
    }

  }

  global.BaggageRenderer = { SystemRenderer, EXIT_META, JAM_ANCHOR, pointAt, PATHS };
})(typeof window !== "undefined" ? window : globalThis);
