import { CAMERAS, CAMERA_BY_ID, sceneSignature } from "./scene.js";

export const PROGRAM = {
  title: "轨道幻境",
  subtitle: "ORBIT / LIVE STAGE SESSION 15-03",
  durationSeconds: 15,
  fps: 30,
  bpm: 120,
  beatsPerBar: 4,
  width: 1280,
  height: 720,
  sceneClock: "absolute-program-time",
  expectedCutCount: 3
};

export const BEAT_INTERVAL = 60 / PROGRAM.bpm;
export const TRANSITION_LABELS = {
  cut: "硬切",
  dissolve: "叠化",
  wipe: "侧向擦除",
  slide: "推入",
  dip: "闪黑"
};

export const DEFAULT_SHOTS = [
  { id: "shot-1", start: 0, camera: "cam-a", transition: "cut" },
  { id: "shot-2", start: 4, camera: "cam-b", transition: "wipe" },
  { id: "shot-3", start: 8, camera: "cam-c", transition: "dissolve" },
  { id: "shot-4", start: 12, camera: "cam-a", transition: "slide" }
];

export const TRANSITION_DURATION = {
  cut: 0,
  dissolve: 0.55,
  wipe: 0.5,
  slide: 0.5,
  dip: 0.65
};

export function cloneShots(shots = DEFAULT_SHOTS) {
  return shots.map((shot) => ({ ...shot }));
}

export function sortShots(shots) {
  return shots.slice().sort((a, b) => a.start - b.start);
}

export function snapToBeat(time) {
  const snapped = Math.round(time / BEAT_INTERVAL) * BEAT_INTERVAL;
  return Math.round(snapped * 1000) / 1000;
}

export function beatPosition(time) {
  const beatIndex = Math.max(0, Math.floor(time / BEAT_INTERVAL + 1e-8));
  return {
    zeroBasedBeat: beatIndex,
    beat: beatIndex + 1,
    bar: Math.floor(beatIndex / PROGRAM.beatsPerBar) + 1,
    beatInBar: (beatIndex % PROGRAM.beatsPerBar) + 1,
    phase: time / BEAT_INTERVAL - beatIndex
  };
}

export function isOnBeat(time) {
  const beats = time / BEAT_INTERVAL;
  return Math.abs(beats - Math.round(beats)) < 1e-7;
}

export function activeShotIndex(shots, time) {
  const ordered = sortShots(shots);
  let active = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    if (time + 1e-8 >= ordered[index].start) {
      active = index;
    }
  }
  return active;
}

export function getCutPoints(shots) {
  const ordered = sortShots(shots);
  return ordered.slice(1).map((shot, index) => {
    const previous = ordered[index];
    return {
      index,
      shotId: shot.id,
      time: shot.start,
      fromCamera: previous.camera,
      toCamera: shot.camera,
      transition: shot.transition,
      duration: TRANSITION_DURATION[shot.transition] ?? 0
    };
  });
}

export function transitionAtTime(shots, time) {
  const ordered = sortShots(shots);
  let result = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const shot = ordered[index];
    const duration = TRANSITION_DURATION[shot.transition] ?? 0;
    if (duration > 0 && time >= shot.start && time < shot.start + duration) {
      result = {
        fromCamera: ordered[index - 1].camera,
        toCamera: shot.camera,
        transition: shot.transition,
        progress: (time - shot.start) / duration
      };
    }
  }
  return result;
}

function sceneDeltaAtCut(time) {
  const sample = 1 / 240;
  const before = sceneSignature(Math.max(0, time - sample));
  const after = sceneSignature(Math.min(PROGRAM.durationSeconds, time + sample));
  return Math.hypot(after.x - before.x, after.y - before.y);
}

export function validateProgram(shots) {
  const ordered = sortShots(shots);
  const cuts = getCutPoints(ordered);
  const IDs = new Set();
  const times = new Set();
  const checks = [];
  let mismatchCount = 0;

  ordered.forEach((shot) => {
    if (IDs.has(shot.id)) {
      mismatchCount += 1;
    }
    IDs.add(shot.id);
  });

  cuts.forEach((cut, index) => {
    const beat = beatPosition(cut.time);
    const beatAligned = isOnBeat(cut.time);
    const inRange = cut.time > 0 && cut.time < PROGRAM.durationSeconds;
    const uniqueTime = !times.has(cut.time);
    const cameraChanged = cut.fromCamera !== cut.toCamera;
    const delta = sceneDeltaAtCut(cut.time);
    const continuous = delta < 2.5;
    const passed = beatAligned && inRange && uniqueTime && cameraChanged && continuous;
    times.add(cut.time);
    if (!passed) {
      mismatchCount += 1;
    }
    checks.push({
      index,
      passed,
      time: cut.time,
      beat,
      beatAligned,
      inRange,
      uniqueTime,
      cameraChanged,
      continuous,
      sceneDeltaPx: Number(delta.toFixed(4)),
      fromCamera: cut.fromCamera,
      toCamera: cut.toCamera,
      transition: cut.transition,
      duration: cut.duration,
      label: `切点 ${String(index + 1).padStart(2, "0")} · ${formatClock(cut.time)}`,
      detail: beatAligned
        ? `第 ${beat.bar} 小节 / 第 ${beat.beatInBar} 拍 · ${TRANSITION_LABELS[cut.transition]}`
        : `未对齐节拍 · ${formatClock(cut.time)}`
    });
  });

  if (cuts.length !== PROGRAM.expectedCutCount) {
    mismatchCount += 1;
  }

  return {
    passed: mismatchCount === 0,
    cutCount: cuts.length,
    expectedCutCount: PROGRAM.expectedCutCount,
    checks,
    continuity: {
      verified: checks.every((check) => check.continuous),
      clock: "absolute-program-time",
      maxDeltaPx: checks.length ? Math.max(...checks.map((check) => check.sceneDeltaPx)) : 0
    }
  };
}

export function formatClock(time, includeFrames = false) {
  const safe = Math.max(0, Math.min(PROGRAM.durationSeconds, Number(time) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe % 1) * 100);
  if (!includeFrames) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  }
  const frames = Math.floor((safe % 1) * PROGRAM.fps);
  return `00:${String(minutes * 60 + seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function formatTimecode(time) {
  const safe = Math.max(0, Math.min(PROGRAM.durationSeconds, Number(time) || 0));
  const hours = 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * PROGRAM.fps);
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, "0")).join(":");
}

export function buildShotTable(shots, validation, source = "browser-export") {
  const ordered = sortShots(shots);
  const cuts = getCutPoints(ordered);
  return {
    schemaVersion: "1.0",
    generator: "ORBIT Live Stage / three-camera program deck",
    exportedAt: new Date().toISOString(),
    source,
    program: {
      title: PROGRAM.title,
      subtitle: PROGRAM.subtitle,
      durationSeconds: PROGRAM.durationSeconds,
      fps: PROGRAM.fps,
      bpm: PROGRAM.bpm,
      beatsPerBar: PROGRAM.beatsPerBar,
      beatIntervalSeconds: BEAT_INTERVAL,
      resolution: { width: PROGRAM.width, height: PROGRAM.height },
      sceneClock: PROGRAM.sceneClock,
      continuityRule: "Scene state is evaluated from absolute program time for every camera; cuts never reset animation."
    },
    cameras: CAMERAS.map((camera) => ({
      id: camera.id,
      number: camera.number,
      name: camera.name,
      label: camera.label,
      type: "fixed",
      framing: { scale: camera.scale, focusX: camera.focusX, focusY: camera.focusY }
    })),
    shots: ordered.map((shot, index) => {
      const end = ordered[index + 1]?.start ?? PROGRAM.durationSeconds;
      const beat = beatPosition(shot.start);
      return {
        shotNumber: index + 1,
        id: shot.id,
        startSeconds: shot.start,
        endSeconds: end,
        durationSeconds: Number((end - shot.start).toFixed(3)),
        cameraId: shot.camera,
        cameraName: CAMERA_BY_ID[shot.camera]?.name ?? shot.camera,
        transitionIn: shot.transition,
        transitionLabel: TRANSITION_LABELS[shot.transition],
        transitionDurationSeconds: TRANSITION_DURATION[shot.transition] ?? 0,
        startBeat: beat.zeroBasedBeat,
        startBar: beat.bar,
        startBeatInBar: beat.beatInBar
      };
    }),
    cutPoints: cuts.map((cut, index) => {
      const check = validation.checks[index];
      return {
        cutNumber: index + 1,
        timeSeconds: cut.time,
        beat: beatPosition(cut.time).zeroBasedBeat,
        bar: beatPosition(cut.time).bar,
        beatInBar: beatPosition(cut.time).beatInBar,
        fromCameraId: cut.fromCamera,
        toCameraId: cut.toCamera,
        transition: cut.transition,
        transitionLabel: TRANSITION_LABELS[cut.transition],
        transitionDurationSeconds: cut.duration,
        beatAligned: check?.beatAligned ?? false,
        cameraChanged: check?.cameraChanged ?? false,
        sceneContinuity: {
          passed: check?.continuous ?? false,
          deltaPx: check?.sceneDeltaPx ?? null
        }
      };
    }),
    verification: {
      passed: validation.passed,
      cutCount: validation.cutCount,
      expectedCutCount: validation.expectedCutCount,
      continuity: validation.continuity,
      checks: validation.checks.map((check) => ({
        cutNumber: check.index + 1,
        passed: check.passed,
        onBeat: check.beatAligned,
        cameraChanged: check.cameraChanged,
        sceneContinuous: check.continuous,
        sceneDeltaPx: check.sceneDeltaPx
      }))
    }
  };
}
