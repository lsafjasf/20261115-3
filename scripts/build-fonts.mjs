import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const files = [
  'index.html',
  'src/app.js',
  'src/renderer.js',
  'src/simulation.js'
];
const text = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('');
const characters = [
  ...new Set(text.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g) || [])
].sort();
const { stdout: indexCss } = await run('curl', [
  '-fsSL',
  '--max-time',
  '30',
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.8/index.css'
]);

const faces = [];
for (const match of indexCss.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
  const block = match[1];
  if (!/font-weight:\s*400;/.test(block)) continue;
  const file = block.match(/noto-sans-sc-(\d+)-400-normal\.woff2/)?.[0];
  const unicodeRange = block.match(/unicode-range:\s*([^;]+);/)?.[1];
  if (!file || !unicodeRange) continue;
  const ranges = unicodeRange.split(',').map((token) => {
    const [start, end = start] = token
      .trim()
      .replace(/^U\+/i, '')
      .split('-')
      .map((part) => Number.parseInt(part, 16));
    return [start, end];
  });
  faces.push({ file, unicodeRange, ranges });
}

const required = new Map();
for (const character of characters) {
  const codePoint = character.codePointAt(0);
  const face = faces.find((item) =>
    item.ranges.some(([start, end]) => codePoint >= start && codePoint <= end)
  );
  if (face) required.set(face.file, face);
}

await mkdir('assets/fonts', { recursive: true });
const rules = [
  '/* Generated from Noto Sans SC subsets used by this interface. Source: @fontsource/noto-sans-sc, OFL-1.1. */'
];
for (const face of required.values()) {
  await run('curl', [
    '-fsSL',
    '--max-time',
    '60',
    `https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.8/files/${face.file}`,
    '-o',
    `assets/fonts/${face.file}`
  ]);
  rules.push(`@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./assets/fonts/${face.file}') format('woff2');
  unicode-range: ${face.unicodeRange};
}`);
}

await writeFile('fonts.css', `${rules.join('\n')}\n`);
console.log(
  `Generated ${required.size} font subsets for ${characters.length} characters.`
);
