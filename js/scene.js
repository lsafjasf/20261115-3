// Default demo scene: a winding closed walking trail (S-bends + loop)
// with five sound sources placed beside the path and one segment per span.

import { AMBIENT_TYPES, SOURCE_VOICES } from "./sounds.js";

export const DEFAULT_CONTROL_POINTS = [
  { x: 400, y: 90 },
  { x: 640, y: 130 },
  { x: 700, y: 300 },
  { x: 560, y: 380 },
  { x: 690, y: 520 },
  { x: 520, y: 600 },
  { x: 280, y: 560 },
  { x: 160, y: 420 },
  { x: 250, y: 280 },
  { x: 120, y: 180 },
];

export const DEFAULT_SOURCES = [
  { id: "fountain", label: "喷泉", x: 620, y: 220 },
  { id: "birds", label: "鸟鸣", x: 640, y: 470 },
  { id: "bell", label: "钟铃", x: 360, y: 560 },
  { id: "drone", label: "低频嗡鸣", x: 150, y: 340 },
  { id: "crickets", label: "虫鸣", x: 230, y: 150 },
];

export function defaultSegments(controlPoints = DEFAULT_CONTROL_POINTS) {
  return controlPoints.map((_, i) => ({
    ambient: AMBIENT_TYPES[i % AMBIENT_TYPES.length],
    attenuation: 0.35 + 0.4 * ((i * 7) % 5) / 4,
    reverb: 0.12 + 0.5 * ((i * 3) % 5) / 4,
  }));
}

export function defaultConfig() {
  const controlPoints = DEFAULT_CONTROL_POINTS.map((p) => ({ ...p }));
  return {
    name: "弯曲步道一圈",
    speed: 0.04,
    radius: 320,
    controlPoints,
    sources: DEFAULT_SOURCES.map((s) => ({ ...s })),
    segments: defaultSegments(controlPoints),
    voices: SOURCE_VOICES.map((v) => ({ ...v })),
  };
}

export function validateConfig(config) {
  if (!config || !Array.isArray(config.controlPoints) ||
      config.controlPoints.length < 3) {
    throw new Error("路线至少需要 3 个控制点");
  }
  if (!Array.isArray(config.sources) || config.sources.length !== 5) {
    throw new Error("必须包含 5 个声源");
  }
  if (!Array.isArray(config.segments) ||
      config.segments.length !== config.controlPoints.length) {
    throw new Error("每段路线都需要环境声/衰减/混响设置");
  }
  return config;
}
