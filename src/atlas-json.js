import { validateLayout } from "./packer.js";

export const ATLAS_FORMAT = "incremental-sprite-atlas";
export const ATLAS_VERSION = 1;

export function createAtlasDocument(packer, { image, createdAt } = {}) {
  if (!image || typeof image !== "string") {
    throw new Error("导出 JSON 必须包含图集 PNG data URL");
  }
  const frames = [...packer.frames.values()]
    .map((frame) => ({
      id: frame.id,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const document = {
    format: ATLAS_FORMAT,
    version: ATLAS_VERSION,
    createdAt: createdAt || new Date().toISOString(),
    atlas: {
      width: packer.width,
      height: packer.height,
      padding: packer.padding,
      image,
    },
    frames,
    stats: {
      repackCount: packer.repackCount,
      totalMoved: packer.totalMoved,
      atlasGrowths: packer.atlasGrowths,
      utilization: Number(packer.utilization().toFixed(4)),
    },
  };
  return document;
}

export function parseAtlasDocument(input) {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("JSON 解析失败");
    }
  }
  if (!value || typeof value !== "object") {
    throw new Error("JSON 根节点必须是对象");
  }
  if (value.format !== ATLAS_FORMAT) {
    throw new Error("不支持的图集 JSON 格式");
  }
  if (value.version !== ATLAS_VERSION) {
    throw new Error(`仅支持版本 ${ATLAS_VERSION}`);
  }
  if (!value.atlas || typeof value.atlas !== "object") {
    throw new Error("JSON 缺少 atlas 信息");
  }
  const { width, height, padding = 1, image } = value.atlas;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("图集宽高必须是正整数");
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error("padding 必须是非负整数");
  }
  if (!image || typeof image !== "string") {
    throw new Error("JSON 缺少自包含图集 PNG");
  }
  if (!Array.isArray(value.frames)) {
    throw new Error("JSON frames 必须是数组");
  }
  const frames = value.frames.map((frame, index) => {
    if (!frame || typeof frame !== "object") {
      throw new Error(`第 ${index + 1} 个帧不是对象`);
    }
    if (frame.id === undefined || String(frame.id).trim() === "") {
      throw new Error(`第 ${index + 1} 个帧缺少 id`);
    }
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isInteger(frame[key])) {
        throw new Error(`帧 ${frame.id} 的 ${key} 必须是整数`);
      }
    }
    return {
      id: String(frame.id),
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    };
  });
  const validation = validateLayout(frames, width, height);
  if (!validation.valid) {
    throw new Error(`JSON 切片非法: ${validation.errors[0]}`);
    }
  return {
    width,
    height,
    padding,
    image,
    frames,
    stats: { ...(value.stats || {}) },
    validation,
  };
}
