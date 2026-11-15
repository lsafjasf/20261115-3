/* UI 接线 + Canvas 可视化 + 循环模拟 + 空洞验证 */
"use strict";

const engine = new MusicEngine();
const $ = id => document.getElementById(id);

const ui = {
  btnStart: $("btnStart"), btnSimulate: $("btnSimulate"), btnSkipTest: $("btnSkipTest"),
  danger: $("danger"), th1: $("th1"), th2: $("th2"), fade: $("fade"),
  accentEvery: $("accentEvery"), accentGain: $("accentGain"),
  dangerFill: $("dangerFill"), dangerCursor: $("dangerCursor"),
  thMark1: $("thMark1"), thMark2: $("thMark2"),
  dangerReadout: $("dangerReadout"), stateBadge: $("stateBadge"),
  log: $("verifyLog"),
};

const LAYER_COLORS = { explore: "#2fbf71", alert: "#e0b341", combat: "#e05241" };

function logLine(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  ui.log.appendChild(line);
  ui.log.scrollTop = ui.log.scrollHeight;
}

// ---------- 控件接线 ----------
function refreshDangerUI() {
  const v = +ui.danger.value;
  $("dangerOut").textContent = v;
  ui.dangerReadout.textContent = `危险值 ${v}`;
  ui.dangerFill.style.width = v + "%";
  ui.dangerCursor.style.left = v + "%";
  engine.setDanger(v);
  refreshBadge();
}
function refreshBadge() {
  const layer = engine.currentLayer();
  ui.stateBadge.textContent = LAYER_NAMES[layer];
  ui.stateBadge.className = "state-badge" + (layer === "explore" ? "" : " " + layer);
}
function refreshThresholdUI() {
  let a = +ui.th1.value, b = +ui.th2.value;
  if (a >= b) { b = a + 1; ui.th2.value = b; }
  $("th1Out").textContent = a;
  $("th2Out").textContent = b;
  ui.thMark1.style.left = a + "%";
  ui.thMark2.style.left = b + "%";
  engine.setThresholds(a, b);
  refreshBadge();
}
ui.danger.addEventListener("input", refreshDangerUI);
ui.th1.addEventListener("input", refreshThresholdUI);
ui.th2.addEventListener("input", refreshThresholdUI);
ui.fade.addEventListener("input", () => {
  $("fadeOut").textContent = (+ui.fade.value).toFixed(1);
  engine.setFade(+ui.fade.value);
});
ui.accentEvery.addEventListener("input", () => {
  $("accentEveryOut").textContent = ui.accentEvery.value;
  engine.setAccent(+ui.accentEvery.value, +ui.accentGain.value);
});
ui.accentGain.addEventListener("input", () => {
  $("accentGainOut").textContent = (+ui.accentGain.value).toFixed(2);
  engine.setAccent(+ui.accentEvery.value, +ui.accentGain.value);
});

ui.btnStart.addEventListener("click", () => {
  if (engine.running) {
    engine.stop();
    ui.btnStart.textContent = "▶ 开始";
    ui.btnSimulate.disabled = ui.btnSkipTest.disabled = true;
  } else {
    engine.start();
    refreshThresholdUI();
    refreshDangerUI();
    ui.btnStart.textContent = "⏸ 停止";
    ui.btnSimulate.disabled = ui.btnSkipTest.disabled = false;
    logLine("引擎启动:共享走带运行中,三层同步调度。", "info");
  }
});

// ---------- Canvas 可视化 ----------
const canvas = $("viz");
const g2d = canvas.getContext("2d");
const waveData = {};
for (const n of LAYERS) waveData[n] = null;
let accentFlash = 0;
engine.onStep = (step, t, accent) => { if (accent) accentFlash = 1; };

function drawViz() {
  requestAnimationFrame(drawViz);
  const W = canvas.width, H = canvas.height;
  g2d.fillStyle = "#0a0e14";
  g2d.fillRect(0, 0, W, H);
  const stripH = H / 3;
  LAYERS.forEach((name, i) => {
    const y0 = i * stripH;
    const gain = engine.running ? engine.layerGain[name].gain.value : 0;
    g2d.strokeStyle = "#1c2532";
    g2d.strokeRect(0.5, y0 + 0.5, W - 1, stripH - 1);
    g2d.fillStyle = LAYER_COLORS[name];
    g2d.globalAlpha = 0.25 + gain * 0.75;
    g2d.font = "bold 14px sans-serif";
    g2d.fillText(`${LAYER_NAMES[name]}  增益 ${gain.toFixed(2)}`, 12, y0 + 22);
    g2d.globalAlpha = 1;
    // 增益条
    g2d.fillStyle = "#1c2532";
    g2d.fillRect(W - 170, y0 + 12, 150, 10);
    g2d.fillStyle = LAYER_COLORS[name];
    g2d.fillRect(W - 170, y0 + 12, 150 * gain, 10);
    // 波形
    if (engine.running) {
      const an = engine.analyser[name];
      if (!waveData[name] || waveData[name].length !== an.fftSize) {
        waveData[name] = new Uint8Array(an.fftSize);
      }
      an.getByteTimeDomainData(waveData[name]);
      g2d.beginPath();
      g2d.strokeStyle = LAYER_COLORS[name];
      g2d.lineWidth = 1.6;
      const mid = y0 + stripH * 0.58, amp = stripH * 0.32;
      for (let x = 0; x < W; x++) {
        const v = waveData[name][Math.floor(x / W * an.fftSize)] / 128 - 1;
        const y = mid + v * amp;
        x === 0 ? g2d.moveTo(x, y) : g2d.lineTo(x, y);
      }
      g2d.stroke();
    }
  });
  if (accentFlash > 0) {
    g2d.fillStyle = `rgba(255,255,255,${accentFlash * 0.12})`;
    g2d.fillRect(0, 0, W, H);
    accentFlash = Math.max(0, accentFlash - 0.08);
  }
}
drawViz();

// ---------- 空洞验证 ----------
function analyzeWindow(fromTotal, fromGainIdx, label) {
  const entries = engine.stepLog.filter(e => e.total >= fromTotal);
  const gains = engine.gainLog.slice(fromGainIdx);
  let stepHoles = 0, maxDev = 0;
  for (let i = 1; i < entries.length; i++) {
    const dSteps = entries[i].total - entries[i - 1].total;
    const dt = entries[i].time - entries[i - 1].time;
    if (dSteps !== 1) stepHoles++;                 // 走带跳步或被重置
    const dev = Math.abs(dt - STEP_DUR);
    if (dev > maxDev) maxDev = dev;
    if (dev > 0.003) stepHoles++;                  // 调度时间出现断裂
  }
  let minSum = Infinity;
  for (const g of gains) {
    const sum = g.w[0] + g.w[1] + g.w[2];
    if (sum < minSum) minSum = sum;
  }
  const phase = entries.length ? entries[entries.length - 1].total % LOOP_STEPS : 0;
  logLine(`[${label}] 调度步数 ${entries.length},循环相位 ${phase}/${LOOP_STEPS}`, "info");
  logLine(`  步进间隔最大偏差 ${(maxDev * 1000).toFixed(2)} ms(理论 ${(STEP_DUR * 1000).toFixed(1)} ms)`,
    maxDev <= 0.003 ? "ok" : "fail");
  logLine(`  走带空洞/重置 ${stepHoles} 处`, stepHoles === 0 ? "ok" : "fail");
  logLine(`  三层增益总和最小值 ${minSum === Infinity ? "n/a" : minSum.toFixed(3)}(交叉淡化应≈1)`,
    minSum > 0.5 ? "ok" : "fail");
  const pass = stepHoles === 0 && maxDev <= 0.003 && minSum > 0.5;
  logLine(pass ? `✔ ${label}通过:无空洞,旋律连续` : `✘ ${label}失败`, pass ? "ok" : "fail");
  return pass;
}

function setDangerAnimated(v) {
  ui.danger.value = Math.round(v);
  refreshDangerUI();
}

// ---------- 模拟完整循环: 探索→警戒→战斗→警戒→探索 ----------
ui.btnSimulate.addEventListener("click", () => {
  if (!engine.running) return;
  ui.btnSimulate.disabled = ui.btnSkipTest.disabled = true;
  const fromTotal = engine.totalSteps, fromGain = engine.gainLog.length;
  logLine("— 开始模拟完整循环(0→100→0,约 22 秒)—", "info");
  const t0 = performance.now();
  const UP = 10000, HOLD = 2000, DOWN = 10000;
  const timer = setInterval(() => {
    const el = performance.now() - t0;
    if (el < UP) setDangerAnimated(el / UP * 100);
    else if (el < UP + HOLD) setDangerAnimated(100);
    else if (el < UP + HOLD + DOWN) setDangerAnimated(100 - (el - UP - HOLD) / DOWN * 100);
    else {
      clearInterval(timer);
      setDangerAnimated(0);
      setTimeout(() => {
        logLine(`循环结束:totalSteps=${engine.totalSteps}(单调递增,未重置)`, "info");
        logLine(`回到探索层时旋律从循环相位 ${engine.totalSteps % LOOP_STEPS} 继续,而非从头播放`, "ok");
        analyzeWindow(fromTotal, fromGain, "完整循环验证");
        ui.btnSimulate.disabled = ui.btnSkipTest.disabled = false;
      }, 800);
    }
  }, 50);
});

// ---------- 手动跳层测试: 探索⇢战斗⇢警戒⇢探索(跨层直跳) ----------
ui.btnSkipTest.addEventListener("click", () => {
  if (!engine.running) return;
  ui.btnSimulate.disabled = ui.btnSkipTest.disabled = true;
  const fromTotal = engine.totalSteps, fromGain = engine.gainLog.length;
  logLine("— 手动跳层测试:探索⇢战斗⇢警戒⇢探索 —", "info");
  const jumps = [[100, 0], [30, 1200], [0, 2400]];
  for (const [v, delay] of jumps) {
    setTimeout(() => {
      setDangerAnimated(v);
      logLine(`  t+${delay}ms 危险值直跳 → ${v}(${LAYER_NAMES[engine.currentLayer()]})`, "info");
    }, delay);
  }
  setTimeout(() => {
    analyzeWindow(fromTotal, fromGain, "跳层验证");
    ui.btnSimulate.disabled = ui.btnSkipTest.disabled = false;
  }, 4200);
});
