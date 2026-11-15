import { buildWebVtt } from "./vtt.js";
import { encodeWav } from "./wav.js";
import { renderAccompaniment } from "./synth.js";

export function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportVtt(song) {
  downloadBlob(buildWebVtt(song), "lyrics.vtt", "text/vtt;charset=utf-8");
}

// 导出的 WAV 与播放引擎同源：都调用 renderAccompaniment
export function exportWav(song) {
  const pcm = renderAccompaniment(song);
  const wav = encodeWav(pcm);
  downloadBlob(new Blob([wav], { type: "audio/wav" }), "accompaniment.wav", "audio/wav");
}
