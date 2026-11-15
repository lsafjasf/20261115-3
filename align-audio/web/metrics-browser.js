'use strict';

window.AlignMetrics = (() => {
  const D = window.AlignDSP;

  function pearson(a, b, lag) {
    const { a0, b0, len } = D.overlapRegion(a, b, lag);
    if (len < 16) return 0;
    let sa = 0, sb = 0;
    for (let i = 0; i < len; i++) { sa += a[a0 + i]; sb += b[b0 + i]; }
    const ma = sa / len, mb = sb / len;
    let num = 0, va = 0, vb = 0;
    for (let i = 0; i < len; i++) {
      const x = a[a0 + i] - ma, y = b[b0 + i] - mb;
      num += x * y; va += x * x; vb += y * y;
    }
    const den = Math.sqrt(Math.max(va * vb, 1e-20));
    return Math.max(-1, Math.min(1, num / den));
  }

  function findBestLag(a, b, maxLag) {
    const raw = D.fullCrossCorrelation(a, b);
    const sumA = new Float64Array(a.length + 1), sumB = new Float64Array(b.length + 1);
    const sqA = new Float64Array(a.length + 1), sqB = new Float64Array(b.length + 1);
    for (let i = 0; i < a.length; i++) { sumA[i + 1] = sumA[i] + a[i]; sqA[i + 1] = sqA[i] + a[i] * a[i]; }
    for (let i = 0; i < b.length; i++) { sumB[i + 1] = sumB[i] + b[i]; sqB[i + 1] = sqB[i] + b[i] * b[i]; }
    let bestLag = 0, bestNorm = -Infinity, bestPol = 1;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const { a0, b0, len } = D.overlapRegion(a, b, lag);
      if (len < 16) continue;
      const ma = (sumA[a0 + len] - sumA[a0]) / len;
      const mb = (sumB[b0 + len] - sumB[b0]) / len;
      const va = sqA[a0 + len] - sqA[a0] - len * ma * ma;
      const vb = sqB[b0 + len] - sqB[b0] - len * mb * mb;
      const cross = raw[(b.length - 1) - lag] - len * ma * mb;
      const p = Math.max(-1, Math.min(1, cross / Math.sqrt(Math.max(va * vb, 1e-20))));
      if (Math.abs(p) > bestNorm) { bestNorm = Math.abs(p); bestLag = lag; bestPol = p < 0 ? -1 : 1; }
    }
    return { bestLag, polarity: bestPol, correlation: bestNorm * bestPol };
  }

  function align(a, b, lag, polarity) {
    const { a0, b0, len } = D.overlapRegion(a, b, lag);
    const aa = new Float64Array(len), bb = new Float64Array(len);
    const s = polarity === -1 ? -1 : 1;
    for (let i = 0; i < len; i++) { aa[i] = a[a0 + i]; bb[i] = b[b0 + i] * s; }
    return { a: aa, b: bb, len };
  }

  function peak(x) { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; }
  function rms(x) { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); }

  function evaluate(a, b, lag, polarity) {
    const { a: aa, b: bb, len } = align(a, b, lag, polarity);
    const corr = pearson(a, b, lag) * (polarity === -1 ? -1 : 1);
    const sum = new Float64Array(len), diff = new Float64Array(len);
    for (let i = 0; i < len; i++) { sum[i] = aa[i] + bb[i]; diff[i] = aa[i] - bb[i]; }
    const rmsA = rms(aa);
    return {
      lag, polarity, overlapFrames: len, correlation: corr,
      peakA: peak(aa), peakB: peak(bb), peakSum: peak(sum), peakDiff: peak(diff),
      rmsA, rmsDiff: rms(diff),
      cancelDepthDb: 20 * Math.log10((rmsA + 1e-12) / (rms(diff) + 1e-12)),
    };
  }

  function encodeWav(channels, sampleRate) {
    const numCh = channels.length, frames = channels[0].length;
    const dataSize = frames * numCh * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(buf);
    const ws = (off, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, numCh, true); dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * numCh * 2, true);
    dv.setUint16(32, numCh * 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < frames; i++) for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      dv.setInt16(off, Math.round(s * 32767), true); off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function decodeWav(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const rd = off => String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
    if (rd(0) !== 'RIFF' || rd(8) !== 'WAVE') throw new Error('不是 WAV 文件');
    let pos = 12, fmt = null, dataOff = -1, dataSize = 0;
    while (pos + 8 <= arrayBuffer.byteLength) {
      const id = rd(pos), size = dv.getUint32(pos + 4, true), body = pos + 8;
      if (id === 'fmt ') fmt = { ch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      else if (id === 'data') { dataOff = body; dataSize = size; }
      pos = body + size + (size % 2);
    }
    if (!fmt || fmt.bits !== 16) throw new Error('仅支持 16-bit PCM WAV');
    const frames = Math.floor(dataSize / (fmt.ch * 2));
    const channels = Array.from({ length: fmt.ch }, () => new Float64Array(frames));
    let off = dataOff;
    for (let i = 0; i < frames; i++) for (let ch = 0; ch < fmt.ch; ch++) {
      channels[ch][i] = dv.getInt16(off, true) / 32768; off += 2;
    }
    return { sampleRate: fmt.sr, channels, frameCount: frames };
  }

  return { pearson, findBestLag, align, evaluate, encodeWav, decodeWav, peak, rms };
})();
