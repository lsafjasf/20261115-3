// jsdom integration test: real UI events, lock semantics, both preview sets.
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = await readFile(join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: pathToFileURL(join(root, 'index.html')).href,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Blob = window.Blob;
globalThis.TextEncoder = window.TextEncoder;
globalThis.TextDecoder = window.TextDecoder;
globalThis.URL = window.URL;

await import(pathToFileURL(join(root, 'src/app.js')).href);

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

const palette = window.__palette;

// ---------- Initial render ----------
const previews = window.document.querySelectorAll('.preview');
check('渲染出两套预览（浅色 + 深色）', previews.length === 2);
check('每套预览都包含卡片/按钮/图表',
  previews[0].querySelectorAll('.btn').length === 2 &&
  previews[0].querySelectorAll('rect').length === 6 &&
  previews[1].querySelectorAll('rect').length === 6);

// ---------- Lock a derived color ----------
const lockedToken = palette.tokens['primary-light'];
check('初始 primary-light 已锁定（实际锁定一种颜色）', lockedToken.locked === true);
const lockedHex = lockedToken.hex;

// ---------- Change the primary via the color input ----------
const primaryInput = window.document
  .querySelectorAll('#token-list input[type="color"]')[0];
primaryInput.value = '#16A34A';
primaryInput.dispatchEvent(new window.Event('input', { bubbles: true }));

check('主色已通过 UI 更新', palette.tokens['primary'].hex === '#16A34A');
check('未锁定派生色跟随更新（primary-hover）',
  palette.tokens['primary-hover'].hex !== '#2D22E0');
check('锁定颜色保持不变（primary-light）',
  palette.tokens['primary-light'].hex === lockedHex, lockedHex);

// ---------- Both previews reflect the new palette ----------
const lightSvgRects = [...previews[0].querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
const darkSvgRects = [...previews[1].querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
const resolveVar = (expression) => {
  const name = expression.match(/var\((--[\w-]+)\)/)[1];
  return palette.orderedIds
    .map((id) => palette.tokens[id])
    .find((token) => token.cssVar === name)?.hex;
};
check('预览 A 图表首柱使用新主色', resolveVar(lightSvgRects[0]) === '#16A34A', lightSvgRects[0]);
check('预览 B 图表同步更新（深色派生色）',
  resolveVar(darkSvgRects[0]) === palette.tokens['primary-dark'].hex, darkSvgRects[0]);
check('两套预览图表颜色不同（主题映射不同）',
  resolveVar(lightSvgRects[0]) !== resolveVar(darkSvgRects[0]));
check('两套预览均含锁定色且值相同',
  lightSvgRects.some((fill) => resolveVar(fill) === lockedHex) &&
  darkSvgRects.some((fill) => resolveVar(fill) === lockedHex));
check('data-hex 记录实时色板值，随主色更新',
  previews[0].querySelector('rect').dataset.hex === '#16A34A');

const lightButton = previews[0].querySelector('.btn--primary');
const darkButton = previews[1].querySelector('.btn--primary');
check('预览 A 主按钮 CSS 变量指向新主色',
  lightButton.style.background === '' &&
  previews[0].style.getPropertyValue('--preview-primary') === 'var(--color-primary)');
check('预览 B 主按钮 CSS 变量指向 primary-dark',
  previews[1].style.getPropertyValue('--preview-primary') === 'var(--color-primary-dark)');

// ---------- Locked base color rejects edits ----------
const neutralRow = [...window.document.querySelectorAll('.token-row')]
  .find((row) => row.querySelector('.token-row__name small')?.textContent === '--color-neutral');
neutralRow.querySelector('.lock-btn').click();
const neutralInput = neutralRow.querySelector('input[type="color"]');
const beforeNeutral = palette.tokens['neutral'].hex;
neutralInput.value = '#000000';
neutralInput.dispatchEvent(new window.Event('input', { bubbles: true }));
check('锁定的基础色不可修改', palette.tokens['neutral'].hex === beforeNeutral);

// ---------- CSS output panel updates ----------
const cssText = window.document.querySelector('#css-output').value;
check('CSS 输出面板实时更新', cssText.includes('--color-primary: #16A34A;'));
check('CSS 输出面板标注锁定', cssText.includes('/* locked */'));

// ---------- Injected :root variables ----------
const injected = window.document.querySelector('#palette-vars').textContent;
check(':root 变量已注入文档', injected.includes('--color-primary:#16A34A;'));

// ---------- Reset restores the factory palette ----------
window.document.querySelector('#reset').click();
check('重置后恢复默认主色', palette.tokens['primary'].hex === '#4F46E5');
check('重置后恢复默认锁定状态', palette.tokens['primary-light'].locked === true);
check('重置后预览重新挂载（仍为两套）',
  window.document.querySelectorAll('.preview').length === 2);
check('重置后 CSS 面板同步',
  window.document.querySelector('#css-output').value.includes('--color-primary: #4F46E5;'));

// ---------- Export buttons produce blobs without throwing ----------
let createdBlob = null;
const originalCreate = URL.createObjectURL;
URL.createObjectURL = (blob) => {
  createdBlob = blob;
  return 'blob:test';
};
URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = () => {};

window.document.querySelector('#export-css').click();
check('CSS 导出生成 Blob', createdBlob && createdBlob.type === 'text/css');

window.document.querySelector('#export-png').click();
check('PNG 导出生成 image/png Blob', createdBlob && createdBlob.type === 'image/png');
const pngBytes = new Uint8Array(await createdBlob.arrayBuffer());
check('导出的 PNG 签名合法',
  [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => pngBytes[i] === byte));
URL.createObjectURL = originalCreate;

console.log(`\n${passed} DOM checks passed`);
if (process.exitCode) process.exit(process.exitCode);
