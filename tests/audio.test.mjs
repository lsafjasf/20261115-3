import test from "node:test";
import assert from "node:assert/strict";
import { createDemoProject } from "../src/demo-project.js";
import { normalizeProject } from "../src/project.js";
import { renderProjectToStereo } from "../src/synth.js";
import { encodeWav } from "../src/wav.js";

test("project normalizes to eight tracks and sixteen steps", () => {
  const project = normalizeProject(createDemoProject());
  assert.equal(project.tracks.length, 8);
  assert.ok(project.tracks.every((track) => track.steps.length === 16));
  assert.ok(project.tracks.every((track) => track.steps.some((step) => step.on)));
});

test("demo render is finite, audible stereo audio", () => {
  const project = normalizeProject(createDemoProject());
  const result = renderProjectToStereo(project, {
    sampleRate: 22050,
    cycles: 1,
  });
  assert.equal(result.left.length, result.frameCount);
  assert.equal(result.right.length, result.frameCount);
  assert.ok(result.duration > 2.7 && result.duration < 3.1);
  let peak = 0;
  let energy = 0;
  for (let index = 0; index < result.frameCount; index += 1) {
    assert.ok(Number.isFinite(result.left[index]));
    assert.ok(Number.isFinite(result.right[index]));
    peak = Math.max(peak, Math.abs(result.left[index]), Math.abs(result.right[index]));
    energy += result.left[index] ** 2 + result.right[index] ** 2;
  }
  assert.ok(peak > 0.1, `peak was ${peak}`);
  assert.ok(peak <= 0.94);
  assert.ok(energy > 1);
});

test("WAV encoder writes a valid 16-bit stereo RIFF header", () => {
  const project = normalizeProject(createDemoProject());
  const result = renderProjectToStereo(project, {
    sampleRate: 8000,
    cycles: 1,
  });
  const wav = encodeWav(result.left, result.right, 8000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const text = (offset, length) =>
    String.fromCharCode(...wav.slice(offset, offset + length));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(12, 4), "fmt ");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint32(40, true), result.frameCount * 4);
  assert.equal(wav.length, 44 + result.frameCount * 4);
});
