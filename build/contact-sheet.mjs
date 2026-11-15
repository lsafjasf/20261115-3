import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { ICON_NAMES } from "./icons.js";
import { loadConfig, standaloneSvg } from "./build.js";

const require = createRequire(import.meta.url);
const { decodePng } = require("./png.cjs");

const EN_LABEL = {
  search: "Search",
  home: "Home",
  bell: "Bell",
  mail: "Mail",
  lock: "Lock",
  bookmark: "Bookmark",
  heart: "Heart",
  star: "Star",
  settings: "Settings",
  user: "User",
  trash: "Trash",
  download: "Download",
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "render24");
const COLS = 4;
const CELL = 96;
const PAD = 24;
const TILE = 24;
const SCALE = 3;

function rasterize(svg, size) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "white",
  })
    .render()
    .asPng();
}

// Re-encode a decoded RGBA raster into tiny SVG <rect> pixels for layout.
function pngToPixelRects(png, ox, oy, scale) {
  const { width, height, channels, data } = decodePng(png);
  const rects = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const dark = channels === 4 ? data[i + 3] > 0 && data[i] < 200 : data[i] < 200;
      if (dark) {
        rects.push(
          `<rect x="${ox + x * scale}" y="${oy + y * scale}" width="${scale}" height="${scale}" fill="#1f2937"/>`,
        );
      }
    }
  }
  return rects.join("");
}

async function main() {
  const { defaults, overrides } = await loadConfig();
  const rows = Math.ceil(ICON_NAMES.length / COLS);
  const sheetW = PAD * 2 + COLS * CELL;
  const sheetH = PAD * 2 + rows * CELL;

  const body = [];
  body.push(
    `<rect width="${sheetW}" height="${sheetH}" fill="#ffffff"/>`,
    `<text x="${PAD}" y="16" font-family="sans-serif" font-size="13" fill="#6b7280">Rasterized at 24px (shown 3x, pixel-accurate) - ${ICON_NAMES.length} icons</text>`,
  );

  ICON_NAMES.forEach((name, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cellX = PAD + col * CELL;
    const cellY = PAD + 10 + row * CELL;
    const tileX = cellX + (CELL - TILE * SCALE) / 2;
    const tileY = cellY;
    const png = rasterize(standaloneSvg(name, defaults, overrides), TILE);
    body.push(
      `<rect x="${cellX}" y="${cellY - 6}" width="${CELL - 12}" height="${CELL - 8}" rx="8" fill="#f8fafc" stroke="#e5e7eb"/>`,
      pngToPixelRects(png, tileX, tileY, SCALE),
      `<text x="${cellX + (CELL - 12) / 2}" y="${tileY + TILE * SCALE + 18}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#374151">${name}${overrides[name] ? " *" : ""}</text>`,
      `<text x="${cellX + (CELL - 12) / 2}" y="${tileY + TILE * SCALE + 32}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#9ca3af">${EN_LABEL[name]}</text>`,
    );
  });

  const sheetSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">` +
    body.join("") +
    "</svg>";

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "contact-sheet.svg"), sheetSvg);
  const png = new Resvg(sheetSvg).render().asPng();
  await writeFile(join(OUT, "contact-sheet.png"), png);
  console.log("看板 -> dist/render24/contact-sheet.png (" + sheetW + "x" + sheetH + ")");
}

main();
