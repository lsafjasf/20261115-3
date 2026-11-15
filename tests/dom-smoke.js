// 浏览器加载冒烟测试：用最小 DOM 桩运行 main.js 的初始化与若干帧
// node tests/dom-smoke.js
import { performance } from 'node:perf_hooks';

const elements = new Map();
function makeEl(id) {
  const listeners = {};
  return {
    id, value: '50', textContent: '', innerHTML: '', className: '', checked: false,
    dataset: {}, style: {},
    classList: {
      add() {}, remove() {}, toggle() {},
    },
    getContext: () => ({
      clearRect() {}, fillRect() {}, fillText() {}, strokeRect() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
      closePath() {}, arcTo() {}, setLineDash() {},
    }),
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    click() { (listeners.click || []).forEach(fn => fn({ target: this, preventDefault() {} })); },
  };
}
const ids = ['canvas','clock','phaseTag','banner','statWait','statQueue','statLive','statThru',
  'stateWait','stateQueue','stateConflict','thrWait','thrQueue','gMain','gSide','gPed',
  'busStopX','detourPct','riskPed','valGMain','valGSide','valGPed','valBus','valDetour',
  'verifyOut','btnPause','btnMute','btnRestart','btnSuggest','btnDefault','btnVerify','speedGroup'];
for (const id of ids) elements.set(id, makeEl(id));

globalThis.performance = performance;
globalThis.requestAnimationFrame = fn => { /* 只跑一次，避免无限循环 */ globalThis.__raf = fn; };
globalThis.document = {
  getElementById: id => elements.get(id),
  querySelector: sel => makeEl(sel),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.window = {};

await import('../js/main.js');

// 手动推进 200 个动画帧（每帧模拟若干步）
let now = 0;
for (let i = 0; i < 400; i++) {
  now += 33;
  globalThis.__raf(now);
}

const statWait = elements.get('statWait').textContent;
const statQueue = elements.get('statQueue').textContent;
const clock = elements.get('clock').textContent;
if (!statWait || Number(statWait) <= 0) throw new Error('平均等待统计未更新');
if (!statQueue || Number(statQueue) < 0) throw new Error('排队统计未更新');
if (!/^\d{2}:\d{2}$/.test(clock)) throw new Error('时钟格式错误: ' + clock);

// 触发 A/B 验证按钮，检查表格渲染
elements.get('btnVerify').click();
if (!elements.get('verifyOut').innerHTML.includes('站850m')) throw new Error('A/B 验证未渲染结果');

// 触发暂停/建议/重置
elements.get('btnPause').click();
elements.get('btnSuggest').click();
elements.get('btnRestart').click();

console.log('  ✓ DOM 冒烟通过：400 帧后时钟 %s，平均等待 %ss，最大排队 %s，A/B 表格已渲染',
  clock, statWait, statQueue);
