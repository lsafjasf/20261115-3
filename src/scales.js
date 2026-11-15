// Pure scale math: linear and symmetric-log (symlog).
// Symlog is used so a "log axis" still works with zero and negative values.

export const SYMLOG_CONSTANT = 1;

export function symlog(value, constant = SYMLOG_CONSTANT) {
  return Math.sign(value) * Math.log1p(Math.abs(value) / constant);
}

export function symexp(value, constant = SYMLOG_CONSTANT) {
  return Math.sign(value) * constant * (Math.exp(Math.abs(value)) - 1);
}

// Returns a mapping function data value -> pixel, with .invert(pixel) -> value.
export function makeScale(domain, range, type = 'linear') {
  const [d0, d1] = domain;
  const transform = type === 'symlog' ? symlog : (v) => v;
  const inverse = type === 'symlog' ? symexp : (v) => v;
  const t0 = transform(d0);
  const t1 = transform(d1);
  const span = t1 - t0 || 1;
  const [r0, r1] = range;

  const scale = (value) => r0 + ((transform(value) - t0) / span) * (r1 - r0);
  scale.invert = (pixel) =>
    inverse(t0 + ((pixel - r0) / (r1 - r0 || 1)) * span);
  scale.domain = () => [d0, d1];
  scale.type = type;
  return scale;
}

// d3-style "nice" step for roughly `count` evenly spaced ticks.
export function tickStep(start, stop, count = 6) {
  const raw = Math.abs(stop - start) / Math.max(1, count);
  if (raw === 0 || !Number.isFinite(raw)) return 1;
  const power = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** power;
  let nice;
  if (fraction < 1.5) nice = 1;
  else if (fraction < 3) nice = 2;
  else if (fraction < 7) nice = 5;
  else nice = 10;
  return nice * 10 ** power;
}

function niceLinearDomain(min, max, count = 6) {
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) : 1;
    return [min - pad, max + pad];
  }
  const step = tickStep(min, max, count);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

function outwardPowerOfTen(value, bound) {
  // bound: -1 for lower bound, +1 for upper bound.
  if (value === 0) return 0;
  const magnitude = Math.log10(Math.abs(value));
  const exponent = bound === -1
    ? (value > 0 ? Math.floor(magnitude) : Math.ceil(magnitude))
    : (value > 0 ? Math.ceil(magnitude) : Math.floor(magnitude));
  return Math.sign(value) * 10 ** exponent;
}

function niceSymlogDomain(min, max) {
  const lower = outwardPowerOfTen(min, -1);
  const upper = outwardPowerOfTen(max, 1);
  if (lower === upper) {
    const pad = Math.abs(lower) || 1;
    return [lower - pad, upper + pad];
  }
  return [lower, upper];
}

// Compute a readable domain from raw values. Null/undefined/NaN are ignored.
export function niceDomain(values, type = 'linear', count = 6) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return type === 'symlog' ? [-1, 1] : [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (!type || type === 'linear') {
    // Small padding so boundary points are not glued to the plot edge.
    const pad = (max - min) * 0.04;
    [min, max] = min === max ? [min - 1, max + 1] : [min - pad, max + pad];
    return niceLinearDomain(min, max, count);
  }
  return niceSymlogDomain(min, max);
}

// Ticks as [{ value, minor }]. Minor ticks are unlabeled grid subdivisions.
export function ticks(domain, type = 'linear', count = 6) {
  const [d0, d1] = domain;
  if (type === 'symlog') return symlogTicks(d0, d1);
  const step = tickStep(d0, d1, count);
  const result = [];
  const start = Math.ceil(d0 / step - 1e-9) * step;
  for (let v = start; v <= d1 + step * 1e-9; v += step) {
    result.push({ value: Number(v.toFixed(12)), minor: false });
  }
  return result;
}

function symlogTicks(d0, d1) {
  const result = [{ value: 0, minor: false }];
  const bounds = [d0, d1].filter((v) => v !== 0).map((v) => Math.log10(Math.abs(v)));
  const minExp = Math.floor(Math.min(...bounds));
  const maxExp = Math.ceil(Math.max(...bounds));
  const pushDecade = (base, sign) => {
    result.push({ value: sign * base, minor: false });
    for (let mult = 2; mult <= 9; mult += 1) {
      result.push({ value: sign * mult * base, minor: true });
    }
  };
  for (let exp = minExp; exp <= maxExp; exp += 1) {
    const base = 10 ** exp;
    if (d0 < 0) pushDecade(base, -1);
    if (d1 > 0) pushDecade(base, 1);
  }
  return result
    .filter((t) => t.value >= d0 && t.value <= d1)
    .sort((a, b) => a.value - b.value)
    .filter((t, i, arr) => i === 0 || t.value !== arr[i - 1].value);
}

export function formatTick(value, type = 'linear') {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (type === 'symlog' || abs >= 10000 || abs < 0.01) {
    return value.toExponential(0).replace('e+', 'e');
  }
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}
