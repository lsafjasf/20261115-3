// 浏览器主控：交互对局与回放两种模式，共享同一套确定性引擎。
import { createWorld, TICKS, waterLevelAt, WATER_END } from './world.js';
import { createEngine, resultOf, findOpenRoute } from './engine.js';
import { createAutoPilot } from './autopilot.js';
import { render } from './render.js';
import { FloodAudio } from './audio.js';

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const audio = new FloodAudio();

let world = createWorld();
let engine = createEngine(world);
let pilot = null;
let mode = 'live';                 // live | replay
let replayData = null;
let auto = true;
let timer = null;
let speedMs = 350;
let selectedBus = 1;

const $ = (id) => document.getElementById(id);

function resetLive() {
  world = createWorld();
  engine = createEngine(world);
  pilot = auto ? createAutoPilot(world, engine) : null;
  mode = 'live';
  stopLoop();
  draw();
  log('新对局已就绪：6 辆巴士，30 分钟撤离八成居民。');
}

function startLoop() {
  if (timer) return;
  audio.ensure();
  timer = setInterval(tickOnce, speedMs);
}
function stopLoop() { clearInterval(timer); timer = null; }

let lastClosedCount = 0;
function tickOnce() {
  if (mode === 'replay') { stepReplay(); return; }
  if (engine.tick >= TICKS) { finish(); return; }
  const before = engine.closedAt.size;
  if (auto && pilot) pilot.tick();
  engine.step();
  audio.setWater(waterLevelAt(engine.tick), WATER_END);
  if (engine.closedAt.size > before) {
    audio.alert();
    audio.announce('低洼路段已被洪水切断，注意改道');
  }
  draw();
}

function finish() {
  stopLoop();
  const r = resultOf(engine);
  draw(r.won ? '撤离成功' : '撤离失败', r.won ? '#22c55e' : '#ef4444');
  if (r.won) audio.success(); else audio.fail();
  audio.announce(r.won ? '撤离任务成功' : '撤离任务失败，' + r.reason);
  log(`对局结束：${r.reason}，撤离 ${r.evacuated}/${r.total}。`);
}

function draw(banner, color) {
  render(ctx, world, engine, { banner, bannerColor: color });
  $('hud').textContent =
    `tick ${engine.tick}/${TICKS} · 水位 ${waterLevelAt(engine.tick).toFixed(2)}m · ` +
    `撤离 ${engine.evacuated}/${world.residentsTotal} · 被困 ${engine.trapped.length}`;
  if (mode === 'replay' && replayData) $('seek').value = engine.tick;
}

function log(msg) {
  const box = $('log');
  const line = document.createElement('div');
  line.textContent = `[${String(engine.tick).padStart(3)}] ${msg}`;
  box.prepend(line);
}

// ---- 手动调度 ----
canvas.addEventListener('click', (ev) => {
  if (mode !== 'live' || auto) return;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
  const node = world.nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 16);
  if (!node) return;
  const bus = engine.bus(selectedBus);
  if (!bus || bus.state === 'moving' || bus.state === 'trapped') {
    log(`巴士 ${selectedBus} 行驶中或被困，需到节点才能改道`);
    return;
  }
  const route = findOpenRoute(world, bus.node, node.id, engine.tick);
  if (engine.reroute(bus.id, route, 'player', 'manual-click')) {
    log(`巴士 ${selectedBus} 改道前往节点 ${node.id}`);
    audio.blip(520, 0.1);
    draw();
  } else {
    log(`无法前往节点 ${node.id}：道路封锁或途中淹水`);
  }
});

// ---- 回放 ----
async function loadReplay(file) {
  const text = await file.text();
  replayData = JSON.parse(text);
  world = createWorld(replayData.seed);
  engine = createEngine(world);
  mode = 'replay';
  stopLoop();
  $('seek').max = TICKS;
  log(`已载入回放：${replayData.events.filter((e) => e.kind === 'reroute').length} 条改道指令`);
  draw('回放已载入', '#38bdf8');
}

let replayIdx = 0;
function stepReplay() {
  if (engine.tick >= TICKS) { stopLoop(); return; }
  const tick = engine.tick;
  while (replayIdx < replayData.events.length && replayData.events[replayIdx].tick <= tick) {
    const ev = replayData.events[replayIdx++];
    if (ev.kind === 'priority') engine.setPriority(ev.edgeId, ev.level, ev.source);
    else if (ev.kind === 'reroute') engine.reroute(ev.busId, ev.path, ev.source, ev.reason);
    else if (ev.kind === 'depart-now') engine.departNow(ev.busId, ev.source);
  }
  engine.step();
  audio.setWater(waterLevelAt(engine.tick), WATER_END);
  if (engine.tick >= TICKS) draw('回放结束', '#a3e635'); else draw();
}

// ---- 控件绑定 ----
$('btnStart').onclick = () => { startLoop(); };
$('btnPause').onclick = () => { stopLoop(); };
$('btnReset').onclick = () => { resetLive(); replayIdx = 0; };
$('btnMute').onclick = () => { const m = audio.toggleMute(); $('btnMute').textContent = m ? '取消静音' : '静音'; };
$('speed').onchange = (e) => { speedMs = Number(e.target.value); if (timer) { stopLoop(); startLoop(); } };
$('auto').onchange = (e) => { auto = e.target.checked; resetLive(); };
$('replayFile').onchange = (e) => loadReplay(e.target.files[0]);
$('seek').oninput = (e) => {
  if (mode !== 'replay') return;
  stopLoop();
  const target = Number(e.target.value);
  world = createWorld(replayData.seed);
  engine = createEngine(world);
  replayIdx = 0;
  while (engine.tick < target && engine.tick < TICKS) stepReplay();
  draw();
};
for (const btn of document.querySelectorAll('.bus-sel')) {
  btn.onclick = () => { selectedBus = Number(btn.dataset.bus); log(`已选中巴士 ${selectedBus}`); };
}

resetLive();
draw();
