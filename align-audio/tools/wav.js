'use strict';

function writeWav(path, channelData, sampleRate) {
  const fs = require('fs');
  const numChannels = channelData.length;
  const numFrames = channelData[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let s = Math.max(-1, Math.min(1, channelData[ch][i]));
      buf.writeInt16LE(Math.round(s * 32767), off);
      off += 2;
    }
  }
  fs.writeFileSync(path, buf);
  return buf.length;
}

function readWav(path) {
  const fs = require('fs');
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file: ' + path);
  }
  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error('only PCM16 WAV is supported');
  }
  const frameCount = Math.floor(dataSize / (fmt.numChannels * 2));
  const channels = Array.from({ length: fmt.numChannels }, () => new Float64Array(frameCount));
  let off = dataOffset;
  for (let i = 0; i < frameCount; i++) {
    for (let ch = 0; ch < fmt.numChannels; ch++) {
      channels[ch][i] = buf.readInt16LE(off) / 32768;
      off += 2;
    }
  }
  return { sampleRate: fmt.sampleRate, channels, frameCount };
}

module.exports = { writeWav, readWav };
