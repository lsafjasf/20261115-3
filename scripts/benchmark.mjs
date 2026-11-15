import { writeFile } from "node:fs/promises";
import { createDemoTracks } from "../src/demo.js";
import {
  DEFAULT_PARAMS,
  analyzeRelease,
  computeDetectionEnvelope
} from "../src/ducking.js";

const releases = [150, 650];
const tracks = createDemoTracks();
const detection = computeDetectionEnvelope({
  broadcast: tracks.broadcast,
  sampleRate: tracks.sampleRate,
  segments: tracks.segments
});
const output = {
  generatedAt: new Date().toISOString(),
  sampleRate: tracks.sampleRate,
  durationSeconds: tracks.duration,
  thresholdDb: DEFAULT_PARAMS.thresholdDb,
  maxAttenuationDb: DEFAULT_PARAMS.maxAttenuationDb,
  holdMs: DEFAULT_PARAMS.holdMs,
  cases: []
};

for (const releaseMs of releases) {
  const result = analyzeRelease({
    tracks,
    detection,
    params: DEFAULT_PARAMS,
    skippedIds: new Set(),
    releaseMs
  });
  output.cases.push({
    releaseMs,
    peakDbFS: Number(result.peak.peakDb.toFixed(3)),
    peakTimeSeconds: Number(result.peak.peakTime.toFixed(3)),
    clippedSamples: result.peak.clippedSamples,
    minimumGainDb: Number(result.gain.minimumGainDb.toFixed(2)),
    recoveryMs: Math.round(result.gain.recoveryMs),
    maximumRecoverySlewDbPerSecond: Number(
      result.gain.maximumRecoverySlewDbPerSecond.toFixed(1)
    ),
    gainDirectionChanges: result.gain.directionChanges
  });
}

await writeFile(
  new URL("../artifacts/benchmark.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`
);
console.log(JSON.stringify(output, null, 2));
