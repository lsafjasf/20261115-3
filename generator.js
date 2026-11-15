/*
 * generator.js — 无缝纹理生成核心（浏览器与 Node 通用）
 *
 * 关键设计：所有图案都定义在连续的"瓦片坐标系" [0,1) x [0,1) 上，
 * 与输出分辨率无关。因此同一 seed 在 512 / 1024 下采样得到的是
 * 同一个连续场，缩小后必然与直接输出视觉一致。
 *
 * 无缝（四边环绕连续）通过以下手段保证：
 *  - 值噪声：晶格索引对周期取模，频率为整数 -> 严格周期化
 *  - 方向性：对周期场沿任意角度做环绕采样的定向模糊（线性算子保持周期性）
 *  - 裂纹：随机游走路径 + 环绕感知的 splat 落笔（越过边缘自动绕回）
 *  - Worley 细胞裂纹：特征点在 3x3 复制的瓦片内查询
 */
(function (global) {
  'use strict';

  // ---------- 基础工具 ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(ix, iy, seed) {
    let h = Math.imul(ix | 0, 0x27d4eb2d)
          ^ Math.imul(iy | 0, 0x165667b1)
          ^ Math.imul(seed | 0, 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---------- 可平铺值噪声 / fBm ----------

  // 周期为 per（整数晶格数）的值噪声，x/y 以晶格单元计
  function vnoise(x, y, per, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const wx = fx * fx * (3 - 2 * fx);
    const wy = fy * fy * (3 - 2 * fy);
    const x0m = ((x0 % per) + per) % per;
    const y0m = ((y0 % per) + per) % per;
    const x1m = (x0m + 1) % per;
    const y1m = (y0m + 1) % per;
    const v00 = hash2(x0m, y0m, seed);
    const v10 = hash2(x1m, y0m, seed);
    const v01 = hash2(x0m, y1m, seed);
    const v11 = hash2(x1m, y1m, seed);
    return lerp(lerp(v00, v10, wx), lerp(v01, v11, wx), wy);
  }

  // x/y 为瓦片坐标 [0,1)，baseFreq 为整数 -> 严格无缝
  function fbm(x, y, baseFreq, octaves, seed) {
    let sum = 0, amp = 0.5, norm = 0, freq = baseFreq;
    for (let o = 0; o < octaves; o++) {
      sum += amp * vnoise(x * freq, y * freq, freq, seed + o * 101);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // ---------- 石纹基底层 ----------

  // 在 S x S 网格上采样连续 fBm 场（像素中心采样，保证跨分辨率一致）
  function buildBaseField(seed, scale, octaves, S) {
    const field = new Float32Array(S * S);
    const freq = Math.max(1, Math.round(scale));
    const inv = 1 / S;
    for (let y = 0; y < S; y++) {
      const ty = (y + 0.5) * inv;
      for (let x = 0; x < S; x++) {
        field[y * S + x] = fbm((x + 0.5) * inv, ty, freq, octaves, seed);
      }
    }
    return field;
  }

  // 沿任意角度的定向模糊，采样坐标环绕 -> 周期场经过线性算子仍严格周期。
  // 这是"调整方向"不破坏接缝的关键：不旋转域，而是过滤周期信号。
  function directionalBlur(field, S, angleRad, lengthTiles) {
    if (lengthTiles <= 0.0005) return field;
    const out = new Float32Array(S * S);
    const lenPx = lengthTiles * S;
    const steps = Math.min(64, Math.max(2, Math.ceil(lenPx)));
    const stride = lenPx / steps;
    const dx = Math.cos(angleRad), dy = Math.sin(angleRad);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        let acc = 0;
        for (let k = 0; k <= steps; k++) {
          const t = (k / steps - 0.5) * lenPx;
          let sx = Math.round(px + dx * t) % S; if (sx < 0) sx += S;
          let sy = Math.round(py + dy * t) % S; if (sy < 0) sy += S;
          acc += field[sy * S + sx];
        }
        out[py * S + px] = acc / (steps + 1);
      }
    }
    return out;
  }

  // ---------- 裂纹层 ----------

  // Worley 细胞裂纹：F2-F1 在细胞边界处为 0。特征点按瓦片周期化放置。
  function buildWorleyCracks(seed, cells, widthTiles, S) {
    const N = Math.max(2, Math.round(cells));
    const pts = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        pts[(j * N + i) * 2]     = (i + hash2(i, j, seed ^ 0x51ab)) / N;
        pts[(j * N + i) * 2 + 1] = (j + hash2(i, j, seed ^ 0x7f3d)) / N;
      }
    }
    const mask = new Float32Array(S * S);
    const widthN = widthTiles * N; // 阈值换算到晶格单元
    const inv = 1 / S;
    for (let py = 0; py < S; py++) {
      const ty = (py + 0.5) * inv;
      const cy = Math.floor(ty * N);
      for (let px = 0; px < S; px++) {
        const tx = (px + 0.5) * inv;
        const cx = Math.floor(tx * N);
        let f1 = 1e9, f2 = 1e9;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = (((cx + di) % N) + N) % N;
            const jj = (((cy + dj) % N) + N) % N;
            const ox = pts[(jj * N + ii) * 2]     + (cx + di - ii) / N;
            const oy = pts[(jj * N + ii) * 2 + 1] + (cy + dj - jj) / N;
            const ddx = (ox - tx) * N, ddy = (oy - ty) * N;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            if (d < f1) { f2 = f1; f1 = d; }
            else if (d < f2) { f2 = d; }
          }
        }
        mask[py * S + px] = 1 - smoothstep(widthN * 0.35, widthN, f2 - f1);
      }
    }
    return mask;
  }

  // ---------- 周期重采样 ----------

  // 双线性重采样，采样坐标环绕 -> 缩放不会在对边之间制造接缝。
  // 支持 Uint8ClampedArray / Float32Array，channels 通常为 1 或 4。
  function resamplePeriodic(src, sw, sh, dw, dh, channels) {
    const isFloat = src instanceof Float32Array;
    const out = isFloat ? new Float32Array(dw * dh * channels)
                        : new Uint8ClampedArray(dw * dh * channels);
    const rx = sw / dw, ry = sh / dh;
    for (let y = 0; y < dh; y++) {
      const fy = (y + 0.5) * ry - 0.5;
      let y0 = Math.floor(fy); const wy = fy - y0;
      const y0m = ((y0 % sh) + sh) % sh;
      const y1m = (y0m + 1) % sh;
      for (let x = 0; x < dw; x++) {
        const fx = (x + 0.5) * rx - 0.5;
        let x0 = Math.floor(fx); const wx = fx - x0;
        const x0m = ((x0 % sw) + sw) % sw;
        const x1m = (x0m + 1) % sw;
        for (let c = 0; c < channels; c++) {
          const v00 = src[(y0m * sw + x0m) * channels + c];
          const v10 = src[(y0m * sw + x1m) * channels + c];
          const v01 = src[(y1m * sw + x0m) * channels + c];
          const v11 = src[(y1m * sw + x1m) * channels + c];
          out[(y * dw + x) * channels + c] =
            lerp(lerp(v00, v10, wx), lerp(v01, v11, wx), wy);
        }
      }
    }
    return out;
  }

  // ---------- 默认参数 ----------

  function defaultParams() {
    return {
      seed: 1337,
      stone: {
        scale: 6,          // 基础频率（整数 -> 无缝）
        octaves: 5,
        contrast: 1.15,
        grainAngle: 30,    // 方向（度），任意角度均保持无缝
        grainLength: 0.06, // 定向模糊长度（瓦片单位）
        colorDark: '#4a4a50',
        colorLight: '#9a948a'
      },
      cracks: {
        cells: 8,          // Worley 细胞数
        width: 0.012,      // 细胞裂纹宽度（瓦片单位）
        walkCount: 22,     // 随机游走裂纹数量
        walkAngle: 30,     // 主方向（度）
        walkSpread: 35,    // 方向抖动（度）
        walkWidth: 0.0035, // 游走裂纹宽度（瓦片单位）
        intensity: 0.8,
        color: '#2b241d'
      },
      moss: {
        scale: 5,
        coverage: 0.35,
        crackAffinity: 0.3,
        color: '#4e6b2f'
      }
    };
  }

  // ---------- 合成渲染 ----------

  // mod（可选）：用户刷子层 { data: Uint8ClampedArray RGBA, width, height }
  //   R = 添加苔藓, G = 擦除苔藓, B = 明暗（128 为中性）
  // 返回 { width, height, data: Uint8ClampedArray(RGBA) }
  function render(params, S, mod) {
    const p = params;
    const seed = p.seed | 0;

    let field = buildBaseField(seed, p.stone.scale, p.stone.octaves, S);
    field = directionalBlur(field, S, p.stone.grainAngle * Math.PI / 180,
                            p.stone.grainLength);

    const crackW = p.cracks.cells > 0
      ? buildWorleyCracks(seed, p.cracks.cells, p.cracks.width, S)
      : new Float32Array(S * S);
    const crackK = buildWalkCracks(seed, p.cracks.walkCount,
      p.cracks.walkAngle, p.cracks.walkSpread, p.cracks.walkWidth, S);
    const crack = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      crack[i] = Math.max(crackW[i], crackK[i]) * p.cracks.intensity;
    }

    const moss = buildMossMask(seed, p.moss.scale, p.moss.coverage,
                               p.moss.crackAffinity, crack, S);

    let modData = null;
    if (mod && mod.data) {
      modData = (mod.width === S && mod.height === S)
        ? mod.data
        : resamplePeriodic(mod.data, mod.width, mod.height, S, S, 4);
    }

    const cDark = hexToRgb(p.stone.colorDark);
    const cLight = hexToRgb(p.stone.colorLight);
    const cCrack = hexToRgb(p.cracks.color);
    const cMoss = hexToRgb(p.moss.color);
    const contrast = p.stone.contrast;

    const out = new Uint8ClampedArray(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      // 石纹基色
      const t = clamp01((field[i] - 0.5) * contrast + 0.5);
      let r = lerp(cDark[0], cLight[0], t);
      let g = lerp(cDark[1], cLight[1], t);
      let b = lerp(cDark[2], cLight[2], t);

      // 裂纹（向裂纹色混合）
      const ck = clamp01(crack[i]);
      r = lerp(r, cCrack[0], ck);
      g = lerp(g, cCrack[1], ck);
      b = lerp(b, cCrack[2], ck);

      // 苔藓（含刷子增减），色调随石纹场轻微变化
      let mm = moss[i];
      let bright = 1;
      if (modData) {
        mm = clamp01(mm + modData[i * 4] / 255 - modData[i * 4 + 1] / 255);
        bright = modData[i * 4 + 2] / 128;
      }
      const shade = 0.8 + 0.4 * field[i];
      r = lerp(r, cMoss[0] * shade, mm);
      g = lerp(g, cMoss[1] * shade, mm);
      b = lerp(b, cMoss[2] * shade, mm);

      out[i * 4]     = clamp01(r * bright / 255) * 255;
      out[i * 4 + 1] = clamp01(g * bright / 255) * 255;
      out[i * 4 + 2] = clamp01(b * bright / 255) * 255;
      out[i * 4 + 3] = 255;
    }
    return { width: S, height: S, data: out };
  }

  // ---------- 接缝误差检测 ----------

  // 比较左右、上下边界的像素差，返回 { max, mean }（0 = 完全环绕连续）
  function seamError(img) {
    const { width: S, height: H, data } = img;
    let max = 0, sum = 0, n = 0;
    for (let y = 0; y < H; y++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(data[(y * S) * 4 + c] - data[(y * S + S - 1) * 4 + c]);
        if (d > max) max = d; sum += d; n++;
      }
    }
    for (let x = 0; x < S; x++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(data[x * 4 + c] - data[((H - 1) * S + x) * 4 + c]);
        if (d > max) max = d; sum += d; n++;
      }
    }
    return { max, mean: sum / n };
  }

  // 环绕感知的圆形 splat：中心可越界，写回时对坐标取模，
  // 因此靠近边缘的笔迹会自动出现在对边 —— 刷子同步也是同一机制。
  function splat(mask, S, tx, ty, rPx, val) {
    const cx = tx * S, cy = ty * S;
    const r = Math.max(1, Math.ceil(rPx));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > rPx * rPx) continue;
        const px = ((Math.round(cx) + dx) % S + S) % S;
        const py = ((Math.round(cy) + dy) % S + S) % S;
        const f = 1 - Math.sqrt(d2) / (rPx + 1e-6);
        const idx = py * S + px;
        const v = val * f;
        if (mask[idx] < v) mask[idx] = v;
      }
    }
  }

  function stampSegment(mask, S, x0, y0, x1, y1, rPx, val) {
    const lenPx = Math.hypot((x1 - x0) * S, (y1 - y0) * S);
    const n = Math.max(1, Math.ceil(lenPx / Math.max(0.5, rPx * 0.5)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      splat(mask, S, lerp(x0, x1, t), lerp(y0, y1, t), rPx, val);
    }
  }

  // 方向性随机游走裂纹：整体朝向 walkAngle，抖动由 walkSpread 控制。
  // 路径定义在瓦片坐标系，与分辨率无关；越界由 splat 取模环绕。
  function buildWalkCracks(seed, count, angleDeg, spreadDeg, widthTiles, S) {
    const mask = new Float32Array(S * S);
    if (count <= 0) return mask;
    const rng = mulberry32((seed ^ 0xc4a5) >>> 0);
    const ang = angleDeg * Math.PI / 180;
    const spread = spreadDeg * Math.PI / 180;
    const rPx = Math.max(0.75, widthTiles * S);
    for (let c = 0; c < count; c++) {
      let x = rng(), y = rng();
      let dir = ang + (rng() * 2 - 1) * spread;
      const segs = 30 + Math.floor(rng() * 70);
      const stepLen = 0.006 + rng() * 0.012;
      const strength = 0.5 + rng() * 0.5;
      for (let s = 0; s < segs; s++) {
        const nx = x + Math.cos(dir) * stepLen;
        const ny = y + Math.sin(dir) * stepLen;
        stampSegment(mask, S, x, y, nx, ny, rPx, strength);
        x = nx; y = ny;
        dir += (rng() * 2 - 1) * 0.45;
      }
    }
    return mask;
  }

  // ---------- 苔藓层 ----------

  // 苔藓覆盖度由 fBm 阈值控制，并倾向于在裂纹处生长
  function buildMossMask(seed, scale, coverage, crackAffinity, crackMask, S) {
    const mask = new Float32Array(S * S);
    const freq = Math.max(1, Math.round(scale));
    const th = 0.78 - coverage * 0.62;
    const inv = 1 / S;
    for (let y = 0; y < S; y++) {
      const ty = (y + 0.5) * inv;
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const m = fbm((x + 0.5) * inv, ty, freq, 4, seed ^ 0x3d7f)
                + crackMask[i] * crackAffinity;
        mask[i] = smoothstep(th, th + 0.14, m);
      }
    }
    return mask;
  }
  const api = {
    defaultParams, render, resamplePeriodic, seamError,
    mulberry32, fbm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TexGen = api;
})(typeof window !== 'undefined' ? window : globalThis);

