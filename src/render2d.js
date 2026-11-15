import {
  sampleSection,
} from "./model.js";
import { buildSectionFigure, layerPolygon } from "./section-figure.js";
import { shade } from "./projection.js";

const INK = "#253038";
const MUTED_INK = "#718084";
const GRID = "rgba(58, 75, 77, 0.13)";
const FAULT_RED = "#bf503f";

export function renderSection2D(ctx, state) {
  const { width, height, layers, cut } = state;
  const section = sampleSection(layers, cut, 150);
  if (!section) return null;
  const figure = buildSectionFigure(section, layers, width, height);

  drawPaper(ctx, width, height, figure);
  drawGrid(ctx, figure);
  if (figure.fault) drawFaultZone(ctx, figure);

  for (const layerFigure of figure.layerFigures) {
    drawLayer(ctx, layerFigure, figure);
  }

  drawBoundaryLines(ctx, figure);
  drawFault(ctx, figure);
  drawAxes(ctx, figure);
  drawSectionMarks(ctx, figure);
  drawScale(ctx, figure);
  return figure;
}

function drawPaper(ctx, width, height, figure) {
  ctx.fillStyle = "#e9e2d2";
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createLinearGradient(0, 0, width, height);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.13)");
  glow.addColorStop(0.55, "rgba(179, 165, 137, 0.04)");
  glow.addColorStop(1, "rgba(104, 92, 71, 0.1)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(92, 82, 63, 0.09)";
  for (let index = 0; index < 120; index += 1) {
    const x = (index * 71.31) % width;
    const y = (index * 37.17) % height;
    ctx.fillRect(x, y, 0.8, 0.8);
  }
  void figure;
}

function drawGrid(ctx, figure) {
  const { plot, yTicks, xTicks } = figure;
  ctx.save();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 0.7;
  for (const tick of yTicks) {
    if (tick.value === 0) continue;
    ctx.beginPath();
    ctx.moveTo(plot.x, tick.y + 0.5);
    ctx.lineTo(plot.x + plot.width, tick.y + 0.5);
    ctx.stroke();
  }
  for (const tick of xTicks) {
    if (tick.value === 0) continue;
    ctx.beginPath();
    ctx.moveTo(tick.x + 0.5, plot.y);
    ctx.lineTo(tick.x + 0.5, plot.y + plot.height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFaultZone(ctx, figure) {
  const x = figure.fault.x;
  const zone = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
  zone.addColorStop(0, "rgba(191, 80, 63, 0)");
  zone.addColorStop(0.5, "rgba(191, 80, 63, 0.16)");
  zone.addColorStop(1, "rgba(191, 80, 63, 0)");
  ctx.fillStyle = zone;
  ctx.fillRect(x - 7, figure.plot.y, 14, figure.plot.height);
}

function drawLayer(ctx, layerFigure, figure) {
  const polygon = layerPolygon(layerFigure);
  ctx.beginPath();
  ctx.moveTo(polygon[0].x, polygon[0].y);
  for (let index = 1; index < polygon.length; index += 1) {
    ctx.lineTo(polygon[index].x, polygon[index].y);
  }
  ctx.closePath();
  ctx.fillStyle = layerFigure.layer.color;
  ctx.fill();

  ctx.save();
  ctx.clip();
  drawLithologyTexture(ctx, layerFigure.layer, figure.plot);
  ctx.restore();

  ctx.save();
  ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', sans-serif";
  ctx.fillStyle = "rgba(22, 30, 31, 0.64)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of layerFigure.labels) {
    ctx.fillText(label.code, label.x, label.y);
  }
  ctx.restore();
}

function drawLithologyTexture(ctx, layer, plot) {
  const dark = shade(layer.color, -48);
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = dark;
  ctx.fillStyle = dark;
  ctx.lineWidth = 0.55;
  const startX = plot.x - 12;
  const endX = plot.x + plot.width + 12;

  if (layer.pattern === "sand" || layer.pattern === "soil") {
    const gap = layer.pattern === "soil" ? 17 : 13;
    for (let row = 0; row < Math.ceil(plot.height / (gap * 0.7)) + 2; row += 1) {
      for (let column = 0; column < Math.ceil(plot.width / gap) + 2; column += 1) {
        const x = startX + column * gap + (row % 2) * gap * 0.45;
        const y = plot.y + row * gap * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, layer.pattern === "soil" ? 0.65 : 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  if (layer.pattern === "brick") {
    for (let y = plot.y; y < plot.y + plot.height + 14; y += 14) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      const offset = Math.floor((y - plot.y) / 14) % 2 ? 13 : 0;
      for (let x = startX + offset; x < endX; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 14);
        ctx.stroke();
      }
    }
    return;
  }

  if (layer.pattern === "shale") {
    for (let y = plot.y; y < plot.y + plot.height + 8; y += 7) {
      for (let x = startX; x < endX; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 11, y + 0.4);
        ctx.stroke();
      }
    }
    return;
  }

  if (layer.pattern === "gneiss") {
    for (let y = plot.y; y < plot.y + plot.height + 16; y += 13) {
      ctx.beginPath();
      for (let x = startX; x <= endX; x += 3) {
        const wave = Math.sin(x * 0.055 + y * 0.1) * 2.4;
        if (x === startX) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    return;
  }

  if (layer.pattern === "mud") {
    for (let y = plot.y; y < plot.y + plot.height + 12; y += 12) {
      for (let x = startX; x < endX; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 5, y + 4);
        ctx.stroke();
      }
    }
  }
}

function drawBoundaryLines(ctx, figure) {
  ctx.save();
  ctx.strokeStyle = "rgba(32, 43, 44, 0.48)";
  ctx.lineWidth = 0.75;
  for (const layerFigure of figure.layerFigures.slice(0, -1)) {
    drawPolyline(ctx, layerFigure.top);
  }
  ctx.strokeStyle = "#303c3b";
  ctx.lineWidth = 1.7;
  drawPolyline(ctx, figure.topPath);
  ctx.restore();
}

function drawFault(ctx, figure) {
  if (!figure.fault) return;
  const fault = figure.fault;
  const { plot } = figure;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fault.x, plot.y + plot.height);
  ctx.lineTo(fault.x, fault.top);
  ctx.strokeStyle = "rgba(255, 255, 240, 0.84)";
  ctx.lineWidth = 2.8;
  ctx.stroke();
  ctx.strokeStyle = FAULT_RED;
  ctx.lineWidth = 1.15;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  const leftX = fault.x - 18;
  const rightX = fault.x + 18;
  ctx.font = "600 8px 'Noto Sans SC', sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#8c4033";
  ctx.fillText("西盘 ↑", leftX, plot.y + 15);
  ctx.textAlign = "left";
  ctx.fillText("东盘 ↓", rightX, plot.y + 15);

  const arrowX = fault.x + 36;
  const upper = Math.min(fault.topLeft, fault.topRight);
  const lower = Math.max(fault.topLeft, fault.topRight);
  ctx.strokeStyle = "rgba(126, 56, 43, 0.76)";
  ctx.fillStyle = "rgba(126, 56, 43, 0.76)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(arrowX, upper);
  ctx.lineTo(arrowX, lower);
  ctx.moveTo(arrowX - 3, upper + 4);
  ctx.lineTo(arrowX, upper);
  ctx.lineTo(arrowX + 3, upper + 4);
  ctx.moveTo(arrowX - 3, lower - 4);
  ctx.lineTo(arrowX, lower);
  ctx.lineTo(arrowX + 3, lower - 4);
  ctx.stroke();
  drawPaperTag(ctx, `F₁ ${Math.round(fault.throwMeters)} m`, arrowX + 6, (upper + lower) / 2, FAULT_RED, true);
  ctx.restore();
}

function drawAxes(ctx, figure) {
  const { plot, xTicks, yTicks, width, height } = figure;
  ctx.save();
  ctx.strokeStyle = "rgba(37, 48, 56, 0.72)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height);
  ctx.stroke();

  ctx.fillStyle = MUTED_INK;
  ctx.font = "8px 'SFMono-Regular', 'Roboto Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    ctx.strokeStyle = "rgba(42, 54, 58, 0.55)";
    ctx.beginPath();
    ctx.moveTo(plot.x - 4, tick.y + 0.5);
    ctx.lineTo(plot.x, tick.y + 0.5);
    ctx.stroke();
    ctx.fillText(tick.value === 0 ? "0 m" : `${Math.round(tick.value)} m`, plot.x - 8, tick.y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tick of xTicks) {
    ctx.strokeStyle = "rgba(42, 54, 58, 0.55)";
    ctx.beginPath();
    ctx.moveTo(tick.x + 0.5, plot.y + plot.height);
    ctx.lineTo(tick.x + 0.5, plot.y + plot.height + 4);
    ctx.stroke();
    ctx.fillText(`${tick.value.toFixed(tick.value % 1 ? 1 : 0)}`, tick.x, plot.y + plot.height + 7);
  }
  ctx.fillStyle = "rgba(58, 70, 72, 0.68)";
  ctx.textAlign = "right";
  ctx.fillText("km", plot.x + plot.width, plot.y + plot.height + 23);

  ctx.save();
  ctx.translate(13, plot.y + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = MUTED_INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "8px 'Noto Sans SC', sans-serif";
  ctx.fillText("高程 / m", 0, 0);
  ctx.restore();
  void width;
  void height;
}

function drawSectionMarks(ctx, figure) {
  const { plot, topPath } = figure;
  const left = topPath[0];
  const right = topPath[topPath.length - 1];

  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = "600 9px 'SFMono-Regular', 'Noto Sans SC', sans-serif";
  ctx.textBaseline = "middle";
  drawStation(ctx, left.x, plot.y - 13, "A", "left");
  drawStation(ctx, right.x, plot.y - 13, "A′", "right");

  ctx.strokeStyle = "rgba(41, 52, 54, 0.56)";
  ctx.fillStyle = "rgba(41, 52, 54, 0.56)";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(plot.x + 12, plot.y - 13);
  ctx.lineTo(plot.x + 39, plot.y - 13);
  ctx.moveTo(plot.x + 35, plot.y - 16);
  ctx.lineTo(plot.x + 39, plot.y - 13);
  ctx.lineTo(plot.x + 35, plot.y - 10);
  ctx.stroke();
  ctx.restore();
}

function drawStation(ctx, x, y, label, align) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#ddd4c0";
  ctx.fill();
  ctx.strokeStyle = "rgba(46, 57, 58, 0.65)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.fillText(label, x, y + 0.5);
  void align;
}

function drawScale(ctx, figure) {
  const { plot } = figure;
  const y = plot.y + plot.height + 34;
  const scaleKilometers = figure.section.sectionLengthKm > 8 ? 2 : 1;
  const width = scaleKilometers * figure.xScale;
  const x = plot.x;
  ctx.save();
  ctx.strokeStyle = "rgba(54, 66, 67, 0.68)";
  ctx.fillStyle = "rgba(54, 66, 67, 0.68)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.moveTo(x, y - 3);
  ctx.lineTo(x, y + 3);
  ctx.moveTo(x + width, y - 3);
  ctx.lineTo(x + width, y + 3);
  ctx.stroke();
  ctx.font = "8px 'SFMono-Regular', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`${scaleKilometers} km`, x + width + 6, y + 0.5);
  ctx.restore();
}

function drawPolyline(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

function drawPaperTag(ctx, text, x, y, color, centered = false) {
  ctx.save();
  ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', sans-serif";
  const width = ctx.measureText(text).width + 9;
  const height = 14;
  const left = centered ? x - width / 2 : x;
  ctx.beginPath();
  ctx.roundRect(left, y - height / 2, width, height, 1.5);
  ctx.fillStyle = "rgba(238, 231, 216, 0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(191, 80, 63, 0.38)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 4.5, y + 0.2);
  ctx.restore();
}

export function sectionSummaryText(figure) {
  return `剖面 ${figure.section.sectionLengthKm.toFixed(2)} km · 垂向 ${figure.verticalExaggeration.toFixed(1)}×`;
}

