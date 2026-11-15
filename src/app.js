import {
  GRID,
  auditFlow,
  channelMetrics,
  createSimulation,
  editTerrain,
  generateTerrain,
  hydrologySignature,
  setSimulationParams,
  stepSimulation,
} from './engine.js';
import {
  comparisonCsv,
  runRainfallComparison,
} from './scenarios.js';
import {
  createElevationExport,
  mapCellFromEvent,
  mapElevationExtents,
  renderMap,
  renderProfile,
} from './render.js';

const $ = (id) => document.getElementById(id);
const ui = {
  rainfall: $('rainfall'),
  rainfallValue: $('rainfallValue'),
  hardness: $('hardness'),
  hardnessValue: $('hardnessValue'),
  timeStep: $('timeStep'),
  timeStepValue: $('timeStepValue'),
  brushSize: $('brushSize'),
  brushSizeValue: $('brushSizeValue'),
  seedInput: $('seedInput'),
  terrainCanvas: $('terrainCanvas'),
  profileCanvas: $('profileCanvas'),
  mapLoading: $('mapLoading'),
};

const state = {
  seed: 467,
  params: { rainfall: 100, hardness: 1.1, dt: 1 },
  running: true,
  tool: 'raise',
  brushSize: 5,
  profileRow: 36,
  hover: null,
  dragging: false,
  lastBrushCell: null,
  lastBrushAt: 0,
  edited: false,
  impact: null,
  comparison: null,
  comparisonPending: false,
  compareDirty: false,
  compareRequest: 0,
};

const view = {
  showRivers: true,
  showDeposits: true,
};

let simulation = createSimulation(generateTerrain(state.seed), state.params);
let renderFrame = 0;
let simulationTimer = null;
let comparisonTimer = null;
let toastTimer = null;

function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompact(value, digits = 1) {
  if (Math.abs(value) >= 10000) return (value / 1000).toFixed(digits);
  return formatNumber(value, digits);
}

function setRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
}

function setText(id, text) {
  const element = $(id);
  if (element) element.textContent = text;
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 2600);
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderMap(ui.terrainCanvas, simulation, {
      ...view,
      profileRow: state.profileRow,
      hover: state.hover,
    });
    renderProfile(ui.profileCanvas, simulation, state.profileRow);
    setText('profileLocation', `A—A′ · ROW ${state.profileRow}`);
  });
}

function updateRunState() {
  const runState = $('runState');
  runState.classList.toggle('paused', !state.running);
  setText('runStateText', state.running ? '运行中' : '已暂停');
  setText('playIcon', state.running ? 'Ⅱ' : '▶');
  setText('playText', state.running ? '暂停' : '继续');
  $('playBtn').setAttribute('aria-label', state.running ? '暂停模拟' : '继续模拟');
}

function updateImpactPanel() {
  const impact = state.impact;
  if (!impact) return;
  const total = simulation.terrain.width * simulation.terrain.height;
  const percent = Math.min(100, (impact.affectedCount / total) * 100);
  $('impactRing').style.setProperty('--pct', percent.toFixed(1));
  setText('impactPercent', percent < 10 ? percent.toFixed(1) : Math.round(percent));
  setText('impactCount', `重算 ${formatNumber(impact.affectedCount, 0)} 个单元`);
  setText('impactDetail', `上游流域 ${impact.oldAffected} → ${impact.newAffected} · 汇流路径同步更新`);
  const badge = $('impactBadge');
  badge.textContent = '已重算';
  badge.classList.remove('muted');
}

function updateInterface() {
  const audit = auditFlow(simulation);
  const channels = channelMetrics(simulation);
  const extents = mapElevationExtents(simulation);
  const signature = hydrologySignature(simulation);
  const cellArea = GRID.cellSize * GRID.cellSize;
  setText('topTime', `${simulation.simTime.toFixed(1)} a`);
  setText('topSeed', state.seed);
  setText('topStep', String(simulation.stepCount).padStart(3, '0'));
  setText('outletFlow', formatNumber(simulation.hydrology.outletFlow, 3));
  setText('inputFlow', formatNumber(simulation.hydrology.totalInput, 3));
  setText('conservationError', audit.conservationResidual.toExponential(2));
  const relativeLog = Math.log10(Math.max(1e-18, audit.relativeError));
  const errorWidth = Math.min(100, Math.max(2, (relativeLog + 18) * 5.4));
  $('errorFill').style.width = `${errorWidth}%`;
  setText('channelLength', formatNumber(channels.lengthKm, 2));
  setText('channelCells', channels.cells.toLocaleString('en-US'));
  setText('erodedVolume', formatCompact(simulation.totals.eroded * cellArea / 1000, 1));
  setText('depositedVolume', formatCompact(simulation.totals.deposited * cellArea / 1000, 1));
  setText('discontinuity', audit.discontinuity);
  setText('cycles', audit.cycles);
  setText('outletLabel', `(${simulation.terrain.outletX}, ${simulation.terrain.outletY})`);
  setText('elevRange', `${Math.round(extents.min)}—${Math.round(extents.max)} m`);
  setText('footerHash', `HASH ${signature}`);
  const auditState = $('auditState');
  const valid = audit.discontinuity === 0 && audit.cycles === 0;
  auditState.textContent = valid ? '✓ 审计通过' : '⚠ 路径异常';
  auditState.classList.toggle('audit-ok', valid);
  setText('continuityText', valid
    ? '全网格 D8 路径闭合至出口'
    : `检测到 ${audit.discontinuity + audit.cycles} 处路径异常`);
  updateImpactPanel();
  scheduleRender();
}

function syncControlLabels() {
  ui.rainfallValue.innerHTML = `${state.params.rainfall} <small>mm/h</small>`;
  ui.hardnessValue.innerHTML = `${state.params.hardness.toFixed(2)} <small>×</small>`;
  ui.timeStepValue.innerHTML = `${state.params.dt.toFixed(state.params.dt === 1 ? 1 : 2)} <small>a/步</small>`;
  ui.brushSizeValue.innerHTML = `${state.brushSize} <small>cells</small>`;
  for (const input of [ui.rainfall, ui.hardness, ui.timeStep, ui.brushSize]) setRangeFill(input);
}

function resetSimulation({ keepImpact = false } = {}) {
  simulation = createSimulation(generateTerrain(state.seed), state.params);
  state.impact = null;
  state.edited = false;
  if (!keepImpact) {
    $('impactRing').style.setProperty('--pct', 0);
    setText('impactPercent', 0);
    setText('impactCount', '尚未修改');
    setText('impactDetail', '编辑地形后展示上下游影响范围。');
    $('impactBadge').textContent = '待编辑';
    $('impactBadge').classList.add('muted');
  }
  updateInterface();
}

function startClock() {
  clearInterval(simulationTimer);
  simulationTimer = setInterval(() => {
    if (!state.running) return;
    stepSimulation(simulation);
    updateInterface();
  }, 360);
}

function setRunning(running) {
  state.running = running;
  updateRunState();
  if (running) startClock();
  else clearInterval(simulationTimer);
}

function applyBrush(cell) {
  if (!cell) return;
  setRunning(false);
  const amount = state.tool === 'raise' ? 18 : -18;
  state.impact = editTerrain(
    simulation,
    cell.x,
    cell.y,
    state.brushSize,
    amount,
  );
  state.edited = true;
  state.profileRow = cell.y;
  updateInterface();
}

function commitBrushStroke(cell) {
  applyBrush(cell);
}

function setComparisonStatus(kind, text) {
  const status = $('reproStatus');
  status.classList.remove('success', 'error');
  if (kind) status.classList.add(kind);
  status.innerHTML = `<span class="spinner"></span>${text}`;
}

function renderComparison() {
  const grid = $('comparisonGrid');
  if (!state.comparison) {
    grid.innerHTML = '<div class="compare-placeholder">等待水文场景计算…</div>';
    return;
  }
  grid.innerHTML = state.comparison.results.map((result) => `
    <article class="compare-card ${result.id}" data-rainfall="${result.rainfall}" title="点击载入该雨强">
      <div class="compare-top">
        <div>
          <div class="compare-label">${result.label}</div>
          <div class="compare-rain">${result.rainfall}<small>mm/h</small></div>
        </div>
        <span class="compare-badge">${result.reproducible ? '✓ REPLAY' : 'FAIL'}</span>
      </div>
      <div class="compare-body">
        <div class="compare-stat"><span>出口流量</span><b>${formatNumber(result.outletFlow, 2)} m³/s</b></div>
        <div class="compare-stat"><span>侵蚀量</span><b>${formatCompact(result.erodedVolume / 1000, 1)} ×10³ m³</b></div>
        <div class="compare-stat"><span>沉积量</span><b>${formatCompact(result.depositedVolume / 1000, 1)} ×10³ m³</b></div>
        <div class="compare-stat"><span>河道</span><b>${formatNumber(result.channelLengthKm, 2)} km</b></div>
      </div>
      <div class="compare-bars">
        <i class="erosion-bar" style="--erosion:${result.erosionIndex}"></i>
        <i class="deposition-bar" style="--deposition:${result.depositionIndex}"></i>
      </div>
      <div class="compare-signature">${result.signature}</div>
    </article>
  `).join('');
  for (const card of grid.querySelectorAll('.compare-card')) {
    card.addEventListener('click', () => {
      const rainfall = Number(card.dataset.rainfall);
      state.params.rainfall = rainfall;
      ui.rainfall.value = rainfall;
      setSimulationParams(simulation, { rainfall });
      syncControlLabels();
      updateInterface();
      toast(`已载入 ${rainfall} mm/h 降雨对比`);
    });
  }
}

async function refreshComparison() {
  if (state.comparisonPending) {
    state.compareDirty = true;
    return;
  }
  state.comparisonPending = true;
  state.compareDirty = false;
  const request = ++state.compareRequest;
  setComparisonStatus('', '正在验证复现…');
  renderComparison();
  try {
    const comparison = await runRainfallComparison({
      seed: state.seed,
      hardness: state.params.hardness,
      dt: state.params.dt,
    });
    if (request !== state.compareRequest) return;
    state.comparison = comparison;
    const count = comparison.results.filter((result) => result.reproducible).length;
    setComparisonStatus(
      comparison.allReproducible ? 'success' : 'error',
      comparison.allReproducible
        ? `✓ 复现一致 · ${count}/${comparison.results.length} · 双跑哈希校验`
        : `⚠ 复现失败 · ${count}/${comparison.results.length}`,
    );
    renderComparison();
  } catch (error) {
    setComparisonStatus('error', '对比计算失败');
    console.error(error);
  } finally {
    state.comparisonPending = false;
    if (state.compareDirty) {
      state.compareDirty = false;
      clearTimeout(comparisonTimer);
      comparisonTimer = setTimeout(refreshComparison, 120);
    }
  }
}

function scheduleComparisonRefresh(delay = 650) {
  clearTimeout(comparisonTimer);
  if (state.comparison) setComparisonStatus('', '参数已变更 · 等待重算');
  comparisonTimer = setTimeout(refreshComparison, delay);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename);
}

function hydrologyCsv() {
  const { terrain, routing, hydrology } = simulation;
  const header = [
    'x', 'y', 'elevation_m', 'routed_surface_m', 'receiver_x', 'receiver_y',
    'upstream_cells', 'flow_m3_s', 'cumulative_erosion_m', 'cumulative_deposition_m',
  ];
  const rows = [header.join(',')];
  for (let cell = 0; cell < terrain.elevation.length; cell += 1) {
    const x = cell % terrain.width;
    const y = Math.floor(cell / terrain.width);
    const next = routing.receiver[cell];
    rows.push([
      x,
      y,
      terrain.elevation[cell].toFixed(4),
      routing.filled[cell].toFixed(4),
      next >= 0 ? next % terrain.width : '',
      next >= 0 ? Math.floor(next / terrain.width) : '',
      hydrology.upstream[cell],
      hydrology.flow[cell].toFixed(8),
      simulation.cumulativeErosion[cell].toFixed(6),
      simulation.cumulativeDeposition[cell].toFixed(6),
    ].join(','));
  }
  return rows.join('\n');
}

function saveSeedRecipe() {
  const payload = {
    application: 'TerraFlow River Lab',
    algorithm: 'terraflow-d8-v1',
    seed: state.seed,
    rainfall_mm_h: state.params.rainfall,
    rock_hardness_multiplier: state.params.hardness,
    timestep_years: state.params.dt,
    step_count: simulation.stepCount,
    sim_time_years: simulation.simTime,
    terrain_hash: hydrologySignature(simulation).split('-')[0],
    hydrology_hash: hydrologySignature(simulation).split('-').slice(1).join('-'),
    saved_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem('terraflow-seed', JSON.stringify(payload));
  } catch {
  }
  downloadText(JSON.stringify(payload, null, 2), `terraflow-seed-${state.seed}.json`, 'application/json');
  toast(`Seed ${state.seed} 配方已保存`);
}

async function exportElevationPng() {
  const audit = auditFlow(simulation);
  const channels = channelMetrics(simulation);
  const extents = mapElevationExtents(simulation);
  $('mapLoading').classList.add('visible');
  $('mapLoading').lastChild.textContent = '生成高程图…';
  try {
    await document.fonts.ready;
    const canvas = createElevationExport(simulation, {
      seed: state.seed,
      profileRow: state.profileRow,
      min: extents.min,
      max: extents.max,
      conservationError: audit.conservationResidual.toExponential(2),
      channelLength: channels.lengthKm.toFixed(2),
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    downloadBlob(blob, `terraflow-elevation-seed-${state.seed}.png`);
    toast('高程图 PNG 已导出');
  } finally {
    $('mapLoading').classList.remove('visible');
    $('mapLoading').lastChild.textContent = '构建流域…';
  }
}

function exportHydrologyCsv() {
  downloadText(hydrologyCsv(), `terraflow-hydrology-seed-${state.seed}-step-${simulation.stepCount}.csv`, 'text/csv;charset=utf-8');
  toast('水文网格 CSV 已导出');
}

function exportComparison() {
  if (!state.comparison) {
    toast('对比结果仍在计算');
    return;
  }
  downloadText(
    comparisonCsv(state.comparison),
    `terraflow-rainfall-comparison-seed-${state.seed}.csv`,
    'text/csv;charset=utf-8',
  );
  toast('三组降雨对比 CSV 已导出');
}

function applySeed() {
  const parsed = Number.parseInt(ui.seedInput.value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    toast('请输入有效的非负整数 seed');
    return;
  }
  state.seed = parsed >>> 0;
  ui.seedInput.value = String(state.seed);
  resetSimulation();
  setRunning(true);
  scheduleComparisonRefresh(100);
  toast(`已生成 seed ${state.seed} 的确定性流域`);
}

function bindEvents() {
  $('playBtn').addEventListener('click', () => setRunning(!state.running));
  $('stepBtn').addEventListener('click', () => {
    setRunning(false);
    stepSimulation(simulation);
    updateInterface();
  });
  $('resetBtn').addEventListener('click', () => {
    resetSimulation();
    setRunning(true);
    toast(`已重置到 seed ${state.seed} 初始地形`);
  });

  ui.rainfall.addEventListener('input', () => {
    state.params.rainfall = Number(ui.rainfall.value);
    setSimulationParams(simulation, { rainfall: state.params.rainfall });
    syncControlLabels();
    updateInterface();
  });

  ui.hardness.addEventListener('input', () => {
    state.params.hardness = Number(ui.hardness.value);
    setSimulationParams(simulation, { hardness: state.params.hardness });
    syncControlLabels();
    scheduleComparisonRefresh();
  });

  ui.timeStep.addEventListener('input', () => {
    state.params.dt = Number(ui.timeStep.value);
    setSimulationParams(simulation, { dt: state.params.dt });
    syncControlLabels();
    scheduleComparisonRefresh();
  });

  ui.brushSize.addEventListener('input', () => {
    state.brushSize = Number(ui.brushSize.value);
    syncControlLabels();
    scheduleRender();
  });

  for (const button of document.querySelectorAll('.tool-btn')) {
    button.addEventListener('click', () => {
      state.tool = button.dataset.tool;
      for (const candidate of document.querySelectorAll('.tool-btn')) {
        candidate.classList.toggle('active', candidate === button);
      }
      if (state.hover) state.hover.tool = state.tool;
      scheduleRender();
    });
  }

  $('riverLayer').addEventListener('change', (event) => {
    view.showRivers = event.target.checked;
    scheduleRender();
  });
  $('depositLayer').addEventListener('change', (event) => {
    view.showDeposits = event.target.checked;
    scheduleRender();
  });

  const canvas = ui.terrainCanvas;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const cell = mapCellFromEvent(canvas, simulation, event);
    if (!cell) return;
    state.dragging = true;
    state.lastBrushCell = cell;
    state.lastBrushAt = performance.now();
    state.profileRow = cell.y;
    state.hover = { ...cell, radius: state.brushSize, tool: state.tool };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(event.pointerId);
    commitBrushStroke(cell);
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    const cell = mapCellFromEvent(canvas, simulation, event);
    if (cell) {
      state.hover = { ...cell, radius: state.brushSize, tool: state.tool };
      setText('coordinates', `X ${cell.x} · Y ${cell.y}`);
    } else {
      state.hover = null;
    }
    if (state.dragging && cell) {
      const now = performance.now();
      if (now - state.lastBrushAt > 130
        && (!state.lastBrushCell || state.lastBrushCell.x !== cell.x || state.lastBrushCell.y !== cell.y)) {
        state.lastBrushAt = now;
        state.lastBrushCell = cell;
        commitBrushStroke(cell);
      }
    }
    scheduleRender();
  });

  const endStroke = (event) => {
    if (!state.dragging) return;
    state.dragging = false;
    state.lastBrushCell = null;
    canvas.classList.remove('dragging');
    if (event.pointerId != null && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    toast(`受影响流域已重算 · ${state.impact?.affectedCount ?? 0} cells`);
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => {
    if (!state.dragging) {
      state.hover = null;
      scheduleRender();
    }
  });

  $('applySeedBtn').addEventListener('click', applySeed);
  ui.seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applySeed();
  });
  $('saveSeedBtn').addEventListener('click', saveSeedRecipe);
  $('exportPngBtn').addEventListener('click', () => {
    exportElevationPng().catch((error) => {
      console.error(error);
      toast('高程图导出失败');
    });
  });
  $('exportCsvBtn').addEventListener('click', exportHydrologyCsv);
  $('rerunCompareBtn').addEventListener('click', refreshComparison);
  $('exportCompareBtn').addEventListener('click', exportComparison);

  window.addEventListener('resize', scheduleRender);
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      setRunning(!state.running);
    } else if (event.key.toLowerCase() === 's') {
      setRunning(false);
      stepSimulation(simulation);
      updateInterface();
    }
  });
}

function initialize() {
  bindEvents();
  syncControlLabels();
  updateRunState();
  updateInterface();
  startClock();
  setTimeout(refreshComparison, 220);
}

initialize();
