import {
  PAPER_SIZES, createState, panelWidth, panelOf, safeRect,
  validateExport, addText, addImage, moveElement, worldToScreen, toSVG,
} from './model.js';

const SCALE = 3; // px / mm
const FOCAL = 900; // mm，与 model 投影一致

let state = createState('A4');
let selectedId = null;
const imageCache = new Map(); // dataUrl -> HTMLImageElement

const sheet = document.getElementById('sheet');
const statusEl = document.getElementById('status');
const angleRange = document.getElementById('angleRange');
const angleVal = document.getElementById('angleVal');

function loadImage(dataUrl) {
  if (!imageCache.has(dataUrl)) {
    const img = new Image();
    img.src = dataUrl;
    imageCache.set(dataUrl, img);
  }
  return imageCache.get(dataUrl);
}

// ---- 渲染：三个面板用 CSS 3D 绕折痕旋转，元素放在所属面板内 ----
// 元素位置 = 世界坐标 - 面板偏移，折叠角度只改面板 transform，
// 因此切换角度不会改变元素世界坐标。

function render() {
  const pw = panelWidth(state);
  const W = state.paper.width, H = state.paper.height;
  sheet.style.width = `${W * SCALE}px`;
  sheet.style.height = `${H * SCALE}px`;
  sheet.innerHTML = '';

  const angle = state.foldAngle;
  const transforms = [
    `rotateY(${angle}deg)`,   // 左面板：origin 在右边缘（折痕）
    'none',                   // 中面板固定
    `rotateY(${-angle}deg)`,  // 右面板：origin 在左边缘（折痕）
  ];
  const origins = ['right center', 'center center', 'left center'];
  const errors = validateExport(state);
  const invalidIds = new Set(
    state.elements.filter((el) => {
      const r = safeRect(state, panelOf(state, el));
      return el.x < r.x || el.y < r.y ||
        el.x + el.w > r.x + r.w || el.y + el.h > r.y + r.h;
    }).map((el) => el.id)
  );

  for (let i = 0; i < 3; i++) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.left = `${i * pw * SCALE}px`;
    panel.style.width = `${pw * SCALE}px`;
    panel.style.height = `${H * SCALE}px`;
    panel.style.transformOrigin = origins[i];
    panel.style.transform = transforms[i];

    const safe = safeRect(state, i);
    const safeDiv = document.createElement('div');
    safeDiv.className = 'safe';
    safeDiv.style.left = `${(safe.x - i * pw) * SCALE}px`;
    safeDiv.style.top = `${safe.y * SCALE}px`;
    safeDiv.style.width = `${safe.w * SCALE}px`;
    safeDiv.style.height = `${safe.h * SCALE}px`;
    panel.appendChild(safeDiv);

    for (const el of state.elements) {
      if (panelOf(state, el) !== i) continue;
      const div = document.createElement('div');
      div.className = 'el';
      if (el.id === selectedId) div.classList.add('selected');
      if (invalidIds.has(el.id)) div.classList.add('invalid');
      div.dataset.id = el.id;
      div.style.left = `${(el.x - i * pw) * SCALE}px`;
      div.style.top = `${el.y * SCALE}px`;
      div.style.width = `${el.w * SCALE}px`;
      div.style.height = `${el.h * SCALE}px`;
      if (el.type === 'text') {
        const span = document.createElement('span');
        span.textContent = el.text;
        span.style.fontSize = `${el.fontSize * SCALE}px`;
        span.style.color = el.color;
        div.appendChild(span);
      } else {
        div.appendChild(loadImage(el.dataUrl));
      }
      panel.appendChild(div);
    }
    sheet.appendChild(panel);
  }

  if (errors.length) {
    statusEl.className = 'err';
    statusEl.textContent = `禁止导出：${errors.join('；')}`;
  } else {
    statusEl.className = 'ok';
    statusEl.textContent = '所有元素均在分页安全区内，可以导出。';
  }
  document.getElementById('exportSvgBtn').disabled = errors.length > 0;
  document.getElementById('exportPngBtn').disabled = errors.length > 0;
}
// ---- 拖拽：屏幕位移 -> 世界坐标位移 ----
// 在元素中心处对投影做数值雅可比求逆，折叠态（含折过 90°）下拖动
// 依然准确，且只写世界坐标，与当前折叠角度无关。

function screenDeltaToWorld(el, dxPx, dyPx) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const s0 = worldToScreen(state, cx, cy, FOCAL);
  const sx = worldToScreen(state, cx + 1, cy, FOCAL);
  const sy = worldToScreen(state, cx, cy + 1, FOCAL);
  const a = (sx.x - s0.x) * SCALE, b = (sy.x - s0.x) * SCALE;
  const c = (sx.y - s0.y) * SCALE, d = (sy.y - s0.y) * SCALE;
  const det = a * d - b * c || 1e-9;
  return {
    dx: (d * dxPx - b * dyPx) / det,
    dy: (-c * dxPx + a * dyPx) / det,
  };
}

let drag = null;
sheet.addEventListener('pointerdown', (e) => {
  const div = e.target.closest('.el');
  if (!div) { selectedId = null; render(); return; }
  const id = Number(div.dataset.id);
  selectedId = id;
  const el = state.elements.find((it) => it.id === id);
  drag = { id, startX: e.clientX, startY: e.clientY, el };
  sheet.setPointerCapture(e.pointerId);
  render();
});
sheet.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { dx, dy } = screenDeltaToWorld(
    drag.el, e.clientX - drag.startX, e.clientY - drag.startY
  );
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  moveElement(state, drag.id, drag.el.x + dx, drag.el.y + dy);
  render();
});
sheet.addEventListener('pointerup', () => { drag = null; });

// ---- 工具栏 ----

document.getElementById('paperSel').addEventListener('change', (e) => {
  const key = e.target.value;
  state.paperKey = key;
  state.paper = PAPER_SIZES[key];
  render();
});

angleRange.addEventListener('input', () => {
  state.foldAngle = Number(angleRange.value);
  angleVal.textContent = `${state.foldAngle}°`;
  render(); // 只改面板 transform，元素世界坐标不变
});

document.getElementById('addTextBtn').addEventListener('click', () => {
  const text = document.getElementById('textInput').value.trim() || '文字';
  const pw = panelWidth(state);
  addText(state, text, pw + 10, 20); // 默认放在中面板安全区内
  render();
});

const fileInput = document.getElementById('fileInput');
document.getElementById('addImageBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const pw = panelWidth(state);
    addImage(state, reader.result, pw + 10, 60, 40, 40);
    render();
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

document.getElementById('delBtn').addEventListener('click', () => {
  if (selectedId == null) return;
  state.elements = state.elements.filter((el) => el.id !== selectedId);
  selectedId = null;
  render();
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function guardExport() {
  const errors = validateExport(state);
  if (errors.length) {
    statusEl.className = 'err';
    statusEl.textContent = `已阻止导出：${errors.join('；')}`;
    return false;
  }
  return true;
}

document.getElementById('exportSvgBtn').addEventListener('click', () => {
  if (!guardExport()) return;
  download(new Blob([toSVG(state)], { type: 'image/svg+xml' }), 'trifold-flat.svg');
});
// ---- 当前视角 PNG 导出 ----
// 用模型投影把每个面板四角投到屏幕，仿射近似绘制面板内容。

function drawPanelToCanvas(ctx, i) {
  const pw = panelWidth(state);
  const H = state.paper.height;
  const x0 = i * pw;
  const p00 = worldToScreen(state, x0, 0, FOCAL);
  const p10 = worldToScreen(state, x0 + pw, 0, FOCAL);
  const p01 = worldToScreen(state, x0, H, FOCAL);
  ctx.save();
  // 局部坐标使用 mm，变换矩阵负责 mm -> 屏幕 px
  ctx.transform(
    (p10.x - p00.x) / pw * SCALE, (p10.y - p00.y) / pw * SCALE,
    (p01.x - p00.x) / H * SCALE, (p01.y - p00.y) / H * SCALE,
    p00.x * SCALE, p00.y * SCALE
  );
  ctx.beginPath();
  ctx.rect(0, 0, pw, H);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pw, H);

  const safe = safeRect(state, i);
  ctx.strokeStyle = '#3a7';
  ctx.setLineDash([2, 2]);
  ctx.lineWidth = 0.4;
  ctx.strokeRect(safe.x - x0, safe.y, safe.w, safe.h);
  ctx.setLineDash([]);

  for (const el of state.elements) {
    if (panelOf(state, el) !== i) continue;
    const lx = el.x - x0, ly = el.y;
    if (el.type === 'text') {
      ctx.fillStyle = el.color;
      ctx.font = `${el.fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(el.text, lx, ly);
    } else {
      const img = imageCache.get(el.dataUrl);
      if (img && img.complete) {
        ctx.drawImage(img, lx, ly, el.w, el.h);
      }
    }
  }
  ctx.restore();
}

document.getElementById('exportPngBtn').addEventListener('click', () => {
  if (!guardExport()) return;
  const W = state.paper.width, H = state.paper.height;
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE * 1.2;
  canvas.height = H * SCALE * 1.4;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate((canvas.width - W * SCALE) / 2, (canvas.height - H * SCALE) / 2);
  // 先画两侧（可能被中面板遮挡的部分），再画中面板
  drawPanelToCanvas(ctx, 0);
  drawPanelToCanvas(ctx, 2);
  drawPanelToCanvas(ctx, 1);
  canvas.toBlob((blob) => download(blob, 'trifold-view.png'), 'image/png');
});

// ---- 初始示例内容（均在世界坐标 / 安全区内）----
addText(state, '三折页标题', panelWidth(state) + 10, 20, { fontSize: 8 });
addText(state, '左侧面板文案', 10, 40, { fontSize: 5 });
addText(state, '右侧面板文案', 2 * panelWidth(state) + 10, 40, { fontSize: 5 });
render();

// 调试 / 自动化测试钩子
window.__app = { get state() { return state; }, render };
