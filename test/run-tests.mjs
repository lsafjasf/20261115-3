/*
 * Verification suite (Node):
 *  1. Composite a real 5-layer scene (background/frost/stain/highlight).
 *  2. Validate multiply & screen blend math against an independent
 *     reference implementation, per pixel.
 *  3. Encode PNG, decode it back with an independent decoder, and
 *     require pixel-exact equality with the compositor output
 *     (export == screen, since both use the same buffer).
 *  4. Export repeatedly: bytes must be identical — no accumulated error.
 *  5. Reordering layers changes the result; reordering back restores it
 *     bit-for-bit.
 */
import { createRequire } from "node:module";
import zlib from "node:zlib";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const Compositor = require("../src/compositor.js");
const PNGEncoder = require("../src/png.js");
const LayerFactory = require("../src/layers.js");

const W = 128;
const H = 96;

// ---- minimal independent PNG decoder (RGBA8, filter 0) ---------------
function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) assert.equal(buf[i], sig[i], "bad PNG signature");
  let pos = 8;
  let width, height;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const crc = buf.readUInt32BE(pos + 8 + len);
    assert.equal(
      PNGEncoder.crc32(Uint8Array.from(buf.subarray(pos + 4, pos + 8 + len))),
      crc,
      `CRC mismatch in ${type}`
    );
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "bit depth must be 8");
      assert.equal(data[9], 6, "color type must be RGBA");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, "expected filter 0");
    for (let x = 0; x < stride; x++) out[y * stride + x] = raw[y * (stride + 1) + 1 + x];
  }
  return { pixels: out, width, height };
}

// ---- independent reference compositor (straight from the spec) -------
function refBlendChannel(mode, s, b) {
  switch (mode) {
    case "multiply": return (s * b) / 255;
    case "screen": return 255 - ((255 - s) * (255 - b)) / 255;
    default: throw new Error("mode not covered: " + mode);
  }
}
function refCompositePixel(dst, src, i, mode, opacity) {
  const as = (src[i + 3] / 255) * opacity;
  const ab = dst[i + 3] / 255;
  const ao = as + ab * (1 - as);
  if (ao === 0) return [0, 0, 0, 0];
  const out = [0, 0, 0, Math.round(ao * 255)];
  for (let c = 0; c < 3; c++) {
    const cs = src[i + c];
    const cb = dst[i + c];
    const B = refBlendChannel(mode, cs, cb);
    out[c] = Math.round(
      (as * (1 - ab) * cs + as * ab * B + (1 - as) * ab * cb) / ao
    );
  }
  return out;
}

// ---- build the 5-layer test scene ------------------------------------
function buildScene() {
  return [
    { type: "background", params: {}, mode: "normal", opacity: 1, visible: true },
    { type: "stain", params: { seed: 9, count: 4 }, mode: "multiply", opacity: 0.6, visible: true },
    { type: "frost", params: { seed: 42 }, mode: "normal", opacity: 0.7, visible: true },
    { type: "stain", params: { seed: 77, count: 5 }, mode: "multiply", opacity: 0.9, visible: true },
    { type: "highlight", params: { seed: 101 }, mode: "screen", opacity: 0.8, visible: true },
  ].map((l) => ({ ...l, pixels: LayerFactory.generate(l.type, W, H, l.params) }));
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

function assertPixelsEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, label + ": 长度不一致");
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      const px = Math.floor(i / 4);
      assert.fail(
        `${label}: 第 ${px} 个像素通道 ${i % 4} 不一致 ` +
          `(实际 ${actual[i]} ≠ 期望 ${expected[i]})`
      );
    }
  }
}

console.log("多层贴图合成器验证测试\n");

// 1. Five-layer composite with multiply + screen modes -----------------
const layers = buildScene();
const flat = Compositor.flatten(layers, W * H);
test("五层合成产生完整 RGBA 缓冲", () => {
  assert.equal(flat.length, W * H * 4);
  // bottom layer is an opaque background => result must be fully opaque
  for (let i = 3; i < flat.length; i += 4) assert.equal(flat[i], 255);
});

// 2. Blend-mode math vs independent reference --------------------------
for (const mode of ["multiply", "screen"]) {
  test(`混合模式 ${mode} 逐像素符合参考公式`, () => {
    const a = LayerFactory.generate("background", W, H, {});
    const b = LayerFactory.generate(mode === "multiply" ? "stain" : "highlight", W, H, { seed: 5 });
    const acc = a.slice();
    Compositor.compositeOver(acc, b, mode, 0.75);
    const ref = a.slice();
    for (let i = 0; i < ref.length; i += 4) {
      const px = refCompositePixel(ref, b, i, mode, 0.75);
      for (let c = 0; c < 4; c++) ref[i + c] = px[c];
    }
    assertPixelsEqual(acc, ref, mode);
  });
}

// 3. PNG round-trip: exported bytes decode to the exact screen pixels --
test("导出 PNG 与合成结果逐像素一致", () => {
  const png = PNGEncoder.encodePNG(flat, W, H);
  const decoded = decodePNG(Buffer.from(png));
  assert.equal(decoded.width, W);
  assert.equal(decoded.height, H);
  assertPixelsEqual(decoded.pixels, flat, "PNG 往返");
});

// 4. Repeated exports: identical bytes, zero accumulated error ---------
test("重复导出不累积色彩误差（字节级一致）", () => {
  const first = PNGEncoder.encodePNG(Compositor.flatten(layers, W * H), W, H);
  for (let n = 0; n < 5; n++) {
    const again = PNGEncoder.encodePNG(Compositor.flatten(layers, W * H), W, H);
    assertPixelsEqual(again, first, `第 ${n + 2} 次导出`);
  }
});

// 5. Reorder changes pixels; restoring order restores pixels -----------
test("调整层顺序立即改变结果，还原后逐像素复原", () => {
  const reordered = layers.slice();
  [reordered[1], reordered[3]] = [reordered[3], reordered[1]];
  const flatReordered = Compositor.flatten(reordered, W * H);
  assert.notDeepEqual([...flatReordered], [...flat], "换序后结果应当不同");
  const restored = Compositor.flatten(layers, W * H);
  assertPixelsEqual(restored, flat, "还原顺序");
});

// 6. Layer sources are never mutated by compositing --------------------
test("合成过程不修改图层源像素", () => {
  const before = layers.map((l) => l.pixels.slice());
  Compositor.flatten(layers, W * H);
  layers.forEach((l, i) => assertPixelsEqual(l.pixels, before[i], `图层 ${i} 源像素`));
});

console.log(`\n全部 ${passed} 项测试通过`);
