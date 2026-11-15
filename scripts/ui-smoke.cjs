/*
 * Minimal DOM harness that loads app.js without a browser. It stubs only
 * the DOM/canvas/audio surface the UI touches and then drives the same
 * user flows the browser would (tab switch, edit, validate, export,
 * re-import), catching wiring regressions in the UI layer.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../src/core.js');
const vtt = require('../src/vtt.js');
const storage = require('../src/storage.js');

const failures = [];
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
  if (!ok) failures.push(name);
};

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.className = '';
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.checked = false;
    this.files = [];
    this._listeners = new Map();
    this.getBoundingClientRect = () => ({ left: 0, width: 600 });
    this.getContext = () => ({
      font: '',
      measureText: (char) => core.defaultMeasure(char),
    });
    this.classList = {
      add: (...names) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => current.add(name));
        this.className = [...current].join(' ');
      },
      toggle: (name, force) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        const on = force === undefined ? !current.has(name) : force;
        if (on) current.add(name);
        else current.delete(name);
        this.className = [...current].join(' ');
      },
    };
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(value) {
    this._html = value;
    this.children = [];
    const classMatches = value.matchAll(/class="([^"]+)"/g);
    for (const match of classMatches) {
      const child = new FakeElement('div');
      child.className = match[1];
      this.appendChild(child);
    }
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  querySelector(selector) {
    return this.children.find(
      (child) =>
        (selector === '.cue-zh' && child.className === 'cue-zh') ||
        (selector === '.cue-en' && child.className === 'cue-en')
    );
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatch(type, event) {
    (this._listeners.get(type) || []).forEach((fn) => fn(event || {}));
  }
  click() {
    this.dispatch('click');
  }
  setCustomValidity() {}
  reportValidity() {}
  showModal() {
    this.opened = true;
  }
}

const ids = {};
const getElement = (id) => {
  if (!ids[id]) ids[id] = new FakeElement(id);
  return ids[id];
};

const tabZh = new FakeElement('button');
tabZh.dataset.language = 'zh';
const tabEn = new FakeElement('button');
tabEn.dataset.language = 'en';

const sandbox = {
  console,
  window: {},
  document: {
    createElement: (tag) => new FakeElement(tag),
    getElementById: getElement,
    querySelectorAll: () => [tabZh, tabEn],
  },
  Blob: class {
    constructor(parts) {
      this.parts = parts;
    }
  },
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  FileReader: class {
    readAsText() {
      this.onload({ target: { result: sandbox.__nextFileContent } });
    }
  },
  setTimeout,
  clearTimeout,
  alert: (message) => sandbox.__alerts.push(message),
};
sandbox.window = sandbox;
sandbox.__alerts = [];
sandbox.self = sandbox;
vm.createContext(sandbox);

vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8'),
  sandbox
);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'vtt.js'), 'utf8'),
  sandbox
);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'storage.js'), 'utf8'),
  sandbox
);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'),
  sandbox
);

const app = sandbox.__subtitleApp;
check('UI boots with three cues', app.project.cues.length === 3);
check('cue list rendered with three items', ids['cue-list'].children.length === 3);

/* Switch to the English tab, edit English, Chinese must survive. */
tabEn.dispatch('click');
const textarea = ids['cue-text'];
check('textarea shows English after tab switch', /Welcome/.test(textarea.value));
textarea.value = textarea.value + ' [edited]';
textarea.dispatch('input');
tabZh.dispatch('click');
const firstCue = app.project.cues[0];
check(
  'Chinese untouched after English edit',
  firstCue.zh === '欢迎观看2026年度发布会，分辨率支持4K和1080P。'
);
check('English edit persisted', /\[edited\]$/.test(firstCue.en));

/* Width + layout settings flow into the model. */
ids['cue-width'].value = '180';
ids['cue-width'].dispatch('change');
check('max width update reaches model', firstCue.maxWidthPx === 180);
ids['cue-layout'].value = 'side-by-side';
ids['cue-layout'].dispatch('change');
check('layout update reaches model', firstCue.layout === 'side-by-side');
ids['cue-wrap'].checked = false;
ids['cue-wrap'].dispatch('change');
check('wrap toggle reaches model', firstCue.wrap === false);

/* Force an overlap and confirm export is blocked by the dialog. */
const overlapCue = app.project.cues[1];
overlapCue.startMs = 1000;
ids['export-vtt'].click();
check('export blocked when cues overlap', ids['blocked-dialog'].opened === true);
overlapCue.startMs = 4000;
firstCue.maxWidthPx = 240;
firstCue.layout = core.LAYOUTS.STACKED;
firstCue.wrap = true;
firstCue.en = 'Welcome to the 2026 keynote, streaming in 4K and 1080p.';

/* Out-of-bounds against timeline duration also blocks. */
app.project.durationMs = 12000;
app.project.cues[2].endMs = 13000;
ids['blocked-dialog'].opened = false;
ids['export-vtt'].click();
check('export blocked when cue exceeds duration', ids['blocked-dialog'].opened === true);
app.project.cues[2].endMs = 11500;

/* Clean project exports, then the file is re-imported through the UI. */
ids['blocked-dialog'].opened = false;
ids['export-vtt'].click();
check('clean project allows export', ids['blocked-dialog'].opened === false);
const exported = vtt.exportVTT(app.project.cues);
const reader = new sandbox.FileReader();
const before = app.project.cues.map((cue) => cue.zh + '|' + cue.en);
sandbox.__nextFileContent = exported;
ids['vtt-import'].dispatch('change', {
  target: { files: [{ name: 'subtitles.vtt' }], value: '' },
});
check('re-import keeps three cues', app.project.cues.length === 3);
check(
  're-imported content matches pre-export content',
  JSON.stringify(app.project.cues.map((cue) => cue.zh + '|' + cue.en)) ===
    JSON.stringify(before)
);

/* Timeline click seeks the shared clock. */
ids['timeline'].dispatch('click', { clientX: 300, stopPropagation() {} });
check('timeline click seeks clock to half duration', app.clock.timeMs === 6000);

console.log(
  `\n${failures.length === 0 ? 'ALL UI SMOKE CHECKS PASSED' : failures.length + ' FAILED'}`
);
process.exit(failures.length ? 1 : 0);
