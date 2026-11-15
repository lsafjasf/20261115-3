import {
  AIRFIELD,
  BLOCKS,
  CREEKS,
  DISTRICT_LABELS,
  DISTRICTS,
  LANDMARKS,
  MAJOR_ROADS,
  MAP_COLORS,
  MINOR_ROADS,
  PARKS,
  PIERS,
  RESERVOIRS,
  STREET_LABELS,
  TRANSIT_LINES,
  TRANSIT_STOPS,
  WATER,
  WATER_LABELS,
} from "./map-data.js";

const FONT_SANS = '"Ubuntu", "Segoe UI", "Helvetica Neue", sans-serif';
const FONT_MONO = '"DejaVu Sans Mono", "SFMono-Regular", monospace';

function polygonPath(points, close = true) {
  const path = new Path2D();
  points.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  if (close) path.closePath();
  return path;
}

function smoothPath(points, close = false) {
  const path = new Path2D();
  if (points.length < 2) return path;
  const first = points[0];
  const last = points[points.length - 1];
  if (close) {
    const start = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
    path.moveTo(start[0], start[1]);
  } else {
    path.moveTo(first[0], first[1]);
  }
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const mid = [(previous[0] + current[0]) / 2, (previous[1] + current[1]) / 2];
    path.quadraticCurveTo(previous[0], previous[1], mid[0], mid[1]);
  }
  if (close) {
    const end = [(last[0] + first[0]) / 2, (last[1] + first[1]) / 2];
    path.quadraticCurveTo(last[0], last[1], end[0], end[1]);
    path.closePath();
  } else {
    path.lineTo(last[0], last[1]);
  }
  return path;
}

const MINOR_ROADS_PATH = MINOR_ROADS.reduce((path, points) => {
  const line = polygonPath(points, false);
  path.addPath(line);
  return path;
}, new Path2D());

const creekPath = smoothPath(CREEKS[0].points);

function drawMatrix(ctx, cx, cy, angle) {
  ctx.translate(cx, cy);
  ctx.rotate(angle);
}

function drawDistricts(ctx) {
  DISTRICTS.forEach((district) => {
    ctx.fillStyle = district.fill;
    ctx.fill(polygonPath(district.points));
  });
}

function drawParks(ctx, zoom) {
  PARKS.forEach((park) => {
    const path = smoothPath(park.points, true);
    ctx.fillStyle = MAP_COLORS.park;
    ctx.fill(path);
    ctx.strokeStyle = "rgba(94, 123, 87, 0.45)";
    ctx.lineWidth = 1.1 / zoom;
    ctx.stroke(path);
  });

  ctx.fillStyle = "rgba(83, 112, 77, 0.34)";
  for (let index = 0; index < 54; index += 1) {
    const angle = index * 2.399;
    const radius = 8 + ((index * 13) % 31);
    const park = PARKS[index % PARKS.length];
    const centerX = park.points.reduce((sum, point) => sum + point[0], 0) / park.points.length;
    const centerY = park.points.reduce((sum, point) => sum + point[1], 0) / park.points.length;
    ctx.beginPath();
    ctx.arc(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius * 0.65, 1.15 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlocks(ctx, zoom) {
  BLOCKS.forEach((block) => {
    const path = polygonPath(block.points);
    ctx.fillStyle = MAP_COLORS.block;
    ctx.fill(path);
    ctx.strokeStyle = MAP_COLORS.blockStroke;
    ctx.lineWidth = 0.75 / zoom;
    ctx.stroke(path);
  });
}

function drawWater(ctx, zoom) {
  WATER.forEach((water) => {
    const path = smoothPath(water.points, true);
    ctx.fillStyle = MAP_COLORS.water;
    ctx.fill(path);
    ctx.strokeStyle = MAP_COLORS.waterLine;
    ctx.lineWidth = 1.4 / zoom;
    ctx.stroke(path);
  });

  RESERVOIRS.forEach((reservoir) => {
    const path = smoothPath(reservoir.points, true);
    ctx.fillStyle = MAP_COLORS.waterDeep;
    ctx.fill(path);
    ctx.strokeStyle = MAP_COLORS.waterLine;
    ctx.lineWidth = 1 / zoom;
    ctx.stroke(path);
  });

  ctx.strokeStyle = MAP_COLORS.waterDeep;
  ctx.lineWidth = CREEKS[0].width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(creekPath);
  ctx.strokeStyle = MAP_COLORS.water;
  ctx.lineWidth = CREEKS[0].width - 2.5;
  ctx.stroke(creekPath);

  PIERS.forEach((pier) => {
    ctx.save();
    drawMatrix(ctx, pier.x, pier.y, pier.angle);
    ctx.fillStyle = "#e4d9c4";
    ctx.strokeStyle = "#c8bda7";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.rect(0, -pier.h / 2, pier.w, pier.h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

function drawAirfield(ctx, zoom) {
  ctx.save();
  drawMatrix(ctx, AIRFIELD.x, AIRFIELD.y, AIRFIELD.angle);
  ctx.fillStyle = "#d5cbb8";
  ctx.strokeStyle = "#b8ad99";
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.roundRect(-AIRFIELD.length / 2, -AIRFIELD.width / 2, AIRFIELD.length, AIRFIELD.width, 3);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#f9f4e9";
  ctx.setLineDash([8, 5]);
  ctx.lineWidth = 1.6 / zoom;
  ctx.beginPath();
  ctx.moveTo(-AIRFIELD.length / 2 + 5, 0);
  ctx.lineTo(AIRFIELD.length / 2 - 5, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawRoads(ctx, zoom) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = MAP_COLORS.roadCasing;
  ctx.lineWidth = 4.5 / zoom;
  ctx.stroke(MINOR_ROADS_PATH);
  ctx.strokeStyle = MAP_COLORS.road;
  ctx.lineWidth = 2.6 / zoom;
  ctx.stroke(MINOR_ROADS_PATH);

  MAJOR_ROADS.forEach((road) => {
    const path = smoothPath(road.points);
    ctx.strokeStyle = "rgba(84, 92, 81, 0.2)";
    ctx.lineWidth = (road.weight + 4.2) / zoom;
    ctx.stroke(path);
    ctx.strokeStyle = MAP_COLORS.roadCasing;
    ctx.lineWidth = (road.weight + 2.7) / zoom;
    ctx.stroke(path);
    ctx.strokeStyle = MAP_COLORS.roadMajor;
    ctx.lineWidth = road.weight / zoom;
    ctx.stroke(path);
  });
}

function drawTransit(ctx, zoom) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  TRANSIT_LINES.forEach((line) => {
    const path = smoothPath(line.points);
    ctx.strokeStyle = "rgba(252, 249, 240, 0.93)";
    ctx.lineWidth = 5.6 / zoom;
    ctx.stroke(path);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2.1 / zoom;
    ctx.stroke(path);
  });

  TRANSIT_STOPS.forEach((stop) => {
    ctx.beginPath();
    ctx.arc(stop.x, stop.y, 3.2 / zoom, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf8ef";
    ctx.fill();
    ctx.strokeStyle = "#4e5c54";
    ctx.lineWidth = 1.2 / zoom;
    ctx.stroke();
    if (stop.lines.length > 1) {
      ctx.beginPath();
      ctx.arc(stop.x, stop.y, 1.35 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = "#4e5c54";
      ctx.fill();
    }
  });
}

function drawTrackedText(ctx, text, { x, y, angle, size, color, tracking, weight = 600, family = FONT_SANS, zoom }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle || 0);
  ctx.font = `${weight} ${size / zoom}px ${family}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  const characters = [...text];
  const widths = characters.map((character) => ctx.measureText(character).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + (characters.length - 1) * (tracking / zoom);
  let cursor = -total / 2;
  characters.forEach((character, index) => {
    ctx.fillText(character, cursor, 0);
    cursor += widths[index] + tracking / zoom;
  });
  ctx.restore();
}

function drawLabels(ctx, zoom) {
  DISTRICT_LABELS.forEach((label) => {
    drawTrackedText(ctx, label.text, { ...label, zoom, weight: 700 });
  });

  WATER_LABELS.forEach((label) => {
    drawTrackedText(ctx, label.text, {
      ...label,
      zoom,
      weight: 600,
      family: 'Georgia, "Times New Roman", serif',
      color: "#397b7e",
    });
  });

  STREET_LABELS.forEach((label) => {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.angle);
    ctx.font = `600 ${label.size / zoom}px ${FONT_SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(247, 243, 233, 0.94)";
    ctx.lineWidth = 3.5 / zoom;
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#6a736a";
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawLandmarks(ctx, zoom, width, height, selectedId) {
  const screenScale = 1 / zoom;
  const labelDistance = 17 * screenScale;

  LANDMARKS.forEach((landmark) => {
    const placeLeft = (landmark.x - (width / 2) / zoom) * zoom + width / 2 > width * 0.76;
    const labelX = landmark.x + (placeLeft ? -labelDistance : labelDistance);
    const align = placeLeft ? "right" : "left";
    const selected = selectedId === landmark.id;

    if (selected) {
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, 15 * screenScale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(217, 85, 50, 0.15)";
      ctx.fill();
      ctx.strokeStyle = "rgba(217, 85, 50, 0.5)";
      ctx.lineWidth = 1.2 * screenScale;
      ctx.stroke();
    }

    ctx.save();
    ctx.shadowColor = "rgba(33, 45, 37, 0.22)";
    ctx.shadowBlur = 7 * screenScale;
    ctx.shadowOffsetY = 2 * screenScale;
    ctx.beginPath();
    ctx.arc(landmark.x, landmark.y, 10 * screenScale, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf8ef";
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(landmark.x, landmark.y, 9 * screenScale, 0, Math.PI * 2);
    ctx.fillStyle = "#fbf8ef";
    ctx.fill();
    ctx.strokeStyle = MAP_COLORS.marker;
    ctx.lineWidth = 2.3 * screenScale;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(landmark.x, landmark.y, 3.2 * screenScale, 0, Math.PI * 2);
    ctx.fillStyle = MAP_COLORS.markerInk;
    ctx.fill();

    ctx.font = `700 ${8.4 / zoom}px ${FONT_SANS}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(247, 243, 233, 0.96)";
    ctx.lineWidth = 4.2 / zoom;
    ctx.strokeText(landmark.name, labelX, landmark.y + 0.5 / zoom);
    ctx.fillStyle = "#35433a";
    ctx.fillText(landmark.name, labelX, landmark.y + 0.5 / zoom);

    ctx.font = `700 ${5.7 / zoom}px ${FONT_MONO}`;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#7a7e72";
    ctx.fillText(landmark.number, labelX, landmark.y + 10 / zoom);
    ctx.globalAlpha = 1;
  });
}

export function getLandmarkScreenPositions(width, height, camera) {
  return LANDMARKS.map((landmark) => ({
    id: landmark.id,
    name: landmark.name,
    x: (landmark.x - camera.x) * camera.zoom + width / 2,
    y: (landmark.y - camera.y) * camera.zoom + height / 2,
  }));
}

export function hitTestLandmark(width, height, camera, point) {
  const candidates = getLandmarkScreenPositions(width, height, camera);
  return candidates
    .map((candidate) => ({ ...candidate, distance: Math.hypot(candidate.x - point.x, candidate.y - point.y) }))
    .filter((candidate) => candidate.distance < 18)
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

export function drawMap(ctx, { width, height, camera, layers, selectedId = null }) {
  ctx.save();
  ctx.fillStyle = MAP_COLORS.land;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  if (layers.terrain) {
    drawDistricts(ctx);
  }
  if (layers.blocks) {
    drawBlocks(ctx, camera.zoom);
  }
  if (layers.terrain) {
    drawWater(ctx, camera.zoom);
    drawParks(ctx, camera.zoom);
    drawAirfield(ctx, camera.zoom);
  }
  if (layers.roads) {
    drawRoads(ctx, camera.zoom);
  }
  if (layers.transit) {
    drawTransit(ctx, camera.zoom);
  }
  if (layers.labels) {
    drawLabels(ctx, camera.zoom);
  }
  if (layers.markers) {
    drawLandmarks(ctx, camera.zoom, width, height, selectedId);
  }

  ctx.restore();
  ctx.restore();
}
