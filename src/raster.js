export function createRaster(width, height) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

export function cloneRaster(raster) {
  return {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data),
  };
}

export function blit(source, target, originX, originY) {
  if (
    originX < 0 ||
    originY < 0 ||
    originX + source.width > target.width ||
    originY + source.height > target.height
  ) {
    throw new Error("精灵超出目标图集范围");
  }
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart =
      ((originY + y) * target.width + originX) * 4;
    target.data.set(
      source.data.subarray(sourceStart, sourceStart + source.width * 4),
      targetStart,
    );
  }
}

export function extractRegion(atlas, x, y, width, height) {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > atlas.width ||
    y + height > atlas.height
  ) {
    throw new Error("非法切片区域");
  }
  const result = createRaster(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * atlas.width + x) * 4;
    result.data.set(
      atlas.data.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4,
    );
  }
  return result;
}

export function renderAtlas(frames, sources, width, height) {
  const atlas = createRaster(width, height);
  for (const frame of frames) {
    const source = sources.get(frame.id);
    if (!source) {
      throw new Error(`缺少帧 ${frame.id} 的像素数据`);
    }
    if (source.width !== frame.width || source.height !== frame.height) {
      throw new Error(`帧 ${frame.id} 的像素尺寸与布局不一致`);
    }
    blit(source, atlas, frame.x, frame.y);
  }
  return atlas;
}

export function compareRasters(a, b, { tolerance = 0 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      equal: false,
      differentBytes: Infinity,
      maxChannelDelta: Infinity,
    };
  }
  let differentBytes = 0;
  let maxChannelDelta = 0;
  for (let index = 0; index < a.data.length; index += 1) {
    const delta = Math.abs(a.data[index] - b.data[index]);
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    if (delta > tolerance) {
      differentBytes += 1;
    }
  }
  return {
    equal: differentBytes === 0,
    differentBytes,
    maxChannelDelta,
  };
}

export function verifyAtlasFrames(atlas, frames, sources) {
  const mismatches = [];
  for (const frame of frames) {
    const source = sources.get(frame.id);
    if (!source) {
      mismatches.push({ id: frame.id, reason: "missing-source" });
      continue;
    }
    if (
      source.width !== frame.width ||
      source.height !== frame.height ||
      source.data.length !== frame.width * frame.height * 4
    ) {
      mismatches.push({ id: frame.id, reason: "size-mismatch" });
      continue;
    }
    const extracted = extractRegion(
      atlas,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    );
    if (!compareRasters(extracted, source).equal) {
      mismatches.push({ id: frame.id, reason: "pixel-mismatch" });
    }
  }
  return { equal: mismatches.length === 0, mismatches };
}

export function hashRaster(raster) {
  let hash = 2166136261;
  const bytes = raster.data;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  hash ^= raster.width;
  hash = Math.imul(hash, 16777619);
  hash ^= raster.height;
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function countOpaquePixels(raster) {
  let count = 0;
  for (let index = 3; index < raster.data.length; index += 4) {
    if (raster.data[index] > 0) count += 1;
  }
  return count;
}
