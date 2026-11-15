// SVG 构建：预览与导出共用同一函数，确保完全一致。

import { FONT_STACK } from "./layout.js";

const XMLNS = "http://www.w3.org/2000/svg";

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function textEl(row, fillColor) {
  const attrs = [
    `x="${round(row.textX)}"`,
    `y="${round(row.baselineY)}"`,
    `font-family="${esc(FONT_STACK)}"`,
    `font-size="${row.fontSize}"`,
    `font-weight="${row.nativeWeight}"`,
    `fill="${esc(fillColor)}"`,
    `transform="${row.transform}"`,
    `paint-order="stroke fill"`,
    `stroke-linejoin="round"`,
  ];
  if (row.strokeWidth > 0) {
    attrs.push(`stroke="${esc(fillColor)}"`);
    attrs.push(`stroke-width="${round(row.strokeWidth)}"`);
  }
  return `  <text ${attrs.join(" ")}>${esc(row.rawText)}</text>`;
}

function guideEl(guide, color, height, width, index) {
  const hitWidth = 14;
  const pos = round(guide.pos);
  if (guide.orientation === "h") {
    return [
      `  <g class="guide" data-guide-id="${esc(guide.id)}" data-index="${index}">`,
      `    <line x1="0" y1="${pos}" x2="${width}" y2="${pos}" stroke="${esc(color)}" stroke-width="1.2" stroke-dasharray="7 5" opacity="0.95" class="guide-line"/>`,
      `    <line x1="0" y1="${pos}" x2="${width}" y2="${pos}" stroke="transparent" stroke-width="${hitWidth}" class="guide-hit"/>`,
      `  </g>`,
    ].join("\n");
  }
  return [
    `  <g class="guide" data-guide-id="${esc(guide.id)}" data-index="${index}">`,
    `    <line x1="${pos}" y1="0" x2="${pos}" y2="${height}" stroke="${esc(color)}" stroke-width="1.2" stroke-dasharray="7 5" opacity="0.95" class="guide-line"/>`,
    `    <line x1="${pos}" y1="0" x2="${pos}" y2="${height}" stroke="transparent" stroke-width="${hitWidth}" class="guide-hit"/>`,
    `  </g>`,
].join("\n");
}

export function buildSvg({ layout, state, guides, options }) {
  const { width, height, rows } = layout;
  const { fillColor, bgColor, guideColor } = state;
  const { showGuides, exportGuides, showLabels, interactive } = options;
  const body = [];

  body.push(
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="${esc(bgColor)}"/>`
  );

  rows.forEach((row) => {
    body.push(textEl({ ...row, rawText: state.text }, fillColor));
  });

  if (showLabels) {
    rows.forEach((row) => {
      body.push(
        `  <text x="${round(layout.metrics.minLeft)}" y="${round(row.baselineY)}" ` +
          `font-family="${esc(FONT_STACK)}" font-size="13" font-weight="600" ` +
          `fill="${esc(fillColor)}" opacity="0.7" paint-order="stroke fill" ` +
          `stroke="${esc(bgColor)}" stroke-width="4" stroke-linejoin="round">${esc(row.label)}</text>`
      );
      body.push(
        `  <text x="${round(layout.metrics.minLeft)}" y="${round(row.baselineY + 18)}" ` +
          `font-family="${esc(FONT_STACK)}" font-size="11" ` +
          `fill="${esc(fillColor)}" opacity="0.55" paint-order="stroke fill" ` +
          `stroke="${esc(bgColor)}" stroke-width="3" stroke-linejoin="round">w${row.scale.toFixed(2)}</text>`
      );
    });
  }

  if (showGuides && (interactive || exportGuides)) {
    guides.forEach((guide, index) => {
      body.push(guideEl(guide, guideColor, height, width, index));
    });
  }

  const svgOpen =
    `<svg xmlns="${XMLNS}" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" ` +
    `aria-label="${esc(state.text)}">`;

  return `<?xml version="1.0" encoding="UTF-8"?>\n${svgOpen}\n${body.join("\n")}\n</svg>\n`;
}
