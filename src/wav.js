function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function encodeWav(left, right, sampleRate) {
  const frames = Math.min(left.length, right.length);
  const bytesPerSample = 2;
  const channelCount = 2;
  const dataSize = frames * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const leftSample = Math.max(-1, Math.min(1, left[frame]));
    const rightSample = Math.max(-1, Math.min(1, right[frame]));
    view.setInt16(offset, leftSample < 0 ? leftSample * 32768 : leftSample * 32767, true);
    view.setInt16(offset + 2, rightSample < 0 ? rightSample * 32768 : rightSample * 32767, true);
    offset += 4;
  }
  return new Uint8Array(buffer);
}

export function wavBlob(left, right, sampleRate) {
  return new Blob([encodeWav(left, right, sampleRate)], { type: "audio/wav" });
}
