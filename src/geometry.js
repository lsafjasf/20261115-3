// Pure geometry: turns data points into pixel segments/paths.
// Missing values (null / undefined / NaN) break the line instead of becoming 0.

function defined(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

export function projectPoints(points, xScale, yScale) {
  return points.map((point) =>
    defined(point)
      ? { x: xScale(point.x), y: yScale(point.y), data: point }
      : null,
  );
}

// Split a projected series (with nulls for gaps) into contiguous segments.
export function splitSegments(projected) {
  const segments = [];
  let current = [];
  for (const point of projected) {
    if (point === null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function linePathFor(segment) {
  return segment
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
    .join(' ');
}

// One path per contiguous segment so gaps stay visually disconnected.
export function linePaths(points, xScale, yScale) {
  return splitSegments(projectPoints(points, xScale, yScale))
    .filter((segment) => segment.length > 0)
    .map((segment) => ({
      d: linePathFor(segment),
      points: segment,
    }));
}

export function areaPaths(points, xScale, yScale, baselinePixel) {
  return splitSegments(projectPoints(points, xScale, yScale))
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      const top = linePathFor(segment);
      const d =
        `${top} L${last.x},${baselinePixel} ` +
        `L${first.x},${baselinePixel} Z`;
      return { d, points: segment };
    });
}

export function scatterPoints(points, xScale, yScale) {
  return projectPoints(points, xScale, yScale)
    .filter((point) => point !== null)
    .map((point) => ({
      cx: point.x,
      cy: point.y,
      data: point.data,
    }));
}

// Wheel-zoom helper: a pixel window maps back to a new data domain, clamped
// to the full domain so the chart cannot be panned beyond the data.
export function zoomDomain(currentDomain, factor, anchorPixel, pixelRange, scale) {
  const [full0, full1] = scale.domain();
  const anchorValue = scale.invert(anchorPixel);
  const [d0, d1] = currentDomain;
  const next = [
    anchorValue - (anchorValue - d0) * factor,
    anchorValue + (d1 - anchorValue) * factor,
  ];
  const fullSpan = full1 - full0 || 1;
  next[0] = Math.max(full0, Math.min(next[0], full1 - fullSpan * 0.01));
  next[1] = Math.min(full1, Math.max(next[1], full0 + fullSpan * 0.01));
  if (next[1] - next[0] < fullSpan * 0.02) return currentDomain;
  return next;
}

// Aggregate every visible series into x/y extents for axis recomputation.
export function combinedExtents(seriesList) {
  const xs = [];
  const ys = [];
  for (const series of seriesList) {
    if (!series.visible) continue;
    for (const point of series.points) {
      if (defined(point)) {
        xs.push(point.x);
        ys.push(point.y);
      }
    }
  }
  return { xs, ys };
}
