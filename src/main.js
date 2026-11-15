import { Chart } from './chart.js';

// Fixture with positive/negative values, extreme outliers and gaps.
const labels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const revenue = [120, 135, 98, 142, null, 160, 1200, 150, 138, NaN, 172, 165];
const cost = [80, 92, 88, 95, 102, 97, 110, 200, 105, 98, -600, 101];
const satisfaction = [3.8, 4.1, 3.9, 4.2, 4.0, null, 3.7, 4.3, 4.1, 4.0, 4.4, 4.2];

const toPoints = (values) =>
  values.map((y, index) => ({
    x: index + 1,
    y: Number.isFinite(y) ? y : null,
    label: labels[index],
  }));

const palette = {
  revenue: '#2563eb',
  cost: '#dc2626',
  satisfaction: '#16a34a',
};

const svg = document.querySelector('#chart');
const chart = new Chart(svg, {
  width: 820,
  height: 480,
  title: '月度经营指标（含异常值与缺失数据）',
  chartType: 'line',
  series: [
    { name: '营收', color: palette.revenue, visible: true, points: toPoints(revenue) },
    { name: '成本', color: palette.cost, visible: true, points: toPoints(cost) },
    { name: '满意度', color: palette.satisfaction, visible: true, points: toPoints(satisfaction), radius: 5 },
  ],
});

// Legend checkboxes: toggling recomputes both axis domains.
const legend = document.querySelector('#legend');
for (const item of chart.series) {
  const box = document.createElement('label');
  box.innerHTML =
    `<input type="checkbox" checked data-name="${item.name}">` +
    `<span class="swatch" style="background:${item.color}"></span>${item.name}`;
  legend.appendChild(box);
}
legend.addEventListener('change', (event) => {
  if (event.target.matches('input[data-name]')) {
    chart.setSeriesVisibility(event.target.dataset.name, event.target.checked);
  }
});

document.querySelectorAll('[data-type]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-type]').forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
    chart.setChartType(button.dataset.type);
  });
});

document.querySelector('#symlog-toggle').addEventListener('change', (event) => {
  chart.setAxisType(event.target.checked ? 'symlog' : 'linear');
});

document.querySelector('#reset-zoom').addEventListener('click', () => chart.resetZoom());
document.querySelector('#export-svg').addEventListener('click', () => {
  chart.downloadSVG('chart.svg');
});

// Expose for manual inspection in the browser console.
window.chart = chart;
