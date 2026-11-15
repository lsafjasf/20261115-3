import test from "node:test";
import assert from "node:assert/strict";
import {
  BAR_COUNT,
  BEATS_PER_BAR,
  createSong,
  flattenSyllables,
  midiToNoteName,
  noteNameToMidi,
  songDuration,
} from "../src/model.js";

test("八小节、每小节四拍、每拍一个唱词", () => {
  const song = createSong(100);
  assert.equal(song.bars.length, BAR_COUNT);
  assert.ok(song.bars.every((bar) => bar.syllables.length === BEATS_PER_BAR));
  assert.equal(flattenSyllables(song).length, BAR_COUNT * BEATS_PER_BAR);
  assert.equal(song.bars[0].syllables[0].text, "晨");
});

test("100 BPM 时总时长为 19.2 秒且时间戳单调", () => {
  const song = createSong(100);
  assert.equal(songDuration(song), 19.2);
  const syllables = flattenSyllables(song);
  for (let i = 1; i < syllables.length; i += 1) {
    assert.ok(syllables[i].start > syllables[i - 1].start);
    assert.ok(Math.abs(syllables[i].start - syllables[i - 1].start - 0.6) < 1e-12);
  }
});

test("MIDI 音高与音名互转", () => {
  assert.equal(midiToNoteName(60), "C4");
  assert.equal(midiToNoteName(69), "A4");
  assert.equal(noteNameToMidi("C4"), 60);
  assert.equal(noteNameToMidi("g#3"), 56);
  assert.equal(noteNameToMidi("bad"), null);
});
