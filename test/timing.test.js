import test from "node:test";
import assert from "node:assert/strict";
import { createSong } from "../src/model.js";
import { Transport, getPlaybackState, beatPhase, formatClock } from "../src/timing.js";

class FakeClock {
  constructor() { this.nowMs = 0; }
  now() { return this.nowMs / 1000; }
  advance(ms) { this.nowMs += ms; }
}

test("播放状态在逐字边界精确切换且进度正确", () => {
  const song = createSong(100);
  const atStart = getPlaybackState(song, 0);
  assert.equal(atStart.activeIndex, 0);
  assert.equal(atStart.progress, 0);
  assert.equal(atStart.barIndex, 0);

  const halfway = getPlaybackState(song, 0.3);
  assert.equal(halfway.activeIndex, 0);
  assert.ok(Math.abs(halfway.progress - 0.5) < 1e-9);

  const nextWord = getPlaybackState(song, 0.6);
  assert.equal(nextWord.activeIndex, 1);
  assert.equal(nextWord.progress, 0);

  const secondBar = getPlaybackState(song, 2.45);
  assert.equal(secondBar.barIndex, 1);
  assert.equal(secondBar.activeIndex, 4);
});

test("节拍相位每拍从 0 重置，驱动节拍脉冲而非 CSS 计时", () => {
  const song = createSong(100);
  assert.equal(beatPhase(song, 0), 0);
  assert.ok(Math.abs(beatPhase(song, 0.3) - 0.5) < 1e-9);
  assert.equal(beatPhase(song, 0.6), 0);
});

test("暂停冻结位置，恢复后继续，不跳变", () => {
  const clock = new FakeClock();
  const transport = new Transport(clock);
  transport.play();
  clock.advance(1000);
  assert.ok(Math.abs(transport.position - 1) < 1e-9);
  transport.pause();
  clock.advance(5000);
  assert.ok(Math.abs(transport.position - 1) < 1e-9);
  transport.play();
  clock.advance(1000);
  assert.ok(Math.abs(transport.position - 2) < 1e-9);
});

test("跳转立即重锚，播放头与高亮同步移动", () => {
  const clock = new FakeClock();
  const transport = new Transport(clock);
  transport.play();
  clock.advance(500);
  transport.seek(10);
  assert.ok(Math.abs(transport.position - 10) < 1e-9);
  clock.advance(1000);
  assert.ok(Math.abs(transport.position - 11) < 1e-9);
  const state = getPlaybackState(createSong(100), transport.position);
  assert.equal(state.barIndex, 4);
});

test("变速后位置按新速率推进，文字动画不会错位", () => {
  const clock = new FakeClock();
  const transport = new Transport(clock);
  transport.play();
  clock.advance(1000);
  transport.setRate(2);
  clock.advance(1000);
  assert.ok(Math.abs(transport.position - 3) < 1e-9);
  transport.setRate(0.5);
  clock.advance(2000);
  assert.ok(Math.abs(transport.position - 4) < 1e-9);
});

test("格式化时钟", () => {
  assert.equal(formatClock(0), "00:00.0");
  assert.equal(formatClock(19.26), "00:19.2");
});
