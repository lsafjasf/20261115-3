import {
  WORLD,
  borders,
  cities,
  contours,
  forestClusters,
  forestTrees,
  lakes,
  lands,
  mountains,
  regionLabels,
  rivers,
  seaLabels,
  settlements,
  texturedTufts,
} from "./map-data.js";

const SVG_WIDTH = WORLD.width;
const SVG_HEIGHT = WORLD.height;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pathData(points, closed = true) {
  if (!points.length) return "";
  const commands = points.map(
    (point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
  );
  if (closed) commands.push("Z");
  return commands.join(" ");
}

function circle(cx, cy, radius, attributes = "") {
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius}" ${attributes}/>`;
}

function buildDefs() {
  const landClipPaths = lands
    .map((land) => `<path d="${pathData(land.points)}"/>`)
    .join("");
  return `
    <defs>
      <linearGradient id="oceanGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7ea9ad"/>
        <stop offset="0.48" stop-color="#90b8b9"/>
        <stop offset="1" stop-color="#6e9aa0"/>
      </linearGradient>
      <linearGradient id="landGradient" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#e7e1cd"/>
        <stop offset="0.52" stop-color="#ddd6c0"/>
        <stop offset="1" stop-color="#d7cbb0"/>
      </linearGradient>
      <pattern id="oceanHatch" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
        <path d="M0 13H26" stroke="#e4eee8" stroke-opacity="0.1" stroke-width="1"/>
        <path d="M0 24H26" stroke="#3d7378" stroke-opacity="0.08" stroke-width="1"/>
      </pattern>
      <pattern id="graticule" width="240" height="220" patternUnits="userSpaceOnUse">
        <path d="M240 0V220M0 220H240" fill="none" stroke="#214e48" stroke-opacity="0.11" stroke-width="1" stroke-dasharray="2 8"/>
      </pattern>
      <clipPath id="landClip">${landClipPaths}</clipPath>
      <filter id="labelShadow" x="-20%" y="-30%" width="140%" height="170%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#173b34" flood-opacity="0.18"/>
      </filter>
      <style>
        .mono { font-family: "Ubuntu Mono", "DejaVu Sans Mono", monospace; }
        .sans { font-family: "Noto Sans SC", "Noto Sans CJK SC", sans-serif; }
      </style>
    </defs>`;
}

function buildBackground() {
  return `
    <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#oceanGradient)"/>
    <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#oceanHatch)"/>
    <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#graticule)"/>
    <g class="mono" fill="#1e544e" fill-opacity="0.36" font-size="9">
      ${Array.from({ length: 6 }, (_, index) => {
        const x = 240 + index * 480;
        return `<text x="${x}" y="${SVG_HEIGHT - 18}" text-anchor="middle">${18 + Math.round(x / 120)}°E</text>`;
      }).join("")}
      ${Array.from({ length: 4 }, (_, index) => {
        const y = 180 + index * 440;
        return `<text x="18" y="${y}">${46 - Math.round(y / 160)}°N</text>`;
      }).join("")}
    </g>`;
}

function buildCoastUnderlay() {
  return lands
    .map(
      (land) => `
        <path d="${pathData(land.underlay)}" fill="none" stroke="#e4eee4" stroke-opacity="0.28" stroke-width="19"/>
        <path d="${pathData(land.underlay)}" fill="none" stroke="#3d7375" stroke-opacity="0.13" stroke-width="1"/>`,
    )
    .join("");
}

function buildLand() {
  const shapes = lands
    .map(
      (land) =>
        `<path d="${pathData(land.points)}" fill="${land.id === "mainland" ? "url(#landGradient)" : land.fill}"/>`,
    )
    .join("");
  return `
    <g id="land">${shapes}</g>
    <g clip-path="url(#landClip)">
      ${texturedTufts
        .map((tuft) => circle(tuft.x, tuft.y, 1.25, 'fill="#526b57" fill-opacity="0.12"'))
        .join("")}
    </g>`;
}

function buildContours() {
  return contours
    .map(
      (contour) =>
        `<path d="${pathData(contour.points)}" fill="none" stroke="#7f785d" stroke-opacity="0.28" stroke-width="1"/>`,
    )
    .join("");
}

function buildWater() {
  const riverPaths = rivers
    .map(
      (river) => `
        <path d="${pathData(river.points, false)}" fill="none" stroke="#dce9df" stroke-opacity="0.6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${pathData(river.points, false)}" fill="none" stroke="#5d9098" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  const lakePaths = lakes
    .map(
      (lake) =>
        `<path d="${pathData(lake.points)}" fill="#8eb0b0" stroke="#5d9098" stroke-width="1.2"/>`,
    )
    .join("");
  return riverPaths + lakePaths;
}

function buildForests() {
  return forestClusters
    .flatMap((cluster) =>
      forestTrees(cluster).map(
        (tree) => `
          ${circle(tree.x, tree.y, tree.r, 'fill="#5c7e5e" fill-opacity="0.34"')}
          <path d="M${tree.x} ${tree.y + tree.r * 0.8}V${tree.y - tree.r * 0.3}" stroke="#3d6645" stroke-opacity="0.4" stroke-width="0.8"/>`,
      ),
    )
    .join("");
}

function buildMountains() {
  return mountains
    .map((mountain) => {
      const size = mountain.size;
      const path = [
        `M${mountain.x - size} ${mountain.y + size * 0.48}`,
        `L${mountain.x - size * 0.24} ${mountain.y - size * 0.62}`,
        `L${mountain.x + size * 0.08} ${mountain.y - size * 0.15}`,
        `L${mountain.x + size * 0.34} ${mountain.y - size * 0.5}`,
        `L${mountain.x + size} ${mountain.y + size * 0.48}Z`,
      ].join(" ");
      return `
        <path d="${path}" fill="#6b634d" fill-opacity="0.12" stroke="#4c5242" stroke-opacity="0.52" stroke-width="0.9"/>
        <path d="M${mountain.x - size * 0.24} ${mountain.y - size * 0.62}L${mountain.x - size * 0.02} ${mountain.y - size * 0.03}L${mountain.x + size * 0.08} ${mountain.y - size * 0.15}" fill="none" stroke="#4c5242" stroke-opacity="0.5" stroke-width="0.8"/>`;
    })
    .join("");
}

function buildBorders() {
  return borders
    .map(
      (border) => `
        <path d="${pathData(border.points, false)}" fill="none" stroke="#f5edda" stroke-opacity="0.8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${pathData(border.points, false)}" fill="none" stroke="#a9523b" stroke-width="1.5" stroke-dasharray="7 4" stroke-linecap="round" stroke-linejoin="round"/>
        ${border.points
          .filter((_, index) => index > 0 && index % 2 === 0)
          .map((point) => circle(point.x, point.y, 2, 'fill="#a04f39"'))
          .join("")}`,
    )
    .join("");
}

function buildCoastline() {
  return lands
    .map(
      (land) => `
        <path d="${pathData(land.points)}" fill="none" stroke="#faf6e9" stroke-opacity="0.8" stroke-width="3.4"/>
        <path d="${pathData(land.points)}" fill="none" stroke="#183d37" stroke-width="1.35" stroke-linejoin="round"/>`,
    )
    .join("");
}

function buildMapTypography() {
  const seas = seaLabels
    .map(
      (label) => `
        <text x="${label.x}" y="${label.y}" fill="#eff4e8" fill-opacity="0.48" font-family="Noto Sans SC, sans-serif" font-size="${label.size}" font-style="italic" letter-spacing="${label.size * 0.25}" text-anchor="middle" transform="rotate(${label.rotate} ${label.x} ${label.y})">${escapeXml(label.text)}</text>`,
    )
    .join("");
  const regions = regionLabels
    .map(
      (label) => `
        <text x="${label.x}" y="${label.y}" fill="#445446" fill-opacity="0.25" font-family="Noto Sans SC, sans-serif" font-size="21" font-weight="600" letter-spacing="8" text-anchor="middle" transform="rotate(${label.rotate} ${label.x} ${label.y})">${escapeXml(label.text)}</text>`,
    )
    .join("");
  return seas + regions;
}

function buildSettlements() {
  return settlements
    .map((settlement) => circle(settlement.x, settlement.y, settlement.r, 'fill="#374a3f" fill-opacity="0.58"'))
    .join("");
}

function nearestBoxPoint(box, anchor) {
  return {
    x: Math.max(box.x, Math.min(anchor.x, box.x + box.width)),
    y: Math.max(box.y, Math.min(anchor.y, box.y + box.height)),
  };
}

function buildCityLabels(labels, view, pinnedWorld, selectedId) {
  const scale = Math.max(0.0001, view.scale);
  return labels
    .filter((label) => !label.hidden)
    .map((label) => {
      const city = cities.find((item) => item.id === label.cityId);
      if (!city) return "";
      const pinned = Boolean(pinnedWorld[city.id]);
      const selected = city.id === selectedId;
      const width = label.box.width / scale;
      const height = label.box.height / scale;
      const x = label.worldX - width / 2;
      const y = label.worldY - height / 2;
      const box = { x, y, width, height };
      const point = nearestBoxPoint(box, city);
      const distance = Math.hypot(point.x - city.x, point.y - city.y);
      const fontSize = 13 / scale;
      const radius = 4.4 / scale;
      const leader = distance > 12 / scale
        ? `<path d="M${city.x} ${city.y}L${point.x} ${point.y}" fill="none" stroke="${pinned ? "#9b513d" : "#315d50"}" stroke-opacity="0.58" stroke-width="${0.9 / scale}" ${pinned ? 'stroke-dasharray="2 2"' : 'stroke-dasharray="3 3"'}/>`
        : "";
      const pinMark = pinned
        ? circle(x + 9.5 / scale, y + height / 2, 2.9 / scale, 'fill="#cf674a" stroke="#fff4e1" stroke-width="0.9"')
        : "";
      return `
        <g class="city-label" data-city="${escapeXml(city.id)}" data-pinned="${pinned}">
          ${leader}
          ${circle(city.x, city.y, radius, 'fill="#f4efde" stroke="#183d37" stroke-width="1.25"')}
          ${circle(city.x, city.y, 1.9 / scale, `fill="${selected ? "#cf674a" : "#183d37"}"`)}
          <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${3.5 / scale}" fill="#faf7ed" fill-opacity="0.96" stroke="${selected ? "#617d69" : pinned ? "#b7644b" : "#5d7163"}" stroke-width="${(selected ? 1.35 : 0.8) / scale}" filter="url(#labelShadow)"/>
          ${pinMark}
          <text x="${label.worldX + (pinned ? 4 / scale : 0)}" y="${label.worldY + 0.6 / scale}" text-anchor="middle" dominant-baseline="middle" fill="${pinned ? "#6f382d" : "#183d37"}" font-family="Noto Sans SC, sans-serif" font-size="${fontSize}" font-weight="${selected ? 700 : 600}" letter-spacing="${0.3 / scale}">${escapeXml(city.name)}</text>
        </g>`;
    })
    .join("");
}

function buildTitleBlock(labels, pinnedWorld) {
  return `
    <g id="title-block">
      <line x1="116" y1="1392" x2="174" y2="1392" stroke="#e9e5d5" stroke-opacity="0.66" stroke-width="1"/>
      <text x="116" y="1423" class="mono" fill="#e9e5d5" fill-opacity="0.66" font-size="10" letter-spacing="3">REGIONAL CARTOGRAPHY / SEED 475</text>
      <text x="114" y="1491" fill="#f4efe1" font-family="Noto Sans SC, sans-serif" font-size="38" font-weight="700" letter-spacing="7">北境区域图</text>
      <text x="117" y="1521" fill="#e9e5d5" fill-opacity="0.65" font-family="Noto Sans SC, sans-serif" font-size="10" letter-spacing="3">自动避让 · 手动固定 · 世界坐标</text>
      <g transform="translate(116 1560)">
        <rect width="260" height="52" rx="2" fill="#12332d" fill-opacity="0.58" stroke="#ece6d5" stroke-opacity="0.19"/>
        <circle cx="17" cy="18" r="3.4" fill="#cf674a"/>
        <text x="29" y="21" fill="#dce2d6" font-family="Noto Sans SC, sans-serif" font-size="9">固定标签 ${Object.keys(pinnedWorld).length} / ${labels.filter((label) => !label.hidden).length}</text>
        <line x1="16" y1="35" x2="244" y2="35" stroke="#e8e2d2" stroke-opacity="0.15"/>
        <text x="17" y="46" class="mono" fill="#aabeb2" font-size="7" letter-spacing="1">PINNED WORLD COORDINATES</text>
      </g>
    </g>
    <g transform="translate(112 92)">
      <circle cx="15" cy="15" r="14" fill="none" stroke="#f1ecde" stroke-opacity="0.6"/>
      <path d="M15 3.5 18.4 22 15 19.1 11.6 22Z" fill="#f1ecde" fill-opacity="0.8"/>
      <text x="0" y="43" class="mono" fill="#f1ecde" fill-opacity="0.64" font-size="8" letter-spacing="2">N</text>
    </g>`;
}

function buildFrame() {
  return `
    <rect x="18" y="18" width="${SVG_WIDTH - 36}" height="${SVG_HEIGHT - 36}" fill="none" stroke="#edf0e5" stroke-opacity="0.26"/>
    <rect x="25" y="25" width="${SVG_WIDTH - 50}" height="${SVG_HEIGHT - 50}" fill="none" stroke="#163f38" stroke-opacity="0.1"/>`;
}

export function buildSvg({ labels, view, pinnedWorld = {}, selectedId = null }) {
  const metadata = {
    title: "北境区域图",
    seed: 475,
    projection: "EPSG:3857",
    pinnedWorld: Object.fromEntries(
      Object.entries(pinnedWorld).map(([id, point]) => [
        id,
        { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) },
      ]),
    ),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-labelledby="mapTitle mapDesc">
  <title id="mapTitle">北境区域图 · 城市标签布局</title>
  <desc id="mapDesc">程序生成区域地图，包含海岸线、行政边界、城市与自动避让标签。</desc>
  <metadata>${escapeXml(JSON.stringify(metadata))}</metadata>
  ${buildDefs()}
  ${buildBackground()}
  ${buildCoastUnderlay()}
  ${buildLand()}
  <g id="contours">${buildContours()}</g>
  <g id="forests">${buildForests()}</g>
  <g id="water">${buildWater()}</g>
  <g id="mountains">${buildMountains()}</g>
  <g id="borders">${buildBorders()}</g>
  <g id="coastline">${buildCoastline()}</g>
  <g id="map-typography">${buildMapTypography()}</g>
  <g id="settlements">${buildSettlements()}</g>
  <g id="city-labels">${buildCityLabels(labels, view, pinnedWorld, selectedId)}</g>
  ${buildTitleBlock(labels, pinnedWorld)}
  ${buildFrame()}
</svg>`;
}

export function downloadSvg(svg, filename = "north-reach-labels.svg") {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
