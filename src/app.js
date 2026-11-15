// UI controller: token editor, locks, CSS-variable injection, previews, exports.
import {
  createDefaultPalette,
  listTokens,
  setBaseColor,
  toggleLock,
  recompute,
  toCssVariables,
} from './palette.js';
import { mountPreviews, refreshPreviews } from './preview.js';
import { renderSwatchCard } from './swatch.js';
import { encodePng } from './png.js';

const palette = createDefaultPalette();
window.__palette = palette;

const tokenListEl = document.querySelector('#token-list');
const cssOutputEl = document.querySelector('#css-output');
const previewsEl = document.querySelector('#previews');

function applyPaletteVars() {
  let block = ':root{';
  for (const token of listTokens(palette)) {
    block += `${token.cssVar}:${token.hex};`;
  }
  block += '}';
  document.querySelector('#palette-vars').textContent = block;
}

function renderTokenList() {
  tokenListEl.innerHTML = '';
  for (const group of palette.groups) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'token-group';
    const legend = document.createElement('legend');
    legend.textContent = group.label;
    fieldset.appendChild(legend);

    for (const token of listTokens(palette).filter((t) => t.groupId === group.id)) {
      const row = document.createElement('div');
      row.className = `token-row ${token.locked ? 'is-locked' : ''} ${token.kind}`;

      const swatch = document.createElement('span');
      swatch.className = 'token-row__swatch';
      swatch.style.background = token.hex;

      const name = document.createElement('span');
      name.className = 'token-row__name';
      name.innerHTML = `${token.label}<small>${token.cssVar}</small>`;

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = token.hex;
      colorInput.disabled = token.kind === 'derived';
      colorInput.title = token.kind === 'derived' ? '派生色由规则生成' : '修改主色/辅助色/中性色';
      colorInput.addEventListener('input', (event) => {
        if (setBaseColor(palette, group.id, event.target.value)) {
          syncAll();
        }
      });

      const hexLabel = document.createElement('code');
      hexLabel.className = 'token-row__hex';
      hexLabel.textContent = token.hex;

      const lockButton = document.createElement('button');
      lockButton.type = 'button';
      lockButton.className = `lock-btn ${token.locked ? 'is-locked' : ''}`;
      lockButton.textContent = token.locked ? '🔒 已锁定' : '🔓 锁定';
      lockButton.title = token.kind === 'base' ? '锁定后该主色不可修改' : '锁定后派生色不再跟随主色更新';
      lockButton.addEventListener('click', () => {
        toggleLock(palette, token.id);
        recompute(palette);
        syncAll();
      });

      row.append(swatch, name, colorInput, hexLabel, lockButton);
      fieldset.appendChild(row);
    }
    tokenListEl.appendChild(fieldset);
  }
}

function syncAll() {
  applyPaletteVars();
  renderTokenList();
  cssOutputEl.value = toCssVariables(palette);
  refreshPreviews();
}

function download(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.querySelector('#export-css').addEventListener('click', () => {
  download('brand-palette.css', toCssVariables(palette), 'text/css');
});

document.querySelector('#export-png').addEventListener('click', () => {
  const framebuffer = renderSwatchCard(palette);
  const png = encodePng(framebuffer);
  download('brand-palette.png', png, 'image/png');
});

document.querySelector('#reset').addEventListener('click', () => {
  const fresh = createDefaultPalette();
  Object.keys(palette).forEach((key) => delete palette[key]);
  Object.assign(palette, fresh);
  window.__palette = palette;
  mountPreviews(previewsEl);
  syncAll();
});

mountPreviews(previewsEl);
syncAll();

export { palette };
