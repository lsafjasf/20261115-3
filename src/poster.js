import { DATASETS, LAYOUTS, POSTER, THEMES } from "./data.js";

const CJK_RE =
  /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
const NARROW_RE = /[ilI1.,:;'!|]/;
const PUNCTUATION_RE = /[，。！？、；：）》」】,.!?;:)]/;
const CLOSING_RE = /[，。！？、；：）》」】,.!?;:)]/;

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function characterWidth(character, fontSize, weight = 500) {
  if (/\s/u.test(character)) return fontSize * 0.28;
  if (CJK_RE.test(character)) {
    if (PUNCTUATION_RE.test(character)) return fontSize * 0.48;
    return fontSize;
  }
  if (NARROW_RE.test(character)) return fontSize * 0.34;
  if (/[A-Z]/.test(character)) return fontSize * 0.66;
  if (/[0-9]/.test(character)) return fontSize * 0.58;
  if (/[—–-]/.test(character)) return fontSize * 0.62;
  const base = fontSize * 0.56;
  return weight >= 700 ? base * 1.035 : base;
}

export function measureTextWidth(text, fontSize, options = {}) {
  const weight = options.weight ?? 500;
  const letterSpacing = options.letterSpacing ?? 0;
  const characters = Array.from(String(text));
  return characters.reduce(
    (total, character) => total + characterWidth(character, fontSize, weight),
    0,
  ) + Math.max(0, characters.length - 1) * letterSpacing;
}

function tokenize(text) {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter("zh", { granularity: "word" }).segment(text),
      (part) => part.segment,
    );
  }
  return Array.from(text);
}

function wrapParagraph(text, maxWidth, fontSize, options) {
  const tokens = tokenize(text);
  const lines = [];
  let current = [];

  for (const token of tokens) {
    const next = [...current, token].join("");
    if (
      current.length &&
      measureTextWidth(next, fontSize, options) > maxWidth &&
      !CLOSING_RE.test(token)
    ) {
      lines.push(current.join("").trimEnd());
      current = [token.trimStart()];
      continue;
    }

    if (
      current.length &&
      measureTextWidth(next, fontSize, options) > maxWidth &&
      CLOSING_RE.test(token) &&
      current.length > 1
    ) {
      const heldToken = current.pop();
      lines.push(current.join("").trimEnd());
      current = [heldToken, token];
      continue;
    }

    if (!current.length && token === " ") continue;
    current.push(token);
  }

  if (current.join("").trim()) lines.push(current.join("").trimEnd());

  if (options.balance && lines.length > 1) {
    const lastWidth = measureTextWidth(lines.at(-1), fontSize, options);
    if (lastWidth < maxWidth * 0.34) {
      const previousTokens = tokenize(lines.at(-2));
      const lastToken = previousTokens.at(-1);
      if (lastToken && !CLOSING_RE.test(lastToken)) {
        lines[lines.length - 2] = lines.at(-2).slice(0, -lastToken.length).trimEnd();
        lines[lines.length - 1] = lastToken + lines.at(-1);
      }
    }
  }

  return lines;
}

export function wrapText(text, maxWidth, fontSize, options = {}) {
  return String(text)
    .split("\n")
    .flatMap((paragraph) =>
      paragraph.trim() ? wrapParagraph(paragraph, maxWidth, fontSize, options) : [""],
    );
}

export function getDataset(id) {
  return DATASETS.find((dataset) => dataset.id === id) ?? DATASETS[0];
}

export function getTheme(id) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function getLayout(id) {
  return LAYOUTS.find((layout) => layout.id === id) ?? LAYOUTS[0];
}

function trendDirection(values) {
  const delta = values.at(-1) - values.at(-2);
  if (Math.abs(delta) < 0.05) return "steady";
  return delta > 0 ? "rising" : "falling";
}

function niceCeiling(value) {
  if (value <= 10) return Math.ceil(value / 2) * 2;
  if (value <= 30) return Math.ceil(value / 5) * 5;
  const step = value <= 100 ? 10 : Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / step) * step;
}

function makeTitle(dataset) {
  const direction = trendDirection(dataset.trend.values);
  return `${dataset.headline.subject}${dataset.headline[direction]}`;
}

function makeMetricModel(metric, index) {
  const displayValue = formatNumber(metric.value, metric.decimals);
  return {
    ...metric,
    index: String(index + 1).padStart(2, "0"),
    displayValue,
    displayDelta: `${metric.delta >= 0 ? "+" : "−"}${formatNumber(
      Math.abs(metric.delta),
      Number.isInteger(metric.delta) ? 0 : 1,
    )}`,
    direction: metric.delta >= 0 ? "up" : "down",
  };
}

function layoutTextLine(text, x, top, width, fontSize, lineHeight, extra = {}) {
  return {
    text,
    x,
    top,
    width,
    height: lineHeight,
    baseline: top + fontSize,
    fontSize,
    ...extra,
  };
}

export function buildPosterModel(datasetId, themeId, layoutId) {
  const dataset = getDataset(datasetId);
  const theme = getTheme(themeId);
  const layout = getLayout(layoutId);
  const titleText = makeTitle(dataset);
  const metrics = dataset.metrics.map(makeMetricModel);
  const trendDelta = dataset.trend.values.at(-1) - dataset.trend.values.at(-2);
  const introText = `${dataset.intro} ${
    dataset.trend.shortLabel
  }较 ${dataset.trend.labels.at(-2)} 年${
    trendDelta >= 0 ? "上升" : "下降"
  } ${formatNumber(Math.abs(trendDelta), 1)}${dataset.trend.unit}。`;

  return {
    dataset,
    theme,
    layout,
    titleText,
    introText,
    metrics,
    direction: trendDirection(dataset.trend.values),
    generatedAt: new Date(),
    trendDelta,
  };
}

export function serializeModel(model) {
  return JSON.stringify(
    {
      dataset: model.dataset.id,
      theme: model.theme.id,
      layout: model.layout.id,
      title: model.titleText,
      metrics: model.metrics.map(({ label, displayValue, unit, displayDelta }) => ({
        label,
        value: displayValue,
        unit,
        delta: displayDelta,
      })),
      trend: {
        labels: model.dataset.trend.labels,
        values: model.dataset.trend.values,
      },
    },
    null,
    2,
  );
}

function niceStep(rawStep) {
  if (rawStep <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function makeTextBlock(text, x, top, width, fontSize, lineHeight, options = {}) {
  const lines = wrapText(text, width, fontSize, options).map((line, index) => {
    const measuredWidth = measureTextWidth(line, fontSize, options);
    return layoutTextLine(
      line,
      x,
      top + index * lineHeight,
      measuredWidth,
      fontSize,
      lineHeight,
      { maxWidth: width },
    );
  });
  return {
    text,
    x,
    top,
    width,
    height: lines.length * lineHeight,
    fontSize,
    lineHeight,
    lines,
  };
}

function makeChart(dataset, box, compact = false) {
  const { trend } = dataset;
  const labelFont = compact ? 14 : 15;
  const yLabelWidth = compact ? 46 : 52;
  const plotX = box.x + yLabelWidth;
  const plotY = box.y + (compact ? 62 : 68);
  const plotW = box.w - yLabelWidth - 10;
  const plotH = box.h - (compact ? 108 : 114);
  const requestedMax = Math.max(...trend.values, trend.target ?? 0) * 1.06;
  const step = niceStep(requestedMax / 4);
  const domainMax = step * 4;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = index * step;
    return {
      value,
      label: formatNumber(value, Number.isInteger(value) ? 0 : 1),
      y: plotY + plotH - (value / domainMax) * plotH,
    };
  });
  const points = trend.values.map((value, index) => ({
    value,
    label: trend.labels[index],
    x: plotX + (plotW * index) / Math.max(1, trend.values.length - 1),
    y: plotY + plotH - (value / domainMax) * plotH,
  }));
  const xLabels = points.map((point, index) => {
    const width = measureTextWidth(point.label, labelFont, { weight: 600 });
    const anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
    const left =
      anchor === "start" ? point.x : anchor === "end" ? point.x - width : point.x - width / 2;
    return {
      text: point.label,
      x: point.x,
      y: plotY + plotH + 27,
      width,
      height: 18,
      anchor,
      left,
    };
  });
  const target =
    trend.target == null
      ? null
      : {
          value: trend.target,
          y: plotY + plotH - (trend.target / domainMax) * plotH,
          label: `目标 ${formatNumber(trend.target, 0)}${trend.unit}`,
        };
  const last = points.at(-1);
  const valueLabel = `${formatNumber(last.value, 1)}${trend.unit}`;
  const valueLabelWidth = measureTextWidth(valueLabel, 16, { weight: 700 }) + 22;
  const valueLabelHeight = 30;
  const valueLabelX = Math.min(
    plotX + plotW - valueLabelWidth,
    Math.max(plotX, last.x - valueLabelWidth / 2),
  );
  const valueLabelY = Math.max(plotY + 2, last.y - valueLabelHeight - 16);

  return {
    box,
    plot: { x: plotX, y: plotY, width: plotW, height: plotH, bottom: plotY + plotH },
    domainMax,
    yTicks,
    points,
    xLabels,
    target,
    valueLabel: {
      text: valueLabel,
      x: valueLabelX,
      y: valueLabelY,
      width: valueLabelWidth,
      height: valueLabelHeight,
    },
  };
}

function makeMetricLayout(metrics, bounds, variant) {
  const { x, y, width, gap } = bounds;
  const cardWidth = (width - gap * (metrics.length - 1)) / metrics.length;

  return metrics.map((metric, index) => {
    const box =
      variant === "rail"
        ? { x, y: y + index * (bounds.height + gap), w: width, h: bounds.height }
        : { x: x + index * (cardWidth + gap), y, w: cardWidth, h: bounds.height };
    const padding = variant === "rail" ? 20 : 22;
    const valueSize = variant === "rail" ? 46 : variant === "minimal" ? 54 : 51;
    const unitSize = variant === "rail" ? 14 : 16;
    const labelBaseline =
      variant === "rail" ? box.y + 48 : variant === "minimal" ? box.y + 48 : box.y + 52;
    const valueBaseline =
      variant === "rail" ? box.y + 112 : variant === "minimal" ? box.y + 108 : box.y + 127;
    const deltaBaseline =
      variant === "rail" ? box.y + 153 : variant === "minimal" ? box.y + 132 : box.y + 164;
    const valueWidth = measureTextWidth(metric.displayValue, valueSize, { weight: 700 });
    const unitWidth = measureTextWidth(metric.unit, unitSize, { weight: 600 });
    const deltaText = `${metric.delta >= 0 ? "↑" : "↓"} ${metric.displayDelta}${metric.deltaUnit}`;
    const deltaWidth = measureTextWidth(deltaText, 11, { weight: 700 }) + 18;
    return {
      ...metric,
      box,
      padding,
      valueSize,
      unitSize,
      valueUnitWidth: valueWidth + 5 + unitWidth,
      deltaWidth,
      labelPos: {
        x: box.x + padding,
        y: labelBaseline,
      },
      valuePos: {
        x: box.x + padding,
        y: valueBaseline,
        width: valueWidth,
      },
      unitPos: {
        x: box.x + padding + valueWidth + 5,
        y: valueBaseline,
        width: unitWidth,
      },
      deltaPos: {
        x: box.x + padding,
        y: deltaBaseline,
        width: deltaWidth,
      },
      notePos: {
        x: box.x + box.w - padding,
        y: deltaBaseline,
      },
    };
  });
}

function buildEditorialLayout(model) {
  const { dataset, theme } = model;
  const { width, margin } = POSTER;
  const contentWidth = width - margin * 2;
  const titleFont = 82;
  const titleLineHeight = 89;
  const title = makeTextBlock(
    model.titleText,
    margin,
    180,
    880,
    titleFont,
    titleLineHeight,
    { weight: 700, letterSpacing: -1.5, balance: true },
  );
  const intro = makeTextBlock(
    model.introText,
    margin + 2,
    title.top + title.height + 32,
    770,
    24,
    35,
    { weight: 400 },
  );
  const metricsY = intro.top + intro.height + 44;
  const metricHeight = 196;
  const metrics = makeMetricLayout(model.metrics, {
    x: margin,
    y: metricsY,
    width: contentWidth,
    height: metricHeight,
    gap: 16,
  }, "card");
  const metricsBottom = metricsY + metricHeight;
  const chartBox = {
    x: margin,
    y: metricsBottom + 45,
    w: contentWidth,
    h: 376,
  };
  const chart = makeChart(dataset, chartBox);
  const caption = makeTextBlock(
    dataset.trend.caption,
    margin + 30,
    chartBox.y + chartBox.h + 34,
    760,
    21,
    30,
    { weight: 400 },
  );

  return {
    id: "editorial",
    title,
    intro,
    metrics,
    metricsY,
    metricHeight,
    chart,
    caption,
    captionBox: {
      x: margin,
      y: chartBox.y + chartBox.h + 18,
      w: contentWidth,
      h: caption.height + 32,
    },
    regions: [
      { id: "header", x: margin, y: 50, w: contentWidth, h: 68 },
      { id: "title", x: title.x, y: title.top, w: title.width, h: title.height },
      { id: "intro", x: intro.x, y: intro.top, w: intro.width, h: intro.height },
      { id: "metrics", x: margin, y: metricsY, w: contentWidth, h: metricHeight },
      { id: "chart", ...chartBox },
      {
        id: "caption",
        x: margin,
        y: chartBox.y + chartBox.h + 18,
        w: contentWidth,
        h: caption.height + 32,
      },
      { id: "footer", x: margin, y: 1345, w: contentWidth, h: 44 },
    ],
    decoration: {
      ring: { cx: width - margin - 8, cy: 184, r: 124, color: theme.accentSoft },
      accentBar: { x: margin, y: intro.top - 9, w: 42, h: 3 },
    },
  };
}

function buildSplitLayout(model) {
  const { dataset, theme } = model;
  const { width, margin } = POSTER;
  const contentWidth = width - margin * 2;
  const title = makeTextBlock(
    model.titleText,
    margin,
    172,
    900,
    76,
    83,
    { weight: 700, letterSpacing: -1.2, balance: true },
  );
  const intro = makeTextBlock(
    model.introText,
    margin + 2,
    title.top + title.height + 30,
    755,
    23,
    33,
    { weight: 400 },
  );
  const lowerY = intro.top + intro.height + 42;
  const metricHeight = 183;
  const metricWidth = 292;
  const metrics = makeMetricLayout(model.metrics, {
    x: margin,
    y: lowerY,
    width: metricWidth,
    height: metricHeight,
    gap: 15,
  }, "rail");
  const railBottom = lowerY + metricHeight * 3 + 30;
  const chartBox = {
    x: margin + metricWidth + 24,
    y: lowerY,
    w: contentWidth - metricWidth - 24,
    h: railBottom - lowerY,
  };
  const chart = makeChart(dataset, chartBox);
  const captionTop = railBottom + 36;
  const caption = makeTextBlock(
    dataset.trend.caption,
    margin + 30,
    captionTop + 24,
    760,
    21,
    30,
    { weight: 400 },
  );

  return {
    id: "split",
    title,
    intro,
    metrics,
    metricsY: lowerY,
    metricHeight,
    chart,
    caption,
    captionBox: {
      x: margin,
      y: captionTop,
      w: contentWidth,
      h: caption.height + 34,
    },
    regions: [
      { id: "header", x: margin, y: 50, w: contentWidth, h: 68 },
      { id: "title", x: title.x, y: title.top, w: title.width, h: title.height },
      { id: "intro", x: intro.x, y: intro.top, w: intro.width, h: intro.height },
      { id: "metrics", x: margin, y: lowerY, w: metricWidth, h: railBottom - lowerY },
      { id: "chart", ...chartBox },
      { id: "caption", x: margin, y: captionTop, w: contentWidth, h: caption.height + 34 },
      { id: "footer", x: margin, y: 1345, w: contentWidth, h: 44 },
    ],
    decoration: {
      ring: { cx: width - margin - 82, cy: 250, r: 152, color: theme.accentSoft },
      accentBar: { x: margin, y: lowerY - 14, w: 56, h: 3 },
    },
  };
}

function buildMinimalLayout(model) {
  const { dataset, theme } = model;
  const { width, margin } = POSTER;
  const contentWidth = width - margin * 2;
  const title = makeTextBlock(
    model.titleText,
    margin,
    188,
    920,
    86,
    93,
    { weight: 700, letterSpacing: -1.6, balance: true },
  );
  const intro = makeTextBlock(
    model.introText,
    margin + 2,
    title.top + title.height + 28,
    800,
    23,
    33,
    { weight: 400 },
  );
  const metricsY = intro.top + intro.height + 42;
  const metrics = makeMetricLayout(model.metrics, {
    x: margin,
    y: metricsY,
    width: contentWidth,
    height: 142,
    gap: 24,
  }, "minimal");
  const chartBox = {
    x: margin,
    y: metricsY + 142 + 42,
    w: contentWidth,
    h: 404,
  };
  const chart = makeChart(dataset, chartBox);
  const captionTop = chartBox.y + chartBox.h + 30;
  const caption = makeTextBlock(
    dataset.trend.caption,
    margin + 30,
    captionTop + 24,
    760,
    21,
    30,
    { weight: 400 },
  );

  return {
    id: "minimal",
    title,
    intro,
    metrics,
    metricsY,
    metricHeight: 142,
    chart,
    caption,
    captionBox: {
      x: margin,
      y: captionTop,
      w: contentWidth,
      h: caption.height + 34,
    },
    regions: [
      { id: "header", x: margin, y: 50, w: contentWidth, h: 68 },
      { id: "title", x: title.x, y: title.top, w: title.width, h: title.height },
      { id: "intro", x: intro.x, y: intro.top, w: intro.width, h: intro.height },
      { id: "metrics", x: margin, y: metricsY, w: contentWidth, h: 142 },
      { id: "chart", ...chartBox },
      { id: "caption", x: margin, y: captionTop, w: contentWidth, h: caption.height + 34 },
      { id: "footer", x: margin, y: 1345, w: contentWidth, h: 44 },
    ],
    decoration: {
      ring: { cx: width - margin - 10, cy: 188, r: 132, color: theme.accentSoft },
      accentBar: { x: margin, y: intro.top - 9, w: 42, h: 3 },
    },
  };
}

export function layoutPoster(datasetId, themeId, layoutId) {
  const model = buildPosterModel(datasetId, themeId, layoutId);
  const builders = {
    editorial: buildEditorialLayout,
    split: buildSplitLayout,
    minimal: buildMinimalLayout,
  };
  model.layoutData = (builders[layoutId] ?? buildEditorialLayout)(model);
  return model;
}

const SANS =
  "'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const SERIF =
  "'Noto Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'STSong', serif";

function textEl(text, x, y, attributes = {}) {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
  return `<text x="${x}" y="${y}" ${attrs}>${escapeXml(text)}</text>`;
}

function rectEl(x, y, width, height, attributes = {}) {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${attrs}/>`;
}

function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const following = points[index + 2] ?? next;
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (following.x - current.x) / 6;
    const control2Y = next.y - (following.y - current.y) / 6;
    path += ` C ${control1X.toFixed(2)} ${control1Y.toFixed(2)}, ${control2X.toFixed(
      2,
    )} ${control2Y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function renderHeader(model) {
  const { dataset, theme } = model;
  const { width, margin } = POSTER;
  return `
    <g id="masthead" data-layer="header">
      <text x="${margin}" y="72" fill="${theme.ink}" font-family="${SANS}" font-size="18" font-weight="700" letter-spacing="2.8">${escapeXml(
        dataset.masthead,
      )}</text>
      <text x="${width - margin}" y="72" fill="${theme.muted}" font-family="${SANS}" font-size="11" font-weight="600" letter-spacing="1.5" text-anchor="end">DATA POSTER / ${escapeXml(
        dataset.year,
      )}</text>
      <line x1="${margin}" y1="98" x2="${width - margin}" y2="98" stroke="${
        theme.rule
      }" stroke-width="1.5"/>
      <text x="${margin}" y="132" fill="${theme.body}" font-family="${SANS}" font-size="11" font-weight="600" letter-spacing="1.4">${escapeXml(
        dataset.category,
      )}</text>
      <text x="${width - margin}" y="132" fill="${theme.accent}" font-family="${SANS}" font-size="11" font-weight="700" letter-spacing="1.4" text-anchor="end">${escapeXml(
        dataset.issue,
      )} · 1080 × 1440</text>
    </g>`;
}

function renderTitle(model) {
  const { theme, layoutData } = model;
  const { title } = layoutData;
  const lines = title.lines
    .map((line, index) => {
      const isFinal = index === title.lines.length - 1;
      return textEl(line.text, line.x, line.baseline, {
        fill: isFinal && title.lines.length > 1 ? theme.accent : theme.ink,
        "font-family": SERIF,
        "font-size": line.fontSize,
        "font-weight": 700,
        "letter-spacing": -1.5,
        "data-line": index + 1,
      });
    })
    .join("\n      ");

  return `
    <g id="headline" data-layer="title" aria-label="${escapeXml(model.titleText)}">
      ${lines}
    </g>`;
}

function renderIntro(model) {
  const { theme, layoutData } = model;
  const { intro } = layoutData;
  const lines = intro.lines
    .map((line) =>
      textEl(line.text, line.x, line.baseline, {
        fill: theme.body,
        "font-family": SANS,
        "font-size": line.fontSize,
        "font-weight": 400,
        "letter-spacing": 0.1,
      }),
    )
    .join("\n      ");

  return `
    <g id="introduction" data-layer="intro">
      <line x1="${intro.x}" y1="${intro.top - 14}" x2="${
        intro.x + 34
      }" y2="${intro.top - 14}" stroke="${theme.accent}" stroke-width="2"/>
      ${lines}
    </g>`;
}

function renderOrnament(model) {
  const { theme, layoutData } = model;
  const { ring } = layoutData.decoration;
  return `
    <g id="ornament" data-layer="decoration" aria-hidden="true">
      <circle cx="${ring.cx}" cy="${ring.cy}" r="${
        ring.r
      }" fill="none" stroke="${ring.color}" stroke-width="1.2" opacity="0.34"/>
      <circle cx="${ring.cx}" cy="${ring.cy}" r="${
        ring.r - 18
      }" fill="none" stroke="${ring.color}" stroke-width="0.7" opacity="0.22"/>
      <circle cx="${ring.cx}" cy="${ring.cy}" r="4" fill="${theme.accent}" opacity="0.7"/>
    </g>`;
}

function renderMetrics(model) {
  const { theme, layoutData } = model;
  const variant = layoutData.id;
  const metrics = layoutData.metrics
    .map((metric) => {
      const { box } = metric;
      const showCard = variant !== "minimal";
      const deltaFill = metric.direction === "up" ? theme.positive : theme.negative;
      const deltaText = `${metric.direction === "up" ? "↑" : "↓"} ${
        metric.displayDelta
      }${metric.deltaUnit}`;
      return `
      <g id="metric-${metric.index}" data-layer="metric" data-label="${escapeXml(
        metric.label,
      )}" data-value="${escapeXml(metric.displayValue)}${escapeXml(metric.unit)}">
        ${
          showCard
            ? rectEl(box.x, box.y, box.w, box.h, {
                fill: theme.card,
                stroke: variant === "rail" ? theme.grid : "none",
                "stroke-width": variant === "rail" ? 0.8 : 0,
              })
            : `<line x1="${box.x}" y1="${box.y}" x2="${
                box.x + box.w
              }" y2="${box.y}" stroke="${theme.rule}" stroke-width="1.2"/>`
        }
        <text x="${box.x + metric.padding}" y="${
          metric.labelPos.y - 25
        }" fill="${theme.accent}" font-family="${SANS}" font-size="10" font-weight="700" letter-spacing="1.6">${
          metric.index
        } / METRIC</text>
        ${textEl(metric.label, metric.labelPos.x, metric.labelPos.y, {
          fill: theme.body,
          "font-family": SANS,
          "font-size": variant === "rail" ? 16 : 17,
          "font-weight": 600,
          "letter-spacing": 0.2,
        })}
        ${textEl(metric.displayValue, metric.valuePos.x, metric.valuePos.y, {
          fill: theme.ink,
          "font-family": SERIF,
          "font-size": metric.valueSize,
          "font-weight": 700,
          "letter-spacing": -1.5,
        })}
        ${textEl(metric.unit, metric.unitPos.x, metric.unitPos.y - 2, {
          fill: theme.muted,
          "font-family": SANS,
          "font-size": metric.unitSize,
          "font-weight": 600,
        })}
        ${rectEl(metric.deltaPos.x, metric.deltaPos.y - (variant === "minimal" ? 16 : 18), metric.deltaWidth, variant === "minimal" ? 21 : 24, {
          fill: deltaFill,
          opacity: "0.12",
          rx: "12",
        })}
        ${textEl(deltaText, metric.deltaPos.x + 9, metric.deltaPos.y, {
          fill: deltaFill,
          "font-family": SANS,
          "font-size": 11,
          "font-weight": 700,
          "letter-spacing": 0.2,
        })}
        ${textEl(metric.note, metric.notePos.x, metric.notePos.y, {
          fill: theme.muted,
          "font-family": SANS,
          "font-size": 10,
          "font-weight": 500,
          "text-anchor": "end",
        })}
      </g>`;
    })
    .join("\n");

  return `
    <g id="metrics" data-layer="metrics" aria-label="三组核心指标">
      ${metrics}
    </g>`;
}

function renderChart(model) {
  const { dataset, theme, layoutData } = model;
  const { chart } = layoutData;
  const { trend } = dataset;
  const { box, plot, points, yTicks, target, valueLabel } = chart;
  const first = trend.values[0];
  const change = trend.values.at(-1) - first;
  const changeLabel = `${change >= 0 ? "+" : "−"}${formatNumber(
    Math.abs(change),
    1,
  )}${trend.unit}`;
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points.at(-1).x.toFixed(2)} ${plot.bottom.toFixed(
    2,
  )} L ${points[0].x.toFixed(2)} ${plot.bottom.toFixed(2)} Z`;
  const grid = yTicks
    .map(
      (tick) => `
      <g>
        <line x1="${plot.x}" y1="${tick.y.toFixed(2)}" x2="${
          plot.x + plot.width
        }" y2="${tick.y.toFixed(2)}" stroke="${theme.grid}" stroke-width="${
          tick.value === 0 ? 1.1 : 0.55
        }" opacity="${tick.value === 0 ? 0.8 : 0.55}"/>
      </g>`,
    )
    .join("");
  const yLabels = yTicks
    .map((tick) =>
      textEl(tick.label, plot.x - 13, tick.y + 5, {
        fill: theme.muted,
        "font-family": SANS,
        "font-size": 10,
        "font-weight": 500,
        "text-anchor": "end",
      }),
    )
    .join("");
  const dots = points
    .map(
      (point, index) => `
      <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(
        2,
      )}" r="${index === points.length - 1 ? 5.2 : 3.7}" fill="${
        index === points.length - 1 ? theme.ink : theme.bg
      }" stroke="${theme.accent}" stroke-width="1.8"/>`,
    )
    .join("");
  const xLabels = chart.xLabels
    .map((label, index) =>
      textEl(label.text, label.x, label.y, {
        fill: index === chart.xLabels.length - 1 ? theme.ink : theme.muted,
        "font-family": SANS,
        "font-size": index === chart.xLabels.length - 1 ? 11 : 10,
        "font-weight": index === chart.xLabels.length - 1 ? 700 : 500,
        "text-anchor": label.anchor,
      }),
    )
    .join("");
  const targetMarkup = target
    ? `
      <line x1="${plot.x}" y1="${target.y.toFixed(2)}" x2="${
        plot.x + plot.width
      }" y2="${target.y.toFixed(2)}" stroke="${theme.accentSoft}" stroke-width="1.2" stroke-dasharray="7 7" opacity="0.9"/>
      ${textEl(target.label, plot.x + 8, target.y - 8, {
        fill: theme.accentSoft,
        "font-family": SANS,
        "font-size": 9,
        "font-weight": 700,
        "letter-spacing": 0.6,
      })}`
    : "";

  return `
    <g id="trend-chart" data-layer="chart" aria-label="${escapeXml(trend.label)}趋势图">
      ${textEl("TRAJECTORY / 05", box.x, box.y + 12, {
        fill: theme.accent,
        "font-family": SANS,
        "font-size": 9,
        "font-weight": 700,
        "letter-spacing": 2,
      })}
      ${textEl(trend.label, box.x, box.y + 43, {
        fill: theme.ink,
        "font-family": SERIF,
        "font-size": 18,
        "font-weight": 700,
        "letter-spacing": 0.2,
      })}
      ${textEl(
        `${trend.labels[0]}—${trend.labels.at(-1)}  ${changeLabel}`,
        box.x + box.w,
        box.y + 42,
        {
          fill: theme.muted,
          "font-family": SANS,
          "font-size": 10,
          "font-weight": 600,
          "text-anchor": "end",
          "letter-spacing": 0.3,
        },
      )}
      <g clip-path="url(#plotClip)">
        ${rectEl(plot.x, plot.y, plot.width, plot.height, {
          fill: theme.card,
          opacity: dataset.id === "urban" ? 0.2 : 0,
        })}
        ${grid}
        ${targetMarkup}
        <path d="${areaPath}" fill="url(#areaFill)" data-series="area"/>
        <path d="${linePath}" fill="none" stroke="${theme.accent}" stroke-width="2.6" stroke-linecap="round" data-series="line"/>
        ${dots}
      </g>
      <g id="y-axis" data-layer="axis" aria-label="纵轴刻度">${yLabels}</g>
      ${xLabels}
      ${rectEl(valueLabel.x, valueLabel.y, valueLabel.width, valueLabel.height, {
        fill: theme.ink,
        rx: "2",
      })}
      ${textEl(valueLabel.text, valueLabel.x + 11, valueLabel.y + 20, {
        fill: theme.bg,
        "font-family": SANS,
        "font-size": 15,
        "font-weight": 700,
      })}
    </g>`;
}

function renderCaption(model) {
  const { theme, layoutData } = model;
  const { caption, captionBox } = layoutData;
  const lines = caption.lines
    .map((line) =>
      textEl(line.text, line.x, line.baseline, {
        fill: theme.body,
        "font-family": SERIF,
        "font-size": line.fontSize,
        "font-weight": 500,
        "letter-spacing": 0.2,
      }),
    )
    .join("\n      ");

  return `
    <g id="observation" data-layer="caption">
      <line x1="${captionBox.x}" y1="${captionBox.y}" x2="${captionBox.x}" y2="${
        captionBox.y + captionBox.h
      }" stroke="${theme.accent}" stroke-width="2"/>
      ${textEl("READ / 观察", caption.x, caption.top - 14, {
        fill: theme.accent,
        "font-family": SANS,
        "font-size": 9,
        "font-weight": 700,
        "letter-spacing": 2,
      })}
      ${lines}
    </g>`;
}

function renderFooter(model) {
  const { dataset, theme, layoutData } = model;
  const { width, margin } = POSTER;
  const footer = layoutData.regions.find((region) => region.id === "footer");
  return `
    <g id="footer" data-layer="footer">
      <line x1="${margin}" y1="${footer.y}" x2="${
        width - margin
      }" y2="${footer.y}" stroke="${theme.rule}" stroke-width="1"/>
      ${textEl(dataset.source, margin, footer.y + 26, {
        fill: theme.muted,
        "font-family": SANS,
        "font-size": 9,
        "font-weight": 500,
        "letter-spacing": 0.4,
      })}
      ${textEl("SIGNAL / DATA AS STORY", width / 2, footer.y + 26, {
        fill: theme.body,
        "font-family": SANS,
        "font-size": 9,
        "font-weight": 700,
        "letter-spacing": 1.8,
        "text-anchor": "middle",
      })}
      ${textEl(`${theme.label} · ${layoutData.id.toUpperCase()} · SVG`, width - margin, footer.y + 26, {
        fill: theme.body,
        "font-family": SANS,
        "font-size": 9,
        "font-weight": 600,
        "letter-spacing": 0.5,
        "text-anchor": "end",
      })}
    </g>`;
}

function renderBackground(model) {
  const { dataset, theme, layoutData } = model;
  const { width, height, margin } = POSTER;
  const datasetIndex = String(DATASETS.findIndex((item) => item.id === dataset.id) + 1).padStart(
    2,
    "0",
  );
  return `
    <g id="background" data-layer="background">
      <rect width="${width}" height="${height}" fill="url(#bgWash)"/>
      <rect width="${width}" height="${height}" fill="url(#dotGrid)"/>
      <text x="${width - margin + 12}" y="382" fill="${theme.ink}" opacity="0.035" font-family="${SERIF}" font-size="360" font-weight="700" text-anchor="end">${datasetIndex}</text>
      <line x1="${margin}" y1="${layoutData.regions[1].y - 24}" x2="${
        margin + 42
      }" y2="${layoutData.regions[1].y - 24}" stroke="${theme.accent}" stroke-width="2.5"/>
    </g>`;
}

export function renderPosterSvg(model) {
  const { theme, dataset, layoutData } = model;
  const { width, height } = POSTER;
  const metadata = serializeModel(model);
  const plot = layoutData.chart.plot;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="poster-title poster-desc" data-dataset="${escapeXml(
    dataset.id,
  )}" data-theme="${escapeXml(theme.id)}" data-layout="${escapeXml(layoutData.id)}">
  <title id="poster-title">${escapeXml(model.titleText)}</title>
  <desc id="poster-desc">${escapeXml(dataset.masthead)} ${escapeXml(
    dataset.category,
  )} 数据海报。三组指标与趋势图均由内置数据自动生成。</desc>
  <metadata id="poster-data">${escapeXml(metadata)}</metadata>
  <defs>
    <linearGradient id="bgWash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.bg}"/>
      <stop offset="0.64" stop-color="${theme.bg}"/>
      <stop offset="1" stop-color="${theme.cardAlt}" stop-opacity="0.34"/>
    </linearGradient>
    <linearGradient id="areaFill" gradientUnits="userSpaceOnUse" x1="0" y1="${plot.y}" x2="0" y2="${plot.bottom}">
      <stop offset="0" stop-color="${theme.chartFill}" stop-opacity="0.46"/>
      <stop offset="1" stop-color="${theme.chartFill}" stop-opacity="0.02"/>
    </linearGradient>
    <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.7" fill="${theme.grid}" opacity="0.42"/>
    </pattern>
    <clipPath id="plotClip">
      <rect x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}"/>
    </clipPath>
  </defs>
  ${renderBackground(model)}
  ${renderOrnament(model)}
  ${renderHeader(model)}
  ${renderTitle(model)}
  ${renderIntro(model)}
  ${renderMetrics(model)}
  ${renderChart(model)}
  ${renderCaption(model)}
  ${renderFooter(model)}
</svg>`;
}
