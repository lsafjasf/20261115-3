// 无浏览器环境下的 DOM/Canvas/Web Audio 桩，冒烟验证 main.js 的真实加载与交互

const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = () =>
  new Proxy(
    {
      createLinearGradient: () => gradient,
      measureText: () => ({ width: 10 }),
      getContextAttributes: () => ({}),
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return typeof prop === 'string' ? noop : undefined;
      },
    },
  );

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.className = '';
    this._textContent = '';
    this._innerHTML = '';
    this.value = tag === 'select' ? '250' : '';
    this.width = 880;
    this.height = 560;
    this.disabled = false;
  }
  get textContent() {
    return this._textContent || this.children.map((child) => child.textContent).join(' ');
  }
  set textContent(value) {
    this._textContent = String(value);
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(value) {
    this._innerHTML = value;
    this._textContent = String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  getContext() {
    return context2d();
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 880, height: 560 };
  }
  click() {
    this.listeners.click?.({ clientX: 0, clientY: 0 });
  }
  scrollTo() {}
}

const elements = new Map();
const ids = [
  'canvas', 'victim-canvas', 'seed', 'clock', 'delivered', 'dispatchable', 'medics',
  'play', 'speed', 'mute', 'restart', 'medic-count', 'btn-dispatch', 'btn-reroute',
  'btn-refuel', 'vehicle-list', 'log', 'banner',
];
for (const id of ids) elements.set(id, new FakeElement(id));

globalThis.document = {
  getElementById: (id) => elements.get(id),
  createElement: (tag) => new FakeElement(tag),
};

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {}
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: noop, linearRampToValueAtTime: noop },
      connect: () => ({ connect: noop }),
      start: noop,
      stop: noop,
    };
  }
  createGain() {
    return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: () => ({ connect: noop }) };
  }
}
globalThis.window = globalThis;
globalThis.AudioContext = FakeAudioContext;

const intervals = [];
let intervalId = 0;
globalThis.setInterval = (fn) => {
  intervals.push({ id: (intervalId += 1), fn });
  return intervalId;
};
globalThis.clearInterval = noop;

await import(new URL('../src/main.js', import.meta.url).href);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(Number(elements.get('seed').textContent) === 20261115, 'seed 未渲染');
assert(elements.get('vehicle-list').children.length === 5, '应渲染 5 张车辆卡片');

for (let i = 0; i < 20; i += 1) {
  for (const item of intervals) item.fn();
}
assert(/20\s*\/\s*60/.test(elements.get('clock').textContent), '模拟时钟未推进');
// 模拟玩家点选 T2 消防车与 B1 火灾点，再点击派车
const t2Card = elements.get('vehicle-list').children.find(
  (card) => card.textContent.includes('T2'),
);
t2Card.click();
elements.get('medic-count').value = '1';
const canvasEl = elements.get('canvas');
// B1 节点坐标 (780,120)，点击命中检测半径 16
canvasEl.listeners.click({ clientX: 780, clientY: 120 });
assert(elements.get('btn-dispatch').disabled === false, '选中站内车辆与节点后应可派车');
elements.get('btn-dispatch').listeners.click();
for (let i = 0; i < 6; i += 1) {
  for (const item of intervals) item.fn();
}
assert(elements.get('log').children.length > 0, '事件日志为空');
assert(elements.get('log').children.some((line) => line.textContent.includes('控场')), '缺少控场事件');

console.log('浏览器入口冒烟通过：', {
  clock: elements.get('clock').textContent,
  delivered: elements.get('delivered').textContent,
  logLines: elements.get('log').children.length,
});
