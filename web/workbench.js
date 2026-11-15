// 浏览器交互工作台：关键帧、缓动、中间路径编辑、实时体检、WebM/SVG 导出。
import {
  circlePoints, starPoints, autoMatch, frameAt, pointsToPath,
  easeFns, easeBezier, VB,
} from "../src/morph/core.mjs";
import { auditFrames, loopClosure, periodicBoundary } from "../src/morph/checks.mjs";
import { buildLoopFrames } from "../src/morph/demo.mjs";

const $ = (id) => document.getElementById(id);
const stage = $("stage");

const state = {
  n: 160,
  midT: 0.5,
  ripple: 14,
  easeA: "inOutCubic",
  easeB: "inOutSine",
  duration: 4,
  mode: "play",
  t: 0,
  playing: false,
  raf: 0,
  match: null,
  midOverride: null, // 用户拖动后的中间帧顶点
  midBase: null,     // 程序化中间帧（用于重置）
};

function rebuildMatch() {
  state.match = autoMatch(circlePoints(130, 64), starPoints(150, 62, 5), state.n);
  rebuildMid();
}

function rebuildMid() {
  const { a, b } = state.match;
  const mid = a.map((p, i) => {
    const base = { x: (a[i].x + b[i].x) / 2, y: (a[i].y + b[i].y) / 2 };
    const dx = p.x - 200, dy = p.y - 200;
    const theta = Math.atan2(dy, dx);
    const wave = Math.cos(5 * (theta + Math.PI / 2));
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: base.x + (dx / len) * state.ripple * wave,
      y: base.y + (dy / len) * state.ripple * wave,
    };
  });
  state.midBase = mid;
  if (!state.midOverride) state.midOverride = mid.map((p) => ({ ...p }));
}

function keyframes() {
  return [
    { t: 0, points: state.match.a, easing: state.easeA },
    { t: state.midT, points: state.midOverride, easing: state.easeB },
    { t: 1, points: state.match.b },
  ];
}

function el(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function render() {
  const kf = keyframes();
  const pts = state.mode === "mid" ? state.midOverride : frameAt(kf, state.t);
  stage.replaceChildren();
  stage.appendChild(el("rect", { width: VB, height: VB, fill: "#0f1020" }));
  stage.appendChild(el("path", {
    d: pointsToPath(pts),
    fill: "#6c5ce7", "fill-opacity": 0.92,
    stroke: "#2d2a5e", "stroke-width": 2, "stroke-linejoin": "round",
  }));
  if (state.mode === "mid") {
    const g = el("g");
    pts.forEach((p, i) => {
      g.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: i % 8 === 0 ? 3.4 : 1.8,
        fill: i % 8 === 0 ? "#ffd166" : "#ffffff",
        "fill-opacity": 0.9,
        "data-i": i, style: "cursor:grab",
      }));
    });
    stage.appendChild(g);
  }
  updateBadges();
}

function setBadge(id, ok, text) {
  const node = $(id);
  node.textContent = text;
  node.className = "badge " + (ok ? "ok" : "bad");
}

function updateBadges() {
  const kf = keyframes();
  const frames = buildLoopFrames(kf, 60);
  const audit = auditFrames(frames);
  const closure = loopClosure(frames[0], frames[frames.length - 1], 0.5);
  const boundary = periodicBoundary(frames);
  setBadge("badge-self", audit.selfIntersections.length === 0,
    `自交：${audit.selfIntersections.length ? "出现帧 " + audit.selfIntersections.map((x) => x.frame).join(",") : "无"}`);
  setBadge("badge-flip", audit.orientationFlips.length === 0,
    `翻转：${audit.orientationFlips.length ? "出现" : "无"}`);
  setBadge("badge-mono", audit.angleViolations.length === 0,
    `极角扭转：${audit.angleViolations.length ? "出现" : "无"}`);
  setBadge("badge-loop", closure.ok && boundary.ok,
    `首尾偏差 ${closure.maxDeviationPx}px / 环绕步长 ${boundary.wrapStepPx}px ${boundary.ok ? "✓" : "✗"}`);
  $("details").textContent = JSON.stringify({
    vertexCount: state.n,
    cyclicShift: state.match.shift,
    matchedEnergy: Math.round(state.match.energy * 100) / 100,
    frames: frames.length,
    selfIntersections: audit.selfIntersections.length,
    orientationFlips: audit.orientationFlips.length,
    angleViolations: audit.angleViolations.length,
    loopClosure: closure,
    periodicBoundary: boundary,
  }, null, 2);
}

function setStatus(text, cls = "") {
  const node = $("status");
  node.textContent = text;
  node.className = "status " + cls;
}

// ---------- 控件初始化 ----------
const easeSelectA = $("ease-a");
const easeSelectB = $("ease-b");
Object.keys(easeFns).forEach((name) => {
  easeSelectA.appendChild(new Option(name, name));
  easeSelectB.appendChild(new Option(name, name));
});
easeSelectA.value = state.easeA;
easeSelectB.value = state.easeB;

easeSelectA.onchange = () => { state.easeA = easeSelectA.value; render(); };
easeSelectB.onchange = () => { state.easeB = easeSelectB.value; render(); };

$("vertex-count").oninput = (e) => {
  state.n = Number(e.target.value);
  $("vertex-count-val").textContent = state.n;
  state.midOverride = null;
  rebuildMatch();
  render();
};
$("mid-t").oninput = (e) => {
  state.midT = Number(e.target.value);
  $("mid-t-val").textContent = state.midT.toFixed(2);
  render();
};
$("ripple").oninput = (e) => {
  state.ripple = Number(e.target.value);
  $("ripple-val").textContent = state.ripple;
  state.midOverride = null;
  rebuildMid();
  render();
};
$("duration").oninput = (e) => { state.duration = Number(e.target.value) || 4; };
$("edit-mode").onchange = (e) => {
  state.mode = e.target.value;
  $("scrub").value = state.t;
  render();
};
$("btn-reset-mid").onclick = () => {
  state.midOverride = state.midBase.map((p) => ({ ...p }));
  render();
  setStatus("中间帧已重置为程序化路径。", "good");
};

// ---------- 播放与时间轴 ----------
let lastTs = 0;
function tick(ts) {
  if (!state.playing) return;
  if (!lastTs) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;
  state.t = (state.t + dt / state.duration) % 1;
  $("scrub").value = state.t;
  render();
  state.raf = requestAnimationFrame(tick);
}
function play() {
  state.playing = !state.playing;
  $("btn-play").textContent = state.playing ? "⏸ 播放 / 暂停" : "▶ 播放 / 暂停";
  lastTs = 0;
  if (state.playing) state.raf = requestAnimationFrame(tick);
  else cancelAnimationFrame(state.raf);
}
$("btn-play").onclick = play;
$("scrub").oninput = (e) => {
  state.t = Number(e.target.value);
  if (state.mode === "mid") {
    $("edit-mode").value = "play";
    state.mode = "play";
  }
  render();
};

// ---------- 中间路径顶点拖动 ----------
function svgPoint(evt) {
  const pt = stage.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(stage.getScreenCTM().inverse());
}
let dragIndex = -1;
stage.addEventListener("pointerdown", (evt) => {
  if (state.mode !== "mid") return;
  const circle = evt.target.closest("circle");
  if (!circle) return;
  dragIndex = Number(circle.dataset.i);
  stage.setPointerCapture(evt.pointerId);
});
stage.addEventListener("pointermove", (evt) => {
  if (dragIndex < 0) return;
  const p = svgPoint(evt);
  state.midOverride[dragIndex] = {
    x: Math.max(4, Math.min(VB - 4, p.x)),
    y: Math.max(4, Math.min(VB - 4, p.y)),
  };
  render();
});
stage.addEventListener("pointerup", () => { dragIndex = -1; });

// ---------- 导出 ----------
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function smilSvgText() {
  const kf = keyframes();
  const poses = [kf[0], kf[1], kf[2], kf[1], kf[0]];
  const values = poses.map((k) => pointsToPath(k.points)).join(";");
  const e01 = easeBezier[kf[0].easing] ?? easeBezier.linear;
  const e12 = easeBezier[kf[1].easing] ?? easeBezier.linear;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}">
  <rect width="${VB}" height="${VB}" fill="#0f1020"/>
  <path d="${pointsToPath(kf[0].points)}" fill="#6c5ce7" fill-opacity="0.92" stroke="#2d2a5e" stroke-width="2" stroke-linejoin="round">
    <animate attributeName="d" dur="${state.duration}s" repeatCount="indefinite" calcMode="spline"
      keyTimes="0;0.25;0.5;0.75;1" keySplines="${e01};${e12};${e12};${e01}" values="${values}"/>
  </path>
</svg>`;
}

$("export-svg").onclick = () => {
  download("morph-circle-star.svg", new Blob([smilSvgText()], { type: "image/svg+xml" }));
  setStatus("已导出往返 SMIL 动画 SVG。", "good");
};
$("export-final").onclick = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}">
  <rect width="${VB}" height="${VB}" fill="#0f1020"/>
  <path d="${pointsToPath(state.match.b)}" fill="#6c5ce7" fill-opacity="0.92" stroke="#2d2a5e" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
  download("final-star.svg", new Blob([svg], { type: "image/svg+xml" }));
  setStatus("已导出最终星形静态 SVG。", "good");
};

async function exportWebm() {
  if (!("MediaRecorder" in window) || !MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    setStatus("当前浏览器不支持 VP9 WebM 录制，可改用 VP8 或使用无头管线产物。", "error");
    return;
  }
  const size = 800;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const fps = 30;
  const frames = buildLoopFrames(keyframes(), 60);
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 2_000_000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start();
  const img = new Image();
  for (const pts of frames) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VB} ${VB}">
      <rect width="${VB}" height="${VB}" fill="#0f1020"/>
      <path d="${pointsToPath(pts)}" fill="#6c5ce7" stroke="#2d2a5e" stroke-width="4" stroke-linejoin="round"/>
    </svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  download("morph-circle-star.webm", new Blob(chunks, { type: "video/webm" }));
  setStatus(`已导出 ${frames.length} 帧 / ${(frames.length / fps).toFixed(1)}s 的 WebM。`, "good");
}
$("export-webm").onclick = () =>
  exportWebm().catch((err) => setStatus("导出失败：" + err.message, "error"));

// ---------- 启动 ----------
rebuildMatch();
render();
setStatus("就绪：可切换到“编辑中间路径”拖动顶点，所有检查实时更新。");
