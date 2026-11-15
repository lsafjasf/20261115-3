export const PALETTE = [
  { stop: 0.0, color: "#19364f" },
  { stop: 0.16, color: "#286979" },
  { stop: 0.32, color: "#4c9782" },
  { stop: 0.48, color: "#a2bd63" },
  { stop: 0.62, color: "#e4cf5c" },
  { stop: 0.76, color: "#eeaa55" },
  { stop: 0.88, color: "#df744f" },
  { stop: 1.0, color: "#b43c55" }
];

export const HOLES = [
  { x: 0.655, y: 0.445, rx: 0.185, ry: 0.145, label: "采样空洞 A" },
  { x: 0.205, y: 0.735, r: 0.125, label: "采样空洞 B" }
];

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]) {
  const channel = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function colorRgbAt(normalized) {
  const t = clamp(Number.isFinite(normalized) ? normalized : 0, 0, 1);
  let upper = 1;
  while (upper < PALETTE.length - 1 && PALETTE[upper].stop < t) upper += 1;
  const lower = Math.max(0, upper - 1);
  const low = PALETTE[lower];
  const high = PALETTE[upper];
  const span = high.stop - low.stop || 1;
  const mix = (t - low.stop) / span;
  const lowRgb = hexToRgb(low.color);
  const highRgb = hexToRgb(high.color);
  return lowRgb.map((channel, index) => channel + (highRgb[index] - channel) * mix);
}

export function colorCssAt(normalized) {
  return rgbToHex(colorRgbAt(normalized));
}

export function binnedColor(value, min, max, levels) {
  const span = max - min || 1;
  const index = clamp(Math.floor(((value - min) / span) * levels), 0, levels - 1);
  return colorCssAt((index + 0.5) / levels);
}

export function contourColor(value, domain) {
  const [min, max] = domain;
  return colorCssAt((value - min) / (max - min || 1));
}

export function contourLegendColor(value, domain) {
  return contourColor(value, domain);
}

function halton(index, base) {
  let fraction = 1;
  let result = 0;
  let number = index;
  while (number > 0) {
    fraction /= base;
    result += fraction * (number % base);
    number = Math.floor(number / base);
  }
  return result;
}

function inHole(x, y) {
  return HOLES.some((hole) => {
    if ("r" in hole) {
      const dx = x - hole.x;
      const dy = y - hole.y;
      return dx * dx + dy * dy < hole.r * hole.r;
    }
    const dx = (x - hole.x) / hole.rx;
    const dy = (y - hole.y) / hole.ry;
    return dx * dx + dy * dy < 1;
  });
}

function gaussian2d(x, y, cx, cy, variance) {
  const dx = x - cx;
  const dy = y - cy;
  return Math.exp(-(dx * dx + dy * dy) / (2 * variance));
}

export function truthValue(x, y) {
  return (
    23 +
    6 * x -
    2.4 * y +
    20 * gaussian2d(x, y, 0.285, 0.375, 0.0205) +
    18 * gaussian2d(x, y, 0.765, 0.725, 0.018) +
    9 * gaussian2d(x, y, 0.515, 0.175, 0.031) +
    4.2 * Math.sin(x * 6.1 + 0.65) * Math.cos(y * 4.5 - 0.2)
  );
}

export function makeSampleData(count = 118) {
  const samples = [];
  for (let index = 1; samples.length < count && index < count * 2.2; index += 1) {
    const x = 0.032 + halton(index, 2) * 0.938;
    const y = 0.032 + halton(index, 3) * 0.936;
    if (inHole(x, y)) continue;
    if (samples.some((sample) => (sample.x - x) ** 2 + (sample.y - y) ** 2 < 0.0012)) continue;
    const jitter = 0.92 * Math.sin(index * 8.371) + 0.28 * Math.cos(index * 3.1);
    samples.push({
      id: index,
      x: clamp(x + 0.004 * Math.sin(index * 9.1), 0.02, 0.98),
      y: clamp(y + 0.004 * Math.cos(index * 7.7), 0.02, 0.98),
      value: truthValue(x, y) + jitter
    });
  }
  return samples;
}

export function interpolateAt(samples, x, y, sigmaNorm) {
  let weightSum = 0;
  let weightedValue = 0;
  let nearestSquared = Infinity;
  const cutoffSquared = (sigmaNorm * 3.2) ** 2;
  for (const sample of samples) {
    const dx = x - sample.x;
    const dy = y - sample.y;
    const distanceSquared = dx * dx + dy * dy;
    nearestSquared = Math.min(nearestSquared, distanceSquared);
    if (distanceSquared > cutoffSquared) continue;
    const weight = Math.exp(-distanceSquared / (2 * sigmaNorm * sigmaNorm));
    weightSum += weight;
    weightedValue += weight * sample.value;
  }
  return {
    value: weightSum > 0 ? weightedValue / weightSum : null,
    nearest: Math.sqrt(nearestSquared),
    weightSum
  };
}

export function computeLooErrors(samples, sigmaNorm) {
  const cutoffSquared = (sigmaNorm * 3.2) ** 2;
  return samples.map((target, targetIndex) => {
    let weightSum = 0;
    let weightedValue = 0;
    for (let index = 0; index < samples.length; index += 1) {
      if (index === targetIndex) continue;
      const sample = samples[index];
      const dx = target.x - sample.x;
      const dy = target.y - sample.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > cutoffSquared) continue;
      const weight = Math.exp(-distanceSquared / (2 * sigmaNorm * sigmaNorm));
      weightSum += weight;
      weightedValue += weight * sample.value;
    }
    const predicted = weightSum > 0 ? weightedValue / weightSum : target.value;
    return Math.abs(target.value - predicted);
  });
}

export function sampleDomain(samples, padding = 1.6) {
  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    min = Math.min(min, sample.value);
    max = Math.max(max, sample.value);
  }
  return [min - padding, max + padding];
}

export function buildField(samples, width, height, sigmaPixels) {
  const sigma = Math.max(1, sigmaPixels);
  const minDimension = Math.min(width, height);
  const sigmaNorm = sigma / minDimension;
  const sigmaSquared = sigma * sigma;
  const cutoffSquared = (sigma * 3.2) ** 2;
  const coverageLimit = clamp(sigma * 1.35, minDimension * 0.095, minDimension * 0.125);
  const pixelSamples = samples.map((sample) => ({
    x: sample.x * width,
    y: sample.y * height,
    value: sample.value
  }));
  const looErrors = computeLooErrors(samples, sigmaNorm);
  const sampleCount = samples.length;
  const totalPixels = width * height;
  const values = new Float32Array(totalPixels);
  const errors = new Float32Array(totalPixels);
  const nearest = new Float32Array(totalPixels);
  const valid = new Uint8Array(totalPixels);
  let validCount = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      let weightSum = 0;
      let weightedValue = 0;
      let weightedError = 0;
      let nearestSquared = Infinity;

      for (let index = 0; index < sampleCount; index += 1) {
        const sample = pixelSamples[index];
        const dx = x + 0.5 - sample.x;
        const dy = y + 0.5 - sample.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < nearestSquared) nearestSquared = distanceSquared;
        if (distanceSquared > cutoffSquared) continue;
        const weight = Math.exp(-distanceSquared / (2 * sigmaSquared));
        weightSum += weight;
        weightedValue += weight * sample.value;
        weightedError += weight * looErrors[index] * looErrors[index];
      }

      const distance = Math.sqrt(nearestSquared);
      nearest[pixelIndex] = distance;
      if (inHole((x + 0.5) / width, (y + 0.5) / height)) continue;
      if (weightSum <= 1e-9 || distance > coverageLimit) continue;

      const value = weightedValue / weightSum;
      const localError = Math.sqrt(weightedError / weightSum);
      const distanceInflation = 1 + 0.42 * clamp(distance / sigma, 0, 2);
      values[pixelIndex] = value;
      errors[pixelIndex] = localError * distanceInflation;
      valid[pixelIndex] = 1;
      validCount += 1;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  const rmse = Math.sqrt(
    looErrors.reduce((sum, error) => sum + error * error, 0) / Math.max(1, looErrors.length)
  );

  return {
    width,
    height,
    values,
    errors,
    nearest,
    valid,
    validCount,
    min,
    max,
    coverageLimit,
    sigmaNorm,
    looErrors,
    rmse
  };
}

export function contourLevels(min, max, interval) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || interval <= 0) return [];
  const levels = [];
  let level = Math.ceil((min + 1e-6) / interval) * interval;
  while (level < max - 1e-6 && levels.length < 80) {
    levels.push(Number(level.toFixed(6)));
    level += interval;
  }
  return levels;
}

function edgePoint(edge, level, x, y, a, b, c, d) {
  if (edge === 0) {
    const t = clamp((level - a) / (b - a || 1e-9), 0, 1);
    return [x + t, y];
  }
  if (edge === 1) {
    const t = clamp((level - b) / (c - b || 1e-9), 0, 1);
    return [x + 1, y + t];
  }
  if (edge === 2) {
    const t = clamp((level - d) / (c - d || 1e-9), 0, 1);
    return [x + t, y + 1];
  }
  const t = clamp((level - a) / (d - a || 1e-9), 0, 1);
  return [x, y + t];
}

export function traceContour(field, level) {
  const { width, height, values, valid } = field;
  const segments = [];
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const cellX = (x + 0.5) / width;
      const cellY = (y + 0.5) / height;
      if (
        HOLES.some((hole) => {
          if ("r" in hole) {
            return (cellX - hole.x) ** 2 + (cellY - hole.y) ** 2 < (hole.r + 0.009) ** 2;
          }
          return ((cellX - hole.x) / (hole.rx + 0.009)) ** 2 + ((cellY - hole.y) / (hole.ry + 0.009)) ** 2 < 1;
        })
      ) {
        continue;
      }
      const topLeftIndex = y * width + x;
      const topRightIndex = topLeftIndex + 1;
      const bottomLeftIndex = topLeftIndex + width;
      const bottomRightIndex = bottomLeftIndex + 1;
      if (
        !valid[topLeftIndex] ||
        !valid[topRightIndex] ||
        !valid[bottomLeftIndex] ||
        !valid[bottomRightIndex]
      ) {
        continue;
      }

      const a = values[topLeftIndex];
      const b = values[topRightIndex];
      const c = values[bottomRightIndex];
      const d = values[bottomLeftIndex];
      const top = (a >= level) !== (b >= level);
      const right = (b >= level) !== (c >= level);
      const bottom = (d >= level) !== (c >= level);
      const left = (a >= level) !== (d >= level);
      const edges = [];
      if (top) edges.push(0);
      if (right) edges.push(1);
      if (bottom) edges.push(2);
      if (left) edges.push(3);
      if (edges.length === 2) {
        const first = edgePoint(edges[0], level, x, y, a, b, c, d);
        const second = edgePoint(edges[1], level, x, y, a, b, c, d);
        segments.push(first[0], first[1], second[0], second[1]);
        continue;
      }

      if (edges.length === 4) {
        const centerHigh = (a + b + c + d) * 0.25 >= level;
        const caseIndex =
          (a >= level ? 8 : 0) +
          (b >= level ? 4 : 0) +
          (c >= level ? 2 : 0) +
          (d >= level ? 1 : 0);
        let pairs;
        if (caseIndex === 5) {
          pairs = centerHigh ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]];
        } else {
          pairs = centerHigh ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        }
        for (const pair of pairs) {
          const first = edgePoint(pair[0], level, x, y, a, b, c, d);
          const second = edgePoint(pair[1], level, x, y, a, b, c, d);
          segments.push(first[0], first[1], second[0], second[1]);
        }
      }
    }
  }
  return segments;
}

export function traceAllContours(field, levels) {
  return levels.map((level) => ({
    level,
    segments: traceContour(field, level)
  }));
}
