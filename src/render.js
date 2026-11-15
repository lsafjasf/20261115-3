const COLORS = {
  canvas: "#090d0d",
  ink: "#f2f0e8",
  acid: "#d8ff4f",
  mint: "#78e6b0",
  amber: "#ffb45f",
  grid: "#9fb2a8",
};

const MONO = "SFMono-Regular, Cascadia Mono, Consolas, monospace";

function snapDevicePixel(value, dpr) {
  return (Math.round(value * dpr) + 0.5) / dpr;
}

function drawBackground(ctx, width, height) {
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#0b1010");
  background.addColorStop(0.52, COLORS.canvas);
  background.addColorStop(1, "#080b0c");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const halo = ctx.createRadialGradient(
    width * 0.52,
    height * 0.49,
    0,
    width * 0.52,
    height * 0.49,
    Math.max(width, height) * 0.58,
  );
  halo.addColorStop(0, "rgba(92, 139, 111, 0.09)");
  halo.addColorStop(0.48, "rgba(40, 69, 59, 0.025)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx, width, height, dpr) {
  const step = 24;
  const majorEvery = 5;
  const pixel = 1 / dpr;

  ctx.save();
  ctx.lineWidth = pixel;

  for (let column = 0; column * step <= width; column += 1) {
    const isMajor = column % majorEvery === 0;
    const x = snapDevicePixel(column * step, dpr);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.strokeStyle = isMajor
      ? "rgba(155, 181, 167, 0.105)"
      : "rgba(155, 181, 167, 0.042)";
    ctx.stroke();
  }

  for (let row = 0; row * step <= height; row += 1) {
    const isMajor = row % majorEvery === 0;
    const y = snapDevicePixel(row * step, dpr);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle = isMajor
      ? "rgba(155, 181, 167, 0.105)"
      : "rgba(155, 181, 167, 0.042)";
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(196, 217, 205, 0.18)";
  for (let column = 0; column * step <= width; column += majorEvery) {
    for (let row = 0; row * step <= height; row += majorEvery) {
      const x = snapDevicePixel(column * step, dpr);
      const y = snapDevicePixel(row * step, dpr);
      ctx.fillRect(x - pixel, y - pixel, pixel * 2, pixel * 2);
    }
  }
  ctx.restore();
}

function drawEdgeRuler(ctx, width, height, dpr) {
  const interval = 120;
  const tick = 5;

  ctx.save();
  ctx.strokeStyle = "rgba(213, 232, 221, 0.17)";
  ctx.fillStyle = "rgba(213, 232, 221, 0.34)";
  ctx.lineWidth = 1 / dpr;
  ctx.font = `7px ${MONO}`;
  ctx.textBaseline = "top";

  for (let x = interval; x < width - 80; x += interval) {
    const snappedX = snapDevicePixel(x, dpr);
    ctx.beginPath();
    ctx.moveTo(snappedX, 0);
    ctx.lineTo(snappedX, tick);
    ctx.stroke();
    ctx.fillText(String(x), snappedX + 4, 8);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  for (let y = interval; y < height - 70; y += interval) {
    const snappedY = snapDevicePixel(y, dpr);
    ctx.beginPath();
    ctx.moveTo(0, snappedY);
    ctx.lineTo(tick, snappedY);
    ctx.stroke();
    ctx.fillText(String(y), width - 9, snappedY - 4);
  }
  ctx.restore();
}

function drawCalibrationField(ctx, width, height, dpr, now) {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height);
  const radii = [
    baseRadius * 0.09,
    baseRadius * 0.18,
    baseRadius * 0.3,
    baseRadius * 0.41,
  ];

  ctx.save();
  ctx.translate(centerX, centerY);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `400 ${Math.min(170, baseRadius * 0.25)}px Arial, sans-serif`;
  ctx.fillStyle = "rgba(230, 240, 233, 0.022)";
  ctx.fillText("1:1", 0, 4);

  radii.forEach((radius, index) => {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = index === 2
      ? "rgba(150, 177, 163, 0.18)"
      : "rgba(150, 177, 163, 0.105)";
    ctx.lineWidth = 1 / dpr;
    ctx.setLineDash(index === 1 ? [2 / dpr, 7 / dpr] : []);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const outer = radii[2];
  ctx.beginPath();
  ctx.arc(0, 0, outer, -Math.PI * 0.72, Math.PI * 0.22);
  ctx.strokeStyle = "rgba(216, 255, 79, 0.23)";
  ctx.lineWidth = 1.2 / dpr;
  ctx.stroke();

  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const isMajor = index % 6 === 0;
    const inner = outer - (isMajor ? 7 : 3);
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.strokeStyle = isMajor
      ? "rgba(216, 255, 79, 0.38)"
      : "rgba(176, 198, 186, 0.2)";
    ctx.lineWidth = 1 / dpr;
    ctx.stroke();
  }

  const sweepAngle = (now * 0.00016) % (Math.PI * 2);
  const sweep = ctx.createLinearGradient(0, 0, Math.cos(sweepAngle) * outer, Math.sin(sweepAngle) * outer);
  sweep.addColorStop(0, "rgba(120, 230, 176, 0)");
  sweep.addColorStop(1, "rgba(120, 230, 176, 0.28)");
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(sweepAngle) * outer, Math.sin(sweepAngle) * outer);
  ctx.strokeStyle = sweep;
  ctx.lineWidth = 1 / dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-17, 0);
  ctx.lineTo(-5, 0);
  ctx.moveTo(5, 0);
  ctx.lineTo(17, 0);
  ctx.moveTo(0, -17);
  ctx.lineTo(0, -5);
  ctx.moveTo(0, 5);
  ctx.lineTo(0, 17);
  ctx.strokeStyle = "rgba(232, 240, 235, 0.48)";
  ctx.lineWidth = 1 / dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(216, 255, 79, 0.82)";
  ctx.fill();

  ctx.font = `7px ${MONO}`;
  ctx.fillStyle = "rgba(164, 181, 171, 0.48)";
  ctx.fillText("CALIBRATION ORIGIN  ·  0, 0", 0, outer + 17);
  ctx.restore();
}

function drawPin(ctx, pin, viewport, now, dpr) {
  const x = pin.u * viewport.renderWidth;
  const y = pin.v * viewport.renderHeight;
  const age = Math.max(0, now - pin.createdAt);
  const pulseProgress = Math.min(1, age / 900);
  const pulseRadius = 13 + pulseProgress * 29;

  ctx.save();
  ctx.translate(x, y);

  if (pulseProgress < 1) {
    ctx.beginPath();
    ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 180, 95, ${(1 - pulseProgress) * 0.5})`;
    ctx.lineWidth = 1 / dpr;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 180, 95, 0.8)";
  ctx.lineWidth = 1.1 / dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(-14, 0);
  ctx.moveTo(14, 0);
  ctx.lineTo(22, 0);
  ctx.moveTo(0, -22);
  ctx.lineTo(0, -14);
  ctx.moveTo(0, 14);
  ctx.lineTo(0, 22);
  ctx.strokeStyle = "rgba(255, 180, 95, 0.92)";
  ctx.lineWidth = 1.2 / dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 2.3, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.amber;
  ctx.fill();

  ctx.font = `7px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255, 205, 147, 0.9)";
  ctx.fillText(String(pin.number).padStart(2, "0"), 0, -20);
  ctx.restore();
}

function drawPointerCrosshair(ctx, viewport, pointer, now) {
  const { renderWidth: width, renderHeight: height, dpr } = viewport;
  const x = pointer?.x ?? width / 2;
  const y = pointer?.y ?? height / 2;
  const active = Boolean(pointer);
  const pixel = 1 / dpr;

  ctx.save();
  ctx.setLineDash([3 * pixel, 7 * pixel]);
  ctx.strokeStyle = active
    ? "rgba(216, 255, 79, 0.17)"
    : "rgba(194, 210, 200, 0.08)";
  ctx.lineWidth = pixel;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(x, y, active ? 14 : 18, 0, Math.PI * 2);
  ctx.strokeStyle = active
    ? "rgba(216, 255, 79, 0.72)"
    : "rgba(194, 210, 200, 0.25)";
  ctx.lineWidth = 1.1 / dpr;
  ctx.stroke();

  const bracket = active ? 31 : 40;
  const arm = active ? 8 : 7;
  ctx.beginPath();
  ctx.moveTo(x - bracket, y - bracket + arm);
  ctx.lineTo(x - bracket, y - bracket);
  ctx.lineTo(x - bracket + arm, y - bracket);
  ctx.moveTo(x + bracket - arm, y - bracket);
  ctx.lineTo(x + bracket, y - bracket);
  ctx.lineTo(x + bracket, y - bracket + arm);
  ctx.moveTo(x + bracket, y + bracket - arm);
  ctx.lineTo(x + bracket, y + bracket);
  ctx.lineTo(x + bracket - arm, y + bracket);
  ctx.moveTo(x - bracket + arm, y + bracket);
  ctx.lineTo(x - bracket, y + bracket);
  ctx.lineTo(x - bracket, y + bracket - arm);
  ctx.strokeStyle = active
    ? "rgba(216, 255, 79, 0.75)"
    : "rgba(194, 210, 200, 0.2)";
  ctx.lineWidth = 1.2 / dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x + 7, y);
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x, y + 7);
  ctx.strokeStyle = active
    ? "rgba(216, 255, 79, 0.95)"
    : "rgba(194, 210, 200, 0.35)";
  ctx.lineWidth = 1.15 / dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, active ? 2.6 : 1.8, 0, Math.PI * 2);
  ctx.fillStyle = active ? COLORS.acid : "rgba(194, 210, 200, 0.45)";
  ctx.fill();

  if (active) {
    const pointerAge = now - pointer.updatedAt;
    if (pointerAge < 700) {
      const progress = pointerAge / 700;
      ctx.beginPath();
      ctx.arc(x, y, 14 + progress * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(216, 255, 79, ${(1 - progress) * 0.42})`;
      ctx.lineWidth = 1 / dpr;
      ctx.stroke();
    }
    drawPointerLabel(ctx, viewport, x, y);
  } else {
    ctx.font = `7px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(194, 210, 200, 0.42)";
    ctx.fillText("MOVE CURSOR TO CALIBRATE", x, y + 58);
  }

  ctx.restore();
}

function drawPointerLabel(ctx, viewport, x, y) {
  const width = 104;
  const height = 34;
  const margin = 20;
  const rightSide = x + margin + width < viewport.renderWidth - 8;
  const below = y - margin - height < 8;
  const left = rightSide ? x + margin : x - margin - width;
  const top = below ? y + margin : y - margin - height;

  ctx.save();
  ctx.fillStyle = "rgba(8, 12, 12, 0.9)";
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = "rgba(216, 255, 79, 0.34)";
  ctx.lineWidth = 1 / viewport.dpr;
  ctx.strokeRect(left, top, width, height);

  ctx.font = `7px ${MONO}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(151, 164, 157, 0.82)";
  ctx.fillText("X", left + 9, top + 11);
  ctx.fillText("Y", left + 9, top + 24);
  ctx.fillStyle = COLORS.acid;
  ctx.fillText(formatPointerValue(x), left + 25, top + 11);
  ctx.fillText(formatPointerValue(y), left + 25, top + 24);
  ctx.restore();
}

function formatPointerValue(value) {
  return `${value.toFixed(1)} px`;
}

export function renderCanvas(ctx, viewport, state, now) {
  const { renderWidth: width, renderHeight: height, dpr } = viewport;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewport.backingWidth, viewport.backingHeight);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawBackground(ctx, width, height);
  drawGrid(ctx, width, height, dpr);
  drawEdgeRuler(ctx, width, height, dpr);
  drawCalibrationField(ctx, width, height, dpr, now);

  for (const pin of state.pins) {
    drawPin(ctx, pin, viewport, now, dpr);
  }

  drawPointerCrosshair(ctx, viewport, state.pointer, now);
}
