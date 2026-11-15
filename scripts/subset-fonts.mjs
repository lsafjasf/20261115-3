import { mkdir, readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const sourceFiles = ["index.html", "src/app.js", "src/canvas.js", "src/focus-manager.js"];
const sources = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
const printableAscii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join("");
const allCharacters = [...new Set(`${sources.join("")}${printableAscii}—·×↑↓←→⌘`)].join("");

const fonts = [
  ["Noto Sans SC", "/home/hj/.fonts/NotoSansSC-Regular.otf", "noto-sans-sc.woff2"],
  ["Noto Serif SC", "/home/hj/.fonts/NotoSerifSC-Regular.otf", "noto-serif-sc.woff2"],
];

await mkdir("public/fonts", { recursive: true });

for (const [, source, destination] of fonts) {
  const buffer = await readFile(source);
  const subset = await subsetFont(buffer, allCharacters, { targetFormat: "woff2" });
  await writeFile(`public/fonts/${destination}`, subset);
}
