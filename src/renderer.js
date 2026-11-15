// DOM-based SVG rendering. No innerHTML: every node is a real, editable SVG
// element, so exported files keep editable <text> and <path> nodes.

import { ticks, formatTick } from './scales.js';
import { planXLabels, planYLabels } from './layout.js';
import { linePaths, areaPaths, scatterPoints } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, textContent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function canvasMeasure(fontSize) {
  let context = null;
  return (text) => {
    if (typeof document === 'undefined') return String(text).length * fontSize * 0.62;
    if (!context) {
      const canvas = document.createElement('canvas');
      context = canvas.getContext('2d');
    }
    if (!context) return String(text).length * fontSize * 0.62;
    context.font = `${fontSize}px sans-serif`;
    return context.measureText(String(text)).width;
  };
}

function drawAxes(root, state, margin, frame) {
  const { width, height, xScale, yScale, axisType, fontSize } = state;
  const { left, right, top, bottom } = margin;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xTicks = ticks(xScale.domain(), 'linear', Math.max(4, Math.round(plotWidth / 90)));
  const yTicks = ticks(yScale.domain(), axisType, Math.max(4, Math.round(plotHeight / 60)));
  const measure = canvasMeasure(fontSize);
  const xLabels = planXLabels(xTicks, xScale, (v) => formatTick(v, 'linear'), {
    measure,
    fontSize,
  });
  const yLabels = planYLabels(yTicks, yScale, (v) => formatTick(v, axisType), {
    lineHeight: fontSize * 1.5,
  });

  const grid = svgEl('g', { class: 'grid' });
  const axisG = svgEl('g', { class: 'axes' });

  for (const tick of xTicks) {
    const px = xScale(tick.value);
    grid.appendChild(svgEl('line', {
      x1: px, y1: top, x2: px, y2: top + plotHeight,
      class: tick.minor ? 'grid-minor' : 'grid-line',
    }));
    axisG.appendChild(svgEl('line', {
      x1: px, y1: top + plotHeight, x2: px, y2: top + plotHeight + 5,
      class: 'tick',
    }));
  }
  for (const tick of yTicks) {
    const py = yScale(tick.value);
    grid.appendChild(svgEl('line', {
      x1: left, y1: py, x2: left + plotWidth, y2: py,
      class: tick.minor ? 'grid-minor' : 'grid-line',
    }));
    if (!tick.minor) {
      axisG.appendChild(svgEl('line', {
        x1: left - 5, y1: py, x2: left, y2: py, class: 'tick',
      }));
    }
  }

  const labelG = svgEl('g', { class: 'labels' });
  for (const label of xLabels) {
    if (!label.visible) continue;
    const text = svgEl('text', {
      x: label.position,
      y: top + plotHeight + fontSize + 6,
      'text-anchor': label.anchor,
      class: 'axis-label x-label',
    }, label.text);
    if (label.rotated) {
      text.setAttribute('transform', `rotate(${label.angle} ${label.position} ${top + plotHeight + fontSize + 6})`);
    }
    labelG.appendChild(text);
  }
  for (const label of yLabels) {
    if (!label.visible) continue;
    labelG.appendChild(svgEl('text', {
      x: left - 8,
      y: label.position + fontSize / 3,
      'text-anchor': label.anchor,
      class: 'axis-label y-label',
    }, label.text));
  }

  axisG.appendChild(svgEl('rect', {
    x: left, y: top, width: plotWidth, height: plotHeight,
    class: 'plot-frame', fill: 'none',
  }));
  root.appendChild(grid);
  root.appendChild(axisG);
  root.appendChild(labelG);
  return frame;
}

export function renderChart(svg, state, margin) {
  const { width, height, xScale, yScale, series, chartType, baselineValue } = state;
  const { left, right, top, bottom } = margin;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const baselinePixel = yScale(baselineValue);

  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  const clipId = 'plot-clip';
  const defs = svgEl('defs');
  const clip = svgEl('clipPath', { id: clipId });
  clip.appendChild(svgEl('rect', {
    x: left, y: top, width: plotWidth, height: plotHeight,
  }));
  defs.appendChild(clip);
  if (state.title) {
    svg.appendChild(svgEl('text', {
      x: width / 2, y: margin.top / 2 + 4,
      'text-anchor': 'middle', class: 'chart-title',
    }, state.title));
  }
  svg.appendChild(defs);

  const plot = svgEl('g', { 'clip-path': `url(#${clipId})` });
  drawAxes(svg, state, margin, { left, top, plotWidth, plotHeight });

  for (const item of series) {
    if (!item.visible) continue;
    const group = svgEl('g', {
      class: `series series-${item.name.replace(/\s+/g, '-')}`,
      'data-series': item.name,
    });
    if (chartType === 'line') {
      for (const path of linePaths(item.points, xScale, yScale)) {
        group.appendChild(svgEl('path', {
          d: path.d, fill: 'none', stroke: item.color,
          'stroke-width': 2, class: 'line-path',
        }));
      }
    } else if (chartType === 'area') {
      for (const path of areaPaths(item.points, xScale, yScale, baselinePixel)) {
        group.appendChild(svgEl('path', {
          d: path.d, fill: item.color, 'fill-opacity': 0.25,
          stroke: item.color, 'stroke-width': 1.5, class: 'area-path',
        }));
      }
    } else {
      for (const point of scatterPoints(item.points, xScale, yScale)) {
        group.appendChild(svgEl('circle', {
          cx: point.cx, cy: point.cy, r: item.radius || 4,
          fill: item.color, class: 'scatter-point',
        }));
      }
    }
    plot.appendChild(group);
  }
  svg.appendChild(plot);
}
