import { test } from "node:test";
import assert from "node:assert/strict";

import { LoopPath } from "../js/path.js";
import { PlaybackEngine } from "../js/engine.js";
import { defaultConfig } from "../js/scene.js";

// Control points are the sharpest corners of the user-drawn loop. This test
// walks dense samples across every corner and asserts that pan and intensity
// for all five sources remain continuous through each turn.
test("no channel jump or intensity step at any corner (control point)", () => {
  const cfg = defaultConfig();
  const path = new LoopPath(cfg.controlPoints);
  const engine = new PlaybackEngine(path, cfg.sources, cfg.segments, {
    speed: cfg.speed,
    radius: cfg.radius,
  });
  const n = cfg.controlPoints.length;
  const cornerPanDeltas = [];
  const cornerGainDeltas = [];
  const headingDeltas = [];

  for (let corner = 0; corner < n; corner++) {
    const uCorner = corner / n;
    // Fresh engine per corner so azimuth state starts clean.
    const local = new PlaybackEngine(path, cfg.sources, cfg.segments, {
      speed: cfg.speed,
      radius: cfg.radius,
    });
    local.seek(uCorner - 0.01);
    local.play();
    let prev = local.frame();
    // Drive the real clock (with heading smoothing) at 240 Hz.
    const dt = 0.0005 / local.speed;
    const samples = Math.ceil(0.02 / (local.speed * dt));
    for (let k = 0; k <= samples; k++) {
      local.update(dt);
      const next = local.frame();
      next.sources.forEach((s, idx) => {
        cornerPanDeltas.push(Math.abs(s.pan - prev.sources[idx].pan));
        cornerGainDeltas.push(Math.abs(s.gain - prev.sources[idx].gain));
      });
      headingDeltas.push(
        Math.hypot(
          next.heading.x - prev.heading.x,
          next.heading.y - prev.heading.y
        )
      );
      prev = next;
    }
  }

  assert.ok(Math.max(...cornerPanDeltas) < 0.05,
    `corner pan delta ${Math.max(...cornerPanDeltas)}`);
  assert.ok(Math.max(...cornerGainDeltas) < 0.05,
    `corner gain delta ${Math.max(...cornerGainDeltas)}`);
  assert.ok(Math.max(...headingDeltas) < 0.05,
    `corner heading delta ${Math.max(...headingDeltas)}`);
});

test("left/right sign matches the geometric side of each source", () => {
  const cfg = defaultConfig();
  const path = new LoopPath(cfg.controlPoints);
  const engine = new PlaybackEngine(path, cfg.sources, cfg.segments, {
    speed: cfg.speed,
    radius: cfg.radius,
  });
  // Spot-check several listener positions around the loop.
  for (const u of [0.05, 0.25, 0.45, 0.65, 0.85]) {
    engine.u = u;
    engine.heading = engine.path.headingAt(u);
    const frame = engine.frame();
    const listener = frame.listener;
    frame.sources.forEach((state, idx) => {
      const source = cfg.sources[idx];
      const vx = source.x - listener.x;
      const vy = source.y - listener.y;
      const cross = frame.heading.x * vy - frame.heading.y * vx;
      // cross > 0 means geometrically left -> wrapped azimuth must be positive.
      if (Math.abs(cross) > 30) {
        assert.equal(Math.sign(state.wrappedAngle), Math.sign(cross),
          `source ${source.id} wrong side at u=${u}`);
      }
    });
  }
});
