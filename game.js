/* 渲染、交互与音效。模拟逻辑全部在 sim.js。 */
'use strict';
const Sim = window.FireSim;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const CS = 24; // 每格像素

let state = Sim.createGame(Date.now() % 100000);
state.opts.autoBurst = true;
let running = false;
let speedMul = 1;
let layMode = false;
let layTap = null; // {main, x}
let lastLogSeen = 0;
let acc = 0, lastTs = 0;

// ---------- Web Audio ----------
let AC = null, waterGain, alarmGain, rumbleGain, alarmOsc, alarmLfo;
function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  const noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  // 水流声：噪声 → 带通 → 增益随总流量
  const waterSrc = AC.createBufferSource();
  waterSrc.buffer = noiseBuf; waterSrc.loop = true;
  const waterFilter = AC.createBiquadFilter();
  waterFilter.type = 'bandpass'; waterFilter.frequency.value = 900; waterFilter.Q.value = 0.8;
  waterGain = AC.createGain(); waterGain.gain.value = 0;
  waterSrc.connect(waterFilter).connect(waterGain).connect(AC.destination);
  waterSrc.start();

  // 火势低鸣：噪声 → 低通
  const rumbleSrc = AC.createBufferSource();
  rumbleSrc.buffer = noiseBuf; rumbleSrc.loop = true;
  const rumbleFilter = AC.createBiquadFilter();
  rumbleFilter.type = 'lowpass'; rumbleFilter.frequency.value = 160;
  rumbleGain = AC.createGain(); rumbleGain.gain.value = 0;
  rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(AC.destination);
  rumbleSrc.start();

  // 警报：方波 + LFO 双音
  alarmOsc = AC.createOscillator();
  alarmOsc.type = 'square'; alarmOsc.frequency.value = 660;
  alarmLfo = AC.createOscillator();
  alarmLfo.type = 'square'; alarmLfo.frequency.value = 1.6;
  const lfoGain = AC.createGain(); lfoGain.gain.value = 140;
  alarmLfo.connect(lfoGain).connect(alarmOsc.frequency);
  alarmGain = AC.createGain(); alarmGain.gain.value = 0;
  alarmOsc.connect(alarmGain).connect(AC.destination);
  alarmOsc.start(); alarmLfo.start();
}
function burstSound() {
  if (!AC) return;
  const src = AC.createBufferSource();
  const buf = AC.createBuffer(1, AC.sampleRate * 0.4, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  src.buffer = buf;
  const g = AC.createGain(); g.gain.value = 0.5;
  src.connect(g).connect(AC.destination);
  src.start();
}
function updateAudio() {
  if (!AC) return;
  const totalFlow = state.hoses.reduce((s, h) => s + (h.open ? h.flow : 0), 0);
  waterGain.gain.value = Math.min(0.35, totalFlow * 0.05);
  const fireAvg = state.fires.reduce((s, f) => s + f.intensity, 0) / 300;
  rumbleGain.gain.value = fireAvg * 0.25;
  const alarmOn = state.fires.some(f => !f.extinguished) && state.status === 'running';
  alarmGain.gain.value = alarmOn ? 0.04 : 0;
}
// ---------- 渲染 ----------
function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  const g = state.grid;
  for (let y = 0; y < Sim.H; y++) {
    for (let x = 0; x < Sim.W; x++) {
      const c = g[y * Sim.W + x];
      let color = '#23282f';
      if (c === Sim.CELL.WALL) color = '#4a5160';
      else if (c === Sim.CELL.RACK) color = '#5c4a33';
      else if (c === Sim.CELL.EXIT) color = '#1e5c38';
      else if (c === Sim.CELL.DOOR) {
        const d = state.doors.find(d => d.x === x && d.y === y);
        color = d && d.closed ? '#7a2a2a' : '#2a7a4a';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x * CS, y * CS, CS - 1, CS - 1);
      // 热辐射红晕
      const heat = state.heat[y * Sim.W + x];
      if (heat > 2) {
        ctx.fillStyle = `rgba(255,60,20,${Math.min(0.45, heat / 120)})`;
        ctx.fillRect(x * CS, y * CS, CS - 1, CS - 1);
      }
    }
  }
  // 供水主干（颜色随压力）
  for (const key of ['A', 'B']) {
    const m = state.mains[key];
    const ratio = m.pressure / Sim.PMAX;
    ctx.strokeStyle = `rgba(77,163,255,${0.35 + ratio * 0.65})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(CS, m.row * CS + CS / 2);
    ctx.lineTo((Sim.W - 1) * CS, m.row * CS + CS / 2);
    ctx.stroke();
    ctx.fillStyle = '#9fd0ff';
    ctx.font = '12px sans-serif';
    ctx.fillText(`泵${key} ${(m.speed * 100) | 0}%  ${m.pressure.toFixed(1)}bar`,
      (m.pumpX - 1) * CS + 4, m.row * CS - 4);
  }
  // 水带
  for (const h of state.hoses) {
    ctx.strokeStyle = h.burst ? '#ff8a5c' : (h.open ? '#39c6d6' : '#3a6b72');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(h.tapX * CS + CS / 2, h.tapY * CS + CS / 2);
    ctx.lineTo(h.tx * CS + CS / 2, h.tapY * CS + CS / 2);
    ctx.lineTo(h.tx * CS + CS / 2, h.ty * CS + CS / 2);
    ctx.stroke();
    if (h.burst) { // 破裂喷溅
      const mx = (h.tapX + h.tx) / 2 * CS + CS / 2;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = 'rgba(150,220,255,0.8)';
        ctx.beginPath();
        ctx.arc(mx + (Math.random() - 0.5) * 26, h.tapY * CS + Math.random() * 22, 2, 0, 7);
        ctx.fill();
      }
    }
    if (h.open && h.flow > 0.1) { // 出水点
      ctx.fillStyle = 'rgba(120,200,255,0.7)';
      ctx.beginPath();
      ctx.arc(h.tx * CS + CS / 2, h.ty * CS + CS / 2, 4 + h.flow * 2, 0, 7);
      ctx.fill();
    }
  }
  // 火点
  for (const f of state.fires) {
    if (f.extinguished) continue;
    const r = 4 + f.intensity * 0.14 + Math.random() * 2;
    const grad = ctx.createRadialGradient(f.x * CS + 12, f.y * CS + 12, 1, f.x * CS + 12, f.y * CS + 12, r);
    grad.addColorStop(0, '#fff3a0');
    grad.addColorStop(0.5, '#ff8c2a');
    grad.addColorStop(1, 'rgba(200,30,10,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(f.x * CS + 12, f.y * CS + 12, r, 0, 7);
    ctx.fill();
  }
  // 人员
  for (const w of state.workers) {
    if (w.evacuated || w.dead) continue;
    ctx.fillStyle = '#f2f5fa';
    ctx.beginPath();
    ctx.arc(w.x * CS + 12, w.y * CS + 12, 5, 0, 7);
    ctx.fill();
    ctx.strokeStyle = w.hp > 60 ? '#4ade80' : '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w.x * CS + 12, w.y * CS + 12, 8, -Math.PI / 2, -Math.PI / 2 + (w.hp / 100) * Math.PI * 2);
    ctx.stroke();
  }
  // 烟层（能见度）
  for (let y = 0; y < Sim.H; y++) {
    for (let x = 0; x < Sim.W; x++) {
      const sm = state.smoke[y * Sim.W + x];
      if (sm > 0.03) {
        ctx.fillStyle = `rgba(20,20,24,${Math.min(0.88, sm * 0.85)})`;
        ctx.fillRect(x * CS, y * CS, CS, CS);
      }
    }
  }
  // 铺设模式提示
  if (layMode) {
    ctx.fillStyle = '#ffd166';
    ctx.font = '14px sans-serif';
    ctx.fillText(layTap ? `已选主干${layTap.main}接口 (${layTap.x})，点击目标位置` : '铺设模式：先点击主干A(下)或主干B(上)选择接口', 10, cv.height - 8);
  }
}
// ---------- 交互 ----------
cv.addEventListener('click', (e) => {
  if (!layMode) return;
  const rect = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CS);
  const y = Math.floor((e.clientY - rect.top) / CS);
  if (!layTap) {
    for (const key of ['A', 'B']) {
      if (y === state.mains[key].row && x >= 1 && x <= Sim.W - 2) {
        layTap = { main: key, x };
        return;
      }
    }
    return;
  }
  const res = Sim.layHose(state, layTap.main, layTap.x, x, y);
  if (!res.ok) flashLog(res.error);
  layMode = false;
  layTap = null;
  document.getElementById('btnLay').classList.remove('active');
  syncUI();
});

document.getElementById('btnLay').onclick = () => {
  layMode = !layMode;
  layTap = null;
  document.getElementById('btnLay').classList.toggle('active', layMode);
};
document.getElementById('btnStart').onclick = (e) => {
  initAudio();
  running = !running;
  e.target.textContent = running ? '暂停' : '开始';
};
document.getElementById('btnSpeed').onclick = (e) => {
  speedMul = speedMul === 1 ? 2 : speedMul === 2 ? 4 : 1;
  e.target.textContent = speedMul + 'x';
};
document.getElementById('btnRestart').onclick = () => {
  state = Sim.createGame(Date.now() % 100000);
  state.opts.autoBurst = true;
  running = false;
  lastLogSeen = 0;
  document.getElementById('btnStart').textContent = '开始';
  document.getElementById('log').innerHTML = '';
  syncUI();
};
for (const key of ['A', 'B']) {
  document.getElementById('pump' + key).oninput = (e) => {
    Sim.setPump(state, key, e.target.value / 100);
    document.getElementById('pump' + key + 'v').textContent = e.target.value + '%';
  };
}

function flashLog(msg) {
  const el = document.getElementById('log');
  el.innerHTML += `<div style="color:#ff9d9d">${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function syncUI() {
  const mm = String((state.t / 60) | 0).padStart(2, '0');
  const ss = String(state.t % 60).padStart(2, '0');
  document.getElementById('clock').textContent = `${mm}:${ss}`;
  const st = document.getElementById('status');
  st.textContent = state.status === 'won' ? '✔ 成功' : state.status === 'lost' ? '✘ 失败' : (running ? '扑救中' : '待命');
  st.style.color = state.status === 'won' ? '#4ade80' : state.status === 'lost' ? '#ff6b6b' : '#dde3ea';
  for (const key of ['A', 'B']) {
    const m = state.mains[key];
    document.getElementById('gauge' + key).style.width = (m.pressure / Sim.PMAX * 100) + '%';
    document.getElementById('press' + key).textContent = m.pressure.toFixed(1) + ' bar';
  }
  const hoseBox = document.getElementById('hoses');
  hoseBox.innerHTML = '';
  for (const h of state.hoses) {
    const div = document.createElement('div');
    div.className = 'hose-item';
    div.innerHTML = `#${h.id} 主干${h.main}→(${h.tx},${h.ty}) ` +
      `${h.flow.toFixed(1)}L/s ${h.pressure.toFixed(1)}bar ` +
      (h.burst ? '<span class="burst-tag">[破裂]</span>' : '');
    const btn = document.createElement('button');
    btn.textContent = h.open ? '关闭支路' : '开启支路';
    btn.onclick = () => { Sim.setBranch(state, h.id, !h.open); syncUI(); };
    div.appendChild(btn);
    hoseBox.appendChild(div);
  }
  // 事件日志增量
  const logEl = document.getElementById('log');
  for (; lastLogSeen < state.log.length; lastLogSeen++) {
    const ev = state.log[lastLogSeen];
    if (ev.type === 'burst') burstSound();
    const mm2 = String((ev.t / 60) | 0).padStart(2, '0');
    const ss2 = String(ev.t % 60).padStart(2, '0');
    logEl.innerHTML += `<div>[${mm2}:${ss2}] ${ev.msg}</div>`;
  }
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------- 主循环：1x = 每秒推进 4 个模拟秒 ----------
function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (running && state.status === 'running') {
    acc += dt * 4 * speedMul;
    while (acc >= 1) { Sim.step(state); acc -= 1; }
    updateAudio();
    syncUI();
  }
  draw();
  requestAnimationFrame(loop);
}
syncUI();
requestAnimationFrame(loop);
