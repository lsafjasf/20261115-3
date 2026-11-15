import {
  COLORS,
  WORLD,
  borders,
  cities,
  contours,
  forestClusters,
  forestTrees,
  lakes,
  lands,
  mountains,
  regionLabels,
  rivers,
  seaLabels,
  settlements,
  texturedTufts,
} from "./map-data.js";

const TAU = Math.PI * 2;

function tracePolygon(ctx, points, closed = true) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (closed) ctx.closePath();
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

function screenPolygon(ctx, points, view) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x * view.scale + view.panX;
    const y = point.y * view.scale + view.panY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function screenPolyline(ctx, points, view) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x * view.scale + view.panX;
    const y = point.y * view.scale + view.panY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function drawOcean(ctx, width, height, view) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#78a5aa");
  gradient.addColorStop(0.45, "#8bb4b7");
  gradient.addColorStop(1, "#6f9da3");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * 0.58,
    height * 0.48,
    20,
    width * 0.58,
    height * 0.48,
    Math.max(width, height) * 0.72,
  );
  glow.addColorStop(0, "rgba(218, 232, 222, 0.16)");
  glow.addColorStop(1, "rgba(33, 78, 81, 0.08)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "#e0ece6";
  ctx.lineWidth = 1;
  const step = Math.max(34, 58 * view.scale);
  const offsetX = ((view.panX % step) + step) % step;
  const offsetY = ((view.panY % step) + step) % step;
  for (let x = offsetX; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - height * 0.08, height);
    ctx.stroke();
  }
  for (let y = offsetY; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGraticule(ctx, view) {
  ctx.save();
  ctx.strokeStyle = "rgba(35, 80, 74, 0.13)";
  ctx.lineWidth = 0.75 / view.scale;
  ctx.setLineDash([2 / view.scale, 7 / view.scale]);
  for (let x = 200; x < WORLD.width; x += 240) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
    ctx.stroke();
  }
  for (let y = 180; y < WORLD.height; y += 220) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(28, 70, 65, 0.38)";
  ctx.font = `${7 / view.scale}px "Ubuntu Mono", monospace`;
  ctx.textAlign = "center";
  for (let x = 200; x < WORLD.width; x += 480) {
    ctx.fillText(`${18 + Math.round(x / 120)}°E`, x, WORLD.height - 24);
  }
  ctx.textAlign = "left";
  for (let y = 180; y < WORLD.height; y += 440) {
    ctx.fillText(`${46 - Math.round(y / 160)}°N`, 24, y - 8);
  }
  ctx.restore();
}

function drawLandUnderlay(ctx, view) {
  ctx.save();
  lands.forEach((land) => {
    tracePolygon(ctx, land.underlay);
    ctx.strokeStyle = "rgba(225, 238, 226, 0.36)";
    ctx.lineWidth = 18 / view.scale;
    ctx.stroke();
  });
  lands.forEach((land) => {
    tracePolygon(ctx, land.underlay);
    ctx.strokeStyle = "rgba(47, 94, 91, 0.17)";
    ctx.lineWidth = 1 / view.scale;
    ctx.stroke();
  });
  ctx.restore();
}

function drawLandFills(ctx, view) {
  const gradient = ctx.createLinearGradient(480, 490, 2360, 1500);
  gradient.addColorStop(0, "#e5dfcb");
  gradient.addColorStop(0.48, "#ddd6c0");
  gradient.addColorStop(1, "#d8cdb2");
  ctx.save();
  lands.forEach((land) => {
    tracePolygon(ctx, land.points);
    ctx.fillStyle = land.id === "mainland" ? gradient : land.fill;
    ctx.fill();
  });
  ctx.restore();

  ctx.save();
  lands.forEach((land) => {
    tracePolygon(ctx, land.points);
    ctx.clip();
    drawLandTexture(ctx, view);
  });
  ctx.restore();
}

function drawLandTexture(ctx, view) {
  ctx.save();
  ctx.fillStyle = "rgba(80, 103, 84, 0.12)";
  for (const tuft of texturedTufts) {
    const radius = 1.25 / view.scale;
    ctx.beginPath();
    ctx.arc(tuft.x, tuft.y, radius, 0, TAU);
    ctx.fill();
  }

  const wash = ctx.createRadialGradient(1920, 840, 50, 1920, 840, 570);
  wash.addColorStop(0, "rgba(150, 135, 96, 0.13)");
  wash.addColorStop(0.56, "rgba(185, 168, 125, 0.06)");
  wash.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(520, 480, 1900, 1020);

  ctx.restore();
}

function drawContours(ctx, view) {
  ctx.save();
  ctx.strokeStyle = "rgba(124, 117, 91, 0.27)";
  ctx.lineWidth = 0.72 / view.scale;
  for (const contour of contours) {
    tracePolygon(ctx, contour.points);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRiversAndLakes(ctx, view) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  rivers.forEach((river) => {
    tracePolygon(ctx, river.points, false);
    ctx.strokeStyle = "rgba(218, 232, 225, 0.55)";
    ctx.lineWidth = 4.4 / view.scale;
    ctx.stroke();
    tracePolygon(ctx, river.points, false);
    ctx.strokeStyle = COLORS.river;
    ctx.lineWidth = 1.5 / view.scale;
    ctx.stroke();
  });
  lakes.forEach((lake) => {
    tracePolygon(ctx, lake.points);
    ctx.fillStyle = "#8eb0b0";
    ctx.fill();
    ctx.strokeStyle = COLORS.river;
    ctx.lineWidth = 1.2 / view.scale;
    ctx.stroke();
  });
  ctx.restore();
}

function drawForests(ctx, view) {
  ctx.save();
  for (const cluster of forestClusters) {
    for (const tree of forestTrees(cluster)) {
      const x = tree.x;
      const y = tree.y;
      ctx.fillStyle = "rgba(92, 126, 94, 0.38)";
      ctx.beginPath();
      ctx.arc(x, y, tree.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(61, 102, 69, 0.4)";
      ctx.lineWidth = 0.7 / view.scale;
      ctx.beginPath();
      ctx.moveTo(x, y + tree.r * 0.85);
      ctx.lineTo(x, y - tree.r * 0.35);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMountains(ctx, view) {
  ctx.save();
  ctx.lineJoin = "round";
  for (const mountain of mountains) {
    const size = mountain.size;
    ctx.fillStyle = "rgba(107, 99, 77, 0.12)";
    ctx.strokeStyle = "rgba(76, 82, 66, 0.52)";
    ctx.lineWidth = 0.9 / view.scale;
    ctx.beginPath();
    ctx.moveTo(mountain.x - size, mountain.y + size * 0.48);
    ctx.lineTo(mountain.x - size * 0.24, mountain.y - size * 0.62);
    ctx.lineTo(mountain.x + size * 0.08, mountain.y - size * 0.15);
    ctx.lineTo(mountain.x + size * 0.34, mountain.y - size * 0.5);
    ctx.lineTo(mountain.x + size, mountain.y + size * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mountain.x - size * 0.24, mountain.y - size * 0.62);
    ctx.lineTo(mountain.x - size * 0.02, mountain.y - size * 0.03);
    ctx.lineTo(mountain.x + size * 0.08, mountain.y - size * 0.15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBorders(ctx, view) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const border of borders) {
    tracePolygon(ctx, border.points, false);
    ctx.strokeStyle = "rgba(245, 237, 218, 0.8)";
    ctx.lineWidth = 3.8 / view.scale;
    ctx.stroke();
    tracePolygon(ctx, border.points, false);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1.4 / view.scale;
    ctx.setLineDash([6 / view.scale, 4 / view.scale]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let index = 1; index < border.points.length; index += 2) {
      const point = border.points[index];
      ctx.fillStyle = "rgba(160, 78, 54, 0.9)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.9 / view.scale, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCoastlines(ctx, view) {
  ctx.save();
  lands.forEach((land) => {
    tracePolygon(ctx, land.points);
    ctx.strokeStyle = "rgba(250, 246, 233, 0.75)";
    ctx.lineWidth = 3.2 / view.scale;
    ctx.stroke();
    tracePolygon(ctx, land.points);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.25 / view.scale;
    ctx.stroke();
  });
  ctx.restore();
}

function drawMapLabels(ctx, view) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of seaLabels) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate((label.rotate * Math.PI) / 180);
    ctx.fillStyle = "rgba(239, 244, 232, 0.48)";
    ctx.font = `italic ${label.size}px "Noto Sans SC", sans-serif`;
    ctx.letterSpacing = `${label.size * 0.26}px`;
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }
  for (const label of regionLabels) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate((label.rotate * Math.PI) / 180);
    ctx.fillStyle = "rgba(68, 84, 70, 0.25)";
    ctx.font = '600 20px "Noto Sans SC", sans-serif';
    ctx.letterSpacing = "8px";
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawSettlements(ctx, view) {
  ctx.save();
  for (const settlement of settlements) {
    ctx.fillStyle = "rgba(55, 74, 63, 0.58)";
    ctx.beginPath();
    ctx.arc(settlement.x, settlement.y, settlement.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawCities(ctx, view, selectedId) {
  ctx.save();
  for (const city of cities) {
    const x = city.x * view.scale + view.panX;
    const y = city.y * view.scale + view.panY;
    const selected = city.id === selectedId;
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, 10.5, 0, TAU);
      ctx.fillStyle = "rgba(239, 230, 205, 0.38)";
      ctx.fill();
      ctx.strokeStyle = "rgba(102, 64, 48, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, city.rank === 1 ? 5 : 4.1, 0, TAU);
    ctx.fillStyle = "#f5f0df";
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, city.rank === 1 ? 2.3 : 1.8, 0, TAU);
    ctx.fillStyle = selected ? COLORS.coral : COLORS.ink;
    ctx.fill();
  }
  ctx.restore();
}

function nearestBoxPoint(box, anchor) {
  return {
    x: Math.max(box.x, Math.min(anchor.x, box.right)),
    y: Math.max(box.y, Math.min(anchor.y, box.bottom)),
  };
}

function drawLabelCards(ctx, layout, selectedId) {
  ctx.save();
  ctx.textBaseline = "middle";
  for (const label of layout.labels) {
    if (label.hidden) continue;
    const { box } = label;
    const selected = label.cityId === selectedId;
    const nearest = nearestBoxPoint(box, label.anchor);
    const anchorDistance = Math.hypot(nearest.x - label.anchor.x, nearest.y - label.anchor.y);
    if (anchorDistance > 8) {
      ctx.beginPath();
      ctx.moveTo(label.anchor.x, label.anchor.y);
      ctx.lineTo(nearest.x, nearest.y);
      ctx.strokeStyle = label.pinned ? "rgba(139, 74, 54, 0.68)" : "rgba(37, 73, 64, 0.5)";
      ctx.lineWidth = label.pinned ? 1 : 0.8;
      ctx.setLineDash(label.pinned ? [2, 2] : [3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.shadowColor = "rgba(22, 52, 43, 0.18)";
    ctx.shadowBlur = selected ? 10 : 5;
    ctx.shadowOffsetY = 2;
    roundedRect(ctx, box.x, box.y, box.width, box.height, 3.5);
    ctx.fillStyle = "rgba(250, 247, 237, 0.96)";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = selected
      ? "rgba(97, 125, 105, 0.95)"
      : label.pinned
        ? "rgba(183, 100, 75, 0.72)"
        : "rgba(93, 113, 99, 0.58)";
    ctx.lineWidth = selected ? 1.35 : 0.75;
    ctx.stroke();
    ctx.restore();

    if (label.pinned) {
      ctx.fillStyle = COLORS.coral;
      ctx.beginPath();
      ctx.arc(box.x + 9.5, box.cy, 2.8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 247, 231, 0.8)";
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(box.x + 9.5, box.cy, 3.9, 0, TAU);
      ctx.stroke();
    }

    ctx.font = `${selected ? 700 : 600} 13px "Noto Sans SC", sans-serif`;
    ctx.fillStyle = label.pinned ? "#6f382d" : COLORS.ink;
    ctx.textAlign = "center";
    ctx.fillText(label.name, box.cx + (label.pinned ? 4 : 0), box.cy + 0.3);
  }
  ctx.restore();
}

function drawCandidateLayer(ctx, layout, selectedId) {
  if (!layout.candidates.length) return;
  const selectedCity = layout.selectedCity;
  ctx.save();
  for (const candidate of layout.candidates) {
    const { box, valid, direction } = candidate;
    ctx.save();
    roundedRect(ctx, box.x, box.y, box.width, box.height, 3);
    ctx.fillStyle = valid ? "rgba(221, 238, 218, 0.26)" : "rgba(237, 193, 175, 0.24)";
    ctx.fill();
    ctx.strokeStyle = valid ? "rgba(58, 124, 83, 0.75)" : "rgba(166, 86, 65, 0.65)";
    ctx.lineWidth = 1;
    ctx.setLineDash(valid ? [4, 3] : [2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    const badgeX = box.x + 1;
    const badgeY = box.y - 8;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 7, 0, TAU);
    ctx.fillStyle = valid ? "#477a59" : "#a96049";
    ctx.fill();
    ctx.strokeStyle = "rgba(250, 246, 234, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#fffaf0";
    ctx.font = '700 6.5px "Ubuntu", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(direction.key, badgeX, badgeY + 0.4);
    ctx.restore();
  }

  if (selectedCity) {
    const anchor = layout.anchorById.get(selectedCity.id);
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 15.5, 0, TAU);
    ctx.strokeStyle = "rgba(250, 246, 233, 0.72)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function makeHatchPattern(ctx) {
  const documentRef = ctx.canvas.ownerDocument;
  const tile = documentRef.createElement("canvas");
  tile.width = 9;
  tile.height = 9;
  const tileCtx = tile.getContext("2d");
  tileCtx.clearRect(0, 0, 9, 9);
  tileCtx.strokeStyle = "rgba(157, 62, 45, 0.62)";
  tileCtx.lineWidth = 1;
  tileCtx.beginPath();
  tileCtx.moveTo(-2, 9);
  tileCtx.lineTo(9, -2);
  tileCtx.moveTo(4, 13);
  tileCtx.lineTo(13, 4);
  tileCtx.stroke();
  return ctx.createPattern(tile, "repeat");
}

function drawUnreadableOverlay(ctx, width, height, view) {
  const documentRef = ctx.canvas.ownerDocument;
  const ratio = ctx.canvas.width / width;
  const overlay = documentRef.createElement("canvas");
  overlay.width = Math.round(width * ratio);
  overlay.height = Math.round(height * ratio);
  const octx = overlay.getContext("2d");
  octx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const pattern = makeHatchPattern(octx);
  octx.save();
  octx.fillStyle = "rgba(177, 80, 59, 0.12)";
  octx.fillRect(0, 0, width, height);
  octx.fillStyle = pattern;
  octx.fillRect(0, 0, width, height);

  octx.globalCompositeOperation = "destination-out";
  for (const land of lands) {
    screenPolygon(octx, land.points, view);
    octx.fillStyle = "rgba(0, 0, 0, 0.94)";
    octx.fill();
  }

  octx.globalCompositeOperation = "source-over";
  octx.strokeStyle = "rgba(169, 75, 57, 0.2)";
  octx.lineWidth = 18;
  for (const land of lands) {
    screenPolygon(octx, land.points, view);
    octx.stroke();
  }
  octx.strokeStyle = "rgba(169, 75, 57, 0.17)";
  octx.lineWidth = 14;
  octx.lineCap = "round";
  for (const border of borders) {
    screenPolyline(octx, border.points, view);
    octx.stroke();
  }

  octx.fillStyle = "rgba(255, 246, 232, 0.95)";
  const text = "不可读区域 · 水体 / 海岸缓冲 / 边界缓冲";
  octx.font = '600 9px "Noto Sans SC", sans-serif';
  const textWidth = octx.measureText(text).width;
  const pillWidth = textWidth + 26;
  roundedRect(octx, width - pillWidth - 22, 71, pillWidth, 24, 3);
  octx.fill();
  octx.strokeStyle = "rgba(160, 79, 59, 0.52)";
  octx.lineWidth = 1;
  octx.stroke();
  octx.fillStyle = "#873f31";
  octx.beginPath();
  octx.arc(width - pillWidth - 9, 83, 3, 0, TAU);
  octx.fill();
  octx.textAlign = "left";
  octx.textBaseline = "middle";
  octx.fillText(text, width - pillWidth + 3, 83.5);
  octx.restore();
  ctx.drawImage(overlay, 0, 0, width, height);
}

function drawMapVignette(ctx, width, height) {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.3,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72,
  );
  gradient.addColorStop(0, "rgba(13, 41, 37, 0)");
  gradient.addColorStop(0.72, "rgba(13, 41, 37, 0.02)");
  gradient.addColorStop(1, "rgba(13, 41, 37, 0.16)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export function drawScene(ctx, {
  width,
  height,
  view,
  layout,
  selectedId,
  showCandidates = true,
  showUnreadable = false,
}) {
  ctx.clearRect(0, 0, width, height);
  drawOcean(ctx, width, height, view);

  ctx.save();
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.scale, view.scale);
  drawGraticule(ctx, view);
  drawLandUnderlay(ctx, view);
  drawLandFills(ctx, view);
  drawContours(ctx, view);
  drawForests(ctx, view);
  drawRiversAndLakes(ctx, view);
  drawMountains(ctx, view);
  drawBorders(ctx, view);
  drawCoastlines(ctx, view);
  drawMapLabels(ctx, view);
  drawSettlements(ctx, view);
  ctx.restore();

  drawMapVignette(ctx, width, height);

  if (showUnreadable) drawUnreadableOverlay(ctx, width, height, view);
  if (showCandidates) drawCandidateLayer(ctx, layout, selectedId);
  drawCities(ctx, view, selectedId);
  drawLabelCards(ctx, layout, selectedId);
}

