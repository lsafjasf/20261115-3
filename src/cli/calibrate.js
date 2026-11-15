'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createProject,
  calibrate,
  evaluateAll,
  toleranceFor,
  synthesizeBeatTrack,
  detectOnsets,
  writeWav,
  readWav,
  shiftSamples,
  FLASH_TIMES,
  BEAT_TIMES,
  timeToFrame,
} = require('../core');

const SAMPLE_RATE = 48000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Verify an exported WAV independently: read it back from disk,
// run onset detection, and match each onset to the nearest flash.
function verifyExportedWav(wavPath, project) {
  const { sampleRate, samples } = readWav(fs.readFileSync(wavPath));
  const onsets = detectOnsets(samples, sampleRate);
  const fps = project.timeline.fps;
  const perEvent = FLASH_TIMES.map((flashTime) => {
    let nearest = onsets[0];
    let nearestDelta = Math.abs(nearest - flashTime);
    for (const onset of onsets) {
      const delta = Math.abs(onset - flashTime);
      if (delta < nearestDelta) {
        nearest = onset;
        nearestDelta = delta;
      }
    }
    const errorMs = (nearest - flashTime) * 1000;
    const errorFrames = timeToFrame(nearest - flashTime, fps);
    return {
      detectedTime: Number(nearest.toFixed(4)),
      flashTime,
      errorMs: Number(errorMs.toFixed(3)),
      errorFrames: Number(errorFrames.toFixed(4)),
      pass: Math.abs(errorFrames) <= project.timeline.toleranceFrames,
    };
  });
  const maxErrorFrames = perEvent.reduce(
    (max, event) => Math.max(max, Math.abs(event.errorFrames)),
    0
  );
  const pass = perEvent.filter((event) => event.pass).length;
  return {
    method: 'envelope onset detection on exported WAV',
    onsetCount: onsets.length,
    pass,
    total: perEvent.length,
    maxErrorFrames: Number(maxErrorFrames.toFixed(4)),
    perEvent,
  };
}

function run(outputDir) {
  ensureDir(outputDir);
  const project = createProject({
    flashTimes: FLASH_TIMES,
    beatTimes: BEAT_TIMES,
  });

  // 1. Render the unaligned source beat track.
  const sourceSamples = synthesizeBeatTrack(
    BEAT_TIMES,
    SAMPLE_RATE,
    project.timeline.durationSeconds
  );
  const sourcePath = path.join(outputDir, 'beat_track_source.wav');
  fs.writeFileSync(sourcePath, writeWav(sourceSamples, SAMPLE_RATE));

  // 2. Calibrate offset from the event timestamps.
  const before = evaluateAll(project);
  calibrate(project, 'auto');
  const timestampAfter = evaluateAll(project);

  // 3. Apply the offset at sample granularity and export the aligned WAV.
  const shiftSamplesCount = Math.round(
    (project.offset.ms / 1000) * SAMPLE_RATE
  );
  const alignedSamples = shiftSamples(sourceSamples, shiftSamplesCount);
  const alignedPath = path.join(outputDir, 'beat_track_aligned.wav');
  fs.writeFileSync(alignedPath, writeWav(alignedSamples, SAMPLE_RATE));

  // 4. Independently verify the exported file from disk.
  const audioVerification = verifyExportedWav(alignedPath, project);
  project.calibration.audioVerification = {
    onsetCount: audioVerification.onsetCount,
    withinCount: audioVerification.pass,
    maxAbsErrorFrames: audioVerification.maxErrorFrames,
    allWithinTolerance: audioVerification.pass === audioVerification.total,
  };
  project.calibration.exportedAudio = path.relative(
    path.dirname(outputDir),
    alignedPath
  );

  // 5. Persist project + verification report.
  const projectPath = path.join(outputDir, 'sync_project.json');
  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));

  const report = {
    generatedAt: new Date().toISOString(),
    sampleRate: SAMPLE_RATE,
    sampleShift: shiftSamplesCount,
    tolerance: toleranceFor(project),
    offset: {
      rawMs: Number(project.calibration.rawOffsetMs.toFixed(3)),
      appliedMs: Number(project.offset.ms.toFixed(3)),
      frameShift: project.offset.frameShift,
    },
    timestampEvaluation: {
      before: {
        pass: before.withinCount,
        total: before.total,
        maxErrorFrames: Number(before.maxAbsErrorFrames.toFixed(4)),
      },
      after: {
        pass: timestampAfter.withinCount,
        total: timestampAfter.total,
        maxErrorFrames: Number(
          timestampAfter.maxAbsErrorFrames.toFixed(4)
        ),
        perEvent: timestampAfter.perEvent.map((event) => ({
          flashTime: event.flashTime,
          alignedBeatTime: Number(event.alignedBeatTime.toFixed(6)),
          errorMs: Number(event.errorMs.toFixed(3)),
          errorFrames: Number(event.errorFrames.toFixed(4)),
          pass: event.pass,
        })),
      },
    },
    audioVerification,
    overallPass:
      timestampAfter.allWithinTolerance &&
      audioVerification.pass === audioVerification.total,
  };
  const reportPath = path.join(outputDir, 'verification_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { project, report, projectPath, reportPath, alignedPath, sourcePath };
}

if (require.main === module) {
  const outputDir = process.argv[2] || path.join('artifacts');
  const result = run(path.resolve(outputDir));
  console.log(JSON.stringify({
    project: result.projectPath,
    report: result.reportPath,
    alignedWav: result.alignedPath,
    sourceWav: result.sourcePath,
    overallPass: result.report.overallPass,
    offset: result.report.offset,
    audio: {
      onsetCount: result.report.audioVerification.onsetCount,
      pass: result.report.audioVerification.pass,
      maxErrorFrames: result.report.audioVerification.maxErrorFrames,
    },
  }, null, 2));
}

module.exports = { run, verifyExportedWav };
