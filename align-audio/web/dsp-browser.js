'use strict';

window.AlignDSP = (() => {
  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

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
          const u = i + k, v = i + k + len / 2;
          const xr = re[v] * curR - im[v] * curI;
          const xi = re[v] * curI + im[v] * curR;
          re[v] = re[u] - xr; im[v] = im[u] - xi;
          re[u] += xr; im[u] += xi;
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
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
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
      const cAr = ar[k], cAi = -ai[k];
      cr[k] = cAr * br[k] - cAi * bi[k];
      ci[k] = cAr * bi[k] + cAi * br[k];
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
    if (lag >= 0) { a0 = 0; b0 = lag; len = Math.min(a.length, b.length - lag); }
    else { a0 = -lag; b0 = 0; len = Math.min(a.length + lag, b.length); }
    return { a0, b0, len };
  }

  return { nextPow2, fft, ifft, fullCrossCorrelation, overlapRegion };
})();
