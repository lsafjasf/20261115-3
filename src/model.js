export const WORLD = Object.freeze({
  width: 8,
  depth: 6,
  metersPerWorld: 75,
  verticalExaggeration: 2,
});

export const DEFAULT_LAYERS = Object.freeze([
  { id: "L1", name: "片麻岩基底", lithology: "片麻岩", color: "#59636b", pattern: "gneiss", thickness: 90 },
  { id: "L2", name: "薄层砂岩", lithology: "砂岩", color: "#bc8b57", pattern: "sand", thickness: 65 },
  { id: "L3", name: "生物碎屑灰岩", lithology: "灰岩", color: "#78a49e", pattern: "brick", thickness: 110 },
  { id: "L4", name: "炭质页岩", lithology: "页岩", color: "#4e6168", pattern: "shale", thickness: 55 },
  { id: "L5", name: "中粒砂岩", lithology: "砂岩", color: "#d0a567", pattern: "sand", thickness: 80 },
  { id: "L6", name: "紫红色泥岩", lithology: "泥岩", color: "#94644f", pattern: "mud", thickness: 60 },
  { id: "L7", name: "表层土", lithology: "覆盖层", color: "#8f9d6f", pattern: "soil", thickness: 35 },
]);

export const FAULT = Object.freeze({
  id: "F1",
  label: "F₁",
  x: 4.55,
  throwMeters: 70,
  dip: 82,
  movement: "西升东降",
});

export const toWorldY = (meters) => meters / WORLD.metersPerWorld;

export function cloneLayers(layers = DEFAULT_LAYERS) {
  return layers.map((layer) => ({ ...layer }));
}

export function totalThickness(layers) {
  return layers.reduce((sum, layer) => sum + Number(layer.thickness || 0), 0);
}

export function structuralWarp(x, z) {
  return 0.14
    + 0.16 * Math.sin(x * 0.72 + 0.35) * Math.cos(z * 0.82 - 0.15)
    + 0.06 * Math.sin((x + z) * 0.48)
    + 0.025 * (x - WORLD.width / 2);
}

export function faultSide(x) {
  return x >= FAULT.x ? "east" : "west";
}

export function faultShiftMeters(x) {
  return faultSide(x) === "west" ? FAULT.throwMeters / 2 : -FAULT.throwMeters / 2;
}

export function topRelief(x, z) {
  return (
    0.16 * Math.sin(x * 1.05 + 1.2) * Math.cos(z * 1.2 - 0.4)
    + 0.1 * Math.sin((x + z) * 0.72)
    + 0.045 * Math.cos(z * 1.8)
  );
}

export function baseElevation(x, z) {
  return structuralWarp(x, z) + toWorldY(faultShiftMeters(x));
}

export function layerBoundaries(layers, x, z, includeRelief = true) {
  const base = baseElevation(x, z);
  const boundaries = [base];
  let cumulativeMeters = 0;
  for (const layer of layers) {
    cumulativeMeters += Number(layer.thickness || 0);
    boundaries.push(base + toWorldY(cumulativeMeters));
  }
  if (includeRelief) boundaries[boundaries.length - 1] += topRelief(x, z);
  return boundaries;
}

export function surfaceElevation(layers, x, z) {
  return baseElevation(x, z) + toWorldY(totalThickness(layers)) + topRelief(x, z);
}

export function createCut(angleDeg, offsetKm) {
  const angle = angleDeg * Math.PI / 180;
  const normal = { x: Math.cos(angle), z: -Math.sin(angle) };
  const direction = { x: Math.sin(angle), z: Math.cos(angle) };
  const origin = {
    x: WORLD.width / 2 + normal.x * offsetKm,
    z: WORLD.depth / 2 + normal.z * offsetKm,
  };
  return { angleDeg, offsetKm, normal, direction, origin };
}

function updateRange(range, origin, direction, boundary, limit) {
  const delta = direction;
  if (Math.abs(delta) < 1e-7) {
    if (origin < 0 || origin > limit) return null;
    return range;
  }
  const t1 = (0 - origin) / delta;
  const t2 = (limit - origin) / delta;
  const next = { ...range };
  next.min = Math.max(next.min, Math.min(t1, t2));
  next.max = Math.min(next.max, Math.max(t1, t2));
  return next.min <= next.max ? next : null;
}

export function sectionLine(cut) {
  let range = { min: -Infinity, max: Infinity };
  range = updateRange(range, cut.origin.x, cut.direction.x, 0, WORLD.width);
  if (range) range = updateRange(range, cut.origin.z, cut.direction.z, 0, WORLD.depth);
  if (!range) return null;

  const pointAt = (t) => ({
    x: cut.origin.x + cut.direction.x * t,
    z: cut.origin.z + cut.direction.z * t,
    t,
  });
  const start = pointAt(range.min);
  const end = pointAt(range.max);
  const lengthKm = Math.hypot(end.x - start.x, end.z - start.z);
  return { ...range, start, end, lengthKm };
}

export function faultOnLine(cut, line) {
  if (Math.abs(cut.direction.x) < 1e-7) {
    return Math.abs(cut.origin.x - FAULT.x) < 0.08
      ? { t: 0, fraction: 0, along: true }
      : null;
  }
  const t = (FAULT.x - cut.origin.x) / cut.direction.x;
  if (t < line.min || t > line.max) return null;
  const fraction = (t - line.min) / (line.max - line.min);
  return {
    t,
    fraction,
    x: FAULT.x,
    z: cut.origin.z + cut.direction.z * t,
    along: false,
  };
}

export function sampleSection(layers, cut, sampleCount = 180) {
  const line = sectionLine(cut);
  if (!line) return null;
  const fault = faultOnLine(cut, line);
  const values = [];
  const span = line.max - line.min;

  for (let index = 0; index <= sampleCount; index += 1) {
    values.push(index / sampleCount);
  }
  if (fault && !fault.along && fault.fraction > 0.001 && fault.fraction < 0.999) {
    values.push(fault.fraction - 1e-5, fault.fraction + 1e-5);
  }
  values.sort((a, b) => a - b);

  const points = values.map((fraction) => {
    const x = line.start.x + (line.end.x - line.start.x) * fraction;
    const z = line.start.z + (line.end.z - line.start.z) * fraction;
    return {
      fraction,
      distanceKm: fraction * line.lengthKm,
      x,
      z,
      side: faultSide(x),
      boundaries: layerBoundaries(layers, x, z, true),
    };
  });

  const sampled = { line, fault, span, points, samples: sampleCount };
  return { ...sampled, ...sectionMetrics(layers, points, line, fault) };
}

export function sectionMetrics(layers, points, line, fault) {
  const lastBoundary = layers.length;
  let areaWorld = 0;
  const layerAreas = layers.map(() => 0);

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.distanceKm - a.distanceKm;
    if (dx <= 0) continue;
    areaWorld += ((a.boundaries[lastBoundary] - a.boundaries[0]) + (b.boundaries[lastBoundary] - b.boundaries[0])) * dx / 2;
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
      const topA = a.boundaries[layerIndex + 1];
      const bottomA = a.boundaries[layerIndex];
      const topB = b.boundaries[layerIndex + 1];
      const bottomB = b.boundaries[layerIndex];
      layerAreas[layerIndex] += ((topA - bottomA) + (topB - bottomB)) * dx / 2;
    }
  }

  const sectionLength = Math.max(line.lengthKm, 1e-6);
  const meanThicknessMeters = areaWorld / sectionLength * WORLD.metersPerWorld;
  const layerTotals = layers.map((layer, index) => ({
    ...layer,
    sectionShare: Math.max(0, layerAreas[index] / Math.max(areaWorld, 1e-6)),
    averageMeters: Math.max(0, layerAreas[index] / sectionLength * WORLD.metersPerWorld),
  }));

  return {
    sectionLengthKm: line.lengthKm,
    meanThicknessMeters,
    totalThicknessMeters: totalThickness(layers),
    faultThrowMeters: fault && !fault.along ? FAULT.throwMeters : 0,
    faultDistanceKm: fault && !fault.along ? fault.fraction * line.lengthKm : null,
    layers: layerTotals,
  };
}

export function assertLayerOrder(points) {
  for (const point of points) {
    for (let index = 1; index < point.boundaries.length; index += 1) {
      if (point.boundaries[index] <= point.boundaries[index - 1]) {
        throw new Error(`层序异常：${point.x.toFixed(2)}, ${point.z.toFixed(2)}`);
      }
    }
  }
  return true;
}

export function bearingLabel(angleDeg) {
  const angle = ((angleDeg % 360) + 360) % 360;
  if (angle < 0.5 || angle >= 359.5) return "正北";
  if (Math.abs(angle - 90) < 0.5) return "正东";
  if (Math.abs(angle - 180) < 0.5) return "正南";
  if (angle <= 90) return `北偏东 ${Math.round(angle)}°`;
  if (angle <= 180) return `南偏东 ${Math.round(180 - angle)}°`;
  if (angle <= 270) return `南偏西 ${Math.round(angle - 180)}°`;
  return `北偏西 ${Math.round(360 - angle)}°`;
}

