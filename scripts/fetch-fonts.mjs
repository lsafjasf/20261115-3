import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("src/assets/fonts");
const characters = [
  ...new Set(
    Array.from(
      "°·—◆、。一三与中代以件低何保信停光八冻几击切制动化厅双古可台号品器图在多失存实射展已并序建形心态息成截所拖持换控支放旋日时星暂曜月有机材构查核正滚点照片物状环生由画的皆盘相看石码程线结绕继续维编缩翠翡翼背自落藏试请败质轨转轮边遗重铜面顶馆黑，",
    ),
  ),
];

const sources = [
  {
    family: "Noto Sans SC Subset",
    weight: 400,
    css: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/400.css",
    base: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/files/",
    prefix: "noto-sans",
  },
  {
    family: "Noto Serif SC Subset",
    weight: 500,
    css: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/500.css",
    base: "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/files/",
    prefix: "noto-serif",
  },
];

function parseRanges(raw) {
  return raw.split(",").map((entry) => {
    const [start, end = start] = entry
      .trim()
      .replace(/^U\+/, "")
      .split("-")
      .map((value) => Number.parseInt(value, 16));
    return [start, end];
  });
}

function isCovered(character, ranges) {
  const codePoint = character.codePointAt(0);
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

await fs.mkdir(root, { recursive: true });

let output = "/* Generated from Noto CJK webfont subsets. */\n";
for (const source of sources) {
  const css = await fetch(source.css).then((response) => response.text());
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)]
    .map((match) => {
      const block = match[1];
      const url = block.match(/url\(([^)]+\.woff2)\)/)?.[1];
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
      return url && range
        ? { filename: path.basename(url), range, ranges: parseRanges(range) }
        : null;
    })
    .filter(Boolean);

  const selected = faces.filter((face) =>
    characters.some((character) => isCovered(character, face.ranges)),
  );

  for (const face of selected) {
    const contents = await fetch(source.base + face.filename).then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} for ${face.filename}`);
      return Buffer.from(await response.arrayBuffer());
    });
    await fs.writeFile(path.join(root, face.filename), contents);
    output += `@font-face {\n  font-family: "${source.family}";\n  font-style: normal;\n  font-weight: ${source.weight};\n  font-display: swap;\n  src: url("./assets/fonts/${face.filename}") format("woff2");\n  unicode-range: ${face.range};\n}\n\n`;
  }

  const missing = characters.filter(
    (character) => !selected.some((face) => isCovered(character, face.ranges)),
  );
  console.log(`${source.family}: ${selected.length} files, missing: ${missing.join("") || "none"}`);
}

await fs.writeFile("src/fonts.css", output);
