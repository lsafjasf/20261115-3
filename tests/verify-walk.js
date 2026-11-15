// End-to-end "walk one full loop" verification.
// Runs the clock at 120 Hz until the listener returns to the start, then
// asserts that position, pan and intensity stay synchronized and that no
// source hard-jumps between the left and right channels at any corner.

import { writeFile } from "node:fs/promises";

import { LoopPath } from "../js/path.js";
import { PlaybackEngine } from "../js/engine.js";
import { renderBinaural } from "../js/renderer.js";
import { defaultConfig } from "../js/scene.js";

const config = defaultConfig();
const path = new LoopPath(config.controlPoints);
const engine = new PlaybackEngine(path, config.sources, config.segments, {
  speed: config.speed,
  radius: config.radius,
});

const frameHz = 120;
const dt = 1 / frameHz;
const totalSteps = Math.ceil(1 / (engine.speed * dt));
engine.play();

const trace = [];
const maxPanDelta = config.sources.map(() => 0);
const maxGainDelta = config.sources.map(() => 0);
const hardSwitches = [];
let prev = engine.frame();

for (let step = 0; step <= totalSteps; step++) {
  const frame = engine.update(dt);
  frame.sources.forEach((s, idx) => {
    const before = prev.sources[idx];
    maxPanDelta[idx] = Math.max(maxPanDelta[idx], Math.abs(s.pan - before.pan));
    maxGainDelta[idx] = Math.max(maxGainDelta[idx], Math.abs(s.gain - before.gain));
    // A genuine "jump to the opposite ear" means the *rendered* pan changes
    // sign while staying well away from the center. A wrapped-angle sign
    // flip near +/-pi (source directly behind) is handled by the unwrapped
    // azimuth and produces a smooth pan, so it is not a hard switch.
    if (
      Math.sign(s.pan) !== Math.sign(before.pan) &&
      Math.abs(before.pan) > 0.35 &&
      Math.abs(s.pan) > 0.35
    ) {
      hardSwitches.push({
        source: s.id,
        u: frame.u,
        fromPan: before.pan,
        toPan: s.pan,
      });
    }
  });
  trace.push({
    u: frame.u,
    x: frame.listener.x,
    y: frame.listener.y,
    headingX: frame.heading.x,
    headingY: frame.heading.y,
    segment: frame.segment.index,
    reverb: frame.segment.reverb,
    sources: frame.sources.map((s) => ({
      id: s.id,
      pan: Number(s.pan.toFixed(4)),
      gain: Number(s.gain.toFixed(4)),
      azimuth: Number(s.wrappedAngle.toFixed(4)),
    })),
  });
  prev = frame;
}

// Pause freeze check.
engine.pause();
const frozen = engine.frame();
for (let i = 0; i < 30; i++) engine.update(dt);
const afterPause = engine.frame();
const pauseFrozen =
  afterPause.u === frozen.u &&
  afterPause.sources.every(
    (s, idx) =>
      s.pan === frozen.sources[idx].pan && s.gain === frozen.sources[idx].gain
  );

// Render the same loop to a binaural WAV so the audio itself can be inspected.
const rendered = renderBinaural(config, { sampleRate: 44100 });

const report = {
  loop: {
    frames: trace.length,
    durationSeconds: Number((trace.length * dt).toFixed(2)),
    start: trace[0],
    end: trace[trace.length - 1],
    startEndDistance: Math.hypot(
      trace[trace.length - 1].x - trace[0].x,
      trace[trace.length - 1].y - trace[0].y
    ),
  },
  perSource: config.sources.map((source, idx) => ({
    id: source.id,
    maxFrameToFramePanDelta: Number(maxPanDelta[idx].toFixed(5)),
    maxFrameToFrameGainDelta: Number(maxGainDelta[idx].toFixed(5)),
    panRange: [
      Math.min(...trace.map((f) => f.sources[idx].pan)),
      Math.max(...trace.map((f) => f.sources[idx].pan)),
    ],
  })),
  hardChannelSwitches: hardSwitches,
  pauseFreezesPanAndIntensity: pauseFrozen,
  rendered: {
    sampleRate: rendered.sampleRate,
    durationSeconds: rendered.duration,
    wavBytes: rendered.wav.length,
  },
  pass:
    hardSwitches.length === 0 &&
    pauseFrozen &&
    maxPanDelta.every((d) => d < 0.05) &&
    maxGainDelta.every((d) => d < 0.06),
};

await writeFile("artifacts/walk-trace.json", JSON.stringify(trace, null, 0));
await writeFile("artifacts/verification-report.json", JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
