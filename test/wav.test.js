import test from "node:test";
import assert from "node:assert/strict";
import { createSong } from "../src/model.js";
import { renderAccompaniment, SAMPLE_RATE } from "../src/synth.js";
import { encodeWav } from "../src/wav.js";

test("伴奏渲染长度覆盖八小节且无削波", () => {
  const song = createSong(100);
  const pcm = renderAccompaniment(song);
  assert.equal(pcm.length, Math.ceil(19.2 * SAMPLE_RATE));
  let peak = 0;
  for (const value of pcm) {
    peak = Math.max(peak, Math.abs(value));
    assert.ok(Math.abs(value) <= 0.95 + 1e-9);
  }
  assert.ok(peak > 0.1, "伴奏应有实际波形能量");
});

test("WAV 头正确：RIFF/WAVE、单声道、16bit、44.1kHz", () => {
  const pcm = new Float32Array([0, 0.25, -0.5, 1, -1]);
  const wav = encodeWav(pcm);
  const view = new DataView(wav);
  const head = (offset) => String.fromCharCode(...new Uint8Array(wav, offset, 4));
  assert.equal(head(0), "RIFF");
  assert.equal(head(8), "WAVE");
  assert.equal(head(12), "fmt ");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(wav.byteLength, 44 + 10);
  assert.equal(view.getInt16(44 + 2 * 3, true), 32767);
  assert.equal(view.getInt16(44 + 2 * 2, true), -16384);
  assert.equal(view.getInt16(44 + 2 * 4, true), -32768);
});

test("同一歌曲重复渲染确定且一致（导出与播放同源）", () => {
  const song = createSong(100);
  const first = renderAccompaniment(song);
  const second = renderAccompaniment(song);
  assert.equal(first.length, second.length);
  assert.deepEqual(Array.from(second), Array.from(first));
});
