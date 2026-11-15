/* 无头冒烟：桩 DOM + Canvas，加载全部浏览器模块并完整跑一次 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const noop = () => {};
const chain = () => ({ connect: chain });
const ctx2d = () => new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    return typeof k === 'string' ? noop : undefined;
  },
  set() { return true; }
});

function makeEl(id) {
  return {
    id, value: '0', textContent: '', innerHTML: '', disabled: false,
    children: [], classList: { add: noop, remove: noop },
    getContext: () => ctx2d(),
    getBoundingClientRect: () => ({ width: 900, height: 400 }),
    addEventListener: noop, click: noop,
    closest() { return { getAttribute: () => '0' }; },
    setAttribute: noop
  };
}

const ids = ['scene', 'chart', 'clock', 'metrics', 'eventList', 'pitch', 'pitchVal',
  'battMw', 'battMwVal', 'battMode', 'speedSeg', 'shedSeg', 'shedOrder',
  'startBtn', 'pauseBtn', 'resetBtn', 'audioBtn', 'jsonBtn', 'csvBtn',
  'modal', 'modalTitle', 'modalBody', 'modalJson', 'modalCsv', 'modalClose'];
const elements = Object.fromEntries(ids.map(id => [id, makeEl(id)]));

const sandbox = {
  console,
  window: {},
  document: {
    getElementById: id => elements[id] || makeEl(id),
    createElement: () => ({ click: noop, set href(v) {}, set download(v) {} })
  },
  performance: { now: () => Date.now() },
  requestAnimationFrame: noop,
  setTimeout, clearTimeout,
  Blob: class { constructor(parts) { this.parts = parts; } },
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: noop },
  AudioContext: function () {
    const node = () => ({ connect: chain, start: noop, stop: noop,
      type: '', frequency: { value: 0, setTargetAtTime: noop },
      gain: { value: 0, setValueAtTime: noop, setTargetAtTime: noop, exponentialRampToValueAtTime: noop } });
    return {
      state: 'running', currentTime: 0, sampleRate: 8000, destination: {},
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: node,
      createBiquadFilter: node,
      createGain: node,
      createOscillator: node,
      resume: noop
    };
  },
  Date
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['js/sim.js', 'js/renderer.js', 'js/audio.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
}

const { MicrogridSim, C } = sandbox.MicrogridSim;
const renderer = new sandbox.MicrogridRenderer(elements.scene, elements.chart);
const audio = new sandbox.WindAudio();
audio.init();

const sim = new MicrogridSim();
sim.controls.pitch = 0;
let frameCount = 0;
while (sim.status === 'ready' || sim.status === 'running') {
  const v = sim.windSpeed();
  sim.controls.pitch = v >= C.CUT_OUT - 1.5 ? C.FEATHER_PITCH + 5 : 0;
  sim.controls.batteryMode = 'auto';
  sim.controls.batteryMw = C.BATT_MAX_MW;
  sim.controls.shedOrder = [2, 1, 0];
  sim.controls.shedCount = v < 7 || sim.soc < 0.2 ? 2 : v < 9 ? 1 : 0;
  const snap = sim.step();
  renderer.drawScene(snap, sim.controls);
  renderer.drawChart(sim.history);
  audio.update(snap);
  frameCount++;
}

const summary = sim.summary();
assert.strictEqual(frameCount, 720);
assert.strictEqual(summary.blackoutMinutes, 0);
assert.ok(summary.maxTempC <= C.T_CRIT);
assert.strictEqual(summary.success, true);
assert.strictEqual(sim.toCsv().trim().split('\n').length, 721);
assert.ok(JSON.stringify(summary).length > 200);
audio.fanfare(true);
console.log('无头冒烟通过：720 帧场景+曲线+音频调用无异常，summary.success =', summary.success);
console.log(JSON.stringify({
  blackoutMinutes: summary.blackoutMinutes,
  maxTempC: summary.maxTempC,
  finalSoc: summary.finalSoc,
  windMWh: summary.windMWh,
  curtailedMWh: summary.curtailedMWh,
  wearPct: summary.wearPct
}, null, 2));
