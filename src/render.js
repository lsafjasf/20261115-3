import { GRID, channelMetrics } from './engine.js';

const RAMP = [
  [0.00, 18, 44, 49],
  [0.16, 31, 84, 77],
  [0.34, 79, 129, 104],
  [0.52, 151, 164, 112],
  [0.68, 185, 145, 88],
  [0.82, 177, 119, 87],
  [0.94, 220, 211, 186],
  [1.00, 241, 241, 226],
];

export function setupCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

function rampColor(t) {
  const value = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i += 1) {
    if (value <= RAMP[i][0]) {
      const a = RAMP[i - 1];
      const b = RAMP[i];
      const f = (value - a[0]) / (b[0] - a[0]);
      return [
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
      ];
    }
  }
  return RAMP[RAMP.length - 1].slice(1);
}

function rgba(color, alpha = 1) {
  return `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${alpha})`;
}

function elevationExtents(terrain) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < terrain.elevation.length; i += 1) {
    min = Math.min(min, terrain.elevation[i]);
    max = Math.max(max, terrain.elevation[i]);
  }
  return { min, max, range: Math.max(1, max - min) };
}

function mapViewport(width, height, terrain) {
  const pad = Math.max(10, Math.min(width, height) * 0.025);
  const scale = Math.min(
    (width - pad * 2) / terrain.width,
    (height - pad * 2) / terrain.height,
  );
  const mapWidth = terrain.width * scale;
  const mapHeight = terrain.height * scale;
  return {
    x: (width - mapWidth) / 2,
    y: (height - mapHeight) / 2,
    width: mapWidth,
    height: mapHeight,
    scale,
    pad,
  };
}

function createTerrainRaster(terrain, mask) {
  const { width, height, elevation } = terrain;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const { min, range } = elevationExtents(terrain);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      const left = elevation[y * width + Math.max(0, x - 1)];
      const right = elevation[y * width + Math.min(width - 1, x + 1)];
      const up = elevation[Math.max(0, y - 1) * width + x];
      const down = elevation[Math.min(height - 1, y + 1) * width + x];
      const shade = Math.max(0.62, Math.min(1.34,
        1 + ((left - right) * 0.75 + (up - down) * 0.55) / range * 4.8));
      const color = rampColor((elevation[cell] - min) / range);
      let r = color[0] * shade;
      let g = color[1] * shade;
      let b = color[2] * shade;
      if (mask && mask[cell]) {
        r = r * 0.78 + 211 * 0.22;
        g = g * 0.87 + 157 * 0.13;
        b = b * 0.94 + 83 * 0.06;
      }
      const offset = cell * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function drawGridTexture(ctx, viewport, terrain) {
  const { width, height, x, y, scale } = viewport;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.strokeStyle = 'rgba(210, 239, 229, 0.035)';
  ctx.lineWidth = 0.5;
  const step = scale * 8;
  for (let gx = x + step; gx < x + width; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
    ctx.stroke();
  }
  for (let gy = y + step; gy < y + height; gy += step) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
    ctx.stroke();
  }
  const vignette = ctx.createRadialGradient(
    x + width * 0.5,
    y + height * 0.44,
    Math.min(width, height) * 0.2,
    x + width * 0.5,
    y + height * 0.44,
    Math.max(width, height) * 0.74,
  );
  vignette.addColorStop(0, 'rgba(3, 10, 13, 0)');
  vignette.addColorStop(1, 'rgba(3, 10, 13, 0.48)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawDeposition(ctx, simulation, viewport, showDeposits) {
  if (!showDeposits) return;
  const { terrain, cumulativeDeposition } = simulation;
  const { x, y, scale } = viewport;
  let max = 0.0001;
  for (let i = 0; i < cumulativeDeposition.length; i += 1) {
    max = Math.max(max, cumulativeDeposition[i]);
  }
  ctx.save();
  for (let cell = 0; cell < cumulativeDeposition.length; cell += 1) {
    const deposit = cumulativeDeposition[cell];
    if (deposit < 0.005) continue;
    const cx = x + ((cell % terrain.width) + 0.5) * scale;
    const cy = y + (Math.floor(cell / terrain.width) + 0.5) * scale;
    const strength = Math.min(1, 0.25 + Math.sqrt(deposit / max) * 0.75);
    const size = Math.max(1.15, scale * (0.42 + strength * 0.55));
    ctx.fillStyle = `rgba(229, 164, 95, ${0.16 + strength * 0.56})`;
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  }
  ctx.restore();
}

function drawAffectedMask(ctx, simulation, viewport) {
  const { terrain, affectedMask, editCenter } = simulation;
  if (!affectedMask || !affectedMask.some((value) => value)) return;
  const { x, y, scale } = viewport;
  const cellSize = Math.max(1, scale);
  ctx.save();
  ctx.fillStyle = 'rgba(236, 183, 91, 0.18)';
  ctx.strokeStyle = 'rgba(255, 203, 120, 0.62)';
  ctx.lineWidth = 0.6;
  for (let cell = 0; cell < affectedMask.length; cell += 1) {
    if (!affectedMask[cell]) continue;
    const cx = cell % terrain.width;
    const cy = Math.floor(cell / terrain.width);
    const px = x + cx * scale;
    const py = y + cy * scale;
    ctx.fillRect(px, py, cellSize, cellSize);
    if (cx === 0 || !affectedMask[cell - 1]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + cellSize);
      ctx.stroke();
    }
    if (cx === terrain.width - 1 || !affectedMask[cell + 1]) {
      ctx.beginPath();
      ctx.moveTo(px + cellSize, py);
      ctx.lineTo(px + cellSize, py + cellSize);
      ctx.stroke();
    }
    if (cy === 0 || !affectedMask[cell - terrain.width]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + cellSize, py);
      ctx.stroke();
    }
    if (cy === terrain.height - 1 || !affectedMask[cell + terrain.width]) {
      ctx.beginPath();
      ctx.moveTo(px, py + cellSize);
      ctx.lineTo(px + cellSize, py + cellSize);
      ctx.stroke();
    }
  }
  if (editCenter) {
    ctx.strokeStyle = 'rgba(255, 218, 153, 0.86)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(
      x + (editCenter.x + 0.5) * scale,
      y + (editCenter.y + 0.5) * scale,
      Math.max(3, editCenter.radius * scale),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawRivers(ctx, simulation, viewport, showRivers) {
  if (!showRivers) return;
  const { terrain, routing, hydrology } = simulation;
  const { receiver } = routing;
  const { upstream } = hydrology;
  const { x, y, scale } = viewport;
  const groups = [
    { threshold: 12, width: 0.55, color: 'rgba(91, 220, 208, 0.58)' },
    { threshold: 70, width: 0.95, color: 'rgba(105, 238, 219, 0.76)' },
    { threshold: 450, width: 1.55, color: 'rgba(133, 248, 228, 0.9)' },
    { threshold: 2200, width: 2.35, color: 'rgba(183, 255, 237, 0.97)' },
  ];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(72, 238, 216, 0.42)';
  ctx.shadowBlur = 7;
  for (const group of groups) {
    ctx.beginPath();
    for (let cell = 0; cell < upstream.length; cell += 1) {
      if (upstream[cell] < group.threshold) continue;
      const next = receiver[cell];
      if (next < 0) continue;
      const cx = cell % terrain.width;
      const cy = Math.floor(cell / terrain.width);
      const nx = next % terrain.width;
      const ny = Math.floor(next / terrain.width);
      ctx.moveTo(x + (cx + 0.5) * scale, y + (cy + 0.5) * scale);
      ctx.lineTo(x + (nx + 0.5) * scale, y + (ny + 0.5) * scale);
    }
    ctx.strokeStyle = group.color;
    ctx.lineWidth = group.width;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawOutlet(ctx, simulation, viewport) {
  const { terrain } = simulation;
  const { x, y, scale } = viewport;
  const cx = x + (terrain.outletX + 0.5) * scale;
  const cy = y + (terrain.outletY + 0.5) * scale;
  ctx.save();
  ctx.strokeStyle = 'rgba(152, 255, 235, 0.32)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(182, 255, 241, 0.15)';
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#c2fff1';
  ctx.shadowColor = '#7effe6';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(199, 241, 233, 0.76)';
  ctx.font = '600 6px "SFMono-Regular", monospace';
  ctx.fillText('OUTLET', cx + 5, cy + 11);
  ctx.restore();
}

function drawTransect(ctx, simulation, viewport, profileRow) {
  const { x, y, width, scale } = viewport;
  const rowY = y + (profileRow + 0.5) * scale;
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(232, 182, 110, 0.34)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x + 1, rowY);
  ctx.lineTo(x + width - 1, rowY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(232, 182, 110, 0.82)';
  ctx.font = '600 6px "SFMono-Regular", monospace';
  ctx.fillText('A', x + 4, rowY - 4);
  ctx.fillText('A′', x + width - 13, rowY - 4);
  ctx.restore();
}

function drawBrush(ctx, hover, viewport) {
  if (!hover) return;
  const { x, y, scale } = viewport;
  const cx = x + (hover.x + 0.5) * scale;
  const cy = y + (hover.y + 0.5) * scale;
  ctx.save();
  ctx.strokeStyle = hover.tool === 'carve'
    ? 'rgba(255, 142, 112, 0.94)'
    : 'rgba(103, 228, 207, 0.94)';
  ctx.fillStyle = hover.tool === 'carve'
    ? 'rgba(255, 123, 91, 0.09)'
    : 'rgba(103, 228, 207, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, hover.radius * scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(225, 245, 239, 0.65)';
  ctx.font = '6px "SFMono-Regular", monospace';
  ctx.fillText(`${hover.x}, ${hover.y}`, cx + 6, cy - 7);
  ctx.restore();
}

function drawMapScene(ctx, width, height, simulation, options = {}) {
  const { showRivers = true, showDeposits = true, profileRow = 36, hover = null } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#081116';
  ctx.fillRect(0, 0, width, height);
  const viewport = mapViewport(width, height, simulation.terrain);
  const raster = createTerrainRaster(simulation.terrain, simulation.affectedMask);
  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster, viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.restore();
  drawGridTexture(ctx, viewport, simulation.terrain);
  drawAffectedMask(ctx, simulation, viewport);
  drawDeposition(ctx, simulation, viewport, showDeposits);
  drawRivers(ctx, simulation, viewport, showRivers);
  drawTransect(ctx, simulation, viewport, profileRow);
  drawOutlet(ctx, simulation, viewport);
  drawBrush(ctx, hover, viewport);
  ctx.strokeStyle = 'rgba(116, 160, 164, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
  return viewport;
}

export function renderMap(canvas, simulation, options = {}) {
  const { ctx, width, height } = setupCanvas(canvas);
  return drawMapScene(ctx, width, height, simulation, options);
}

export function mapCellFromEvent(canvas, simulation, event) {
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const viewport = mapViewport(rect.width, rect.height, simulation.terrain);
  const x = Math.floor((px - viewport.x) / viewport.scale);
  const y = Math.floor((py - viewport.y) / viewport.scale);
  if (x < 0 || x >= simulation.terrain.width || y < 0 || y >= simulation.terrain.height) {
    return null;
  }
  return { x, y };
}

export function mapElevationExtents(simulation) {
  return elevationExtents(simulation.terrain);
}

export function mapChannelSummary(simulation) {
  return channelMetrics(simulation);
}

function normalizeExtents(terrain, row) {
  let min = Infinity;
  let max = -Infinity;
  for (let x = 0; x < terrain.width; x += 1) {
    const value = terrain.elevation[row * terrain.width + x];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min: min - 18, max: max + 26, range: Math.max(80, max - min + 44) };
}

function drawProfileGrid(ctx, plot, extents) {
  ctx.save();
  ctx.strokeStyle = 'rgba(137, 170, 170, 0.1)';
  ctx.fillStyle = 'rgba(105, 132, 135, 0.62)';
  ctx.lineWidth = 0.7;
  ctx.font = '6px "SFMono-Regular", monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) {
    const y = plot.y + (plot.height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    const value = extents.max - (extents.range / 4) * i;
    ctx.fillText(`${Math.round(value)}`, plot.x - 5, y + 2);
  }
  ctx.strokeStyle = 'rgba(143, 173, 172, 0.19)';
  for (let i = 0; i <= 4; i += 1) {
    const x = plot.x + (plot.width / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(95, 119, 122, 0.62)';
  ctx.fillText('0 km', plot.x, plot.y + plot.height + 9);
  ctx.textAlign = 'right';
  ctx.fillText('2.69 km', plot.x + plot.width, plot.y + plot.height + 9);
  ctx.fillStyle = 'rgba(95, 119, 122, 0.5)';
  ctx.textAlign = 'left';
  ctx.fillText('m', 7, plot.y + 5);
  ctx.restore();
}

export function renderProfile(canvas, simulation, row) {
  const { ctx, width, height } = setupCanvas(canvas);
  const { terrain, hydrology, cumulativeDeposition } = simulation;
  const profileRow = Math.max(0, Math.min(terrain.height - 1, row));
  const plot = { x: 34, y: 7, width: Math.max(10, width - 47), height: Math.max(20, height - 22) };
  const extents = normalizeExtents(terrain, profileRow);
  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, 'rgba(17, 32, 38, 0.5)');
  bg.addColorStop(1, 'rgba(6, 12, 16, 0.45)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  drawProfileGrid(ctx, plot, extents);

  const xAt = (x) => plot.x + (x / (terrain.width - 1)) * plot.width;
  const yAt = (value) => plot.y + ((extents.max - value) / extents.range) * plot.height;
  const baseline = plot.y + plot.height;
  const surface = [];
  for (let x = 0; x < terrain.width; x += 1) {
    const value = terrain.elevation[profileRow * terrain.width + x];
    surface.push([xAt(x), yAt(value)]);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.width, plot.height);
  ctx.clip();
  const fill = ctx.createLinearGradient(0, plot.y, 0, baseline);
  fill.addColorStop(0, 'rgba(100, 120, 105, 0.58)');
  fill.addColorStop(0.35, 'rgba(52, 73, 73, 0.77)');
  fill.addColorStop(1, 'rgba(12, 22, 26, 0.96)');
  ctx.beginPath();
  ctx.moveTo(surface[0][0], baseline);
  for (const [x, y] of surface) ctx.lineTo(x, y);
  ctx.lineTo(surface[surface.length - 1][0], baseline);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.strokeStyle = 'rgba(232, 182, 110, 0.22)';
  ctx.lineWidth = 0.6;
  for (let i = 0; i < terrain.width; i += 5) {
    const cell = profileRow * terrain.width + i;
    if (cumulativeDeposition[cell] < 0.003) continue;
    const x = xAt(i);
    const y = yAt(terrain.elevation[cell] - Math.min(8, cumulativeDeposition[cell] * 8));
    ctx.beginPath();
    ctx.moveTo(x, surface[i][1]);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.beginPath();
  for (let i = 0; i < surface.length; i += 1) {
    const [x, y] = surface[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#e8d9b5';
  ctx.lineWidth = 1.2;
  ctx.shadowColor = 'rgba(236, 220, 181, 0.25)';
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;

  for (let x = 0; x < terrain.width; x += 1) {
    const cell = profileRow * terrain.width + x;
    if (hydrology.upstream[cell] < 12) continue;
    const depth = 0.22 + Math.min(3.4, Math.log10(hydrology.upstream[cell] + 1) * 0.9);
    const y = yAt(terrain.elevation[cell]);
    const top = yAt(terrain.elevation[cell] + depth);
    ctx.fillStyle = 'rgba(101, 223, 214, 0.68)';
    ctx.fillRect(xAt(x) - 0.75, top, 1.5, Math.max(1, y - top));
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(238, 227, 198, 0.78)';
  ctx.font = '600 6px "SFMono-Regular", monospace';
  ctx.fillText('A', plot.x - 2, plot.y + 8);
  ctx.fillText('A′', plot.x + plot.width - 7, plot.y + 8);
}

export function createElevationExport(simulation, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 1180;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#071015';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(900, 250, 40, 900, 250, 850);
  glow.addColorStop(0, 'rgba(56, 137, 126, 0.14)');
  glow.addColorStop(1, 'rgba(7, 16, 21, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#dcebe7';
  ctx.font = '600 24px "Avenir Next", "TerraFlow Sans", "Noto Sans SC", sans-serif';
  ctx.fillText('TERRAFLOW / 山地高程与河网', 92, 72);
  ctx.fillStyle = '#5f777c';
  ctx.font = '12px "SFMono-Regular", monospace';
  ctx.fillText(`SEED ${simulation.terrain.seed ?? options.seed ?? '—'}  ·  RAIN ${simulation.params.rainfall} mm/h  ·  ROCK ${simulation.params.hardness.toFixed(2)} ×  ·  T ${simulation.simTime.toFixed(1)} a`, 94, 96);

  ctx.save();
  ctx.translate(0, 128);
  drawMapScene(ctx, canvas.width, 840, simulation, {
    showRivers: true,
    showDeposits: true,
    profileRow: options.profileRow ?? 36,
  });
  ctx.restore();

  const legendY = 1028;
  ctx.fillStyle = 'rgba(15, 29, 35, 0.9)';
  ctx.strokeStyle = 'rgba(125, 166, 167, 0.2)';
  ctx.fillRect(92, legendY, 516, 58);
  ctx.strokeRect(92, legendY, 516, 58);
  const gradient = ctx.createLinearGradient(112, 0, 424, 0);
  for (let i = 0; i < RAMP.length; i += 1) {
    gradient.addColorStop(RAMP[i][0], rgba(RAMP[i].slice(1)));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(112, legendY + 15, 312, 9);
  ctx.fillStyle = '#72868a';
  ctx.font = '9px "SFMono-Regular", monospace';
  ctx.fillText('ELEVATION', 112, legendY + 43);
  ctx.textAlign = 'right';
  ctx.fillText('LOW', 424, legendY + 43);
  ctx.textAlign = 'left';
  ctx.fillText('HIGH', 444, legendY + 22);
  ctx.fillStyle = '#96a9aa';
  ctx.fillText(`${Math.round(options.min)} — ${Math.round(options.max)} m`, 444, legendY + 44);

  ctx.fillStyle = '#526b70';
  ctx.font = '9px "SFMono-Regular", monospace';
  ctx.fillText(`FLOW ERROR ${options.conservationError ?? '—'}  /  CHANNEL ${options.channelLength ?? '—'} km`, 94, 1120);
  ctx.textAlign = 'right';
  ctx.fillText('SINGLE OUTLET · D8 ROUTING · CONTINUOUS CHANNEL', 1706, 1120);
  return canvas;
}
