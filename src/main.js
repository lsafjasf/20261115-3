import "./fonts.css";
import "./style.css";
import { ExhibitViewer } from "./viewer.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <div id="viewport" aria-label="可旋转的三维展品"></div>
  <div class="grain" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>

  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span>
        <span class="brand-name">AURELIS</span>
        <span class="brand-sub">KINETIC ARCHIVE / 2026</span>
      </span>
    </div>
    <div class="topbar-center">低多边形展品 <span>◆</span> 程序化生成 <span>◆</span> WEBGL</div>
    <div class="live"><i class="live-dot"></i><span>3D 展台在线</span></div>
  </header>

  <section class="curation" aria-label="展品信息">
    <div class="eyebrow">馆藏编号 AR–07</div>
    <h1 class="hero-title">星盘遗物<em>THE ASTROLABE RELIC</em></h1>
    <p class="hero-copy">
      一件以八片放射翼、双轨星环与多面核心构成的低多边形遗物。所有几何皆由代码实时生成。
    </p>
    <div class="metadata">
      <div><span class="meta-label">材质 / MATERIAL</span><span class="meta-value" id="meta-material">古铜</span></div>
      <div><span class="meta-label">光照 / LIGHTING</span><span class="meta-value" id="meta-lighting">展厅光</span></div>
      <div><span class="meta-label">顶点 / VERTICES</span><span class="meta-value">652</span></div>
      <div><span class="meta-label">状态 / STATE</span><span class="meta-value" id="meta-state">转台中</span></div>
    </div>
  </section>

  <div class="annotation" aria-hidden="true">ORBIT · ZOOM · CAPTURE / PROCEDURAL GEOMETRY</div>

  <div class="control-deck" role="toolbar" aria-label="展品控制">
    <div class="control-group">
      <span class="control-label">材质<br />MAT.</span>
      <div class="material-options">
        <button class="material-option" data-material="obsidian" aria-pressed="false">
          <span class="swatch swatch-obsidian"></span>
          <span class="option-text">黑曜石<small>OBSIDIAN</small></span>
        </button>
        <button class="material-option" data-material="bronze" aria-pressed="true">
          <span class="swatch swatch-bronze"></span>
          <span class="option-text">古铜<small>BRONZE</small></span>
        </button>
        <button class="material-option" data-material="jade" aria-pressed="false">
          <span class="swatch swatch-jade"></span>
          <span class="option-text">翡翠<small>JADE</small></span>
        </button>
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">光照<br />LIGHT</span>
      <div class="light-options">
        <button class="light-option" data-lighting="gallery" aria-pressed="true">
          <i class="light-icon"></i><span>展厅光</span>
        </button>
        <button class="light-option" data-lighting="solstice" aria-pressed="false">
          <i class="light-icon"></i><span>落日</span>
        </button>
        <button class="light-option" data-lighting="lunar" aria-pressed="false">
          <i class="light-icon"></i><span>月相</span>
        </button>
      </div>
    </div>

    <div class="action-group">
      <button class="turntable-button" id="turntable-toggle" aria-label="暂停自动转台" aria-pressed="true">
        <span class="turntable-icon" aria-hidden="true"></span>
        <span class="button-text">暂停转台</span>
      </button>
      <button class="capture-button" id="capture-button" aria-label="暂停并保存截图">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M4 8.5h3l1.4-2h7.2L17 8.5h3v10H4v-10Z"/>
          <circle cx="12" cy="13.5" r="3.3"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="hint"><span>拖动环绕</span><i></i><span>滚轮缩放</span><i></i><span>点击相机冻结画面</span></div>
  <div class="angle-readout">TURNTABLE ANGLE<strong id="angle-value">000.0°</strong></div>
  <div class="toast" id="toast" role="status" aria-live="polite"><i class="toast-dot"></i><span id="toast-text"></span></div>
  <div class="loading" id="loading"><div class="loading-inner"><span class="loading-ring"></span><span>构建几何 / BUILDING GEOMETRY</span></div></div>
`;

const viewport = document.querySelector("#viewport");
const toast = document.querySelector("#toast");
const toastText = document.querySelector("#toast-text");
let toastTimer;

function showToast(message) {
  toastText.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

const viewer = new ExhibitViewer(viewport, {
  onStateChange(state) {
    const { angleDegrees, turntableRunning, materialKey, lightingKey } = state;
    const angleValue = document.querySelector("#angle-value");
    if (angleValue) angleValue.textContent = `${String(Math.floor(angleDegrees)).padStart(3, "0")}.${Math.floor((angleDegrees % 1) * 10)}°`;

    const turntableButton = document.querySelector("#turntable-toggle");
    const text = turntableButton.querySelector(".button-text");
    turntableButton.classList.toggle("is-paused", !turntableRunning);
    turntableButton.setAttribute("aria-pressed", String(turntableRunning));
    turntableButton.setAttribute("aria-label", turntableRunning ? "暂停自动转台" : "继续自动转台");
    text.textContent = turntableRunning ? "暂停转台" : "继续转台";
    document.querySelector("#meta-state").textContent = turntableRunning ? "转台中" : "已暂停";

    document.querySelectorAll("[data-material]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.material === materialKey));
    });
    document.querySelectorAll("[data-lighting]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.lighting === lightingKey));
    });
    document.querySelector("#meta-material").textContent = {
      obsidian: "黑曜石",
      bronze: "古铜",
      jade: "翡翠",
    }[materialKey];
    document.querySelector("#meta-lighting").textContent = {
      gallery: "展厅光",
      solstice: "落日",
      lunar: "月相",
    }[lightingKey];
  },
});

document.querySelectorAll("[data-material]").forEach((button) => {
  button.addEventListener("click", () => viewer.setMaterial(button.dataset.material));
});

document.querySelectorAll("[data-lighting]").forEach((button) => {
  button.addEventListener("click", () => viewer.setLighting(button.dataset.lighting));
});

document.querySelector("#turntable-toggle").addEventListener("click", () => {
  const running = viewer.toggleTurntable();
  showToast(running ? "自动转台已继续" : "自动转台已暂停 · 可拖动查看背面");
});

document.querySelector("#capture-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  showToast("正在冻结画面并生成截图…");

  try {
    const image = await viewer.captureImage();
    const link = document.createElement("a");
    link.download = `aurelis-ar07-${viewer.lightingKey}-${image.width}x${image.height}.png`;
    link.href = image.dataUrl;
    link.click();
    showToast(image.paused ? "转台已暂停 · 截图已保存" : "截图已保存");
  } catch (error) {
    console.error(error);
    showToast("截图生成失败，请重试");
  } finally {
    button.disabled = false;
  }
});

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.querySelector("#loading").classList.add("is-hidden");
    window.viewer = viewer;
    window.__AURELIS_READY__ = true;
  });
});
