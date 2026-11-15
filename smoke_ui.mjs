// Minimal DOM stub to smoke-test src/ui.js logic in Node:
// simulates a full game -> end -> replay -> tamper -> validate.
const handlers = {};
function makeEl(id) {
  return {
    id, children: [], className: '', textContent: '', disabled: false,
    innerHTML: '', title: '', onclick: null,
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); },
  };
}
const els = new Map();
const ctx2d = new Proxy({}, { get: () => () => {}, set: () => true });
globalThis.document = {
  getElementById(id) {
    if (id === 'view') {
      return { getContext: () => ctx2d, width: 280, height: 560 };
    }
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  },
  createElement: () => makeEl('cell'),
  addEventListener: (ev, fn) => { handlers[ev] = fn; },
};
const fns = [];
globalThis.setInterval = (fn) => { fns.push(fn); return fns.length; };
globalThis.clearInterval = () => {};

await import('./src/ui.js');

// drive the live loop until the game ends or cap reached
let guard = 0;
const key = (k) => handlers.keydown({ key: k, preventDefault() {} });
while (guard++ < 5000) {
  key(guard % 3 === 0 ? 'ArrowLeft' : 'ArrowRight');
  fns[0](); // main loop tick
  const status = els.get('status').textContent;
  if (status.includes('对局结束')) break;
}
if (guard >= 5000) { els.get('btnFinish').onclick(); }
console.log('[ui] live run ended:', els.get('status').textContent.split('\n')[0]);

// full validate via UI
els.get('btnValidate').onclick();
const clean = els.get('status').textContent;
console.log('[ui] validate:', clean.split('\n')[0]);
if (!clean.includes('校验通过')) { console.error('FAIL: clean UI validate'); process.exit(1); }

// tamper via UI, then validate again
els.get('btnTamper').onclick();
console.log('[ui]', els.get('status').textContent.split('\n')[0]);
els.get('btnValidate').onclick();
const bad = els.get('status').textContent;
console.log('[ui] validate after tamper:', bad.split('\n')[0]);
if (!bad.includes('校验失败') || !bad.includes('首次分叉')) {
  console.error('FAIL: tamper not located'); process.exit(1);
}

// step the replayer one tick via UI
els.get('btnNew').onclick();
els.get('btnFinish').onclick();
els.get('btnRpStep').onclick();
console.log('[ui] replay step ok, cursor advanced');
console.log('UI SMOKE PASS');
