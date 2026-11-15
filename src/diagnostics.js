import {
  TAU,
  WORLD,
  beamPolygon,
  castShadowPolygon,
  objectRadius,
  polygonArea,
  toDegrees,
  toRadians,
} from "./geometry.js";

function shadowContributions(light, objects) {
  return objects
    .map((object) => ({ object, polygon: castShadowPolygon(light, object) }))
    .filter((entry) => entry.polygon);
}

function shadowWithinBeam(light, polygon) {
  const halfSpread = toRadians(light.spread / 2);
  const center = toRadians(light.angle);

  return polygon.every(([x, y]) => {
    const dx = x - light.x;
    const dy = y - light.y;
    const distance = Math.hypot(dx, dy);
    if (distance > light.range + 1.5) return false;
    if (distance < 0.5) return true;
    const angle = Math.atan2(dy, dx);
    const delta = Math.abs(Math.atan2(Math.sin(angle - center), Math.cos(angle - center)));
    return delta <= halfSpread + 0.004;
  });
}

function rasterPair(lightA, lightB, objects, scale = 0.48) {
  const width = Math.round(WORLD.width * scale);
  const height = Math.round(WORLD.height * scale);
  const makeCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const layerA = makeCanvas();
  const layerB = makeCanvas();
  const combined = makeCanvas();
  const alphaA = 0.07 + (lightA.intensity / 100) * 0.04;
  const alphaB = 0.07 + (lightB.intensity / 100) * 0.04;

  const drawLayer = (ctx, contributions, alpha) => {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.fillStyle = `rgba(17, 18, 14, ${alpha})`;
    for (const { polygon } of contributions) {
      ctx.beginPath();
      ctx.moveTo(polygon[0][0], polygon[0][1]);
      for (let index = 1; index < polygon.length; index += 1) {
        ctx.lineTo(polygon[index][0], polygon[index][1]);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  const contributionsA = shadowContributions(lightA, objects);
  const contributionsB = shadowContributions(lightB, objects);
  drawLayer(layerA.getContext("2d"), contributionsA, alphaA);
  drawLayer(layerB.getContext("2d"), contributionsB, alphaB);
  combined.getContext("2d").drawImage(layerA, 0, 0);
  combined.getContext("2d").drawImage(layerB, 0, 0);

  const dataA = layerA.getContext("2d").getImageData(0, 0, width, height).data;
  const dataB = layerB.getContext("2d").getImageData(0, 0, width, height).data;
  const dataBoth = combined.getContext("2d").getImageData(0, 0, width, height).data;
  let overlapPixels = 0;
  let invalidCompositePixels = 0;
  let outsideUnionPixels = 0;
  let darkestOverlap = 0;

  for (let index = 3; index < dataBoth.length; index += 4) {
    const a = dataA[index] / 255;
    const b = dataB[index] / 255;
    const both = dataBoth[index] / 255;
    const expected = 1 - (1 - a) * (1 - b);
    if (a > 0.02 && b > 0.02) {
      overlapPixels += 1;
      darkestOverlap = Math.max(darkestOverlap, both);
    }
    if (Math.abs(both - expected) > 0.025) invalidCompositePixels += 1;
    if (both > 0.015 && a <= 0.005 && b <= 0.005) outsideUnionPixels += 1;
  }

  return {
    contributionsA,
    contributionsB,
    overlapPixels,
    invalidCompositePixels,
    outsideUnionPixels,
    darkestOverlap,
  };
}

function scorePair(lightA, lightB, objects) {
  const raster = rasterPair(lightA, lightB, objects);
  const polygons = [
    ...raster.contributionsA.map((entry) => ({ light: lightA, polygon: entry.polygon })),
    ...raster.contributionsB.map((entry) => ({ light: lightB, polygon: entry.polygon })),
  ];
  const boundaryErrors = polygons.filter(({ light, polygon }) => !shadowWithinBeam(light, polygon)).length;
  return {
    lightA,
    lightB,
    boundaryErrors,
    ...raster,
    shadowPolygons: polygons.length,
  };
}

export function verifyDualLightBoundaries(state) {
  const activeLights = state.lights.filter((light) => light.enabled);
  if (activeLights.length < 2) {
    return {
      pass: false,
      detail: "Enable two sources to audit their shared contour.",
      overlapPixels: 0,
      boundaryErrors: 0,
    };
  }

  let best = null;
  for (let first = 0; first < activeLights.length; first += 1) {
    for (let second = first + 1; second < activeLights.length; second += 1) {
      const candidate = scorePair(activeLights[first], activeLights[second], state.objects);
      if (
        !best
        || candidate.overlapPixels > best.overlapPixels
        || (candidate.overlapPixels === best.overlapPixels
          && candidate.boundaryErrors < best.boundaryErrors)
      ) {
        best = candidate;
      }
    }
  }

  const overlapArea = best.overlapPixels / (0.48 * 0.48);
  const pass = (
    best.shadowPolygons >= 2
    && best.overlapPixels > 0
    && best.boundaryErrors === 0
    && best.invalidCompositePixels === 0
    && best.outsideUnionPixels === 0
  );

  return {
    pass,
    detail: pass
      ? `${best.lightA.shortName} + ${best.lightB.shortName} · ${Math.round(overlapArea)} px² overlap · contours closed`
      : "No valid shared contour in the current composition.",
    pair: [best.lightA.id, best.lightB.id],
    overlapPixels: best.overlapPixels,
    overlapArea,
    boundaryErrors: best.boundaryErrors,
    invalidCompositePixels: best.invalidCompositePixels,
    outsideUnionPixels: best.outsideUnionPixels,
    shadowPolygons: best.shadowPolygons,
  };
}

export function probeOutOfRange(state) {
  const activeLights = state.lights.filter((light) => light.enabled);
  const candidates = [];

  for (const light of activeLights) {
    for (const object of state.objects) {
      const original = castShadowPolygon(light, object);
      if (!original) continue;

      const radius = objectRadius(object);
      const angle = toRadians(light.angle);
      const distance = light.range + radius + 90;
      const moved = {
        ...object,
        x: light.x + Math.cos(angle) * distance,
        y: light.y + Math.sin(angle) * distance,
      };
      const culled = castShadowPolygon(light, moved);

      const baselineOthers = state.objects
        .filter((entry) => entry.id !== object.id)
        .map((entry) => polygonArea(castShadowPolygon(light, entry) ?? []));
      const afterOthers = state.objects
        .filter((entry) => entry.id !== object.id)
        .map((entry) => polygonArea(castShadowPolygon(light, entry) ?? []));
      const othersStable = baselineOthers.every(
        (area, index) => Math.abs(area - afterOthers[index]) < 0.5,
      );

      candidates.push({
        light,
        object,
        originalArea: polygonArea(original),
        moved,
        distance,
        culled: culled === null,
        othersStable,
      });
    }
  }

  const passing = candidates.filter((candidate) => candidate.culled && candidate.othersStable);
  const pick = passing[0] ?? candidates[0];

  if (!pick) {
    return {
      pass: false,
      detail: "No active object/light pair available for the range probe.",
    };
  }

  const pass = Boolean(pick.culled && pick.othersStable);
  return {
    pass,
    detail: pass
      ? `${pick.object.label} culls at ${Math.round(pick.distance)} px · ${pick.light.shortName} reach ${pick.light.range} px`
      : `${pick.object.label} still contributes outside ${pick.light.shortName} reach.`,
    objectId: pick.object.id,
    lightId: pick.light.id,
    distance: pick.distance,
    range: pick.light.range,
    originalArea: pick.originalArea,
    movedShadow: pick.culled ? 0 : "present",
    othersStable: pick.othersStable,
  };
}

export function runDiagnostics(state) {
  return {
    dual: verifyDualLightBoundaries(state),
    range: probeOutOfRange(state),
    timestamp: Date.now(),
  };
}

export function probeBeamBoundary(light, object) {
  const polygon = castShadowPolygon(light, object);
  if (!polygon) return { exists: false, inside: true, area: 0 };
  const beam = beamPolygon(light);
  const maxRadius = Math.max(...polygon.map(([x, y]) => Math.hypot(x - light.x, y - light.y)));
  const area = polygonArea(polygon);
  return {
    exists: true,
    inside: shadowWithinBeam(light, polygon),
    area,
    maxRadius,
    beamArea: polygonArea(beam),
    angle: toDegrees(Math.atan2(object.y - light.y, object.x - light.x)),
    distance: Math.hypot(object.x - light.x, object.y - light.y),
  };
}
