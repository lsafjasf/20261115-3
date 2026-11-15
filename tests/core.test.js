"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/core.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSource(delayForFrame) {
  return {
    request(frame, context) {
      const signal = context.signal;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ frame, time: S.frameToTime(frame) });
        }, delayForFrame(frame));
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(S.createAbortError());
          }, { once: true });
        }
      });
    }
  };
}

test("时间码按毫秒取整，不因浮点误差少 1ms", () => {
  assert.equal(S.formatTimecode(20.2), "00:20.200");
  assert.equal(S.formatTimecode(18.6), "00:18.600");
});

test("五次快速拖动落到最新帧并保持音频与字幕一致", async () => {
  const player = new S.VideoCore({
    frameSource: S.createSyntheticFrameSource({ latencyScale: 1 })
  });
  const report = await S.runFiveScrubCheck(player);

  assert.equal(report.passed, true);
  assert.equal(report.finalFrame, report.events.at(-1).targetFrame);
  assert.equal(report.finalFrame, 558);
  assert.equal(report.audioTime, S.frameToTime(558));
  assert.equal(report.subtitle.id, S.resolveCue(558).id);
  assert.ok(report.abortedRequests >= 4);
  assert.equal(report.finalTime >= report.subtitle.start, true);
  assert.equal(report.finalTime < report.subtitle.end, true);
});

test("即使旧响应晚于最新帧返回，也不得覆盖最终画面", async () => {
  const player = new S.VideoCore({
    frameSource: createSource((frame) => (frame === 12 ? 180 : 12))
  });
  player.seekFrame(12);
  await sleep(5);
  player.seekFrame(900);
  await player.waitForSettled();

  assert.equal(player.getState().renderedFrame, 900);
  await sleep(220);
  const state = player.getState();
  assert.equal(state.renderedFrame, 900);
  assert.equal(state.targetFrame, 900);
  assert.equal(state.cue.id, S.resolveCue(900).id);
  assert.ok(state.staleDrops >= 1);
});

test("拖动结束后在落点恢复音频，而不是停留在拖动前位置", async () => {
  const calls = [];
  const audio = {
    sync(seconds, options) {
      calls.push({ seconds, playing: options.playing, scrubbing: options.scrubbing });
    }
  };
  const player = new S.VideoCore({
    frameSource: S.createSyntheticFrameSource()
  });
  player.audio = audio;
  player.play();
  player.beginScrub();
  player.seekFrame(558);
  await player.waitForSettled();
  player.endScrub();

  const finalCall = calls.at(-1);
  assert.equal(finalCall.seconds, S.frameToTime(558));
  assert.equal(finalCall.playing, true);
  assert.equal(finalCall.scrubbing, false);
  assert.equal(player.getState().audioTime, S.frameToTime(558));
});

test("暂停后 tick 不会推进帧号、音频时间或字幕", async () => {
  const player = new S.VideoCore({
    frameSource: S.createSyntheticFrameSource()
  });
  player.seekFrame(400);
  await player.waitForSettled();
  player.play();
  assert.equal(player.tick(1000), true);
  player.pause();

  const before = player.getState();
  assert.equal(player.tick(5000), false);
  await sleep(160);
  const after = player.getState();
  assert.equal(after.renderedFrame, before.renderedFrame);
  assert.equal(after.targetFrame, before.targetFrame);
  assert.equal(after.audioTime, before.audioTime);
  assert.equal(after.cue.id, before.cue.id);
});

test("暂停会取消在途请求，即使数据源忽略 abort 也不提交", async () => {
  let resolvePending;
  const source = {
    request(frame) {
      if (frame === 0) return Promise.resolve({ frame, time: 0 });
      return new Promise((resolve) => { resolvePending = () => resolve({ frame, time: S.frameToTime(frame) }); });
    }
  };
  const player = new S.VideoCore({ frameSource: source });
  player.seekFrame(0);
  await player.waitForSettled();
  player.seekFrame(700);
  assert.equal(player.getState().pending, true);
  player.pause();
  resolvePending();
  await sleep(10);

  const state = player.getState();
  assert.equal(state.renderedFrame, 0);
  assert.equal(state.targetFrame, 0);
  assert.equal(state.audioTime, 0);
  assert.equal(state.pending, false);
  assert.ok(state.staleDrops >= 1);
});
