import assert from "node:assert/strict";
import test from "node:test";
import { DATASETS, LAYOUTS, POSTER, THEMES } from "../src/data.js";
import {
  formatNumber,
  layoutPoster,
  measureTextWidth,
  renderPosterSvg,
  wrapText,
} from "../src/poster.js";

const EPSILON = 0.02;
const allVariants = DATASETS.flatMap((dataset) =>
  LAYOUTS.map((layout) => ({
    dataset,
    layout,
    model: layoutPoster(dataset.id, "tundra", layout.id),
  })),
);

function intersects(a, b) {
  return (
    a.x + a.w > b.x + EPSILON &&
    b.x + b.w > a.x + EPSILON &&
    a.y + a.h > b.y + EPSILON &&
    b.y + b.h > a.y + EPSILON
  );
}

function assertTextBlock(block, label) {
  assert.ok(block.lines.length > 0, `${label} should have visible lines`);
  for (const line of block.lines) {
    assert.ok(line.text.trim().length > 0, `${label} line should not be empty`);
    assert.ok(
      line.width <= block.width + EPSILON,
      `${label} line "${line.text}" width ${line.width.toFixed(2)} exceeds ${block.width}`,
    );
    assert.ok(
      line.top + line.height <= block.top + block.height + EPSILON,
      `${label} line escapes block height`,
    );
  }
  for (let index = 1; index < block.lines.length; index += 1) {
    const previous = block.lines[index - 1];
    const current = block.lines[index];
    assert.ok(
      current.top >= previous.top + previous.height - EPSILON,
      `${label} lines overlap vertically`,
    );
  }
}

test("both built-in datasets produce three synchronized metrics and a trend", () => {
  for (const dataset of DATASETS) {
    const model = layoutPoster(dataset.id, "tundra", "editorial");
    assert.equal(model.metrics.length, 3);
    assert.deepEqual(
      model.metrics.map((metric) => metric.value),
      dataset.metrics.map((metric) => metric.value),
    );

    for (const [index, metric] of model.metrics.entries()) {
      const source = dataset.metrics[index];
      assert.equal(
        metric.displayValue,
        formatNumber(source.value, source.decimals),
        `${dataset.id} metric ${index + 1} display value`,
      );
      assert.equal(metric.unit, source.unit);
      assert.equal(metric.delta, source.delta);
    }

    const { chart } = model.layoutData;
    assert.equal(chart.points.length, dataset.trend.values.length);
    assert.deepEqual(
      chart.points.map((point) => point.value),
      dataset.trend.values,
    );
    assert.deepEqual(
      chart.points.map((point) => point.label),
      dataset.trend.labels,
    );
    assert.equal(
      chart.valueLabel.text,
      `${formatNumber(dataset.trend.values.at(-1), 1)}${dataset.trend.unit}`,
    );
  }
});

test("changing source values recalculates headline suffix, metric labels and plot geometry", () => {
  const dataset = DATASETS.find((item) => item.id === "urban");
  const previousValues = [...dataset.trend.values];
  const previousMetric = { ...dataset.metrics[0] };
  try {
    dataset.trend.values[dataset.trend.values.length - 1] = 60;
    dataset.metrics[0] = {
      ...dataset.metrics[0],
      value: 60,
      delta: -2.2,
    };
    const changed = layoutPoster("urban", "tundra", "editorial");
    assert.match(changed.titleText, /需要喘息$/);
    assert.equal(changed.metrics[0].displayValue, "60.0");
    assert.equal(changed.metrics[0].displayDelta, "−2.2");
    assert.equal(changed.layoutData.chart.points.at(-1).value, 60);
    assert.equal(changed.layoutData.chart.valueLabel.text, "60.0%");
    assert.notEqual(
      changed.layoutData.chart.points.at(-1).y,
      layoutPoster("coast", "tundra", "editorial").layoutData.chart.points.at(-1).y,
    );
    const svg = renderPosterSvg(changed);
    assert.ok(svg.includes('data-value="60.0%"'));
    assert.ok(svg.includes("需要喘息"));
  } finally {
    dataset.trend.values.splice(0, dataset.trend.values.length, ...previousValues);
    dataset.metrics[0] = previousMetric;
  }
});

test("all layouts auto-wrap without line, region, or axis-label collisions", () => {
  for (const { dataset, layout, model } of allVariants) {
    const data = model.layoutData;
    const variant = `${dataset.id}/${layout.id}`;
    assertTextBlock(data.title, `${variant} title`);
    assertTextBlock(data.intro, `${variant} intro`);
    assertTextBlock(data.caption, `${variant} caption`);
    assert.equal(
      data.title.lines.map((line) => line.text).join(""),
      model.titleText,
      `${variant} title text preserved`,
    );

    for (let index = 1; index < data.regions.length; index += 1) {
      const previous = data.regions[index - 1];
      for (let other = index; other < data.regions.length; other += 1) {
        assert.ok(
          !intersects(previous, data.regions[other]),
          `${variant}: ${previous.id} overlaps ${data.regions[other].id}`,
        );
      }
    }

    for (const metric of data.metrics) {
      const right = metric.valuePos.x + metric.valueUnitWidth;
      const limit = metric.box.x + metric.box.w - metric.padding;
      assert.ok(right <= limit + EPSILON, `${variant}: metric value escapes its card`);
      assert.ok(
        metric.deltaPos.x + metric.deltaWidth <= metric.notePos.x,
        `${variant}: delta and note collide`,
      );
    }

    const xLabels = data.chart.xLabels;
    for (let index = 1; index < xLabels.length; index += 1) {
      const previous = xLabels[index - 1];
      const current = xLabels[index];
      assert.ok(
        current.left >= previous.left + previous.width - EPSILON,
        `${variant}: x-axis labels ${previous.text}/${current.text} overlap`,
      );
    }

    const { plot, points, valueLabel, target, yTicks } = data.chart;
    for (const point of points) {
      assert.ok(point.x >= plot.x - EPSILON && point.x <= plot.x + plot.width + EPSILON);
      assert.ok(point.y >= plot.y - EPSILON && point.y <= plot.bottom + EPSILON);
    }
    assert.ok(
      valueLabel.x >= plot.x && valueLabel.x + valueLabel.width <= plot.x + plot.width,
      `${variant}: trend value label escapes plot`,
    );
    if (target) assert.ok(target.y >= plot.y - EPSILON && target.y <= plot.bottom + EPSILON);
    for (let index = 1; index < yTicks.length; index += 1) {
      assert.ok(
        yTicks[index - 1].y - yTicks[index].y >= 12,
        `${variant}: y-axis labels are too close`,
      );
    }

    const footer = data.regions.find((region) => region.id === "footer");
    const contentBottom = Math.max(
      data.title.top + data.title.height,
      data.intro.top + data.intro.height,
      data.metrics.at(-1).box.y + data.metrics.at(-1).box.h,
      data.chart.box.y + data.chart.box.h,
      data.captionBox.y + data.captionBox.h,
    );
    assert.ok(contentBottom < footer.y, `${variant}: content collides with footer`);
    assert.ok(
      data.captionBox.y + data.captionBox.h <= POSTER.height - POSTER.margin,
      `${variant}: caption exceeds safe area`,
    );
  }
});

test("text wrapping handles long CJK headlines and balanced lines", () => {
  const longHeadline = "当一座城市决定把每一条街道都还给日常的呼吸与相遇";
  const lines = wrapText(longHeadline, 560, 72, { weight: 700, balance: true });
  assert.ok(lines.length >= 2);
  assert.equal(lines.join(""), longHeadline);
  for (const line of lines) {
    assert.ok(measureTextWidth(line, 72, { weight: 700 }) <= 560 + 72 * 0.5);
    assert.ok(!/^[，。！？、；：]/u.test(line), `line starts with closing punctuation: ${line}`);
  }
});

test("generated SVG keeps values readable, consistent and editable", () => {
  for (const dataset of DATASETS) {
    const model = layoutPoster(dataset.id, "tundra", "editorial");
    const svg = renderPosterSvg(model);
    assert.match(svg, /^<svg xmlns=/);
    assert.match(svg, /<\/svg>$/);
    assert.doesNotMatch(svg, /<foreignObject/i);
    assert.ok((svg.match(/data-layer="metric"/g) ?? []).length === 3);
    assert.match(svg, /<title id="poster-title">/);
    assert.match(svg, /data-series="line"/);
    assert.match(svg, /<g id="y-axis" data-layer="axis"/);
    assert.ok(
      (svg.match(/data-layer="axis"/g) ?? []).length === 1,
      `${dataset.id}: y-axis labels should be outside the plot clip`,
    );
    for (const metric of model.metrics) {
      const value = `${metric.displayValue}${metric.unit}`;
      assert.ok(
        svg.includes(`data-value="${value}"`),
        `${dataset.id}: metric value ${value} missing from SVG`,
      );
      assert.ok(svg.includes(`>${metric.displayValue}</text>`));
    }
    assert.ok(svg.includes(`>${model.titleText}</text>`) === false);
    assert.ok(svg.includes(dataset.trend.caption.slice(0, 12)));
    assert.ok(svg.includes(`${dataset.trend.values.at(-1).toFixed(1)}${dataset.trend.unit}`));
  }
});

test("theme and layout changes regenerate colors, geometry and chart paths", () => {
  const base = layoutPoster("urban", "tundra", "editorial");
  const otherTheme = layoutPoster("urban", "midnight", "editorial");
  const otherLayout = layoutPoster("urban", "tundra", "split");
  const otherDataset = layoutPoster("coast", "tundra", "editorial");

  assert.notEqual(base.theme.bg, otherTheme.theme.bg);
  assert.notEqual(base.layoutData.metrics[0].box.w, otherLayout.layoutData.metrics[0].box.w);
  assert.notDeepEqual(
    base.layoutData.chart.points.map((point) => point.y),
    otherDataset.layoutData.chart.points.map((point) => point.y),
  );

  const baseSvg = renderPosterSvg(base);
  const otherDatasetSvg = renderPosterSvg(otherDataset);
  const linePath = (svg) => svg.match(/<path d="([^"]+)"[^>]*data-series="line"/)?.[1];
  assert.notEqual(linePath(baseSvg), linePath(otherDatasetSvg));
  assert.notEqual(
    renderPosterSvg(otherTheme),
    renderPosterSvg(base),
    "theme change must re-render the entire SVG",
  );
});

test("all dataset, theme and layout combinations render valid standalone SVG", () => {
  for (const dataset of DATASETS) {
    for (const theme of THEMES) {
      for (const layout of LAYOUTS) {
        const model = layoutPoster(dataset.id, theme.id, layout.id);
        const svg = renderPosterSvg(model);
        assert.match(svg, /width="1080" height="1440"/);
        assert.ok(svg.length > 15_000);
        assert.ok(svg.includes(`data-theme="${theme.id}"`));
        assert.ok(svg.includes(`data-layout="${layout.id}"`));
      }
    }
  }
});
