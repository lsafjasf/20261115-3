/*
 * compositor.js — deterministic pixel compositing core.
 * Pure math, no DOM/canvas: runs identically in browser and Node, so the
 * on-screen result and the exported PNG come from the same code path.
 *
 * Blending follows the W3C Compositing and Blending spec:
 *   ao = as + ab*(1-as)
 *   co = [as*(1-ab)*cs + as*ab*B(cs,cb) + (1-as)*ab*cb] / ao
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Compositor = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "add", "difference"];

  // Per-channel blend functions on 0..255 floats.
  const blendChannel = {
    normal: (s, b) => s,
    multiply: (s, b) => (s * b) / 255,
    screen: (s, b) => 255 - ((255 - s) * (255 - b)) / 255,
    overlay: (s, b) =>
      b <= 128 ? (2 * s * b) / 255 : 255 - (2 * (255 - s) * (255 - b)) / 255,
    add: (s, b) => Math.min(255, s + b),
    difference: (s, b) => Math.abs(s - b),
  };

  /**
   * Composite src over dst in place. Both Uint8ClampedArray RGBA.
   * opacity: 0..1 layer opacity multiplier.
   */
  function compositeOver(dst, src, mode, opacity) {
    const B = blendChannel[mode];
    if (!B) throw new Error("unknown blend mode: " + mode);
    for (let i = 0; i < dst.length; i += 4) {
      const as = (src[i + 3] / 255) * opacity;
      if (as <= 0) continue;
      const ab = dst[i + 3] / 255;
      const ao = as + ab * (1 - as);
      if (ao <= 0) {
        dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0;
        continue;
      }
      const srcTerm = as * (1 - ab);
      const blended = as * ab;
      const dstTerm = (1 - as) * ab;
      for (let c = 0; c < 3; c++) {
        const cs = src[i + c];
        const cb = dst[i + c];
        const co =
          (srcTerm * cs + blended * B(cs, cb) + dstTerm * cb) / ao;
        dst[i + c] = Math.round(co);
      }
      dst[i + 3] = Math.round(ao * 255);
    }
  }

  /**
   * Flatten a stack of layers (bottom first) into a fresh RGBA buffer.
   * layers: [{ pixels, mode, opacity, visible }]
   * Never mutates layer pixels: recomputing N times yields bit-identical
   * output, so repeated exports cannot accumulate color error.
   */
  function flatten(layers, pixelCount) {
    const out = new Uint8ClampedArray(pixelCount * 4);
    for (const layer of layers) {
      if (!layer || layer.visible === false) continue;
      if (layer.opacity <= 0) continue;
      compositeOver(out, layer.pixels, layer.mode || "normal", layer.opacity);
    }
    return out;
  }

  return { BLEND_MODES, compositeOver, flatten };
});
