import { test } from "node:test";
import assert from "node:assert/strict";

import { LoopPath } from "../js/path.js";
import { PlaybackEngine } from "../js/engine.js";
import { defaultConfig } from "../js/scene.js";

function buildEngine() {
  const cfg = defaultConfig();
  const path = new LoopPath(cfg.controlPoints);
  return new PlaybackEngine(path, cfg.sources, cfg.segments, {
    speed: cfg.speed,
    radius: cfg.radius,
  });
}

test("closed loop position and heading are continuous at the u=0/1 seam", () => {
  const path = new LoopPath(defaultConfig().controlPoints);
  const eps = 1e-6;
  const near = path.pointAt(eps);
  const wrap = path.pointAt(1 - eps);
  const start = path.pointAt(0);
  // Probe a slightly larger but still tiny fraction of the loop.
  const probe = 1e-4;
  const tolerance = path.length * probe * 3;
  assert.ok(
    Math.hypot(path.pointAt(probe).x - start.x, path.pointAt(probe).y - start.y) <
      tolerance
  );
  assert.ok(
    Math.hypot(
      path.pointAt(1 - probe).x - start.x,
      path.pointAt(1 - probe).y - start.y
    ) < tolerance
  );
  const h1 = path.headingAt(eps);
  const h2 = path.headingAt(1 - eps);
  assert.ok(Math.abs(h1.x - h2.x) < 1e-3 && Math.abs(h1.y - h2.y) < 1e-3);
});

test("arc-length parameterization moves at constant spatial speed", () => {
  const path = new LoopPath(defaultConfig().controlPoints);
  const step = 0.002;
  const distances = [];
  for (let u = 0; u < 1 - step; u += step) {
    const a = path.pointAt(u);
    const b = path.pointAt(u + step);
    distances.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const avg = distances.reduce((s, d) => s + d, 0) / distances.length;
  const maxDev = Math.max(...distances.map((d) => Math.abs(d - avg) / avg));
  assert.ok(maxDev < 0.03, `speed deviation ${maxDev}`);
});

test("pan never jumps sides while walking a full loop, including corners", () => {
  const engine = buildEngine();
  engine.play();
  const perSourceWrapped = engine.sources.map(() => []);
  const dt = 1 / 120;
  const steps = Math.ceil(1 / (engine.speed * dt));
  let prev = engine.frame().sources;
  for (let i = 0; i < steps; i++) {
    const frame = engine.update(dt);
    frame.sources.forEach((s, idx) => {
      const before = prev[idx];
      // Pan delta must stay small frame-to-frame; the sign can only flip
      // while the source is essentially in front/behind (near pan 0),
      // which is a smooth crossfade rather than a hard channel jump.
      assert.ok(Math.abs(s.pan - before.pan) < 0.08,
        `source ${s.id} pan jump ${before.pan} -> ${s.pan} at u=${frame.u}`);
      if (Math.sign(s.pan) !== Math.sign(before.pan) && before.pan !== 0) {
        assert.ok(Math.abs(before.pan) < 0.25 && Math.abs(s.pan) < 0.25,
          `source ${s.id} hard side switch at u=${frame.u}`);
      }
      perSourceWrapped[idx].push(s.wrappedAngle);
    });
    prev = frame.sources;
  }
  // A full walk must place every source on both ears at some point.
  perSourceWrapped.forEach((angles, idx) => {
    assert.ok(Math.min(...angles) < -0.2, `source ${idx} never on the right`);
    assert.ok(Math.max(...angles) > 0.2, `source ${idx} never on the left`);
  });
});

test("intensity changes smoothly and follows distance attenuation", () => {
  const engine = buildEngine();
  engine.play();
  const dt = 1 / 120;
  let prev = engine.frame().sources;
  for (let i = 0; i < 1200; i++) {
    const frame = engine.update(dt);
    frame.sources.forEach((s, idx) => {
      assert.ok(s.gain >= 0 && s.gain <= 1);
      assert.ok(Math.abs(s.gain - prev[idx].gain) < 0.1,
        `source ${s.id} gain jump at u=${frame.u}`);
    });
    prev = frame.sources;
  }
  // Direct attenuation check: zero at/beyond reach, one at distance zero.
  assert.equal(PlaybackEngine.attenuationGain(9999, 320, 0.5), 0);
  assert.equal(PlaybackEngine.attenuationGain(0, 320, 0.5), 1);
});

test("segment parameters crossfade instead of snapping at boundaries", () => {
  const engine = buildEngine();
  const n = engine.segments.length;
  const boundary = 1 / n;
  const onBoundary = engine.segmentAt(boundary);
  // Exactly on a boundary the two neighbors contribute equally.
  assert.ok(Math.abs(onBoundary.ambientGain - 0.5) < 1e-6);
  const probe = (u) => engine.segmentAt(u).reverb;
  const before = probe(boundary - 0.0004);
  const after = probe(boundary + 0.0004);
  // Symmetric around the boundary -> no step when the active index flips.
  assert.ok(Math.abs(before - after) < 1e-3);
  // Boundary value is the 0.5/0.5 mix of the two neighbors.
  const expected =
    (engine.segments[0].reverb + engine.segments[1].reverb) / 2;
  assert.ok(Math.abs(before - expected) < 1e-3);
  const mid = probe(boundary + 0.45); // clear of the fade zone -> pure segment
  assert.ok(Math.abs(mid - engine.segments[engine.segmentAt(boundary + 0.45).index].reverb) < 1e-6);
  assert.ok(onBoundary.reverb >= 0 && onBoundary.reverb <= 1);
});

test("pause freezes position, pan and intensity; resume continues from there", () => {
  const engine = buildEngine();
  engine.play();
  engine.update(2);
  const frozen = engine.frame();
  engine.pause();
  for (let i = 0; i < 10; i++) engine.update(1 / 60);
  const paused = engine.frame();
  assert.equal(paused.playing, false);
  assert.equal(paused.u, frozen.u);
  assert.deepEqual(paused.heading, frozen.heading);
  paused.sources.forEach((s, idx) => {
    assert.equal(s.pan, frozen.sources[idx].pan);
    assert.equal(s.gain, frozen.sources[idx].gain);
  });
  engine.play();
  engine.update(1 / 60);
  const resumed = engine.frame();
  assert.notEqual(resumed.u, frozen.u);
});

test("equal-power pan keeps total energy roughly constant", () => {
  for (const pan of [-1, -0.5, 0, 0.5, 1]) {
    const { left, right } = PlaybackEngine.equalPower(pan);
    const energy = left * left + right * right;
    assert.ok(Math.abs(energy - 1) < 1e-9);
  }
});
