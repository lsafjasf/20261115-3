// 纯 JS WAV 编码（16-bit PCM）与顺序拼接混音。

export function encodeWav(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = length * numCh * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

// 将多个 AudioBuffer 按顺序首尾相接为单声道混音
export function concatenateBuffers(ctx, buffers, gapSeconds = 0.15) {
  const sampleRate = buffers[0].sampleRate;
  const gap = Math.floor(gapSeconds * sampleRate);
  const total = buffers.reduce((sum, b) => sum + b.length + gap, 0);
  const out = ctx.createBuffer(1, total, sampleRate);
  const data = out.getChannelData(0);
  let offset = 0;
  for (const b of buffers) {
    data.set(b.getChannelData(0), offset);
    offset += b.length + gap;
  }
  return out;
}
