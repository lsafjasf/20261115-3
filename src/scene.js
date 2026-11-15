export const SOURCE_DURATION = 30;
export const SOURCE_WIDTH = 1280;
export const SOURCE_HEIGHT = 720;
export const MIN_CLIP_DURATION = 1.5;

export const TRANSITIONS = {
  crossfade: { label: "交叉淡化", short: "XF", overlap: 0.7 },
  wipe: { label: "横向擦除", short: "WP", overlap: 0.7 },
  slide: { label: "滑动推入", short: "SL", overlap: 0.7 },
  cut: { label: "硬切", short: "CT", overlap: 0 },
};

export const PALETTES = [
  { a: "#071518", b: "#0a2d31", glow: "#5be7d2", accent: "#d9ff43", warm: "#7ea8ff" },
  { a: "#100d20", b: "#32152d", glow: "#ff7d9d", accent: "#ffd58a", warm: "#a66dff" },
  { a: "#111607", b: "#27320b", glow: "#d9ff43", accent: "#ff9b54", warm: "#63d9b2" },
];

export const SOURCE_CUES = [
  { start: 0.9, end: 3.8, text: "三十秒，从一束光开始" },
  { start: 4.6, end: 8.2, text: "城市醒来，节拍进入镜头" },
  { start: 10.1, end: 13.6, text: "每一次裁切都保留声音" },
  { start: 14.8, end: 18.6, text: "字幕跟着画面一起移动" },
  { start: 20.0, end: 23.2, text: "黑帧检查，守住最后一关" },
  { start: 24.1, end: 27.0, text: "把两段故事，接成一条时间线" },
  { start: 27.8, end: 29.6, text: "导出 WebM，重新播放" },
];

export const DEFAULT_CLIPS = [
  {
    id: "clip-a",
    name: "城市醒来",
    inPoint: 2.4,
    outPoint: 6.2,
    transition: "crossfade",
  },
  {
    id: "clip-b",
    name: "节拍推进",
    inPoint: 10.6,
    outPoint: 14.2,
    transition: "wipe",
  },
  {
    id: "clip-c",
    name: "字幕落点",
    inPoint: 20.8,
    outPoint: 24.6,
    transition: "slide",
  },
];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clipDuration(clip) {
  return Math.max(0, clip.outPoint - clip.inPoint);
}

export function transitionOverlap(type, previousClip) {
  if (!previousClip) return 0;
  return TRANSITIONS[type]?.overlap ?? 0;
}

export function buildSequence(clips) {
  const items = clips.map((clip, index) => {
    const duration = clipDuration(clip);
    const transition = index === 0 ? "cut" : clip.transition;
    const overlap = transitionOverlap(transition, index > 0);
    return { ...clip, index, duration, transition, overlap };
  });

  let cursor = 0;
  let previousEnd = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const overlap = index === 0 ? 0 : Math.min(item.overlap, previousEnd, item.duration - 0.5);
    const start = index === 0 ? 0 : Math.max(0, previousEnd - Math.max(0, overlap));
    item.start = start;
    item.end = start + item.duration;
    item.overlap = index === 0 ? 0 : Math.max(0, overlap);
    previousEnd = item.end;
    cursor = item.end;
  }

  return { clips: items, total: cursor };
}

export function activeClipsAt(sequence, outputTime) {
  return sequence.clips.filter(
    (clip) => outputTime >= clip.start - 1e-5 && outputTime < clip.end - 1e-5,
  );
}

export function sourceTimeAt(clip, outputTime) {
  return clip.inPoint + clamp(outputTime - clip.start, 0, clip.duration);
}

export function primaryClipAt(sequence, outputTime) {
  const active = activeClipsAt(sequence, outputTime);
  return active.length ? active[active.length - 1] : sequence.clips[0] || null;
}

export function cueAtSourceTime(sourceTime) {
  return SOURCE_CUES.find((cue) => sourceTime >= cue.start && sourceTime <= cue.end) || null;
}

export function cueAtOutputTime(sequence, outputTime) {
  const clip = primaryClipAt(sequence, outputTime);
  if (!clip) return null;
  return cueAtSourceTime(sourceTimeAt(clip, outputTime));
}

export function sequenceCaptionSegments(sequence) {
  const segments = [];
  for (const clip of sequence.clips) {
    for (const cue of SOURCE_CUES) {
      const cueStart = Math.max(clip.inPoint, cue.start);
      const cueEnd = Math.min(clip.outPoint, cue.end);
      if (cueEnd - cueStart < 0.1) continue;
      segments.push({
        start: clip.start + (cueStart - clip.inPoint),
        end: clip.start + (cueEnd - clip.inPoint),
        text: cue.text,
        clipId: clip.id,
      });
    }
  }
  return segments;
}

export function transitionProgress(sequence, outputTime) {
  const active = activeClipsAt(sequence, outputTime);
  if (active.length < 2) {
    return { incoming: active[0] || sequence.clips[0], outgoing: null, progress: 0, type: "cut" };
  }
  const incoming = active[active.length - 1];
  const outgoing = active[active.length - 2];
  const span = Math.max(0.001, incoming.overlap);
  return {
    incoming,
    outgoing,
    progress: clamp((outputTime - incoming.start) / span, 0, 1),
    type: incoming.transition,
  };
}

export function formatClock(seconds, withFrames = false) {
  const safe = Math.max(0, seconds);
  const totalHundredths = Math.round(safe * 100);
  const minutes = Math.floor(totalHundredths / 6000);
  const secs = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  if (withFrames) {
    const frames = Math.floor((safe + 1e-7) * 30) % 30;
    return `00:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function hash(value) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function mixChannel(a, b, amount) {
  return Math.round(a + (b - a) * amount);
}

export function mixHex(a, b, amount) {
  const parse = (hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const ca = parse(a);
  const cb = parse(b);
  const channels = [
    mixChannel(ca[0], cb[0], amount),
    mixChannel(ca[1], cb[1], amount),
    mixChannel(ca[2], cb[2], amount),
  ];
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
