// 用 DOM 桩冒烟测试 game.js:加载并驱动若干帧,确认渲染/循环不抛异常
const fs = require("fs");

function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === "canvas") return {};
      return t[k] !== undefined ? t[k] : noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    textContent: "", innerHTML: "", value: "50",
    _attrs: {},
    setAttribute(k, v) { el._attrs[k] = v; },
    getAttribute(k) { return el._attrs[k]; },
    addEventListener: (ev, fn) => {
      (el._h = el._h || {})[ev] = fn;
      (el._ha = el._ha || {})[ev] = (el._ha[ev] || []).concat(fn);
    },
    appendChild(c) { el.children.push(c); },
    querySelector(sel) { return makeEl("q"); },
    querySelectorAll() { return [makeEl("r1"), makeEl("r2"), makeEl("r3")]; },
    getContext: () => makeCtx(),
    width: 1000, height: 560,
  };
  return el;
}

const els = {};
global.document = {
  getElementById(id) { return (els[id] = els[id] || makeEl(id)); },
  createElement(tag) { return makeEl(tag); },
};
let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.window = global;
global.self = global;
global.setTimeout = (fn) => { try { fn(); } catch (_) {} return 0; };
// AudioContext 桩
function audioNode() {
  const n = { connect: (d) => d || n, start: () => {}, gain: { value: 0, setTargetAtTime: () => {} }, frequency: { value: 0, setTargetAtTime: () => {} } };
  return n;
}
global.AudioContext = function () {
  return {
    state: "running", currentTime: 0, destination: {}, resume: () => {},
    createGain: audioNode, createOscillator: audioNode,
  };
};

// 加载 sim.js(Node 下走 module.exports)与 game.js
global.GreenSim = require("./sim.js");
eval(fs.readFileSync("./game.js", "utf8"));

// 驱动 30 帧,并模拟点击开始
document.getElementById("btnStart")._h.click();
let t = 0;
for (let i = 0; i < 30; i++) {
  t += 100;
  const cb = rafCb;
  rafCb = null;
  cb(t);
  if (!rafCb) throw new Error("渲染循环未继续注册 rAF");
}
console.log("PASS  game.js 冒烟测试:30 帧渲染与主循环无异常");

// ---------- 键盘交互冒烟:仅用键盘完成一轮操作 ----------
const canvas = document.getElementById("cv");
if (!canvas._ha.keydown || !canvas._ha.focus || !canvas._ha.blur) {
  throw new Error("画布缺少键盘/焦点事件监听");
}
function press(key) {
  const ev = { key, preventDefault: () => { ev.defaultPrevented = true; } };
  canvas._ha.keydown.forEach((fn) => fn(ev));
  return ev;
}
// 聚焦画布
canvas._ha.focus.forEach((fn) => fn({}));
// 数字键选择 3 号棚
press("3");
// H 选中热量滑杆并右调两次(每次 5%)
press("h");
press("ArrowRight");
press("ArrowRight");
// Enter 切换补光灯
press("Enter");
// B / P 开关锅炉与水泵
press("b");
press("p");
// 空格开始模拟
const startEv = press(" ");
if (!startEv.defaultPrevented) throw new Error("空格键未被画布处理");
// R 重置不应抛异常
press("r");
console.log("PASS  键盘冒烟:聚焦、选棚、滑杆微调、补光、锅炉、水泵、开始、重置均无异常");
