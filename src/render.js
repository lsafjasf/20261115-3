import { dataBounds } from './viewTransform.js';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function polylinePoints(points) {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

/** Arrowhead triangle whose tip is exactly `tip`, aimed at `from`. */
function arrowHead(tip, from, size) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  const p1 = [tip[0] + size * Math.cos(a1), tip[1] + size * Math.sin(a1)];
  const p2 = [tip[0] + size * Math.cos(a2), tip[1] + size * Math.sin(a2)];
  return `${polylinePoints([tip, p1, p2])} ${tip[0]},${tip[1]}`;
}

function gridLines(view, bounds) {
  const lines = [];
  for (let x = Math.ceil(bounds.minX); x <= Math.floor(bounds.maxX); x += 1) {
    const [sx] = view.toScreen([x, 0]);
    lines.push(`<line x1="${sx.toFixed(1)}" y1="0" x2="${sx.toFixed(1)}" y2="${view.height}" class="grid"/>`);
  }
  for (let y = Math.ceil(bounds.minY); y <= Math.floor(bounds.maxY); y += 5) {
    const [, sy] = view.toScreen([0, y]);
    lines.push(`<line x1="0" y1="${sy.toFixed(1)}" x2="${view.width}" y2="${sy.toFixed(1)}" class="grid"/>`);
  }
  return lines.join('');
}

function axisLabels(view, bounds) {
  const out = [];
  for (let x = Math.ceil(bounds.minX); x <= Math.floor(bounds.maxX); x += 2) {
    const [sx, sy] = view.toScreen([x, bounds.minY]);
    out.push(`<text x="${sx.toFixed(1)}" y="${Math.min(sy + 16, view.height - 4).toFixed(1)}" class="axis" text-anchor="middle">${x}</text>`);
  }
  for (let y = Math.ceil(bounds.minY); y <= Math.floor(bounds.maxY); y += 10) {
    const [sx, sy] = view.toScreen([bounds.minX, y]);
    out.push(`<text x="${Math.max(sx - 8, 4).toFixed(1)}" y="${(sy + 4).toFixed(1)}" class="axis" text-anchor="end">${y}</text>`);
  }
  return out.join('');
}

/**
 * Render chart + laid-out annotations to a standalone SVG string.
 * @param {Array} series data points [[x,y], ...]
 * @param {object} layoutResult output of layoutAnnotations()
 * @param {ViewTransform} view
 */
export function renderSvg(series, layoutResult, view) {
  const bounds = dataBounds(series);
  const screenPoints = series.map((p) => view.toScreen(p));
  const line = polylinePoints(screenPoints);
  const dots = screenPoints
    .map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" class="dot"/>`)
    .join('');

  const regions = layoutResult.items
    .filter((item) => item.type === 'region')
    .map((item) => {
      const r = item.regionRect;
      return `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${item.color ?? '#2da44e'}" fill-opacity="0.14" stroke="${item.color ?? '#2da44e'}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    })
    .join('');

  const connectors = layoutResult.items
    .map((item) => {
      if (item.type === 'region') return '';
      const [sx, sy] = item.connectorStart;
      const [ax, ay] = item.anchorScreen;
      if (Math.hypot(ax - sx, ay - sy) < 4) return '';
      const color = item.color ?? '#1f6feb';
      const head =
        item.type === 'arrow'
          ? `<polygon points="${arrowHead(item.anchorScreen, item.connectorStart, 9)}" fill="${color}"/>`
          : `<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="3" fill="${color}"/>`;
      return `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${ax.toFixed(2)}" y2="${ay.toFixed(2)}" stroke="${color}" stroke-width="1.8"/>${head}`;
    })
    .join('');

  const labels = layoutResult.items
    .map((item) => {
      const r = item.labelRect;
      const color = item.color ?? '#1f6feb';
      return `<g class="label"><rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w}" height="${r.h}" rx="6" fill="white" stroke="${color}" stroke-width="1.4"/><text x="${(r.x + r.w / 2).toFixed(1)}" y="${(r.y + r.h / 2 + 4).toFixed(1)}" text-anchor="middle" class="label-text" fill="${color}">${escapeXml(item.text)}</text></g>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}" viewBox="0 0 ${view.width} ${view.height}">
<style>
.grid{stroke:#e3e7ee;stroke-width:1}
.axis{font:12px 'Noto Sans SC',sans-serif;fill:#57606a}
.dot{fill:#0969da}
.label-text{font:600 12px 'Noto Sans SC',sans-serif}
</style>
<rect width="100%" height="100%" fill="#ffffff"/>
${gridLines(view, bounds)}
<polyline points="${line}" fill="none" stroke="#0969da" stroke-width="2.2"/>
${dots}
${regions}
${connectors}
${axisLabels(view, bounds)}
${labels}
</svg>`;
}

export function downloadSvg(svg, filename = 'chart.svg') {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(URL.createObjectURL(blob), filename);
}

function triggerDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
