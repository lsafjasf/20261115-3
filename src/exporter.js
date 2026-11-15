import { ART_HEIGHT, ART_WIDTH } from "./art.js";

export const EXPORT_WIDTH = 1200;
export const EXPORT_PADDING = 84;
export const EXPORT_HEADER = 148;
export const EXPORT_BASE_WIDTH = 800;
export const MARKER_COLORS = [
  "#ff004d",
  "#00e5ff",
  "#7cff00",
  "#ffb000",
  "#b100ff",
  "#00ff75",
  "#ff00e5",
  "#0057ff",
];

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawHeader(ctx, count) {
  ctx.fillStyle = "#171713";
  ctx.fillRect(0, 0, EXPORT_WIDTH, 96);

  ctx.fillStyle = "#f6f1e5";
  ctx.font = '800 36px "Manrope", "Noto Sans SC", "Helvetica Neue", sans-serif';
  ctx.letterSpacing = "-1.5px";
  ctx.fillText("拼贴长卷", EXPORT_PADDING, 57);
  ctx.font = '500 11px "DM Mono", "Courier New", monospace';
  ctx.letterSpacing = "2px";
  ctx.fillText("COLLAGE STRIP / SEQUENCE EXPORT", EXPORT_PADDING + 4, 77);

  ctx.textAlign = "right";
  ctx.fillStyle = "#d9ff47";
  ctx.font = '500 13px "DM Mono", "Courier New", monospace';
  ctx.letterSpacing = "1px";
  ctx.fillText(`${count} GROUPS`, EXPORT_WIDTH - EXPORT_PADDING, 56);
  ctx.fillStyle = "rgba(246, 241, 229, 0.56)";
  ctx.font = '400 9px "DM Mono", "Courier New", monospace';
  ctx.fillText("PROGRAM GENERATED / VERTICAL COLLAGE", EXPORT_WIDTH - EXPORT_PADDING, 77);
  ctx.textAlign = "left";

  ctx.strokeStyle = "rgba(23, 23, 19, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(EXPORT_PADDING, 125);
  ctx.lineTo(EXPORT_WIDTH - EXPORT_PADDING, 125);
  ctx.stroke();

  ctx.fillStyle = "#171713";
  ctx.font = '500 10px "DM Mono", "Courier New", monospace';
  ctx.letterSpacing = "1px";
  ctx.fillText("SCROLL ORDER ↓", EXPORT_PADDING, 143);
  ctx.textAlign = "right";
  ctx.fillStyle = "#f15a3a";
  ctx.fillText("EXPORTED FROM EDITOR STATE", EXPORT_WIDTH - EXPORT_PADDING, 143);
  ctx.textAlign = "left";
}

function alignmentX(item, imageWidth) {
  const available = EXPORT_WIDTH - EXPORT_PADDING * 2;
  if (item.align === "left") return EXPORT_PADDING;
  if (item.align === "right") return EXPORT_WIDTH - EXPORT_PADDING - imageWidth;
  return EXPORT_PADDING + (available - imageWidth) / 2;
}

export function calculateLayout(items) {
  let y = EXPORT_HEADER + 22;
  const frames = [];

  items.forEach((item, index) => {
    const width = EXPORT_BASE_WIDTH * item.scale;
    const height = width * (ART_HEIGHT / ART_WIDTH);
    const x = alignmentX(item, width);
    frames.push({
      id: item.id,
      index,
      x,
      y,
      width,
      height,
      marker: MARKER_COLORS[index],
      markerX: x + 9,
      markerY: y + 9,
    });
    y += height + item.spacing;
  });

  return {
    frames,
    width: EXPORT_WIDTH,
    height: Math.ceil(y + 74),
  };
}

export function drawLongImage(items) {
  const layout = calculateLayout(items);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f1eee5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawHeader(ctx, items.length);

  layout.frames.forEach((frame) => {
    const item = items[frame.index];

    ctx.fillStyle = "rgba(23, 23, 19, 0.16)";
    ctx.fillRect(frame.x + 10, frame.y + 13, frame.width, frame.height);
    ctx.drawImage(item.canvas, frame.x, frame.y, frame.width, frame.height);

    ctx.strokeStyle = "#171713";
    ctx.lineWidth = 1.25;
    ctx.strokeRect(
      frame.x - 0.625,
      frame.y - 0.625,
      frame.width + 1.25,
      frame.height + 1.25,
    );

    ctx.fillStyle = frame.marker;
    ctx.fillRect(frame.markerX, frame.markerY, 7, 7);

    ctx.fillStyle = "#171713";
    ctx.font = '500 10px "DM Mono", "Courier New", monospace';
    ctx.letterSpacing = "1px";
    ctx.fillText(
      `${String(frame.index + 1).padStart(2, "0")} / ${item.english}`,
      frame.x,
      frame.y + frame.height + 19,
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(23, 23, 19, 0.5)";
    ctx.fillText(
      `SCALE ${Math.round(item.scale * 100)}% · GAP ${item.spacing}px`,
      frame.x + frame.width,
      frame.y + frame.height + 19,
    );
    ctx.textAlign = "left";

    ctx.strokeStyle = "rgba(23, 23, 19, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(frame.x, frame.y + frame.height + 27);
    ctx.lineTo(frame.x + frame.width, frame.y + frame.height + 27);
    ctx.stroke();
  });

  const notesY = canvas.height - 31;
  ctx.fillStyle = "#171713";
  ctx.font = '500 10px "DM Mono", "Courier New", monospace';
  ctx.letterSpacing = "1px";
  ctx.fillText("END OF COLLAGE STRIP", EXPORT_PADDING, notesY);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(23, 23, 19, 0.46)";
  ctx.fillText(`${canvas.width} × ${canvas.height} PX`, canvas.width - EXPORT_PADDING, notesY);
  ctx.textAlign = "left";

  return { canvas, layout };
}

export function createSequenceJson(items, layout) {
  return {
    version: 1,
    generator: "collage-strip-editor",
    exportedAt: new Date().toISOString(),
    artboard: {
      width: layout.width,
      height: layout.height,
      background: "#f1eee5",
    },
    layout: {
      paddingX: EXPORT_PADDING,
      headerHeight: EXPORT_HEADER,
      baseWidth: EXPORT_BASE_WIDTH,
      imageAspect: `${ART_WIDTH}:${ART_HEIGHT}`,
      gapUnit: "px",
      scaleUnit: "ratio",
    },
    order: items.map((item) => item.id),
    groups: items.map((item, index) => ({
      order: index + 1,
      id: item.id,
      art: item.kind,
      number: item.number,
      title: item.title,
      english: item.english,
      seed: item.seed,
      alignment: item.align,
      scale: item.scale,
      spacingAfter: item.spacing,
      verificationColor: layout.frames[index].marker,
      box: {
        x: Math.round(layout.frames[index].x),
        y: Math.round(layout.frames[index].y),
        width: Math.round(layout.frames[index].width),
        height: Math.round(layout.frames[index].height),
      },
    })),
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("长图编码失败"));
    }, "image/png");
  });
}
