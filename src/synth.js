import { BEATS_PER_BAR, beatDuration, flattenSyllables, songDuration } from "./model.js";

export const SAMPLE_RATE = 44100;

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

// 确定性随机数（mulberry32），保证同一歌曲每次渲染、播放与导出逐样本一致
function createRng(seed = 20261115) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 和弦进行：C - G - Am - F，每小节换一次，八小节循环两遍
const CHORDS = [
  { root: 48, tones: [60, 64, 67] },
  { root: 43, tones: [59, 62, 67] },
  { root: 45, tones: [57, 60, 64] },
  { root: 41, tones: [53, 57, 60] },
];

function addTone(buffer, startSample, lengthSamples, freq, gain, type, decay = 1) {
  const end = Math.min(buffer.length, startSample + lengthSamples);
  for (let i = startSample; i < end; i += 1) {
    const t = (i - startSample) / SAMPLE_RATE;
    const phase = (i - startSample) / lengthSamples;
    let sample = 0;
    if (type === "sine") sample = Math.sin(2 * Math.PI * freq * t);
    if (type === "tri") sample = 2 * Math.abs(2 * ((freq * t) % 1) - 1) - 1;
    if (type === "square") sample = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.6;
    const envelope = Math.exp(-3 * phase * decay) * (1 - phase * 0.4);
    buffer[i] += sample * envelope * gain;
  }
}

function addKick(buffer, startSample) {
  const length = Math.floor(SAMPLE_RATE * 0.18);
  for (let i = 0; i < length && startSample + i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const freq = 120 * Math.exp(-t * 28) + 45;
    buffer[startSample + i] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 14) * 0.9;
  }
}

function addSnare(buffer, startSample, rng) {
  const length = Math.floor(SAMPLE_RATE * 0.14);
  for (let i = 0; i < length && startSample + i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const noise = (rng() * 2 - 1) * 0.5;
    const tone = Math.sin(2 * Math.PI * 190 * t) * 0.5;
    buffer[startSample + i] += (noise + tone) * Math.exp(-t * 22) * 0.5;
  }
}

function addHat(buffer, startSample, rng) {
  const length = Math.floor(SAMPLE_RATE * 0.05);
  for (let i = 0; i < length && startSample + i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    buffer[startSample + i] += (rng() * 2 - 1) * Math.exp(-t * 60) * 0.22;
  }
}

// 纯函数：把歌曲模型渲染成单声道 Float32 PCM
export function renderAccompaniment(song) {
  const duration = songDuration(song);
  const buffer = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  const beat = beatDuration(song);
  const syllables = flattenSyllables(song);
  const rng = createRng();

  song.bars.forEach((bar, barIndex) => {
    const barStart = barIndex * beat * BEATS_PER_BAR;
    const chord = CHORDS[barIndex % CHORDS.length];

    // 垫音：整小节持续的柔和三和弦
    for (const tone of chord.tones) {
      addTone(
        buffer,
        Math.floor(barStart * SAMPLE_RATE),
        Math.floor(beat * BEATS_PER_BAR * SAMPLE_RATE),
        midiToFreq(tone),
        0.05,
        "sine",
        0.25,
      );
    }

    for (let beatInBar = 0; beatInBar < BEATS_PER_BAR; beatInBar += 1) {
      const time = barStart + beatInBar * beat;
      const sample = Math.floor(time * SAMPLE_RATE);

      // 鼓组
      if (beatInBar === 0 || beatInBar === 2) addKick(buffer, sample);
      if (beatInBar === 1 || beatInBar === 3) addSnare(buffer, sample, rng);
      addHat(buffer, sample, rng);
      addHat(buffer, Math.floor((time + beat / 2) * SAMPLE_RATE), rng);

      // 贝斯：每拍一个根音
      addTone(buffer, sample, Math.floor(beat * SAMPLE_RATE), midiToFreq(chord.root), 0.16, "tri", 1.4);

      // 主奏：把旋律以轻柔弹拨音色带出，方便跟唱
      const syllable = syllables[barIndex * BEATS_PER_BAR + beatInBar];
      if (syllable) {
        addTone(
          buffer,
          Math.floor(syllable.start * SAMPLE_RATE),
          Math.floor(syllable.duration * SAMPLE_RATE),
          midiToFreq(syllable.midi),
          0.14,
          "square",
          1.1,
        );
      }
    }
  });

  // 限幅保护，避免叠加削波
  let peak = 0;
  for (const value of buffer) peak = Math.max(peak, Math.abs(value));
  if (peak > 0.95) {
    const scale = 0.95 / peak;
    for (let i = 0; i < buffer.length; i += 1) buffer[i] *= scale;
  }
  return buffer;
}
