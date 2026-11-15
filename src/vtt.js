import { barDuration, songDuration } from "./model.js";

export function vttTimestamp(seconds) {
  const value = Math.max(0, seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const whole = Math.floor(value % 60);
  const millis = Math.round((value - Math.floor(value)) * 1000);
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
  );
}

// 每小节一个 cue，cue 内用逐字时间戳（<hh:mm:ss.mmm>字）保留逐字时间
export function buildWebVtt(song) {
  const lines = ["WEBVTT", ""];
  song.bars.forEach((bar, index) => {
    const first = bar.syllables[0];
    const last = bar.syllables.at(-1);
    const start = first.start;
    const end = index === song.bars.length - 1
      ? songDuration(song)
      : barDuration(song) * (index + 1);

    lines.push(`${vttTimestamp(start)} --> ${vttTimestamp(end)}`);
    const tagged = bar.syllables
      .map((syllable) => `<${vttTimestamp(syllable.start)}>${syllable.text}`)
      .join("");
    lines.push(tagged, "");
  });
  return lines.join("\n");
}
