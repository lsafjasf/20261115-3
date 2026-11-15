import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { ICON_NAMES, ICONS } from "./icons.js";
import { loadConfig, standaloneSvg } from "./build.js";

const require = createRequire(import.meta.url);
const { decodePng } = require("./png.cjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "render24");

function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "white",
  });
  return resvg.render().asPng();
}

function analyze(png) {
  const { width, height, channels, data } = decodePng(png);
  let ink = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const dark = channels === 4 ? data[i + 3] > 0 && data[i] < 200 : data[i] < 200;
      if (dark) {
        ink++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    width,
    height,
    inkPct: Number(((ink / (width * height)) * 100).toFixed(1)),
    bbox: { minX, minY, maxX, maxY },
    margin: {
      left: minX,
      top: minY,
      right: width - 1 - maxX,
      bottom: height - 1 - maxY,
    },
  };
}

async function main() {
  const { defaults, overrides } = await loadConfig();
  await mkdir(OUT, { recursive: true });

  const rows = [];
  for (const name of ICON_NAMES) {
    const svg = standaloneSvg(name, defaults, overrides);
    const png24 = renderPng(svg, 24);
    const png48 = renderPng(svg, 48);
    await writeFile(join(OUT, `${name}.24.png`), png24);
    await writeFile(join(OUT, `${name}.48.png`), png48);
    rows.push({
      name,
      label: ICONS[name].label,
      overridden: Boolean(overrides[name]),
      stats24: analyze(png24),
    });
  }

  await writeFile(join(OUT, "report.json"), JSON.stringify(rows, null, 2) + "\n");

  const flags = [];
  for (const row of rows) {
    const { inkPct, margin } = row.stats24;
    if (inkPct < 6) flags.push(`${row.name}: 墨迹仅 ${inkPct}%，24px 下可能过淡`);
    if (inkPct > 46) flags.push(`${row.name}: 墨迹达 ${inkPct}%，可能过满/糊连`);
    if (Math.min(...Object.values(margin)) < 1) {
      flags.push(`${row.name}: 触及像素边界，有裁切风险 ${JSON.stringify(margin)}`);
    }
  }

  console.log(`渲染 ${rows.length} 枚图标 @24px / @48px -> dist/render24/`);
  console.table(
    rows.map((r) => ({
      icon: r.name,
      inkPct: r.stats24.inkPct,
      minMargin: Math.min(...Object.values(r.stats24.margin)),
      override: r.overridden ? "yes" : "",
    })),
  );
  if (flags.length) {
    console.log("\n辨识度提示:");
    flags.forEach((f) => console.log(" - " + f));
  } else {
    console.log("\n量化检查通过：无过淡、过满或裁切项。");
  }
}

main();
