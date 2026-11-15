// test/softrender.js — minimal software rasterizer + PNG encoder (Node only).
// Renders the same depth-sorted faces the browser draws, so occlusion can be
// verified headlessly at the pixel level.
"use strict";
const zlib = require("zlib");

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

class Framebuffer {
  constructor(w, h, bg) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set(bg, i * 4);
  }
  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data.set(rgba, (y * this.w + x) * 4);
  }
  get(x, y) {
    return Array.from(this.data.slice((y * this.w + x) * 4, (y * this.w + x) * 4 + 4));
  }
  fillPoly(pts, rgb) {
    const ys = pts.map((p) => p[1]);
    const yMin = Math.max(0, Math.floor(Math.min(...ys)));
    const yMax = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = yMin; y <= yMax; y++) {
      const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) this.set(x, y, rgb);
      }
    }
  }
}

// faces: output of IsoCity.projectCity; cx/cy center the scene.
function renderFaces(faces, w, h, cx, cy, bg) {
  const fb = new Framebuffer(w, h, bg || [20, 24, 31, 255]);
  for (const f of faces) {
    const pts = f.pts.map(([x, y]) => [x + cx, y + cy]);
    fb.fillPoly(pts, hslToRgb(f.color.h, f.color.s, f.color.l));
  }
  return fb;
}

// --- PNG encoding (truecolor RGBA, no filter) ------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(fb) {
  const raw = Buffer.alloc(fb.h * (1 + fb.w * 4));
  for (let y = 0; y < fb.h; y++) {
    raw[y * (1 + fb.w * 4)] = 0;
    Buffer.from(fb.data.buffer, y * fb.w * 4, fb.w * 4).copy(raw, y * (1 + fb.w * 4) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(fb.w, 0);
  ihdr.writeUInt32BE(fb.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { Framebuffer, renderFaces, encodePng, hslToRgb };
