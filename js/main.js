import { WORLD, DEFAULT_CONFIG, BETTER_CONFIG, THRESHOLDS, RANGES } from './config.js';
import { Simulation, buildPlan } from './engine.js';
import { Renderer } from './render.js';
import { TrafficAudio } from './audio.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const renderer = new Renderer(ctx);
const audio = new TrafficAudio();

// 全程复用同一需求计划：玩家调参/重置/A-B 对比都基于相同的随机交通流
const plan = buildPlan();
let sim = new Simulation({ ...DEFAULT_CONFIG }, plan);
let speed = 3;       // 时间压缩倍率
let paused = false;
let lastConflict = 0;

const $ = id => document.getElementById(id);
const els = {
  clock: $('clock'), phaseTag: $('phaseTag'), banner: $('banner'),
  statWait: $('statWait'), statQueue: $('statQueue'), statLive: $('statLive'),
  statThru: $('statThru'), stateWait: $('stateWait'), stateQueue: $('stateQueue'),
  stateConflict: $('stateConflict'),
  gMain: $('gMain'), gSide: $('gSide'), gPed: $('gPed'),
  busStopX: $('busStopX'), detourPct: $('detourPct'), riskPed: $('riskPed'),
  valGMain: $('valGMain'), valGSide: $('valGSide'), valGPed: $('valGPed'),
  valBus: $('valBus'), valDetour: $('valDetour'), verifyOut: $('verifyOut'),
};
$('thrWait').textContent = THRESHOLDS.avgWait;
$('thrQueue').textContent = THRESHOLDS.maxQueue;

function syncControls() {
  const c = sim.cfg;
  els.gMain.value = c.gMain; els.gSide.value = c.gSide; els.gPed.value = c.gPed;
  els.busStopX.value = c.busStopX; els.detourPct.value = c.detourPct;
  els.riskPed.checked = c.riskPed;
  refreshLabels();
}

function refreshLabels() {
  els.valGMain.textContent = els.gMain.value;
  els.valGSide.textContent = els.gSide.value;
  els.valGPed.textContent = els.gPed.value;
  els.valBus.textContent = els.busStopX.value;
  els.valDetour.textContent = els.detourPct.value;
}

// 调参即时生效（不重置模拟，便于观察同一进程下的干预效果）
function bindRange(el, key) {
  el.addEventListener('input', () => {
    sim.cfg[key] = Number(el.value);
    refreshLabels();
  });
}
bindRange(els.gMain, 'gMain');
bindRange(els.gSide, 'gSide');
bindRange(els.gPed, 'gPed');
bindRange(els.busStopX, 'busStopX');
bindRange(els.detourPct, 'detourPct');
els.riskPed.addEventListener('change', () => { sim.cfg.riskPed = els.riskPed.checked; });

$('btnSuggest').addEventListener('click', () => {
  Object.assign(sim.cfg, BETTER_CONFIG);
  syncControls();
});
$('btnDefault').addEventListener('click', () => {
  Object.assign(sim.cfg, DEFAULT_CONFIG);
  syncControls();
});
$('btnRestart').addEventListener('click', () => {
  const cfg = { ...sim.cfg };
  sim = new Simulation(cfg, plan);
  lastConflict = 0;
  els.banner.classList.add('hidden');
  syncControls();
});

// 暂停 / 时间压缩
$('btnPause').addEventListener('click', () => {
  paused = !paused;
  $('btnPause').textContent = paused ? '▶ 继续' : '⏸ 暂停';
});
document.getElementById('speedGroup').addEventListener('click', e => {
  const b = e.target.closest('button.speed');
  if (!b) return;
  speed = Number(b.dataset.speed);
  document.querySelectorAll('button.speed').forEach(x => x.classList.toggle('active', x === b));
});
document.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); $('btnPause').click(); }
  if (e.key === '1' || e.key === '3' || e.key === '8') {
    document.querySelector(`button.speed[data-speed="${e.key}"]`).click();
  }
});

// 音频需用户手势启动：任意一次点击界面即开启
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });
$('btnMute').addEventListener('click', () => {
  audio.ensure();
  const muted = audio.toggleMute();
  $('btnMute').textContent = muted ? '🔇 静音' : '🔊 音效';
});

function fmtClock(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const PHASE_NAME = { MAIN: '主干绿灯', SIDE: '支路绿灯', PED: '行人相位', RED: '全红清空' };

function updateHud(s) {
  els.clock.textContent = fmtClock(s.t);
  els.phaseTag.textContent = PHASE_NAME[sim.sig?.phase] ?? '—';
  els.statWait.textContent = s.avgWait.toFixed(1);
  els.statQueue.textContent = s.maxQueue;
  els.statLive.textContent = s.liveQueue;
  els.statThru.textContent = s.throughput;
  els.stateWait.textContent = s.passWait ? '✓ 达标' : '✗ 超标';
  els.stateWait.className = 'stat-state ' + (s.passWait ? 'ok' : 'bad');
  els.stateQueue.textContent = s.passQueue ? '✓ 达标' : '✗ 超标';
  els.stateQueue.className = 'stat-state ' + (s.passQueue ? 'ok' : 'bad');
  els.stateConflict.textContent = `人车冲突 ${s.conflicts}`;
  els.stateConflict.className = 'stat-state ' + (s.conflicts > 0 ? 'bad' : 'ok');

  const maxDensity = Math.max(0.08, ...s.density) / 120;
  audio.update(maxDensity, s.liveQueue);
  if (s.conflicts > lastConflict) { audio.blip(); lastConflict = s.conflicts; }

  if (s.finished) {
    const win = s.passWait && s.passQueue;
    els.banner.className = 'banner ' + (win ? 'win' : 'fail');
    els.banner.textContent = win
      ? '🎉 治理成功：两项指标均低于阈值'
      : '⚠ 未达标：调整策略后重置再试';
  }
}

// 固定步长推进；高倍速时每帧多步，但限制单帧最多 16 步防止卡顿
let acc = 0;
let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && !sim.finished) {
    acc += realDt * speed;
    let steps = 0;
    while (acc >= WORLD.dt && steps < 16) {
      sim.step();
      acc -= WORLD.dt;
      steps++;
    }
  }
  renderer.draw(sim);
  updateHud(sim.stats());
  requestAnimationFrame(frame);
}

// A/B 无头验证：同一需求计划，仅移动公交停靠点
$('btnVerify').addEventListener('click', () => {
  const cfgA = { ...sim.cfg, busStopX: 560 };
  const cfgB = { ...sim.cfg, busStopX: 850 };
  const run = cfg => {
    const s = new Simulation(cfg, buildPlan());
    let ebPeak = 0, wbPeak = 0;
    while (!s.finished) {
      s.step();
      const q = s.queueCounts();
      ebPeak = Math.max(ebPeak, q.EB);
      wbPeak = Math.max(wbPeak, q.WB);
    }
    return { stats: s.stats(), ebPeak, wbPeak };
  };
  const a = run(cfgA), b = run(cfgB);
  const row = (label, r) => `<tr><td>${label}</td>
    <td>${r.stats.avgWait.toFixed(2)}</td><td>${r.stats.maxQueue}</td>
    <td>${r.ebPeak}</td><td>${r.wbPeak}</td><td>${r.stats.throughput}</td></tr>`;
  const dWait = (a.stats.avgWait - b.stats.avgWait).toFixed(2);
  const dQueue = a.stats.maxQueue - b.stats.maxQueue;
  els.verifyOut.innerHTML = `
    <table>
      <tr><th>方案</th><th>均停(s)</th><th>峰排</th><th>东行峰</th><th>西行峰</th><th>驶离</th></tr>
      ${row('A 站560m', a)}
      ${row('B 站850m', b)}
    </table>
    <p class="delta-ok" style="margin-top:8px">
      公交站后移效果：平均等待 ↓${dWait}s，峰值排队 ↓${dQueue} 辆；
      西行（上游）峰值维持 ${b.wbPeak} 辆不变，东行下游由 ${a.ebPeak} 降至 ${b.ebPeak}，
      吞吐量 ${a.stats.throughput} → ${b.stats.throughput}。
    </p>`;
});

syncControls();
requestAnimationFrame(frame);
