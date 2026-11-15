import test from "node:test";
import assert from "node:assert/strict";
import { createSong } from "../src/model.js";
import { buildWebVtt, vttTimestamp } from "../src/vtt.js";

test("时间戳格式符合 WebVTT 规范", () => {
  assert.equal(vttTimestamp(0), "00:00:00.000");
  assert.equal(vttTimestamp(19.2), "00:00:19.200");
  assert.equal(vttTimestamp(3661.5), "01:01:01.500");
});

test("导出每小节一个 cue 且包含逐字时间戳标记", () => {
  const song = createSong(100);
  const vtt = buildWebVtt(song);
  assert.ok(vtt.startsWith("WEBVTT\n"));
  const cues = vtt.split("\n\n").slice(1);
  assert.equal(cues.length, 8);
  assert.match(cues[0], /^00:00:00\.000 --> 00:00:02\.400\n/);
  assert.match(cues[0], /<00:00:00\.000>晨<00:00:00\.600>风<00:00:01\.200>吹<00:00:01\.800>过/);
  assert.match(cues[7], /--> 00:00:19\.200/);
});

test("编辑逐字时间后 VTT 同步更新", () => {
  const song = createSong(100);
  song.bars[0].syllables[0].start = 0.25;
  const vtt = buildWebVtt(song);
  assert.match(vtt, /<00:00:00\.250>晨/);
});
