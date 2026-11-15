// Screen-fixed map furniture: scale bar and north arrow.

// Pick a "nice" round world length whose on-screen size fits 90-160 px.
export function computeScaleBar(view) {
  const targetPx = 120;
  const targetMeters = targetPx / view.scale;
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetMeters)));
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
  const chosen = candidates.find((meters) => meters * view.scale >= 90) ||
    candidates[candidates.length - 1];
  return { meters: chosen, px: chosen * view.scale };
}

export function formatMeters(meters) {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}
