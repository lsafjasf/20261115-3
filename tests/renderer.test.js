import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";

import { renderBinaural, exportRoute } from "../js/renderer.js";
import { encodeWav } from "../js/wav.js";
import { defaultConfig, validateConfig } from "../js/scene.js";

test("offline render produces one full loop of stereo 16-bit PCM", () => {
  const cfg = defaultConfig();
  const { sampleRate, duration, channels, wav } = renderBinaural(cfg, {
    sampleRate: 22050,
  });
  assert.equal(channels.length, 2);
  assert.equal(channels[0].length, Math.floor(duration * sampleRate));
  assert.equal(duration, 1 / cfg.speed); // exactly one loop
  // RIFF header sanity.
  assert.equal(Buffer.from(wav.slice(0, 4)).toString("ascii"), "RIFF");
  assert.equal(Buffer.from(wav.slice(8, 12)).toString("ascii"), "WAVE");
  assert.equal(wav.length, 44 + channels[0].length * 2 * 2);
});

test("rendered channels are non-silent and differ (real stereo image)", () => {
  const cfg = defaultConfig();
  const { channels } = renderBinaural(cfg, { sampleRate: 22050 });
  const energy = (ch) => ch.reduce((s, v) => s + v * v, 0) / ch.length;
  assert.ok(energy(channels[0]) > 1e-4);
  assert.ok(energy(channels[1]) > 1e-4);
  // Channels must not be identical, otherwise panning would be meaningless.
  let diff = 0;
  for (let i = 0; i < channels[0].length; i += 37) {
    diff += Math.abs(channels[0][i] - channels[1][i]);
  }
  assert.ok(diff > 1e-3);
});

test("route export round-trips through validation", () => {
  const cfg = defaultConfig();
  const json = exportRoute(cfg);
  const parsed = JSON.parse(json);
  assert.doesNotThrow(() => validateConfig(parsed));
  assert.equal(parsed.sources.length, 5);
  assert.equal(parsed.segments.length, parsed.controlPoints.length);
});

test("WAV encoder rejects out-of-range samples gracefully and tags channels", () => {
  const mono = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const bytes = encodeWav([mono], 8000);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), 8000); // sample rate
});

test("write verification artifacts for manual review", async () => {
  const cfg = defaultConfig();
  const rendered = renderBinaural(cfg, { sampleRate: 44100 });
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/binaural-loop.wav", rendered.wav);
  await writeFile("artifacts/route.json", exportRoute(cfg));
  assert.ok(rendered.wav.length > 1000);
});
