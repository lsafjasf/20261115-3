'use strict';

// Single source of truth for time. Every UI control (play, pause,
// frame step, playhead drag, marker drag) and every Node pipeline
// step converts through these helpers, so frames and seconds never
// drift apart.

const DEFAULT_FPS = 24;
const DEFAULT_DURATION_S = 20;
const DEFAULT_TOLERANCE_FRAMES = 2;

function frameToTime(frame, fps = DEFAULT_FPS) {
  return frame / fps;
}

function timeToFrame(time, fps = DEFAULT_FPS) {
  return time * fps;
}

// Nearest whole frame index for a given time.
function quantizeToFrame(time, fps = DEFAULT_FPS) {
  return Math.round(timeToFrame(time, fps));
}

// Offset in seconds that corresponds to a whole-frame shift.
function frameShiftToSeconds(frameShift, fps = DEFAULT_FPS) {
  return frameShift / fps;
}

function toleranceSeconds(fps = DEFAULT_FPS, toleranceFrames = DEFAULT_TOLERANCE_FRAMES) {
  return toleranceFrames / fps;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Signed error in frames between an observed time and a reference time.
// Negative means the observed event fires before the reference event.
function errorFrames(referenceTime, observedTime, fps = DEFAULT_FPS) {
  return timeToFrame(observedTime - referenceTime, fps);
}

module.exports = {
  DEFAULT_FPS,
  DEFAULT_DURATION_S,
  DEFAULT_TOLERANCE_FRAMES,
  frameToTime,
  timeToFrame,
  quantizeToFrame,
  frameShiftToSeconds,
  toleranceSeconds,
  toleranceMs: (fps, toleranceFrames) =>
    toleranceSeconds(fps, toleranceFrames) * 1000,
  clamp,
  errorFrames,
};
