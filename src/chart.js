// Chart controller: owns state, recomputes domains when series change,
// handles wheel zoom, and serializes an editable standalone SVG.

import { makeScale, niceDomain } from './scales.js';
import { combinedExtents, zoomDomain } from './geometry.js';
import { renderChart } from './renderer.js';

const MARGIN = { top: 48, right: 24, bottom: 64, left: 72 };
const FONT_SIZE = 12;

export class Chart {
  constructor(svg, options = {}) {
    this.svg = svg;
    this.width = options.width || 760;
    this.height = options.height || 460;
    this.margin = { ...MARGIN, ...(options.margin || {}) };
    this.axisType = options.axisType || 'linear'; // 'linear' | 'symlog'
    this.chartType = options.chartType || 'line';
    this.title = options.title || '';
    this.series = (options.series || []).map((item) => ({ ...item }));
    this.zoom = { x: null, y: null };
    this._onWheel = (event) => this.handleWheel(event);
    this._onDoubleClick = () => this.resetZoom();
    svg.addEventListener('wheel', this._onWheel, { passive: false });
    svg.addEventListener('dblclick', this._onDoubleClick);
    this.update();
  }

  get plotWidth() {
    return this.width - this.margin.left - this.margin.right;
  }

  get plotHeight() {
    return this.height - this.margin.top - this.margin.bottom;
  }

  setSeriesVisibility(name, visible) {
    const item = this.series.find((entry) => entry.name === name);
    if (item) {
      item.visible = visible;
      // Visibility changes the extents, so user zoom no longer applies.
      this.zoom = { x: null, y: null };
      this.update();
    }
  }

  toggleSeries(name) {
    const item = this.series.find((entry) => entry.name === name);
    if (item) this.setSeriesVisibility(name, !item.visible);
  }

  setChartType(chartType) {
    this.chartType = chartType;
    this.update();
  }

  setAxisType(axisType) {
    this.axisType = axisType;
    this.zoom = { x: null, y: null };
    this.update();
  }

  resetZoom() {
    this.zoom = { x: null, y: null };
    this.update();
  }

  handleWheel(event) {
    event.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const xDomain = this.zoom.x || this.xScale.domain();
    const yDomain = this.zoom.y || this.yScale.domain();
    if (
      anchorX >= this.margin.left &&
      anchorX <= this.width - this.margin.right
    ) {
      this.zoom.x = zoomDomain(
        xDomain, factor, anchorX,
        [this.margin.left, this.width - this.margin.right], this.xScale,
      );
    }
    if (
      anchorY >= this.margin.top &&
      anchorY <= this.height - this.margin.bottom
    ) {
      this.zoom.y = zoomDomain(
        yDomain, factor, anchorY,
        [this.margin.top, this.height - this.margin.bottom], this.yScale,
      );
    }
    this.update();
  }

  computeDomains() {
    const { xs, ys } = combinedExtents(this.series);
    if (xs.length === 0) {
      return { xDomain: [0, 1], yDomain: [0, 1] };
    }
    return {
      xDomain: niceDomain(xs, 'linear'),
      yDomain: niceDomain(ys, this.axisType),
    };
  }

  update() {
    const { xDomain, yDomain } = this.computeDomains();
    this.fullXDomain = xDomain;
    this.fullYDomain = yDomain;
    const xRange = [this.margin.left, this.width - this.margin.right];
    const yRange = [this.height - this.margin.bottom, this.margin.top];

    this.xScale = makeScale(xDomain, xRange, 'linear');
    this.yScale = makeScale(yDomain, yRange, this.axisType);

    const activeXDomain = this.zoom.x || xDomain;
    const activeYDomain = this.zoom.y || yDomain;
    this.xScale = makeScale(activeXDomain, xRange, 'linear');
    this.yScale = makeScale(activeYDomain, yRange, this.axisType);

    // Area baseline is zero when zero is visible, otherwise the plot floor.
    const [yMin, yMax] = activeYDomain;
    const baselineValue = yMin <= 0 && 0 <= yMax ? 0 : yMin;

    this.state = {
      width: this.width,
      height: this.height,
      fontSize: FONT_SIZE,
      xScale: this.xScale,
      yScale: this.yScale,
      axisType: this.axisType,
      chartType: this.chartType,
      series: this.series,
      title: this.title,
      baselineValue,
    };
    renderChart(this.svg, this.state, this.margin);
    this.svg.dispatchEvent(new CustomEvent('chart:update', {
      detail: { xDomain: activeXDomain, yDomain: activeYDomain },
    }));
  }

  // Editable export: real <text>/<path>/<circle> nodes plus an inline style
  // block, wrapped as a standalone XML document. Nothing is rasterized.
  toSVGString() {
    const styleNode = document.createElementNS(
      'http://www.w3.org/2000/svg', 'style',
    );
    styleNode.textContent = SVG_STYLE;
    const clone = this.svg.cloneNode(true);
    clone.insertBefore(styleNode, clone.firstChild);
    if (!clone.getAttribute('font-family')) {
      clone.setAttribute('font-family', 'sans-serif');
    }
    const body = new XMLSerializer().serializeToString(clone);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
  }

  downloadSVG(filename = 'chart.svg') {
    const blob = new Blob([this.toSVGString()], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  destroy() {
    this.svg.removeEventListener('wheel', this._onWheel);
    this.svg.removeEventListener('dblclick', this._onDoubleClick);
  }
}

const SVG_STYLE = `
.grid-line { stroke: #e2e8f0; stroke-width: 1; }
.grid-minor { stroke: #f1f5f9; stroke-width: 1; }
.tick { stroke: #475569; stroke-width: 1; }
.plot-frame { stroke: #475569; stroke-width: 1.2; }
.axis-label { font-size: 12px; fill: #334155; }
.chart-title { font-size: 15px; font-weight: 600; fill: #0f172a; }
.line-path { stroke-linejoin: round; stroke-linecap: round; }
`;
