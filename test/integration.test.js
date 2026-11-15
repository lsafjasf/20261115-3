import test from "node:test";
import assert from "node:assert/strict";
import { createSong, flattenSyllables, midiToNoteName } from "../src/model.js";
import { Transport, getPlaybackState } from "../src/timing.js";
import { describeHighlight } from "../src/highlight.js";
import { buildWebVtt } from "../src/vtt.js";
import { renderAccompaniment } from "../src/synth.js";
import { encodeWav } from "../src/wav.js";

class FakeClock {
  constructor() { this.ms = 0; }
  now() { return this.ms / 1000; }
  advance(ms) { this.ms += ms; }
}

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.max = "";
    this.listeners = new Map();
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  emit(event) { this.listeners.get(event.type)?.(event); }
  setProperty(name, value) { this.style[name] = value; }
  toggle(name, on) {
    const names = new Set(this.className.split(" ").filter(Boolean));
    if (on) names.add(name); else names.delete(name);
    this.className = [...names].join(" ");
  }
}

// 复刻 app.js 的帧循环：每帧只从 Transport 读数 -> 状态 -> 高亮 -> DOM
function createLoop(song, transport) {
  const syllableNodes = new Map();
  const lineNodes = new Map();
  song.bars.forEach((bar, barIndex) => {
    const line = new FakeElement("div");
    line.dataset.barIndex = String(barIndex);
    lineNodes.set(barIndex, line);
    for (const syllable of bar.syllables) {
      const span = new FakeElement("span");
      span.dataset.id = syllable.id;
      syllableNodes.set(syllable.id, span);
    }
  });

  const scrubber = new FakeElement("input");
  return {
    frame() {
      const state = getPlaybackState(song, transport.position);
      const { syllableStates, lineStates } = describeHighlight(song, state);
      for (const item of syllableStates) {
        const node = syllableNodes.get(item.id);
        node.className = `syllable ${item.status}`;
        node.style.background = item.status === "active"
          ? `linear-gradient(90deg, var(--accent) ${item.progress * 100}%, transparent ${item.progress * 100}%)`
          : "";
      }
      for (const line of lineStates) {
        const node = lineNodes.get(line.barIndex);
        node.toggle("active", line.active);
        node.style.transform = line.active ? `scale(${1 + line.pulse * 0.015})` : "";
      }
      scrubber.value = String(state.position);
      return { state, syllableNodes, lineNodes, scrubber };
    },
  };
}

test("完整流程：播放、暂停、跳转、变速下高亮与播放头始终一致", () => {
  const clock = new FakeClock();
  const song = createSong(100);
  const transport = new Transport(clock);
  const loop = createLoop(song, transport);

  transport.play();
  clock.advance(300);
  let frame = loop.frame();
  assert.ok(Math.abs(Number(frame.scrubber.value) - 0.3) < 1e-9);
  assert.equal(frame.syllableNodes.get("b1-1").className, "syllable active");

  // 暂停：位置冻结，连续多帧高亮不变（无独立 CSS 动画计时）
  transport.pause();
  const pausedFrames = [loop.frame(), loop.frame(), loop.frame()];
  assert.ok(pausedFrames.every((f) => f.scrubber.value === pausedFrames[0].scrubber.value));
  assert.ok(pausedFrames.every((f) => f.syllableNodes.get("b1-2").className === "syllable upcoming"));

  // 跳转：高亮立即重定位，旧 active 被清除
  transport.seek(12.3);
  frame = loop.frame();
  assert.equal(frame.state.barIndex, 5);
  assert.equal(frame.syllableNodes.get("b4-1").className, "syllable done");
  assert.equal(frame.syllableNodes.get("b6-1").className, "syllable active");

  // 变速 2x：墙钟走 1 秒，播放头走 2 秒，高亮跟随新位置
  transport.play();
  transport.setRate(2);
  clock.advance(1000);
  frame = loop.frame();
  assert.ok(Math.abs(Number(frame.scrubber.value) - 14.3) < 1e-9);
  assert.equal(frame.state.activeIndex, 23);

  // 节拍脉冲由位置直接计算，同位置两帧结果完全一致（不错位）
  transport.pause();
  const a = loop.frame();
  const b = loop.frame();
  assert.deepEqual(
    [...a.lineNodes.values()].map((n) => n.style.transform),
    [...b.lineNodes.values()].map((n) => n.style.transform),
  );
});

test("编辑逐字时间和音高后，高亮与两种导出同时反映修改", () => {
  const song = createSong(100);
  const target = flattenSyllables(song)[0];
  target.start = 0.1;
  target.duration = 0.8;
  target.midi = 72;
  target.text = "晓";

  const state = getPlaybackState(song, 0.5);
  assert.equal(describeHighlight(song, state).syllableStates[0].status, "active");
  assert.match(buildWebVtt(song), /<00:00:00\.100>晓/);
  assert.equal(midiToNoteName(target.midi), "C5");

  const pcm = renderAccompaniment(song);
  const wav = encodeWav(pcm);
  assert.equal(wav.byteLength, 44 + pcm.length * 2);
});
