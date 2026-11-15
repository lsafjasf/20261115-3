// 歌曲数据模型：八小节、4/4 拍，每拍一个唱词（字）

export const BEATS_PER_BAR = 4;
export const BAR_COUNT = 8;

const LYRIC_LINES = [
  "晨风吹过",
  "阳光洒落",
  "山川回响",
  "心中的歌",
  "脚步不停",
  "梦想在握",
  "星光引路",
  "未来你我",
];

// 每小节四个音的 MIDI 音高，C 大调
const MELODY = [
  [60, 62, 64, 67],
  [64, 62, 60, 62],
  [64, 67, 64, 62],
  [60, 62, 64, 60],
  [69, 67, 64, 62],
  [60, 64, 67, 72],
  [69, 67, 64, 67],
  [65, 64, 62, 60],
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToNoteName(midi) {
  const value = Math.round(Number(midi));
  return `${NOTE_NAMES[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
}

export function noteNameToMidi(name) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(String(name).trim().toUpperCase());
  if (!match) return null;
  const semitone = NOTE_NAMES.indexOf(match[1]);
  const octave = Number(match[2]);
  return (octave + 1) * 12 + semitone;
}

export function beatDuration(song) {
  return 60 / song.bpm;
}

export function barDuration(song) {
  return beatDuration(song) * BEATS_PER_BAR;
}

export function createSong(bpm = 100) {
  const beat = 60 / bpm;
  const bars = LYRIC_LINES.map((line, barIndex) => ({
    id: `bar-${barIndex + 1}`,
    syllables: Array.from(line, (text, beatIndex) => ({
      id: `b${barIndex + 1}-${beatIndex + 1}`,
      text,
      start: (barIndex * BEATS_PER_BAR + beatIndex) * beat,
      duration: beat,
      midi: MELODY[barIndex][beatIndex],
    })),
  }));
  return { bpm, bars };
}

export function flattenSyllables(song) {
  return song.bars.flatMap((bar) => bar.syllables);
}

export function songDuration(song) {
  const last = flattenSyllables(song).at(-1);
  return last.start + last.duration;
}
