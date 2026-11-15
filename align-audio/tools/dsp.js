'use strict';

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * curR - im[b] * curI;
        const xi = re[b] * curI + im[b] * curR;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nr;
      }
    }
  }
}

function ifft(re, im) {
  for (let i = 0; i < re.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function fullCrossCorrelation(a, b) {
  const n = a.length + b.length - 1;
  const N = nextPow2(Math.max(a.length, b.length)) * 2;
  const ar = new Float64Array(N), ai = new Float64Array(N);
  const br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  const cr = new Float64Array(N), ci = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    // conj(A) * B. IFFT bin m holds r(m - (nb - 1)), where
    // r(lag) = sum_i a[i + lag] * b[i]; lag > 0 means B is delayed.
    const conjAr = ar[k];
    const conjAi = -ai[k];
    cr[k] = conjAr * br[k] - conjAi * bi[k];
    ci[k] = conjAr * bi[k] + conjAi * br[k];
  }
  ifft(cr, ci);
  const out = new Float64Array(n);
  for (let lag = -(b.length - 1); lag <= a.length - 1; lag++) {
    const bin = (((-lag) % N) + N) % N;
    out[lag + (b.length - 1)] = cr[bin];
  }
  return out;
}

function overlapRegion(a, b, lag) {
  let a0, b0, len;
  if (lag >= 0) {
    a0 = 0;
    b0 = lag;
    len = Math.min(a.length, b.length - lag);
  } else {
    a0 = -lag;
    b0 = 0;
    len = Math.min(a.length + lag, b.length);
  }
  return { a0, b0, len };
}

function pearsonCorrelation(a, b, lag) {
  const { a0, b0, len } = overlapRegion(a, b, lag);
  if (len < 16) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < len; i++) { sa += a[a0 + i]; sb += b[b0 + i]; }
  const ma = sa / len, mb = sb / len;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < len; i++) {
    const x = a[a0 + i] - ma, y = b[b0 + i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

function findBestLag(a, b, maxLag) {
  const raw = fullCrossCorrelation(a, b);
  const sumA = new Float64Array(a.length + 1);
  const sumB = new Float64Array(b.length + 1);
  const sqA = new Float64Array(a.length + 1);
  const sqB = new Float64Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    sumA[i + 1] = sumA[i] + a[i];
    sqA[i + 1] = sqA[i] + a[i] * a[i];
  }
  for (let i = 0; i < b.length; i++) {
    sumB[i + 1] = sumB[i] + b[i];
    sqB[i + 1] = sqB[i] + b[i] * b[i];
  }
  let bestLag = 0;
  let bestNorm = -Infinity;
  let bestPolarity = 1;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const { a0, b0, len } = overlapRegion(a, b, lag);
    if (len < 16) continue;
    const ma = (sumA[a0 + len] - sumA[a0]) / len;
    const mb = (sumB[b0 + len] - sumB[b0]) / len;
    const va = sqA[a0 + len] - sqA[a0] - len * ma * ma;
    const vb = sqB[b0 + len] - sqB[b0] - len * mb * mb;
    const cross = raw[(b.length - 1) - lag] - len * ma * mb;
    const p = Math.max(-1, Math.min(1, cross / Math.sqrt(Math.max(va * vb, 1e-20))));
    if (Math.abs(p) > bestNorm) {
      bestNorm = Math.abs(p);
      bestLag = lag;
      bestPolarity = p < 0 ? -1 : 1;
    }
  }
  return { bestLag, polarity: bestPolarity, correlation: bestNorm * bestPolarity };
}

function alignSignals(a, b, lag, polarity) {
  const scale = polarity === -1 ? -1 : 1;
  const { a0, b0, len } = overlapRegion(a, b, lag);
  const aa = new Float64Array(len), bb = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    aa[i] = a[a0 + i];
    bb[i] = b[b0 + i] * scale;
  }
  return { a: aa, b: bb, len };
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > p) p = v;
  }
  return p;
}

function rmsOf(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function evaluate(a, b, lag, polarity) {
  const { a: aa, b: bb, len } = alignSignals(a, b, lag, polarity);
  const corr = pearsonCorrelation(a, b, lag) * (polarity === -1 ? -1 : 1);
  const sum = new Float64Array(len);
  const diff = new Float64Array(len);
  for (let i = 0; i < len; i++) { sum[i] = aa[i] + bb[i]; diff[i] = aa[i] - bb[i]; }
  const rmsA = rmsOf(aa);
  const cancelDepthDb = 20 * Math.log10((rmsA + 1e-12) / (rmsOf(diff) + 1e-12));
  return {
    lag,
    polarity,
    overlapFrames: len,
    correlation: corr,
    peakA: peakOf(aa),
    peakB: peakOf(bb),
    peakSum: peakOf(sum),
    peakDiff: peakOf(diff),
    rmsA,
    rmsDiff: rmsOf(diff),
    cancelDepthDb,
  };
}

module.exports = {
  nextPow2, fft, ifft, fullCrossCorrelation, pearsonCorrelation,
  findBestLag, alignSignals, evaluate, peakOf, rmsOf,
};
