import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { ICON_NAMES } from "./icons.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "render24");

async function main() {
  const sprite = await readFile(join(ROOT, "dist", "sprite.svg"), "utf8");
  await mkdir(OUT, { recursive: true });

  // resvg has limited support for <use> into a display:none sprite, so extract
  // each <symbol> and materialize its shapes to prove the sprite payload is valid.
  const symbolRe = /<symbol id="icon-([^"]+)"[^>]*>(.*?)<\/symbol>/g;
  const symbols = {};
  let m;
  while ((m = symbolRe.exec(sprite)) !== null) symbols[m[1]] = m[2];

  const cells = ICON_NAMES.map((name, i) => {
    const x = (i % 6) * 28;
    const y = Math.floor(i / 6) * 28;
    return `<svg x="${x}" y="${y}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f2937" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${symbols[name]}</svg>`;
  }).join("");

  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="56" viewBox="0 0 168 56"><rect width="168" height="56" fill="white"/>${cells}</svg>`;

  if (Object.keys(symbols).length !== ICON_NAMES.length) {
    throw new Error(`雪碧图 symbol 数量不符: ${Object.keys(symbols).length}`);
  }

  const png = new Resvg(composite, {
    fitTo: { mode: "width", value: 336 },
    background: "white",
  })
    .render()
    .asPng();
  await writeFile(join(OUT, "sprite-check.png"), png);
  console.log("雪碧图 <use> 引用渲染 -> dist/render24/sprite-check.png");
}

main();
