import { AudioEngine } from './audio.js';
import { createSceneRenderer } from './renderer.js';
import {
  DURATION_MIN,
  PUMP_SPECS,
  createSimulation,
  getRainAt,
  getWarnings,
  resetBus,
  setHospitalSource,
  setPumpSpeed,
  startPump,
  startRepair,
  stepSimulation,
  stopPump
} from './simulation.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  clock: $('#clock'),
  rainNow: $('#rainNow'),
  missionStatus: $('#missionStatus'),
  weatherReadout: $('#weatherReadout'),
  busCurrent: $('#busCurrent'),
  busBar: $('#busBar'),
  busCaption: $('#busCaption'),
  riverLevel: $('#riverLevel'),
  riverNote: $('#riverNote'),
  totalFlow: $('#totalFlow'),
  flowNote: $('#flowNote'),
  alarmStack: $('#alarmStack'),
  canvasCoach: $('#canvasCoach'),
  transport: $('#btnTransport'),
  transportLabel: $('#transportLabel'),
  step: $('#btnStep'),
  reset: $('#btnReset'),
  playhead: $('#timelinePlayhead'),
  playheadTime: $('#playheadTime'),
  timelineFill: $('#timelineFill'),
  timelineEvents: $('#timelineEvents'),
  rainProfile: $('#rainProfile'),
  eventLog: $('#eventLog'),
  eventCount: $('#eventCount'),
  pumpList: $('#pumpList'),
  missionClock: $('#missionClock'),
  objectiveHospital: $('#objectiveHospital'),
  objectiveZones: $('#objectiveZones'),
  objectiveTime: $('#objectiveTime'),
  hospitalObjectiveNote: $('#hospitalObjectiveNote'),
  zoneObjectiveNote: $('#zoneObjectiveNote'),
  hospitalPower: $('#hospitalPower'),
  generatorFuel: $('#generatorFuel'),
  sourceSwitch: $('#sourceSwitch'),
  fuelBar: $('#fuelBar'),
  busProtectionText: $('#busProtectionText'),
  resetBus: $('#btnResetBus'),
  audio: $('#btnAudio'),
  help: $('#btnHelp'),
  helpModal: $('#helpModal'),
  helpClose: $('#btnHelpClose'),
  helpStart: $('#btnHelpStart'),
  resultModal: $('#resultModal'),
  resultEmblem: $('#resultEmblem'),
  resultEyebrow: $('#resultEyebrow'),
  resultTitle: $('#resultTitle'),
  resultDescription: $('#resultDescription'),
  resultReasons: $('#resultReasons'),
  resultStats: $('#resultStats'),
  resultRestart: $('#btnResultRestart'),
  resultClose: $('#btnResultClose')
};

const canvas = $('#scene');
const renderer = createSceneRenderer(canvas);
const audio = new AudioEngine();
let simulation = createSimulation();
let paused = true;
let hasStarted = false;
let speed = 1;
let accumulator = 0;
let lastFrame = performance.now();
let lastUiPaint = 0;
let lastWarningSignature = '';
let lastEventCount = -1;
let resultShown = false;
let resultTimer = null;
const pumpViews = new Map();

function createPumpCards() {
  for (const spec of PUMP_SPECS) {
    const card = document.createElement('article');
    card.className = 'pump-card';
    card.dataset.pump = spec.id;
    card.style.setProperty('--pump-color', spec.color);
    card.style.setProperty(
      '--pump-glow',
      'radial-gradient(circle, rgba(105, 234, 217, 0.55), transparent 70%)'
    );
    card.innerHTML = `
      <div class="pump-head">
        <span class="pump-id">${spec.id}</span>
        <div class="pump-title">
          <strong>${spec.name}</strong>
          <small>排 ${spec.maxFlow} m³/s · 额 ${spec.ratedCurrent} A</small>
        </div>
        <span class="pump-state"><i></i><span>待机</span></span>
      </div>
      <div class="pump-readings">
        <div class="reading"><label>电流</label><strong class="current">0.0 A</strong></div>
        <div class="reading"><label>流量</label><strong class="flow">0.00</strong></div>
        <div class="reading"><label>健康度</label><strong class="health">100%</strong></div>
      </div>
      <div class="speed-row">
        <label for="speed-${spec.id}">转速</label>
        <input class="speed-slider" id="speed-${spec.id}" type="range" min="40" max="110" step="1" value="${spec.initialSpeed}" />
        <output for="speed-${spec.id}">${spec.initialSpeed}%</output>
      </div>
      <div class="overload-track"><i></i></div>
      <div class="pump-actions">
        <button class="toggle-pump" type="button">启动泵组</button>
        <button class="repair-pump" type="button" disabled>抢修</button>
      </div>
    `;
    elements.pumpList.append(card);
    const view = {
      card,
      state: card.querySelector('.pump-state'),
      stateText: card.querySelector('.pump-state span'),
      current: card.querySelector('.current'),
      flow: card.querySelector('.flow'),
      health: card.querySelector('.health'),
      speed: card.querySelector('.speed-slider'),
      output: card.querySelector('output'),
      overload: card.querySelector('.overload-track i'),
      toggle: card.querySelector('.toggle-pump'),
      repair: card.querySelector('.repair-pump')
    };
    pumpViews.set(spec.id, view);

    view.speed.addEventListener('input', () => {
      const result = setPumpSpeed(simulation, spec.id, Number(view.speed.value));
      if (!result.ok) showToast(result.message, 'warning');
      syncSpeedControl(spec.id, Number(view.speed.value));
      renderUI(true);
    });
    view.toggle.addEventListener('click', () => {
      const pump = simulation.pumps[spec.id];
      const result = pump.on ? stopPump(simulation, spec.id) : startPump(simulation, spec.id);
      showToast(result.message, result.ok ? 'info' : 'warning');
      renderUI(true);
    });
    view.repair.addEventListener('click', () => {
      const result = startRepair(simulation, spec.id);
      showToast(result.message, result.ok ? 'info' : 'warning');
      renderUI(true);
    });
  }
}

function buildRainProfile() {
  const count = 90;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const minute = (index / (count - 1)) * DURATION_MIN;
    const rain = getRainAt(minute);
    const bar = document.createElement('span');
    bar.className = 'rain-bar';
    bar.style.left = `${(index / count) * 100}%`;
    bar.style.height = `${8 + (rain / 120) * 86}%`;
    fragment.append(bar);
  }
  elements.rainProfile.append(fragment);
}

function showToast(message, tone = 'info') {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, 2300);
}

function formatClock(minute) {
  if (Math.round(minute) >= DURATION_MIN) return '24:00';
  const absolute = 18 * 60 + Math.round(minute);
  const hours = Math.floor(absolute / 60) % 24;
  const minutes = absolute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatRemaining(minute) {
  const remaining = Math.max(0, DURATION_MIN - minute);
  return `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(
    Math.round(remaining % 60)
  ).padStart(2, '0')}`;
}

function syncSpeedControl(pumpId, speedValue) {
  const view = pumpViews.get(pumpId);
  if (!view) return;
  const fill = ((speedValue - 40) / 70) * 100;
  view.speed.value = speedValue;
  view.speed.style.setProperty('--speed-fill', `${fill}%`);
  view.output.textContent = `${speedValue}%`;
}

function renderUI(force = false) {
  const state = simulation;
  const totalFlow = Object.values(state.pumps).reduce(
    (sum, pump) => sum + pump.flow,
    0
  );
  const activePumps = Object.values(state.pumps).filter((pump) => pump.running).length;

  elements.clock.textContent = formatClock(state.t);
  elements.missionClock.textContent = formatRemaining(state.t);
  elements.rainNow.textContent = `${Math.round(state.storm.rain)} mm/h`;
  elements.weatherReadout.textContent =
    state.storm.rain > 95
      ? '强回波逼近 · 阵风 8级'
      : state.storm.rain > 55
        ? '南风 6级 · 强降雨持续'
        : '南风 4级 · 雨势减弱';

  const statusText =
    state.status === 'won'
      ? '调度完成'
      : state.status === 'lost'
        ? '任务失守'
        : paused
          ? '已暂停'
          : '调度中';
  elements.missionStatus.className = `status-pill ${
    state.status === 'won'
      ? 'won'
      : state.status === 'lost'
        ? 'lost'
        : paused
          ? 'paused'
          : 'running'
  }`;
  elements.missionStatus.innerHTML = `<i></i>${statusText}`;

  elements.busCurrent.textContent = state.bus.current.toFixed(1);
  elements.busBar.style.width = `${clampValue(state.bus.loadPct, 0, 110)}%`;
  elements.busBar.style.background = state.bus.tripped
    ? 'linear-gradient(90deg, #ff6f68, #f6c66b)'
    : state.bus.loadPct > 100
      ? 'linear-gradient(90deg, #ff9d5c, #ff6f68)'
      : state.bus.loadPct > 90
        ? 'linear-gradient(90deg, #69ead9, #f6c66b)'
        : 'linear-gradient(90deg, #69ead9, #83b7ff)';
  elements.busCaption.textContent = state.bus.tripped
    ? '保护跳闸'
    : state.bus.loadPct > 100
      ? `过载 ${state.bus.overloadMinutes}/4 分钟`
      : state.bus.loadPct > 90
        ? '接近容量上限'
        : '供电正常';

  elements.riverLevel.textContent = state.river.level.toFixed(2);
  elements.riverNote.textContent =
    state.river.level >= state.river.danger
      ? '已超警戒 · 沿江渗水'
      : `距警戒 ${(state.river.danger - state.river.level).toFixed(2)} m`;
  elements.riverNote.style.color =
    state.river.level >= state.river.danger ? 'var(--orange)' : '';
  elements.totalFlow.textContent = totalFlow.toFixed(1);
  elements.flowNote.textContent =
    activePumps === 0 ? '三泵待机' : `${activePumps}/3 泵组运行中`;

  elements.hospitalPower.textContent = state.hospital.powered ? '正常' : '失电';
  elements.hospitalPower.classList.toggle('danger', !state.hospital.powered);
  elements.generatorFuel.textContent = `${Math.round(state.hospital.generatorFuel)} min`;
  elements.generatorFuel.classList.toggle(
    'danger',
    state.hospital.generatorFuel < 30
  );
  elements.fuelBar.style.width = `${(state.hospital.generatorFuel / 260) * 100}%`;
  for (const button of elements.sourceSwitch.querySelectorAll('button')) {
    button.classList.toggle(
      'active',
      button.dataset.source === state.hospital.source
    );
    button.disabled =
      state.status !== 'running' ||
      (button.dataset.source === 'generator' &&
        state.hospital.generatorFuel <= 0);
  }

  renderObjectives(state);
  renderPumps(state);
  renderBusRecovery(state);
  renderTimeline(state);
  if (force || state.events.length !== lastEventCount) {
    renderEventLog(state);
    renderTimelineEvents(state);
    lastEventCount = state.events.length;
  }
  renderWarnings(state);
}

function renderObjectives(state) {
  const hospitalFailed = state.hospital.everLostPower || !state.hospital.powered;
  const hospitalWarning =
    !hospitalFailed &&
    state.hospital.source === 'generator' &&
    state.hospital.generatorFuel < 30;
  elements.objectiveHospital.className = `objective ${
    hospitalFailed ? 'failed' : hospitalWarning ? 'warning' : ''
  }`;
  elements.hospitalObjectiveNote.textContent = hospitalFailed
    ? '医院支线已失电'
    : state.hospital.source === 'generator'
      ? `柴油发电机供电 · 余 ${Math.round(state.hospital.generatorFuel)} 分钟`
      : '当前由共用母线供电';

  const flooded = Object.values(state.zones).filter((zone) => zone.flooded);
  const closest = Object.values(state.zones)
    .filter((zone) => !zone.flooded)
    .sort((a, b) => b.level / b.threshold - a.level / a.threshold)[0];
  const zoneWarning = closest && closest.level > closest.threshold - 0.1;
  elements.objectiveZones.className = `objective ${
    flooded.length ? 'failed' : zoneWarning ? 'warning' : ''
  }`;
  elements.zoneObjectiveNote.textContent = flooded.length
    ? `${flooded.map((zone) => zone.shortName).join('、')}已进水`
    : zoneWarning
      ? `${closest.shortName} ${closest.level.toFixed(2)}m，逼近阈值`
      : '监测中 · 暂无进水';

  const timeState =
    state.status === 'won' ? '' : state.status === 'lost' ? 'failed' : '';
  elements.objectiveTime.className = `objective ${timeState}`;
}

function renderPumps(state) {
  for (const spec of PUMP_SPECS) {
    const pump = state.pumps[spec.id];
    const view = pumpViews.get(spec.id);
    if (!view) continue;
    const stateLabel = pump.faulted
      ? '设备故障'
      : pump.repairing
        ? `抢修 ${pump.repairMinutes}′`
        : pump.running
          ? '运行'
          : pump.on
            ? '启动中'
            : '停机';
    view.card.classList.toggle('faulted', pump.faulted);
    view.state.className = `pump-state ${
      pump.faulted
        ? 'faulted'
        : pump.repairing
          ? 'repairing'
          : pump.running
            ? 'running'
            : ''
    }`;
    view.stateText.textContent = stateLabel;
    view.current.textContent = `${pump.current.toFixed(1)} A`;
    view.current.classList.toggle(
      'hot',
      pump.baseCurrent > pump.ratedCurrent * 1.045
    );
    view.flow.textContent = `${pump.flow.toFixed(2)} m³/s`;
    view.health.textContent = `${Math.round(pump.health)}%`;
    view.health.classList.toggle('hot', pump.health < 70);
    if (Number(view.speed.value) !== pump.speed) {
      syncSpeedControl(spec.id, pump.speed);
    }
    view.speed.disabled = state.status !== 'running';
    view.overload.style.width = `${Math.min(100, (pump.overloadMinutes / 24) * 100)}%`;
    view.toggle.textContent = pump.on
      ? '停止泵组'
      : pump.faulted
        ? '设备故障'
        : pump.repairing
          ? '抢修中'
          : '启动泵组';
    view.toggle.classList.toggle('running', pump.on);
    view.toggle.disabled = state.status !== 'running';
    view.repair.disabled =
      state.status !== 'running' || !pump.faulted || pump.repairing;
    view.repair.textContent = pump.repairing
      ? `抢修 ${pump.repairMinutes}′`
      : pump.faulted
        ? '立即抢修'
        : '抢修';
  }
}

function renderBusRecovery(state) {
  if (state.bus.tripped) {
    const waiting = state.t < state.bus.cooldownUntil;
    elements.busProtectionText.className = 'tripped';
    elements.busProtectionText.innerHTML = `<i></i>母线保护已动作`;
    elements.resetBus.disabled = waiting || state.status !== 'running';
    elements.resetBus.textContent = waiting
      ? `冷却 ${Math.ceil(state.bus.cooldownUntil - state.t)}′`
      : '执行复位';
  } else {
    elements.busProtectionText.className = '';
    elements.busProtectionText.innerHTML = `<i></i>母线保护就绪`;
    elements.resetBus.disabled = true;
    elements.resetBus.textContent = '母线复位';
  }
}

function renderTimeline(state) {
  const progress = clampValue((state.t / DURATION_MIN) * 100, 0, 100);
  elements.playhead.style.left = `${progress}%`;
  elements.playheadTime.textContent = formatClock(state.t);
  elements.timelineFill.style.width = `${progress}%`;
}

function renderEventLog(state) {
  const events = state.events.slice(-7).reverse();
  if (!events.length) {
    elements.eventLog.innerHTML = '<div class="empty-log">等待调度操作…</div>';
    elements.eventCount.textContent = '0 条';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const event of events) {
    const row = document.createElement('div');
    row.className = `event-row ${event.type}`;
    const time = document.createElement('time');
    time.textContent = formatClock(event.at);
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = event.title;
    copy.append(title);
    row.append(time, copy);
    fragment.append(row);
  }
  elements.eventLog.replaceChildren(fragment);
  elements.eventCount.textContent = `${state.events.length} 条`;
}

function renderTimelineEvents(state) {
  const fragment = document.createDocumentFragment();
  for (const event of state.events) {
    if (event.type === 'warning' || event.type === 'stop') continue;
    const marker = document.createElement('span');
    marker.className = `timeline-event ${event.type}`;
    marker.style.left = `${(event.at / DURATION_MIN) * 100}%`;
    marker.title = `${formatClock(event.at)} ${event.title}`;
    fragment.append(marker);
  }
  elements.timelineEvents.replaceChildren(fragment);
}

function renderWarnings(state) {
  const warnings = getWarnings(state);
  const signature = warnings.map((warning) => `${warning.severity}:${warning.text}`).join('|');
  if (signature === lastWarningSignature) return;
  lastWarningSignature = signature;
  const fragment = document.createDocumentFragment();
  for (const warning of warnings.slice(0, 4)) {
    const item = document.createElement('div');
    item.className = `alarm ${warning.severity}`;
    item.innerHTML = `<i></i><span>${warning.text}</span>`;
    fragment.append(item);
  }
  elements.alarmStack.replaceChildren(fragment);
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateTransportButton() {
  const running = !paused && simulation.status === 'running';
  elements.transport.classList.toggle('playing', running);
  elements.transportLabel.textContent =
    simulation.status === 'won'
      ? '查看结果'
      : simulation.status === 'lost'
        ? '查看结果'
        : running
          ? '暂停'
          : hasStarted
            ? '继续调度'
            : '开始调度';
}

function toggleTransport() {
  if (simulation.status !== 'running') {
    openResult();
    return;
  }
  paused = !paused;
  if (!paused) hasStarted = true;
  accumulator = 0;
  lastFrame = performance.now();
  updateTransportButton();
  renderUI(true);
}

function singleStep() {
  if (simulation.status !== 'running') {
    openResult();
    return;
  }
  paused = true;
  hasStarted = true;
  stepSimulation(simulation, 1);
  accumulator = 0;
  updateTransportButton();
  renderUI(true);
  if (simulation.status !== 'running') queueResult();
}

function resetSimulation() {
  simulation = createSimulation();
  paused = true;
  hasStarted = false;
  speed = 1;
  accumulator = 0;
  lastFrame = performance.now();
  lastWarningSignature = '';
  lastEventCount = -1;
  resultShown = false;
  if (resultTimer) clearTimeout(resultTimer);
  resultTimer = null;
  elements.resultModal.hidden = true;
  elements.helpModal.hidden = true;
  for (const button of document.querySelectorAll('[data-speed]')) {
    button.classList.toggle('active', Number(button.dataset.speed) === 1);
  }
  for (const spec of PUMP_SPECS) {
    syncSpeedControl(spec.id, simulation.pumps[spec.id].speed);
  }
  elements.alarmStack.replaceChildren();
  elements.timelineEvents.replaceChildren();
  elements.eventLog.replaceChildren();
  updateTransportButton();
  renderUI(true);
  showToast('场景已重置，泵组处于待机状态', 'info');
}

function bindEvents() {
  elements.transport.addEventListener('click', toggleTransport);
  elements.step.addEventListener('click', singleStep);
  elements.reset.addEventListener('click', resetSimulation);
  for (const button of document.querySelectorAll('[data-speed]')) {
    button.addEventListener('click', () => {
      speed = Number(button.dataset.speed);
      for (const sibling of document.querySelectorAll('[data-speed]')) {
        sibling.classList.toggle('active', sibling === button);
      }
    });
  }
  elements.sourceSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-source]');
    if (!button) return;
    const result = setHospitalSource(simulation, button.dataset.source);
    showToast(result.message, result.ok ? 'info' : 'warning');
    renderUI(true);
  });
  elements.resetBus.addEventListener('click', () => {
    const result = resetBus(simulation);
    showToast(result.message, result.ok ? 'info' : 'warning');
    renderUI(true);
  });
  elements.audio.addEventListener('click', async () => {
    const enabled = await audio.toggle();
    elements.audio.setAttribute('aria-pressed', String(enabled));
    if (enabled) {
      audio.update(simulation);
      showToast('环境声已开启：雨强、电流与流量驱动音色', 'info');
    } else {
      showToast('环境声已关闭', 'info');
    }
  });
  elements.help.addEventListener('click', () => {
    elements.helpModal.hidden = false;
  });
  elements.helpClose.addEventListener('click', () => {
    elements.helpModal.hidden = true;
  });
  elements.helpStart.addEventListener('click', () => {
    elements.helpModal.hidden = true;
  });
  elements.resultRestart.addEventListener('click', resetSimulation);
  elements.resultClose.addEventListener('click', () => {
    elements.resultModal.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      toggleTransport();
    } else if (event.key.toLowerCase() === 's') {
      singleStep();
    } else if (event.key.toLowerCase() === 'r') {
      resetSimulation();
    } else if (event.key === 'Escape') {
      elements.helpModal.hidden = true;
      elements.resultModal.hidden = true;
    }
  });
}

function queueResult() {
  if (resultShown || resultTimer) return;
  resultTimer = setTimeout(() => {
    resultTimer = null;
    resultShown = true;
    openResult();
  }, 550);
}

function openResult() {
  if (simulation.status === 'running') return;
  paused = true;
  updateTransportButton();
  const won = simulation.status === 'won';
  elements.resultEmblem.textContent = won ? '✓' : '×';
  elements.resultEmblem.className = `result-emblem ${won ? '' : 'failure'}`;
  elements.resultEyebrow.textContent = won
    ? 'ALL OBJECTIVES SECURED'
    : 'MISSION FAILED';
  elements.resultTitle.textContent = won ? '六小时调度完成' : '重点区域失守';
  elements.resultDescription.textContent = won
    ? '三处片区保持安全，医院支线全程未失电。暴雨过程结束，联合调度任务通过。'
    : '调度目标已被突破。复盘泵速、启动浪涌和负荷切换，修正方案后重新开始。';

  elements.resultReasons.replaceChildren();
  for (const failure of simulation.failures) {
    const reason = document.createElement('div');
    reason.className = 'result-reason';
    reason.textContent = `${formatClock(failure.at)} · ${failure.title}`;
    elements.resultReasons.append(reason);
  }

  const stats = [
    ['医院供电', simulation.hospital.everLostPower ? '失电' : '正常'],
    ['峰值负荷', `${Math.round(simulation.metrics.maxPowerLoadPct)}%`],
    ['累计排量', `${(simulation.metrics.totalPumpedM3 / 10000).toFixed(1)} 万m³`],
    ['抢修次数', String(simulation.metrics.repairs)]
  ];
  elements.resultStats.replaceChildren();
  for (const [label, value] of stats) {
    const cell = document.createElement('div');
    cell.innerHTML = `<label>${label}</label><strong>${value}</strong>`;
    elements.resultStats.append(cell);
  }
  elements.resultModal.hidden = false;
}

function frame(now) {
  const elapsed = Math.min(250, now - lastFrame);
  lastFrame = now;
  if (!paused && simulation.status === 'running') {
    accumulator += elapsed * speed;
    while (accumulator >= 1000 && simulation.status === 'running') {
      stepSimulation(simulation, 1);
      accumulator -= 1000;
    }
    if (simulation.status !== 'running') {
      paused = true;
      accumulator = 0;
      updateTransportButton();
      renderUI(true);
      queueResult();
    }
  }

  renderer.draw(simulation, now);
  if (now - lastUiPaint > 90) {
    lastUiPaint = now;
    renderUI();
    audio.update(simulation);
  }
  requestAnimationFrame(frame);
}

createPumpCards();
buildRainProfile();
bindEvents();
for (const spec of PUMP_SPECS) {
  syncSpeedControl(spec.id, simulation.pumps[spec.id].speed);
}
updateTransportButton();
renderUI(true);
requestAnimationFrame(frame);
