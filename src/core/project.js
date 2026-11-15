'use strict';

const {
  DEFAULT_FPS,
  DEFAULT_DURATION_S,
  DEFAULT_TOLERANCE_FRAMES,
  timeToFrame,
  frameShiftToSeconds,
  toleranceSeconds,
  errorFrames,
} = require('./timebase');

const PROJECT_VERSION = 1;

function createProject(options = {}) {
  const fps = options.fps || DEFAULT_FPS;
  const durationSeconds = options.durationSeconds || DEFAULT_DURATION_S;
  const toleranceFrames =
    options.toleranceFrames || DEFAULT_TOLERANCE_FRAMES;
  return {
    version: PROJECT_VERSION,
    name: options.name || 'flash-beat-sync-calibration',
    createdAt: new Date().toISOString(),
    timeline: { fps, durationSeconds, toleranceFrames },
    events: {
      count: (options.flashTimes || []).length,
      flashTimes: options.flashTimes || [],
      beatTimes: options.beatTimes || [],
    },
    // Audio offset in milliseconds. Positive offset delays the audio
    // so each beat lands later on the shared timeline.
    offset: {
      ms: 0,
      frameShift: 0,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    },
  };
}

// Apply the stored offset to a raw beat time.
function alignedBeatTime(rawBeatTime, project) {
  return rawBeatTime + project.offset.ms / 1000;
}

function evaluateEvent(flashTime, rawBeatTime, project) {
  const fps = project.timeline.fps;
  const observed = alignedBeatTime(rawBeatTime, project);
  const frames = errorFrames(flashTime, observed, fps);
  const within =
    Math.abs(frames) <= project.timeline.toleranceFrames;
  return {
    flashTime,
    rawBeatTime,
    alignedBeatTime: observed,
    errorMs: (observed - flashTime) * 1000,
    errorFrames: frames,
    pass: within,
  };
}

function evaluateAll(project) {
  const perEvent = project.events.flashTimes.map((flashTime, index) =>
    evaluateEvent(flashTime, project.events.beatTimes[index], project)
  );
  const maxAbsErrorFrames = perEvent.reduce(
    (max, event) => Math.max(max, Math.abs(event.errorFrames)),
    0
  );
  const withinCount = perEvent.filter((event) => event.pass).length;
  return {
    total: perEvent.length,
    withinCount,
    maxAbsErrorFrames,
    allWithinTolerance: withinCount === perEvent.length,
    perEvent,
  };
}

// Mean delay of beats relative to flashes, in seconds. Equal to the
// least-squares constant offset for a 1-parameter shift model.
function rawOffsetSeconds(project) {
  const { flashTimes, beatTimes } = project.events;
  const sum = flashTimes.reduce(
    (acc, flashTime, index) => acc + (flashTime - beatTimes[index]),
    0
  );
  return sum / flashTimes.length;
}

// Grid search over whole-frame shifts; picks the shift that maximizes
// the number of in-tolerance events, breaking ties by smallest
// maximum absolute error.
function bestFrameShift(project, rawOffsetSec) {
  const fps = project.timeline.fps;
  const searchRadius = Math.ceil(Math.abs(rawOffsetSec) * fps) + 4;
  const center = Math.round(rawOffsetSec * fps);
  let best = null;
  for (
    let frameShift = center - searchRadius;
    frameShift <= center + searchRadius;
    frameShift += 1
  ) {
    const candidate = frameShiftToSeconds(frameShift, fps);
    const maxAbs = project.events.flashTimes.reduce((max, flash, i) => {
      const frames = timeToFrame(
        project.events.beatTimes[i] + candidate - flash,
        fps
      );
      return Math.max(max, Math.abs(frames));
    }, 0);
    const withinCount = project.events.flashTimes.reduce((count, flash, i) => {
      const frames = timeToFrame(
        project.events.beatTimes[i] + candidate - flash,
        fps
      );
      return count + (Math.abs(frames) <= project.timeline.toleranceFrames ? 1 : 0);
    }, 0);
    const candidateResult = { frameShift, withinCount, maxAbs };
    if (
      !best ||
      candidateResult.withinCount > best.withinCount ||
      (candidateResult.withinCount === best.withinCount &&
        candidateResult.maxAbs < best.maxAbs)
    ) {
      best = candidateResult;
    }
  }
  return best;
}

// Compute and persist a frame-quantized offset. Returns a record of
// the calibration, including before/after evaluation summaries.
function calibrate(project, source = 'auto') {
  const before = evaluateAll(project);
  const rawOffsetSec = rawOffsetSeconds(project);
  const grid = bestFrameShift(project, rawOffsetSec);
  const appliedSec = frameShiftToSeconds(
    grid.frameShift,
    project.timeline.fps
  );
  project.offset = {
    ms: appliedSec * 1000,
    frameShift: grid.frameShift,
    source,
    updatedAt: new Date().toISOString(),
  };
  const after = evaluateAll(project);
  project.calibration = {
    method: 'least-squares + frame quantization',
    crossCheck: 'grid search',
    rawOffsetMs: rawOffsetSec * 1000,
    before: {
      withinCount: before.withinCount,
      maxAbsErrorFrames: before.maxAbsErrorFrames,
    },
    after: {
      withinCount: after.withinCount,
      maxAbsErrorFrames: after.maxAbsErrorFrames,
      allWithinTolerance: after.allWithinTolerance,
    },
  };
  return project.calibration;
}

// Manual marker drag: nudge the whole audio offset by a delta.
function applyManualShift(project, deltaMs) {
  const fps = project.timeline.fps;
  const nextSec = project.offset.ms / 1000 + deltaMs / 1000;
  const frameShift = Math.round(nextSec * fps);
  project.offset = {
    ms: frameShiftToSeconds(frameShift, fps) * 1000,
    frameShift,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  };
  return project.offset;
}

function toleranceFor(project) {
  const sec = toleranceSeconds(
    project.timeline.fps,
    project.timeline.toleranceFrames
  );
  return {
    frames: project.timeline.toleranceFrames,
    seconds: sec,
    ms: sec * 1000,
  };
}

module.exports = {
  PROJECT_VERSION,
  createProject,
  alignedBeatTime,
  evaluateEvent,
  evaluateAll,
  rawOffsetSeconds,
  bestFrameShift,
  calibrate,
  applyManualShift,
  toleranceFor,
};
