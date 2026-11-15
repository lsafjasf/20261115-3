import { LoopPath } from "./path.js";
import { PlaybackEngine } from "./engine.js";
import { LiveAudio } from "./audio-graph.js";
import { renderBinaural, exportRoute } from "./renderer.js";
import { defaultConfig, validateConfig } from "./scene.js";
import { AMBIENT_TYPES, SOURCE_VOICES } from "./sounds.js";

const canvas = document.getElementById("map");
const ctx2d = canvas.getContext("2d");

const state = {
  config: defaultConfig(),
  mode: "route",
  dragging: null,
};

let engine;
let path;
let audio = new LiveAudio();
let lastTime = performance.now();

const SOURCE_COLORS = ["#ff7a7a", "#ffc861", "#8be28b", "#7fc4ff", "#c99bff"];

function rebuildEngine() {
  path = new LoopPath(state.config.controlPoints);
  engine = new PlaybackEngine(path, state.config.sources, state.config.segments, {
    speed: state.config.speed,
    radius: state.config.radius,
  });
}

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function hitTest(point) {
  if (state.mode === "source") {
    for (let i = 0; i < state.config.sources.length; i++) {
      const s = state.config.sources[i];
      if (Math.hypot(s.x - point.x, s.y - point.y) < 16) {
        return { kind: "source", index: i };
      }
    }
    return null;
  }
  for (let i = 0; i < state.config.controlPoints.length; i++) {
    const p = state.config.controlPoints[i];
    if (Math.hypot(p.x - point.x, p.y - point.y) < 14) {
      return { kind: "route", index: i };
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (event) => {
  const point = pointerPos(event);
  state.dragging = hitTest(point);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const point = pointerPos(event);
  const { kind, index } = state.dragging;
  if (kind === "route") state.config.controlPoints[index] = point;
  else state.config.sources[index].x = point.x, state.config.sources[index].y = point.y;
  rebuildEngine();
  renderPanel();
});

canvas.addEventListener("pointerup", () => {
  state.dragging = null;
});

function draw(frame) {
  const { width, height } = canvas;
  ctx2d.clearRect(0, 0, width, height);

  // Dense polyline of the curved loop.
  ctx2d.lineWidth = 14;
  ctx2d.strokeStyle = "#2a3650";
  ctx2d.lineJoin = "round";
  ctx2d.beginPath();
  for (let i = 0; i <= 240; i++) {
    const p = path.pointAt(i / 240);
    if (i === 0) ctx2d.moveTo(p.x, p.y);
    else ctx2d.lineTo(p.x, p.y);
  }
  ctx2d.stroke();

  // Progress arc already traversed.
  ctx2d.lineWidth = 5;
  ctx2d.strokeStyle = "#3f7bf0";
  ctx2d.beginPath();
  const steps = Math.max(2, Math.floor(frame.u * 240));
  for (let i = 0; i <= steps; i++) {
    const p = path.pointAt(i / 240);
    if (i === 0) ctx2d.moveTo(p.x, p.y);
    else ctx2d.lineTo(p.x, p.y);
  }
  ctx2d.stroke();

  // Control points.
  state.config.controlPoints.forEach((p, i) => {
    ctx2d.fillStyle = i === frame.segment.index ? "#7fd0ff" : "#8fa2c0";
    ctx2d.beginPath();
    ctx2d.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx2d.fill();
  });

  // Sources with reach rings colored by live intensity.
  frame.sources.forEach((s, idx) => {
    const src = state.config.sources[idx];
    ctx2d.globalAlpha = 0.15 + 0.6 * s.gain;
    ctx2d.fillStyle = SOURCE_COLORS[idx];
    ctx2d.beginPath();
    ctx2d.arc(src.x, src.y, 10 + 14 * s.gain, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = SOURCE_COLORS[idx];
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.arc(src.x, src.y, 22, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.fillStyle = "#e7ecf5";
    ctx2d.font = "11px sans-serif";
    ctx2d.fillText(src.label, src.x + 14, src.y + 4);
  });

  // Listener with heading and an L/R ear indicator.
  const lx = frame.listener.x;
  const ly = frame.listener.y;
  ctx2d.save();
  ctx2d.translate(lx, ly);
  ctx2d.rotate(Math.atan2(frame.heading.y, frame.heading.x));
  ctx2d.fillStyle = "#ffffff";
  ctx2d.beginPath();
  ctx2d.moveTo(12, 0);
  ctx2d.lineTo(-8, -8);
  ctx2d.lineTo(-8, 8);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.fillStyle = "#7fd0ff";
  ctx2d.fillRect(-9, -10, 5, 4); // left ear marker
  ctx2d.fillStyle = "#ff9d9d";
  ctx2d.fillRect(-9, 6, 5, 4); // right ear marker
  ctx2d.restore();
}

rebuildEngine();
renderPanel();
draw(engine.frame());

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const frame = engine.update(dt);
  draw(frame);
  audio.applyFrame(frame);
  updateTelemetry(frame);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function updateTelemetry(frame) {
  document.getElementById("tU").textContent = frame.u.toFixed(3);
  document.getElementById("tSeg").textContent = frame.segment.index;
  document.getElementById("tReverb").textContent = frame.segment.reverb.toFixed(2);
  document.querySelectorAll(".segment").forEach((el, idx) => {
    el.classList.toggle("active", idx === frame.segment.index);
  });
}

function renderPanel() {
  const list = document.getElementById("segmentList");
  list.innerHTML = "";
  state.config.segments.forEach((segment, idx) => {
    const card = document.createElement("div");
    card.className = "segment";
    card.innerHTML = `
      <div class="segment-title"><span>第 ${idx + 1} 段</span><span>${state.config.controlPoints[idx] ? "控制点 " + (idx + 1) : ""}</span></div>
      <label>环境声
        <select data-field="ambient">
          ${AMBIENT_TYPES.map((t) => `<option ${segment.ambient === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <span></span>
      </label>
      <label>衰减
        <input type="range" min="0" max="1" step="0.01" value="${segment.attenuation}" data-field="attenuation" />
        <span class="val-att">${segment.attenuation.toFixed(2)}</span>
      </label>
      <label>混响
        <input type="range" min="0" max="1" step="0.01" value="${segment.reverb}" data-field="reverb" />
        <span class="val-rev">${segment.reverb.toFixed(2)}</span>
      </label>`;
    card.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        segment[field] = field === "ambient" ? input.value : Number(input.value);
        if (field === "attenuation") card.querySelector(".val-att").textContent = Number(input.value).toFixed(2);
        if (field === "reverb") card.querySelector(".val-rev").textContent = Number(input.value).toFixed(2);
      });
    });
    list.appendChild(card);
  });

  const sourceList = document.getElementById("sourceList");
  sourceList.innerHTML = "";
  state.config.sources.forEach((source, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span><i class="dot" style="background:${SOURCE_COLORS[idx]}"></i>${source.label}</span><span>${SOURCE_VOICES[idx].type}</span>`;
    sourceList.appendChild(li);
  });
}

function setMode(mode) {
  state.mode = mode;
  document.getElementById("modeRoute").classList.toggle("active", mode === "route");
  document.getElementById("modeSource").classList.toggle("active", mode === "source");
}

document.getElementById("modeRoute").addEventListener("click", () => setMode("route"));
document.getElementById("modeSource").addEventListener("click", () => setMode("source"));
document.getElementById("resetView").addEventListener("click", () => {
  state.config = defaultConfig();
  rebuildEngine();
  renderPanel();
});

document.getElementById("play").addEventListener("click", async () => {
  await audio.start(state.config);
  await audio.resume();
  engine.play();
});

document.getElementById("pause").addEventListener("click", async () => {
  engine.pause();
  await audio.suspend(); // freezes every AudioParam exactly as telemetry freezes
});

document.getElementById("stop").addEventListener("click", async () => {
  engine.pause();
  engine.reset();
  await audio.suspend();
});

function download(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("exportRoute").addEventListener("click", () => {
  download("route.json", exportRoute(state.config), "application/json");
});

document.getElementById("importRoute").addEventListener("click", () => {
  document.getElementById("routeFile").click();
});

document.getElementById("routeFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    validateConfig(parsed);
    state.config = { ...state.config, ...parsed };
    rebuildEngine();
    renderPanel();
    setStatus("路线已导入");
  } catch (err) {
    setStatus("导入失败：" + err.message);
  }
});

document.getElementById("exportWav").addEventListener("click", async () => {
  setStatus("正在离线渲染完整一圈…");
  // Yield so the status can paint before the synchronous render.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const rendered = renderBinaural(state.config, { sampleRate: 44100 });
  download("binaural-loop.wav", rendered.wav, "audio/wav");
  setStatus(`已导出 ${rendered.duration}s 双耳混音（${(rendered.wav.length / 1024).toFixed(0)} KB）`);
});

function setStatus(text) {
  document.getElementById("exportStatus").textContent = text;
}
