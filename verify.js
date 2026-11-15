/*
 * verify.js — 同一 seed 生成 512 与 1024，验证：
 *  1) 1024 周期重采样缩小到 512 后与直接输出的 512 视觉一致（RMSE / 最大差）
 *  2) 两种尺寸的输出四边环绕连续（接缝差不超过内部相邻像素差）
 * 运行：node verify.js [seed]
 * 产物：artifacts/out_512.png, out_1024.png, out_1024_down.png, diff_x4.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const G = require('./generator.js');

// ---------- 最小 PNG 编码器（RGBA8） ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(img) {
  const { width: w, height: h, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(data.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
// ---------- 指标 ----------
function compare(a, b) {
  let sum2 = 0, sumAbs = 0, max = 0, over16 = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      sum2 += d * d; sumAbs += d;
      if (d > max) max = d;
      if (d > 16) over16++;
    }
  }
  const count = (n / 4) * 3;
  return {
    rmse: Math.sqrt(sum2 / count),
    meanAbs: sumAbs / count,
    max,
    pctOver16: (over16 / count) * 100
  };
}

// 内部相邻像素差基线（用于判断接缝是否"不可见"）
function interiorMax(img) {
  const { width: S, height: H, data } = img;
  let max = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < S - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(data[(y * S + x) * 4 + c] - data[(y * S + x + 1) * 4 + c]);
        if (d > max) max = d;
      }
    }
  }
  return max;
}

// ---------- 主流程 ----------
const seed = parseInt(process.argv[2] || '1337', 10);
const params = G.defaultParams();
params.seed = seed;

console.log(`seed = ${seed}`);
console.time('render 512 ');
const a = G.render(params, 512, null);
console.timeEnd('render 512 ');
console.time('render 1024');
const b = G.render(params, 1024, null);
console.timeEnd('render 1024');

// 1024 -> 512 周期重采样（环绕双线性，不破坏接缝）
const bDown = {
  width: 512, height: 512,
  data: G.resamplePeriodic(b.data, 1024, 1024, 512, 512, 4)
};

const diff = compare(a, bDown);
console.log('\n[一致性] 1024 缩小 vs 直接 512:');
console.log(`  RMSE            = ${diff.rmse.toFixed(2)} / 255`);
console.log(`  平均绝对差      = ${diff.meanAbs.toFixed(2)} / 255`);
console.log(`  最大差          = ${diff.max} / 255`);
console.log(`  差异>16 的像素  = ${diff.pctOver16.toFixed(2)} %`);

let pass = diff.rmse < 8 && diff.pctOver16 < 5;

for (const [name, img] of [['512', a], ['1024', b], ['1024→512', bDown]]) {
  const seam = G.seamError(img);
  const interior = interiorMax(img);
  const ok = seam.max <= interior + 8;
  pass = pass && ok;
  console.log(`\n[接缝] ${name}: 跨边界最大差=${seam.max}, 均值=${seam.mean.toFixed(2)},` +
    ` 内部相邻最大差=${interior} -> ${ok ? 'PASS（接缝不劣于内部纹理变化）' : 'FAIL'}`);
}

// 差异可视化（放大 4 倍）
const diffImg = { width: 512, height: 512, data: new Uint8ClampedArray(512 * 512 * 4) };
for (let i = 0; i < 512 * 512 * 4; i += 4) {
  for (let c = 0; c < 3; c++) {
    diffImg.data[i + c] = Math.min(255, Math.abs(a.data[i + c] - bDown.data[i + c]) * 4);
  }
  diffImg.data[i + 3] = 255;
}

const outDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'out_512.png'), encodePng(a));
fs.writeFileSync(path.join(outDir, 'out_1024.png'), encodePng(b));
fs.writeFileSync(path.join(outDir, 'out_1024_down.png'), encodePng(bDown));
fs.writeFileSync(path.join(outDir, 'diff_x4.png'), encodePng(diffImg));
console.log('\n已写出 artifacts/out_512.png, out_1024.png, out_1024_down.png, diff_x4.png');
console.log(pass ? '\n== 全部通过 ==' : '\n== 存在失败项 ==');
process.exit(pass ? 0 : 1);
