/* Minimal 16-bit PCM mono WAV encoder/decoder. UMD-style. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioWav = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function encodeWav(samples, sampleRate) {
    var dataBytes = samples.length * 2;
    var buffer = new ArrayBuffer(44 + dataBytes);
    var view = new DataView(buffer);
    var p = 0;
    function ascii(str) {
      for (var i = 0; i < str.length; i++) view.setUint8(p++, str.charCodeAt(i));
    }
    function u32(v) { view.setUint32(p, v, true); p += 4; }
    function u16(v) { view.setUint16(p, v, true); p += 2; }

    ascii('RIFF');
    u32(36 + dataBytes);
    ascii('WAVE');
    ascii('fmt ');
    u32(16);
    u16(1);
    u16(1);
    u32(sampleRate);
    u32(sampleRate * 2);
    u16(2);
    u16(16);
    ascii('data');
    u32(dataBytes);
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
    return buffer;
  }

  function decodeWav(buffer) {
    var view = new DataView(buffer);
    if (view.getUint32(0, false) !== 0x52494646 ||
        view.getUint32(8, false) !== 0x57415645) {
      throw new Error('Not a RIFF/WAVE file');
    }
    var offset = 12;
    var sampleRate = 0, dataBytes = 0, dataOffset = 0;
    while (offset + 8 <= view.buffer.byteLength) {
      var id = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3));
      var size = view.getUint32(offset + 4, true);
      if (id === 'fmt ') {
        sampleRate = view.getUint32(offset + 12, true);
      } else if (id === 'data') {
        dataBytes = size;
        dataOffset = offset + 8;
        break;
      }
      offset += 8 + size + (size % 2);
    }
    var frameCount = Math.floor(dataBytes / 2);
    var samples = new Float32Array(frameCount);
    for (var i = 0; i < frameCount; i++) {
      samples[i] = view.getInt16(dataOffset + i * 2, true) / 0x8000;
    }
    return { samples: samples, sampleRate: sampleRate };
  }

  return { encodeWav: encodeWav, decodeWav: decodeWav };
});
