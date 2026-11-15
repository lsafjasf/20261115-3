/* Minimal DOM stub smoke test for app.js (no browser required). */
'use strict';
var assert = require('assert');
global.window = global;

var elements = {};
function makeEl(id) {
  return {
    id: id, style: {}, textContent: '', innerHTML: '', className: '',
    listeners: {},
    addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
    click: function () { this.listeners.click(); },
    getContext: function () {
      return new Proxy({}, { get: function () { return function () {}; } });
    }
  };
}
['mine', 'clock', 'progressBar', 'progressText', 'faceGas', 'faceDust',
 'faceFlow', 'intakeFlow', 'mainState', 'localState', 'gasState',
 'dustState', 'shortState', 'banner', 'log', 'sensors',
 'D1', 'D2', 'D3', 'D4', 'mainOff', 'mainOn', 'reverseBtn',
 'local_off', 'local_force', 'local_exhaust', 'pauseBtn', 'speedBtn',
 'muteBtn', 'resetBtn', 'demoRecovery', 'demoShort'].forEach(function (id) {
  elements[id] = makeEl(id);
});
global.document = {
  getElementById: function (id) { return elements[id]; },
  addEventListener: function (ev, fn) { if (ev === 'DOMContentLoaded') fn(); }
};
global.setInterval = function () { return 1; };
global.AudioContext = function () {
  var chainable = function () {
    return { connect: function () { return chainable(); } };
  };
  return {
    state: 'running',
    sampleRate: 8000,
    currentTime: 0,
    destination: {},
    createBuffer: function (ch, len) { return { getChannelData: function () { return new Array(len).fill(0); } }; },
    createBufferSource: function () { var n = chainable(); n.start = function () {}; n.buffer = null; n.loop = false; return n; },
    createBiquadFilter: function () { var f = chainable(); f.type = ''; f.frequency = { value: 0, setValueAtTime: function () {}, setTargetAtTime: function () {} }; f.Q = { value: 0 }; return f; },
    createGain: function () { var g = chainable(); g.gain = { value: 0, setValueAtTime: function () {}, setTargetAtTime: function () {}, exponentialRampToValueAtTime: function () {} }; return g; },
    createOscillator: function () { var o = chainable(); o.start = function () {}; o.stop = function () {}; o.type = ''; o.frequency = { value: 0 }; return o; },
    resume: function () {}
  };
};

global.MineSim = require('../js/sim.js');
require('../js/render.js');
require('../js/audio.js');
require('../js/app.js');

assert.ok(elements.banner.textContent.length > 0, 'banner 应被渲染');
assert.ok(elements.sensors.innerHTML.includes('FACE'), '传感器表应包含 FACE');
elements.local_force.click();
elements.D2.click();
console.log('shortState=['+elements.shortState.textContent+'] banner=['+elements.banner.textContent+']');
assert.ok(elements.shortState.textContent.includes('短路')||elements.banner.textContent.includes('短路'), 'D2 打开后应显示短路报警');
elements.resetBtn.click();
assert.strictEqual(elements.shortState.textContent, '正常');
console.log('PASS  DOM 桩集成冒烟（控件绑定 / 报警 / 重置）');
