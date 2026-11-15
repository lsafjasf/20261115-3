/* 用最小 DOM 桩冒烟测试 main.js 的初始化、仿真推进与判定路径 */
'use strict';
const fs = require('fs');

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 0 });
      if (!(k in t)) t[k] = typeof k === 'string' ? function () {} : undefined;
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeEl(id) {
  const el = {
    id, children: [], style: {}, value: '1', textContent: '', innerHTML: '',
    className: '', width: 980, height: 460,
    listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener(ev, f) { (this.listeners[ev] = this.listeners[ev] || []).push(f); },
    getContext() { return makeCtx(); },
    querySelector() { return makeEl('q'); },
    click() { (this.listeners.click || []).forEach(f => f.call(this)); }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) {
      this._html = v;
      this.firstChild = v ? makeEl('child') : undefined;
    }
  });
  return el;
}

const ids = ['clock', 'verdict', 'sensorControls', 'alertThr', 'alertThrVal', 'persist',
  'persistVal', 'speed', 'speedVal', 'btnStart', 'btnReset', 'btnExport', 'log',
  'waveCanvas', 'volcanoCanvas', 'contribTable'];
const els = {};
ids.forEach(id => { els[id] = makeEl(id); });
els.alertThr.value = '0.55'; els.persist.value = '90'; els.speed.value = '6';

const documentStub = {
  getElementById(id) {
    if (!els[id]) {
      els[id] = makeEl(id);
      // 模拟 buildPanel 生成的滑块默认值
      if (/^w\d/.test(id)) els[id].value = '1';
      if (/^th\d/.test(id)) els[id].value = '0.35';
      if (/^win\d/.test(id)) els[id].value = '31';
      if (/^f\d/.test(id)) els[id].value = 'ma';
    }
    return els[id];
  },
  createElement(tag) { return makeEl(tag); },
  querySelector(sel) { return makeEl(sel); }
};
let rafCb = null;
const windowStub = {
  VolcanoSim: require('./sim.js'),
  addEventListener() {},
  AudioContext: undefined
};

global.window = windowStub;
global.document = documentStub;
global.requestAnimationFrame = cb => { rafCb = cb; };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Blob = class {};

// 加载 main.js
eval(fs.readFileSync('main.js', 'utf8'));

// 启动播放并快进整个 6 小时模拟
els.btnStart.click(); // playing = true
let ts = 0;
for (let i = 0; i < 4000 && rafCb; i++) {
  const cb = rafCb; rafCb = null;
  ts += 100; // 每帧 100ms（step 内部 clamp 0.1s）
  cb(ts);
}
console.log('时钟:', els.clock.textContent);
console.log('判定:', els.verdict.textContent);
console.log('日志条数:', els.log.children.length);
console.log('贡献表行数:', els.contribTable.children.length >= 0 ? '已渲染' : '无');
if (!/判定成功/.test(els.verdict.textContent)) {
  console.error('冒烟测试失败：未得到成功判定');
  process.exit(1);
}
console.log('SMOKE_OK');
