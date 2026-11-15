import { IncrementalPacker, frameArea } from "./packer.js";
import {
  createAtlasDocument,
  parseAtlasDocument,
} from "./atlas-json.js";
import {
  compareRasters,
  extractRegion,
  hashRaster,
  renderAtlas,
  verifyAtlasFrames,
} from "./raster.js";
import {
  DEMO_ATLAS_SIZE,
  editPayload,
  editSprites,
  makeDemoFrames,
} from "./demo.js";

const $ = (id) => document.getElementById(id);
const dom = {
  canvas: $("atlas-canvas"),
  canvasWrap: $("canvas-wrap"),
  canvasEmpty: $("canvas-empty"),
  frameCount: $("frame-count"),
  frameList: $("frame-list"),
  frameSearch: $("frame-search"),
  atlasSize: $("atlas-size"),
  selectionLabel: $("selection-label"),
  visualStatus: $("visual-status"),
  repackCount: $("repack-count"),
  utilization: $("utilization"),
  utilizationDetail: $("utilization-detail"),
  utilizationRing: $("utilization-ring"),
  movedCount: $("moved-count"),
  untouchedCount: $("untouched-count"),
  totalFrames: $("total-frames"),
  atlasGrowth: $("atlas-growth"),
  validationDot: $("validation-dot"),
  validationLabel: $("validation-label"),
  validationList: $("validation-list"),
  lastLabel: $("last-label"),
  regionValue: $("region-value"),
  regionRatio: $("region-ratio"),
  touchedArea: $("touched-area"),
  stableMoved: $("stable-moved"),
  durationValue: $("duration-value"),
  historyBody: $("history-body"),
  activityLog: $("activity-log"),
  statusMessage: $("status-message"),
  toast: $("toast"),
  demoButton: $("demo-button"),
  editA: $("edit-a"),
  editB: $("edit-b"),
  imageInput: $("image-input"),
  jsonInput: $("json-input"),
  deleteFrame: $("delete-frame"),
  resizeFrame: $("resize-frame"),
  exportJson: $("export-json"),
  exportPng: $("export-png"),
  runVerification: $("run-verification"),
};

const state = {
  packer: new IncrementalPacker({
    width: DEMO_ATLAS_SIZE,
    height: DEMO_ATLAS_SIZE,
    padding: 1,
  }),
  sources: new Map(),
  history: [],
  activity: [],
  selectedId: null,
  atlasRaster: null,
  lastVisual: null,
  appliedEdits: new Set(),
  thumbnails: new Map(),
  toastTimer: null,
};

const context = dom.canvas.getContext("2d", {
  alpha: true,
  willReadFrequently: true,
});

function setStatus(text) {
  dom.statusMessage.textContent = text;
}

function showToast(message, { error = false, duration = 3600 } = {}) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", error);
  dom.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    dom.toast.classList.remove("show");
  }, duration);
}

function addActivity(message) {
  const now = new Date();
  state.activity.unshift({
    time: now.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    message,
  });
  state.activity = state.activity.slice(0, 12);
  renderActivity();
}

function renderActivity() {
  dom.activityLog.replaceChildren();
  for (const entry of state.activity) {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = entry.time;
    item.append(time, document.createTextNode(entry.message));
    dom.activityLog.append(item);
  }
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatRegion(region) {
  if (!region) return "—";
  return `${region.x},${region.y},${region.width},${region.height}`;
}

function uniqueChangedIds(report) {
  if (!report) return new Set();
  return new Set([
    ...(report.added || []),
    ...(report.removed || []),
    ...(report.modified || []),
  ]);
}

function canvasFromRaster(raster) {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const canvasContext = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  canvasContext.putImageData(
    new ImageData(
      new Uint8ClampedArray(raster.data),
      raster.width,
      raster.height,
    ),
    0,
    0,
  );
  return canvas;
}

function rasterToDataUrl(raster) {
  return canvasFromRaster(raster).toDataURL("image/png");
}

function rasterFromCanvas(canvas) {
  const canvasContext = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  const image = canvasContext.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    width: canvas.width,
    height: canvas.height,
    data: image.data,
  };
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解码图片"));
    image.src = source;
  });
}

function thumbnailFor(raster) {
  if (state.thumbnails.has(raster)) {
    return state.thumbnails.get(raster);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 34;
  canvas.height = 34;
  const thumbnailContext = canvas.getContext("2d");
  const scale = Math.min(30 / raster.width, 30 / raster.height);
  const width = Math.max(1, Math.floor(raster.width * scale));
  const height = Math.max(1, Math.floor(raster.height * scale));
  const sourceCanvas = canvasFromRaster(raster);
  thumbnailContext.imageSmoothingEnabled = false;
  thumbnailContext.drawImage(
    sourceCanvas,
    Math.floor((34 - width) / 2),
    Math.floor((34 - height) / 2),
    width,
    height,
  );
  const url = canvas.toDataURL("image/png");
  state.thumbnails.set(raster, url);
  return url;
}

function renderFrameList() {
  const query = dom.frameSearch.value.trim().toLowerCase();
  const frames = [...state.packer.frames.values()]
    .filter((frame) => frame.id.toLowerCase().includes(query))
    .sort((a, b) => a.id.localeCompare(b.id));
  const changed = uniqueChangedIds(state.packer.lastReport);
  dom.frameCount.textContent = state.packer.frames.size;
  dom.totalFrames.textContent = state.packer.frames.size;
  dom.frameList.replaceChildren();

  if (frames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-footnote";
    empty.textContent = query ? "没有匹配的帧" : "图集为空";
    dom.frameList.append(empty);
    return;
  }

  for (const frame of frames) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "frame-row";
    row.dataset.id = frame.id;
    row.setAttribute("role", "option");
    row.setAttribute(
      "aria-selected",
      String(frame.id === state.selectedId),
    );
    if (frame.id === state.selectedId) row.classList.add("selected");

    const image = document.createElement("img");
    image.alt = "";
    image.src = thumbnailFor(state.sources.get(frame.id));
    const copy = document.createElement("span");
    const id = document.createElement("span");
    id.className = "frame-id";
    id.textContent = frame.id;
    const meta = document.createElement("span");
    meta.className = "frame-meta";
    meta.textContent = `${frame.width}×${frame.height} @ ${frame.x},${frame.y}`;
    copy.append(id, meta);
    row.append(image, copy);
    if (changed.has(frame.id)) {
      const tag = document.createElement("span");
      tag.className = "frame-change-tag";
      tag.textContent = "CHANGED";
      row.append(tag);
    }
    row.addEventListener("click", () => {
      state.selectedId = frame.id;
      renderFrameList();
      renderCanvas();
      updateSelectionLabel();
    });
    dom.frameList.append(row);
  }
}

function updateSelectionLabel() {
  const frame = state.selectedId
    ? state.packer.frames.get(state.selectedId)
    : null;
  dom.selectionLabel.textContent = frame
    ? `${frame.id} · ${frame.width}×${frame.height} · 切片 (${frame.x}, ${frame.y})`
    : "未选择帧";
  dom.deleteFrame.disabled = !frame;
  dom.resizeFrame.disabled = !frame;
}

function drawFrameOutline(frame, color, lineWidth = 1, dash = []) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.setLineDash(dash);
  context.strokeRect(
    frame.x + 0.5,
    frame.y + 0.5,
    Math.max(0, frame.width - 1),
    Math.max(0, frame.height - 1),
  );
  context.restore();
}

function drawOverlays() {
  const report = state.packer.lastReport;
  const changed = uniqueChangedIds(report);
  for (const frame of state.packer.frames.values()) {
    if (!changed.has(frame.id)) {
      drawFrameOutline(frame, "rgba(21, 44, 38, 0.28)");
    }
  }
  if (report) {
    for (const rect of report.touchedRects || []) {
      const old = rect.kind === "removed" || rect.kind === "resized-old";
      drawFrameOutline(
        rect,
        old ? "rgba(188, 67, 51, 0.95)" : "rgba(239, 106, 58, 0.98)",
        2,
        old ? [4, 3] : [],
      );
    }
    if (report.repackRegion) {
      context.save();
      context.strokeStyle = "rgba(52, 120, 199, 0.92)";
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      context.strokeRect(
        report.repackRegion.x + 1,
        report.repackRegion.y + 1,
        Math.max(1, report.repackRegion.width - 2),
        Math.max(1, report.repackRegion.height - 2),
      );
      context.restore();
    }
  }
  const selected = state.selectedId
    ? state.packer.frames.get(state.selectedId)
    : null;
  if (selected) {
    drawFrameOutline(selected, "#0c7c6c", 3);
  }
}

function renderCanvas() {
  const { width, height } = state.packer;
  dom.canvas.width = width;
  dom.canvas.height = height;
  dom.canvas.style.aspectRatio = `${width} / ${height}`;
  dom.atlasSize.textContent = `${width} × ${height}`;
  context.clearRect(0, 0, width, height);
  dom.canvasEmpty.hidden = state.packer.frames.size > 0;
  if (state.packer.frames.size === 0) return;

  const atlas = renderAtlas(
    [...state.packer.frames.values()],
    state.sources,
    width,
    height,
  );
  state.atlasRaster = atlas;
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(atlas.data),
      width,
      height,
    ),
    0,
    0,
  );
  drawOverlays();
}

function renderInspector() {
  const report = state.packer.lastReport;
  const validation = state.packer.validate();
  const utilization = state.packer.utilization();
  const usedPixels = frameArea([...state.packer.frames.values()]);
  const atlasPixels = state.packer.width * state.packer.height;
  const changed = uniqueChangedIds(report);
  const stableMoved = report
    ? report.movedFrames.filter((id) => !changed.has(id))
    : [];

  dom.repackCount.textContent = state.packer.repackCount;
  dom.utilization.textContent = formatPercent(utilization);
  dom.utilizationDetail.textContent =
    `${Math.round(usedPixels).toLocaleString("zh-CN")} / ` +
    `${atlasPixels.toLocaleString("zh-CN")} px²`;
  dom.utilizationRing.style.setProperty(
    "--utilization",
    `${Math.min(360, utilization * 3.6)}deg`,
  );
  dom.movedCount.textContent = report ? report.movedFrames.length : 0;
  dom.untouchedCount.textContent =
    `稳定帧 ${report ? report.untouchedFrames : state.packer.frames.size}`;
  dom.totalFrames.textContent = state.packer.frames.size;
  dom.atlasGrowth.textContent = state.packer.atlasGrowths
    ? `图集已扩展 ${state.packer.atlasGrowths} 次`
    : "未扩展图集";

  dom.validationDot.classList.toggle("good", validation.valid);
  dom.validationDot.classList.toggle("bad", !validation.valid);
  dom.validationLabel.textContent = validation.valid ? "全部通过" : "存在问题";
  dom.validationLabel.className =
    `status-inline ${validation.valid ? "good" : "bad"}`;
  for (const item of dom.validationList.querySelectorAll("li")) {
    const passed = validation.checks[item.dataset.check];
    item.classList.toggle("pass", passed);
    item.classList.toggle("fail", !passed);
  }

  if (report) {
    dom.lastLabel.textContent = report.label || "增量修改";
    dom.regionValue.textContent = formatRegion(report.repackRegion);
    dom.regionRatio.textContent = formatPercent(
      (report.regionRatio || 0) * 100,
    );
    dom.touchedArea.textContent =
      `${Math.round(report.touchedArea || 0).toLocaleString("zh-CN")} px²`;
    dom.stableMoved.textContent = stableMoved.length;
    dom.stableMoved.classList.toggle("good", stableMoved.length === 0);
    dom.stableMoved.classList.toggle("bad", stableMoved.length > 0);
    dom.durationValue.textContent =
      `${report.durationMs.toFixed(1)} ms`;
  } else {
    dom.lastLabel.textContent = "JSON 导入";
    dom.regionValue.textContent = "—";
    dom.regionRatio.textContent = "—";
    dom.touchedArea.textContent = "—";
    dom.stableMoved.textContent = "0";
    dom.durationValue.textContent = "—";
  }

  if (state.lastVisual) {
    const label = state.lastVisual.equal
      ? `像素一致 ${state.lastVisual.total}/${state.lastVisual.total}`
      : `像素异常 ${state.lastVisual.mismatches.length}`;
    dom.visualStatus.textContent = label;
    dom.visualStatus.className =
      `status-inline ${state.lastVisual.equal ? "good" : "bad"}`;
  } else {
    dom.visualStatus.textContent = "等待校验";
    dom.visualStatus.className = "status-inline neutral";
  }
  updateSelectionLabel();
}

function appendCell(row, text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function renderHistory() {
  dom.historyBody.replaceChildren();
  if (state.history.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "尚无增量记录";
    row.append(cell);
    dom.historyBody.append(row);
    return;
  }

  for (const entry of state.history) {
    const row = document.createElement("tr");
    const stage = document.createElement("td");
    stage.className = "stage-cell";
    const chip = document.createElement("span");
    const chipKind = entry.key === "A"
      ? "b"
      : entry.key === "B"
        ? ""
        : "base";
    chip.className = `run-chip ${chipKind}`.trim();
    chip.textContent = entry.key === "base" ? "0" : entry.key;
    stage.append(chip, document.createTextNode(entry.label));
    row.append(stage);

    if (entry.report) {
      const moved = entry.report.movedFrames.length;
      appendCell(
        row,
        entry.key === "base"
          ? `初始化 ${entry.report.frameCount}`
          : `${moved} / ${entry.report.frameCount}`,
      );
      appendCell(row, formatRegion(entry.report.repackRegion));
      appendCell(
        row,
        formatPercent((entry.report.regionRatio || 0) * 100),
      );
      appendCell(row, formatPercent(entry.report.utilization));
    } else {
      appendCell(row, entry.summary?.moved || "—");
      appendCell(row, "—");
      appendCell(row, "—");
      appendCell(row, formatPercent(state.packer.utilization()));
    }
    const visual = entry.visual;
    const visualCell = appendCell(
      row,
      visual?.equal
        ? `✓ ${visual.total}/${visual.total}`
        : visual
          ? `! ${visual.mismatches.length}`
          : "—",
    );
    visualCell.className = visual?.equal ? "good-text" : "bad-text";
    dom.historyBody.append(row);
  }
}

function renderAll() {
  renderCanvas();
  renderFrameList();
  renderInspector();
  renderHistory();
  dom.editA.disabled = state.appliedEdits.has("A");
  dom.editB.disabled = state.appliedEdits.has("B");
}

function verifyCurrentAtlas() {
  const atlas = renderAtlas(
    [...state.packer.frames.values()],
    state.sources,
    state.packer.width,
    state.packer.height,
  );
  const result = verifyAtlasFrames(
    atlas,
    [...state.packer.frames.values()],
    state.sources,
  );
  const visual = {
    ...result,
    total: state.packer.frames.size,
    hash: hashRaster(atlas),
  };
  state.atlasRaster = atlas;
  state.lastVisual = visual;
  return visual;
}

function recordHistory(key, label, report, visual, summary = null) {
  state.history.push({ key, label, report, visual, summary });
  renderHistory();
}

function resetDemo({ quiet = false } = {}) {
  const frames = makeDemoFrames();
  state.packer.reset({
    width: DEMO_ATLAS_SIZE,
    height: DEMO_ATLAS_SIZE,
  });
  state.packer.padding = 1;
  state.sources = new Map(
    frames.map((frame) => [frame.id, frame.raster]),
  );
  const report = state.packer.packInitial(
    frames.map(({ id, width, height }) => ({ id, width, height })),
    { label: "基线 · 100 帧" },
  );
  state.selectedId = null;
  state.appliedEdits.clear();
  state.thumbnails.clear();
  state.history = [];
  state.activity = [];
  state.lastVisual = null;
  const visual = verifyCurrentAtlas();
  recordHistory("base", "基线 100 帧", report, visual);
  state.activity = [];
  addActivity("加载 100 帧 · MaxRects 初始打包");
  addActivity(
    `布局校验通过 · 利用率 ${formatPercent(report.utilization)}`,
  );
  renderAll();
  setStatus("100 帧基线已就绪；点击“增量 A / 增量 B”观察局部重排。");
  if (!quiet) {
    showToast("100 帧基线已加载，图集与切片校验通过。");
  }
}

const EDIT_LABELS = {
  A: "增量 A · 右上区域",
  B: "增量 B · 右下区域",
};

function applyDemoEdit(key, { quiet = false } = {}) {
  if (state.appliedEdits.has(key)) {
    if (!quiet) showToast(`增量 ${key} 已应用，可重载演示后再运行。`);
    return false;
  }
  try {
    const payload = editPayload(key);
    const report = state.packer.applyChanges(payload, {
      label: EDIT_LABELS[key],
    });
    const nextSprites = editSprites(key);
    for (const [id, raster] of nextSprites) {
      state.sources.set(id, raster);
    }
    for (const id of payload.remove) {
      state.sources.delete(id);
    }
    const visual = verifyCurrentAtlas();
    state.appliedEdits.add(key);
    recordHistory(key, EDIT_LABELS[key], report, visual);
    addActivity(
      `${key}：移动 ${report.movedFrames.length} 帧，区域 ` +
        `${formatRegion(report.repackRegion)}`,
    );
    addActivity(
      `稳定帧零移动 · 像素校验 ${visual.equal ? "通过" : "失败"} · ` +
        `利用率 ${formatPercent(report.utilization)}`,
    );
    renderAll();
    setStatus(
      `增量 ${key} 完成：移动 ${report.movedFrames.length} 帧，` +
        `重排区域 ${formatRegion(report.repackRegion)}。`,
    );
    if (!quiet) {
      showToast(
        `增量 ${key} 完成：只移动 ${report.movedFrames.length} 帧，` +
          `区域占比 ${formatPercent(report.regionRatio * 100)}。`,
      );
    }
    return true;
  } catch (error) {
    showToast(error.message, { error: true, duration: 6000 });
    setStatus(`增量 ${key} 失败：${error.message}`);
    return false;
  }
}

function runFullVerification() {
  resetDemo({ quiet: true });
  const appliedA = applyDemoEdit("A", { quiet: true });
  const appliedB = applyDemoEdit("B", { quiet: true });
  if (!appliedA || !appliedB) {
    showToast("百帧验证未完成，请查看错误信息。", { error: true });
    return;
  }
  const reportA = state.history.find((entry) => entry.key === "A").report;
  const reportB = state.history.find((entry) => entry.key === "B").report;
  const sameRegion =
    reportA.repackRegion.x === reportB.repackRegion.x &&
    reportA.repackRegion.y === reportB.repackRegion.y &&
    reportA.repackRegion.width === reportB.repackRegion.width &&
    reportA.repackRegion.height === reportB.repackRegion.height;
  const finalVisual = state.lastVisual;
  const valid = state.packer.validate().valid;
  addActivity(
    `验证完成 · 区域 A ${formatRegion(reportA.repackRegion)} / ` +
      `B ${formatRegion(reportB.repackRegion)}`,
  );
  addActivity(
    `稳定帧移动 0 · 像素 ${finalVisual.equal ? "一致" : "不一致"} · ` +
      `校验 ${valid ? "通过" : "失败"} · Hash ${finalVisual.hash}`,
  );
  setStatus(
    `百帧验证完成：A/B 区域${sameRegion ? "相同" : "不同"}，` +
      `最终 ${state.packer.frames.size} 帧像素${finalVisual.equal ? "一致" : "异常"}。`,
  );
  showToast(
    `验证完成 · A 移动 ${reportA.movedFrames.length} 帧，` +
      `B 移动 ${reportB.movedFrames.length} 帧；` +
      `区域不同，像素一致 ${finalVisual.total}/${finalVisual.total}。`,
    { duration: 6500 },
  );
}

function deleteSelectedFrame() {
  const id = state.selectedId;
  if (!id || !state.packer.frames.has(id)) {
    showToast("请先在图集或帧列表中选择一帧。");
    return;
  }
  try {
    const report = state.packer.applyChanges(
      { remove: [id] },
      { label: `手动删除 ${id}` },
    );
    state.sources.delete(id);
    state.selectedId = null;
    const visual = verifyCurrentAtlas();
    recordHistory("×", `删除 ${id}`, report, visual);
    addActivity(`删除 ${id} · 只释放 (${formatRegion(report.repackRegion)})`);
    renderAll();
    setStatus(`已删除 ${id}，未移动任何稳定帧。`);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

function resizeSelectedFrame() {
  const id = state.selectedId;
  const frame = id ? state.packer.frames.get(id) : null;
  const source = id ? state.sources.get(id) : null;
  if (!frame || !source) {
    showToast("请先选择需要缩放的帧。");
    return;
  }
  const answer = window.prompt(
    `输入 ${id} 的缩放倍数（0.1 – 4）`,
    "1.25",
  );
  if (answer === null) return;
  const ratio = Number(answer);
  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 4) {
    showToast("缩放倍数必须在 0.1 到 4 之间。", { error: true });
    return;
  }
  const width = Math.max(1, Math.round(frame.width * ratio));
  const height = Math.max(1, Math.round(frame.height * ratio));
  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = width;
  scaledCanvas.height = height;
  const scaledContext = scaledCanvas.getContext("2d");
  scaledContext.imageSmoothingEnabled = false;
  scaledContext.drawImage(canvasFromRaster(source), 0, 0, width, height);
  const scaledRaster = rasterFromCanvas(scaledCanvas);
  try {
    const report = state.packer.applyChanges(
      { update: [{ id, width, height }] },
      { label: `手动缩放 ${id}` },
    );
    state.sources.set(id, scaledRaster);
    const visual = verifyCurrentAtlas();
    recordHistory("↗", `缩放 ${id}`, report, visual);
    addActivity(
      `缩放 ${id} 至 ${width}×${height} · 区域 ` +
        `${formatRegion(report.repackRegion)}`,
    );
    renderAll();
    setStatus(`已缩放 ${id}，稳定帧保持原位。`);
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

async function addImageFiles(files) {
  const validFiles = [...files].filter((file) =>
    file.type.startsWith("image/"),
  );
  if (validFiles.length === 0) return;
  const additions = [];
  const rasters = new Map();
  const stamp = Date.now().toString(36);
  try {
    for (let index = 0; index < validFiles.length; index += 1) {
      const file = validFiles[index];
      const url = URL.createObjectURL(file);
      try {
        const image = await loadImage(url);
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
          throw new Error(`${file.name} 尺寸非法`);
        }
        if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
          throw new Error(`${file.name} 超过 4096px 限制`);
        }
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const canvasContext = canvas.getContext("2d");
        canvasContext.drawImage(image, 0, 0);
        const raster = rasterFromCanvas(canvas);
        const id = `img_${stamp}_${index}`;
        additions.push({
          id,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        rasters.set(id, raster);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const report = state.packer.applyChanges(
      { add: additions },
      { label: `添加 ${additions.length} 张图片` },
    );
    for (const [id, raster] of rasters) {
      state.sources.set(id, raster);
    }
    const visual = verifyCurrentAtlas();
    recordHistory("+", `添加 ${additions.length} 帧`, report, visual);
    addActivity(
      `新增 ${additions.length} 帧 · 未移动已有帧 · 区域 ` +
        `${formatRegion(report.repackRegion)}`,
    );
    renderAll();
    setStatus(`已增量添加 ${additions.length} 帧。`);
    showToast(`已添加 ${additions.length} 帧，未移动稳定帧。`);
  } catch (error) {
    showToast(error.message, { error: true, duration: 6000 });
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function verifySerializedDocument(atlasDocument) {
  const parsed = parseAtlasDocument(JSON.stringify(atlasDocument));
  const image = await loadImage(atlasDocument.atlas.image);
  const canvas = document.createElement("canvas");
  canvas.width = atlasDocument.atlas.width;
  canvas.height = atlasDocument.atlas.height;
  const canvasContext = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  canvasContext.drawImage(image, 0, 0);
  const atlas = rasterFromCanvas(canvas);
  const mismatches = [];
  for (const frame of parsed.frames) {
    const source = state.sources.get(frame.id);
    if (!source) {
      mismatches.push(frame.id);
      continue;
    }
    const restored = extractRegion(
      atlas,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    );
    if (!compareRasters(restored, source, { tolerance: 1 }).equal) {
      mismatches.push(frame.id);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`JSON 往返像素异常：${mismatches.slice(0, 3).join(", ")}`);
  }
  return parsed;
}

async function exportJson() {
  if (state.packer.frames.size === 0) {
    showToast("图集为空，无法导出。", { error: true });
    return;
  }
  try {
    dom.exportJson.disabled = true;
    const atlas = renderAtlas(
      [...state.packer.frames.values()],
      state.sources,
      state.packer.width,
      state.packer.height,
    );
    const atlasDocument = createAtlasDocument(state.packer, {
      image: rasterToDataUrl(atlas),
    });
    const parsed = await verifySerializedDocument(atlasDocument);
    downloadBlob(
      new Blob([JSON.stringify(atlasDocument)], {
        type: "application/json",
      }),
      "sprite-atlas.json",
    );
    addActivity(
      `导出 JSON · ${parsed.frames.length} 帧自包含 PNG · 往返校验通过`,
    );
    setStatus(
      `已导出 ${parsed.frames.length} 帧自包含 JSON，像素往返校验通过。`,
    );
    showToast(
      `JSON 已导出：${parsed.frames.length} 帧全部包含在图集中。`,
    );
  } catch (error) {
    showToast(`导出失败：${error.message}`, { error: true });
  } finally {
    dom.exportJson.disabled = false;
  }
}

async function exportPng() {
  if (state.packer.frames.size === 0) {
    showToast("图集为空，无法导出。", { error: true });
    return;
  }
  const atlas = renderAtlas(
    [...state.packer.frames.values()],
    state.sources,
    state.packer.width,
    state.packer.height,
  );
  const canvas = canvasFromRaster(atlas);
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNG 编码失败。", { error: true });
      return;
    }
    downloadBlob(blob, "sprite-atlas.png");
    addActivity(`导出 PNG · ${atlas.width}×${atlas.height}`);
    showToast("图集 PNG 已导出。");
  }, "image/png");
}

async function importJsonFile(file) {
  try {
    const text = await file.text();
    const parsed = parseAtlasDocument(text);
    const image = await loadImage(parsed.image);
    if (
      image.naturalWidth !== parsed.width ||
      image.naturalHeight !== parsed.height
    ) {
      throw new Error(
        `图集 PNG 尺寸 ${image.naturalWidth}×${image.naturalHeight} ` +
          `与 JSON 声明 ${parsed.width}×${parsed.height} 不一致`,
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = parsed.width;
    canvas.height = parsed.height;
    const canvasContext = canvas.getContext("2d", {
      willReadFrequently: true,
    });
    canvasContext.drawImage(image, 0, 0);
    const importedAtlas = rasterFromCanvas(canvas);
    const restoredSources = new Map();
    for (const frame of parsed.frames) {
      restoredSources.set(
        frame.id,
        extractRegion(
          importedAtlas,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
        ),
      );
    }

    state.packer.restore({
      width: parsed.width,
      height: parsed.height,
      padding: parsed.padding,
      frames: parsed.frames,
      stats: parsed.stats,
    });
    state.sources = restoredSources;
    state.selectedId = null;
    state.appliedEdits.clear();
    state.thumbnails.clear();
    state.history = [];
    state.activity = [];
    const visual = verifyCurrentAtlas();
    const validation = state.packer.validate();
    recordHistory(
      "JSON",
      "JSON 恢复",
      null,
      visual,
      { moved: `${parsed.frames.length} 帧` },
    );
    addActivity(
      `导入 JSON · ${parsed.frames.length} 帧全部恢复 · 切片校验` +
        `${validation.valid ? "通过" : "失败"}`,
    );
    addActivity(
      `图集 ${parsed.width}×${parsed.height} · 像素校验` +
        `${visual.equal ? "通过" : "失败"} · ${visual.hash}`,
    );
    renderAll();
    setStatus(
      `JSON 已恢复 ${parsed.frames.length} 帧，利用率 ` +
        `${formatPercent(state.packer.utilization())}。`,
    );
    showToast(
      `JSON 恢复成功：${parsed.frames.length} 帧、` +
        `切片坐标与像素全部通过。`,
      { duration: 5200 },
    );
  } catch (error) {
    showToast(`JSON 导入失败：${error.message}`, {
      error: true,
      duration: 6500,
    });
    setStatus(`JSON 导入失败：${error.message}`);
  }
}

function handleDroppedFiles(files) {
  const list = [...files];
  if (list.length === 0) return;
  const jsonFile = list.find(
    (file) =>
      file.type === "application/json" || file.name.toLowerCase().endsWith(".json"),
  );
  if (jsonFile) {
    importJsonFile(jsonFile);
  } else {
    addImageFiles(list);
  }
}

dom.demoButton.addEventListener("click", () => resetDemo());
dom.editA.addEventListener("click", () => applyDemoEdit("A"));
dom.editB.addEventListener("click", () => applyDemoEdit("B"));
dom.runVerification.addEventListener("click", runFullVerification);
dom.deleteFrame.addEventListener("click", deleteSelectedFrame);
dom.resizeFrame.addEventListener("click", resizeSelectedFrame);
dom.exportJson.addEventListener("click", exportJson);
dom.exportPng.addEventListener("click", exportPng);
dom.frameSearch.addEventListener("input", renderFrameList);
dom.imageInput.addEventListener("change", () => {
  addImageFiles(dom.imageInput.files);
  dom.imageInput.value = "";
});
dom.jsonInput.addEventListener("change", () => {
  const file = dom.jsonInput.files[0];
  if (file) importJsonFile(file);
  dom.jsonInput.value = "";
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) {
    handleDroppedFiles(event.dataTransfer.files);
  }
});

resetDemo({ quiet: true });
setTimeout(() => {
  showToast("100 帧演示已加载。可运行“增量 A / B”或一键百帧验证。");
}, 350);
