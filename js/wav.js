// 最小化 PCM WAV 编码器：支持任意声道数（2 声道立体声 / 4 声道环绕）

function interleave(channels) {
  const frames = channels[0].length;
  const out = new Float32Array(frames * channels.length);
  for (let f = 0; f < frames; f++) {
    for (let ch = 0; ch < channels.length; ch++) {
      out[f * channels.length + ch] = channels[ch][f];
    }
  }
  return out;
}

function floatToPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

export function encodeWav(channels, sampleRate) {
  const channelCount = channels.length;
  const frames = channels[0].length;
  const data = floatToPcm16(interleave(channels));
  const bytesPerSample = 2;
  const dataSize = data.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    view.setInt16(offset, data[i], true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function wavMime() {
  return 'audio/wav';
}
