import test from "node:test";
import assert from "node:assert/strict";
import { createSong } from "../src/model.js";
import { getPlaybackState } from "../src/timing.js";
import { describeHighlight } from "../src/highlight.js";

test("高亮状态分为 done/active/upcoming 且逐字进度连续", () => {
  const song = createSong(100);
  const state = getPlaybackState(song, 0.3);
  const { syllableStates, lineStates } = describeHighlight(song, state);
  assert.equal(syllableStates[0].status, "active");
  assert.ok(syllableStates[0].progress > 0 && syllableStates[0].progress < 1);
  assert.equal(syllableStates[1].status, "upcoming");
  assert.equal(lineStates[0].active, true);
  assert.ok(lineStates[0].pulse >= 0 && lineStates[0].pulse <= 1);
  assert.equal(lineStates[1].active, false);
});

test("跳转后高亮立即跟随新位置，无残留动画", () => {
  const song = createSong(100);
  const jumped = describeHighlight(song, getPlaybackState(song, 12.3));
  assert.equal(jumped.syllableStates.find((s) => s.status === "active").index, 20);
  assert.ok(jumped.syllableStates.slice(0, 20).every((s) => s.status === "done"));
  assert.ok(jumped.syllableStates.slice(21).every((s) => s.status === "upcoming"));
});
