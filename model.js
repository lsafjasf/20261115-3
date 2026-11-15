// 三折页核心模型：纸张、折痕几何、安全区校验、SVG 导出。
// 该模块同时被浏览器 (app.js) 与 Node 验证脚本 (test/verify.mjs) 使用。
// 所有元素坐标均为"世界坐标"：展开平面图上的毫米坐标，与折叠角度无关。

export const PAPER_SIZES = {
  A4: { width: 297, height: 210 }, // 横向
  A3: { width: 420, height: 297 },
  A5: { width: 210, height: 148 },
};

export const DEFAULT_SAFE_MARGIN = 5; // mm，每个面板四周的安全区边距

export function createState(paperKey = 'A4') {
  const paper = PAPER_SIZES[paperKey];
  return {
    paperKey,
    paper,
    foldAngle: 60, // 度，0 = 完全展开
    safeMargin: DEFAULT_SAFE_MARGIN,
    elements: [], // { id, type:'text'|'image', x, y, w, h, ... } 世界坐标 mm
    nextId: 1,
  };
}

export function panelWidth(state) {
  return state.paper.width / 3;
}

// 元素所属面板：按中心点 x 判定，返回 0/1/2
export function panelOf(state, el) {
  const pw = panelWidth(state);
  const cx = el.x + el.w / 2;
  return Math.min(2, Math.max(0, Math.floor(cx / pw)));
}

// 面板 i 的安全区（世界坐标）
export function safeRect(state, i) {
  const pw = panelWidth(state);
  const m = state.safeMargin;
  return {
    x: i * pw + m,
    y: m,
    w: pw - 2 * m,
    h: state.paper.height - 2 * m,
  };
}

// 校验：元素必须完整落在某一个面板的安全区内。
// 返回错误信息数组，空数组表示可以导出。
export function validateExport(state) {
  const errors = [];
  for (const el of state.elements) {
    const i = panelOf(state, el);
    const r = safeRect(state, i);
    const label = el.type === 'text' ? `文字"${el.text}"` : `图片#${el.id}`;
    if (
      el.x < r.x || el.y < r.y ||
      el.x + el.w > r.x + r.w || el.y + el.h > r.y + r.h
    ) {
      errors.push(`${label} 越过第 ${i + 1} 版分页安全区`);
    }
  }
  return errors;
}
// ---- 折叠几何 ----
// 场景坐标：X 向右、Y 向下、Z 朝向观察者。中间面板固定在 z=0 平面，
// 左右面板分别绕两条竖直折痕向观察者方向折起 foldAngle 度。

export function worldToScene(state, wx, wy) {
  const pw = panelWidth(state);
  const t = (state.foldAngle * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  if (wx < pw) {
    const dx = wx - pw; // <= 0
    return { x: pw + dx * cos, y: wy, z: -dx * sin };
  }
  if (wx >= 2 * pw) {
    const dx = wx - 2 * pw; // >= 0
    return { x: 2 * pw + dx * cos, y: wy, z: dx * sin };
  }
  return { x: wx, y: wy, z: 0 };
}

// 透视投影：相机在场景中心后方 focal 距离处，返回屏幕坐标（mm 场景单位）。
export function project(state, scene, focal = 900) {
  const cx = state.paper.width / 2;
  const cy = state.paper.height / 2;
  const s = focal / (focal - scene.z);
  return {
    x: cx + (scene.x - cx) * s,
    y: cy + (scene.y - cy) * s,
    scale: s,
  };
}

// 世界坐标 -> 当前折叠视角下的屏幕坐标
export function worldToScreen(state, wx, wy, focal = 900) {
  return project(state, worldToScene(state, wx, wy), focal);
}

// ---- 元素操作（只改世界坐标，与折叠角度无关）----

export function addText(state, text, x, y, opts = {}) {
  const el = {
    id: state.nextId++,
    type: 'text',
    text,
    x, y,
    w: opts.w ?? Math.max(10, text.length * (opts.fontSize ?? 5) * 0.7),
    h: opts.h ?? (opts.fontSize ?? 5) * 1.4,
    fontSize: opts.fontSize ?? 5, // mm
    color: opts.color ?? '#1a1a2e',
  };
  state.elements.push(el);
  return el;
}

export function addImage(state, dataUrl, x, y, w, h) {
  const el = { id: state.nextId++, type: 'image', dataUrl, x, y, w, h };
  state.elements.push(el);
  return el;
}

export function moveElement(state, id, x, y) {
  const el = state.elements.find((e) => e.id === id);
  if (!el) return null;
  el.x = x;
  el.y = y;
  return el;
}
// ---- 展开图 SVG 导出 ----

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toSVG(state, { showGuides = true } = {}) {
  const { width: W, height: H } = state.paper;
  const pw = panelWidth(state);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  for (const el of state.elements) {
    if (el.type === 'text') {
      parts.push(
        `<text x="${el.x}" y="${el.y + el.fontSize}" font-size="${el.fontSize}" ` +
        `fill="${esc(el.color)}" font-family="sans-serif">${esc(el.text)}</text>`
      );
    } else {
      parts.push(
        `<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ` +
        `xlink:href="${el.dataUrl}" preserveAspectRatio="none"/>`
      );
    }
  }
  if (showGuides) {
    for (const gx of [pw, 2 * pw]) {
      parts.push(
        `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#c00" ` +
        `stroke-width="0.3" stroke-dasharray="3 2"/>`
      );
    }
    for (let i = 0; i < 3; i++) {
      const r = safeRect(state, i);
      parts.push(
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" ` +
        `stroke="#3a7" stroke-width="0.2" stroke-dasharray="2 2"/>`
      );
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}
