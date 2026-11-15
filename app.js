import {
  HOLES,
  binnedColor,
  buildField,
  colorRgbAt,
  contourColor,
  contourLegendColor,
  contourLevels,
  hexToRgb,
  makeSampleData,
  sampleDomain,
  traceAllContours
} from "./heatmap-core.js";

const DEFAULTS = {
  bandwidthA: 18,
  bandwidthB: 36,
  levels: 9,
  interval: 4,
  showPoints: true,
  showContours: true,
  mode: "compare"
};

const state = {
  ...DEFAULTS,
  samples: makeSampleData(118),
  domain: [0, 1],
  dirty: new Set(["a", "b"]),
  raf: 0,
  activeProbe: null
};

state.domain = sampleDomain(state.samples, 1.4);

const $ = (selector) => document.querySelector(selector);
const pads = (value, digits = 1) => Number(value).toFixed(digits);

const ui = {
  stage: $("#map-stage"),
  compareView: $("#compare-view"),
  singleView: $("#single-view"),
  mapTitle: $("#map-title-text"),
  mapSubtitle: $("#map-subtitle"),
  bandwidthA: $("#bandwidth-a"),
  bandwidthB: $("#bandwidth-b"),
  bandwidthAValue: $("#bandwidth-a-value"),
  bandwidthBValue: $("#bandwidth-b-value"),
  bandwidthSummary: $("#bandwidth-summary"),
  frameBandwidthA: $("#frame-bandwidth-a"),
  frameBandwidthB: $("#frame-bandwidth-b"),
  levelControl: $("#level-control"),
  intervalRange: $("#interval-range"),
  intervalValue: $("#interval-value"),
  pointsToggle: $("#points-toggle"),
  contourToggle: $("#contour-toggle"),
  colorScale: $("#color-scale"),
  scaleMin: $("#scale-min"),
  scaleMid: $("#scale-mid"),
  scaleMax: $("#scale-max"),
  scaleLevelLabel: $("#scale-level-label"),
  contourLegend: $("#contour-legend"),
  legendVerify: $("#legend-verify"),
  probeCard: $("#probe-card"),
  probeStatus: $("#probe-status"),
  probeValue: $("#probe-value"),
  probeError: $("#probe-error"),
  probeDistance: $("#probe-distance"),
  probeX: $("#probe-x"),
  probeY: $("#probe-y"),
  probeNote: $("#probe-note"),
  coverageStat: $("#coverage-stat"),
  contourStat: $("#contour-stat"),
  errorStat: $("#error-stat"),
  insightText: $("#insight-text"),
  insightChip: $("#insight-chip"),
  sampleCountMeta: $("#sample-count-meta"),
  dataSamples: $("#data-samples"),
  dataRange: $("#data-range"),
  dataHoles: $("#data-holes"),
  exportButton: $("#export-button"),
  resetButton: $("#reset-button"),
  toast: $("#toast")
};

function setupPanel(group) {
  const frame = document.querySelector(`[data-map="${group}"]`);
  const surface = $(`#surface-${group}`);
  const overlay = $(`#overlay-${group}`);
  return {
    group,
    frame,
    surface,
    overlay,
    surfaceCtx: surface.getContext("2d"),
    overlayCtx: overlay.getContext("2d", { alpha: true }),
    tip: $(`#hover-tip-${group}`),
    empty: $(`#empty-${group}`),
    field: null,
    contours: [],
    hover: null,
    cssWidth: 0,
    cssHeight: 0,
    pixelWidth: 0,
    pixelHeight: 0
  };
}

const panels = {
  a: setupPanel("a"),
  b: setupPanel("b")
};

let toastTimer = 0;
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

function bandwidthFor(group) {
  return group === "a" ? state.bandwidthA : state.bandwidthB;
}

function visibleGroups() {
  return state.mode === "compare" ? ["a", "b"] : ["a"];
}

function syncControls() {
  ui.bandwidthA.value = state.bandwidthA;
  ui.bandwidthB.value = state.bandwidthB;
  ui.bandwidthAValue.textContent = state.bandwidthA;
  ui.bandwidthBValue.textContent = state.bandwidthB;
  ui.frameBandwidthA.textContent = state.bandwidthA;
  ui.frameBandwidthB.textContent = state.bandwidthB;
  ui.bandwidthSummary.textContent = `B 比 A 宽 ${Math.abs(state.bandwidthB - state.bandwidthA)} px`;
  ui.intervalRange.value = state.interval;
  ui.intervalValue.textContent = pads(state.interval, 1);
  ui.pointsToggle.checked = state.showPoints;
  ui.contourToggle.checked = state.showContours;
  ui.sampleCountMeta.textContent = `${state.samples.length} 个采样点`;
  ui.dataSamples.textContent = `${state.samples.length} 点`;
  ui.dataRange.textContent = `${pads(state.domain[0])} – ${pads(state.domain[1])}`;
  ui.dataHoles.textContent = `${HOLES.length} 处`;
  for (const button of ui.levelControl.querySelectorAll("button")) {
    button.classList.toggle("active", Number(button.dataset.value) === state.levels);
  }
  ui.compareView.classList.toggle("active", state.mode === "compare");
  ui.singleView.classList.toggle("active", state.mode === "single");
  ui.stage.classList.toggle("compare-mode", state.mode === "compare");
  ui.stage.classList.toggle("single-mode", state.mode === "single");
  panels.b.frame.classList.toggle("is-hidden", state.mode === "single");
  ui.mapTitle.textContent =
    state.mode === "compare" ? "带宽对比 · Gaussian kernel" : "单带宽热力面 · Gaussian kernel";
  ui.mapSubtitle.textContent =
    state.mode === "compare" ? "同一组实测采样点，仅改变核带宽" : `参数组 A · σ ${state.bandwidthA} px`;
}

function canvasDimensions(panel) {
  const rect = panel.frame.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return null;
  const area = rect.width * rect.height;
  const dpr = Math.min(1.75, window.devicePixelRatio || 1, Math.sqrt(1_350_000 / area));
  return {
    cssWidth: rect.width,
    cssHeight: rect.height,
    width: Math.max(80, Math.round(rect.width * dpr)),
    height: Math.max(80, Math.round(rect.height * dpr))
  };
}

function paintField(panel, field) {
  const ctx = panel.surfaceCtx;
  const { width, height, values, valid } = field;
  const image = ctx.createImageData(width, height);
  const pixels = image.data;
  const binColors = [];
  for (let index = 0; index < state.levels; index += 1) {
    binColors.push(colorRgbAt((index + 0.5) / state.levels));
  }
  const domainSpan = state.domain[1] - state.domain[0] || 1;

  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    if (!valid[index]) continue;
    let bin = Math.floor(((values[index] - state.domain[0]) / domainSpan) * state.levels);
    bin = Math.max(0, Math.min(state.levels - 1, bin));
    const color = binColors[bin];
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function drawHoleLabels(panel, ctx) {
  if (!panel.field) return;
  const { width, height, valid } = panel.field;
  ctx.save();
  ctx.font = '600 9px "Noto SC Local", "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const hole of HOLES) {
    const x = hole.x * width;
    const y = hole.y * height;
    const index = Math.max(0, Math.min(valid.length - 1, Math.floor(y) * width + Math.floor(x)));
    if (valid[index]) continue;
    const text = hole.label;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = textWidth + 16;
    const boxHeight = 19;
    ctx.fillStyle = "rgba(246, 243, 235, 0.8)";
    ctx.strokeStyle = "rgba(60, 78, 78, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.roundRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, 4);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(49, 65, 66, 0.75)";
    ctx.fillText(text, x, y + 0.5);
  }
  ctx.restore();
}

function drawSamples(panel, ctx) {
  if (!state.showPoints || !panel.field) return;
  const { width, height } = panel.field;
  const radius = Math.max(2.6, Math.min(4.2, width / 135));
  ctx.save();
  ctx.lineWidth = 1.15;
  ctx.strokeStyle = "rgba(27, 41, 49, 0.86)";
  ctx.fillStyle = "rgba(255, 252, 244, 0.96)";
  for (const sample of state.samples) {
    const x = sample.x * width;
    const y = sample.y * height;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.65, radius * 0.23), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(27, 41, 49, 0.72)";
    ctx.fill();
    ctx.fillStyle = "rgba(255, 252, 244, 0.96)";
  }
  ctx.restore();
}

function strokeContourSet(ctx, contours, colorMode, lineWidth, halo = false) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const contour of contours) {
    if (!contour.segments.length) continue;
    ctx.beginPath();
    for (let index = 0; index < contour.segments.length; index += 4) {
      ctx.moveTo(contour.segments[index], contour.segments[index + 1]);
      ctx.lineTo(contour.segments[index + 2], contour.segments[index + 3]);
    }
    ctx.strokeStyle = halo ? "rgba(22, 34, 40, 0.34)" : colorMode(contour.level);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrosshair(panel, ctx) {
  const hover = panel.hover;
  if (!hover || !panel.field) return;
  const x = hover.nx * panel.field.width;
  const y = hover.ny * panel.field.height;
  ctx.save();
  ctx.strokeStyle = hover.valid ? "rgba(255, 252, 244, 0.68)" : "rgba(45, 127, 130, 0.72)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, panel.field.height);
  ctx.moveTo(0, y);
  ctx.lineTo(panel.field.width, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.strokeStyle = hover.valid ? "rgba(27, 41, 49, 0.9)" : "rgba(45, 127, 130, 0.92)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = hover.valid ? "#fffaf0" : "#2d7f82";
  ctx.fill();
  ctx.restore();
}

function drawOverlay(panel) {
  if (!panel.field) return;
  const ctx = panel.overlayCtx;
  const { width, height } = panel.field;
  ctx.clearRect(0, 0, width, height);
  if (state.showContours) {
    strokeContourSet(ctx, panel.contours, (level) => contourColor(level, state.domain), 4, true);
    strokeContourSet(ctx, panel.contours, (level) => contourColor(level, state.domain), 2.1, false);
  }
  drawSamples(panel, ctx);
  drawHoleLabels(panel, ctx);
  drawCrosshair(panel, ctx);
}

function renderPanel(group) {
  const panel = panels[group];
  const dimensions = canvasDimensions(panel);
  if (!dimensions) return;
  panel.cssWidth = dimensions.cssWidth;
  panel.cssHeight = dimensions.cssHeight;
  panel.pixelWidth = dimensions.width;
  panel.pixelHeight = dimensions.height;
  if (panel.surface.width !== dimensions.width || panel.surface.height !== dimensions.height) {
    panel.surface.width = dimensions.width;
    panel.surface.height = dimensions.height;
    panel.overlay.width = dimensions.width;
    panel.overlay.height = dimensions.height;
  }

  const field = buildField(state.samples, dimensions.width, dimensions.height, bandwidthFor(group));
  const levels = contourLevels(state.domain[0], state.domain[1], state.interval);
  panel.field = field;
  panel.contours = state.showContours ? traceAllContours(field, levels) : [];
  paintField(panel, field);
  drawOverlay(panel);
}

function pixelFromPointer(panel, event) {
  const rect = panel.frame.getBoundingClientRect();
  const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return { nx, ny, localX: event.clientX - rect.left, localY: event.clientY - rect.top };
}

function readHover(panel, point) {
  const field = panel.field;
  if (!field) return null;
  const x = Math.min(field.width - 1, Math.floor(point.nx * field.width));
  const y = Math.min(field.height - 1, Math.floor(point.ny * field.height));
  const index = y * field.width + x;
  const isValid = Boolean(field.valid[index]);
  return {
    nx: point.nx,
    ny: point.ny,
    localX: point.localX,
    localY: point.localY,
    valid: isValid,
    value: isValid ? field.values[index] : null,
    error: isValid ? field.errors[index] : null,
    nearest: field.nearest[index]
  };
}

function updateTooltip(panel, hover) {
  const tip = panel.tip;
  if (!hover) {
    tip.hidden = true;
    return;
  }
  const groupLabel = panel.group.toUpperCase();
  if (hover.valid) {
    tip.classList.remove("in-hole");
    tip.innerHTML = `
      <div class="tip-top"><span>${groupLabel} · 插值读数</span><strong>${pads(hover.value, 1)}</strong></div>
      <div class="tip-row"><span>估算误差</span><strong>± ${pads(hover.error, 2)}</strong></div>
      <div class="tip-row"><span>坐标</span><span>${pads(hover.nx, 2)}, ${pads(hover.ny, 2)}</span></div>`;
  } else {
    tip.classList.add("in-hole");
    tip.innerHTML = `
      <div class="tip-top"><span>${groupLabel} · 采样空洞</span><strong>无插值</strong></div>
      <div class="tip-row"><span>覆盖距离</span><span>${pads(pixelDistance(panel, hover.nearest), 1)} px</span></div>
      <div class="tip-row"><span>等值线</span><span>已截断</span></div>`;
  }
  tip.hidden = false;
  const tipWidth = 146;
  const tipHeight = 68;
  let left = hover.localX + 14;
  let top = hover.localY + 13;
  if (left + tipWidth > panel.frame.clientWidth - 5) left = hover.localX - tipWidth - 12;
  if (top + tipHeight > panel.frame.clientHeight - 5) top = hover.localY - tipHeight - 12;
  tip.style.left = `${Math.max(5, left)}px`;
  tip.style.top = `${Math.max(5, top)}px`;
}

function pixelDistance(panel, distance) {
  return distance * (panel.cssWidth / panel.pixelWidth);
}

function updateProbe(panel, hover) {
  const groupLabel = panel.group.toUpperCase();
  if (!hover) {
    ui.probeStatus.textContent = "等待";
    ui.probeValue.textContent = "—";
    ui.probeError.textContent = "—";
    ui.probeDistance.textContent = "—";
    ui.probeX.textContent = "—";
    ui.probeY.textContent = "—";
    ui.probeNote.textContent = "将鼠标移到热力面上读取局部 LOO 误差。";
    ui.probeCard.classList.remove("is-empty");
    ui.probeCard.dataset.group = "";
    return;
  }
  state.activeProbe = panel.group;
  ui.probeCard.dataset.group = panel.group;
  ui.probeX.textContent = pads(hover.nx, 3);
  ui.probeY.textContent = pads(hover.ny, 3);
  ui.probeDistance.textContent = `${pads(pixelDistance(panel, hover.nearest), 1)} px`;
  if (hover.valid) {
    ui.probeStatus.textContent = `${groupLabel} · 有效`;
    ui.probeValue.textContent = pads(hover.value, 1);
    ui.probeError.textContent = `± ${pads(hover.error, 2)}`;
    ui.probeNote.textContent = `LOO 交叉验证误差估计 · Gaussian σ ${bandwidthFor(panel.group)} px`;
    ui.probeCard.classList.remove("is-empty");
  } else {
    ui.probeStatus.textContent = `${groupLabel} · 空洞`;
    ui.probeValue.textContent = "—";
    ui.probeError.textContent = "—";
    ui.probeNote.textContent = "该点超出有效采样覆盖，不执行插值，等值线在此截断。";
    ui.probeCard.classList.add("is-empty");
  }
}

function handlePointerMove(panel, event) {
  const point = pixelFromPointer(panel, event);
  const hover = readHover(panel, point);
  panel.hover = hover;
  updateTooltip(panel, hover);
  updateProbe(panel, hover);
  drawOverlay(panel);
}

function handlePointerLeave(panel) {
  panel.hover = null;
  updateTooltip(panel, null);
  updateProbe(panel, null);
  drawOverlay(panel);
}

function renderScale() {
  ui.colorScale.replaceChildren();
  for (let index = 0; index < state.levels; index += 1) {
    const value = state.domain[0] + ((index + 0.5) / state.levels) * (state.domain[1] - state.domain[0]);
    const swatch = document.createElement("span");
    swatch.style.backgroundColor = binnedColor(value, state.domain[0], state.domain[1], state.levels);
    swatch.title = `${pads(value, 1)} · 色阶 ${index + 1}`;
    ui.colorScale.append(swatch);
  }
  ui.scaleMin.textContent = pads(state.domain[0]);
  ui.scaleMid.textContent = pads((state.domain[0] + state.domain[1]) / 2);
  ui.scaleMax.textContent = pads(state.domain[1]);
  ui.scaleLevelLabel.textContent = `${state.levels} levels`;

  const levels = contourLevels(state.domain[0], state.domain[1], state.interval);
  ui.contourLegend.replaceChildren();
  for (const level of levels) {
    const row = document.createElement("div");
    row.className = "contour-legend-row";
    const stroke = document.createElement("span");
    stroke.className = "contour-legend-line";
    stroke.style.setProperty("--contour-color", contourLegendColor(level, state.domain));
    const value = document.createElement("strong");
    value.textContent = pads(level, 1);
    const gap = document.createElement("span");
    gap.textContent = `Δ ${pads(state.interval, 1)}`;
    row.append(stroke, value, gap);
    ui.contourLegend.append(row);
  }
  const matched = levels.filter(
    (level) => contourColor(level, state.domain) === contourLegendColor(level, state.domain)
  ).length;
  ui.legendVerify.innerHTML = `<span>✓</span> ${matched} / ${levels.length} · 线色与图例一致`;
}

function contourSegmentCount(panel) {
  return panel.contours.reduce((sum, contour) => sum + contour.segments.length / 4, 0);
}

function updateReadouts() {
  const visible = visibleGroups().map((group) => panels[group]);
  if (visible.some((panel) => !panel.field)) return;
  const coverageText = visible
    .map((panel) => `${panel.group.toUpperCase()} ${Math.round((panel.field.validCount / panel.field.values.length) * 100)}%`)
    .join(" · ");
  const segmentText = visible
    .map((panel) => `${panel.group.toUpperCase()} ${Math.round(contourSegmentCount(panel)).toLocaleString()}`)
    .join(" · ");
  const errorText = visible
    .map((panel) => `${panel.group.toUpperCase()} ±${pads(panel.field.rmse, 2)}`)
    .join(" · ");
  ui.coverageStat.textContent = coverageText;
  ui.contourStat.textContent = `${segmentText} 段`;
  ui.errorStat.textContent = errorText;

  const aSegments = panels.a.field ? contourSegmentCount(panels.a) : 0;
  const bSegments = panels.b.field ? contourSegmentCount(panels.b) : 0;
  if (state.mode === "compare" && aSegments > 0 && bSegments > 0) {
    const reduction = Math.round((1 - bSegments / aSegments) * 100);
    ui.insightText.textContent =
      reduction >= 0
        ? `A 生成 ${Math.round(aSegments).toLocaleString()} 个等值片段，B 为 ${Math.round(bSegments).toLocaleString()}。更宽带宽抹平局部噪声，使轮廓更连续。`
        : `B 的宽核扩大了有效覆盖，等值片段比 A 多 ${Math.abs(reduction)}%。`;
    ui.insightChip.textContent = `σ ${state.bandwidthA} → ${state.bandwidthB} px`;
  } else {
    ui.insightText.textContent = `单图模式 · σ ${state.bandwidthA} px，等值间距 ${pads(state.interval, 1)}。`;
    ui.insightChip.textContent = `A · ${state.levels} levels`;
  }
}

function scheduleRender(groups = visibleGroups()) {
  for (const group of groups) state.dirty.add(group);
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => {
    state.raf = 0;
    document.body.classList.add("is-rendering");
    for (const group of visibleGroups()) {
      if (!state.dirty.has(group)) continue;
      renderPanel(group);
    }
    state.dirty.clear();
    updateReadouts();
    document.body.classList.remove("is-rendering");
  });
}

function redrawOverlays() {
  for (const group of visibleGroups()) drawOverlay(panels[group]);
}

function bindPanelEvents() {
  for (const group of ["a", "b"]) {
    const panel = panels[group];
    panel.frame.addEventListener("pointermove", (event) => handlePointerMove(panel, event));
    panel.frame.addEventListener("pointerleave", () => handlePointerLeave(panel));
  }
}

function bindControls() {
  ui.bandwidthA.addEventListener("input", () => {
    state.bandwidthA = Number(ui.bandwidthA.value);
    syncControls();
    scheduleRender(["a"]);
  });
  ui.bandwidthB.addEventListener("input", () => {
    state.bandwidthB = Number(ui.bandwidthB.value);
    syncControls();
    scheduleRender(["b"]);
  });
  ui.levelControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    state.levels = Number(button.dataset.value);
    syncControls();
    renderScale();
    scheduleRender(["a", "b"]);
  });
  ui.intervalRange.addEventListener("input", () => {
    state.interval = Number(ui.intervalRange.value);
    syncControls();
    renderScale();
    scheduleRender(["a", "b"]);
  });
  ui.pointsToggle.addEventListener("change", () => {
    state.showPoints = ui.pointsToggle.checked;
    redrawOverlays();
  });
  ui.contourToggle.addEventListener("change", () => {
    state.showContours = ui.contourToggle.checked;
    scheduleRender(["a", "b"]);
  });
  ui.compareView.addEventListener("click", () => {
    state.mode = "compare";
    syncControls();
    requestAnimationFrame(() => scheduleRender(["a", "b"]));
  });
  ui.singleView.addEventListener("click", () => {
    state.mode = "single";
    syncControls();
    requestAnimationFrame(() => scheduleRender(["a"]));
  });
  ui.resetButton.addEventListener("click", () => {
    Object.assign(state, {
      bandwidthA: DEFAULTS.bandwidthA,
      bandwidthB: DEFAULTS.bandwidthB,
      levels: DEFAULTS.levels,
      interval: DEFAULTS.interval,
      showPoints: DEFAULTS.showPoints,
      showContours: DEFAULTS.showContours,
      mode: DEFAULTS.mode
    });
    syncControls();
    renderScale();
    scheduleRender(["a", "b"]);
    showToast("参数已恢复默认");
  });
  ui.exportButton.addEventListener("click", exportComposite);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function exportHatch(ctx, x, y, width, height) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 8);
  ctx.clip();
  ctx.fillStyle = "#ebe7dc";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(92, 98, 94, 0.1)";
  ctx.lineWidth = 1;
  for (let offset = -height; offset < width + height; offset += 11) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + height);
    ctx.lineTo(x + offset + height, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawExportMap(ctx, panel, x, y, width, height) {
  exportHatch(ctx, x, y, width, height);
  ctx.save();
  roundedRect(ctx, x, y, width, height, 8);
  ctx.clip();
  const sourceWidth = panel.surface.width;
  const sourceHeight = panel.surface.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(panel.surface, drawX, drawY, drawWidth, drawHeight);
  ctx.drawImage(panel.overlay, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(27, 41, 49, 0.18)";
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, width, height, 8);
  ctx.stroke();
  ctx.fillStyle = "rgba(22, 34, 40, 0.82)";
  roundedRect(ctx, x + 13, y + 13, 103, 27, 6);
  ctx.fill();
  ctx.fillStyle = "#fffaf0";
  ctx.font = '700 11px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(`${panel.group.toUpperCase()}  ·  σ ${bandwidthFor(panel.group)} px`, x + 23, y + 31);
  ctx.restore();
}

function drawExportLegend(ctx, x, y, width) {
  ctx.fillStyle = "#1b2931";
  ctx.font = '650 13px "Noto SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("色阶与等值线", x, y);
  ctx.fillStyle = "#7d878a";
  ctx.font = '9px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(`${state.levels} COLOR LEVELS`, x + width - 99, y);

  const barY = y + 17;
  const barWidth = width / state.levels;
  for (let index = 0; index < state.levels; index += 1) {
    const value =
      state.domain[0] + ((index + 0.5) / state.levels) * (state.domain[1] - state.domain[0]);
    ctx.fillStyle = binnedColor(value, state.domain[0], state.domain[1], state.levels);
    ctx.fillRect(x + index * barWidth, barY, barWidth + 0.5, 20);
  }
  ctx.strokeStyle = "rgba(27, 41, 49, 0.18)";
  ctx.strokeRect(x + 0.5, barY + 0.5, width - 1, 19);
  ctx.fillStyle = "#7d878a";
  ctx.font = '8px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(pads(state.domain[0]), x, barY + 33);
  ctx.fillText(pads((state.domain[0] + state.domain[1]) / 2), x + width / 2 - 8, barY + 33);
  ctx.fillText(pads(state.domain[1]), x + width - 20, barY + 33);

  ctx.fillStyle = "#1b2931";
  ctx.font = '650 11px "Noto SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("等值线", x, barY + 66);
  ctx.fillStyle = "#7d878a";
  ctx.font = '8px "SFMono-Regular", Consolas, monospace';
  ctx.fillText("SAME STROKE COLOR", x + width - 108, barY + 66);
  const levels = contourLevels(state.domain[0], state.domain[1], state.interval);
  levels.forEach((level, index) => {
    const rowY = barY + 86 + index * 22;
    if (rowY > y + 335) return;
    ctx.strokeStyle = contourLegendColor(level, state.domain);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, rowY);
    ctx.lineTo(x + 34, rowY);
    ctx.stroke();
    ctx.fillStyle = "#39474e";
    ctx.font = '9px "SFMono-Regular", Consolas, monospace';
    ctx.fillText(pads(level, 1), x + 43, rowY + 3);
    ctx.fillStyle = "#7d878a";
    ctx.fillText(`Δ ${pads(state.interval, 1)}`, x + width - 30, rowY + 3);
  });
}

function exportComposite() {
  const activePanels = visibleGroups().map((group) => panels[group]);
  if (activePanels.some((panel) => !panel.field || !panel.surface.width)) {
    showToast("正在准备热力面，请稍后导出");
    return;
  }

  const logicalWidth = 1800;
  const logicalHeight = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * 2;
  canvas.height = logicalHeight * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  ctx.fillStyle = "#f2efe7";
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  ctx.fillStyle = "rgba(216, 102, 71, 0.08)";
  ctx.beginPath();
  ctx.arc(1680, 20, 290, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#b84b32";
  ctx.font = '700 10px "SFMono-Regular", Consolas, monospace';
  ctx.fillText("HOTFIELD LAB  /  EXPORT 01", 68, 48);
  ctx.fillStyle = "#1b2931";
  ctx.font = '650 34px "Noto SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(
    state.mode === "compare" ? "插值热力面 · 带宽对比" : "插值热力面 · 单图",
    68,
    91
  );
  ctx.fillStyle = "#7d878a";
  ctx.font = '11px "Noto SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("Gaussian Nadaraya–Watson  /  覆盖掩膜  /  Marching Squares", 68, 116);

  ctx.textAlign = "right";
  ctx.fillStyle = "#1b2931";
  ctx.font = '600 12px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(
    state.mode === "compare"
      ? `σ A ${state.bandwidthA} px   /   σ B ${state.bandwidthB} px`
      : `σ A ${state.bandwidthA} px`,
    1732,
    68
  );
  ctx.fillStyle = "#7d878a";
  ctx.font = '9px "SFMono-Regular", Consolas, monospace';
  const date = new Date().toLocaleDateString("zh-CN").replaceAll("/", ".");
  ctx.fillText(`${date}  ·  ${state.samples.length} SAMPLES  ·  Δ ${pads(state.interval, 1)}`, 1732, 91);
  ctx.textAlign = "left";

  const mapY = 162;
  const mapHeight = 650;
  if (state.mode === "compare") {
    drawExportMap(ctx, panels.a, 68, mapY, 682, mapHeight);
    drawExportMap(ctx, panels.b, 774, mapY, 682, mapHeight);
    drawExportLegend(ctx, 1480, mapY + 8, 252);
  } else {
    drawExportMap(ctx, panels.a, 68, mapY, 1240, mapHeight);
    drawExportLegend(ctx, 1332, mapY + 8, 400);
  }

  ctx.fillStyle = "rgba(27, 41, 49, 0.1)";
  ctx.fillRect(68, 846, 1664, 1);
  ctx.fillStyle = "#7d878a";
  ctx.font = '8px "SFMono-Regular", Consolas, monospace';
  ctx.fillText("COVERAGE", 68, 876);
  ctx.fillText("CONTOUR SEGMENTS", 300, 876);
  ctx.fillText("LOO RMSE", 688, 876);
  ctx.fillStyle = "#1b2931";
  ctx.font = '600 11px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(
    activePanels
      .map(
        (panel) =>
          `${panel.group.toUpperCase()} ${Math.round((panel.field.validCount / panel.field.values.length) * 100)}%`
      )
      .join("  /  "),
    68,
    897
  );
  ctx.fillText(
    activePanels
      .map((panel) => `${panel.group.toUpperCase()} ${Math.round(contourSegmentCount(panel)).toLocaleString()}`)
      .join("  /  "),
    300,
    897
  );
  ctx.fillText(
    activePanels.map((panel) => `${panel.group.toUpperCase()} ±${pads(panel.field.rmse, 2)}`).join("  /  "),
    688,
    897
  );

  ctx.fillStyle = "#1b2931";
  ctx.font = '600 10px "Noto SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("✓ 等值线颜色与图例共用同一色阶取色函数", 68, 948);
  ctx.fillStyle = "#7d878a";
  ctx.font = '9px "Noto SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("采样空洞处不执行插值，等值线在覆盖边界截断；悬停可读取局部 LOO 插值误差。", 68, 970);
  ctx.textAlign = "right";
  ctx.font = '8px "SFMono-Regular", Consolas, monospace';
  ctx.fillText("CANVAS 2D · PER-PIXEL FIELD · PNG", 1732, 970);
  ctx.textAlign = "left";

  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNG 导出失败，请重试");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const suffix =
      state.mode === "compare"
        ? `sigma-${state.bandwidthA}-${state.bandwidthB}`
        : `sigma-${state.bandwidthA}`;
    link.href = url;
    link.download = `hotfield-${suffix}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    showToast("PNG 已导出 · 等值线颜色已随图例同步");
  }, "image/png");
}

function init() {
  syncControls();
  renderScale();
  bindPanelEvents();
  bindControls();

  const observer = new ResizeObserver((entries) => {
    const changed = new Set();
    for (const entry of entries) {
      const group = entry.target.dataset.map;
      if (!group || entry.target.classList.contains("is-hidden")) continue;
      if (entry.contentRect.width > 20 && entry.contentRect.height > 20) changed.add(group);
    }
    if (changed.size) scheduleRender([...changed]);
  });
  observer.observe(panels.a.frame);
  observer.observe(panels.b.frame);

  window.__heatmapLab = {
    getState: () => ({
      bandwidthA: state.bandwidthA,
      bandwidthB: state.bandwidthB,
      levels: state.levels,
      interval: state.interval,
      mode: state.mode,
      samples: state.samples.length,
      domain: [...state.domain],
      coverageA: panels.a.field ? panels.a.field.validCount / panels.a.field.values.length : null,
      coverageB: panels.b.field ? panels.b.field.validCount / panels.b.field.values.length : null,
      contourSegmentsA: panels.a.field ? contourSegmentCount(panels.a) : null,
      contourSegmentsB: panels.b.field ? contourSegmentCount(panels.b) : null
    }),
    getColorChecks: () =>
      contourLevels(state.domain[0], state.domain[1], state.interval).map((level) => {
        const contour = contourColor(level, state.domain);
        const legend = contourLegendColor(level, state.domain);
        return { level, contour, legend, match: contour === legend };
      }),
    readField: (group, nx, ny) => {
      const panel = panels[group];
      if (!panel?.field) return null;
      const x = Math.max(0, Math.min(panel.field.width - 1, Math.floor(nx * panel.field.width)));
      const y = Math.max(0, Math.min(panel.field.height - 1, Math.floor(ny * panel.field.height)));
      const index = y * panel.field.width + x;
      return {
        valid: Boolean(panel.field.valid[index]),
        value: panel.field.valid[index] ? panel.field.values[index] : null,
        error: panel.field.valid[index] ? panel.field.errors[index] : null,
        nearest: panel.field.nearest[index]
      };
    },
    redraw: () => scheduleRender(["a", "b"])
  };

  requestAnimationFrame(() => scheduleRender(["a", "b"]));
}

init();
