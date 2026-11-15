// High-resolution PNG export.
//
// The source canvas already contains the fully composed map. A supersampled
// target canvas is created through an injectable factory so the same pipeline
// can be exercised in Node with a stub and in the browser with a real canvas.

export function renderHighResolutionPng(sourceCanvas, pixelRatio = 3, createCanvas) {
  const factory = createCanvas || defaultCreateCanvas;
  const cssWidth = sourceCanvas.clientWidth || sourceCanvas.width;
  const cssHeight = sourceCanvas.clientHeight || sourceCanvas.height;
  const target = factory(
    Math.round(cssWidth * pixelRatio),
    Math.round(cssHeight * pixelRatio),
  );
  const ctx = target.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.drawImage(sourceCanvas, 0, 0, cssWidth, cssHeight);
  target.__exportMeta = { pixelRatio, cssWidth, cssHeight };
  return target;
}

function defaultCreateCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
