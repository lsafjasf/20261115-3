// Node verification: derivation rules, lock semantics, CSS + PNG exports,
// and both preview sets (light/dark theme variable resolution).
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  createDefaultPalette,
  setBaseColor,
  toggleLock,
  recompute,
  toCssVariables,
  getChartSeries,
  listTokens,
} from '../src/palette.js';
import { renderSwatchCard } from '../src/swatch.js';
import { encodePng } from '../src/png.js';
import { hexToRgb, hexToHsl, withLightness, mixHex } from '../src/color.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'artifacts');

let passed = 0;
function check(name, condition, detail = '') {
  if (!condition) {
    console.error(`FAIL  ${name} ${detail}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------- 1. Rule derivation on default palette ----------
const palette = createDefaultPalette();
const primary = palette.tokens['primary'];
const primaryHover = palette.tokens['primary-hover'];
check(
  '派生色遵守规则（primary-hover = 主色明度 -8）',
  primaryHover.hex === withLightness(primary.hex, hexToHsl(primary.hex).l - 8),
  `${primary.hex} -> ${primaryHover.hex}`,
);
check(
  '派生色遵守规则（primary-light = 与白混合 80%）',
  palette.tokens['primary-light'].hex === mixHex(primary.hex, '#FFFFFF', 0.8),
  palette.tokens['primary-light'].hex,
);

// ---------- 2. Lock one color, then change the primary ----------
const lockedBefore = palette.tokens['primary-light'].hex;
check('实际锁定一个颜色：primary-light 初始为锁定态', palette.tokens['primary-light'].locked === true, lockedBefore);

// Also exercise explicit lock toggle on a derived token.
check('toggleLock 可锁定派生色', toggleLock(palette, 'secondary-dark') === true);
const lockedSecondaryDark = palette.tokens['secondary-dark'].hex;

const newPrimary = '#DC2626';
check('setBaseColor 允许修改未锁定主色', setBaseColor(palette, 'primary', newPrimary) === true);
check('主色已更新', palette.tokens['primary'].hex === newPrimary);

check(
  '未锁定派生色按规则更新（primary-hover 跟随新主色）',
  palette.tokens['primary-hover'].hex === withLightness(newPrimary, hexToHsl(newPrimary).l - 8),
  palette.tokens['primary-hover'].hex,
);
check(
  '锁定的颜色不随主色改变（primary-light）',
  palette.tokens['primary-light'].hex === lockedBefore,
  `保持 ${lockedBefore}`,
);
check(
  '运行时锁定的 secondary-dark 也不改变',
  palette.tokens['secondary-dark'].hex === lockedSecondaryDark,
  lockedSecondaryDark,
);
check(
  '未锁定的 secondary 派生色仍随其基础色规则保持一致',
  palette.tokens['secondary-hover'].hex ===
    withLightness(palette.tokens['secondary'].hex, hexToHsl(palette.tokens['secondary'].hex).l - 8),
);

// ---------- 3. Locked base cannot be modified ----------
toggleLock(palette, 'neutral');
const neutralBefore = palette.tokens['neutral'].hex;
check('锁定基础色后 setBaseColor 返回 false', setBaseColor(palette, 'neutral', '#111111') === false);
check('锁定的中性色基础值未被修改', palette.tokens['neutral'].hex === neutralBefore);

// ---------- 4. Unlock + recompute restores rule value ----------
toggleLock(palette, 'primary-light');
recompute(palette);
check(
  '解锁后重新派生恢复规则值',
  palette.tokens['primary-light'].hex === mixHex(newPrimary, '#FFFFFF', 0.8),
  palette.tokens['primary-light'].hex,
);

// ---------- 5. CSS export ----------
const css = toCssVariables(palette);
check('CSS 导出包含 :root 与全部变量', css.startsWith(':root {') && css.includes('--color-primary: #DC2626;'));
check('CSS 导出标记 locked 注释', css.includes('/* locked */'));

// ---------- 6. Both preview sets (theme variable resolution) ----------
const themeVars = {
  light: {
    '--preview-primary': 'var(--color-primary)',
    '--preview-primary-soft': 'var(--color-primary-light)',
    '--preview-secondary': 'var(--color-secondary)',
    '--preview-bg': 'var(--color-neutral-surface)',
  },
  dark: {
    '--preview-primary': 'var(--color-primary-dark)',
    '--preview-primary-soft': 'var(--color-primary-hover)',
    '--preview-secondary': 'var(--color-secondary-dark)',
    '--preview-bg': 'var(--color-neutral-dark)',
  },
};
const resolver = new Map(listTokens(palette).map((t) => [t.cssVar, t.hex]));
function resolve(expression) {
  const match = expression.match(/var\((--[\w-]+)\)/);
  return match ? resolver.get(match[1]) : expression;
}
const lightPrimary = resolve(themeVars.light['--preview-primary']);
const darkPrimary = resolve(themeVars.dark['--preview-primary']);
check('预览 A（浅色）主按钮解析为新主色', lightPrimary === newPrimary, lightPrimary);
check(
  '预览 B（深色）主按钮解析为 primary-dark 派生色',
  darkPrimary === palette.tokens['primary-dark'].hex,
  darkPrimary,
);
check('两套预览解析出不同颜色', lightPrimary !== darkPrimary);

// Chart series used by both preview sets reflect the live palette.
const series = getChartSeries(palette);
check('图表系列跟随色板更新（首项为新主色）', series[0].hex === newPrimary);
check(
  '图表系列保留按规则未受影响的辅助色（锁定组未变）',
  series.find((s) => s.name === '辅助色').hex === palette.tokens['secondary'].hex,
);
check(
  '图表系列颜色全部来自实时色板令牌',
  series.every((item) => listTokens(palette).some((token) => token.hex === item.hex)),
);

// ---------- 7. PNG export (valid signature + real pixels) ----------
const framebuffer = renderSwatchCard(palette);
const png = encodePng(framebuffer);
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
check('PNG 签名合法', signature.every((byte, i) => png[i] === byte));
const view = new DataView(png.buffer, png.byteOffset);
check('PNG IHDR 宽度与帧缓冲一致', view.getUint32(16) === framebuffer.width);
check('PNG IHDR 高度与帧缓冲一致', view.getUint32(20) === framebuffer.height);

// Pixel at a known swatch location must equal the locked primary-light color
// in the rendered card (chip for primary-light, 3rd token of primary group).
const target = palette.tokens['primary-light'];
// Swatch layout: first group chips begin at y=90; primary-light is column 3.
const px = 36 + 3 * (168 + 16) + 84;
const py = 90 + 40;
const offset = (py * framebuffer.width + px) * 4;
const pixel = { r: framebuffer.data[offset], g: framebuffer.data[offset + 1], b: framebuffer.data[offset + 2] };
check('PNG 色卡像素与（解锁重算后的）令牌颜色一致', JSON.stringify(pixel) === JSON.stringify(hexToRgb(target.hex)));

// Render two cards: before/after snapshots for the lock demonstration.
const before = createDefaultPalette();
const beforeFb = renderSwatchCard(before);
const beforePng = encodePng(beforeFb);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'palette-before.png'), beforePng);
await writeFile(join(outDir, 'palette-after-lock-demo.png'), png);
await writeFile(join(outDir, 'brand-palette.css'), css);
await writeFile(join(outDir, 'palette-snapshot.json'), JSON.stringify(palette, null, 2));

console.log(`\n${passed} checks passed`);
console.log('artifacts:', ['palette-before.png', 'palette-after-lock-demo.png', 'brand-palette.css', 'palette-snapshot.json'].join(', '));
console.log('png hashes:', createHash('sha256').update(beforePng).digest('hex').slice(0, 12),
  createHash('sha256').update(png).digest('hex').slice(0, 12));

if (process.exitCode) process.exit(process.exitCode);
