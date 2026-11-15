export const TRACK_COUNT = 8;
export const STEP_COUNT = 16;
export const STEPS_PER_BEAT = 4;
export const PROJECT_FORMAT = "eight-track-sequencer";
export const PROJECT_VERSION = 1;

export const TRACK_COLORS = [
  "#ff6b6b",
  "#ffc857",
  "#55e6a5",
  "#53d7ff",
  "#7f9cff",
  "#c28cff",
  "#ff79bd",
  "#d7f36b",
];

export const WAVEFORMS = ["sine", "triangle", "sawtooth", "square", "noise"];
export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const DEFAULT_SYNTH = Object.freeze({
  waveform: "sawtooth",
  transpose: 0,
  detune: 7,
  cutoff: 1600,
  resonance: 3.2,
  filterEnv: 1800,
  attack: 0.008,
  decay: 0.16,
  sustain: 0.58,
  release: 0.2,
  volume: 0.68,
  pan: 0,
});

const LIMITS = {
  bpm: [40, 240],
  transpose: [-24, 24],
  detune: [-50, 50],
  cutoff: [60, 16000],
  resonance: [0.4, 20],
  filterEnv: [0, 10000],
  attack: [0.001, 2],
  decay: [0.01, 3],
  sustain: [0, 1],
  release: [0.01, 4],
  volume: [0, 1],
  pan: [-1, 1],
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function midiToName(midi) {
  const note = Math.round(clamp(Number(midi) || 0, 0, 127));
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function nameToMidi(name) {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(String(name).trim());
  if (!match) return 60;
  const semitone = NOTE_NAMES.indexOf(`${match[1]}${match[2]}`);
  const octave = Number(match[3]);
  return clamp((octave + 1) * 12 + semitone, 0, 127);
}

export function makeStep(note = 60, on = false, sustain = 1) {
  const parsedNote = Number(note);
  return {
    on: Boolean(on),
    note: clamp(Math.round(Number.isFinite(parsedNote) ? parsedNote : 60), 0, 127),
    sustain: clamp(Math.round(Number(sustain) || 1), 1, 4),
  };
}

export function makeTrack(index, overrides = {}) {
  const synth = { ...DEFAULT_SYNTH, ...(overrides.synth || {}) };
  const steps = Array.from({ length: STEP_COUNT }, (_, stepIndex) => {
    const step = overrides.steps?.[stepIndex];
    return step ? makeStep(step.note, step.on, step.sustain) : makeStep(48);
  });
  return {
    id: overrides.id || `track-${index + 1}`,
    name: overrides.name || `TRACK ${String(index + 1).padStart(2, "0")}`,
    color: overrides.color || TRACK_COLORS[index % TRACK_COLORS.length],
    mute: Boolean(overrides.mute),
    synth,
    steps,
  };
}

export function createEmptyProject() {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: "UNTITLED PATTERN",
    bpm: 112,
    loop: true,
    resumeMode: "current",
    master: { gain: 0.78 },
    tracks: Array.from({ length: TRACK_COUNT }, (_, index) => makeTrack(index)),
  };
}

function normalizedSynth(synth = {}) {
  const result = { ...DEFAULT_SYNTH };
  if (WAVEFORMS.includes(synth.waveform)) result.waveform = synth.waveform;
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (!(key in result)) continue;
    const value = Number(synth[key]);
    if (Number.isFinite(value)) result[key] = clamp(value, min, max);
  }
  return result;
}

function normalizedStep(step, fallbackNote) {
  const source = step && typeof step === "object" ? step : {};
  const parsedNote = Number(source.note);
  const note =
    typeof source.note === "string"
      ? nameToMidi(source.note)
      : clamp(
          Math.round(Number.isFinite(parsedNote) ? parsedNote : fallbackNote),
          0,
          127,
        );
  return makeStep(note, source.on, source.sustain);
}

export function normalizeProject(input) {
  if (!input || typeof input !== "object") {
    throw new Error("工程文件不是有效的 JSON 对象");
  }
  const sourceTracks = Array.isArray(input.tracks) ? input.tracks : [];
  const base = createEmptyProject();
  const bpm = Number(input.bpm);
  const tracks = Array.from({ length: TRACK_COUNT }, (_, index) => {
    const source = sourceTracks[index] || {};
    const fallback = base.tracks[index];
    const synth = normalizedSynth({ ...fallback.synth, ...(source.synth || {}) });
    const steps = Array.from({ length: STEP_COUNT }, (_, stepIndex) =>
      normalizedStep(source.steps?.[stepIndex], synth.transpose + 48),
    );
    return {
      id: `track-${index + 1}`,
      name: String(source.name || fallback.name).slice(0, 28),
      color: /^#[0-9a-f]{6}$/i.test(source.color || "")
        ? source.color
        : TRACK_COLORS[index],
      mute: Boolean(source.mute),
      synth,
      steps,
    };
  });
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: String(input.name || base.name).slice(0, 48),
    bpm: Number.isFinite(bpm) ? clamp(Math.round(bpm), 40, 240) : base.bpm,
    loop: input.loop !== false,
    resumeMode: input.resumeMode === "start" ? "start" : "current",
    master: {
      gain: clamp(
        Number.isFinite(Number(input.master?.gain))
          ? Number(input.master.gain)
          : 0.78,
        0,
        1,
      ),
    },
    tracks,
  };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function makeExportProject(project) {
  return {
    ...cloneProject(project),
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
  };
}
