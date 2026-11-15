// Two preview sets (light / dark): cards, buttons and an SVG chart.
// Every visible color is a CSS variable, so previews update via applyPaletteVars.
import { getChartSeries } from './palette.js';

const THEME_VARS = {
  light: {
    '--preview-bg': 'var(--color-neutral-surface)',
    '--preview-card-bg': '#FFFFFF',
    '--preview-text': 'var(--color-neutral-text)',
    '--preview-muted': 'var(--color-neutral-muted)',
    '--preview-border': 'var(--color-neutral-border)',
    '--preview-primary': 'var(--color-primary)',
    '--preview-primary-hover': 'var(--color-primary-hover)',
    '--preview-primary-active': 'var(--color-primary-active)',
    '--preview-secondary': 'var(--color-secondary)',
    '--preview-secondary-soft': 'var(--color-secondary-light)',
    '--preview-primary-soft': 'var(--color-primary-light)',
  },
  dark: {
    '--preview-bg': 'var(--color-neutral-dark)',
    '--preview-card-bg': 'var(--color-neutral)',
    '--preview-text': 'var(--color-neutral-surface)',
    '--preview-muted': 'var(--color-neutral-muted)',
    '--preview-border': 'var(--color-neutral-muted)',
    '--preview-primary': 'var(--color-primary-dark)',
    '--preview-primary-hover': 'var(--color-primary)',
    '--preview-primary-active': 'var(--color-primary-active)',
    '--preview-secondary': 'var(--color-secondary-dark)',
    '--preview-secondary-soft': 'var(--color-secondary-hover)',
    '--preview-primary-soft': 'var(--color-primary-hover)',
  },
};

const BAR_VALUES = [62, 84, 48, 70, 55, 90];

// Per-theme fill mapping so the dark preview does not reuse light-theme hexes.
const THEME_FILLS = {
  light: [
    'var(--color-primary)',
    'var(--color-secondary)',
    'var(--color-primary-light)',
    'var(--color-neutral)',
    'var(--color-primary-dark)',
    'var(--color-secondary-light)',
  ],
  dark: [
    'var(--color-primary-dark)',
    'var(--color-secondary-dark)',
    'var(--color-primary-light)',
    'var(--color-neutral-muted)',
    'var(--color-primary-active)',
    'var(--color-secondary-hover)',
  ],
};

function buildChart(theme) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 150');
  svg.setAttribute('class', 'chart');
  const series = getChartSeries(window.__palette);
  const barWidth = 34;
  const gap = 16;
  series.forEach((item, index) => {
    const x = 10 + index * (barWidth + gap);
    const height = (BAR_VALUES[index] / 100) * 110;
    const y = 128 - height;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barWidth);
    rect.setAttribute('height', height);
    rect.setAttribute('rx', 4);
    rect.setAttribute('fill', THEME_FILLS[theme][index]);
    rect.dataset.hex = item.hex;
    rect.dataset.series = item.name;
    svg.appendChild(rect);
  });
  const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  baseline.setAttribute('x1', 6);
  baseline.setAttribute('x2', 314);
  baseline.setAttribute('y1', 128);
  baseline.setAttribute('y2', 128);
  baseline.setAttribute('stroke', 'currentColor');
  baseline.setAttribute('opacity', '0.35');
  svg.appendChild(baseline);
  return svg;
}

function buildPreview(theme, title) {
  const root = document.createElement('section');
  root.className = `preview preview--${theme}`;
  Object.entries(THEME_VARS[theme]).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  const heading = document.createElement('h3');
  heading.textContent = title;
  root.appendChild(heading);

  const card = document.createElement('div');
  card.className = 'ui-card';
  card.innerHTML = `
    <div class="ui-card__badge">Pro Plan</div>
    <h4>品牌设计套件</h4>
    <p>卡片、按钮与图表全部读取实时色板变量，主色调整后即刻重渲染。</p>
    <div class="ui-card__actions">
      <button class="btn btn--primary" type="button">主要操作</button>
      <button class="btn btn--secondary" type="button">次要操作</button>
    </div>
  `;
  root.appendChild(card);

  const chartTitle = document.createElement('div');
  chartTitle.className = 'chart-title';
  chartTitle.textContent = '季度增长（图表）';
  root.appendChild(chartTitle);
  root.appendChild(buildChart(theme));

  const legend = document.createElement('div');
  legend.className = 'legend';
  getChartSeries(window.__palette).forEach((item) => {
    const dot = document.createElement('span');
    dot.className = 'legend__item';
    dot.innerHTML = `<i style="background:${item.hex}"></i>${item.name}`;
    legend.appendChild(dot);
  });
  root.appendChild(legend);
  return root;
}

export function mountPreviews(container) {
  container.innerHTML = '';
  container.appendChild(buildPreview('light', '预览 A · 浅色主题'));
  container.appendChild(buildPreview('dark', '预览 B · 深色主题'));
}

// Rebuild charts/legends after palette changes so SVG fills track the palette.
export function refreshPreviews() {
  document.querySelectorAll('.preview').forEach((preview) => {
    const theme = preview.classList.contains('preview--dark') ? 'dark' : 'light';
    const oldChart = preview.querySelector('.chart');
    const oldLegend = preview.querySelector('.legend');
    const chart = buildChart(theme);
    oldChart.replaceWith(chart);
    const legend = document.createElement('div');
    legend.className = 'legend';
    getChartSeries(window.__palette).forEach((item) => {
      const dot = document.createElement('span');
      dot.className = 'legend__item';
      dot.innerHTML = `<i style="background:${item.hex}"></i>${item.name}`;
      legend.appendChild(dot);
    });
    oldLegend.replaceWith(legend);
  });
}
