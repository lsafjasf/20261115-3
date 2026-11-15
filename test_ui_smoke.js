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
    tag, children: [], style: {}, dataset: {}, classList: { toggle: () => {}, add: () => {} },
    textContent: "", innerHTML: "", value: "50",
    addEventListener: (ev, fn) => { (el._h = el._h || {})[ev] = fn; },
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
