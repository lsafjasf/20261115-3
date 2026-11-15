/*
 * png.js — minimal, dependency-free PNG encoder.
 * Uses zlib "stored" (uncompressed) deflate blocks, so encoding is fully
 * deterministic and involves no color management: the bytes you pass in
 * are exactly the bytes a decoder gets back. Same code runs in browser
 * and Node, guaranteeing export == screen pixel-for-pixel.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PNGEncoder = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++)
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function u32(v) {
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  }

  function chunk(type, data) {
    const typeBytes = Array.from(type, (ch) => ch.charCodeAt(0));
    const body = typeBytes.concat(data);
    return new Uint8Array(u32(data.length).concat(body, u32(crc32(Uint8Array.from(body)))));
  }

  // zlib stream made of stored deflate blocks (max 65535 per block).
  function zlibStore(raw) {
    const blocks = Math.max(1, Math.ceil(raw.length / 65535));
    const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    out[0] = 0x78; // CMF: deflate, 32K window
    out[1] = 0x01; // FLG: no preset dict, check bits valid for 0x7801
    let o = 2;
    for (let p = 0; p < raw.length || (p === 0 && raw.length === 0); ) {
      const n = Math.min(65535, raw.length - p);
      const last = p + n >= raw.length;
      out[o++] = last ? 1 : 0;
      out[o++] = n & 255;
      out[o++] = (n >> 8) & 255;
      out[o++] = ~n & 255;
      out[o++] = (~n >> 8) & 255;
      out.set(raw.subarray(p, p + n), o);
      o += n;
      p += n;
      if (raw.length === 0) break;
    }
    const adler = adler32(raw);
    out[o++] = (adler >>> 24) & 255;
    out[o++] = (adler >>> 16) & 255;
    out[o++] = (adler >>> 8) & 255;
    out[o++] = adler & 255;
    return out.subarray(0, o);
  }

  /**
   * Encode RGBA pixels (Uint8ClampedArray/Uint8Array, w*h*4) as PNG bytes.
   * Each scanline is prefixed with filter byte 0 (none).
   */
  function encodePNG(rgba, width, height) {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0;
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const ihdr = u32(width)
      .concat(u32(height))
      .concat([8, 6, 0, 0, 0]); // 8-bit RGBA
    const parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", Array.from(zlibStore(raw))),
      chunk("IEND", []),
    ];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const png = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      png.set(p, off);
      off += p.length;
    }
    return png;
  }

  return { encodePNG, crc32, adler32 };
});
