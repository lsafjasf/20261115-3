import "@fontsource-variable/space-grotesk";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/noto-sans-sc/500.css";
import "./styles.css";
import jsQR from "jsqr";
import { DEFAULT_STATE, PALETTES, renderPoster } from "./poster.js";
import { analyzeQr } from "./qr.js";

const app = document.querySelector("#app");
const state = { ...DEFAULT_STATE, showSafeZones: false };
let metrics = analyzeQr(state);
let decodeTimer = null;
let decoded = { status: "checking", value: "" };
let uploadedLogoUrl = null;

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">SF</div>
        <div class="brand-copy">
          <strong>SIGNAL / FORM</strong>
          <span>POSTER LAB — 2026</span>
        </div>
      </div>
      <div class="top-center">
        <span class="eyebrow">CAMPAIGN 03</span>
        <span class="crumb-slash">/</span>
        <span class="project-name">ACCESS POSTER</span>
      </div>
      <div class="top-actions">
        <span class="live-pill"><i></i> LIVE CANVAS</span>
        <button class="icon-button" id="resetButton" aria-label="恢复默认设置" title="恢复默认">
          <svg viewBox="0 0 24 24"><path d="M4.5 9A8 8 0 1 1 4 12" /><path d="M4.5 4.5v4.5H9" /></svg>
        </button>
        <button class="top-export" id="topExport">
          <span>导出 PNG</span>
          <svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></svg>
        </button>
      </div>
    </header>

    <main class="workspace">
      <section class="preview-pane">
        <div class="stage-head">
          <div class="stage-title">
            <span class="index-chip">A2</span>
            <span>ARTBOARD / PORTRAIT</span>
            <span class="stage-dims">1200 × 1600</span>
          </div>
          <div class="view-tools">
            <button class="view-toggle active" id="safeZoneButton" aria-pressed="false">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><circle cx="16" cy="16" r="4" /></svg>
              安全区
            </button>
            <span class="zoom-label">FIT · 100%</span>
          </div>
        </div>

        <div class="stage">
          <div class="stage-ticks ticks-top"></div>
          <div class="poster-wrap">
            <div class="poster-shadow"></div>
            <canvas id="posterCanvas" aria-label="FORM IN THE STATIC 活动海报预览"></canvas>
            <span class="corner-mark corner-a"></span>
            <span class="corner-mark corner-b"></span>
            <span class="corner-mark corner-c"></span>
            <span class="corner-mark corner-d"></span>
          </div>
          <div class="safe-banner" id="safeBanner">
            <i></i> FINDER PROTECTION ACTIVE — 3 / 3 LOCKED
          </div>
          <div class="stage-note">
            <span>SCAN / READY</span>
            <span class="stage-note-line"></span>
            <span id="stageRisk">CALCULATING</span>
          </div>
        </div>
      </section>

      <aside class="inspector">
        <div class="inspector-head">
          <div>
            <span class="eyebrow">GENERATOR</span>
            <h1>POSTER CONTROLS</h1>
          </div>
          <span class="realtime-badge"><i></i> REALTIME</span>
        </div>
        <div class="quick-telemetry" id="quickTelemetry" data-level="safe">
          <div><span>CONTRAST</span><b id="quickContrast">0.0:1</b></div>
          <div><span>OCCLUSION</span><b id="quickOcclusion">0.0%</b></div>
          <div><span>SCAN RISK</span><b id="quickRisk">检查中</b></div>
          <i class="quick-decode" id="quickDecode" title="解码自检状态">•••</i>
        </div>

        <div class="inspector-scroll">
          ${logoSection()}
          ${colorSection()}
          ${textureSection()}
          ${dataSection()}
          ${telemetrySection()}
        </div>

        <div class="export-dock">
          <button class="export-primary" id="exportPng">
            <span class="export-icon">
              <svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4z" /><path d="m7 15 3.2-3.2 2.3 2.3 2.7-2.7 2.8 3.6" /><circle cx="9" cy="9" r="1.1" /></svg>
            </span>
            <span><strong>导出 PNG</strong><small>2400 × 3200 / 2×</small></span>
            <svg class="dock-arrow" viewBox="0 0 24 24"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></svg>
          </button>
          <button class="export-secondary" id="exportJson" title="导出参数 JSON">
            <svg viewBox="0 0 24 24"><path d="M8 4c-2 0-2 3-2 4s-1 2-2 2c2 0 2 1 2 2s0 4 2 4" /><path d="M16 4c2 0 2 3 2 4s1 2 2 2c-2 0-2 1-2 2s0 4-2 4" /></svg>
            JSON
          </button>
        </div>
      </aside>
    </main>
  </div>
  <canvas id="verifyCanvas" hidden></canvas>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

function logoSection() {
  return `
    <section class="control-section">
      <div class="section-heading">
        <span class="section-index">01</span>
        <div><h2>中心图形</h2><p>CENTER MARK</p></div>
        <span class="lock-tag">中心限定</span>
      </div>
      <div class="artwork-grid" id="artworkGrid">
        ${artworkButton("asterisk", "星芒", '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>')}
        ${artworkButton("orbit", "轨道", '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/>')}
        ${artworkButton("wave", "波形", '<path d="M2 12h3l2-6 3 12 3-9 2 6 3-3h4"/>')}
        ${artworkButton("none", "留空", '<circle cx="12" cy="12" r="9"/><path d="m6 18 12-12"/>')}
      </div>
      <div class="slider-head">
        <label for="logoSize">图形直径</label>
        <output id="logoSizeOut">24%</output>
      </div>
      <input class="range" id="logoSize" type="range" min="8" max="40" step="1" value="24" />
      <div class="range-scale"><span>克制</span><span>醒目</span><span>临界</span></div>
      <label class="upload-row" for="logoUpload">
        <span class="upload-icon">＋</span>
        <span><strong>上传自定义图形</strong><small>PNG / JPG / SVG · 自动裁入中心圆</small></span>
        <input id="logoUpload" type="file" accept="image/png,image/jpeg,image/svg+xml" />
      </label>
    </section>
  `;
}

function artworkButton(id, label, icon) {
  return `
    <button class="artwork-button" data-artwork="${id}">
      <span class="artwork-preview"><svg viewBox="0 0 24 24">${icon}</svg></span>
      <span>${label}</span>
    </button>
  `;
}

function colorSection() {
  return `
    <section class="control-section">
      <div class="section-heading">
        <span class="section-index">02</span>
        <div><h2>色彩系统</h2><p>COLOR SYSTEM</p></div>
      </div>
      <div class="palette-grid" id="paletteGrid">
        ${PALETTES.map((palette) => `
          <button class="palette-button" data-palette="${palette.id}">
            <span class="palette-chips">
              <i style="background:${palette.posterBg}"></i>
              <i style="background:${palette.ink}"></i>
              <i style="background:${palette.accent}"></i>
            </span>
            <span>${palette.name}</span>
          </button>
        `).join("")}
      </div>
      <div class="color-grid">
        ${colorField("accent", "强调色", "ACCENT")}
        ${colorField("qrDark", "码点色", "MODULE")}
        ${colorField("qrLight", "码底色", "CANVAS")}
      </div>
      <p class="field-help"><span class="info-dot">i</span> 二维码使用深码点 / 浅底色；对比度低于 4.5:1 会立即告警。</p>
    </section>
  `;
}

function colorField(key, label, en) {
  return `
    <label class="color-field">
      <span class="color-label">${label}<small>${en}</small></span>
      <span class="color-control">
        <input class="color-input" id="${key}Color" data-color="${key}" type="color" />
        <input class="hex-input" id="${key}Hex" data-hex="${key}" type="text" maxlength="7" spellcheck="false" />
      </span>
    </label>
  `;
}

function textureSection() {
  return `
    <section class="control-section">
      <div class="section-heading">
        <span class="section-index">03</span>
        <div><h2>噪点纹理</h2><p>NOISE TEXTURE</p></div>
        <button class="shuffle-button" id="shuffleSeed" title="重新生成纹理">
          <svg viewBox="0 0 24 24"><path d="M3 7h4l10 10h4"/><path d="m18 14 3 3-3 3"/><path d="M3 17h4l3-3"/><path d="m18 4 3 3-3 3"/><path d="M13 9l4-4"/></svg>
          换一张
        </button>
      </div>
      <div class="texture-options" id="textureOptions">
        ${textureButton("grain", "颗粒", "GRAIN")}
        ${textureButton("fiber", "纸纤", "FIBER")}
        ${textureButton("halftone", "网点", "DOT")}
      </div>
      <div class="slider-head">
        <label for="noiseAmount">纹理强度</label>
        <output id="noiseAmountOut">34%</output>
      </div>
      <input class="range" id="noiseAmount" type="range" min="0" max="100" step="1" value="34" />
      <div class="noise-note"><span>QUIET ZONE CLEAN</span><b>静区与码点永不叠加纹理</b></div>
    </section>
  `;
}

function textureButton(id, label, en) {
  return `
    <button class="texture-button" data-texture="${id}">
      <span class="texture-swatch texture-${id}"></span>
      <span>${label}</span>
      <small>${en}</small>
    </button>
  `;
}

function dataSection() {
  return `
    <section class="control-section data-section">
      <div class="section-heading">
        <span class="section-index">04</span>
        <div><h2>入口数据</h2><p>ENCODED URL</p></div>
        <span class="ecc-tag"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> ECC H</span>
      </div>
      <label class="url-field">
        <span>QR CONTENT</span>
        <input id="contentInput" type="url" spellcheck="false" />
        <i class="url-status" id="urlStatus"></i>
      </label>
      <div class="locked-row">
        <span><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg> 3 × FINDER PATTERN LOCKED</span>
        <span>H / 30%</span>
      </div>
    </section>
  `;
}

function telemetrySection() {
  return `
    <section class="control-section telemetry-section">
      <div class="section-heading">
        <span class="section-index">05</span>
        <div><h2>扫描安全度</h2><p>SCAN TELEMETRY</p></div>
        <span class="telemetry-state" id="telemetryState">LIVE</span>
      </div>
      <div class="telemetry-card" id="telemetryCard" data-level="safe">
        <div class="telemetry-top">
          <div>
            <span class="telemetry-kicker">RISK ASSESSMENT</span>
            <strong id="riskLabel">安全</strong>
            <small id="riskHint">留有余量，可稳定识别</small>
          </div>
          <div class="score-ring" id="scoreRing">
            <span id="scoreValue">100</span><small>SCORE</small>
          </div>
        </div>
        <div class="metric-grid">
          <div class="metric-cell">
            <span>扫描对比度</span>
            <b id="contrastValue">0.0:1</b>
            <small id="contrastHint">MIN 4.5:1</small>
          </div>
          <div class="metric-cell">
            <span>中心遮挡</span>
            <b id="occlusionValue">0.0%</b>
            <small id="occlusionHint">H 预算 30%</small>
          </div>
        </div>
        <div class="risk-track"><span id="riskFill"></span></div>
        <div class="protect-row">
          <span><i class="check-dot">✓</i> 定位块 <b id="finderStatus">3 / 3</b></span>
          <span><i class="check-dot">✓</i> 静区 <b>4 MOD</b></span>
          <span><i class="check-dot">✓</i> 纠错 <b>30%</b></span>
        </div>
      </div>
      <div class="decode-row">
        <span class="decode-pulse" id="decodePulse"></span>
        <span id="decodeText">正在启动解码自检…</span>
        <button id="verifyButton">重新验证</button>
      </div>
    </section>
  `;
}

const canvas = document.querySelector("#posterCanvas");
const verifyCanvas = document.querySelector("#verifyCanvas");
const telemetryCard = document.querySelector("#telemetryCard");
const toast = document.querySelector("#toast");

function refresh({ verify = true } = {}) {
  metrics = renderPoster(canvas, state, { scale: 1, showSafeZones: state.showSafeZones });
  updateControls();
  updateTelemetry();
  if (verify) {
    clearTimeout(decodeTimer);
    setDecodeStatus("checking", "实时解码校验中…");
    decodeTimer = setTimeout(runDecodeCheck, 180);
  }
}

function updateControls() {
  document.querySelectorAll("[data-artwork]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.artwork === state.logoArtwork);
  });
  document.querySelectorAll("[data-palette]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.palette === state.palette);
  });
  document.querySelectorAll("[data-texture]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.texture === state.noiseStyle);
  });
  document.querySelector("#logoSize").value = state.logoSize;
  document.querySelector("#logoSizeOut").value = `${state.logoSize}%`;
  document.querySelector("#noiseAmount").value = state.noiseAmount;
  document.querySelector("#noiseAmountOut").value = `${state.noiseAmount}%`;
  updateRangeProgress(document.querySelector("#logoSize"));
  updateRangeProgress(document.querySelector("#noiseAmount"));
  document.querySelector("#contentInput").value = state.content;
  for (const key of ["accent", "qrDark", "qrLight"]) {
    document.querySelector(`#${key}Color`).value = state[key];
    document.querySelector(`#${key}Hex`).value = state[key].toUpperCase();
  }
  document.querySelector("#safeZoneButton").classList.toggle("active", state.showSafeZones);
  document.querySelector("#safeZoneButton").setAttribute("aria-pressed", String(state.showSafeZones));
  document.querySelector("#safeBanner").classList.toggle("visible", state.showSafeZones);
  const urlStatus = document.querySelector("#urlStatus");
  urlStatus.className = `url-status ${isValidUrl(state.content) ? "valid" : "invalid"}`;
  urlStatus.textContent = isValidUrl(state.content) ? "✓" : "!";
}

function updateTelemetry() {
  const score = metrics.score;
  const contrast = metrics.contrast;
  const occlusion = metrics.occlusion;
  telemetryCard.dataset.level = metrics.level;
  document.querySelector("#scoreValue").textContent = score;
  document.querySelector("#scoreRing").style.setProperty("--score", `${score}%`);
  document.querySelector("#riskLabel").textContent = metrics.label;
  document.querySelector("#riskHint").textContent = {
    safe: "留有余量，可稳定识别",
    attention: "建议降低中心遮挡或提升对比度",
    high: "扫描失败风险高，请立即调整",
  }[metrics.level];
  document.querySelector("#contrastValue").textContent = `${contrast.toFixed(1)}:1`;
  document.querySelector("#contrastHint").textContent = contrast >= 7
    ? "AAA · 余量充足"
    : contrast >= 4.5
      ? "PASS · 高于 4.5:1"
      : "LOW · 低于 4.5:1";
  document.querySelector("#occlusionValue").textContent = `${occlusion.toFixed(1)}%`;
  document.querySelector("#occlusionHint").textContent = occlusion >= 22
    ? "接近 H 纠错预算"
    : `占纠错预算 ${Math.round((occlusion / 30) * 100)}%`;
  document.querySelector("#riskFill").style.width = `${score}%`;
  document.querySelector("#finderStatus").textContent = metrics.protected ? "3 / 3" : "被遮挡";
  document.querySelector("#stageRisk").textContent = metrics.level === "safe"
    ? "SCAN READY"
    : metrics.level === "attention" ? "CHECK CONTRAST" : "HIGH RISK";
  document.querySelector("#telemetryState").textContent = metrics.level === "safe" ? "LIVE · SAFE" : "LIVE · CHECK";
  document.querySelector("#quickTelemetry").dataset.level = metrics.level;
  document.querySelector("#quickContrast").textContent = `${contrast.toFixed(1)}:1`;
  document.querySelector("#quickOcclusion").textContent = `${occlusion.toFixed(1)}%`;
  document.querySelector("#quickRisk").textContent = metrics.label;
}

function setDecodeStatus(status, message, value = "") {
  decoded = { status, value };
  const pulse = document.querySelector("#decodePulse");
  pulse.dataset.status = status;
  const quickDecode = document.querySelector("#quickDecode");
  quickDecode.dataset.status = status;
  quickDecode.textContent = status === "ok" ? "✓" : status === "fail" ? "!" : "•••";
  const textNode = document.querySelector("#decodeText");
  if (status === "ok") {
    textNode.innerHTML = `<b>✓ 已识别</b><span>${escapeHtml(value)}</span>`;
  } else if (status === "fail") {
    textNode.innerHTML = `<b>! 未能识别</b><span>${escapeHtml(message)}</span>`;
  } else {
    textNode.textContent = message;
  }
}

function runDecodeCheck() {
  metrics = renderPoster(verifyCanvas, state, { scale: 1, showSafeZones: false });
  const ctx = verifyCanvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, verifyCanvas.width, verifyCanvas.height);
  try {
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (result?.data === state.content) {
      setDecodeStatus("ok", "", result.data);
    } else if (result?.data) {
      setDecodeStatus("fail", `识别结果不匹配：${result.data}`);
    } else {
      setDecodeStatus("fail", "未能定位二维码，请提高对比度或缩小中心图形");
    }
  } catch (error) {
    setDecodeStatus("fail", error.message);
  }
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function showToast(message, tone = "default") {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

refresh();

document.querySelector("#artworkGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-artwork]");
  if (!button) return;
  state.logoArtwork = button.dataset.artwork;
  refresh();
});

document.querySelector("#paletteGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-palette]");
  if (!button) return;
  const palette = PALETTES.find((item) => item.id === button.dataset.palette);
  if (!palette) return;
  Object.assign(state, {
    palette: palette.id,
    posterBg: palette.posterBg,
    ink: palette.ink,
    accent: palette.accent,
    secondary: palette.secondary,
    qrDark: palette.qrDark,
    qrLight: palette.qrLight,
  });
  refresh();
});

for (const key of ["accent", "qrDark", "qrLight"]) {
  const colorInput = document.querySelector(`#${key}Color`);
  const hexInput = document.querySelector(`#${key}Hex`);
  colorInput.addEventListener("input", () => {
    state[key] = colorInput.value.toUpperCase();
    state.palette = "custom";
    refresh();
  });
  hexInput.addEventListener("change", () => {
    const value = normalizeHex(hexInput.value);
    if (!value) {
      hexInput.value = state[key].toUpperCase();
      showToast("请输入 6 位十六进制色值", "warn");
      return;
    }
    state[key] = value;
    state.palette = "custom";
    refresh();
  });
}

document.querySelector("#logoSize").addEventListener("input", (event) => {
  state.logoSize = Number(event.target.value);
  document.querySelector("#logoSizeOut").value = `${state.logoSize}%`;
  updateRangeProgress(event.target);
  refresh();
});

document.querySelector("#noiseAmount").addEventListener("input", (event) => {
  state.noiseAmount = Number(event.target.value);
  document.querySelector("#noiseAmountOut").value = `${state.noiseAmount}%`;
  updateRangeProgress(event.target);
  refresh();
});

document.querySelector("#textureOptions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-texture]");
  if (!button) return;
  state.noiseStyle = button.dataset.texture;
  refresh();
});

document.querySelector("#shuffleSeed").addEventListener("click", () => {
  state.seed = Math.floor(Math.random() * 99999999);
  refresh();
  showToast("已重新生成确定性纹理");
});

document.querySelector("#safeZoneButton").addEventListener("click", () => {
  state.showSafeZones = !state.showSafeZones;
  refresh({ verify: false });
  if (state.showSafeZones) showToast("安全区：定位块、静区与中心遮挡范围");
});

document.querySelector("#logoUpload").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast("文件超过 8 MB，请压缩后重试", "warn");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      if (uploadedLogoUrl) URL.revokeObjectURL(uploadedLogoUrl);
      uploadedLogoUrl = reader.result;
      state.logoImage = image;
      state.logoArtwork = "upload";
      refresh();
      showToast("自定义中心图形已载入");
    };
    image.onerror = () => showToast("无法读取该图片", "warn");
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

document.querySelector("#contentInput").addEventListener("input", (event) => {
  const value = event.target.value.trim();
  const status = document.querySelector("#urlStatus");
  if (!isValidUrl(value)) {
    status.className = "url-status invalid";
    status.textContent = "!";
    return;
  }
  state.content = value;
  status.className = "url-status valid";
  status.textContent = "✓";
  refresh();
});

document.querySelector("#verifyButton").addEventListener("click", () => {
  setDecodeStatus("checking", "正在重新识别…");
  requestAnimationFrame(runDecodeCheck);
});

document.querySelector("#resetButton").addEventListener("click", () => {
  Object.assign(state, {
    ...DEFAULT_STATE,
    showSafeZones: false,
    logoImage: null,
  });
  refresh();
  showToast("已恢复默认配方");
});

document.querySelector("#topExport").addEventListener("click", exportPng);
document.querySelector("#exportPng").addEventListener("click", exportPng);
document.querySelector("#exportJson").addEventListener("click", exportJson);

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    exportPng();
  }
});

function normalizeHex(value) {
  const raw = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

function updateRangeProgress(input) {
  const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty("--range-progress", `${ratio * 100}%`);
}

async function exportPng() {
  const buttons = [document.querySelector("#topExport"), document.querySelector("#exportPng")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const exportCanvas = document.createElement("canvas");
    renderPoster(exportCanvas, state, { scale: 2, showSafeZones: false });
    const blob = await new Promise((resolve, reject) => {
      exportCanvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG 编码失败")), "image/png");
    });
    const check = decodeCanvas(exportCanvas);
    const passed = check?.data === state.content;
    downloadBlob(blob, "signal-form-access-poster.png");
    showToast(passed ? "PNG 已导出 · 二维码复检通过" : "PNG 已导出 · 请检查二维码风险", passed ? "success" : "warn");
    setDecodeStatus(passed ? "ok" : "fail", passed ? "" : "最终 PNG 未能识别，请调整参数", check?.data || "");
  } catch (error) {
    showToast(`导出失败：${error.message}`, "warn");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function exportJson() {
  const payload = {
    schema: "signal-form/poster-parameters@1",
    generatedAt: new Date().toISOString(),
    poster: {
      width: 2400,
      height: 3200,
      aspectRatio: "3:4",
      title: "FORM IN THE STATIC",
      eventDate: "2026-11-21/22",
      venue: "West Bund Warehouse 07, Shanghai",
    },
    design: {
      palette: state.palette,
      posterBackground: state.posterBg,
      ink: state.ink,
      accent: state.accent,
      qrDark: state.qrDark,
      qrLight: state.qrLight,
      centerMark: state.logoArtwork,
      centerMarkDiameterPercent: state.logoSize,
      noiseStyle: state.noiseStyle,
      noiseAmountPercent: state.noiseAmount,
      noiseSeed: state.seed,
    },
    qr: {
      content: state.content,
      errorCorrection: "H",
      errorCorrectionBudgetPercent: 30,
      version: metrics.version,
      matrixSize: metrics.size,
      quietZoneModules: 4,
      finderPatterns: "locked-3-of-3",
      finderPatternStyle: "7-module square with preserved timing",
      moduleStyle: "rounded-square",
      contrastRatio: Number(metrics.contrast.toFixed(2)),
      centerOcclusionPercent: Number(metrics.occlusion.toFixed(2)),
      estimatedSafe: metrics.level === "safe",
    },
    verification: {
      decoder: "jsQR 1.4.0",
      method: "browser Canvas ImageData",
      status: decoded.status === "ok" ? "passed" : decoded.status,
      decodedValue: decoded.value || null,
    },
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  downloadBlob(blob, "signal-form-access-params.json");
  showToast("参数 JSON 已导出");
}

function decodeCanvas(target) {
  const ctx = target.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, target.width, target.height);
  try {
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
  } catch {
    return null;
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
