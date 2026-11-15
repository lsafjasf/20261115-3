(() => {
  "use strict";

  const canvas = document.querySelector("#cloud-canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const dom = {
    density: document.querySelector("#density"),
    densityValue: document.querySelector("#density-value"),
    wind: document.querySelector("#wind"),
    windValue: document.querySelector("#wind-value"),
    sun: document.querySelector("#sun"),
    sunValue: document.querySelector("#sun-value"),
    view: document.querySelector("#view"),
    viewValue: document.querySelector("#view-value"),
    viewReadout: document.querySelector("#view-readout"),
    qualityMeta: document.querySelector("#quality-meta"),
    pauseButton: document.querySelector("#pause-button"),
    pauseLabel: document.querySelector("#pause-label"),
    shotButton: document.querySelector("#shot-button"),
    verifyButton: document.querySelector("#verify-button"),
    verifyState: document.querySelector("#verify-state"),
    verifyDetail: document.querySelector("#verify-detail"),
    livePill: document.querySelector("#live-pill"),
    liveLabel: document.querySelector("#live-label"),
    fps: document.querySelector("#fps-value"),
    frame: document.querySelector("#frame-value"),
    cluster: document.querySelector("#cluster-value"),
    caption: document.querySelector("#scene-caption"),
    toast: document.querySelector("#toast"),
    drawer: document.querySelector("#compare-drawer"),
    compareGrid: document.querySelector("#compare-grid"),
    openCompare: document.querySelector("#open-compare"),
    closeCompare: document.querySelector("#close-compare"),
    loading: document.querySelector("#loading-screen"),
  };

  const QUALITY = {
    low: { label: "低", particles: 1260, dpr: 0.85, sprite: 72, mist: 0.82 },
    medium: { label: "高", particles: 2240, dpr: 1, sprite: 96, mist: 1 },
    ultra: { label: "极致", particles: 3640, dpr: 1.5, sprite: 112, mist: 1.16 },
  };

  const CLUSTER_LAYOUT = [
    { x: -27, y: 5.2, z: 44, rx: 8.0, ry: 1.7, rz: 3.1, drift: 0.78 },
    { x: -13, y: 5.5, z: 39, rx: 6.2, ry: 1.8, rz: 2.8, drift: 0.91 },
    { x: 2, y: 4.95, z: 43, rx: 8.7, ry: 1.5, rz: 3.4, drift: 0.7 },
    { x: 17, y: 5.3, z: 37, rx: 6.7, ry: 1.9, rz: 2.6, drift: 0.84 },
    { x: 29, y: 5.05, z: 45, rx: 7.1, ry: 1.55, rz: 3.5, drift: 0.74 },
    { x: -19, y: 4.15, z: 28, rx: 5.8, ry: 1.35, rz: 2.2, drift: 0.89 },
    { x: -6, y: 4.2, z: 26, rx: 6.5, ry: 1.6, rz: 2.5, drift: 1.02 },
    { x: 8, y: 4.55, z: 29, rx: 5.7, ry: 1.75, rz: 2.0, drift: 0.94 },
    { x: -1.5, y: 6.2, z: 31, rx: 4.5, ry: 2.15, rz: 2.7, drift: 0.76 },
    { x: 22, y: 3.9, z: 24, rx: 5.1, ry: 1.15, rz: 1.9, drift: 0.82 },
    { x: -11, y: 3.1, z: 17.5, rx: 5.3, ry: 1.1, rz: 1.8, drift: 0.67 },
    { x: 3, y: 2.95, z: 15.5, rx: 5.6, ry: 1.0, rz: 1.7, drift: 0.63 },
    { x: 13.5, y: 3.15, z: 18.5, rx: 4.2, ry: 0.9, rz: 1.6, drift: 0.71 },
    { x: 3.2, y: 2.15, z: 9.8, rx: 2.9, ry: 0.84, rz: 1.2, drift: 0.27 },
    { x: -6.4, y: 2.05, z: 13, rx: 3.1, ry: 0.76, rz: 1.3, drift: 0.24 },
  ];

  const state = {
    paused: false,
    simTime: 0,
    windOffset: 0,
    simFrames: 0,
    density: 0.92,
    wind: 7,
    sunHeight: 14,
    yaw: 0,
    pitch: 2.2,
    quality: "medium",
  };

  let clouds = [];
  let sprites = null;
  const scratch = {
    layer: null,
    layerCtx: null,
    rim: null,
    rimCtx: null,
    width: 0,
    height: 0,
    scale: 0,
  };
  let renderDpr = 1;
  let needsRender = true;
  let lastFrameTime = performance.now();
  let toastTimer = 0;
  let verifying = false;
  let fpsSample = { frames: 0, since: performance.now() };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const deg = (value) => (value * Math.PI) / 180;
  const mod = (value, span) => ((value % span) + span) % span;
  const wrapDelta = (value, span) => mod(value + span * 0.5, span) - span * 0.5;

  function mulberry32(seed) {
    return () => {
      let value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mixColor(a, b, t) {
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
    ];
  }

  function rgba(color, alpha) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
  }

  function buildClouds() {
    const preset = QUALITY[state.quality];
    const random = mulberry32(0x5e1c10 + preset.particles);
    const perCluster = Math.floor(preset.particles / CLUSTER_LAYOUT.length);
    const remainder = preset.particles - perCluster * CLUSTER_LAYOUT.length;

    clouds = CLUSTER_LAYOUT.map((definition, clusterIndex) => {
      const lobeCount = 4 + Math.floor(random() * 4);
      const lobes = [];
      for (let lobeIndex = 0; lobeIndex < lobeCount; lobeIndex += 1) {
        lobes.push({
          x: (random() - 0.5) * definition.rx * 1.05,
          y: (random() - 0.55) * definition.ry * 0.82,
          z: (random() - 0.5) * definition.rz * 0.9,
          rx: definition.rx * (0.24 + random() * 0.27),
          ry: definition.ry * (0.34 + random() * 0.34),
          rz: definition.rz * (0.25 + random() * 0.3),
        });
      }

      const count = perCluster + (clusterIndex < remainder ? 1 : 0);
      const puffs = [];
      for (let puffIndex = 0; puffIndex < count; puffIndex += 1) {
        const lobe = lobes[Math.floor(random() * lobes.length)];
        const u = random() * 2 - 1;
        const v = random() * 2 - 1;
        const w = random() * 2 - 1;
        const length = Math.sqrt(u * u + v * v + w * w) || 1;
        const shell = Math.pow(random(), 0.56);
        puffs.push({
          x: lobe.x + (u / length) * lobe.rx * shell,
          y: lobe.y + (v / length) * lobe.ry * shell - definition.ry * 0.08,
          z: lobe.z + (w / length) * lobe.rz * shell,
          size: 0.14 + random() * 0.31,
          alpha: 0.34 + random() * 0.46,
          shade: random(),
          rim: random(),
          phase: random() * Math.PI * 2,
        });
      }

      return {
        ...definition,
        index: clusterIndex,
        phase: random() * Math.PI * 2,
        puffs,
      };
    });
  }

  function resizeCanvas(force = false) {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const preset = QUALITY[state.quality];
    const targetDpr = Math.min(preset.dpr, 2);
    const nextDpr = force ? targetDpr : Math.min(targetDpr, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * nextDpr);
    const pixelHeight = Math.round(height * nextDpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    renderDpr = nextDpr;
    needsRender = true;
  }

  function getCamera(params, viewWidth = window.innerWidth) {
    const width = Math.max(1, viewWidth);
    const focal = Math.max(width * 0.88, 360);
    return {
      x: 0,
      y: 2.65,
      z: 0,
      focal,
      yaw: deg(params.yaw),
      pitch: deg(params.pitch),
    };
  }

  function projectPoint(point, camera, width, height) {
    const dx = point.x - camera.x;
    const dy = point.y - camera.y;
    const dz = point.z - camera.z;
    const cy = Math.cos(camera.yaw);
    const sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch);
    const sp = Math.sin(camera.pitch);
    const x1 = dx * cy - dz * sy;
    const z1 = dx * sy + dz * cy;
    const y1 = dy * cp - z1 * sp;
    const depth = dy * sp + z1 * cp;
    return {
      x: width * 0.5 + (x1 / Math.max(depth, 0.01)) * camera.focal,
      y: height * 0.5 - (y1 / Math.max(depth, 0.01)) * camera.focal,
      depth,
    };
  }

  function getClusterPosition(cluster, params) {
    return {
      x: cluster.x + wrapDelta(params.windOffset * cluster.drift, 104),
      y: cluster.y + Math.sin(params.simTime * 0.17 + cluster.phase) * 0.17,
      z: cluster.z + Math.sin(params.simTime * 0.1 + cluster.phase * 1.7) * 0.42,
    };
  }

  function makeCloudMaskSprite(size) {
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const spriteCtx = sprite.getContext("2d");
    const center = size * 0.5;
    const gradient = spriteCtx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.62, "rgba(255, 255, 255, 0.98)");
    gradient.addColorStop(0.84, "rgba(255, 255, 255, 0.64)");
    gradient.addColorStop(0.96, "rgba(255, 255, 255, 0.12)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    spriteCtx.fillStyle = gradient;
    spriteCtx.fillRect(0, 0, size, size);
    return sprite;
  }

  function rebuildCloudSprites() {
    const warm = clamp(1 - (state.sunHeight + 4) / 44, 0.06, 1);
    const nearShadow = mixColor([118, 132, 143], [64, 76, 97], warm);
    const nearLit = mixColor([255, 249, 234], [255, 196, 134], warm);
    const nearRim = mixColor([255, 251, 239], [255, 169, 101], warm);
    const fogShadow = mixColor([136, 151, 154], [118, 126, 137], warm);
    const fogLit = mixColor([229, 229, 220], [225, 210, 196], warm);
    const fogRim = mixColor([251, 241, 225], [244, 210, 177], warm);
    const size = QUALITY[state.quality].sprite;
    sprites = {
      mask: makeCloudMaskSprite(size),
      near: { lit: nearLit, shadow: nearShadow, rim: nearRim },
      mid: {
        lit: mixColor(nearLit, fogLit, 0.48),
        shadow: mixColor(nearShadow, fogShadow, 0.55),
        rim: mixColor(nearRim, fogRim, 0.42),
      },
      far: {
        lit: fogLit,
        shadow: fogShadow,
        rim: fogRim,
      },
    };
  }

  function ensureScratch(width, height, scale) {
    const pixelWidth = Math.max(1, Math.ceil(width * scale));
    const pixelHeight = Math.max(1, Math.ceil(height * scale));
    if (!scratch.layer) {
      scratch.layer = document.createElement("canvas");
      scratch.layerCtx = scratch.layer.getContext("2d");
      scratch.rim = document.createElement("canvas");
      scratch.rimCtx = scratch.rim.getContext("2d");
    }
    if (
      scratch.layer.width !== pixelWidth ||
      scratch.layer.height !== pixelHeight ||
      scratch.width !== width ||
      scratch.height !== height ||
      scratch.scale !== scale
    ) {
      [scratch.layer, scratch.rim].forEach((buffer) => {
        buffer.width = pixelWidth;
        buffer.height = pixelHeight;
      });
      scratch.width = width;
      scratch.height = height;
      scratch.scale = scale;
    }
    scratch.layerCtx.setTransform(scale, 0, 0, scale, 0, 0);
    scratch.rimCtx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function getSun(camera, width, height, params) {
    const azimuth = -0.16;
    const elevation = deg(params.sunHeight);
    const direction = {
      x: Math.sin(azimuth) * Math.cos(elevation),
      y: Math.sin(elevation),
      z: Math.cos(azimuth) * Math.cos(elevation),
    };
    const cy = Math.cos(camera.yaw);
    const sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch);
    const sp = Math.sin(camera.pitch);
    const x1 = direction.x * cy - direction.z * sy;
    const z1 = direction.x * sy + direction.z * cy;
    const y1 = direction.y * cp - z1 * sp;
    const depth = direction.y * sp + z1 * cp;
    return {
      x: width * 0.5 + (x1 / Math.max(depth, 0.01)) * camera.focal,
      y: height * 0.5 - (y1 / Math.max(depth, 0.01)) * camera.focal,
      depth,
      visible: clamp((params.sunHeight + 5) / 8, 0, 1) * clamp(depth * 8, 0, 1),
    };
  }

  function drawSky(target, width, height, camera, sun, params) {
    const horizon = height * 0.5 + Math.tan(camera.pitch) * camera.focal;
    const warm = clamp(1 - (params.sunHeight + 4) / 44, 0.04, 1);
    const top = mixColor([12, 27, 37], [19, 37, 45], warm * 0.3);
    const middle = mixColor([57, 89, 95], [101, 105, 101], warm * 0.5);
    const horizonColor = mixColor([145, 177, 173], [221, 152, 108], warm);
    const sky = target.createLinearGradient(0, 0, 0, Math.max(horizon, height * 0.55));
    sky.addColorStop(0, rgba(top, 1));
    sky.addColorStop(0.48, rgba(middle, 1));
    sky.addColorStop(0.8, rgba(mixColor(middle, horizonColor, 0.55), 1));
    sky.addColorStop(1, rgba(horizonColor, 1));
    target.fillStyle = sky;
    target.fillRect(0, 0, width, height);

    if (sun.visible > 0.01) {
      const glowX = clamp(sun.x, -width * 0.2, width * 1.2);
      const glowY = clamp(sun.y, height * 0.04, horizon);
      const radius = Math.max(width, height) * 0.62;
      const glow = target.createRadialGradient(glowX, glowY, 0, glowX, glowY, radius);
      glow.addColorStop(0, rgba(mixColor([255, 235, 203], [255, 191, 130], warm), 0.44 * sun.visible));
      glow.addColorStop(0.15, rgba([250, 190, 138], 0.21 * sun.visible));
      glow.addColorStop(0.48, rgba([223, 161, 119], 0.08 * sun.visible));
      glow.addColorStop(1, "rgba(223, 161, 119, 0)");
      target.save();
      target.globalCompositeOperation = "screen";
      target.fillStyle = glow;
      target.fillRect(0, 0, width, height);
      target.restore();

      if (sun.x > -20 && sun.x < width + 20 && sun.y < horizon + 8) {
        const diskRadius = clamp(13 + params.sunHeight * 0.2, 13, 23);
        const disk = target.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, diskRadius * 2.5);
        disk.addColorStop(0, `rgba(255, 252, 237, ${0.96 * sun.visible})`);
        disk.addColorStop(0.35, `rgba(255, 236, 204, ${0.9 * sun.visible})`);
        disk.addColorStop(1, `rgba(255, 206, 153, 0)`);
        target.fillStyle = disk;
        target.beginPath();
        target.arc(sun.x, sun.y, diskRadius * 2.5, 0, Math.PI * 2);
        target.fill();
      }
    }

    drawSea(target, width, height, horizon, sun, params, horizonColor);
    drawIslandRidges(target, width, height, horizon);
    return horizon;
  }

  function drawSea(target, width, height, horizon, sun, params, horizonColor) {
    const top = Math.max(0, horizon - 2);
    const seaHeight = Math.max(12, height - top);
    const sea = target.createLinearGradient(0, top, 0, height);
    sea.addColorStop(0, rgba(mixColor(horizonColor, [25, 56, 61], 0.52), 1));
    sea.addColorStop(0.22, "#193a40");
    sea.addColorStop(0.68, "#10282d");
    sea.addColorStop(1, "#081719");
    target.fillStyle = sea;
    target.fillRect(0, top, width, seaHeight);

    target.save();
    target.beginPath();
    target.rect(0, top, width, seaHeight);
    target.clip();

    for (let line = 0; line < 24; line += 1) {
      const t = line / 23;
      const y = top + Math.pow(t, 1.55) * seaHeight;
      const offset = Math.sin(line * 8.7) * width * 0.18;
      const lineGradient = target.createLinearGradient(0, y, width, y + 1);
      lineGradient.addColorStop(0, "rgba(176, 209, 204, 0)");
      lineGradient.addColorStop(0.35, `rgba(176, 209, 204, ${0.045 + t * 0.035})`);
      lineGradient.addColorStop(0.68, "rgba(176, 209, 204, 0)");
      target.fillStyle = lineGradient;
      target.fillRect(offset, y, width, 0.7);
    }

    if (sun.visible > 0.01) {
      const sunColor = mixColor([255, 246, 224], [255, 177, 109], clamp(1 - params.sunHeight / 45, 0, 1));
      for (let glint = 0; glint < 38; glint += 1) {
        const t = glint / 37;
        const y = top + Math.pow(t, 1.45) * seaHeight;
        const wobble = Math.sin(params.simTime * 0.7 + glint * 2.13) * 8 * t;
        const glintWidth = (7 + t * 104) * (0.45 + 0.55 * Math.abs(Math.sin(glint * 4.7 + params.simTime * 0.16)));
        const alpha = (0.3 - t * 0.21) * sun.visible;
        target.fillStyle = rgba(sunColor, Math.max(0, alpha));
        target.fillRect(sun.x - glintWidth * 0.5 + wobble, y, glintWidth, 1.1 + t * 1.2);
      }
    }
    target.restore();
  }

  function drawIslandRidges(target, width, height, horizon) {
    const layers = [
      { amp: 20, color: "rgba(89, 111, 112, 0.5)", offset: 7, phase: 0.9 },
      { amp: 12, color: "rgba(57, 81, 81, 0.62)", offset: 14, phase: 2.6 },
      { amp: 6, color: "rgba(28, 52, 52, 0.62)", offset: 20, phase: 4 },
    ];
    for (const layer of layers) {
      target.beginPath();
      target.moveTo(0, height);
      target.lineTo(0, horizon + layer.offset);
      const step = Math.max(5, Math.round(width / 170));
      for (let x = 0; x <= width + step; x += step) {
        const profile =
          Math.sin(x * 0.008 + layer.phase) * 0.58 +
          Math.sin(x * 0.021 + layer.phase * 1.7) * 0.27 +
          Math.sin(x * 0.047 + layer.phase * 0.7) * 0.15;
        const ridge = horizon + layer.offset - Math.max(0, profile) * layer.amp;
        target.lineTo(x, ridge);
      }
      target.lineTo(width, height);
      target.closePath();
      target.fillStyle = layer.color;
      target.fill();
    }

    const mist = target.createLinearGradient(0, horizon - 18, 0, horizon + 30);
    mist.addColorStop(0, "rgba(211, 178, 147, 0)");
    mist.addColorStop(0.55, "rgba(182, 160, 144, 0.2)");
    mist.addColorStop(1, "rgba(102, 125, 124, 0)");
    target.fillStyle = mist;
    target.fillRect(0, horizon - 18, width, 48);
  }

  function drawDepthMist(target, width, height, horizon, params) {
    const amount = QUALITY[state.quality].mist;
    const mist = target.createLinearGradient(0, height * 0.28, 0, Math.min(height, horizon + height * 0.16));
    mist.addColorStop(0, "rgba(187, 198, 194, 0)");
    mist.addColorStop(0.48, `rgba(196, 192, 181, ${0.035 * amount})`);
    mist.addColorStop(0.78, `rgba(214, 190, 167, ${0.095 * amount})`);
    mist.addColorStop(1, "rgba(206, 178, 155, 0)");
    target.fillStyle = mist;
    target.fillRect(0, height * 0.28, width, height * 0.6);

    if (params.sunHeight < 18) {
      const band = target.createLinearGradient(0, horizon - height * 0.16, 0, horizon + height * 0.1);
      band.addColorStop(0, "rgba(231, 199, 171, 0)");
      band.addColorStop(0.6, `rgba(231, 191, 156, ${0.05 * amount})`);
      band.addColorStop(1, "rgba(231, 191, 156, 0)");
      target.fillStyle = band;
      target.fillRect(0, horizon - height * 0.16, width, height * 0.28);
    }
  }

  function collectCloudPuffs(width, height, camera, params, sun) {
    const projected = [];
    const densitySize = 0.78 + params.density * 0.36;
    const densityGain = 0.58 + params.density * 0.62;

    clouds.forEach((cluster) => {
      const center = getClusterPosition(cluster, params);
      cluster.puffs.forEach((puff) => {
        const turbulence = Math.sin(params.simTime * 0.64 + puff.phase) * 0.026;
        const driftX = Math.sin(params.simTime * 0.29 + puff.phase * 1.4) * 0.034;
        const world = {
          x: center.x + puff.x + driftX,
          y: center.y + puff.y + turbulence,
          z: center.z + puff.z + Math.cos(params.simTime * 0.22 + puff.phase) * 0.024,
        };
        const point = projectPoint(world, camera, width, height);
        if (point.depth < 1.1) return;

        const radius = clamp(
          (camera.focal * puff.size * densitySize) / point.depth,
          0.75,
          Math.max(width, height) * 0.19,
        );
        const margin = radius * 2.4;
        if (
          point.x < -margin ||
          point.x > width + margin ||
          point.y < -margin ||
          point.y > height + margin
        ) {
          return;
        }

        const band = point.depth < 19 ? 0 : point.depth < 32 ? 1 : 2;
        const fogFade = 1 - band * 0.19;
        const baseOpacity = clamp(puff.alpha * densityGain * fogFade, 0, 1.15);
        projected.push({
          x: point.x,
          y: point.y,
          depth: point.depth,
          radius,
          alpha: baseOpacity,
          band,
          shade: puff.shade,
          rim: puff.rim,
          phase: puff.phase,
        });
      });
    });

    projected.sort((a, b) => b.depth - a.depth);
    return projected;
  }

  function drawCloudGroup(target, group, width, height, lightX, lightY, palette, opacity) {
    if (!group.length) return;
    const scale = clamp(target.getTransform().a, 1, 2);
    ensureScratch(width, height, scale);
    const layer = scratch.layerCtx;
    const rim = scratch.rimCtx;
    layer.clearRect(0, 0, width, height);
    layer.globalCompositeOperation = "source-over";
    layer.globalAlpha = 1;
    let cloudTop = height;
    let cloudBottom = 0;

    for (const puff of group) {
      const size = puff.radius * 2.38;
      layer.globalAlpha = clamp(puff.alpha * (0.55 + puff.shade * 0.1), 0, 0.92);
      layer.drawImage(
        sprites.mask,
        puff.x - size * 0.5,
        puff.y - size * 0.5,
        size,
        size,
      );
      cloudTop = Math.min(cloudTop, puff.y - puff.radius);
      cloudBottom = Math.max(cloudBottom, puff.y + puff.radius);
    }

    layer.globalAlpha = 1;
    layer.globalCompositeOperation = "source-atop";
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const span = Math.max(width, height) * 0.62;
    const tone = layer.createLinearGradient(
      centerX + lightX * span,
      centerY + lightY * span,
      centerX - lightX * span,
      centerY - lightY * span,
    );
    const midTone = mixColor(palette.lit, palette.shadow, 0.48);
    tone.addColorStop(0, rgba(palette.lit, 1));
    tone.addColorStop(0.44, rgba(midTone, 1));
    tone.addColorStop(1, rgba(palette.shadow, 1));
    layer.fillStyle = tone;
    layer.fillRect(0, 0, width, height);
    layer.globalCompositeOperation = "source-over";

    rim.clearRect(0, 0, width, height);
    rim.globalCompositeOperation = "source-over";
    rim.globalAlpha = 1;
    const rimDistance = clamp((cloudBottom - cloudTop) * 0.022 + 2.1, 2.1, 5);
    rim.drawImage(
      scratch.layer,
      lightX * rimDistance,
      lightY * rimDistance,
      width,
      height,
    );
    rim.globalCompositeOperation = "destination-out";
    rim.drawImage(scratch.layer, 0, 0, width, height);
    rim.globalCompositeOperation = "source-in";
    rim.fillStyle = rgba(palette.rim, 1);
    rim.fillRect(0, 0, width, height);
    rim.globalCompositeOperation = "source-over";

    target.save();
    target.imageSmoothingEnabled = true;
    target.globalAlpha = opacity;
    target.globalCompositeOperation = "source-over";
    target.drawImage(scratch.layer, 0, 0, width, height);
    target.globalAlpha = opacity * 0.96;
    target.globalCompositeOperation = "screen";
    target.drawImage(scratch.rim, 0, 0, width, height);
    target.restore();
  }

  function drawCloudField(target, width, height, horizon, camera, params, sun) {
    const puffs = collectCloudPuffs(width, height, camera, params, sun);
    if (!puffs.length || !sprites) return { puffs: 0, foreground: 0, fog: 0 };

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    let lightX = sun.x - centerX;
    let lightY = sun.y - centerY;
    const lightLength = Math.hypot(lightX, lightY) || 1;
    lightX /= lightLength;
    lightY /= lightLength;
    if (!Number.isFinite(lightX) || !Number.isFinite(lightY)) {
      lightX = 0.5;
      lightY = -0.86;
    }

    const groups = [[], [], []];
    let foreground = 0;
    let fogCoverage = 0;
    puffs.forEach((puff) => {
      groups[puff.band].push(puff);
      if (puff.depth < 21) foreground += 1;
      fogCoverage += puff.band === 0 ? 0.06 : puff.band === 1 ? 0.42 : 0.82;
    });

    drawCloudGroup(target, groups[2], width, height, lightX, lightY, sprites.far, 0.74);
    drawDepthMist(target, width, height, horizon, params);
    drawCloudGroup(target, groups[1], width, height, lightX, lightY, sprites.mid, 0.9);
    drawCloudGroup(target, groups[0], width, height, lightX, lightY, sprites.near, 1);

    return {
      puffs: puffs.length,
      foreground,
      fog: Math.round(clamp(fogCoverage / puffs.length, 0, 1) * 100),
    };
  }

  function renderScene(target, width, height, params) {
    const camera = getCamera(params, width);
    const sun = getSun(camera, width, height, params);
    const horizon = drawSky(target, width, height, camera, sun, params);
    const stats = drawCloudField(target, width, height, horizon, camera, params, sun);
    return { camera, sun, horizon, ...stats };
  }

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const percent = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${percent}%`);
  }

  function formatAngle(value) {
    if (Math.abs(value) < 0.05) return "0°";
    return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(Math.abs(value) % 1 ? 1 : 0)}°`;
  }

  function syncUI() {
    dom.density.value = String(Math.round(state.density * 100));
    dom.densityValue.textContent = `${Math.round(state.density * 100)}%`;
    dom.wind.value = String(state.wind);
    dom.windValue.textContent = `${state.wind.toFixed(1)} m/s`;
    dom.sun.value = String(state.sunHeight);
    dom.sunValue.textContent = `${state.sunHeight}°`;
    dom.view.value = String(state.yaw);
    dom.viewValue.textContent = `${formatAngle(state.yaw)}`;
    dom.viewReadout.textContent = formatAngle(state.yaw);
    dom.caption.textContent =
      `层积云 / 风向 ${state.wind.toFixed(1)} m/s / 太阳 ${state.sunHeight}°`;

    [dom.density, dom.wind, dom.sun, dom.view].forEach(updateRangeFill);
    document.querySelectorAll(".view-presets button[data-view]").forEach((button) => {
      const value = button.dataset.view;
      if (value === "current") return;
      button.classList.toggle("is-active", Math.abs(state.yaw - Number(value)) < 0.35);
    });

    dom.pauseButton.classList.toggle("is-paused", state.paused);
    dom.pauseButton.querySelector(".action-icon").textContent = state.paused ? "▶" : "Ⅱ";
    dom.pauseLabel.textContent = state.paused ? "继续" : "暂停";
    dom.livePill.classList.toggle("is-paused", state.paused);
    dom.liveLabel.textContent = state.paused ? "仿真已冻结" : "实时仿真";
    dom.fps.textContent = state.paused ? "--" : dom.fps.textContent;
    dom.frame.textContent = String(state.simFrames).padStart(5, "0");
    dom.cluster.textContent = String(clouds.length);
    dom.qualityMeta.textContent = `${QUALITY[state.quality].particles.toLocaleString("en-US")} 粒子`;
    document.querySelectorAll(".segmented button[data-quality]").forEach((button) => {
      const active = button.dataset.quality === state.quality;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setPaused(paused, options = {}) {
    const next = Boolean(paused);
    if (state.paused === next) {
      if (next) needsRender = true;
      if (!options.silent) {
        showToast(next ? "云层仿真已冻结" : "云层仿真继续");
      }
      return;
    }
    state.paused = next;
    needsRender = true;
    syncUI();
    if (!options.silent) {
      showToast(next ? "已暂停 / 风场, 粒子漂移与海面反光全部冻结" : "仿真继续 / 云层重新流动");
    }
  }

  function setView(value, options = {}) {
    state.yaw = clamp(Number(value), -32, 32);
    needsRender = true;
    syncUI();
    if (!options.silent && options.toast) {
      showToast(`${options.label || "机位"} / ${formatAngle(state.yaw)}`);
    }
  }

  function changeQuality(quality) {
    if (!QUALITY[quality] || quality === state.quality) return;
    state.quality = quality;
    buildClouds();
    rebuildCloudSprites();
    resizeCanvas(true);
    syncUI();
    needsRender = true;
    showToast(`质量切换为 ${QUALITY[quality].label} / ${QUALITY[quality].particles.toLocaleString("en-US")} 粒子`);
  }

  function renderMain() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    renderScene(ctx, width, height, state);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      dom.toast.classList.remove("is-visible");
    }, 2600);
  }

  function updateTelemetry(now) {
    fpsSample.frames += 1;
    const elapsed = now - fpsSample.since;
    if (elapsed >= 520) {
      const fps = Math.round((fpsSample.frames * 1000) / elapsed);
      dom.fps.textContent = String(clamp(fps, 1, 99));
      fpsSample = { frames: 0, since: now };
    }
    dom.frame.textContent = String(state.simFrames).padStart(5, "0");
  }

  function frameLoop(timestamp) {
    const delta = clamp((timestamp - lastFrameTime) / 1000, 0, 0.05);
    lastFrameTime = timestamp;

    if (!state.paused) {
      state.simTime += delta;
      state.windOffset += state.wind * delta * 0.075;
      state.simFrames += 1;
    }

    if (!state.paused || needsRender) {
      renderMain();
      needsRender = false;
    }
    if (!state.paused) updateTelemetry(timestamp);
    requestAnimationFrame(frameLoop);
  }

  function hashNumber(hash, value) {
    const quantized = Math.round(Number(value) * 100000);
    let next = hash ^ (quantized & 0xff);
    next = Math.imul(next, 16777619);
    next ^= (quantized >>> 8) & 0xff;
    next = Math.imul(next, 16777619);
    next ^= (quantized >>> 16) & 0xff;
    next = Math.imul(next, 16777619);
    next ^= (quantized >>> 24) & 0xff;
    return Math.imul(next, 16777619) >>> 0;
  }

  function hashString(hash, value) {
    let next = hash;
    for (let index = 0; index < value.length; index += 1) {
      next = Math.imul(next ^ value.charCodeAt(index), 16777619);
    }
    return next >>> 0;
  }

  function toHex(hash) {
    return hash.toString(16).padStart(8, "0");
  }

  function computeCloudSignature() {
    let hash = 2166136261;
    hash = hashString(hash, state.quality);
    hash = hashNumber(hash, window.innerWidth);
    hash = hashNumber(hash, window.innerHeight);
    hash = hashNumber(hash, state.paused ? 1 : 0);
    hash = hashNumber(hash, renderDpr);
    hash = hashNumber(hash, state.simFrames);
    hash = hashNumber(hash, state.simTime);
    hash = hashNumber(hash, state.windOffset);
    hash = hashNumber(hash, state.density);
    hash = hashNumber(hash, state.wind);
    hash = hashNumber(hash, state.sunHeight);
    hash = hashNumber(hash, state.yaw);
    hash = hashNumber(hash, state.pitch);
    hash = hashNumber(hash, clouds.length);

    clouds.forEach((cluster) => {
      const position = getClusterPosition(cluster, state);
      hash = hashNumber(hash, position.x);
      hash = hashNumber(hash, position.y);
      hash = hashNumber(hash, position.z);
      hash = hashNumber(hash, cluster.phase);
      hash = hashNumber(hash, cluster.puffs.length);
      cluster.puffs.forEach((puff) => {
        hash = hashNumber(hash, puff.x);
        hash = hashNumber(hash, puff.y);
        hash = hashNumber(hash, puff.z);
        hash = hashNumber(hash, puff.size);
        hash = hashNumber(hash, puff.alpha);
        hash = hashNumber(hash, puff.shade);
        hash = hashNumber(hash, puff.rim);
        hash = hashNumber(hash, puff.phase);
      });
    });
    return toHex(hash);
  }

  function getCanvasPixelSignature() {
    const sample = document.createElement("canvas");
    sample.width = 112;
    sample.height = 64;
    const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
    sampleCtx.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 4) {
      hash = Math.imul(hash ^ data[index], 16777619);
      hash = Math.imul(hash ^ data[index + 1], 16777619);
      hash = Math.imul(hash ^ data[index + 2], 16777619);
    }
    return toHex(hash >>> 0);
  }

  function getFreezeSnapshot() {
    return {
      paused: state.paused,
      simTime: state.simTime,
      simFrames: state.simFrames,
      particles: clouds.reduce((total, cluster) => total + cluster.puffs.length, 0),
      cloudHash: computeCloudSignature(),
      pixelHash: getCanvasPixelSignature(),
    };
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function runFreezeVerification(duration = 720, options = {}) {
    if (verifying) return null;
    verifying = true;
    dom.verifyButton.disabled = true;
    dom.verifyState.classList.remove("is-pass", "is-fail");
    dom.verifyState.textContent = "采样中...";
    dom.verifyDetail.textContent = "正在冻结全部云层参数";
    setPaused(true, { silent: true });
    await nextPaint();

    const first = getFreezeSnapshot();
    await new Promise((resolve) => window.setTimeout(resolve, duration));
    const second = getFreezeSnapshot();
    const paramStable = first.cloudHash === second.cloudHash;
    const pixelStable = first.pixelHash === second.pixelHash;
    const pass = paramStable && pixelStable;
    const result = {
      pass,
      paramStable,
      pixelStable,
      duration,
      first,
      second,
      particles: first.particles,
    };

    dom.verifyState.classList.add(pass ? "is-pass" : "is-fail");
    dom.verifyState.textContent = pass ? "PASS / 冻结无漂移" : "FAIL / 检测到漂移";
    dom.verifyDetail.textContent = pass
      ? `${first.particles.toLocaleString("en-US")} 粒子 / 参数 ${first.cloudHash} / 像素 ${first.pixelHash}`
      : `参数 ${first.cloudHash}>${second.cloudHash} / 像素 ${first.pixelHash}>${second.pixelHash}`;
    dom.verifyButton.disabled = false;
    verifying = false;

    if (!options.silent) {
      showToast(
        pass
          ? `冻结校验通过 / ${first.particles.toLocaleString("en-US")} 个粒子与画布像素均无变化`
          : "冻结校验失败 / 检出参数漂移",
      );
    }
    return result;
  }

  function takeScreenshot() {
    if (needsRender) renderMain();
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast("截图失败, 请重试");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      link.href = url;
      link.download = `stratus-cloud-${stamp}.png`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`截图已导出 / ${canvas.width} x ${canvas.height} px`);
    }, "image/png");
  }

  function renderCompareCard(cardCanvas, yaw) {
    const width = 432;
    const height = 192;
    const scale = 2;
    cardCanvas.width = width * scale;
    cardCanvas.height = height * scale;
    const cardCtx = cardCanvas.getContext("2d", { alpha: false });
    cardCtx.setTransform(scale, 0, 0, scale, 0, 0);
    return renderScene(cardCtx, width, height, { ...state, yaw });
  }

  function openCompareDrawer() {
    const views = [
      { yaw: -24, name: "左舷", angle: "-24°" },
      { yaw: 0, name: "正前", angle: "0°" },
      { yaw: 24, name: "右舷", angle: "+24°" },
    ];
    let nearest = 0;
    views.forEach((view, index) => {
      if (Math.abs(state.yaw - view.yaw) < Math.abs(state.yaw - views[nearest].yaw)) nearest = index;
    });

    dom.compareGrid.replaceChildren();
    views.forEach((view, index) => {
      const card = document.createElement("article");
      card.className = `compare-card${index === nearest ? " is-current" : ""}`;
      const preview = document.createElement("canvas");
      preview.setAttribute("aria-label", `${view.name}视角 ${view.angle} 的云层画面`);
      const stats = renderCompareCard(preview, view.yaw);
      const label = document.createElement("div");
      label.className = "compare-label";
      label.innerHTML = `<b>${view.name}</b><span>${view.angle}</span>`;
      const meta = document.createElement("span");
      meta.className = "compare-meta";
      meta.textContent = `可见 ${stats.puffs} / 雾 ${stats.fog}%`;
      card.append(preview, label, meta);
      dom.compareGrid.appendChild(card);
    });

    dom.drawer.classList.add("is-open");
    dom.drawer.setAttribute("aria-hidden", "false");
    dom.openCompare.setAttribute("aria-expanded", "true");
  }

  function closeCompareDrawer() {
    dom.drawer.classList.remove("is-open");
    dom.drawer.setAttribute("aria-hidden", "true");
    dom.openCompare.setAttribute("aria-expanded", "false");
  }

  function bindUI() {
    dom.density.addEventListener("input", (event) => {
      state.density = Number(event.target.value) / 100;
      needsRender = true;
      syncUI();
    });
    dom.wind.addEventListener("input", (event) => {
      state.wind = Number(event.target.value);
      needsRender = true;
      syncUI();
    });
    dom.sun.addEventListener("input", (event) => {
      state.sunHeight = Number(event.target.value);
      rebuildCloudSprites();
      needsRender = true;
      syncUI();
    });
    dom.view.addEventListener("input", (event) => {
      setView(Number(event.target.value));
    });

    document.querySelectorAll(".segmented button[data-quality]").forEach((button) => {
      button.addEventListener("click", () => changeQuality(button.dataset.quality));
    });

    document.querySelectorAll(".view-presets button[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.view;
        if (value === "current") return;
        const direction = Number(value);
        setView(direction, {
          toast: true,
          label: button.querySelector("span").textContent,
        });
      });
    });

    dom.pauseButton.addEventListener("click", () => setPaused(!state.paused));
    dom.shotButton.addEventListener("click", takeScreenshot);
    dom.verifyButton.addEventListener("click", () => {
      runFreezeVerification();
    });
    dom.openCompare.addEventListener("click", openCompareDrawer);
    dom.closeCompare.addEventListener("click", closeCompareDrawer);

    let dragState = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        yaw: state.yaw,
        pitch: state.pitch,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
      closeCompareDrawer();
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      state.yaw = clamp(dragState.yaw - dx * 0.11, -32, 32);
      state.pitch = clamp(dragState.pitch - dy * 0.055, -5, 12);
      needsRender = true;
      syncUI();
    });

    function finishDrag(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragState = null;
      canvas.classList.remove("is-dragging");
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }
    canvas.addEventListener("pointerup", finishDrag);
    canvas.addEventListener("pointercancel", finishDrag);

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        state.pitch = clamp(state.pitch + event.deltaY * 0.018, -5, 12);
        needsRender = true;
      },
      { passive: false },
    );

    canvas.addEventListener("dblclick", () => {
      state.yaw = 0;
      state.pitch = 2.2;
      needsRender = true;
      syncUI();
      showToast("机位已复位 / 正前 0°");
    });

    document.addEventListener("keydown", (event) => {
      const tagName = event.target.tagName;
      const editing = tagName === "INPUT" || tagName === "BUTTON" || tagName === "TEXTAREA";
      if (event.code === "Escape") {
        closeCompareDrawer();
        return;
      }
      if (editing) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPaused(!state.paused);
      } else if (event.code === "KeyS") {
        event.preventDefault();
        takeScreenshot();
      }
    });

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeCanvas(true);
        needsRender = true;
        if (dom.drawer.classList.contains("is-open")) openCompareDrawer();
      }, 90);
    });

    document.addEventListener("visibilitychange", () => {
      lastFrameTime = performance.now();
    });
  }

  function init() {
    resizeCanvas(true);
    buildClouds();
    rebuildCloudSprites();
    bindUI();
    syncUI();
    renderMain();
    window.setTimeout(() => dom.loading.classList.add("is-hidden"), 120);
    requestAnimationFrame((timestamp) => {
      lastFrameTime = timestamp;
      requestAnimationFrame(frameLoop);
    });
  }

  window.cloudLab = {
    get state() {
      return {
        ...state,
        particleCount: clouds.reduce((total, cluster) => total + cluster.puffs.length, 0),
      };
    },
    get signature() {
      return computeCloudSignature();
    },
    getSnapshot: getFreezeSnapshot,
    verifyFreeze: (duration = 720) => runFreezeVerification(duration),
    setPaused: (value) => setPaused(Boolean(value)),
    setView: (value) => setView(value),
    openCompare: () => openCompareDrawer(),
    closeCompare: () => closeCompareDrawer(),
    screenshot: takeScreenshot,
    render: renderMain,
    step: (delta = 1 / 60) => {
      if (!state.paused) {
        state.simTime += delta;
        state.windOffset += state.wind * delta * 0.075;
        state.simFrames += 1;
      }
      renderMain();
    },
  };

  init();
})();
