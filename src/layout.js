// Axis label layout without a chart library.
// `measure` is injected so the same logic runs in the browser and in Node tests.

const DEFAULT_FONT_SIZE = 12;

function defaultMeasure(text) {
  // Rough monospace-ish estimate used as a fallback / in tests.
  return String(text).length * DEFAULT_FONT_SIZE * 0.62;
}

function overlaps(placed, position, halfWidth, gap) {
  return placed.some(
    (item) =>
      Math.abs(item.position - position) <
      item.halfWidth + halfWidth + gap,
  );
}

// Keep every nth label while preserving the first and last entries where useful.
function fitsWithStride(entries, stride, widthOf, gap) {
  const placed = [];
  for (let i = 0; i < entries.length; i += stride) {
    const halfWidth = widthOf(entries[i]) / 2;
    if (overlaps(placed, entries[i].position, halfWidth, gap)) return false;
    placed.push({ position: entries[i].position, halfWidth });
  }
  return true;
}

// X (bottom) axis: thin labels horizontally; if thinning alone is not enough,
// rotate them -45 degrees and thin again.
export function planXLabels(ticks, scale, format, options = {}) {
  const measure = options.measure || defaultMeasure;
  const gap = options.gap ?? 8;
  const fontSize = options.fontSize || DEFAULT_FONT_SIZE;
  const entries = ticks.map((tick) => ({
    value: tick.value,
    position: scale(tick.value),
    text: format(tick.value),
  }));

  const widthOf = (entry) => measure(entry.text);
  let stride = 1;
  while (
    stride < entries.length &&
    !fitsWithStride(entries, stride, widthOf, gap)
  ) {
    stride += 1;
  }

  let rotated = false;
  // Rotate once horizontal thinning would drop more than half the labels.
  if (stride > 2 && Math.ceil(entries.length / stride) < entries.length / 2) {
    rotated = true;
    stride = 1;
    // After a -45deg rotation the horizontal footprint is roughly the font
    // height plus the text's diagonal projection.
    const rotatedWidth = (entry) =>
      fontSize + widthOf(entry) * Math.SQRT1_2;
    while (
      stride < entries.length &&
      !fitsWithStride(entries, stride, rotatedWidth, gap)
    ) {
      stride += 1;
    }
  }

  return entries.map((entry, index) => ({
    ...entry,
    visible: index % stride === 0,
    rotated,
    anchor: rotated ? 'end' : 'middle',
    angle: rotated ? -45 : 0,
  }));
}

// Y (left) axis: labels share a column, so vertical spacing is the constraint.
export function planYLabels(ticks, scale, format, options = {}) {
  const lineHeight = options.lineHeight || DEFAULT_FONT_SIZE * 1.5;
  const gap = options.gap ?? 6;
  const entries = ticks
    .filter((tick) => !tick.minor)
    .map((tick) => ({
      value: tick.value,
      position: scale(tick.value),
      text: format(tick.value),
      rotated: false,
      anchor: 'end',
      angle: 0,
    }))
    .sort((a, b) => a.position - b.position);

  let stride = 1;
  const fits = (step) => {
    let previous = null;
    for (let i = 0; i < entries.length; i += step) {
      if (previous !== null && entries[i].position - previous < lineHeight + gap) {
        return false;
      }
      previous = entries[i].position;
    }
    return true;
  };
  while (stride < entries.length && !fits(stride)) stride += 1;

  return entries.map((entry, index) => ({
    ...entry,
    visible: index % stride === 0,
  }));
}
