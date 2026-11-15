import { SIM_DURATION } from './config.js';
import {
  createGame,
  deliveredCount,
  dispatch,
  dispatchableVehicles,
  findVehicle,
  refuel,
  reroute,
  step,
} from './engine.js';
import { NODES } from './map.js';
import { createAudioManager } from './audio.js';
import { drawVictimStatusBars, render, vehiclePosition } from './renderer.js';

const SEED = 20261115;
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const victimCanvas = document.getElementById('victim-canvas');
const victimCtx = victimCanvas.getContext('2d');
const audio = createAudioManager();

let state = createGame(SEED);
let selectedVehicleId = null;
let selectedNodeId = null;
let running = true;
let timer = null;
const seenEvents = new Set();
const criticalVictims = new Set();

const el = (id) => document.getElementById(id);

function reset() {
  state = createGame(SEED);
  seenEvents.clear();
  criticalVictims.clear();
  selectedVehicleId = null;
  selectedNodeId = null;
  el('banner').className = '';
  el('banner').textContent = '';
  el('log').innerHTML = '';
  drawAll();
}

function selectedVehicle() {
  return selectedVehicleId ? findVehicle(state, selectedVehicleId) : null;
}

function consumeEvents() {
  for (let i = 0; i < state.events.length; i += 1) {
    const key = `${i}-${state.seed}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    const event = state.events[i];
    appendLog(event);
    audio.play(event.kind === 'win' || event.kind === 'fail' ? event.kind : event.kind);
  }
}

function appendLog(event) {
  const log = el('log');
  const line = document.createElement('div');
  const tone = event.kind === 'win' || event.kind === 'control' || event.kind === 'deliver'
    ? 'good'
    : event.kind === 'fail' || event.kind === 'warning' || event.kind === 'death' || event.kind === 'stranded'
      ? 'bad'
      : event.kind === 'detour' ? 'warn' : '';
  line.className = tone;
  line.textContent = `[${String(event.time).padStart(2, '0')}分] ${event.text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function watchVictims() {
  for (const victim of state.victims) {
    if (victim.alive && victim.state !== 'delivered' && victim.status < 35 && !criticalVictims.has(victim.id)) {
      criticalVictims.add(victim.id);
      audio.play('siren');
      appendLog({ time: state.time, text: `警报：${victim.id} 生命体征危急！`, kind: 'warning' });
    }
  }
}

function drawAll() {
  render(ctx, state, selectedVehicleId);
  if (selectedNodeId) {
    const node = NODES[selectedNodeId];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  victimCtx.clearRect(0, 0, victimCanvas.width, victimCanvas.height);
  drawVictimStatusBars(victimCtx, state, 10, 18);
  updateHud();
}

function updateHud() {
  el('seed').textContent = state.seed;
  el('clock').textContent = `${state.time} / ${SIM_DURATION} 分钟`;
  el('delivered').textContent = `${deliveredCount(state)} / 7`;
  el('dispatchable').textContent = `${dispatchableVehicles(state)} 辆`;
  el('medics').textContent = `${state.medicsAtDepot} 人`;
  renderVehicleCards();
  updateButtons();
  if (state.finished) {
    const banner = el('banner');
    banner.className = state.result.win ? 'win' : 'fail';
    banner.textContent = `${state.result.win ? '✅ 任务成功' : '❌ 任务失败'}：${state.result.reason}`;
    running = false;
    el('play').textContent = '已结束';
  }
}

const STATUS_LABEL = {
  idle: '空闲',
  moving: '行驶中',
  loading: '接载中',
  unloading: '送院中',
  refueling: '补能中',
  stranded: '抛锚',
};

function renderVehicleCards() {
  const list = el('vehicle-list');
  list.innerHTML = '';
  for (const vehicle of state.vehicles) {
    const card = document.createElement('div');
    card.className = `vehicle-card${vehicle.id === selectedVehicleId ? ' selected' : ''}${vehicle.status === 'stranded' ? ' stranded' : ''}`;
    card.innerHTML = `
      <strong>${vehicle.id} · ${vehicle.name}</strong>
      （${vehicle.equipment}装备，容量${vehicle.capacity}，担架${vehicle.medics}人）<br/>
      状态：${STATUS_LABEL[vehicle.status]} ｜ 位置：${NODES[vehicle.nodeId].name}
      ｜ 续航：${vehicle.rangeLeft}/${vehicle.range}km ｜ 载员：${vehicle.carrying.length}
    `;
    card.addEventListener('click', () => {
      selectedVehicleId = vehicle.id;
      drawAll();
    });
    list.appendChild(card);
  }
}

function updateButtons() {
  const vehicle = selectedVehicle();
  const atDepot = vehicle && vehicle.nodeId === 'DEPOT' && vehicle.status === 'idle';
  const canReroute = vehicle && ['moving', 'idle', 'loading', 'unloading'].includes(vehicle.status);
  el('btn-dispatch').disabled = !atDepot || !selectedNodeId;
  el('btn-reroute').disabled = !canReroute || !selectedNodeId;
  el('btn-refuel').disabled = !atDepot;
}

function handleCanvasClick(event) {
  audio.unlock();
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  for (const vehicle of state.vehicles) {
    const pos = vehiclePosition(vehicle);
    if (Math.hypot(pos.x - x, pos.y + 16 - y) <= 10) {
      selectedVehicleId = vehicle.id;
      drawAll();
      return;
    }
  }
  for (const node of Object.values(NODES)) {
    if (Math.hypot(node.x - x, node.y - y) <= 16) {
      selectedNodeId = node.id;
      drawAll();
      return;
    }
  }
}

function showResult(result) {
  if (!result.ok) {
    appendLog({ time: state.time, text: `指令被拒绝：${result.error}`, kind: 'warning' });
    audio.play('warning');
  } else {
    consumeEvents();
    drawAll();
  }
}

el('btn-dispatch').addEventListener('click', () => {
  const vehicle = selectedVehicle();
  const medics = Math.max(1, Math.min(Number(el('medic-count').value) || 1, vehicle.capacity));
  showResult(dispatch(state, vehicle.id, selectedNodeId, medics));
});

el('btn-reroute').addEventListener('click', () => {
  showResult(reroute(state, selectedVehicle().id, selectedNodeId));
});

el('btn-refuel').addEventListener('click', () => {
  showResult(refuel(state, selectedVehicle().id));
});

canvas.addEventListener('click', handleCanvasClick);

el('play').addEventListener('click', () => {
  if (state.finished) return;
  running = !running;
  el('play').textContent = running ? '暂停' : '继续';
});

el('restart').addEventListener('click', () => {
  reset();
  running = true;
  el('play').textContent = '暂停';
});

el('mute').addEventListener('click', () => {
  const muted = audio.toggleMute();
  el('mute').textContent = muted ? '🔇 音效关' : '🔊 音效开';
});

el('speed').addEventListener('change', (event) => {
  clearInterval(timer);
  timer = setInterval(tick, Number(event.target.value));
});

function tick() {
  if (!running || state.finished) return;
  step(state, 1);
  consumeEvents();
  watchVictims();
  drawAll();
}

reset();
timer = setInterval(tick, Number(el('speed').value));
