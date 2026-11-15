import { FAULT, sampleSection } from "./model.js";
import { buildSectionFigure, layerPolygon } from "./section-figure.js";
import { shade } from "./projection.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
const pointsPath = (points) => points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
const pathData = (points) => `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")} Z`;

export function buildSectionSVG(layers, cut, options = {}) {
  const width = options.width ?? 1000;
  const height = options.height ?? 700;
  const embeddedFont = options.fontDataUrl
    ? `@font-face { font-family: 'Noto Sans SC'; src: url("${options.fontDataUrl}") format('woff2'); font-weight: 400 700; }`
    : "";
  const section = sampleSection(layers, cut, 180);
  const figure = buildSectionFigure(section, layers, width, height);
  const title = `A—A′ 地质剖面 · 方位 ${Math.round(cut.angleDeg)}°`;
  const patterns = buildPatterns(layers);
  const layerEls = figure.layerFigures.map((layerFigure, index) => {
    const d = pathData(layerPolygon(layerFigure));
    const layer = layers[index];
    const labels = layerFigure.labels.map((label) =>
      `<text x="${label.x.toFixed(1)}" y="${(label.y + 3).toFixed(1)}" class="layer-code">${layer.id}</text>`).join("");
    return [
      `<path d="${d}" fill="${layer.color}" />`,
      `<path d="${d}" fill="url(#pattern-${layer.id})" opacity="0.34" />`,
      `<path d="${d}" fill="none" stroke="#1f2b2e" stroke-opacity="0.32" stroke-width="0.7" />`,
      labels,
    ].join("");
  }).join("\n      ");

  const grid = [
    ...figure.yTicks.filter((tick) => tick.value > 0).map((tick) =>
      `<line x1="${figure.plot.x}" y1="${tick.y.toFixed(1)}" x2="${figure.plot.x + figure.plot.width}" y2="${tick.y.toFixed(1)}" class="grid" />`),
    ...figure.xTicks.filter((tick) => tick.value > 0).map((tick) =>
      `<line x1="${tick.x.toFixed(1)}" y1="${figure.plot.y}" x2="${tick.x.toFixed(1)}" y2="${figure.plot.y + figure.plot.height}" class="grid" />`),
  ].join("");
  const yAxis = figure.yTicks.map((tick) =>
    `<text x="${figure.plot.x - 8}" y="${(tick.y + 3).toFixed(1)}" text-anchor="end" class="axis">${tick.value === 0 ? "0 m" : `${Math.round(tick.value)} m`}</text>`).join("");
  const xAxis = figure.xTicks.map((tick) =>
    `<text x="${tick.x.toFixed(1)}" y="${(figure.plot.y + figure.plot.height + 16).toFixed(1)}" text-anchor="middle" class="axis">${tick.value.toFixed(tick.value % 1 ? 1 : 0)}</text>`).join("");
  const fault = figure.fault ? faultSvg(figure) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <desc>程序化生成的 ${layers.length} 层岩性剖面。层序 L1 → L${layers.length}，${FAULT.label} 断层落差 ${FAULT.throwMeters} m。</desc>
  <defs>
    ${patterns}
    <style>
      ${embeddedFont}
      .axis { fill: #6c7a7d; font: 10px 'SFMono-Regular', 'Roboto Mono', 'Noto Sans SC', monospace; }
      .grid { stroke: #3a4b4d; stroke-opacity: .13; stroke-width: 1; }
      .boundary { stroke: #233033; stroke-opacity: .5; stroke-width: 1; fill: none; }
      .layer-code { fill: #1f2b2e; fill-opacity: .62; font: 600 8px 'SFMono-Regular', 'Noto Sans SC', sans-serif; text-anchor: middle; }
      .sans { fill: #253038; font: 500 11px 'Noto Sans SC', sans-serif; }
      .mono { fill: #647276; font: 9px 'SFMono-Regular', 'Roboto Mono', 'Noto Sans SC', monospace; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#e8e1d1" />
  <rect width="${width}" height="${height}" fill="url(#paper-grain)" opacity=".6" />
  <text x="${figure.plot.x + 75}" y="24" class="sans">${escapeXml(title)}</text>
  <text x="${width - 24}" y="24" text-anchor="end" class="mono">LITHOSLICE · ${figure.verticalExaggeration.toFixed(1)}× V.E.</text>
  ${grid}
  ${figure.fault ? `<rect x="${(figure.fault.x - 7).toFixed(1)}" y="${figure.plot.y}" width="14" height="${figure.plot.height}" fill="#bf503f" opacity=".08" />` : ""}
  <g>
      ${layerEls}
  </g>
  ${boundarySvg(figure)}
  ${fault}
  <line x1="${figure.plot.x}" y1="${figure.plot.y}" x2="${figure.plot.x}" y2="${figure.plot.y + figure.plot.height}" stroke="#253038" stroke-opacity=".66" />
  <line x1="${figure.plot.x}" y1="${figure.plot.y + figure.plot.height}" x2="${figure.plot.x + figure.plot.width}" y2="${figure.plot.y + figure.plot.height}" stroke="#253038" stroke-opacity=".66" />
  ${yAxis}
  ${xAxis}
  <text x="${figure.plot.x + figure.plot.width}" y="${figure.plot.y + figure.plot.height + 31}" text-anchor="end" class="axis">km</text>
  <text transform="translate(16 ${(figure.plot.y + figure.plot.height / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" class="sans">高程 / m</text>
  ${stationsSvg(figure)}
  ${scaleSvg(figure)}
  <text x="${figure.plot.x}" y="${height - 10}" class="mono">剖面长 ${figure.section.sectionLengthKm.toFixed(2)} km · 平均地层厚度 ${figure.section.meanThicknessMeters.toFixed(0)} m · 层序 L1→L${layers.length}</text>
  <text x="${width - 24}" y="${height - 10}" text-anchor="end" class="mono">EXPORTED FROM LITHOSLICE</text>
</svg>`;
}

function boundarySvg(figure) {
  const boundaries = figure.layerFigures.slice(0, -1).map((layerFigure) =>
    `<polyline points="${pointsPath(layerFigure.top)}" class="boundary" />`).join("");
  return `${boundaries}<polyline points="${pointsPath(figure.topPath)}" fill="none" stroke="#303c3b" stroke-width="1.8" />`;
}

function faultSvg(figure) {
  const fault = figure.fault;
  const upper = Math.min(fault.topLeft, fault.topRight);
  const lower = Math.max(fault.topLeft, fault.topRight);
  const arrowX = fault.x + 36;
  return `<g>
    <line x1="${fault.x.toFixed(1)}" y1="${fault.top.toFixed(1)}" x2="${fault.x.toFixed(1)}" y2="${(figure.plot.y + figure.plot.height).toFixed(1)}" stroke="#bf503f" stroke-width="1.3" stroke-dasharray="5 4" />
    <text x="${(fault.x - 18).toFixed(1)}" y="${figure.plot.y + 15}" text-anchor="end" class="sans" fill="#8c4033">西盘 ↑</text>
    <text x="${(fault.x + 18).toFixed(1)}" y="${figure.plot.y + 15}" class="sans" fill="#8c4033">东盘 ↓</text>
    <line x1="${arrowX}" y1="${upper.toFixed(1)}" x2="${arrowX}" y2="${lower.toFixed(1)}" stroke="#7e382b" stroke-width=".9" />
    <rect x="${(arrowX + 5).toFixed(1)}" y="${((upper + lower) / 2 - 7).toFixed(1)}" width="55" height="14" fill="#eee7d8" stroke="#bf503f" stroke-opacity=".38" rx="1.5" />
    <text x="${(arrowX + 10).toFixed(1)}" y="${((upper + lower) / 2 + 3).toFixed(1)}" class="layer-code" fill="#bf503f">F₁ ${Math.round(fault.throwMeters)} m</text>
  </g>`;
}

function stationsSvg(figure) {
  const { plot, topPath } = figure;
  const right = topPath[topPath.length - 1];
  return `<g>
    <circle cx="${plot.x}" cy="${plot.y - 13}" r="10" fill="#ddd4c0" stroke="#2e393a" stroke-width=".7" />
    <text x="${plot.x}" y="${plot.y - 9.5}" text-anchor="middle" class="sans">A</text>
    <circle cx="${right.x.toFixed(1)}" cy="${plot.y - 13}" r="10" fill="#ddd4c0" stroke="#2e393a" stroke-width=".7" />
    <text x="${right.x.toFixed(1)}" y="${plot.y - 9.5}" text-anchor="middle" class="sans">A′</text>
    <line x1="${plot.x + 12}" y1="${plot.y - 13}" x2="${plot.x + 39}" y2="${plot.y - 13}" stroke="#293436" stroke-opacity=".56" />
  </g>`;
}

function scaleSvg(figure) {
  const { plot } = figure;
  const scaleKm = figure.section.sectionLengthKm > 8 ? 2 : 1;
  const width = scaleKm * figure.xScale;
  const x = plot.x;
  const y = plot.y + plot.height + 34;
  return `<g>
    <line x1="${x.toFixed(1)}" y1="${y}" x2="${(x + width).toFixed(1)}" y2="${y}" stroke="#364243" stroke-opacity=".68" />
    <line x1="${x.toFixed(1)}" y1="${y - 3}" x2="${x.toFixed(1)}" y2="${y + 3}" stroke="#364243" stroke-opacity=".68" />
    <line x1="${(x + width).toFixed(1)}" y1="${y - 3}" x2="${(x + width).toFixed(1)}" y2="${y + 3}" stroke="#364243" stroke-opacity=".68" />
    <text x="${(x + width + 6).toFixed(1)}" y="${y + 3}" class="mono">${scaleKm} km</text>
  </g>`;
}

function buildPatterns(layers) {
  const grain = `<pattern id="paper-grain" width="37" height="29" patternUnits="userSpaceOnUse">
      <circle cx="7" cy="5" r=".55" fill="#5c5240" opacity=".18" />
      <circle cx="29" cy="18" r=".45" fill="#5c5240" opacity=".14" />
    </pattern>`;
  const layerPatterns = layers.map((layer) => {
    const dark = shade(layer.color, -48);
    if (layer.pattern === "sand" || layer.pattern === "soil") {
      const gap = layer.pattern === "soil" ? 18 : 13;
      return `<pattern id="pattern-${layer.id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">
        <circle cx="${gap * 0.32}" cy="${gap * 0.34}" r=".75" fill="${dark}" />
        <circle cx="${gap * 0.73}" cy="${gap * 0.7}" r=".62" fill="${dark}" />
      </pattern>`;
    }
    if (layer.pattern === "brick") {
      return `<pattern id="pattern-${layer.id}" width="26" height="14" patternUnits="userSpaceOnUse">
        <path d="M0 0H26M0 14H26M0 0V14M13 0V7M0 7H13M26 7V14" fill="none" stroke="${dark}" stroke-width=".6" />
      </pattern>`;
    }
    if (layer.pattern === "shale") {
      return `<pattern id="pattern-${layer.id}" width="22" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 2H11M14 6H22" fill="none" stroke="${dark}" stroke-width=".65" />
      </pattern>`;
    }
    if (layer.pattern === "gneiss") {
      return `<pattern id="pattern-${layer.id}" width="31" height="13" patternUnits="userSpaceOnUse">
        <path d="M0 4C5 1 9 7 14 4S25 1 31 4M0 10C7 7 12 13 18 10S25 7 31 10" fill="none" stroke="${dark}" stroke-width=".65" />
      </pattern>`;
    }
    return `<pattern id="pattern-${layer.id}" width="18" height="12" patternUnits="userSpaceOnUse">
      <path d="M2 3L7 7M11 8L16 10" fill="none" stroke="${dark}" stroke-width=".68" />
    </pattern>`;
  }).join("\n    ");
  return `${grain}\n    ${layerPatterns}`;
}

