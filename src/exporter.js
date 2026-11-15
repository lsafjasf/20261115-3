import { getLandmarkScreenPositions, drawMap } from "./render-map.js";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed"));
    }, "image/png");
  });
}

export async function exportViewportPng({
  width,
  height,
  camera,
  layers,
  selectedId = null,
  scale = 4,
  tileSize = 1024,
  bleed = 16,
  onProgress = async () => {},
}) {
  if (!width || !height) throw new Error("The viewport has no size");
  if (scale < 1 || scale > 8) throw new Error("Export scale must be between 1× and 8×");

  const outputWidth = Math.round(width * scale);
  const outputHeight = Math.round(height * scale);
  const columns = Math.ceil(outputWidth / tileSize);
  const rows = Math.ceil(outputHeight / tileSize);
  const tileCount = columns * rows;

  await onProgress({
    phase: "prepare",
    progress: 0.01,
    completed: 0,
    total: tileCount,
    detail: `Allocating a ${outputWidth.toLocaleString("en-US")} × ${outputHeight.toLocaleString("en-US")} px PNG.`,
  });
  await nextFrame();

  const target = createCanvas(outputWidth, outputHeight);
  const targetContext = target.getContext("2d", { alpha: false });
  targetContext.imageSmoothingEnabled = false;
  targetContext.fillStyle = "#f1ebdd";
  targetContext.fillRect(0, 0, outputWidth, outputHeight);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const completed = row * columns + column;
      const x = column * tileSize;
      const y = row * tileSize;
      const innerWidth = Math.min(tileSize, outputWidth - x);
      const innerHeight = Math.min(tileSize, outputHeight - y);
      const tileCanvas = createCanvas(innerWidth + bleed * 2, innerHeight + bleed * 2);
      const tileContext = tileCanvas.getContext("2d");

      tileContext.setTransform(scale, 0, 0, scale, bleed - x, bleed - y);
      drawMap(tileContext, { width, height, camera, layers, selectedId });

      targetContext.drawImage(
        tileCanvas,
        bleed,
        bleed,
        innerWidth,
        innerHeight,
        x,
        y,
        innerWidth,
        innerHeight,
      );

      const progress = (completed + 1) / tileCount;
      await onProgress({
        phase: "render",
        progress: 0.03 + progress * 0.9,
        completed: completed + 1,
        total: tileCount,
        detail: `Tile ${completed + 1} of ${tileCount} rendered and stitched with seam-safe bleed.`,
      });
      await nextFrame();
    }
  }

  await onProgress({
    phase: "encode",
    progress: 0.95,
    completed: tileCount,
    total: tileCount,
    detail: "Encoding a single lossless PNG from the stitched canvas.",
  });

  const blob = await toBlob(target);
  const screenMarkers = getLandmarkScreenPositions(width, height, camera);
  const markers = screenMarkers.map((marker) => ({
    id: marker.id,
    name: marker.name,
    x: marker.x * scale,
    y: marker.y * scale,
  }));

  await onProgress({
    phase: "complete",
    progress: 1,
    completed: tileCount,
    total: tileCount,
    detail: "Export complete.",
  });

  return {
    blob,
    width: outputWidth,
    height: outputHeight,
    scale,
    tileSize,
    bleed,
    columns,
    rows,
    tileCount,
    markers,
  };
}
