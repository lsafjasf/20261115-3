import { createRaster } from "./raster.js";

export const DEMO_ATLAS_SIZE = 640;
export const DEMO_FRAME_COUNT = 100;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let rgb = [0, 0, 0];
  if (segment < 1) rgb = [chroma, x, 0];
  else if (segment < 2) rgb = [x, chroma, 0];
  else if (segment < 3) rgb = [0, chroma, x];
  else if (segment < 4) rgb = [0, x, chroma];
  else if (segment < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = l - chroma / 2;
  return rgb.map((channel) => Math.round((channel + match) * 255));
}

function shade(rgb, amount) {
  return rgb.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel + amount))),
  );
}

function setPixel(raster, x, y, rgb, alpha = 255) {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  const index = (y * raster.width + x) * 4;
  raster.data[index] = rgb[0];
  raster.data[index + 1] = rgb[1];
  raster.data[index + 2] = rgb[2];
  raster.data[index + 3] = alpha;
}

export function makeDemoSprite(seed, width, height) {
  const random = mulberry32(seed * 2654435761 + 17);
  const raster = createRaster(width, height);
  const hue = (seed * 47.3 + random() * 38) % 360;
  const base = hslToRgb(hue, 72, 54);
  const dark = shade(base, -52);
  const light = shade(base, 48);
  const accent = hslToRgb((hue + 145) % 360, 86, 66);
  const radius = Math.max(3, Math.floor(Math.min(width, height) * 0.16));
  const border = Math.max(1, Math.floor(Math.min(width, height) * 0.055));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const insetX = Math.min(x, width - 1 - x);
      const insetY = Math.min(y, height - 1 - y);
      if (insetX + insetY < radius - 1) continue;
      if (insetX < 0 || insetY < 0) continue;
      const edge = Math.min(insetX, insetY);
      if (edge < border) {
        setPixel(raster, x, y, dark);
        continue;
      }
      const mix = (x / Math.max(1, width - 1)) * 0.55 +
        (y / Math.max(1, height - 1)) * 0.45;
      const body = shade(base, Math.round((mix - 0.5) * 34));
      setPixel(raster, x, y, body);
    }
  }

  const cx = Math.floor(width * (0.34 + random() * 0.32));
  const cy = Math.floor(height * (0.34 + random() * 0.28));
  const radiusX = Math.max(3, Math.floor(width * (0.12 + random() * 0.11)));
  const radiusY = Math.max(3, Math.floor(height * (0.1 + random() * 0.12)));
  for (let y = -radiusY; y <= radiusY; y += 1) {
    for (let x = -radiusX; x <= radiusX; x += 1) {
      if ((x * x) / (radiusX * radiusX) + (y * y) / (radiusY * radiusY) <= 1) {
        setPixel(raster, cx + x, cy + y, accent);
      }
    }
  }

  const stripeWidth = Math.max(2, Math.floor(width * 0.055));
  const offset = Math.floor(random() * stripeWidth * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (edge <= border + 1) continue;
      if ((x + y + offset) % (stripeWidth * 3) < stripeWidth) {
        setPixel(raster, x, y, light, 140);
      }
    }
  }
  return raster;
}

export function makeDemoFrames(count = DEMO_FRAME_COUNT) {
  return Array.from({ length: count }, (_, index) => {
    const width = 32 + ((index * 37) % 49);
    const height = 24 + ((index * 53) % 57);
    return {
      id: `f${String(index).padStart(3, "0")}`,
      index,
      width,
      height,
      raster: makeDemoSprite(index + 1, width, height),
    };
  });
}

export const DEMO_EDITS = {
  A: {
    label: "增量 A · 右上区域",
    remove: ["f097", "f024"],
    update: [
      { id: "f011", width: 62, height: 54, seed: 5011 },
      { id: "f069", width: 55, height: 48, seed: 5069 },
    ],
    add: [
      { id: "a01", width: 40, height: 44, seed: 6101, anchor: { x: 520, y: 340 } },
      { id: "a02", width: 30, height: 30, seed: 6102, anchor: { x: 520, y: 420 } },
    ],
  },
  B: {
    label: "增量 B · 右下区域",
    remove: ["f008", "f057", "f028"],
    update: [
      { id: "f012", width: 52, height: 46, seed: 7012 },
      { id: "f098", width: 48, height: 44, seed: 7098 },
      { id: "f092", width: 68, height: 66, seed: 7092 },
    ],
    add: [
      { id: "b01", width: 36, height: 30, seed: 7101, anchor: { x: 510, y: 540 } },
      { id: "b02", width: 42, height: 36, seed: 7102, anchor: { x: 500, y: 560 } },
      { id: "b03", width: 28, height: 40, seed: 7103, anchor: { x: 520, y: 580 } },
    ],
  },
};

export function editPayload(key) {
  const edit = DEMO_EDITS[key];
  if (!edit) throw new Error(`未知演示修改 ${key}`);
  return {
    remove: [...edit.remove],
    update: edit.update.map(({ id, width, height }) => ({ id, width, height })),
    add: edit.add.map(({ id, width, height, anchor }) => ({
      id,
      width,
      height,
      anchor,
    })),
  };
}

export function editSprites(key) {
  const edit = DEMO_EDITS[key];
  return new Map(
    [...edit.update, ...edit.add].map((frame) => [
      frame.id,
      makeDemoSprite(frame.seed, frame.width, frame.height),
    ]),
  );
}
