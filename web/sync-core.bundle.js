(function (root) {
  const cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const module = { exports: {} };
    cache[id] = module;
    modules[id].call(module.exports, module, module.exports,
      (req) => mapRequire(id, req));
    return module.exports;
  }
  function mapRequire(id, req) {
    const dep = moduleMap[id][req];
    if (!dep) return require(req);
    return load(dep);
  }
  const moduleMap = {
    "/home/hj/userfeedback/uid501/src/core/index.js": {
      "./timebase": "/home/hj/userfeedback/uid501/src/core/timebase.js",
      "./project": "/home/hj/userfeedback/uid501/src/core/project.js",
      "./clock": "/home/hj/userfeedback/uid501/src/core/clock.js",
      "./wav": "/home/hj/userfeedback/uid501/src/core/wav.js",
      "./audio": "/home/hj/userfeedback/uid501/src/core/audio.js",
      "./events": "/home/hj/userfeedback/uid501/src/core/events.js",
    },
    "/home/hj/userfeedback/uid501/src/core/timebase.js": {
    },
    "/home/hj/userfeedback/uid501/src/core/project.js": {
      "./timebase": "/home/hj/userfeedback/uid501/src/core/timebase.js",
    },
    "/home/hj/userfeedback/uid501/src/core/clock.js": {
      "./timebase": "/home/hj/userfeedback/uid501/src/core/timebase.js",
    },
    "/home/hj/userfeedback/uid501/src/core/wav.js": {
    },
    "/home/hj/userfeedback/uid501/src/core/audio.js": {
    },
    "/home/hj/userfeedback/uid501/src/core/events.js": {
    },
  };
  const modules = {
    "/home/hj/userfeedback/uid501/src/core/index.js": function (module, exports, require) {
'use strict';

module.exports = {
  ...require('./timebase'),
  ...require('./project'),
  ...require('./clock'),
  ...require('./wav'),
  ...require('./audio'),
  ...require('./events'),
};

    },
    "/home/hj/userfeedback/uid501/src/core/timebase.js": function (module, exports, require) {
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

    },
    "/home/hj/userfeedback/uid501/src/core/project.js": function (module, exports, require) {
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

    },
    "/home/hj/userfeedback/uid501/src/core/clock.js": function (module, exports, require) {
'use strict';

const { frameToTime, clamp } = require('./timebase');

// One clock per project. All transport actions mutate only this
// object: play(), pause(), seekToTime(), stepFrames(), and the
// playhead drag handler all call the same primitives.
class TransportClock {
  constructor(options = {}) {
    this.fps = options.fps || 24;
    this.durationSeconds = options.durationSeconds || 20;
    this._now =
      options.now ||
      (typeof performance !== 'undefined'
        ? () => performance.now() / 1000
        : () => Date.now() / 1000);
    this._playing = false;
    this._startedAt = 0;
    this._position = 0;
    this._listeners = new Set();
  }

  get playing() {
    return this._playing;
  }

  // Current timeline position in seconds, computed from the wall
  // clock while playing so rAF and the audio scheduler agree.
  get position() {
    if (!this._playing) return this._position;
    const elapsed = this._now() - this._startedAt;
    return clamp(this._position + elapsed, 0, this.durationSeconds);
  }

  get frame() {
    return Math.floor(this.position * this.fps);
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event, this);
  }

  play() {
    if (this._playing) return;
    if (this._position >= this.durationSeconds) this._position = 0;
    this._position = this.position;
    this._startedAt = this._now();
    this._playing = true;
    this._emit('play');
  }

  pause() {
    if (!this._playing) return;
    this._position = this.position;
    this._playing = false;
    this._emit('pause');
  }

  toggle() {
    if (this._playing) this.pause();
    else this.play();
  }

  seekToTime(time) {
    const next = clamp(time, 0, this.durationSeconds);
    this._position = next;
    if (this._playing) this._startedAt = this._now();
    this._emit('seek');
  }

  seekToFrame(frame) {
    this.seekToTime(frameToTime(frame, this.fps));
  }

  // Frame stepping always pauses first; this matches NLE behavior and
  // guarantees a deterministic single-frame move.
  stepFrames(deltaFrames) {
    this.pause();
    const currentFrame = Math.round(this._position * this.fps);
    this.seekToFrame(currentFrame + deltaFrames);
  }

  stop() {
    this.pause();
    this.seekToTime(0);
    this._emit('stop');
  }
}

module.exports = { TransportClock };

    },
    "/home/hj/userfeedback/uid501/src/core/wav.js": function (module, exports, require) {
'use strict';

// Minimal mono PCM16 WAV reader/writer. Uses only DataView/Uint8Array
// so the identical code runs in Node and in the browser.

const HAS_BUFFER = typeof Buffer !== 'undefined';

function allocBytes(size) {
  if (HAS_BUFFER) return Buffer.alloc(size);
  return new Uint8Array(size);
}

function asUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function readAscii(view, offset, length) {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function writeWav(samples, sampleRate = 48000) {
  const frameCount = samples.length;
  const dataBytes = frameCount * 2;
  const bytes = allocBytes(44 + dataBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < frameCount; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clipped * 32767), true);
  }
  return bytes;
}

function readWav(input) {
  const bytes = asUint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' ||
      readAscii(view, 8, 12 - 8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error('WAV missing fmt/data');
  if (fmt.audioFormat !== 1 || fmt.channels !== 1 ||
      fmt.bitsPerSample !== 16) {
    throw new Error('only mono PCM16 WAV is supported');
  }
  const frameCount = Math.floor(dataLength / 2);
  const samples = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }
  return { sampleRate: fmt.sampleRate, samples };
}

// Delay (positive) or advance (negative) a signal by sampleCount
// samples, padding with silence and preserving total length.
function shiftSamples(samples, sampleCount) {
  const out = new Float64Array(samples.length);
  if (sampleCount >= 0) {
    out.set(
      samples.subarray(0, Math.max(0, samples.length - sampleCount)),
      sampleCount
    );
  } else {
    out.set(samples.subarray(-sampleCount));
  }
  return out;
}

module.exports = { writeWav, readWav, shiftSamples };

    },
    "/home/hj/userfeedback/uid501/src/core/audio.js": function (module, exports, require) {
'use strict';

// Synthesis of the reference beat track and independent envelope
// onset detection used to verify the exported, offset audio.

const BEAT_DURATION_S = 0.08;
const BEAT_FREQ_HZ = 150;

function synthesizeBeatTrack(beatTimes, sampleRate, durationSeconds) {
  const total = Math.round(durationSeconds * sampleRate);
  const samples = new Float64Array(total);
  const burstLength = Math.round(BEAT_DURATION_S * sampleRate);
  for (const beatTime of beatTimes) {
    const start = Math.round(beatTime * sampleRate);
    for (let i = 0; i < burstLength && start + i < total; i += 1) {
      const t = i / sampleRate;
      // Short attack plus exponential decay gives a crisp, detectable onset.
      const attack = Math.min(1, t / 0.004);
      const decay = Math.exp(-t * 18);
      const tone = Math.sin(2 * Math.PI * BEAT_FREQ_HZ * t);
      samples[start + i] += 0.8 * attack * decay * tone;
    }
  }
  return samples;
}

// Peak-picking onset detector: an onset is the first frame whose RMS
// exceeds an adaptive threshold, followed by a refractory gap.
function detectOnsets(samples, sampleRate, options = {}) {
  const windowMs = options.windowMs || 10;
  const windowSize = Math.round((windowMs / 1000) * sampleRate);
  const hop = Math.max(1, Math.floor(windowSize / 2));
  const envelope = [];
  for (let start = 0; start + windowSize <= samples.length; start += hop) {
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j += 1) {
      const v = samples[start + j];
      sumSquares += v * v;
    }
    envelope.push({
      start,
      time: start / sampleRate,
      rms: Math.sqrt(sumSquares / windowSize),
    });
  }
  const peak = envelope.reduce((max, frame) => Math.max(max, frame.rms), 0);
  const threshold = options.thresholdRatio
    ? peak * options.thresholdRatio
    : peak * 0.15;
  const refractoryMs = options.refractoryMs || 120;
  const refractorySamples = (refractoryMs / 1000) * sampleRate;
  const onsets = [];
  let lastOnsetStart = -Infinity;
  for (const frame of envelope) {
    if (frame.rms < threshold) continue;
    if (frame.start - lastOnsetStart < refractorySamples) continue;
    onsets.push(frame.time);
    lastOnsetStart = frame.start;
  }
  return onsets;
}

module.exports = {
  BEAT_DURATION_S,
  BEAT_FREQ_HZ,
  synthesizeBeatTrack,
  detectOnsets,
};

    },
    "/home/hj/userfeedback/uid501/src/core/events.js": function (module, exports, require) {
'use strict';

// Canonical event specification for the 20 s / 24 fps timeline.
// Flash times are authored on frame boundaries (or half-frame slots),
// beat times come from an upstream musical analysis pass and are not
// frame aligned, which is why a calibration offset is required.

const FLASH_TIMES = [
  1,
  2.625,
  4.291666666666666,
  5.916666666666666,
  7.541666666666666,
  9.166666666666666,
  10.833333333333332,
  12.458333333333332,
  14.083333333333332,
  15.708333333333332,
  17.375,
  19,
];

const BEAT_TIMES = [
  0.438657,
  2.09015,
  3.720999,
  5.350145,
  6.981353,
  8.600608,
  10.307996,
  11.931003,
  13.547489,
  15.145426,
  16.849802,
  18.465001,
];

module.exports = {
  EVENT_COUNT: 12,
  FLASH_TIMES,
  BEAT_TIMES,
};

    },
  };
  root.SyncCore = load("/home/hj/userfeedback/uid501/src/core/index.js");
})(typeof window !== "undefined" ? window : globalThis);