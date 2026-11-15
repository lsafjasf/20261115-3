import "./style.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-700.css";
import { buildArtworkAssets } from "./art.js";
import {
  canvasToBlob,
  calculateLayout,
  createSequenceJson,
  downloadBlob,
  drawLongImage,
} from "./exporter.js";

document.querySelector("#app").innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark"><i></i><i></i><i></i><i></i></span>
      <span class="brand-name">拼贴长卷<small>COLLAGE STRIP</small></span>
    </div>
    <div class="topbar-status"><span class="status-dot"></span>8 组程序图像</div>
    <div class="topbar-actions">
      <button class="button button-ghost" id="export-json">序列 JSON</button>
      <button class="button button-primary" id="export-png">导出长图</button>
    </div>
  </header>
  <main class="workspace">
    <section class="stage-panel">
      <div class="stage-heading">
        <div>
          <span class="eyebrow">SCROLL CANVAS / 01</span>
          <h1>纵向拼贴序列</h1>
        </div>
        <div class="stage-count"><b id="group-count">08</b><span>GROUPS</span></div>
      </div>
      <div class="scroll-shell">
        <div class="edge-fade edge-fade-top"></div>
        <div class="scroller" id="scroller">
          <div class="sequence" id="sequence"></div>
          <div class="sequence-end">END OF STRIP <span>↓</span></div>
        </div>
        <div class="edge-fade edge-fade-bottom"></div>
      </div>
      <div class="stage-footer">
        <span>拖动右侧手柄重新排序</span>
        <span class="stage-footer-tip">滚轮浏览 · 点击选中</span>
      </div>
    </section>
    <aside class="inspector">
      <div class="inspector-heading">
        <span class="eyebrow">GROUP SETTINGS</span>
        <span class="inspector-index" id="inspector-index">01 / 08</span>
      </div>
      <div id="inspector"></div>
    </aside>
  </main>
  <div class="toast" id="toast" role="status"></div>
`;

const sequence = document.querySelector("#sequence");
const scroller = document.querySelector("#scroller");
const inspector = document.querySelector("#inspector");
const groupCount = document.querySelector("#group-count");
const inspectorIndex = document.querySelector("#inspector-index");
const toast = document.querySelector("#toast");
const exportPngButton = document.querySelector("#export-png");
const exportJsonButton = document.querySelector("#export-json");

const DEFAULT_SETTINGS = {
  tidal: { scale: 1.04, spacing: 42, align: "left" },
  echo: { scale: 0.94, spacing: 64, align: "center" },
  field: { scale: 1.12, spacing: 34, align: "right" },
  orbit: { scale: 0.9, spacing: 58, align: "center" },
  garden: { scale: 1, spacing: 46, align: "left" },
  citrus: { scale: 0.95, spacing: 38, align: "right" },
  aqua: { scale: 1.08, spacing: 70, align: "center" },
  night: { scale: 0.88, spacing: 36, align: "left" },
};

const assets = buildArtworkAssets();
const state = {
  items: assets.map((asset) => ({
    ...asset.spec,
    canvas: asset.canvas,
    url: asset.url,
    ...DEFAULT_SETTINGS[asset.spec.id],
  })),
  selectedId: assets[0].spec.id,
};

groupCount.textContent = String(state.items.length).padStart(2, "0");

function getSelectedItem() {
  return state.items.find((item) => item.id === state.selectedId) ?? state.items[0];
}

function cardWidthPercent(scale) {
  return (72 * scale).toFixed(2);
}

function renderSequence() {
  sequence.innerHTML = state.items
    .map((item, index) => {
      const selected = item.id === state.selectedId;
      return `
        <article
          class="group-card${selected ? " is-selected" : ""}"
          data-id="${item.id}"
          data-align="${item.align}"
          data-order-index="${index}"
          style="width: ${cardWidthPercent(item.scale)}%; margin-bottom: ${item.spacing}px"
        >
          <button
            class="art-frame"
            type="button"
            data-select-id="${item.id}"
            aria-label="选择第 ${index + 1} 组：${item.title}"
            aria-pressed="${selected}"
          >
            <img src="${item.url}" alt="${item.title}，${item.english}，程序生成拼贴图" draggable="false" />
            <span class="selection-tag">SELECTED / ${item.number}</span>
          </button>
          <button
            class="drag-handle"
            type="button"
            data-drag-id="${item.id}"
            aria-label="拖动第 ${index + 1} 组重新排序"
            aria-describedby="drag-help"
          >
            <span class="drag-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
          </button>
        </article>
      `;
    })
    .join("");
}

function applyCardGeometry(card, item) {
  card.style.width = `${cardWidthPercent(item.scale)}%`;
  card.style.marginBottom = `${item.spacing}px`;
  card.dataset.align = item.align;
}

function selectItem(id, options = {}) {
  if (!state.items.some((item) => item.id === id)) return;
  state.selectedId = id;
  sequence.querySelectorAll(".group-card").forEach((card) => {
    const selected = card.dataset.id === id;
    card.classList.toggle("is-selected", selected);
    const frame = card.querySelector(".art-frame");
    frame?.setAttribute("aria-pressed", String(selected));
  });
  renderInspector();
  if (options.scrollIntoView) {
    sequence.querySelector(`[data-id="${id}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

function renderInspector() {
  const item = getSelectedItem();
  const index = state.items.findIndex((candidate) => candidate.id === item.id);
  const scaleFill = ((item.scale * 100 - 70) / 55) * 100;
  const spacingFill = (item.spacing / 160) * 100;
  inspectorIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${String(
    state.items.length,
  ).padStart(2, "0")}`;

  inspector.innerHTML = `
    <div class="inspector-preview">
      <div class="inspector-thumb">
        <img src="${item.url}" alt="${item.title}缩略图" />
      </div>
      <div class="inspector-meta">
        <span class="inspector-kicker">FRAME ${item.number} · GENERATED</span>
        <h2 class="inspector-title">${item.title}</h2>
        <p class="inspector-subtitle">${item.english} / SEED ${item.seed}</p>
        <div class="inspector-position" aria-label="序列位置">
          ${state.items
            .map(
              (candidate, tickIndex) =>
                `<span class="position-tick${tickIndex === index ? " is-active" : ""}"></span>`,
            )
            .join("")}
        </div>
      </div>
    </div>

    <div class="control-block">
      <div class="control-head">
        <div class="control-label">
          <b>缩放</b>
          <span>GROUP SCALE</span>
        </div>
        <div class="control-value" id="scale-value">${Math.round(item.scale * 100)}<small>%</small></div>
      </div>
      <div class="range-wrap">
        <input
          class="range"
          id="scale-range"
          type="range"
          min="70"
          max="125"
          step="1"
          value="${Math.round(item.scale * 100)}"
          style="--fill: ${scaleFill}%"
          aria-label="第 ${index + 1} 组缩放"
        />
      </div>
      <div class="scale-marks"><span>70%</span><span>100%</span><span>125%</span></div>
    </div>

    <div class="control-block">
      <div class="control-head">
        <div class="control-label">
          <b>组后间距</b>
          <span>SPACING AFTER</span>
        </div>
        <div class="control-value" id="spacing-value">${item.spacing}<small>px</small></div>
      </div>
      <div class="range-wrap">
        <input
          class="range"
          id="spacing-range"
          type="range"
          min="0"
          max="160"
          step="1"
          value="${item.spacing}"
          style="--fill: ${spacingFill}%"
          aria-label="第 ${index + 1} 组后间距"
        />
      </div>
      <div class="scale-marks"><span>0 PX</span><span>80</span><span>160 PX</span></div>
    </div>

    <div class="align-control">
      <div class="control-label">
        <b>组对齐</b>
        <span>COLLAGE ALIGNMENT</span>
      </div>
      <div class="align-options">
        ${["left", "center", "right"]
          .map(
            (align) => `
              <button
                class="align-button"
                type="button"
                data-align-value="${align}"
                aria-pressed="${item.align === align}"
              >${align.toUpperCase()}</button>
            `,
          )
          .join("")}
      </div>
    </div>

    <div class="inspector-note" id="drag-help">
      <strong>组 ${String(index + 1).padStart(2, "0")}</strong> · 当前顺序下的独立间距与缩放。<br />
      拖动图像右侧手柄重新排序；导出时会使用同一组参数。
    </div>

    <div class="inspector-actions">
      <button class="button button-ghost button-compact" id="reset-group" type="button">恢复本组</button>
      <button class="button button-ghost button-compact" id="scroll-top" type="button">回到顶部</button>
    </div>
  `;
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

renderSequence();
renderInspector();

sequence.addEventListener("click", (event) => {
  const frame = event.target.closest(".art-frame");
  if (!frame) return;
  selectItem(frame.dataset.selectId);
});

inspector.addEventListener("input", (event) => {
  const item = getSelectedItem();
  const card = sequence.querySelector(`[data-id="${item.id}"]`);
  if (!card) return;

  if (event.target.id === "scale-range") {
    const percent = Number(event.target.value);
    item.scale = percent / 100;
    applyCardGeometry(card, item);
    event.target.style.setProperty("--fill", `${((percent - 70) / 55) * 100}%`);
    const value = inspector.querySelector("#scale-value");
    if (value) value.innerHTML = `${percent}<small>%</small>`;
  }

  if (event.target.id === "spacing-range") {
    const spacing = Number(event.target.value);
    item.spacing = spacing;
    applyCardGeometry(card, item);
    event.target.style.setProperty("--fill", `${(spacing / 160) * 100}%`);
    const value = inspector.querySelector("#spacing-value");
    if (value) value.innerHTML = `${spacing}<small>px</small>`;
  }
});

inspector.addEventListener("click", (event) => {
  const item = getSelectedItem();
  const card = sequence.querySelector(`[data-id="${item.id}"]`);

  const alignButton = event.target.closest("[data-align-value]");
  if (alignButton) {
    item.align = alignButton.dataset.alignValue;
    if (card) applyCardGeometry(card, item);
    inspector.querySelectorAll("[data-align-value]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.alignValue === item.align),
      );
    });
    return;
  }

  if (event.target.closest("#reset-group")) {
    Object.assign(item, DEFAULT_SETTINGS[item.id]);
    if (card) applyCardGeometry(card, item);
    renderInspector();
    showToast(`第 ${item.number} 组参数已恢复`);
    return;
  }

  if (event.target.closest("#scroll-top")) {
    scroller.scrollTo({ top: 0, behavior: "smooth" });
  }
});

let dragState = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positionDragProxy(clientY) {
  if (!dragState?.proxy) return;
  dragState.proxy.style.top = `${clientY - dragState.grabOffsetY}px`;
}

function updateDragTarget(clientY) {
  if (!dragState?.indicator) return;
  const remainingCards = [...sequence.querySelectorAll(".group-card")].filter(
    (card) => card.dataset.id !== dragState.id,
  );
  if (!remainingCards.length) return;

  const sequenceTop = sequence.getBoundingClientRect().top;
  let insertAt = remainingCards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  if (insertAt === -1) insertAt = remainingCards.length;
  dragState.targetIndex = insertAt;

  let lineTop;
  if (insertAt === 0) {
    lineTop = remainingCards[0].getBoundingClientRect().top - sequenceTop - 5;
  } else if (insertAt === remainingCards.length) {
    const lastRect = remainingCards.at(-1).getBoundingClientRect();
    lineTop = lastRect.bottom - sequenceTop + 5;
  } else {
    lineTop = remainingCards[insertAt].getBoundingClientRect().top - sequenceTop - 5;
  }
  dragState.indicator.style.top = `${lineTop}px`;
}

function stopAutoScroll() {
  if (!dragState) return;
  if (dragState.scrollFrame) cancelAnimationFrame(dragState.scrollFrame);
  dragState.scrollFrame = null;
  dragState.scrollDirection = 0;
}

function runAutoScroll() {
  if (!dragState?.active) {
    stopAutoScroll();
    return;
  }

  if (dragState.scrollDirection) {
    scroller.scrollTop += dragState.scrollDirection * 14;
    updateDragTarget(dragState.lastClientY);
  }

  if (dragState.scrollDirection) {
    dragState.scrollFrame = requestAnimationFrame(runAutoScroll);
  } else {
    dragState.scrollFrame = null;
  }
}

function updateAutoScroll(clientY) {
  if (!dragState?.active) return;
  const rect = scroller.getBoundingClientRect();
  const threshold = 72;
  let direction = 0;
  if (clientY < rect.top + threshold) direction = -1;
  if (clientY > rect.bottom - threshold) direction = 1;
  dragState.scrollDirection = direction;

  if (direction && !dragState.scrollFrame) {
    dragState.scrollFrame = requestAnimationFrame(runAutoScroll);
  } else if (!direction && dragState.scrollFrame) {
    cancelAnimationFrame(dragState.scrollFrame);
    dragState.scrollFrame = null;
  }
}

function activateDrag() {
  if (!dragState || dragState.active) return;
  dragState.active = true;
  dragState.card.classList.add("is-dragging");
  document.body.classList.add("is-reordering");

  const proxy = dragState.card.cloneNode(true);
  proxy.classList.remove("is-selected", "is-dragging", "is-drop-target");
  proxy.classList.add("drag-proxy");
  proxy.removeAttribute("data-order-index");
  proxy.style.width = `${dragState.sourceRect.width}px`;
  proxy.style.marginBottom = "0";
  proxy.style.top = `${dragState.lastClientY - dragState.grabOffsetY}px`;
  proxy.style.left = `${dragState.sourceRect.left}px`;
  proxy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  proxy.querySelector(".drag-handle")?.remove();
  document.body.append(proxy);

  const indicator = document.createElement("div");
  indicator.className = "drop-indicator";
  sequence.append(indicator);
  dragState.proxy = proxy;
  dragState.indicator = indicator;
  updateDragTarget(dragState.lastClientY);
}

function endDrag(pointerId, cancelled = false) {
  if (!dragState || dragState.pointerId !== pointerId) return;
  const finished = dragState;
  stopAutoScroll();
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", handleDragEnd);
  window.removeEventListener("pointercancel", handleDragCancel);
  window.removeEventListener("keydown", handleDragKey);

  finished.proxy?.remove();
  finished.indicator?.remove();
  finished.card.classList.remove("is-dragging");
  document.body.classList.remove("is-reordering");
  dragState = null;

  if (!finished.active || cancelled) return;

  const sourceIndex = state.items.findIndex((item) => item.id === finished.id);
  const targetIndex = clamp(finished.targetIndex ?? sourceIndex, 0, state.items.length - 1);
  if (sourceIndex === targetIndex) return;

  const scrollTop = scroller.scrollTop;
  const [moved] = state.items.splice(sourceIndex, 1);
  state.items.splice(targetIndex, 0, moved);
  renderSequence();
  scroller.scrollTop = scrollTop;
  selectItem(moved.id);
  showToast(`第 ${moved.number} 组已移动到第 ${targetIndex + 1} 位`);
}

function handleDragMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.lastClientY = event.clientY;

  if (!dragState.active) {
    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );
    if (distance < 6) return;
    activateDrag();
  }

  event.preventDefault();
  positionDragProxy(event.clientY);
  updateDragTarget(event.clientY);
  updateAutoScroll(event.clientY);
}

function handleDragEnd(event) {
  endDrag(event.pointerId);
}

function handleDragCancel(event) {
  endDrag(event.pointerId, true);
}

function handleDragKey(event) {
  if (event.key === "Escape" && dragState) {
    endDrag(dragState.pointerId, true);
  }
}

sequence.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".drag-handle");
  if (!handle || event.button !== 0) return;
  const card = handle.closest(".group-card");
  const rect = card.getBoundingClientRect();
  selectItem(card.dataset.id);

  dragState = {
    id: card.dataset.id,
    card,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastClientY: event.clientY,
    grabOffsetY: event.clientY - rect.top,
    sourceRect: rect,
    active: false,
    targetIndex: null,
    proxy: null,
    indicator: null,
    scrollDirection: 0,
    scrollFrame: null,
  };

  window.addEventListener("pointermove", handleDragMove, { passive: false });
  window.addEventListener("pointerup", handleDragEnd);
  window.addEventListener("pointercancel", handleDragCancel);
  window.addEventListener("keydown", handleDragKey);
  event.preventDefault();
});

sequence.addEventListener("keydown", (event) => {
  const handle = event.target.closest(".drag-handle");
  if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const id = handle.dataset.dragId;
  const index = state.items.findIndex((item) => item.id === id);
  const target = clamp(index + (event.key === "ArrowUp" ? -1 : 1), 0, state.items.length - 1);
  if (target === index) return;
  const scrollTop = scroller.scrollTop;
  const [moved] = state.items.splice(index, 1);
  state.items.splice(target, 0, moved);
  renderSequence();
  scroller.scrollTop = scrollTop;
  selectItem(id);
  sequence
    .querySelector(`[data-drag-id="${id}"]`)
    ?.focus({ preventScroll: true });
  showToast(`第 ${moved.number} 组已移动到第 ${target + 1} 位`);
});

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function exportLongImage() {
  exportPngButton.disabled = true;
  const originalText = exportPngButton.textContent;
  exportPngButton.textContent = "正在绘制…";
  try {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const { canvas } = drawLongImage(state.items);
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, `collage-strip-${timestamp()}.png`);
    showToast(`长图已导出 · ${canvas.width} × ${canvas.height} px · ${state.items.length} 组`);
  } catch (error) {
    console.error(error);
    showToast("长图导出失败，请重试", true);
  } finally {
    exportPngButton.disabled = false;
    exportPngButton.textContent = originalText;
  }
}

async function exportSequenceJson() {
  exportJsonButton.disabled = true;
  try {
    await document.fonts.ready;
    const layout = calculateLayout(state.items);
    const data = createSequenceJson(state.items, layout);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    downloadBlob(blob, `collage-sequence-${timestamp()}.json`);
    showToast(`序列 JSON 已导出 · 顺序 ${data.order.join(" → ")}`);
  } catch (error) {
    console.error(error);
    showToast("序列导出失败，请重试", true);
  } finally {
    exportJsonButton.disabled = false;
  }
}

exportPngButton.addEventListener("click", exportLongImage);
exportJsonButton.addEventListener("click", exportSequenceJson);

const topFade = document.querySelector(".edge-fade-top");
const bottomFade = document.querySelector(".edge-fade-bottom");

function syncScrollFades() {
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  topFade.style.opacity = scroller.scrollTop < 6 ? "0.35" : "1";
  bottomFade.style.opacity = scroller.scrollTop > maxScroll - 6 ? "0.35" : "1";
}

scroller.addEventListener("scroll", syncScrollFades, { passive: true });
syncScrollFades();

document.documentElement.style.setProperty("--vh", `${window.innerHeight}px`);

window.__collage = Object.freeze({
  getState() {
    return {
      selectedId: state.selectedId,
      order: state.items.map((item) => item.id),
      groups: state.items.map((item, index) => ({
        order: index + 1,
        id: item.id,
        number: item.number,
        scale: item.scale,
        spacing: item.spacing,
        align: item.align,
      })),
      scroll: {
        top: scroller.scrollTop,
        height: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      },
    };
  },
  getExportLayout() {
    return calculateLayout(state.items);
  },
});

window.addEventListener("resize", () => {
  document.documentElement.style.setProperty("--vh", `${window.innerHeight}px`);
});
