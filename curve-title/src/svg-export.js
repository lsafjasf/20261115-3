// Export laid-out glyphs as an SVG of editable outlines (<path>, no <text>).

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// layout: result of layoutTitle. fontAdapter: makeFontAdapter(font).
// Each glyph becomes a <path> transformed into place, so every outline
// stays individually editable in vector editors.
export function exportSVG(layout, fontAdapter, opts) {
  const {
    fontSize = 48,
    fill = '#1a1a2e',
    strokeWidth = 0, // 粗细: outline stroke in px (faux bold)
    stroke = null,   // defaults to fill
    width = 960,
    height = 360,
    showCurve = false,
    curvePathD = null,
  } = opts;
  const strokeColor = stroke || fill;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">`
  );
  if (showCurve && curvePathD) {
    parts.push(
      `  <path d="${curvePathD}" fill="none" stroke="#c0c8d8" ` +
      `stroke-width="1" stroke-dasharray="4 4"/>`
    );
  }

  layout.lines.forEach((line, li) => {
    parts.push(`  <g id="line-${li + 1}">`);
    for (const g of line.glyphs) {
      if (g.x === undefined) continue;
      // opentype paths are y-down in font units scaled to px at baseline.
      const d = fontAdapter.glyphPath(g.ch, 0, 0, fontSize).toPathData(2);
      const transform =
        `translate(${g.x.toFixed(2)} ${g.y.toFixed(2)}) rotate(${g.angle.toFixed(2)})`;
      const strokeAttr = strokeWidth > 0
        ? ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"`
        : '';
      parts.push(
        `    <path data-ch="${esc(g.ch)}" transform="${transform}" ` +
        `d="${d}" fill="${fill}"${strokeAttr}/>`
      );
    }
    parts.push('  </g>');
  });
  parts.push('</svg>');
  return parts.join('\n');
}
