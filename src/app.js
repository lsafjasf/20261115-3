import { ViewTransform, dataBounds } from './viewTransform.js';
import { AnnotationStore, sampleSeries, initialAnnotations } from './chart.js';
import { layoutAnnotations } from './layout.js';
import { renderSvg, downloadSvg } from './render.js';
import { exportPng } from './pngExport.js';

const stage = document.getElementById('stage');
const svg = document.getElementById('chart');
const readout = document.getElementById('readout');
const listEl = document.getElementById('ann-list');

const store = new AnnotationStore();
initialAnnotations.forEach((ann) => store.add(ann));

let view;
let tool = null;
let drag = null;

function makeView() {
  const rect = stage.getBoundingClientRect();
  const v = new ViewTransform({
    width: Math.max(320, Math.round(rect.width)),
    height: Math.max(320, Math.round(rect.height)),
  });
  v.fit(dataBounds(sampleSeries));
  return v;
}

function currentLayout() {
  return layoutAnnotations(store.items, view, { padding: 8 });
}

function render() {
  const layout = currentLayout();
  svg.setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
  svg.innerHTML = renderSvg(sampleSeries, layout, view)
    .replace(/^<\?xml[\s\S]*?\?>/, '')
    .replace(/<svg[\s\S]*?>/, '')
    .replace(/<\/svg>$/, '');
  readout.textContent = `缩放 ${(view.scaleX / baseScale).toFixed(2)}×`;
  renderList();
}

function renderList() {
  listEl.innerHTML = '';
  for (const ann of [...store.items].sort((a, b) => b.priority - a.priority)) {
    const row = document.createElement('div');
    row.className = 'ann-row';
    row.innerHTML = `
      <div>
        <div class="ann-title">${ann.text || ann.type}</div>
        <div class="ann-meta">${typeLabel(ann.type)} · 锚点 (${ann.anchor[0]}, ${ann.anchor[1]})</div>
      </div>
      <div class="group" style="gap:4px">
        <input type="number" value="${ann.priority}" min="0" max="9" data-id="${ann.id}" class="priority-input" style="width:64px"/>
        <button data-remove="${ann.id}" style="padding:2px 8px">删除</button>
      </div>`;
    listEl.appendChild(row);
  }
  listEl.querySelectorAll('.priority-input').forEach((input) => {
    input.addEventListener('change', () => {
      store.setPriority(input.dataset.id, input.value);
      render();
    });
  });
  listEl.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      store.remove(button.dataset.remove);
      render();
    });
  });
}

function typeLabel(type) {
  return { text: '文字', arrow: '箭头', region: '区域' }[type] ?? type;
}

function pointFromEvent(event) {
  const rect = svg.getBoundingClientRect();
  const scaleX = view.width / rect.width;
  const scaleY = view.height / rect.height;
  return [(event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY];
}

svg.addEventListener('wheel', (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
  view.zoomAt(pointFromEvent(event), factor);
  render();
}, { passive: false });

svg.addEventListener('mousedown', (event) => {
  const screen = pointFromEvent(event);
  if (tool === 'region') {
    drag = { kind: 'region', startScreen: screen, startData: view.toData(screen) };
  } else {
    drag = { kind: 'pan', startScreen: screen, tx: view.tx, ty: view.ty };
  }
});

window.addEventListener('mousemove', (event) => {
  if (!drag) return;
  const screen = pointFromEvent(event);
  if (drag.kind === 'pan') {
    view.tx = drag.tx + (screen[0] - drag.startScreen[0]);
    view.ty = drag.ty + (screen[1] - drag.startScreen[1]);
    render();
  }
});

window.addEventListener('mouseup', (event) => {
  if (!drag) return;
  const screen = pointFromEvent(event);
  if (drag.kind === 'region') {
    const endData = view.toData(screen);
    const x = Math.min(drag.startData[0], endData[0]);
    const y = Math.min(drag.startData[1], endData[1]);
    const w = Math.abs(endData[0] - drag.startData[0]);
    const h = Math.abs(endData[1] - drag.startData[1]);
    if (w > 0.2 && h > 0.2) {
      const text = prompt('区域标注文字：', '自定义区域');
      if (text) {
        store.add({
          type: 'region',
          anchor: [x + w / 2, y + h / 2],
          rect: { x, y, w, h },
          text,
          priority: 0,
        });
      }
    }
  } else if (tool === 'text' || tool === 'arrow') {
    const [dx, dy] = view.toData(screen);
    const text = prompt(`${tool === 'arrow' ? '箭头' : '文字'}标注内容：`, '新标注');
    if (text) {
      store.add({
        type: tool,
        anchor: [round(dx), round(dy)],
        text,
        priority: 1,
        color: tool === 'arrow' ? '#d1242f' : '#1f6feb',
      });
    }
  }
  drag = null;
  render();
});

function round(value) {
  return Math.round(value * 100) / 100;
}

document.querySelectorAll('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    tool = tool === button.dataset.tool ? null : button.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((b) =>
      b.classList.toggle('active', b.dataset.tool === tool));
    svg.classList.toggle('placing', tool !== null && tool !== 'region');
  });
});

document.getElementById('reset-view').addEventListener('click', () => {
  view = makeView();
  baseScale = view.scaleX;
  render();
});
document.getElementById('zoom-in').addEventListener('click', () => {
  view.zoomAt([view.width / 2, view.height / 2], 1.3);
  render();
});
document.getElementById('zoom-out').addEventListener('click', () => {
  view.zoomAt([view.width / 2, view.height / 2], 1 / 1.3);
  render();
});

document.getElementById('export-svg').addEventListener('click', () => {
  downloadSvg(renderSvg(sampleSeries, currentLayout(), view));
});
document.getElementById('export-png').addEventListener('click', () => {
  const result = exportPng(sampleSeries, currentLayout(), view, { scale: 3 });
  console.info('PNG 导出', result);
});

window.addEventListener('resize', () => {
  const rect = stage.getBoundingClientRect();
  view.resize(Math.round(rect.width), Math.round(rect.height));
  render();
});

let baseScale;
view = makeView();
baseScale = view.scaleX;
render();

// Exposed for automated checks in the headless browser.
window.__chart = { view, store, sampleSeries, layout: currentLayout, renderSvg };
