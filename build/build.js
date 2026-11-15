import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ICONS, ICON_NAMES } from "./icons.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

export async function loadConfig() {
  const defaults = JSON.parse(
    await readFile(join(ROOT, "config", "defaults.json"), "utf8"),
  );
  const overrides = JSON.parse(
    await readFile(join(ROOT, "config", "overrides.json"), "utf8"),
  );
  return { defaults, overrides };
}

// Global value, except where an icon-level override exists.
export function resolveToken(name, iconName, defaults, overrides) {
  const local = overrides[iconName];
  if (local && local[name] !== undefined) return local[name];
  return defaults[name];
}

function num(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v).toFixed(2));
}

export function shapeToElement(shape) {
  const attrs = Object.entries(shape)
    .filter(([k]) => k !== "tag")
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${shape.tag} ${attrs}/>`;
}

export function shapesMarkup(iconName, defaults, overrides) {
  const r = resolveToken("cornerRadius", iconName, defaults, overrides);
  const shapes = ICONS[iconName].build(r);
  return shapes.map(shapeToElement).join("");
}

// Static fallback tokens (used by non-CSS renderers such as resvg).
export function staticTokens(iconName, defaults, overrides) {
  return {
    sw: num(resolveToken("strokeWidth", iconName, defaults, overrides)),
    r: num(resolveToken("cornerRadius", iconName, defaults, overrides)),
  };
}

export function rootStyle(iconName, defaults, overrides) {
  const { sw, r } = staticTokens(iconName, defaults, overrides);
  return [
    `--icon-stroke-width:${sw}`,
    `--icon-corner-radius:${r}`,
    "stroke-width:var(--icon-stroke-width)",
  ].join(";");
}

function svgOpen(defaults, style, extra = "") {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${defaults.viewBox} ${defaults.viewBox}" ` +
    `fill="${defaults.fill}" stroke="${defaults.stroke}" ` +
    `stroke-linecap="${defaults.strokeLinecap}" stroke-linejoin="${defaults.strokeLinejoin}" ` +
    `stroke-width="${style.match(/--icon-stroke-width:([^;]+)/)[1]}" style="${style}"${extra}>`
  );
}

// Fully self-contained SVG per icon. Geometry is baked for the resolved radius;
// stroke width is a CSS var with a static fallback so resizing live still works.
export function standaloneSvg(iconName, defaults, overrides) {
  const { sw, r } = staticTokens(iconName, defaults, overrides);
  const style = `--icon-stroke-width:${sw};--icon-corner-radius:${r};stroke-width:var(--icon-stroke-width)`;
  return (
    svgOpen(defaults, style, ` role="img" aria-label="${ICONS[iconName].label}"`) +
    shapesMarkup(iconName, defaults, overrides) +
    "</svg>"
  );
}

function spriteSymbol(iconName, defaults, overrides) {
  const { sw } = staticTokens(iconName, defaults, overrides);
  const globalSw = num(defaults.strokeWidth);
  const local = sw === globalSw ? "" : ` style="--icon-stroke-width:${sw}"`;
  return (
    `<symbol id="icon-${iconName}" viewBox="0 0 ${defaults.viewBox} ${defaults.viewBox}"${local}>` +
    shapesMarkup(iconName, defaults, overrides) +
    "</symbol>"
  );
}

export function spriteSvg(defaults, overrides) {
  const style =
    "display:none;" +
    `--icon-stroke-width:${num(defaults.strokeWidth)};` +
    `--icon-corner-radius:${num(defaults.cornerRadius)};` +
    "stroke-width:var(--icon-stroke-width)";
  const symbols = ICON_NAMES.map((name) =>
    spriteSymbol(name, defaults, overrides),
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `fill="${defaults.fill}" stroke="${defaults.stroke}" ` +
    `stroke-linecap="${defaults.strokeLinecap}" stroke-linejoin="${defaults.strokeLinejoin}" ` +
    `stroke-width="${num(defaults.strokeWidth)}" style="${style}">` +
    symbols +
    "</svg>"
  );
}

export function buildIndex(defaults, overrides) {
  return {
    generatedAt: new Date().toISOString(),
    viewbox: defaults.viewBox,
    global: {
      strokeWidth: defaults.strokeWidth,
      cornerRadius: defaults.cornerRadius,
    },
    sprite: "sprite.svg",
    usage:
      '<svg width="24" height="24"><use href="sprite.svg#icon-search"/></svg>',
    icons: ICON_NAMES.map((name) => ({
      id: `icon-${name}`,
      name,
      label: ICONS[name].label,
      file: `svg/${name}.svg`,
      spriteRef: `sprite.svg#icon-${name}`,
      strokeWidth: resolveToken("strokeWidth", name, defaults, overrides),
      cornerRadius: resolveToken("cornerRadius", name, defaults, overrides),
      overridden: Object.keys(overrides).includes(name),
    })),
  };
}

async function main() {
  const { defaults, overrides } = await loadConfig();
  await mkdir(join(DIST, "svg"), { recursive: true });

  for (const name of ICON_NAMES) {
    await writeFile(join(DIST, "svg", `${name}.svg`), standaloneSvg(name, defaults, overrides));
  }
  await writeFile(join(DIST, "sprite.svg"), spriteSvg(defaults, overrides));
  await writeFile(
    join(DIST, "index.json"),
    JSON.stringify(buildIndex(defaults, overrides), null, 2) + "\n",
  );
  console.log(`Built ${ICON_NAMES.length} icons -> dist/`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
