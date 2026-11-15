import { WORLD } from "./model.js";

function niceStep(range, targetTicks) {
  const rough = range / Math.max(targetTicks, 1);
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-6))));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

export function buildSectionFigure(section, layers, width, height) {
  const margins = {
    top: width < 430 ? 30 : 38,
    right: 18,
    bottom: 60,
    left: width < 430 ? 50 : 62,
  };
  const plot = {
    x: margins.left,
    y: margins.top,
    width: Math.max(60, width - margins.left - margins.right),
    height: Math.max(80, height - margins.top - margins.bottom),
  };
  const maxElevation = Math.max(...section.points.flatMap((point) => point.boundaries)) * WORLD.metersPerWorld;
  const yMax = Math.max(100, Math.ceil(maxElevation / 100) * 100);
  const yMin = 0;
  const xScale = plot.width / Math.max(section.sectionLengthKm, 0.01);
  const yScale = plot.height / (yMax - yMin);
  const x = (fraction) => plot.x + fraction * plot.width;
  const y = (meters) => plot.y + plot.height - (meters - yMin) * yScale;
  const pointToScreen = (point, boundaryIndex) => ({
    x: x(point.fraction),
    y: y(point.boundaries[boundaryIndex] * WORLD.metersPerWorld),
  });

  const layerFigures = layers.map((layer, layerIndex) => {
    const top = section.points.map((point) => pointToScreen(point, layerIndex + 1));
    const bottom = section.points.map((point) => pointToScreen(point, layerIndex));
    const labels = [];
    for (const fraction of [0.18, 0.76]) {
      const index = Math.min(section.points.length - 1, Math.round(fraction * (section.points.length - 1)));
      const point = section.points[index];
      const topMeters = point.boundaries[layerIndex + 1] * WORLD.metersPerWorld;
      const bottomMeters = point.boundaries[layerIndex] * WORLD.metersPerWorld;
      if ((topMeters - bottomMeters) * yScale > 10) {
        labels.push({
          x: x(point.fraction),
          y: (y(topMeters) + y(bottomMeters)) / 2,
          code: layer.id,
        });
      }
    }
    return { layer, top, bottom, labels };
  });

  const topPath = section.points.map((point) => pointToScreen(point, layers.length));
  const bottomPath = section.points.map((point) => pointToScreen(point, 0));
  const fault = buildFaultFigure(section, layers, x, y, yScale);
  const xStep = niceStep(section.sectionLengthKm, width < 430 ? 4 : 5);
  const yStep = niceStep(yMax / WORLD.metersPerWorld, height < 400 ? 4 : 5) * WORLD.metersPerWorld;
  const xTicks = [];
  for (let value = 0; value <= section.sectionLengthKm + 1e-6; value += xStep) {
    xTicks.push({ value, x: x(value / section.sectionLengthKm) });
  }
  const yTicks = [];
  for (let value = 0; value <= yMax + 1e-6; value += yStep) {
    yTicks.push({ value, y: y(value) });
  }

  return {
    section,
    layers,
    width,
    height,
    margins,
    plot,
    x,
    y,
    xScale,
    yScale,
    yMin,
    yMax,
    layerFigures,
    topPath,
    bottomPath,
    fault,
    xTicks,
    yTicks,
    verticalExaggeration: yScale / (xScale / 1000),
  };
}

function buildFaultFigure(section, layers, x, y, yScale) {
  if (!section.fault || section.fault.along) return null;
  const index = section.points.findIndex((point) => point.fraction > section.fault.fraction);
  const left = section.points[Math.max(0, index - 1)];
  const right = section.points[Math.min(section.points.length - 1, index)];
  const topLeft = left.boundaries[layers.length] * WORLD.metersPerWorld;
  const topRight = right.boundaries[layers.length] * WORLD.metersPerWorld;
  const baseLeft = left.boundaries[0] * WORLD.metersPerWorld;
  const baseRight = right.boundaries[0] * WORLD.metersPerWorld;
  return {
    x: x(section.fault.fraction),
    top: y(Math.max(topLeft, topRight)),
    bottom: y(Math.min(baseLeft, baseRight)),
    topLeft: y(topLeft),
    topRight: y(topRight),
    offsetPixels: Math.abs(topLeft - topRight) * yScale,
    throwMeters: Math.abs(topLeft - topRight),
    distanceKm: section.fault.fraction * section.sectionLengthKm,
  };
}

export function layerPolygon(figure) {
  return [...figure.top, ...figure.bottom.slice().reverse()];
}
