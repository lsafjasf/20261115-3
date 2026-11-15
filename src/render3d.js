import {
  FAULT,
  WORLD,
  layerBoundaries,
  sampleSection,
  surfaceElevation,
} from "./model.js";
import { fitProjector, projectPoint3D, shade } from "./projection.js";

const EPS = 0.004;
const TAU = Math.PI * 2;

function topAt(layers, x, z, side = null) {
  let sampleX = x;
  if (side === "west") sampleX = Math.min(x, FAULT.x - EPS);
  if (side === "east") sampleX = Math.max(x, FAULT.x + EPS);
  return surfaceElevation(layers, sampleX, z);
}

function addTopSurface(items, layers, project) {
  const topLayer = layers[layers.length - 1];
  const xSlices = 26;
  const zSlices = 18;

  for (let ix = 0; ix < xSlices; ix += 1) {
    const x0 = WORLD.width * ix / xSlices;
    const x1 = WORLD.width * (ix + 1) / xSlices;
    const pieces = x0 < FAULT.x && x1 > FAULT.x
      ? [[x0, FAULT.x, "west"], [FAULT.x, x1, "east"]]
      : [[x0, x1, x1 <= FAULT.x ? "west" : "east"]];

    for (let iz = 0; iz < zSlices; iz += 1) {
      const z0 = WORLD.depth * iz / zSlices;
      const z1 = WORLD.depth * (iz + 1) / zSlices;
      for (const [startX, endX, side] of pieces) {
        const corners = [
          { x: startX, y: topAt(layers, startX, z0, side), z: z0 },
          { x: endX, y: topAt(layers, endX, z0, side), z: z0 },
          { x: endX, y: topAt(layers, endX, z1, side), z: z1 },
          { x: startX, y: topAt(layers, startX, z1, side), z: z1 },
        ];
        const projected = corners.map(project);
        const variation = Math.sin(ix * 1.7 + iz * 2.3) * 5 + Math.cos(ix * ix + iz) * 3;
        items.push({
          points: projected,
          fill: shade(topLayer.color, 4 + variation),
          stroke: "rgba(26, 34, 29, 0.23)",
          lineWidth: 0.55,
          depth: averageDepth(projected),
        });
      }
    }
  }
}

function averageDepth(points) {
  return points.reduce((sum, point) => sum + point.depth, 0) / points.length;
}

function addFaultScarp(items, layers, project) {
  const zSlices = 18;
  for (let iz = 0; iz < zSlices; iz += 1) {
    const z0 = WORLD.depth * iz / zSlices;
    const z1 = WORLD.depth * (iz + 1) / zSlices;
    const west0 = topAt(layers, FAULT.x, z0, "west");
    const west1 = topAt(layers, FAULT.x, z1, "west");
    const east0 = topAt(layers, FAULT.x, z0, "east");
    const east1 = topAt(layers, FAULT.x, z1, "east");
    const projected = [
      project({ x: FAULT.x, y: west0, z: z0 }),
      project({ x: FAULT.x, y: west1, z: z1 }),
      project({ x: FAULT.x, y: east1, z: z1 }),
      project({ x: FAULT.x, y: east0, z: z0 }),
    ];
    items.push({
      points: projected,
      fill: shade("#6b4b43", iz % 2 ? 9 : -2),
      stroke: "rgba(236, 126, 100, 0.36)",
      lineWidth: 0.7,
      depth: averageDepth(projected) - 0.01,
    });
  }
}

function addWallX(items, layers, xFixed, project, light) {
  const zSegments = 14;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const top = [];
    const bottom = [];
    for (let index = 0; index <= zSegments; index += 1) {
      const z = WORLD.depth * index / zSegments;
      const boundaries = layerBoundaries(layers, xFixed, z, true);
      top.push(project({ x: xFixed, y: boundaries[layerIndex + 1], z }));
      bottom.push(project({ x: xFixed, y: boundaries[layerIndex], z }));
    }
    const points = [...top, ...bottom.reverse()];
    items.push({
      points,
      fill: shade(layers[layerIndex].color, light),
      stroke: "rgba(9, 15, 17, 0.42)",
      lineWidth: 0.65,
      depth: averageDepth(points),
    });
  }
}

function addWallZ(items, layers, zFixed, project, light) {
  const ranges = [
    { start: 0, end: FAULT.x - EPS, side: "west" },
    { start: FAULT.x + EPS, end: WORLD.width, side: "east" },
  ];
  const xSegments = 14;

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    for (const range of ranges) {
      const top = [];
      const bottom = [];
      for (let index = 0; index <= xSegments; index += 1) {
        const x = range.start + (range.end - range.start) * index / xSegments;
        const boundaries = layerBoundaries(layers, x, zFixed, true);
        top.push(project({ x, y: boundaries[layerIndex + 1], z: zFixed }));
        bottom.push(project({ x, y: boundaries[layerIndex], z: zFixed }));
      }
      const points = [...top, ...bottom.reverse()];
      items.push({
        points,
        fill: shade(layers[layerIndex].color, light),
        stroke: "rgba(9, 15, 17, 0.42)",
        lineWidth: 0.65,
        depth: averageDepth(points),
      });
    }
  }
}

export function sceneHeight(layers) {
  let highest = 0;
  for (let x = 0; x <= WORLD.width; x += 0.4) {
    for (let z = 0; z <= WORLD.depth; z += 0.4) {
      highest = Math.max(highest, surfaceElevation(layers, x, z));
    }
  }
  return highest + 0.2;
}

export function render3D(ctx, state) {
  const { width, height, layers, cut, camera } = state;
  const highest = sceneHeight(layers);
  const viewport = fitProjector(width, height, camera, highest, WORLD);
  const project = (point) => projectPoint3D(point, camera, highest, viewport, camera.zoom);
  const items = [];

  addWallX(items, layers, 0, project, -16);
  addWallX(items, layers, WORLD.width, project, 4);
  addWallZ(items, layers, 0, project, -23);
  addWallZ(items, layers, WORLD.depth, project, -8);
  addTopSurface(items, layers, project);
  addFaultScarp(items, layers, project);
  items.sort((a, b) => a.depth - b.depth);

  drawBackdrop(ctx, width, height);
  drawModelBase(ctx, highest, viewport, camera, project);
  for (const item of items) {
    drawPolygon(ctx, item);
  }
  drawFaultTrace(ctx, layers, project);
  drawSectionCurtain(ctx, state, project);
  return viewport;
}

function drawBackdrop(ctx, width, height) {
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.43, 20, width * 0.5, height * 0.43, width * 0.68);
  glow.addColorStop(0, "rgba(55, 83, 80, 0.2)");
  glow.addColorStop(0.56, "rgba(20, 34, 38, 0.08)");
  glow.addColorStop(1, "rgba(4, 8, 11, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(121, 151, 150, 0.06)";
  ctx.lineWidth = 1;
  for (let y = 28; y < height; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
}

function drawPolygon(ctx, item) {
  ctx.beginPath();
  ctx.moveTo(item.points[0].x, item.points[0].y);
  for (let index = 1; index < item.points.length; index += 1) {
    ctx.lineTo(item.points[index].x, item.points[index].y);
  }
  ctx.closePath();
  ctx.fillStyle = item.fill;
  ctx.fill();
  if (item.stroke) {
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = item.lineWidth;
    ctx.stroke();
  }
}

function drawModelBase(ctx, highest, viewport, camera, project) {
  const corners = [
    { x: 0, y: 0.035, z: 0 },
    { x: WORLD.width, y: 0.035, z: 0 },
    { x: WORLD.width, y: 0.035, z: WORLD.depth },
    { x: 0, y: 0.035, z: WORLD.depth },
  ].map(project);
  const shadow = corners.map((point) => ({ x: point.x + 7, y: point.y + 13 }));

  ctx.save();
  ctx.filter = "blur(9px)";
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  polygonPath(ctx, shadow);
  ctx.fill();
  ctx.restore();

  ctx.save();
  polygonPath(ctx, corners);
  ctx.fillStyle = "rgba(3, 8, 10, 0.62)";
  ctx.fill();
  ctx.strokeStyle = "rgba(153, 174, 168, 0.19)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
  void highest;
  void viewport;
  void camera;
}

function drawFaultTrace(ctx, layers, project) {
  const zSamples = 26;
  const path = [];
  for (let index = 0; index <= zSamples; index += 1) {
    const z = WORLD.depth * index / zSamples;
    path.push(project({ x: FAULT.x - EPS, y: surfaceElevation(layers, FAULT.x - EPS, z) + 0.025, z }));
  }

  ctx.save();
  ctx.beginPath();
  path.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = "rgba(75, 29, 25, 0.8)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = "rgba(237, 111, 88, 0.95)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  const labelPoint = path[Math.floor(path.length * 0.54)];
  drawTag(ctx, `${FAULT.label} 断层`, labelPoint.x + 8, labelPoint.y - 17, "#ff9b83", "rgba(35, 18, 17, 0.9)");
  ctx.restore();
}

function drawSectionCurtain(ctx, state, project) {
  const { layers, cut } = state;
  const section = sampleSection(layers, cut, 96);
  if (!section) return;
  const points = section.points;
  const lastBoundary = layers.length;
  const topPath = points.map((point) => project({ x: point.x, y: point.boundaries[lastBoundary], z: point.z }));
  const bottomPath = points.map((point) => project({ x: point.x, y: point.boundaries[0], z: point.z }));

  ctx.save();
  polygonPath(ctx, [...topPath, ...bottomPath.slice().reverse()]);
  ctx.fillStyle = "rgba(5, 11, 13, 0.56)";
  ctx.fill();

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    const layerTop = points.map((point) => project({
      x: point.x,
      y: point.boundaries[layerIndex + 1],
      z: point.z,
    }));
    const layerBottom = points.map((point) => project({
      x: point.x,
      y: point.boundaries[layerIndex],
      z: point.z,
    }));
    polygonPath(ctx, [...layerTop, ...layerBottom.slice().reverse()]);
    ctx.fillStyle = hexToRgba(layer.color, 0.82);
    ctx.fill();
    ctx.strokeStyle = "rgba(7, 14, 15, 0.38)";
    ctx.lineWidth = 0.55;
    ctx.stroke();
  }

  const first = points[0];
  const second = points[points.length - 1];
  const startTop = project({ x: first.x, y: first.boundaries[lastBoundary] + 0.1, z: first.z });
  const startBottom = project({ x: first.x, y: first.boundaries[0] - 0.08, z: first.z });
  const endTop = project({ x: second.x, y: second.boundaries[lastBoundary] + 0.1, z: second.z });
  const endBottom = project({ x: second.x, y: second.boundaries[0] - 0.08, z: second.z });

  ctx.beginPath();
  ctx.moveTo(startBottom.x, startBottom.y);
  ctx.lineTo(startTop.x, startTop.y);
  ctx.moveTo(endTop.x, endTop.y);
  ctx.lineTo(endBottom.x, endBottom.y);
  ctx.strokeStyle = "rgba(255, 185, 105, 0.75)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  topPath.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = "rgba(28, 15, 7, 0.65)";
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = "#ffc078";
  ctx.lineWidth = 1.7;
  ctx.stroke();

  drawPlaneEndpoint(ctx, startTop, "A", -1);
  drawPlaneEndpoint(ctx, endTop, "A′", 1);
  if (section.fault && !section.fault.along) drawSectionFault(ctx, state, section, project);
  ctx.restore();
}

function drawSectionFault(ctx, state, section, project) {
  const { layers, cut } = state;
  const fault = section.fault;
  const base = layerBoundaries(layers, FAULT.x - EPS, fault.z, false)[0];
  const topWest = surfaceElevation(layers, FAULT.x - EPS, fault.z);
  const topEast = surfaceElevation(layers, FAULT.x + EPS, fault.z);
  const pointX = cut.origin.x + cut.direction.x * fault.t;
  const bottom = project({ x: pointX, y: base - 0.03, z: fault.z });
  const top = project({ x: pointX, y: Math.max(topWest, topEast) + 0.16, z: fault.z });

  ctx.beginPath();
  ctx.moveTo(bottom.x, bottom.y);
  ctx.lineTo(top.x, top.y);
  ctx.strokeStyle = "rgba(255, 235, 225, 0.84)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = "rgba(206, 68, 51, 0.96)";
  ctx.lineWidth = 1.15;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  drawTag(ctx, `${FAULT.label} · ${FAULT.throwMeters} m`, top.x + 7, top.y - 15, "#ffb09c", "rgba(40, 19, 17, 0.92)");
  void topEast;
}

function drawPlaneEndpoint(ctx, point, label, direction) {
  const x = point.x + (direction < 0 ? -13 : 13);
  const y = point.y - 7;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.2, 0, TAU);
  ctx.fillStyle = "#ffc078";
  ctx.fill();
  ctx.strokeStyle = "rgba(17, 13, 8, 0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();
  drawTag(ctx, label, x, y, "#1b1610", "#f0a45d", true);
}

function drawTag(ctx, text, x, y, color, background, centered = false) {
  ctx.save();
  ctx.font = "600 9px 'SFMono-Regular', 'Noto Sans SC', sans-serif";
  const width = ctx.measureText(text).width + 10;
  const height = 16;
  const left = centered ? x - width / 2 : x;
  ctx.beginPath();
  roundRect(ctx, left, y - height / 2, width, height, 2);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.strokeStyle = color === "#1b1610" ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 176, 140, 0.22)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 5, y + 0.4);
  ctx.restore();
}

function polygonPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const number = parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}
