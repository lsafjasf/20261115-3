const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* Minimal DOM stub: just enough surface for js/app.js initialization. */
function createElementStub(tag) {
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    dataset: {},
    style: {},
    children: [],
    listeners: {},
    appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    click() {
      for (const fn of this.listeners.click || []) fn({});
    },
    getContext() {
      return {
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
        lineTo() {}, stroke() {}, fillText() {}
      };
    }
  };
  el.classList = {
    add(c) {
      const parts = el.className.split(/\s+/).filter(Boolean);
      if (!parts.includes(c)) parts.push(c);
      el.className = parts.join(' ');
    },
    remove(c) {
      el.className = el.className.split(/\s+/).filter((x) => x !== c).join(' ');
    },
    toggle(c, force) {
      const has = el.className.split(/\s+/).includes(c);
      if (force === true || (force === undefined && !has)) this.add(c);
      else this.remove(c);
    },
    contains(c) { return el.className.split(/\s+/).includes(c); }
  };
  return el;
}

const elements = {};
globalThis.window = {
  addEventListener(type, fn) {
    if (type === 'DOMContentLoaded') global.__onReady = fn;
  }
};
globalThis.document = {
  getElementById(id) {
    return elements[id] ||
      (elements[id] = createElementStub(id === 'spectrum' ? 'canvas' : 'div'));
  },
  querySelector(sel) {
    const key = sel.match(/data-key="(\w+)"/)[1];
    return elements.bypassBar.children.find((b) => b.dataset.key === key);
  },
  createElement: createElementStub,
  body: Object.assign(createElementStub('body'), {
    removeChild() {}
  })
};
globalThis.Blob = class {
  constructor(parts) { this.parts = parts; }
};
globalThis.URL = {
  createObjectURL() { return 'blob:stub'; },
  revokeObjectURL() {}
};

globalThis.window.AudioRepair = require('../js/dsp.js');
globalThis.window.AudioWav = require('../js/wav.js');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
new Function(appSource)();

test('UI: init builds four bypass buttons and populates meters', () => {
  global.__onReady();
  const bar = elements.bypassBar;
  assert.equal(bar.children.length, 4);
  assert.match(elements.origPeak.textContent, /^\d\.\d{4}$/);
  assert.match(elements.procPeak.textContent, /^\d\.\d{4}$/);
  assert.match(elements.origDur.textContent, /10\.00 s/);
  assert.match(elements.procDur.textContent, /10\.00 s/);
  assert.equal(elements.procClips.textContent, '0');
});

test('UI: bypass click takes effect immediately and restores on re-enable', () => {
  const softBtn = elements.bypassBar.children.find(
    (b) => b.dataset.key === 'softclip');
  const peakWithSoft = Number(elements.procPeak.textContent);

  softBtn.click();
  assert.equal(softBtn.textContent, '软削波：旁路');
  const peakBypassed = Number(elements.procPeak.textContent);
  assert.notEqual(peakBypassed, peakWithSoft);

  softBtn.click();
  assert.equal(softBtn.textContent, '软削波：启用');
  assert.equal(Number(elements.procPeak.textContent), peakWithSoft);
});

test('UI: repair-all re-enables every node and export triggers a WAV download', () => {
  const buttons = elements.bypassBar.children;
  buttons.forEach((b) => b.click());
  assert.ok(buttons.every((b) => b.className.includes('bypassed')));

  elements.repairAll.click();
  assert.ok(buttons.every((b) => b.className.includes(' on')));

  let downloaded = null;
  const origCreate = document.createElement;
  document.createElement = function (tag) {
    const el = origCreate(tag);
    if (tag === 'a') {
      el.click = function () { downloaded = el; };
    }
    return el;
  };
  elements.exportWav.listeners.click[0]();
  document.createElement = origCreate;
  assert.ok(downloaded);
  assert.equal(downloaded.download, 'repaired-10s.wav');
  assert.match(downloaded.href, /^blob:/);
});
