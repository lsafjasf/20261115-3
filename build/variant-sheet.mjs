import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { ICON_NAMES } from "./icons.js";
import { standaloneSvg } from "./build.js";

const require = createRequire(import.meta.url);
const { decodePng } = require("./png.cjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "render24");
const base = {
  viewBox: 24,
  strokeWidth: 2,
  cornerRadius: 1.5,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
};

const variants = [
  { title: "sw=2 r=1.5 (default)", defaults: base, overrides: {} },
  { title: "sw=3 r=1.5 (bold global)", defaults: { ...base, strokeWidth: 3 }, overrides: {} },
  { title: "sw=2 r=4 (round global)", defaults: { ...base, cornerRadius: 4 }, overrides: {} },
];

const COLS = ICON_NAMES.length;
const CELL = 56;
const ROW_H = 84;
const PAD = 20;
const sheetW = PAD * 2 + COLS * CELL;
const sheetH = PAD * 2 + variants.length * ROW_H + 10;

function pngRects(svg, ox, oy, scale) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 24 }, background: "white" })
    .render()
    .asPng();
  const { data, width, height, channels } = decodePng(png);
  const out = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i + 3] > 0 && data[i] < 200) {
        out.push(`<rect x="${ox + x * scale}" y="${oy + y * scale}" width="${scale}" height="${scale}" fill="#1f2937"/>`);
      }
    }
  }
  return out.join("");
}

async function main() {
  const body = [
    `<rect width="${sheetW}" height="${sheetH}" fill="#fff"/>`,
    `<text x="${PAD}" y="14" font-family="sans-serif" font-size="12" fill="#6b7280">Global token variants @24px (2x)</text>`,
  ];
  variants.forEach((variant, vr) => {
    const rowY = PAD + 8 + vr * ROW_H;
    body.push(`<text x="${PAD}" y="${rowY + 30}" font-family="sans-serif" font-size="10" fill="#374151">${variant.title}</text>`);
    ICON_NAMES.forEach((name, ci) => {
      const x = PAD + ci * CELL + 4;
      const y = rowY + 36;
      body.push(
        `<rect x="${x - 2}" y="${y - 2}" width="48" height="48" rx="6" fill="#f8fafc" stroke="#e5e7eb"/>`,
        pngRects(standaloneSvg(name, variant.defaults, variant.overrides), x, y, 2),
      );
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">${body.join("")}</svg>`;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "variant-sheet.svg"), svg);
  await writeFile(join(OUT, "variant-sheet.png"), new Resvg(svg).render().asPng());
  console.log("变体看板 -> dist/render24/variant-sheet.png");
}

main();
