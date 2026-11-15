// Browser UI: live play with recording, then replay with
// pause / single-step / diff timeline / tamper-and-validate.
import { initialState, update, hashState, INPUTS, WIDTH, HEIGHT } from './game.js';
import { createRecording, recordTick, finalize } from './recorder.js';
import { createReplayer, validate } from './replay.js';

const CELL = 40;
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const TICK_MS = 140;

const app = {
  mode: 'live',          // 'live' | 'replay'
  paused: false,
  state: null,
  recording: null,
  pendingInput: INPUTS.STAY,
  replayer: null,
  replayResults: [],     // per-tick {tick, match} from stepped replay
  timer: null,
};

function newGame() {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  app.mode = 'live';
  app.paused = false;
  app.state = initialState(seed);
  app.recording = createRecording(seed);
  app.replayer = null;
  app.replayResults = [];
  setStatus(`新对局 seed=${seed}\n方向键 ← → 移动，空格暂停`);
  updateButtons();
  startLoop();
}

function liveTick() {
  if (app.state.over) { endRun(); return; }
  const input = app.pendingInput;
  app.pendingInput = INPUTS.STAY;
  update(app.state, input);
  recordTick(app.recording, input, app.state);
  if (app.state.over) endRun();
}

function endRun() {
  finalize(app.recording, app.state);
  stopLoop();
  app.mode = 'replay';
  app.replayer = createReplayer(app.recording);
  app.replayResults = [];
  setStatus(`对局结束：${app.recording.inputs.length} ticks, ` +
    `score=${app.state.score}, finalHash=${app.recording.finalHash}\n可回放、校验或篡改验证。`);
  updateButtons();
  buildTimeline();
  startLoop();
}

function startLoop() {
  stopLoop();
  app.timer = setInterval(() => {
    if (app.paused) return;
    if (app.mode === 'live') liveTick();
    else replayStep();
    render();
  }, TICK_MS);
}
function stopLoop() { if (app.timer) clearInterval(app.timer); app.timer = null; }

function setStatus(text, cls = '') {
  const el = $('status');
  el.textContent = text;
  el.className = cls;
}

// ---------- replay ----------
function replayStep() {
  if (!app.replayer || app.replayer.done) { app.paused = true; return; }
  const r = app.replayer.step();
  app.replayResults.push(r);
  if (!r.match) {
    app.paused = true;
    setStatus(`⚠ 首次分叉：tick ${r.tick}\n期望哈希 ${r.expected}\n实际哈希 ${r.actual}`, 'bad');
  }
  if (app.replayer.done && app.replayResults.every((x) => x.match)) {
    app.paused = true;
    setStatus(`✓ 回放完成，${app.replayResults.length} ticks 全部一致\n` +
      `finalHash=${hashState(app.replayer.state)}`, 'good');
  }
  updateTimeline();
}

function runValidate() {
  const result = validate(app.recording);
  app.replayResults = result.timeline;
  // fast-forward the visual replayer to the end
  app.replayer = createReplayer(app.recording);
  while (!app.replayer.done) app.replayer.step();
  app.paused = true;
  if (result.ok) {
    setStatus(`✓ 校验通过：${result.ticks} ticks，finalHash=${result.finalHash}`, 'good');
  } else {
    const d = result.firstDivergence;
    setStatus(`✗ 校验失败：首次分叉在 tick ${d.tick}（输入 ${d.input}）\n` +
      `期望 ${d.expected}，实际 ${d.actual}`, 'bad');
  }
  updateTimeline();
}

function tamperOne() {
  // flip one mid-run input, like a corrupted log entry
  const n = app.recording.inputs.length;
  const i = Math.floor(n / 2) + Math.floor(Math.random() * Math.floor(n / 4));
  const old = app.recording.inputs[i];
  app.recording.inputs[i] = old === INPUTS.LEFT ? INPUTS.RIGHT : INPUTS.LEFT;
  app.replayer = createReplayer(app.recording);
  app.replayResults = [];
  app.paused = true;
  setStatus(`已篡改 input[${i}]：${old} → ${app.recording.inputs[i]}\n` +
    `点击「校验整局」或回放单步，观察分叉定位。`);
  updateTimeline();
}

// ---------- timeline ----------
function buildTimeline() {
  const tl = $('timeline');
  tl.innerHTML = '';
  app.recording.inputs.forEach((_, i) => {
    const c = document.createElement('div');
    c.className = 'cell pending';
    c.textContent = i + 1;
    c.title = `tick ${i + 1}`;
    c.onclick = () => jumpTo(i + 1);
    tl.appendChild(c);
  });
}

function updateTimeline() {
  const cells = $('timeline').children;
  let diverged = false;
  for (let i = 0; i < cells.length; i++) {
    const r = app.replayResults[i];
    const c = cells[i];
    c.className = 'cell ' + (!r ? 'pending' : (r.match && !diverged ? '' : 'mismatch'));
    if (r && !r.match) diverged = true;
    if (app.replayer && i === app.replayer.cursor - 1) c.classList.add('cursor');
  }
}

function jumpTo(tick) {
  if (app.mode !== 'replay') return;
  app.replayer = createReplayer(app.recording);
  app.replayResults = [];
  while (app.replayer.cursor < tick && !app.replayer.done) {
    app.replayResults.push(app.replayer.step());
  }
  app.paused = true;
  updateTimeline();
  render();
}

// ---------- rendering ----------
function render() {
  const s = app.mode === 'live' ? app.state : app.replayer?.state;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!s) return;
  ctx.strokeStyle = '#1c2027';
  for (let x = 1; x < WIDTH; x++) {
    ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, HEIGHT * CELL); ctx.stroke();
  }
  for (const o of s.obstacles) drawCell(o.x, o.y, '#c0392b');
  for (const c of s.coins) drawCell(c.x, c.y, '#f1c40f');
  drawCell(s.playerX, HEIGHT - 1, '#2d9cdb');
  if (s.over && app.mode === 'live') {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
  }
  const hash = hashState(s);
  const label = app.mode === 'live'
    ? `tick=${s.tick} score=${s.score} hash=${hash} ${app.paused ? '[已暂停]' : ''}`
    : `回放 tick=${app.replayer.cursor}/${app.recording.inputs.length} ` +
      `hash=${hash} ${app.paused ? '[已暂停]' : ''}`;
  (app.mode === 'live' ? $('liveStats') : $('replayStats')).textContent = label;
}

function drawCell(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
}

// ---------- wiring ----------
function updateButtons() {
  const live = app.mode === 'live';
  $('btnPause').disabled = !live;
  $('btnStep').disabled = !live;
  $('btnFinish').disabled = !live;
  $('btnRpPlay').disabled = live;
  $('btnRpStep').disabled = live;
  $('btnValidate').disabled = live;
  $('btnTamper').disabled = live;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') app.pendingInput = INPUTS.LEFT;
  else if (e.key === 'ArrowRight') app.pendingInput = INPUTS.RIGHT;
  else if (e.key === ' ') { app.paused = !app.paused; e.preventDefault(); }
});

$('btnPause').onclick = () => { app.paused = !app.paused; };
$('btnStep').onclick = () => { app.paused = true; liveTick(); render(); };
$('btnNew').onclick = () => { newGame(); render(); };
$('btnFinish').onclick = () => { endRun(); render(); };
$('btnRpPlay').onclick = () => { app.paused = !app.paused; };
$('btnRpStep').onclick = () => { app.paused = true; replayStep(); render(); };
$('btnValidate').onclick = () => { runValidate(); render(); };
$('btnTamper').onclick = () => { tamperOne(); render(); };

newGame();
startLoop();
setInterval(render, 50);
