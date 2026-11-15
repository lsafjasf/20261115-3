'use strict';

// Minimal mono PCM16 WAV reader/writer. Uses only DataView/Uint8Array
// so the identical code runs in Node and in the browser.

const HAS_BUFFER = typeof Buffer !== 'undefined';

function allocBytes(size) {
  if (HAS_BUFFER) return Buffer.alloc(size);
  return new Uint8Array(size);
}

function asUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function readAscii(view, offset, length) {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function writeWav(samples, sampleRate = 48000) {
  const frameCount = samples.length;
  const dataBytes = frameCount * 2;
  const bytes = allocBytes(44 + dataBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < frameCount; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clipped * 32767), true);
  }
  return bytes;
}

function readWav(input) {
  const bytes = asUint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' ||
      readAscii(view, 8, 12 - 8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error('WAV missing fmt/data');
  if (fmt.audioFormat !== 1 || fmt.channels !== 1 ||
      fmt.bitsPerSample !== 16) {
    throw new Error('only mono PCM16 WAV is supported');
  }
  const frameCount = Math.floor(dataLength / 2);
  const samples = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }
  return { sampleRate: fmt.sampleRate, samples };
}

// Delay (positive) or advance (negative) a signal by sampleCount
// samples, padding with silence and preserving total length.
function shiftSamples(samples, sampleCount) {
  const out = new Float64Array(samples.length);
  if (sampleCount >= 0) {
    out.set(
      samples.subarray(0, Math.max(0, samples.length - sampleCount)),
      sampleCount
    );
  } else {
    out.set(samples.subarray(-sampleCount));
  }
  return out;
}

module.exports = { writeWav, readWav, shiftSamples };
