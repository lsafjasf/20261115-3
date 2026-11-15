// Draws the procedural map contents in world coordinates.
import { worldToScreen } from './geometry.js';

export function renderMap(ctx, city, view) {
  drawBackground(ctx, view);
  drawParks(ctx, city, view);
  drawRiver(ctx, city, view);
  drawBuildings(ctx, city, view);
  drawRoads(ctx, city, view);
  drawRoute(ctx, city, view);
  drawPoiMarkers(ctx, city, view);
}

function drawBackground(ctx, view) {
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, view.width, view.height);
}

function project(points, view) {
  return points.map((p) => worldToScreen(p.x, p.y, view));
}

function strokePath(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

function drawParks(ctx, city, view) {
  for (const park of city.parks) {
    const topLeft = worldToScreen(park.x, park.y, view);
    ctx.fillStyle = '#cfe3bd';
    ctx.fillRect(topLeft.x, topLeft.y, park.w * view.scale, park.h * view.scale);
    ctx.strokeStyle = '#a8c88f';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, park.w * view.scale, park.h * view.scale);
  }
}

function drawRiver(ctx, city, view) {
  const points = project(city.river.points, view);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#a8cfe0';
  ctx.lineWidth = city.river.width * view.scale;
  strokePath(ctx, points);
  ctx.strokeStyle = '#7fb6d1';
  ctx.lineWidth = city.river.width * view.scale * 0.18;
  strokePath(ctx, points);
}

function drawBuildings(ctx, city, view) {
  const fills = ['#d9d3c8', '#cfc7b8', '#e0dbd1'];
  for (const building of city.buildings) {
    const topLeft = worldToScreen(building.x, building.y, view);
    const w = building.w * view.scale;
    const h = building.h * view.scale;
    if (topLeft.x + w < 0 || topLeft.x > view.width || topLeft.y + h < 0 || topLeft.y > view.height) {
      continue;
    }
    ctx.fillStyle = fills[building.shade];
    ctx.fillRect(topLeft.x, topLeft.y, w, h);
    ctx.strokeStyle = '#b9b1a3';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(topLeft.x, topLeft.y, w, h);
  }
}

function drawRoads(ctx, city, view) {
  const half = city.bounds.maxX;
  ctx.lineCap = 'butt';
  const drawSet = (roads, vertical) => {
    for (const road of roads) {
      const from = vertical
        ? worldToScreen(road.x, -half, view)
        : worldToScreen(-half, road.y, view);
      const to = vertical
        ? worldToScreen(road.x, half, view)
        : worldToScreen(half, road.y, view);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = road.width * view.scale + 4;
      strokePath(ctx, [from, to]);
      ctx.strokeStyle = '#b9bcc0';
      ctx.lineWidth = road.width * view.scale;
      strokePath(ctx, [from, to]);
    }
  };
  drawSet(city.roads.horizontals, false);
  drawSet(city.roads.verticals, true);
}

function drawRoute(ctx, city, view) {
  const points = project(city.route, view);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(33, 102, 217, 0.35)';
  ctx.lineWidth = 12;
  strokePath(ctx, points);
  ctx.strokeStyle = '#2166d9';
  ctx.lineWidth = 5;
  ctx.setLineDash([14, 8]);
  strokePath(ctx, points);
  ctx.setLineDash([]);
}

function drawPoiMarkers(ctx, city, view) {
  for (const poi of city.pois) {
    const p = worldToScreen(poi.x, poi.y, view);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#d94f4f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}
