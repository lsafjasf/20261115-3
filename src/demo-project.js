import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  STEP_COUNT,
  makeStep,
  makeTrack,
} from "./project.js";

function stepsFromHits(hits, defaultNote = 48) {
  const steps = Array.from({ length: STEP_COUNT }, () => makeStep(defaultNote));
  for (const [index, note, sustain = 1] of hits) {
    steps[index] = makeStep(note, true, sustain);
  }
  return steps;
}

export function createDemoProject() {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: "MIDNIGHT GRID",
    bpm: 112,
    loop: true,
    resumeMode: "current",
    master: { gain: 0.76 },
    tracks: [
      makeTrack(0, {
        name: "LOW PULSE",
        synth: {
          waveform: "sine",
          cutoff: 280,
          resonance: 1.2,
          filterEnv: 0,
          attack: 0.004,
          decay: 0.2,
          sustain: 0.08,
          release: 0.13,
          volume: 0.82,
          pan: 0,
          detune: 0,
        },
        steps: stepsFromHits(
          [
            [0, 24],
            [4, 24],
            [8, 24],
            [12, 24],
            [14, 24],
          ],
          24,
        ),
      }),
      makeTrack(1, {
        name: "SUB BASS",
        synth: {
          waveform: "sawtooth",
          cutoff: 760,
          resonance: 4.5,
          filterEnv: 1200,
          attack: 0.014,
          decay: 0.22,
          sustain: 0.52,
          release: 0.16,
          volume: 0.64,
          pan: -0.04,
          detune: 5,
        },
        steps: stepsFromHits(
          [
            [0, 36, 2],
            [3, 36],
            [6, 31, 2],
            [9, 34],
            [11, 29],
            [14, 31, 2],
          ],
          36,
        ),
      }),
      makeTrack(2, {
        name: "ACID LINE",
        synth: {
          waveform: "sawtooth",
          cutoff: 940,
          resonance: 9.2,
          filterEnv: 3400,
          attack: 0.006,
          decay: 0.1,
          sustain: 0.36,
          release: 0.1,
          volume: 0.47,
          pan: 0.08,
          detune: 14,
        },
        steps: stepsFromHits(
          [
            [2, 48],
            [4, 51],
            [6, 55],
            [8, 59],
            [10, 55],
            [12, 53],
            [14, 51, 2],
          ],
          48,
        ),
      }),
      makeTrack(3, {
        name: "CHORD BODY",
        synth: {
          waveform: "triangle",
          cutoff: 2600,
          resonance: 2.1,
          filterEnv: 500,
          attack: 0.035,
          decay: 0.22,
          sustain: 0.68,
          release: 0.28,
          volume: 0.43,
          pan: 0.14,
          detune: 9,
        },
        steps: stepsFromHits(
          [
            [0, 48, 3],
            [5, 44, 2],
            [9, 46, 2],
            [13, 43, 3],
          ],
          48,
        ),
      }),
      makeTrack(4, {
        name: "CHORD TOP",
        synth: {
          waveform: "triangle",
          cutoff: 3500,
          resonance: 1.8,
          filterEnv: 700,
          attack: 0.04,
          decay: 0.24,
          sustain: 0.7,
          release: 0.3,
          volume: 0.36,
          pan: -0.15,
          detune: 13,
        },
        steps: stepsFromHits(
          [
            [0, 63, 3],
            [5, 60, 2],
            [9, 62, 2],
            [13, 59, 3],
          ],
          60,
        ),
      }),
      makeTrack(5, {
        name: "LEAD",
        synth: {
          waveform: "square",
          cutoff: 2200,
          resonance: 4.8,
          filterEnv: 2400,
          attack: 0.006,
          decay: 0.15,
          sustain: 0.44,
          release: 0.13,
          volume: 0.38,
          pan: 0.12,
          detune: 12,
        },
        steps: stepsFromHits(
          [
            [3, 67],
            [5, 70],
            [7, 72, 2],
            [10, 67],
            [12, 65],
            [14, 64],
          ],
          67,
        ),
      }),
      makeTrack(6, {
        name: "NOISE HAT",
        synth: {
          waveform: "noise",
          cutoff: 7800,
          resonance: 1.5,
          filterEnv: 0,
          attack: 0.001,
          decay: 0.04,
          sustain: 0.04,
          release: 0.045,
          volume: 0.3,
          pan: 0.18,
          detune: 0,
        },
        steps: stepsFromHits(
          [
            [1, 72],
            [3, 72],
            [5, 72],
            [7, 72],
            [9, 72],
            [11, 72],
            [13, 72],
            [15, 72],
          ],
          72,
        ),
      }),
      makeTrack(7, {
        name: "AIR PAD",
        synth: {
          waveform: "sine",
          cutoff: 1450,
          resonance: 1.4,
          filterEnv: 0,
          attack: 0.18,
          decay: 0.5,
          sustain: 0.74,
          release: 0.75,
          volume: 0.27,
          pan: -0.12,
          detune: 4,
        },
        steps: stepsFromHits(
          [
            [0, 48, 4],
            [4, 44, 4],
            [8, 51, 4],
            [12, 43, 4],
          ],
          48,
        ),
      }),
    ],
  };
}

export const demoProject = createDemoProject();
