import { getOpening, getWallSegments } from "./acoustics.js";

const COLORS = {
  text: "#eef3ee",
  muted: "#8a9991",
  dim: "#5d6b63",
  lime: "#c8f174",
  cyan: "#69ded5",
  coral: "#ff8968",
  violet: "#a7a1ff",
  grid: "rgba(220, 238, 226, 0.055)",
  gridStrong: "rgba(220, 238, 226, 0.1)",
};

function canvasSize(canvas) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
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

export function layoutRoom(canvas, params) {
  const { ctx, width, height } = canvasSize(canvas);
  const padding = width < 520 ? 35 : 46;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 1.6;
  const scale = Math.min(availableWidth / params.width, availableHeight / params.depth);
  const roomWidth = params.width * scale;
  const roomHeight = params.depth * scale;
  const origin = {
    x: (width - roomWidth) / 2,
    y: (height - roomHeight) / 2 + 4,
  };
  return {
    ctx,
    width,
    height,
    scale,
    origin,
    roomWidth,
    roomHeight,
    toScreen: (x, y) => ({ x: origin.x + x * scale, y: origin.y + y * scale }),
    toRoom: (x, y) => ({
      x: (x - origin.x) / scale,
      y: (y - origin.y) / scale,
    }),
  };
}

function drawGrid(view, params) {
  const { ctx, origin, scale } = view;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLORS.grid;
  const step = params.width > 7 || params.depth > 6 ? 1 : 0.5;
  for (let x = step; x < params.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(origin.x + x * scale, origin.y);
    ctx.lineTo(origin.x + x * scale, origin.y + params.depth * scale);
    ctx.stroke();
  }
  for (let y = step; y < params.depth; y += step) {
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y + y * scale);
    ctx.lineTo(origin.x + params.width * scale, origin.y + y * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function screenPoints(view, points) {
  return points.map((point) => view.toScreen(point.x, point.y));
}

function drawPath(view, points, color, width, alpha) {
  const screen = screenPoints(view, points);
  const { ctx } = view;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  for (let index = 1; index < screen.length; index += 1) {
    ctx.lineTo(screen[index].x, screen[index].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawReflectionDots(view, points, color) {
  const { ctx } = view;
  const screen = screenPoints(view, points.slice(1, -1));
  ctx.save();
  for (const point of screen) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWalls(view, params) {
  const { ctx, origin, scale } = view;
  const wallWidth = 4.3;
  ctx.save();
  ctx.strokeStyle = "rgba(205, 226, 212, 0.38)";
  ctx.lineWidth = wallWidth;
  ctx.lineCap = "square";

  for (const wallId of ["north", "east", "south", "west"]) {
    for (const segment of getWallSegments(params, wallId)) {
      ctx.beginPath();
      if (wallId === "north" || wallId === "south") {
        const y = wallId === "north" ? 0 : params.depth;
        ctx.moveTo(origin.x + segment.start * scale, origin.y + y * scale);
        ctx.lineTo(origin.x + segment.end * scale, origin.y + y * scale);
      } else {
        const x = wallId === "west" ? 0 : params.width;
        ctx.moveTo(origin.x + x * scale, origin.y + segment.start * scale);
        ctx.lineTo(origin.x + x * scale, origin.y + segment.end * scale);
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  const opening = getOpening(params);
  drawOpening(view, params, opening);
  drawWallLabels(view, params);
}

function drawWallLabels(view, params) {
  const { ctx } = view;
  const labels = [
    { primary: "N", secondary: "北", x: params.width / 2, y: 0, dx: 0, dy: -16 },
    { primary: "S", secondary: "南", x: params.width / 2, y: params.depth, dx: 0, dy: 26 },
    { primary: "W", secondary: "西", x: 0, y: params.depth / 2, dx: -18, dy: 4 },
    { primary: "E", secondary: "东", x: params.width, y: params.depth / 2, dx: 18, dy: 4 },
  ];
  ctx.save();
  ctx.font = "8px 'SFMono-Regular', 'Room Sans', monospace";
  ctx.textAlign = "center";
  for (const label of labels) {
    const screen = view.toScreen(label.x, label.y);
    ctx.fillStyle = "rgba(151, 167, 157, 0.75)";
    ctx.fillText(label.primary, screen.x + label.dx, screen.y + label.dy);
    ctx.fillStyle = "rgba(104, 119, 110, 0.8)";
    ctx.fillText(label.secondary, screen.x + label.dx, screen.y + label.dy + 11);
  }
  ctx.restore();
}

function drawOpening(view, params, opening) {
  const { ctx, origin, scale } = view;
  const wall = params.openingWall;
  const horizontal = wall === "north" || wall === "south";
  const wallCoordinate = horizontal
    ? wall === "north" ? 0 : params.depth
    : wall === "west" ? 0 : params.width;
  const start =
    horizontal
      ? view.toScreen(opening.start, wallCoordinate)
      : view.toScreen(wallCoordinate, opening.start);
  const end =
    horizontal
      ? view.toScreen(opening.end, wallCoordinate)
      : view.toScreen(wallCoordinate, opening.end);

  ctx.save();
  if (params.openingEnabled) {
    ctx.strokeStyle = COLORS.lime;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = COLORS.lime;
    ctx.lineWidth = 1;
    const outward = horizontal
      ? wall === "north" ? -1 : 1
      : wall === "west" ? -1 : 1;
    const outwardPointA = { x: start.x, y: start.y };
    const outwardPointB = { x: end.x, y: end.y };
    if (horizontal) {
      outwardPointA.y += outward * 11;
      outwardPointB.y += outward * 11;
    } else {
      outwardPointA.x += outward * 11;
      outwardPointB.x += outward * 11;
    }
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(outwardPointA.x, outwardPointA.y);
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(outwardPointB.x, outwardPointB.y);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(200, 241, 116, 0.33)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  ctx.setLineDash([]);
  ctx.fillStyle = params.openingEnabled ? COLORS.lime : "rgba(200, 241, 116, 0.55)";
  ctx.font = "7px 'SFMono-Regular', 'Room Sans', monospace";
  ctx.textAlign = "center";
  const offset = horizontal
    ? wall === "north" ? -20 : 25
    : wall === "west" ? -15 : 15;
  ctx.fillText(
    params.openingEnabled ? "OPEN" : "SEALED",
    midpoint.x + (horizontal ? 0 : offset),
    midpoint.y + (horizontal ? offset : 0),
  );
  ctx.restore();
}

function drawDirectPath(view, params) {
  const source = view.toScreen(params.sourceX, params.sourceY);
  const listener = view.toScreen(params.listenerX, params.listenerY);
  const { ctx } = view;
  ctx.save();
  ctx.strokeStyle = COLORS.lime;
  ctx.lineWidth = 1.25;
  ctx.globalAlpha = 0.65;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  ctx.lineTo(listener.x, listener.y);
  ctx.stroke();
  ctx.restore();
}

function drawReflectionPaths(view, paths) {
  const firstOrder = paths.filter((path) => path.order === 1);
  const secondOrder = paths.filter((path) => path.order === 2);
  for (const path of secondOrder) {
    drawPath(view, path.points, COLORS.coral, 0.8, 0.24);
    drawReflectionDots(view, path.points, COLORS.coral);
  }
  for (const path of firstOrder) {
    drawPath(view, path.points, COLORS.cyan, 1.25, 0.68);
    drawReflectionDots(view, path.points, COLORS.cyan);
  }
}

function drawSource(view, params, hovered) {
  const { ctx } = view;
  const point = view.toScreen(params.sourceX, params.sourceY);
  const radius = hovered ? 10.5 : 9;
  ctx.save();
  ctx.strokeStyle = COLORS.coral;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (const ring of [17, 25]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = "rgba(255, 137, 104, 0.45)";
  ctx.shadowBlur = hovered ? 18 : 11;
  ctx.fillStyle = COLORS.coral;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#25100b";
  ctx.font = "700 9px 'SFMono-Regular', 'Room Sans', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", point.x, point.y + 0.4);
  drawMarkerLabel(ctx, point, "声源", COLORS.coral, -1);
  ctx.restore();
}

function drawListener(view, params, hovered) {
  const { ctx } = view;
  const point = view.toScreen(params.listenerX, params.listenerY);
  const radians = (params.headAngle * Math.PI) / 180;
  const direction = { x: Math.sin(radians), y: -Math.cos(radians) };
  const angle = Math.atan2(direction.y, direction.x);
  const radius = hovered ? 10.5 : 9;

  ctx.save();
  ctx.fillStyle = "rgba(200, 241, 116, 0.1)";
  ctx.strokeStyle = "rgba(200, 241, 116, 0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.arc(point.x, point.y, 31, angle - 0.33, angle + 0.33);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = COLORS.lime;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(point.x + direction.x * 12, point.y + direction.y * 12);
  ctx.lineTo(point.x + direction.x * 27, point.y + direction.y * 27);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.shadowColor = "rgba(200, 241, 116, 0.38)";
  ctx.shadowBlur = hovered ? 18 : 11;
  ctx.fillStyle = COLORS.lime;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#18200e";
  ctx.font = "700 9px 'SFMono-Regular', 'Room Sans', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("L", point.x, point.y + 0.4);
  drawMarkerLabel(ctx, point, "听者", COLORS.lime, 1);
  ctx.restore();
}

function drawMarkerLabel(ctx, point, label, color, direction) {
  const width = label.length * 9 + 13;
  const x = point.x + 16;
  const y = point.y + (direction < 0 ? -24 : 12);
  ctx.globalAlpha = 0.94;
  roundedRect(ctx, x, y, width, 17, 5);
  ctx.fillStyle = "rgba(13, 18, 16, 0.86)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "8px 'Avenir Next', 'Room Sans', 'PingFang SC', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 6, y + 9);
}

function drawScale(view, params) {
  const { ctx } = view;
  const barMeters = params.width >= 7 ? 2 : 1;
  const bar = barMeters * view.scale;
  const x = view.origin.x + 4;
  const y = view.origin.y + params.depth * view.scale + 21;
  ctx.save();
  ctx.strokeStyle = "rgba(171, 188, 178, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y);
  ctx.lineTo(x + bar, y);
  ctx.lineTo(x + bar, y - 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(171, 188, 178, 0.58)";
  ctx.font = "7px 'SFMono-Regular', monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${barMeters} m`, x + bar + 6, y + 1);
  ctx.restore();
}

export function drawRoomScene(canvas, options = {}) {
  const params = options.params;
  const paths = options.paths || [];
  const hovered = options.hovered;
  const view = layoutRoom(canvas, params);
  const { ctx, origin, roomWidth, roomHeight, width, height } = view;
  ctx.clearRect(0, 0, width, height);

  const background = ctx.createRadialGradient(
    origin.x + roomWidth * 0.5,
    origin.y + roomHeight * 0.45,
    10,
    origin.x + roomWidth * 0.5,
    origin.y + roomHeight * 0.45,
    Math.max(roomWidth, roomHeight) * 0.7,
  );
  background.addColorStop(0, "rgba(54, 83, 68, 0.18)");
  background.addColorStop(1, "rgba(8, 12, 10, 0)");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.44)";
  ctx.shadowBlur = 25;
  ctx.shadowOffsetY = 10;
  roundedRect(ctx, origin.x, origin.y, roomWidth, roomHeight, 3);
  ctx.fillStyle = "rgba(22, 31, 27, 0.72)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, origin.x, origin.y, roomWidth, roomHeight, 3);
  ctx.clip();
  drawGrid(view, params);
  drawDirectPath(view, params);
  drawReflectionPaths(view, paths);
  ctx.restore();

  drawWalls(view, params);
  drawScale(view, params);
  drawSource(view, params, hovered === "source");
  drawListener(view, params, hovered === "listener");
  return view;
}

function drawPanelGrid(ctx, width, height, columns = 4, rows = 2) {
  ctx.save();
  ctx.strokeStyle = "rgba(212, 231, 218, 0.045)";
  ctx.lineWidth = 1;
  for (let index = 1; index < columns; index += 1) {
    const x = (width / columns) * index;
    ctx.beginPath();
    ctx.moveTo(x, 5);
    ctx.lineTo(x, height - 5);
    ctx.stroke();
  }
  for (let index = 1; index < rows; index += 1) {
    const y = (height / rows) * index;
    ctx.beginPath();
    ctx.moveTo(5, y);
    ctx.lineTo(width - 5, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPlaceholder(canvas, message = "正在生成脉冲响应…") {
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  drawPanelGrid(ctx, width, height);
  ctx.save();
  ctx.fillStyle = "rgba(200, 241, 116, 0.32)";
  ctx.font = "8px 'SFMono-Regular', monospace";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2 + 3);
  ctx.restore();
}

function channelEnvelope(samples, start, end, pixelCount) {
  const positive = new Float32Array(pixelCount);
  const negative = new Float32Array(pixelCount);
  const range = Math.max(1, end - start);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sampleStart = start + Math.floor((pixel / pixelCount) * range);
    const sampleEnd = start + Math.floor(((pixel + 1) / pixelCount) * range);
    let maximum = 0;
    let minimum = 0;
    for (let index = sampleStart; index < sampleEnd; index += 1) {
      const sample = samples[index] || 0;
      if (sample > maximum) maximum = sample;
      if (sample < minimum) minimum = sample;
    }
    positive[pixel] = maximum;
    negative[pixel] = minimum;
  }
  return { positive, negative };
}

function drawEnvelopeLane(ctx, samples, bounds, color, maximum, startFraction, endFraction) {
  const { x, y, width, height } = bounds;
  const sampleStart = Math.floor(startFraction * samples.length);
  const sampleEnd = Math.min(samples.length, Math.floor(endFraction * samples.length));
  const envelope = channelEnvelope(samples, sampleStart, sampleEnd, Math.max(2, Math.floor(width)));
  const center = y + height / 2;
  const scale = height / 2 / Math.max(maximum, 1e-9);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, center);
  for (let pixel = 0; pixel < envelope.positive.length; pixel += 1) {
    ctx.lineTo(x + pixel, center - envelope.positive[pixel] * scale);
  }
  for (let pixel = envelope.negative.length - 1; pixel >= 0; pixel -= 1) {
    ctx.lineTo(x + pixel, center - envelope.negative[pixel] * scale);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.16;
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.globalAlpha = 0.23;
  ctx.beginPath();
  ctx.moveTo(x, center);
  ctx.lineTo(x + width, center);
  ctx.stroke();
  ctx.restore();
}

export function drawImpulseResponse(canvas, result) {
  if (!result) {
    drawPlaceholder(canvas);
    return;
  }
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  drawPanelGrid(ctx, width, height, 4, 2);
  const plot = { x: 11, y: 7, width: width - 22, height: height - 29 };
  const maximum = Math.max(
    1e-9,
    ...result.left.map(Math.abs).filter((_, index) => index % 37 === 0),
    ...result.right.map(Math.abs).filter((_, index) => index % 37 === 0),
  );
  const earlyX = plot.x + (plot.width * Math.min(1, 0.08 / result.duration));

  ctx.save();
  ctx.fillStyle = "rgba(200, 241, 116, 0.035)";
  ctx.fillRect(plot.x, plot.y, earlyX - plot.x, plot.height);
  ctx.strokeStyle = "rgba(200, 241, 116, 0.24)";
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(earlyX, plot.y);
  ctx.lineTo(earlyX, plot.y + plot.height);
  ctx.stroke();
  ctx.restore();

  const laneHeight = (plot.height - 5) / 2;
  drawEnvelopeLane(
    ctx,
    result.left,
    { x: plot.x, y: plot.y + 1, width: plot.width, height: laneHeight },
    COLORS.cyan,
    maximum,
    0,
    1,
  );
  drawEnvelopeLane(
    ctx,
    result.right,
    { x: plot.x, y: plot.y + laneHeight + 4, width: plot.width, height: laneHeight },
    COLORS.coral,
    maximum,
    0,
    1,
  );

  ctx.save();
  for (const event of result.events.filter((item) => item.order > 0 && item.order < 3)) {
    const x = plot.x + (event.time / result.duration) * plot.width;
    ctx.strokeStyle = event.order === 1 ? "rgba(105, 222, 213, 0.2)" : "rgba(255, 137, 104, 0.16)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(238, 243, 238, 0.44)";
  ctx.font = "7px 'SFMono-Regular', monospace";
  ctx.textAlign = "left";
  ctx.fillText("L", plot.x + 4, plot.y + 11);
  ctx.fillStyle = "rgba(255, 137, 104, 0.55)";
  ctx.fillText("R", plot.x + 4, plot.y + laneHeight + 16);
  ctx.restore();
}

function differenceChannel(left, right) {
  const output = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = left[index] - right[index];
  }
  return output;
}

export function drawBinaural(canvas, wet) {
  if (!wet || !wet.left || !wet.right) {
    drawPlaceholder(canvas, "等待双耳卷积输出…");
    return;
  }
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  drawPanelGrid(ctx, width, height, 5, 3);
  const plot = { x: 11, y: 8, width: width - 22, height: height - 18 };
  const difference = differenceChannel(wet.left, wet.right);
  const viewDuration = Math.min(0.34, wet.duration);
  const viewFraction = Math.min(1, viewDuration / wet.duration);
  const maximum = Math.max(
    1e-9,
    ...wet.left.slice(0, Math.floor(wet.left.length * viewFraction)).map(Math.abs).filter((_, index) => index % 13 === 0),
    ...wet.right.slice(0, Math.floor(wet.right.length * viewFraction)).map(Math.abs).filter((_, index) => index % 13 === 0),
    ...difference.slice(0, Math.floor(difference.length * viewFraction)).map(Math.abs).filter((_, index) => index % 13 === 0),
  );
  const laneHeight = (plot.height - 4) / 3;
  const lanes = [
    { label: "L", samples: wet.left, color: COLORS.cyan },
    { label: "R", samples: wet.right, color: COLORS.coral },
    { label: "Δ", samples: difference, color: COLORS.lime },
  ];
  lanes.forEach((lane, index) => {
    drawEnvelopeLane(
      ctx,
      lane.samples,
      {
        x: plot.x + 13,
        y: plot.y + index * (laneHeight + 2),
        width: plot.width - 13,
        height: laneHeight,
      },
      lane.color,
      maximum,
      0,
      viewFraction,
    );
    ctx.save();
    ctx.fillStyle = lane.color;
    ctx.globalAlpha = 0.62;
    ctx.font = "7px 'SFMono-Regular', monospace";
    ctx.textAlign = "left";
    ctx.fillText(lane.label, plot.x, plot.y + index * (laneHeight + 2) + laneHeight / 2 + 2.5);
    ctx.restore();
  });
  ctx.save();
  ctx.fillStyle = "rgba(130, 146, 137, 0.45)";
  ctx.font = "7px 'SFMono-Regular', monospace";
  ctx.textAlign = "left";
  ctx.fillText("0", plot.x + 13, height - 4);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(viewDuration * 1000)} ms`, width - 11, height - 4);
  ctx.restore();
}

export function drawMiniResponse(canvas, result, color, sharedMaximum = 0, sharedDuration = 1) {
  const { ctx, width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  if (!result) {
    drawPlaceholder(canvas, "重算中");
    return;
  }
  drawPanelGrid(ctx, width, height, 4, 1);
  const plot = { x: 5, y: 6, width: width - 10, height: height - 12 };
  const maximum = Math.max(sharedMaximum, 1e-9);
  const paddedLength = Math.max(
    result.left.length,
    Math.ceil(sharedDuration * result.sampleRate),
  );
  const paddedLeft = new Float32Array(paddedLength);
  paddedLeft.set(result.left);
  drawEnvelopeLane(
    ctx,
    paddedLeft,
    { x: plot.x + 11, y: plot.y, width: plot.width - 11, height: plot.height },
    color,
    maximum,
    0,
    1,
  );
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.font = "7px 'SFMono-Regular', monospace";
  ctx.fillText("IR", plot.x, plot.y + 9);
  ctx.restore();
}
