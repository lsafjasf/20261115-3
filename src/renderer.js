import { PUMP_SPECS, ZONE_SPECS } from './simulation.js';

const FONT = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';
const MONO = '"Cascadia Code", "Noto Sans SC", Consolas, monospace';

export function createSceneRenderer(canvas) {
  const context = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(320, bounds.width);
    const nextHeight = Math.max(300, bounds.height);
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  function draw(state, time) {
    resize();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const geometry = getGeometry();
    drawBackdrop(context, geometry, time);
    drawPower(context, geometry, state, time);
    drawCity(context, geometry, state, time);
    drawPumps(context, geometry, state, time);
    drawRiver(context, geometry, state, time);
    drawRain(context, geometry, state, time);
    drawSceneLabels(context, geometry, state);
  }

  function getGeometry() {
    const busY = Math.max(108, height * 0.205);
    const cityTop = Math.max(busY + 48, height * 0.28);
    const cityBottom = height * 0.605;
    const riverBase = height * 0.715;
    const stationY = cityBottom + 5;
    const centers = [width * 0.25, width * 0.51, width * 0.77];
    return {
      width,
      height,
      busY,
      cityTop,
      cityBottom,
      cityHeight: cityBottom - cityTop,
      riverBase,
      riverTop: riverBase - Math.max(0, 0),
      stationY,
      centers,
      tileWidth: Math.min(width * 0.225, 245)
    };
  }

  return { draw, resize };
}

function drawBackdrop(ctx, g, time) {
  const gradient = ctx.createLinearGradient(0, 0, 0, g.height);
  gradient.addColorStop(0, 'rgba(14, 35, 47, 0.85)');
  gradient.addColorStop(0.55, 'rgba(6, 19, 27, 0.68)');
  gradient.addColorStop(1, 'rgba(4, 13, 20, 0.9)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, g.width, g.height);

  ctx.save();
  ctx.strokeStyle = 'rgba(111, 170, 181, 0.055)';
  ctx.lineWidth = 1;
  const step = 46;
  for (let x = -g.height; x < g.width + g.height; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - g.height, g.height);
    ctx.stroke();
  }
  for (let y = 0; y < g.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(g.width, y);
    ctx.stroke();
  }
  ctx.restore();

  const glow = ctx.createRadialGradient(
    g.width * 0.53,
    g.height * 0.44,
    10,
    g.width * 0.53,
    g.height * 0.44,
    g.width * 0.55
  );
  glow.addColorStop(0, 'rgba(39, 112, 124, 0.11)');
  glow.addColorStop(1, 'rgba(39, 112, 124, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, g.width, g.height);

  const pulse = 0.5 + Math.sin(time * 0.0011) * 0.5;
  ctx.fillStyle = `rgba(105, 234, 217, ${0.015 + pulse * 0.015})`;
  ctx.fillRect(0, g.riverBase, g.width, g.height - g.riverBase);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, ratio) {
  return start + (end - start) * ratio;
}

function text(ctx, value, x, y, size = 10, color = 'rgba(207, 229, 229, 0.82)', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function monoText(ctx, value, x, y, size = 9, color = 'rgba(134, 166, 173, 0.9)') {
  ctx.font = `500 ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function statusColor(pump, state) {
  if (pump.faulted) return '#ff6f68';
  if (pump.repairing) return '#f6c66b';
  if (!state.bus.tripped && pump.on) return pump.color;
  return 'rgba(133, 165, 172, 0.83)';
}

function pumpForZone(state, zoneId) {
  return PUMP_SPECS.find((spec) => spec.zoneId === zoneId)
    ? state.pumps[PUMP_SPECS.find((spec) => spec.zoneId === zoneId).id]
    : null;
}

function zoneSpec(zoneId) {
  return ZONE_SPECS.find((spec) => spec.id === zoneId);
}

function drawPower(ctx, g, state, time) {
  const startX = g.width * 0.075;
  const endX = g.width * 0.93;
  const y = g.busY;
  const load = state.bus.loadPct;
  const healthy = !state.bus.tripped;
  const busColor = !healthy
    ? 'rgba(255, 111, 104, 0.72)'
    : load > 100
      ? '#ff9d5c'
      : load > 90
        ? '#f6c66b'
        : '#69ead9';

  ctx.save();
  const trunkGlow = ctx.createLinearGradient(startX, 0, endX, 0);
  trunkGlow.addColorStop(0, 'rgba(105, 234, 217, 0.14)');
  trunkGlow.addColorStop(0.5, healthy ? 'rgba(105, 234, 217, 0.32)' : 'rgba(255, 111, 104, 0.24)');
  trunkGlow.addColorStop(1, 'rgba(105, 234, 217, 0.14)');
  ctx.strokeStyle = trunkGlow;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(endX, y);
  ctx.stroke();

  ctx.strokeStyle = busColor;
  ctx.lineWidth = 1.1;
  ctx.setLineDash(healthy ? [] : [5, 5]);
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(endX, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const particleSpeed = 0.025 + Math.min(load, 140) * 0.00055;
  const particleCount = 13;
  for (let index = 0; index < particleCount; index += 1) {
    const x = startX + ((time * particleSpeed + index * 83) % (endX - startX));
    ctx.globalAlpha = healthy ? 0.55 + Math.sin(index + time * 0.004) * 0.25 : 0.2;
    ctx.fillStyle = busColor;
    ctx.beginPath();
    ctx.arc(x, y, healthy ? 1.6 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawTransformer(ctx, startX, y, healthy, busColor, time);

  const stationXs = g.centers;
  for (let index = 0; index < PUMP_SPECS.length; index += 1) {
    const spec = PUMP_SPECS[index];
    const nodeX = stationXs[index];
    const pump = state.pumps[spec.id];
    ctx.strokeStyle = healthy
      ? pump.faulted
        ? 'rgba(255, 111, 104, 0.33)'
        : 'rgba(105, 234, 217, 0.2)'
      : 'rgba(255, 111, 104, 0.17)';
    ctx.lineWidth = 1;
    ctx.setLineDash(healthy ? [3, 5] : [2, 6]);
    ctx.beginPath();
    ctx.moveTo(nodeX, y + 3);
    ctx.lineTo(nodeX, g.stationY - 17);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = healthy ? 'rgba(105, 234, 217, 0.52)' : 'rgba(255, 111, 104, 0.48)';
    ctx.beginPath();
    ctx.arc(nodeX, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const hospitalX = g.centers[1] - g.tileWidth * 0.3;
  const hospitalY = g.cityTop + g.cityHeight * 0.33;
  ctx.strokeStyle =
    state.hospital.source === 'generator'
      ? 'rgba(246, 198, 107, 0.5)'
      : healthy
        ? 'rgba(255, 126, 120, 0.44)'
        : 'rgba(255, 111, 104, 0.2)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash(state.hospital.source === 'generator' ? [2, 4] : [5, 4]);
  ctx.beginPath();
  ctx.moveTo(hospitalX, y + 2);
  ctx.lineTo(hospitalX, hospitalY - 15);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!healthy) {
    const sparkX = lerp(startX, endX, 0.68);
    for (let index = 0; index < 3; index += 1) {
      ctx.strokeStyle = `rgba(255, 160, 102, ${0.25 + Math.sin(time * 0.01 + index) * 0.15})`;
      ctx.beginPath();
      ctx.moveTo(sparkX + index * 4, y - 3);
      ctx.lineTo(sparkX + 9 + index * 3, y - 11);
      ctx.lineTo(sparkX + 5 + index * 3, y - 15);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawTransformer(ctx, x, y, healthy, color, time) {
  ctx.save();
  roundedRect(ctx, x - 19, y - 15, 38, 30, 5);
  ctx.fillStyle = 'rgba(11, 29, 38, 0.96)';
  ctx.fill();
  ctx.strokeStyle = healthy ? 'rgba(105, 234, 217, 0.35)' : 'rgba(255, 111, 104, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.arc(x - 8 + index * 8, y, 5, -Math.PI / 2, Math.PI / 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.38 + Math.sin(time * 0.003 + index) * 0.12;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = healthy ? '#69ead9' : '#ff6f68';
  ctx.beginPath();
  ctx.arc(x, y - 12, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCity(ctx, g, state, time) {
  ZONE_SPECS.forEach((spec, index) => {
    const zone = state.zones[spec.id];
    const pump = pumpForZone(state, spec.id);
    const center = g.centers[index];
    const tileWidth = g.tileWidth;
    const x = center - tileWidth / 2;
    const y = g.cityTop;
    const tileHeight = g.cityHeight;
    const dangerRatio = clamp(
      (zone.level - 0.16) / (zone.threshold + 0.08),
      0,
      1.08
    );
    const waterTop = y + tileHeight * (1 - dangerRatio * 0.78);
    const warning = zone.level > zone.threshold - 0.1;
    const color = warning ? '#ff9d5c' : pump.color;

    ctx.save();
    roundedRect(ctx, x, y, tileWidth, tileHeight, 13);
    const base = ctx.createLinearGradient(x, y, x, y + tileHeight);
    base.addColorStop(0, 'rgba(20, 44, 54, 0.88)');
    base.addColorStop(1, 'rgba(9, 27, 36, 0.92)');
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = warning
      ? 'rgba(255, 157, 92, 0.4)'
      : 'rgba(120, 177, 185, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    roundedRect(ctx, x, y, tileWidth, tileHeight, 13);
    ctx.clip();

    ctx.fillStyle = 'rgba(112, 180, 172, 0.025)';
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        ctx.fillRect(
          x + 10 + col * ((tileWidth - 18) / 8),
          y + 15 + row * ((tileHeight - 25) / 7),
          2,
          2
        );
      }
    }

    drawDistrictBuildings(ctx, spec.id, x, y, tileWidth, tileHeight, time);

    const waterGradient = ctx.createLinearGradient(0, waterTop, 0, y + tileHeight);
    waterGradient.addColorStop(
      0,
      warning ? 'rgba(255, 145, 91, 0.03)' : 'rgba(101, 169, 220, 0.03)'
    );
    waterGradient.addColorStop(
      0.3,
      warning ? 'rgba(255, 145, 91, 0.15)' : 'rgba(73, 146, 200, 0.17)'
    );
    waterGradient.addColorStop(
      1,
      warning ? 'rgba(255, 111, 104, 0.29)' : 'rgba(35, 107, 160, 0.32)'
    );
    ctx.fillStyle = waterGradient;
    ctx.beginPath();
    ctx.moveTo(x, waterTop);
    for (let px = 0; px <= tileWidth; px += 8) {
      const wave =
        Math.sin(px * 0.07 + time * 0.0016 + index * 1.8) * 2.4 +
        Math.sin(px * 0.13 - time * 0.001 + index) * 1.1;
      ctx.lineTo(x + px, waterTop + wave);
    }
    ctx.lineTo(x + tileWidth, y + tileHeight);
    ctx.lineTo(x, y + tileHeight);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = warning
      ? 'rgba(255, 157, 92, 0.38)'
      : 'rgba(109, 185, 225, 0.24)';
    ctx.beginPath();
    for (let px = 0; px <= tileWidth; px += 6) {
      const wave = Math.sin(px * 0.07 + time * 0.0016 + index * 1.8) * 2.4;
      if (px === 0) ctx.moveTo(x, waterTop + wave);
      else ctx.lineTo(x + px, waterTop + wave);
    }
    ctx.stroke();

    if (warning) {
      ctx.fillStyle = `rgba(255, 157, 92, ${0.035 + Math.sin(time * 0.004) * 0.012})`;
      ctx.fillRect(x, y, tileWidth, tileHeight);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(5, 15, 21, 0.72)';
    roundedRect(ctx, x + 8, y + 8, tileWidth - 16, 30, 7);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 17, y + 18, 3, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, spec.name, x + 25, y + 22, 9.5, 'rgba(220, 238, 237, 0.9)', 550);
    monoText(
      ctx,
      `${zone.level.toFixed(2)} m`,
      x + tileWidth - 14,
      y + 22,
      9,
      warning ? '#ffb37b' : 'rgba(122, 190, 196, 0.95)'
    );

    const thresholdText = `阈值 ${zone.threshold.toFixed(2)}`;
    monoText(ctx, thresholdText, x + 10, y + tileHeight - 8, 7.5, warning ? '#ff9d5c' : 'rgba(117, 151, 158, 0.8)');

    if (zone.flooded) {
      ctx.fillStyle = 'rgba(255, 111, 104, 0.16)';
      roundedRect(ctx, x + 8, y + 8, tileWidth - 16, tileHeight - 16, 8);
      ctx.fill();
      text(ctx, '进水', x + tileWidth - 38, y + tileHeight - 22, 10, '#ff8d86', 700);
    }
    ctx.restore();
  });
}

function drawDistrictBuildings(ctx, zoneId, x, y, width, height, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(42, 79, 88, 0.72)';
  ctx.strokeStyle = 'rgba(120, 183, 188, 0.15)';
  ctx.lineWidth = 1;

  if (zoneId === 'old') {
    for (let index = 0; index < 5; index += 1) {
      const bx = x + 18 + index * (width / 6.2);
      const bh = 20 + (index % 3) * 8;
      const by = y + height * 0.48 - bh;
      ctx.fillRect(bx, by, width / 9, bh);
      ctx.strokeRect(bx, by, width / 9, bh);
      ctx.beginPath();
      ctx.moveTo(bx - 2, by);
      ctx.lineTo(bx + width / 18, by - 9);
      ctx.lineTo(bx + width / 9 + 2, by);
      ctx.closePath();
      ctx.fillStyle = 'rgba(60, 101, 107, 0.75)';
      ctx.fill();
      ctx.fillStyle = 'rgba(42, 79, 88, 0.72)';
    }
  } else if (zoneId === 'hospital') {
    const bx = x + width * 0.29;
    const by = y + height * 0.29;
    ctx.fillStyle = 'rgba(67, 88, 95, 0.86)';
    roundedRect(ctx, bx, by, width * 0.44, height * 0.32, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 126, 120, 0.25)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 126, 120, 0.8)';
    ctx.fillRect(x + width / 2 - 2, by + 8, 4, 20);
    ctx.fillRect(x + width / 2 - 10, by + 16, 20, 4);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        ctx.fillStyle = `rgba(122, 180, 187, ${0.1 + Math.sin(time * 0.001 + row + col) * 0.03})`;
        ctx.fillRect(bx + 7 + col * 11, by + 26 + row * 8, 4, 3);
      }
    }
  } else {
    for (let index = 0; index < 6; index += 1) {
      const bw = 11 + (index % 2) * 5;
      const bh = 23 + (index % 4) * 10;
      const bx = x + 17 + index * (width / 6.7);
      const by = y + height * 0.51 - bh;
      ctx.fillStyle = `rgba(${44 + index * 3}, ${82 + index * 3}, ${92 + index * 2}, 0.78)`;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      for (let row = 0; row < Math.floor(bh / 8); row += 1) {
        ctx.fillStyle = 'rgba(105, 164, 173, 0.18)';
        ctx.fillRect(bx + 3, by + 5 + row * 7, 3, 2);
      }
    }
  }
  ctx.restore();
}

function riverSurfaceY(g, state) {
  return g.riverBase - (state.river.level - 5.02) * g.height * 0.16;
}

function drawPumps(ctx, g, state, time) {
  const riverY = riverSurfaceY(g, state);
  PUMP_SPECS.forEach((spec, index) => {
    const pump = state.pumps[spec.id];
    const centerX = g.centers[index];
    const buildingWidth = Math.min(63, g.tileWidth * 0.32);
    const buildingHeight = 31;
    const buildingX = centerX - buildingWidth / 2;
    const buildingY = g.stationY;
    const color = statusColor(pump, state);
    const active = pump.running && !state.bus.tripped;
    const flowRatio = pump.flow / pump.maxFlow;

    ctx.save();
    const pipeGradient = ctx.createLinearGradient(centerX, buildingY, centerX, riverY);
    pipeGradient.addColorStop(0, active ? 'rgba(105, 234, 217, 0.5)' : 'rgba(85, 121, 128, 0.22)');
    pipeGradient.addColorStop(1, active ? 'rgba(88, 185, 207, 0.75)' : 'rgba(65, 100, 110, 0.23)');
    ctx.strokeStyle = 'rgba(3, 12, 17, 0.8)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(centerX, buildingY + buildingHeight - 3);
    ctx.bezierCurveTo(
      centerX,
      buildingY + 38,
      centerX + 5,
      riverY - 27,
      centerX - 4,
      riverY + 3
    );
    ctx.stroke();
    ctx.strokeStyle = pipeGradient;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (active && flowRatio > 0.02) {
      const particleCount = 4;
      for (let particle = 0; particle < particleCount; particle += 1) {
        const progress =
          ((time * (0.00009 + flowRatio * 0.00011) + particle / particleCount) % 1);
        const point = cubicPoint(
          centerX,
          buildingY + 28,
          centerX,
          buildingY + 38,
          centerX + 5,
          riverY - 27,
          centerX - 4,
          riverY + 3,
          progress
        );
        ctx.globalAlpha = 0.25 + Math.sin(progress * Math.PI) * 0.58;
        ctx.fillStyle = '#8ff5e8';
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.4 + flowRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = active
      ? 'rgba(97, 189, 199, 0.39)'
      : 'rgba(75, 108, 115, 0.2)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, g.cityBottom - 3);
    ctx.lineTo(centerX, buildingY + 2);
    ctx.stroke();
    if (active) {
      const intakeOffset = (time * 0.0013 + index * 0.27) % 1;
      ctx.fillStyle = 'rgba(110, 200, 218, 0.7)';
      ctx.beginPath();
      ctx.arc(centerX, lerp(g.cityBottom - 3, buildingY + 2, intakeOffset), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (active) {
      ctx.shadowBlur = 17;
      ctx.shadowColor = `${spec.color}44`;
    }
    roundedRect(ctx, buildingX, buildingY, buildingWidth, buildingHeight, 5);
    const buildingGradient = ctx.createLinearGradient(
      buildingX,
      buildingY,
      buildingX,
      buildingY + buildingHeight
    );
    buildingGradient.addColorStop(0, active ? 'rgba(49, 79, 86, 0.98)' : 'rgba(32, 55, 63, 0.96)');
    buildingGradient.addColorStop(1, 'rgba(13, 32, 40, 0.98)');
    ctx.fillStyle = buildingGradient;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = active ? `${spec.color}bb` : 'rgba(131, 170, 175, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = active ? `${spec.color}2d` : 'rgba(91, 127, 133, 0.16)';
    ctx.fillRect(buildingX + 5, buildingY + 5, buildingWidth - 10, 7);
    ctx.fillStyle = active ? `${spec.color}9e` : 'rgba(109, 143, 149, 0.3)';
    ctx.fillRect(buildingX + 5, buildingY + 5, (buildingWidth - 10) * (pump.on ? pump.speed / 100 : 0), 2);

    drawRotor(ctx, centerX + buildingWidth * 0.26, buildingY + 21, pump, active, time);
    ctx.fillStyle = active ? 'rgba(105, 234, 217, 0.3)' : 'rgba(100, 144, 149, 0.22)';
    ctx.fillRect(buildingX + 8, buildingY + 19, 10, 4);
    ctx.fillRect(buildingX + 8, buildingY + 25, 17, 2);

    if (pump.surgeMinutes > 0 && active) {
      ctx.strokeStyle = `rgba(246, 198, 107, ${0.35 + Math.sin(time * 0.015) * 0.18})`;
      ctx.lineWidth = 1;
      for (let arc = 0; arc < 2; arc += 1) {
        ctx.beginPath();
        ctx.arc(
          centerX,
          buildingY + buildingHeight / 2,
          17 + arc * 4 + Math.sin(time * 0.01 + arc) * 2,
          -1.2,
          0.9
        );
        ctx.stroke();
      }
    }

    if (pump.faulted || pump.repairing) {
      ctx.fillStyle = 'rgba(255, 111, 104, 0.94)';
      ctx.beginPath();
      ctx.moveTo(centerX + buildingWidth / 2 - 6, buildingY - 8);
      ctx.lineTo(centerX + buildingWidth / 2 + 6, buildingY - 8);
      ctx.lineTo(centerX + buildingWidth / 2, buildingY + 1);
      ctx.closePath();
      ctx.fill();
      monoText(ctx, '!', centerX + buildingWidth / 2 - 1.5, buildingY + 0.5, 7, '#2c1112');
    }

    const labelWidth = 78;
    ctx.fillStyle = 'rgba(4, 14, 19, 0.74)';
    roundedRect(ctx, centerX - labelWidth / 2, buildingY + 36, labelWidth, 20, 5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX - labelWidth / 2 + 8, buildingY + 46, 2.3, 0, Math.PI * 2);
    ctx.fill();
    text(
      ctx,
      `${spec.id} · ${spec.shortName}`,
      centerX - labelWidth / 2 + 14,
      buildingY + 49,
      8,
      'rgba(215, 235, 234, 0.9)',
      550
    );
    monoText(
      ctx,
      active ? `${pump.speed}%` : pump.faulted ? 'FAULT' : 'OFF',
      centerX + labelWidth / 2 - 7,
      buildingY + 49,
      7.3,
      active ? spec.color : 'rgba(126, 154, 160, 0.72)'
    );

    ctx.restore();
  });
}

function drawRotor(ctx, x, y, pump, active, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = active ? pump.color : 'rgba(107, 145, 150, 0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.stroke();
  const angle = active ? time * (0.001 + pump.speed * 0.000035) : 0;
  for (let index = 0; index < 3; index += 1) {
    const bladeAngle = angle + (index * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(bladeAngle) * 4.2, Math.sin(bladeAngle) * 4.2);
    ctx.stroke();
  }
  ctx.restore();
}

function cubicPoint(x0, y0, x1, y1, x2, y2, x3, y3, t) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * x0 +
      3 * inverse ** 2 * t * x1 +
      3 * inverse * t ** 2 * x2 +
      t ** 3 * x3,
    y:
      inverse ** 3 * y0 +
      3 * inverse ** 2 * t * y1 +
      3 * inverse * t ** 2 * y2 +
      t ** 3 * y3
  };
}

function drawRiver(ctx, g, state, time) {
  const surfaceY = riverSurfaceY(g, state);
  const dangerY =
    g.riverBase - (state.river.danger - 5.02) * g.height * 0.16;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, surfaceY);
  for (let x = 0; x <= g.width; x += 9) {
    const wave =
      Math.sin(x * 0.024 + time * 0.0011) * 2.2 +
      Math.sin(x * 0.051 - time * 0.0007) * 1.2;
    ctx.lineTo(x, surfaceY + wave);
  }
  ctx.lineTo(g.width, g.height);
  ctx.lineTo(0, g.height);
  ctx.closePath();
  const water = ctx.createLinearGradient(0, surfaceY, 0, g.height);
  water.addColorStop(0, 'rgba(33, 91, 114, 0.8)');
  water.addColorStop(0.45, 'rgba(14, 52, 74, 0.91)');
  water.addColorStop(1, 'rgba(5, 25, 39, 0.98)');
  ctx.fillStyle = water;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, surfaceY, g.width, g.height - surfaceY);
  ctx.clip();
  for (let row = 0; row < 7; row += 1) {
    const y = surfaceY + 17 + row * 22;
    ctx.strokeStyle = `rgba(119, 198, 205, ${0.075 - row * 0.007})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = 0; x <= g.width; x += 8) {
      const wave =
        Math.sin(x * 0.016 + time * (0.00055 + row * 0.00004) + row * 1.7) * 4;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  for (let index = 0; index < 18; index += 1) {
    const x = ((index * 137 + time * (0.005 + index * 0.00008)) % (g.width + 40)) - 20;
    const y = surfaceY + 24 + ((index * 31) % Math.max(40, g.height - surfaceY - 35));
    ctx.fillStyle = `rgba(128, 218, 217, ${0.05 + (index % 3) * 0.025})`;
    ctx.fillRect(x, y, 12 + (index % 4) * 6, 1);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 157, 92, 0.56)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(0, dangerY);
  ctx.lineTo(g.width, dangerY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 157, 92, 0.85)';
  roundedRect(ctx, g.width - 115, dangerY - 17, 96, 13, 3);
  ctx.fill();
  monoText(
    ctx,
    `警戒 ${state.river.danger.toFixed(2)} m`,
    g.width - 109,
    dangerY - 8,
    7,
    'rgba(36, 21, 12, 0.95)'
  );

  ctx.strokeStyle = 'rgba(134, 201, 205, 0.24)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, surfaceY);
  for (let x = 0; x <= g.width; x += 9) {
    const wave =
      Math.sin(x * 0.024 + time * 0.0011) * 2.2 +
      Math.sin(x * 0.051 - time * 0.0007) * 1.2;
    ctx.lineTo(x, surfaceY + wave);
  }
  ctx.stroke();

  text(ctx, '沿 江 河 道', g.width * 0.075, surfaceY + 36, 10, 'rgba(130, 182, 193, 0.45)', 500);
  monoText(
    ctx,
    `LEVEL ${state.river.level.toFixed(2)}M  ·  FLOW ${(state.river.inflow / 1).toFixed(0)} M³/S`,
    g.width * 0.075,
    surfaceY + 51,
    7,
    'rgba(109, 155, 166, 0.48)'
  );
  ctx.restore();
}

function drawRain(ctx, g, state, time) {
  const intensity = clamp(state.storm.rain / 120, 0.15, 1);
  const count = Math.round(34 + intensity * 74);
  ctx.save();
  ctx.lineCap = 'round';
  for (let index = 0; index < count; index += 1) {
    const seed = pseudoRandom(index + 1);
    const speed = 0.07 + seed * 0.08 + intensity * 0.07;
    const x = (seed * g.width + time * speed * 0.34) % (g.width + 50) - 20;
    const y =
      (pseudoRandom(index + 91) * (g.height + 80) + time * speed) %
        (g.height + 80) -
      40;
    const length = 7 + seed * 13 + intensity * 9;
    ctx.strokeStyle = `rgba(151, 196, 220, ${0.06 + intensity * 0.13 + seed * 0.035})`;
    ctx.lineWidth = seed > 0.72 ? 1 : 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - length * 0.34, y + length);
    ctx.stroke();
  }

  const flashSignal = Math.sin(state.t * 0.41) * Math.cos(state.t * 0.17);
  if (flashSignal > 0.91) {
    ctx.fillStyle = `rgba(206, 238, 255, ${(flashSignal - 0.91) * 0.36})`;
    ctx.fillRect(0, 0, g.width, g.height * 0.72);
  }
  ctx.restore();
}

function drawSceneLabels(ctx, g, state) {
  ctx.save();
  const labelX = g.width * 0.58;
  const loadColor =
    state.bus.tripped || state.bus.loadPct > 100
      ? '#ff817a'
      : state.bus.loadPct > 90
        ? '#f6c66b'
        : 'rgba(143, 211, 207, 0.8)';
  monoText(
    ctx,
    `SHARED BUS · ${state.bus.current.toFixed(0)} / ${state.bus.capacity} A`,
    labelX,
    g.busY - 13,
    7.5,
    loadColor
  );
  ctx.strokeStyle = 'rgba(105, 234, 217, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(labelX - 8, g.busY);
  ctx.lineTo(labelX - 2, g.busY);
  ctx.stroke();

  const hospitalX = g.centers[1] - g.tileWidth * 0.3;
  const hospitalY = g.cityTop + g.cityHeight * 0.33;
  ctx.fillStyle =
    state.hospital.source === 'generator'
      ? 'rgba(246, 198, 107, 0.92)'
      : 'rgba(255, 126, 120, 0.9)';
  roundedRect(ctx, hospitalX + 7, hospitalY - 8, 48, 13, 3);
  ctx.fill();
  monoText(
    ctx,
    state.hospital.source === 'generator' ? 'GEN 24A' : 'BUS 24A',
    hospitalX + 11,
    hospitalY + 1,
    6.5,
    'rgba(28, 18, 12, 0.95)'
  );
  ctx.restore();
}

function pseudoRandom(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
