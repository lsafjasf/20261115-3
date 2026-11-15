/* Node 无头验证:mock Web Audio,驱动引擎 30 秒,
 * 模拟"探索⇢战斗⇢警戒⇢探索"跳层,检查走带连续性与增益空洞。 */
"use strict";
const fs = require("fs");
const path = require("path");

class FakeParam {
  constructor(v = 0) { this.value = v; }
  cancelScheduledValues() {}
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
}
class FakeNode {
  constructor() {
    this.gain = new FakeParam(0);
    this.frequency = new FakeParam(0);
    this.detune = new FakeParam(0);
    this.Q = new FakeParam(0);
    this.type = "";
  }
  connect(x) { return x; }
  disconnect() {}
  start() {} stop() {}
  getByteTimeDomainData() {}
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = new FakeNode(); }
  resume() {} suspend() {}
  createGain() { const n = new FakeNode(); n.gain = new FakeParam(1); return n; }
  createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createAnalyser() { const n = new FakeNode(); n.fftSize = 1024; return n; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}

const src = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8") +
  "\n;module.exports = { MusicEngine, STEP_DUR, LOOP_STEPS, LAYERS, LAYER_NAMES };";
const m = { exports: {} };
new Function("module", "exports", "window", src)(m, m.exports, { AudioContext: FakeAudioContext });
const { MusicEngine, STEP_DUR, LOOP_STEPS } = m.exports;

const engine = new MusicEngine();
engine.start();
clearInterval(engine.timer); // 改为手动驱动,时间完全可控

const ctx = engine.ctx;
const jumps = [[5, 100], [10, 30], [15, 0]]; // 探索⇢战斗⇢警戒⇢探索
let ji = 0;
for (let t = 0; t < 30; t += 0.025) {
  ctx.currentTime = t;
  while (ji < jumps.length && t >= jumps[ji][0]) {
    engine.setDanger(jumps[ji][1]);
    ji++;
  }
  engine._scheduler();
}

let holes = 0, maxDev = 0;
for (let i = 1; i < engine.stepLog.length; i++) {
  const dSteps = engine.stepLog[i].total - engine.stepLog[i - 1].total;
  const dev = Math.abs(engine.stepLog[i].time - engine.stepLog[i - 1].time - STEP_DUR);
  if (dSteps !== 1) holes++;
  if (dev > maxDev) maxDev = dev;
  if (dev > 0.003) holes++;
}
let minSum = Infinity;
for (const g of engine.gainLog) {
  const s = g.w[0] + g.w[1] + g.w[2];
  if (s < minSum) minSum = s;
}
const phase = engine.totalSteps % LOOP_STEPS;
const okPhase = phase === engine.step;
console.log(`调度总步数: ${engine.totalSteps}`);
console.log(`步进间隔最大偏差: ${(maxDev * 1000).toFixed(3)} ms`);
console.log(`走带空洞/重置: ${holes}`);
console.log(`三层增益总和最小值: ${minSum.toFixed(3)}`);
console.log(`循环相位一致(totalSteps%${LOOP_STEPS}===step): ${okPhase}`);
const pass = holes === 0 && maxDev <= 0.003 && minSum > 0.5 && okPhase;
console.log(pass ? "PASS: 跳层无空洞,旋律连续未重启" : "FAIL");
process.exit(pass ? 0 : 1);
