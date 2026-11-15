import test from "node:test";
import assert from "node:assert/strict";
import { MusicClock } from "../src/clock.js";

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("120 BPM advances eight sixteenth steps per second", () => {
  const clock = new MusicClock({ bpm: 120, time: 10 });
  close(clock.rawAt(10), 0);
  close(clock.rawAt(11), 8);
  close(clock.rawAt(12), 16);
});

test("tempo changes preserve the musical position exactly", () => {
  const clock = new MusicClock({ bpm: 120, time: 0 });
  const changeTime = 1.37;
  const before = clock.rawAt(changeTime);
  clock.setTempo(90, changeTime);
  close(clock.rawAt(changeTime), before);
  close(clock.rawAt(changeTime + 1), before + 6);
});

test("repeated tempo changes do not accumulate drift", () => {
  const events = [
    [0, 112],
    [0.83, 146],
    [1.91, 74],
    [3.04, 180],
    [4.22, 101],
    [5.4, 128],
  ];
  const clock = new MusicClock({ bpm: events[0][1], time: events[0][0] });
  let expected = 0;
  for (let index = 1; index < events.length; index += 1) {
    const [time, bpm] = events[index];
    const previousTime = events[index - 1][0];
    const previousBpm = events[index - 1][1];
    expected += (time - previousTime) * (previousBpm / 60) * 4;
    close(clock.rawAt(time), expected, 1e-8);
    clock.setTempo(bpm, time);
  }
  const last = events.at(-1);
  expected += (6 - last[0]) * (last[1] / 60) * 4;
  close(clock.rawAt(6), expected, 1e-8);
});

test("loop phase wraps while raw position remains monotonic", () => {
  const clock = new MusicClock({ bpm: 120, time: 0, loop: true });
  close(clock.rawAt(4.25), 34);
  close(clock.phaseAt(4.25), 2);
  close(clock.phaseAt(2), 0);
});

test("timeAtRaw is the inverse of rawAt", () => {
  const clock = new MusicClock({ bpm: 96, time: 4.2 });
  clock.setTempo(137, 5.1);
  const target = 14.75;
  close(clock.rawAt(clock.timeAtRaw(target)), target, 1e-9);
});
