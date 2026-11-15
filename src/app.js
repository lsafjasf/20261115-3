import { DATASETS, DEFAULT_STATE, LAYOUTS, POSTER, THEMES } from "./data.js";
import { layoutPoster, renderPosterSvg } from "./poster.js";

const STORAGE_KEY = "signal-poster-state-v1";
const datasetList = document.querySelector("#datasetList");
const themeGrid = document.querySelector("#themeGrid");
const layoutList = document.querySelector("#layoutList");
const preview = document.querySelector("#posterPreview");
const toast = document.querySelector("#toast");
const exportSvgButton = document.querySelector("#exportSvg");
const exportPngButton = document.querySelector("#exportPng");
const exportPngLabel = exportPngButton.querySelector("span");
const exportSvgLabel = exportSvgButton.querySelector("span");

let state = loadState();
let currentModel = null;
let currentSvg = "";
let toastTimer = 0;
let portableFontCss;

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      datasetId: DATASETS.some((item) => item.id === stored.datasetId)
        ? stored.datasetId
        : DEFAULT_STATE.datasetId,
      themeId: THEMES.some((item) => item.id === stored.themeId)
        ? stored.themeId
        : DEFAULT_STATE.themeId,
      layoutId: LAYOUTS.some((item) => item.id === stored.layoutId)
        ? stored.layoutId
        : DEFAULT_STATE.layoutId,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The generator still works when storage is unavailable.
  }
}

function sparkline(values) {
  const width = 58;
  const height = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (width * index) / Math.max(1, values.length - 1);
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="dataset-spark" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="M ${points.replaceAll(" ", " L ")}"/></svg>`;
}

function renderControlOptions() {
  datasetList.innerHTML = DATASETS.map((dataset, index) => {
    const category = dataset.category.split("/")[0].trim();
    return `
      <button class="dataset-card" type="button" data-dataset="${dataset.id}" aria-pressed="false">
        <span class="dataset-topline">
          <span class="dataset-index">${String(index + 1).padStart(2, "0")} · ${dataset.issue}</span>
          ${sparkline(dataset.trend.values)}
        </span>
        <strong class="dataset-name">${category}</strong>
        <span class="dataset-detail">${dataset.headline.subject} · ${dataset.metrics
          .map((metric) => metric.label)
          .join(" / ")}</span>
      </button>`;
  }).join("");

  themeGrid.innerHTML = THEMES.map(
    (theme) => `
      <button class="theme-card" type="button" data-theme="${theme.id}" aria-pressed="false" aria-label="${theme.label}主题，${theme.note}">
        <div class="theme-preview" aria-hidden="true">
          ${theme.swatches.map((color) => `<i style="background:${color}"></i>`).join("")}
        </div>
        <span>${theme.label}</span>
      </button>`,
  ).join("");

  layoutList.innerHTML = LAYOUTS.map(
    (layout) => `
      <button class="layout-card" type="button" data-layout="${layout.id}" aria-pressed="false">
        <span class="layout-icon" aria-hidden="true"><span></span><span></span><span></span></span>
        <b>${layout.label}</b>
        <small>${layout.note}</small>
      </button>`,
  ).join("");
}

function updateControlState() {
  datasetList.querySelectorAll("[data-dataset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.dataset === state.datasetId));
  });
  themeGrid.querySelectorAll("[data-theme]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === state.themeId));
  });
  layoutList.querySelectorAll("[data-layout]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.layout === state.layoutId));
  });
}

function renderPoster() {
  currentModel = layoutPoster(state.datasetId, state.themeId, state.layoutId);
  currentSvg = renderPosterSvg(currentModel);
  preview.innerHTML = currentSvg;
  preview.setAttribute("aria-label", `${currentModel.titleText}，数据海报`);

  updateControlState();
  saveState();

  const category = currentModel.dataset.category.split("/")[0].trim();
  document.querySelector("#themeName").textContent = currentModel.theme.label;
  document.querySelector("#layoutName").textContent = currentModel.layout.label;
  document.querySelector("#datasetStatus").textContent = `${category} · ${currentModel.dataset.year}`;
  document.querySelector("#renderStatus").textContent = `自动换行 · ${currentModel.layoutData.title.lines.length} 行标题`;
  document.querySelector("#integrityText").textContent =
    `3/3 指标与趋势图使用同一数据源；标题自动换行 ${currentModel.layoutData.title.lines.length} 行。`;
  document.title = `${currentModel.dataset.headline.subject} · SIGNAL 海报`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

function fileStem() {
  return `signal-${currentModel.dataset.id}-${currentModel.theme.id}-${currentModel.layout.id}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function embeddedFontCss() {
  if (portableFontCss) return portableFontCss;
  const fonts = [
    ["Noto Sans SC", 400, 500, "./assets/fonts/noto-sans-sc-regular.woff2"],
    ["Noto Sans SC", 600, 700, "./assets/fonts/noto-sans-sc-bold.woff2"],
    ["Noto Serif SC", 400, 500, "./assets/fonts/noto-serif-sc-regular.woff2"],
    ["Noto Serif SC", 600, 700, "./assets/fonts/noto-serif-sc-bold.woff2"],
  ];
  const rules = await Promise.all(
    fonts.map(async ([family, weightStart, weightEnd, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Font request failed: ${path}`);
      const base64 = toBase64(await response.arrayBuffer());
      return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${base64}) format('woff2');font-style:normal;font-weight:${weightStart} ${weightEnd};}`;
    }),
  );
  portableFontCss = rules.join("\n");
  return portableFontCss;
}

async function exportSvg() {
  exportSvgButton.disabled = true;
  exportSvgLabel.textContent = "正在打包";
  try {
    let svg = currentSvg;
    try {
      const fontCss = await embeddedFontCss();
      svg = svg.replace(
        "<defs>",
        `<defs>\n    <style id="embedded-fonts"><![CDATA[\n${fontCss}\n]]></style>`,
      );
    } catch (error) {
      console.warn("Font embedding skipped", error);
    }
    svg = svg.replace(
      "<svg ",
      `<!-- Generated by SIGNAL Poster Studio. Every label and value is editable SVG text. -->\n<svg `,
    );
    downloadBlob(
      new Blob([`${svg}\n`], { type: "image/svg+xml;charset=utf-8" }),
      `${fileStem()}.svg`,
    );
    showToast("SVG 已导出 · 文本与路径可编辑");
  } finally {
    exportSvgButton.disabled = false;
    exportSvgLabel.textContent = "导出 SVG";
  }
}

async function svgToPng(svg, scale = 2) {
  if (document.fonts?.ready) await document.fonts.ready;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("SVG 渲染失败"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = POSTER.width * scale;
    canvas.height = POSTER.height * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = currentModel.theme.bg;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("PNG 编码失败"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportPng() {
  exportPngButton.disabled = true;
  const originalText = exportPngLabel.textContent;
  exportPngLabel.textContent = "正在导出";
  try {
    const png = await svgToPng(currentSvg, 2);
    downloadBlob(png, `${fileStem()}@2x.png`);
    showToast("PNG 已导出 · 2160 × 2880 px");
  } catch (error) {
    console.error(error);
    showToast("PNG 导出失败，请改用 SVG");
  } finally {
    exportPngButton.disabled = false;
    exportPngLabel.textContent = originalText;
  }
}

datasetList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dataset]");
  if (!button || button.dataset.dataset === state.datasetId) return;
  state = { ...state, datasetId: button.dataset.dataset };
  renderPoster();
});

themeGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme]");
  if (!button || button.dataset.theme === state.themeId) return;
  state = { ...state, themeId: button.dataset.theme };
  renderPoster();
});

layoutList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-layout]");
  if (!button || button.dataset.layout === state.layoutId) return;
  state = { ...state, layoutId: button.dataset.layout };
  renderPoster();
});

exportSvgButton.addEventListener("click", exportSvg);
exportPngButton.addEventListener("click", exportPng);

renderControlOptions();
renderPoster();
