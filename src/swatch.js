// Framebuffer drawing + 5x7 bitmap font + palette swatch-card renderer.
import { hexToRgb, readableText } from './color.js';
import { getChartSeries, listTokens } from './palette.js';

const FONT = {
  ' ': ['00','00','00','00','00','00','00'],
  '#': ['0A','1F','0A','0A','1F','0A','00'],
  '-': ['00','00','00','1F','00','00','00'],
  '.': ['00','00','00','00','00','0C','0C'],
  ':': ['00','0C','0C','00','0C','0C','00'],
  '/': ['01','02','04','08','10','00','00'],
  '0': ['0E','11','13','15','19','11','0E'],
  '1': ['04','0C','04','04','04','04','0E'],
  '2': ['0E','11','01','02','04','08','1F'],
  '3': ['1F','02','04','02','01','11','0E'],
  '4': ['02','06','0A','12','1F','02','02'],
  '5': ['1F','10','1E','01','01','11','0E'],
  '6': ['06','08','10','1E','11','11','0E'],
  '7': ['1F','01','02','04','08','08','10'],
  '8': ['0E','11','11','0E','11','11','0E'],
  '9': ['0E','11','11','0F','01','02','0C'],
  A: ['0E','11','11','1F','11','11','11'],
  B: ['1E','11','11','1E','11','11','1E'],
  C: ['0E','11','10','10','10','11','0E'],
  D: ['1C','12','11','11','11','12','1C'],
  E: ['1F','10','10','1E','10','10','1F'],
  F: ['1F','10','10','1E','10','10','10'],
  G: ['0E','11','10','17','11','11','0F'],
  H: ['11','11','11','1F','11','11','11'],
  I: ['0E','04','04','04','04','04','0E'],
  J: ['07','02','02','02','02','12','0C'],
  K: ['11','12','14','18','14','12','11'],
  L: ['10','10','10','10','10','10','1F'],
  M: ['11','1B','15','15','11','11','11'],
  N: ['11','19','15','13','11','11','11'],
  O: ['0E','11','11','11','11','11','0E'],
  P: ['1E','11','11','1E','10','10','10'],
  Q: ['0E','11','11','11','15','12','0D'],
  R: ['1E','11','11','1E','14','12','11'],
  S: ['0F','10','10','0E','01','01','1E'],
  T: ['1F','04','04','04','04','04','04'],
  U: ['11','11','11','11','11','11','0E'],
  V: ['11','11','11','11','11','0A','04'],
  W: ['11','11','11','15','15','1B','11'],
  X: ['11','11','0A','04','0A','11','11'],
  Y: ['11','11','0A','04','04','04','04'],
  Z: ['1F','01','02','04','08','10','1F'],
};

export function createFramebuffer(width, height, bgHex = '#FFFFFF') {
  const data = new Uint8Array(width * height * 4);
  const { r, g, b } = hexToRgb(bgHex);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(fb, x, y, width, height, hex) {
  const { r, g, b } = hexToRgb(hex);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(fb.width, x + width);
  const y1 = Math.min(fb.height, y + height);
  for (let row = y0; row < y1; row += 1) {
    for (let col = x0; col < x1; col += 1) {
      const offset = (row * fb.width + col) * 4;
      fb.data[offset] = r;
      fb.data[offset + 1] = g;
      fb.data[offset + 2] = b;
      fb.data[offset + 3] = 255;
    }
  }
}

export function drawText(fb, text, x, y, hex, scale = 1) {
  const { r, g, b } = hexToRgb(hex);
  let cursor = x;
  for (const char of String(text).toUpperCase()) {
    const glyph = FONT[char] || FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      const bits = parseInt(glyph[row], 16);
      for (let col = 0; col < 5; col += 1) {
        if (!(bits & (1 << (4 - col)))) continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const px = cursor + col * scale + sx;
            const py = y + row * scale + sy;
            if (px < 0 || py < 0 || px >= fb.width || py >= fb.height) continue;
            const offset = (py * fb.width + px) * 4;
            fb.data[offset] = r;
            fb.data[offset + 1] = g;
            fb.data[offset + 2] = b;
            fb.data[offset + 3] = 255;
          }
        }
      }
    }
    cursor += 6 * scale;
  }
  return cursor;
}

const CARD_WIDTH = 960;
const PADDING = 36;
const CHIP_W = 168;
const CHIP_H = 132;
const GAP = 16;
const INK = '#1F2937';

export function measureCardHeight(palette) {
  const rows = palette.groups.reduce((sum, group) => {
    const count = listTokens(palette).filter((t) => t.groupId === group.id).length;
    return sum + Math.ceil(count / 5);
  }, 0);
  return PADDING * 2 + 40 + rows * (CHIP_H + 44) + 150;
}

export function renderSwatchCard(palette) {
  const height = measureCardHeight(palette);
  const fb = createFramebuffer(CARD_WIDTH, height, '#FFFFFF');
  drawText(fb, 'BRAND COLOR PALETTE', PADDING, PADDING, INK, 3);

  let y = PADDING + 40 + 14;
  for (const group of palette.groups) {
    drawText(fb, group.id.toUpperCase(), PADDING, y, '#6B7280', 2);
    y += 22;
    const entries = listTokens(palette).filter((t) => t.groupId === group.id);
    entries.forEach((entry, index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = PADDING + col * (CHIP_W + GAP);
      const chipY = y + row * (CHIP_H + 44) + 10;
      fillRect(fb, x, chipY, CHIP_W, 84, entry.hex);
      const onChip = readableText(entry.hex);
      drawText(fb, entry.hex.replace('#', ''), x + 8, chipY + 10, onChip, 2);
      if (entry.locked) {
        drawText(fb, 'LOCKED', x + 8, chipY + 62, onChip, 1);
      }
      drawText(fb, entry.id, x + 2, chipY + 92, INK, 1);
      drawText(fb, entry.kind === 'base' ? 'BASE' : `RULE:${entry.rule}`, x + 2, chipY + 104, '#6B7280', 1);
      if (entry.locked) {
        drawText(fb, 'LOCKED', x + 2, chipY + 116, '#B45309', 1);
      }
    });
    y += Math.ceil(entries.length / 5) * (CHIP_H + 44) + 6;
  }

  drawText(fb, 'CHART SERIES', PADDING, y, '#6B7280', 2);
  y += 26;
  const series = getChartSeries(palette);
  const barW = 96;
  const maxBarH = 70;
  series.forEach((item, index) => {
    const x = PADDING + index * (barW + 24);
    const barH = maxBarH - index * 8;
    fillRect(fb, x, y + (maxBarH - barH), barW, barH, item.hex);
    drawText(fb, item.hex.replace('#', ''), x + 4, y + maxBarH + 8, INK, 1);
  });

  return fb;
}
