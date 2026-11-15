import {
  WORLD,
  pointInPolygon,
  pointDistance,
  toRadians,
  transformObjectPolygon,
  castShadowPolygon,
  beamPolygon,
} from "./geometry.js";

const INK = "#191a16";
const PAPER = "#f4f1e8";
const TAU = Math.PI * 2;

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const integer = Number.parseInt(normalized, 16);
  return `rgba(${(integer >> 16) & 255}, ${(integer >> 8) & 255}, ${integer & 255}, ${alpha})`;
}

function pathPolygon(ctx, points) {
  if (!points?.length) return false;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index][0], points[index][1]);
  }
  ctx.closePath();
  return true;
}

function drawWorldGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = "rgba(25, 26, 22, 0.052)";
  ctx.lineWidth = 0.7;

  for (let x = 50; x < WORLD.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
    ctx.stroke();
  }

  for (let y = 50; y < WORLD.height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(25, 26, 22, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, WORLD.width - 1, WORLD.height - 1);

  ctx.fillStyle = "rgba(25, 26, 22, 0.28)";
  ctx.font = '600 7px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  for (let x = 100; x <= 900; x += 100) {
    ctx.fillText(String(x).padStart(4, "0"), x + 4, WORLD.height - 5);
  }
  ctx.restore();
}

function drawBeam(ctx, light) {
  if (!light.enabled) return;
  const points = beamPolygon(light, 60);
  const gradient = ctx.createRadialGradient(light.x, light.y, 8, light.x, light.y, light.range);
  const strength = 0.08 + (light.intensity / 100) * 0.1;
  gradient.addColorStop(0, rgba(light.color, strength));
  gradient.addColorStop(0.5, rgba(light.color, strength * 0.5));
  gradient.addColorStop(1, rgba(light.color, 0));

  ctx.save();
  if (!pathPolygon(ctx, points)) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawBeamEdges(ctx, light, selected) {
  if (!light.enabled) return;
  const half = toRadians(light.spread / 2);
  const angle = toRadians(light.angle);
  const alpha = selected ? 0.22 : 0.1;

  ctx.save();
  ctx.strokeStyle = rgba(light.color, alpha);
  ctx.lineWidth = selected ? 1 : 0.75;
  ctx.setLineDash(selected ? [4, 6] : [2, 7]);

  for (const edgeAngle of [angle - half, angle + half]) {
    ctx.beginPath();
    ctx.moveTo(light.x, light.y);
    ctx.lineTo(
      light.x + Math.cos(edgeAngle) * light.range,
      light.y + Math.sin(edgeAngle) * light.range,
    );
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(light.x, light.y, light.range, angle - half, angle + half);
  ctx.strokeStyle = rgba(light.color, alpha * 0.7);
  ctx.stroke();
  ctx.restore();
}

function drawShadows(ctx, state) {
  const objects = state.objects;
  for (const light of state.lights) {
    if (!light.enabled) continue;
    const baseAlpha = 0.075 + (light.intensity / 100) * 0.045;

    for (const object of objects) {
      const shadow = castShadowPolygon(light, object);
      if (!shadow) continue;

      ctx.save();
      if (!pathPolygon(ctx, shadow)) {
        ctx.restore();
        continue;
      }
      ctx.fillStyle = `rgba(17, 18, 14, ${baseAlpha})`;
      ctx.fill();

      ctx.strokeStyle = "rgba(17, 18, 14, 0.025)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawContactShadow(ctx, object) {
  const spread = object.shape === "capsule" ? 62 : 56;
  ctx.save();
  ctx.translate(object.x + 3, object.y + 4);
  ctx.rotate(toRadians(object.rotation));
  ctx.scale(1, 0.45);
  const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, spread);
  gradient.addColorStop(0, "rgba(17, 18, 14, 0.22)");
  gradient.addColorStop(0.55, "rgba(17, 18, 14, 0.09)");
  gradient.addColorStop(1, "rgba(17, 18, 14, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, spread, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function objectPath(ctx, object) {
  return pathPolygon(ctx, transformObjectPolygon(object));
}

function drawObjectBody(ctx, object, selected) {
  drawContactShadow(ctx, object);

  ctx.save();
  ctx.translate(2.5, 4.5 + object.height * 1.3);
  objectPath(ctx, object);
  ctx.fillStyle = "rgba(17, 18, 14, 0.18)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  objectPath(ctx, object);
  ctx.fillStyle = object.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(20, 21, 17, 0.72)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.clip();
  ctx.translate(object.x, object.y);
  ctx.rotate(toRadians(object.rotation));
  ctx.scale(object.scale, object.scale);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.36)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-58, 30);
  ctx.lineTo(52, -35);
  ctx.stroke();

  if (object.shape === "disc") {
    ctx.strokeStyle = "rgba(25, 26, 22, 0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.17)";
    ctx.beginPath();
    ctx.arc(-13, -15, 8, 0, TAU);
    ctx.fill();
  } else if (object.shape === "capsule") {
    ctx.strokeStyle = "rgba(25, 26, 22, 0.18)";
    ctx.beginPath();
    ctx.moveTo(-24, -18);
    ctx.lineTo(-24, 18);
    ctx.moveTo(24, -18);
    ctx.lineTo(24, 18);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(25, 26, 22, 0.18)";
    ctx.beginPath();
    ctx.moveTo(-14, 20);
    ctx.lineTo(0, -24);
    ctx.lineTo(17, 18);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(25, 26, 22, 0.77)";
  ctx.font = '700 8px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(object.label, object.x, object.y + 0.5);
  ctx.restore();

  if (selected) {
    ctx.save();
    ctx.strokeStyle = "rgba(25, 26, 22, 0.72)";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 4]);
    const radius = object.shape === "capsule" ? 69 : 65;
    ctx.beginPath();
    ctx.arc(object.x, object.y, radius, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawObjectCaption(ctx, object, selected);
}

function drawObjectCaption(ctx, object, selected) {
  const y = object.y + (object.shape === "triangle" ? 67 : 61);
  ctx.save();
  ctx.strokeStyle = selected ? "rgba(25, 26, 22, 0.5)" : "rgba(25, 26, 22, 0.24)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(object.x, y - 9);
  ctx.lineTo(object.x, y - 3);
  ctx.stroke();
  ctx.fillStyle = selected ? "rgba(25, 26, 22, 0.78)" : "rgba(25, 26, 22, 0.5)";
  ctx.font = '600 7px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`${object.label} / ${object.name.toUpperCase()}`, object.x, y);
  ctx.restore();
}

function aimHandlePosition(light) {
  const angle = toRadians(light.angle);
  return [
    light.x + Math.cos(angle) * 79,
    light.y + Math.sin(angle) * 79,
  ];
}

function drawRangeRing(ctx, light) {
  if (!light.enabled) return;
  ctx.save();
  ctx.strokeStyle = rgba(light.color, 0.27);
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  ctx.arc(light.x, light.y, light.range, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawLightFixture(ctx, light, selected, exportMode) {
  const handle = aimHandlePosition(light);
  const angle = toRadians(light.angle);
  const labelX = clamp(light.x + 26, 34, WORLD.width - 82);
  const labelY = clamp(light.y - 25, 25, WORLD.height - 22);
  const activeAlpha = light.enabled ? 1 : 0.35;

  ctx.save();
  ctx.globalAlpha = activeAlpha;

  if (light.enabled) {
    const glow = ctx.createRadialGradient(light.x, light.y, 2, light.x, light.y, 58);
    glow.addColorStop(0, rgba(light.color, 0.38));
    glow.addColorStop(0.25, rgba(light.color, 0.16));
    glow.addColorStop(1, rgba(light.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 58, 0, TAU);
    ctx.fill();
  }

  if (light.enabled) {
    ctx.strokeStyle = rgba(light.color, selected ? 0.75 : 0.4);
    ctx.lineWidth = selected ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.moveTo(light.x + Math.cos(angle) * 27, light.y + Math.sin(angle) * 27);
    ctx.lineTo(handle[0], handle[1]);
    ctx.stroke();
  }

  ctx.fillStyle = light.enabled ? "#fbf8f0" : "#e2dfd6";
  ctx.strokeStyle = light.enabled ? INK : "rgba(25, 26, 22, 0.45)";
  ctx.lineWidth = selected ? 1.7 : 1.2;
  ctx.beginPath();
  ctx.arc(light.x, light.y, selected ? 15.5 : 14, 0, TAU);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = light.enabled ? light.color : "#a8a69e";
  ctx.beginPath();
  ctx.arc(light.x, light.y, selected ? 8.8 : 8, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "rgba(25, 26, 22, 0.82)";
  ctx.font = '700 6.5px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(light.label, light.x, light.y + 0.5);

  if (light.enabled && !exportMode) {
    ctx.fillStyle = "#fbf8f0";
    ctx.strokeStyle = rgba(light.color, selected ? 1 : 0.65);
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.beginPath();
    ctx.arc(handle[0], handle[1], selected ? 6.5 : 5, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = rgba(light.color, 0.92);
    ctx.beginPath();
    ctx.arc(handle[0], handle[1], selected ? 2.2 : 1.7, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = selected ? "rgba(25, 26, 22, 0.8)" : "rgba(25, 26, 22, 0.46)";
  ctx.font = '600 7px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${light.label} / ${light.shortName.toUpperCase()}${light.enabled ? "" : " · OFF"}`,
    labelX,
    labelY,
  );
  ctx.restore();
}

function drawScene(ctx, state, view, options) {
  const { width, height, dpr, scale, offsetX, offsetY } = view;
  const exportMode = Boolean(options?.exportMode);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#eeeae1";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const wash = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
  wash.addColorStop(0, "rgba(255, 255, 255, 0.38)");
  wash.addColorStop(0.58, "rgba(255, 255, 255, 0)");
  wash.addColorStop(1, "rgba(81, 77, 63, 0.045)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  drawWorldGrid(ctx);

  for (const light of state.lights) {
    drawBeam(ctx, light);
  }

  const selectedLight = state.lights.find((light) => light.id === state.selectedLightId);
  if (selectedLight && !exportMode) {
    drawRangeRing(ctx, selectedLight);
  }

  drawShadows(ctx, state);

  for (const light of state.lights) {
    drawBeamEdges(ctx, light, !exportMode && light.id === state.selectedLightId);
  }

  const sortedObjects = [...state.objects].sort((a, b) => a.y - b.y);
  for (const object of sortedObjects) {
    drawObjectBody(
      ctx,
      object,
      !exportMode && object.id === state.selectedObjectId,
    );
  }

  const sortedLights = [...state.lights].sort((a, b) => {
    if (a.id === state.selectedLightId) return 1;
    if (b.id === state.selectedLightId) return -1;
    return 0;
  });
  for (const light of sortedLights) {
    drawLightFixture(
      ctx,
      light,
      !exportMode && light.id === state.selectedLightId,
      exportMode,
    );
  }

  if (exportMode) {
    ctx.fillStyle = "rgba(25, 26, 22, 0.39)";
    ctx.font = '600 7px "SFMono-Regular", Consolas, monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("UMBRA / GEOMETRIC SHADOW FIELD", 20, WORLD.height - 18);
    ctx.textAlign = "right";
    ctx.fillText("REBUILT FROM VECTOR GEOMETRY", WORLD.width - 20, WORLD.height - 18);
  }

  ctx.restore();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class ShadowRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(this.width * this.dpr);
    const targetHeight = Math.round(this.height * this.dpr);

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    const padding = this.width < 600 ? 4 : 10;
    this.scale = Math.min(
      (this.width - padding * 2) / WORLD.width,
      (this.height - padding * 2) / WORLD.height,
    );
    this.offsetX = (this.width - WORLD.width * this.scale) / 2;
    this.offsetY = (this.height - WORLD.height * this.scale) / 2;
  }

  render(state) {
    drawScene(this.ctx, state, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      scale: this.scale,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
    });
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x: (x - this.offsetX) / this.scale,
      y: (y - this.offsetY) / this.scale,
    };
  }

  worldToScreen(point) {
    return {
      x: point[0] * this.scale + this.offsetX,
      y: point[1] * this.scale + this.offsetY,
    };
  }

  hitTest(point, state) {
    const lights = [...state.lights].reverse();
    for (const light of lights) {
      if (light.enabled) {
        const handle = aimHandlePosition(light);
        if (pointDistance([point.x, point.y], handle) <= (light.id === state.selectedLightId ? 17 : 13)) {
          return { type: "aim", lightId: light.id };
        }
      }
      if (pointDistance([point.x, point.y], [light.x, light.y]) <= 22) {
        return { type: "light", lightId: light.id };
      }
    }

    const objects = [...state.objects].sort((a, b) => b.y - a.y);
    for (const object of objects) {
      if (pointInPolygon([point.x, point.y], transformObjectPolygon(object))) {
        return { type: "object", objectId: object.id };
      }
    }
    return null;
  }
}

export function renderExportCanvas(state) {
  const exportWidth = 2000;
  const exportHeight = 1400;
  const canvas = document.createElement("canvas");
  canvas.width = exportWidth;
  canvas.height = exportHeight;
  const ctx = canvas.getContext("2d");

  drawScene(
    ctx,
    state,
    {
      width: exportWidth,
      height: exportHeight,
      dpr: 1,
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    },
    { exportMode: true },
  );
  return canvas;
}
