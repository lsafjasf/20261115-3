(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const app = document.getElementById("app");
  const layerControls = document.getElementById("layerControls");
  const clockNode = document.getElementById("clock");
  const fpsNode = document.getElementById("fpsValue");
  const particleNode = document.getElementById("particleCount");
  const cameraRange = document.getElementById("cameraRange");
  const cameraValue = document.getElementById("cameraValue");
  const cameraReadout = document.getElementById("cameraReadout");
  const farClearance = document.getElementById("farClearance");
  const farClearanceValue = document.getElementById("farClearanceValue");
  const autoPanButton = document.getElementById("autoPan");
  const dragHint = document.getElementById("dragHint");
  const toast = document.getElementById("toast");

  const QUALITY = {
    high: {
      label: "高清",
      dprCap: 2,
      renderScale: 1,
      fogBands: 9,
      fogWisps: 26,
      beams: 7,
      motes: 64,
      ridgeTexture: 150,
      beamGlow: true,
      fineAtmosphere: true,
    },
    low: {
      label: "流畅",
      dprCap: 1,
      renderScale: 0.8,
      fogBands: 4,
      fogWisps: 10,
      beams: 3,
      motes: 18,
      ridgeTexture: 34,
      beamGlow: false,
      fineAtmosphere: false,
    },
  };

  const ridgeDefs = [
    {
      id: "beyond",
      depth: 0.1,
      base: 0.492,
      amp: 0.084,
      color: "#748c82",
      alpha: 0.3,
      parallax: 0.035,
      seed: 7.3,
      rough: 0.28,
      peaks: [[0.05, 0.34, 0.11], [0.31, 0.58, 0.09], [0.58, 0.44, 0.12], [0.84, 0.73, 0.08], [1.03, 0.38, 0.1]],
    },
    {
      id: "far",
      depth: 0.2,
      base: 0.548,
      amp: 0.12,
      color: "#5d776e",
      alpha: 0.48,
      parallax: 0.075,
      seed: 14.1,
      rough: 0.3,
      peaks: [[-0.02, 0.38, 0.12], [0.22, 0.56, 0.08], [0.46, 0.46, 0.1], [0.71, 0.82, 0.11], [0.98, 0.48, 0.1], [1.18, 0.3, 0.08]],
    },
    {
      id: "range",
      depth: 0.32,
      base: 0.602,
      amp: 0.145,
      color: "#48655c",
      alpha: 0.7,
      parallax: 0.13,
      seed: 21.8,
      rough: 0.27,
      peaks: [[0.02, 0.33, 0.12], [0.22, 0.67, 0.1], [0.48, 0.58, 0.09], [0.66, 0.9, 0.08], [0.87, 0.43, 0.12], [1.1, 0.66, 0.09]],
    },
    {
      id: "middle",
      depth: 0.48,
      base: 0.676,
      amp: 0.165,
      color: "#304d46",
      alpha: 0.86,
      parallax: 0.2,
      seed: 28.4,
      rough: 0.24,
      peaks: [[-0.04, 0.42, 0.14], [0.17, 0.78, 0.12], [0.45, 0.56, 0.11], [0.64, 0.67, 0.1], [0.84, 0.54, 0.14], [1.12, 0.4, 0.12]],
    },
    {
      id: "near",
      depth: 0.7,
      base: 0.755,
      amp: 0.145,
      color: "#1b3833",
      alpha: 0.95,
      parallax: 0.33,
      seed: 36.7,
      rough: 0.2,
      peaks: [[-0.08, 0.4, 0.15], [0.1, 0.61, 0.11], [0.34, 0.84, 0.1], [0.57, 0.47, 0.16], [0.82, 0.72, 0.13], [1.08, 0.55, 0.1]],
    },
    {
      id: "forest",
      depth: 1,
      base: 0.895,
      amp: 0.107,
      color: "#091916",
      alpha: 1,
      parallax: 0.52,
      seed: 44.2,
      rough: 0.52,
      peaks: [[-0.12, 0.27, 0.18], [0.12, 0.38, 0.14], [0.4, 0.54, 0.12], [0.69, 0.3, 0.15], [0.9, 0.49, 0.14], [1.14, 0.34, 0.12]],
    },
  ];

  const fogDefs = [
    {
      id: "canopy",
      index: "01",
      name: "林梢流雾",
      depthLabel: "NEAR / 340 M",
      meters: "34–72 M",
      depth: 0.18,
      baseY: 0.738,
      spread: 0.105,
      distribution: 72,
      speed: 4.2,
      opacity: 0.22,
      scale: 0.82,
      tint: "214, 232, 220",
      parallax: 0.095,
      seed: 101,
    },
    {
      id: "waist",
      index: "02",
      name: "山腰横雾",
      depthLabel: "MID / 1.2 KM",
      meters: "48–96 M",
      depth: 0.38,
      baseY: 0.612,
      spread: 0.13,
      distribution: 54,
      speed: 2.2,
      opacity: 0.2,
      scale: 1.12,
      tint: "204, 225, 215",
      parallax: 0.16,
      seed: 211,
    },
    {
      id: "distant",
      index: "03",
      name: "远岫云海",
      depthLabel: "FAR / 4.8 KM",
      meters: "72–140 M",
      depth: 0.62,
      baseY: 0.505,
      spread: 0.15,
      distribution: 44,
      speed: 0.8,
      opacity: 0.24,
      scale: 1.38,
      tint: "197, 219, 213",
      parallax: 0.26,
      seed: 307,
    },
  ];

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    quality: "high",
    camera: 0,
    cameraTarget: 0,
    autoPan: true,
    dragging: false,
    pointerStartX: 0,
    pointerStartCamera: 0,
    farClearance: 0.42,
    elapsed: 0,
    lastFrame: 0,
    fps: 60,
    fpsFrames: 0,
    fpsAt: 0,
    frameCount: 0,
    toastTimer: 0,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const geometry = {
    ridges: [],
    textures: [],
    motes: [],
    fogBands: new Map(),
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(value) {
    return value * value * (3 - 2 * value);
  }

  function fract(value) {
    return value - Math.floor(value);
  }

  function hash(seed, x) {
    return fract(Math.sin(x * 127.1 + seed * 311.7) * 43758.5453123);
  }

  function valueNoise(seed, x) {
    const index = Math.floor(x);
    const fraction = x - index;
    return lerp(hash(seed, index), hash(seed, index + 1), smoothstep(fraction));
  }

  function fbm(seed, x) {
    return (
      valueNoise(seed, x) * 0.56 +
      valueNoise(seed + 7.1, x * 2.03) * 0.28 +
      valueNoise(seed + 13.7, x * 4.08) * 0.16
    );
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ridgeY(definition, x) {
    let peak = 0.06;
    for (const [center, height, width] of definition.peaks) {
      const distance = (x - center) / width;
      peak = Math.max(peak, height * Math.exp(-distance * distance * 1.5));
    }
    const texture = fbm(definition.seed, x * 10.5) - 0.5;
    const corrugation = Math.sin(x * 44 + definition.seed) * 0.08;
    return definition.base - definition.amp * (peak + (texture + corrugation) * definition.rough);
  }

  function buildSceneGeometry() {
    geometry.ridges = ridgeDefs.map((definition) => {
      const points = [];
      const steps = 104;
      for (let index = 0; index <= steps; index += 1) {
        const x = -0.24 + (index / steps) * 1.48;
        points.push({ x, y: ridgeY(definition, x) });
      }
      return points;
    });

    const textureRandom = mulberry32(8031);
    geometry.textures = ridgeDefs.map((definition, ridgeIndex) => {
      const count = QUALITY[state.quality].ridgeTexture * (1.05 - definition.depth * 0.55);
      return Array.from({ length: Math.round(count) }, () => ({
        x: textureRandom(),
        y: textureRandom(),
        length: 0.0015 + textureRandom() * 0.006,
        alpha: 0.012 + textureRandom() * 0.028,
        ridge: ridgeIndex,
      }));
    });

    const moteRandom = mulberry32(4017);
    geometry.motes = Array.from({ length: QUALITY[state.quality].motes }, () => ({
      x: moteRandom(),
      y: 0.28 + moteRandom() * 0.53,
      size: 0.45 + moteRandom() * 1.5,
      phase: moteRandom() * Math.PI * 2,
      drift: 2.5 + moteRandom() * 8,
      alpha: 0.08 + moteRandom() * 0.24,
    }));

    geometry.fogBands.clear();
    for (const layer of fogDefs) {
      geometry.fogBands.set(layer.id, createFogTexture(layer));
    }
  }

  function createFogTexture(layer) {
    const quality = QUALITY[state.quality];
    const width = state.quality === "high" ? 1536 : 768;
    const height = state.quality === "high" ? 512 : 256;
    const texture = document.createElement("canvas");
    texture.width = width;
    texture.height = height;
    const fog = texture.getContext("2d");
    const random = mulberry32(layer.seed * 97);

    fog.clearRect(0, 0, width, height);
    fog.globalCompositeOperation = "source-over";

    const bankCount = state.quality === "high" ? 6 : 3;
    for (let bank = 0; bank < bankCount; bank += 1) {
      const center = height * (0.34 + random() * 0.34);
      const wave = 0.045 + random() * 0.025;
      const phase = random() * Math.PI * 2;
      const fill = fog.createLinearGradient(0, center - height * 0.23, 0, center + height * 0.23);
      fill.addColorStop(0, `rgba(${layer.tint}, 0)`);
      fill.addColorStop(0.27, `rgba(${layer.tint}, 0.055)`);
      fill.addColorStop(0.48, `rgba(${layer.tint}, 0.14)`);
      fill.addColorStop(0.7, `rgba(${layer.tint}, 0.065)`);
      fill.addColorStop(1, `rgba(${layer.tint}, 0)`);

      fog.beginPath();
      fog.moveTo(0, center);
      for (let x = 0; x <= width; x += 22) {
        const angle = (x / width) * Math.PI * 2 * (2 + bank);
        const y = center - height * wave * Math.sin(angle + phase);
        fog.lineTo(x, y);
      }
      for (let x = width; x >= 0; x -= 22) {
        const angle = (x / width) * Math.PI * 2 * (2 + bank);
        const y = center + height * wave * 1.3 * Math.sin(angle + phase + 1.6);
        fog.lineTo(x, y);
      }
      fog.closePath();
      fog.fillStyle = fill;
      fog.fill();
    }

    const puffCount = state.quality === "high" ? quality.fogWisps * 2 : quality.fogWisps;
    for (let index = 0; index < puffCount; index += 1) {
      const x = random() * width;
      const y = height * (0.22 + random() * 0.58);
      const radiusX = width * (0.018 + random() * 0.075) * layer.scale;
      const radiusY = radiusX * (0.18 + random() * 0.17);
      const alpha = 0.042 + random() * 0.105;
      drawFogPuff(fog, x, y, radiusX, radiusY, layer.tint, alpha, width);
    }

    if (state.quality === "high") {
      for (let index = 0; index < 28; index += 1) {
        const x = random() * width;
        const y = height * (0.3 + random() * 0.4);
        const length = 34 + random() * width * 0.14;
        const stroke = fog.createLinearGradient(x - length * 0.5, 0, x + length * 0.5, 0);
        stroke.addColorStop(0, `rgba(${layer.tint}, 0)`);
        stroke.addColorStop(0.45, `rgba(${layer.tint}, ${0.025 + random() * 0.04})`);
        stroke.addColorStop(1, `rgba(${layer.tint}, 0)`);
        fog.strokeStyle = stroke;
        fog.lineWidth = 1 + random() * 4;
        fog.beginPath();
        fog.moveTo(x - length * 0.5, y);
        fog.quadraticCurveTo(x, y - 4 - random() * 7, x + length * 0.5, y + random() * 3);
        fog.stroke();
      }
    }

    return texture;
  }

  function drawFogPuff(fog, x, y, radiusX, radiusY, tint, alpha, textureWidth) {
    const draws = [x];
    if (x < radiusX * 1.1) draws.push(x + textureWidth);
    if (x > textureWidth - radiusX * 1.1) draws.push(x - textureWidth);

    for (const drawX of draws) {
      fog.save();
      fog.translate(drawX, y);
      fog.scale(radiusX, radiusY);
      const gradient = fog.createRadialGradient(0, 0, 0.03, 0, 0, 1);
      gradient.addColorStop(0, `rgba(${tint}, ${alpha})`);
      gradient.addColorStop(0.36, `rgba(${tint}, ${alpha * 0.72})`);
      gradient.addColorStop(0.7, `rgba(${tint}, ${alpha * 0.22})`);
      gradient.addColorStop(1, `rgba(${tint}, 0)`);
      fog.fillStyle = gradient;
      fog.beginPath();
      fog.arc(0, 0, 1, 0, Math.PI * 2);
      fog.fill();
      fog.restore();
    }
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    const quality = QUALITY[state.quality];
    state.dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap) * quality.renderScale;
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    buildSceneGeometry();
    updatePerformanceReadout();
  }

  function updatePerformanceReadout() {
    const quality = QUALITY[state.quality];
    const effectiveDpr = Number(state.dpr.toFixed(2));
    particleNode.textContent = `${Math.round(quality.fogWisps * 2.6)} 雾团 · ${effectiveDpr}× DPR`;
  }

  function cameraShift(parallax) {
    return -state.camera * state.width * parallax * 0.35;
  }

  function sunPosition() {
    return {
      x: state.width * 0.82 + cameraShift(0.05),
      y: state.height * 0.125,
    };
  }

  function drawSky() {
    const { width, height } = state;
    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.72);
    sky.addColorStop(0, "#071c21");
    sky.addColorStop(0.23, "#193b3d");
    sky.addColorStop(0.43, "#42665f");
    sky.addColorStop(0.53, "#879c89");
    sky.addColorStop(0.64, "#455e54");
    sky.addColorStop(1, "#0a1a18");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const sun = sunPosition();
    const glow = ctx.createRadialGradient(
      sun.x,
      sun.y,
      0,
      sun.x,
      sun.y,
      Math.max(width, height) * 0.62,
    );
    glow.addColorStop(0, "rgba(255, 244, 196, 0.42)");
    glow.addColorStop(0.09, "rgba(237, 232, 181, 0.18)");
    glow.addColorStop(0.28, "rgba(184, 203, 175, 0.08)");
    glow.addColorStop(0.62, "rgba(94, 134, 124, 0.035)");
    glow.addColorStop(1, "rgba(8, 27, 27, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height * 0.8);

    ctx.beginPath();
    ctx.arc(sun.x, sun.y, Math.max(1.4, height * 0.004), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 250, 216, 0.9)";
    ctx.fill();

    if (QUALITY[state.quality].fineAtmosphere) {
      const veil = ctx.createLinearGradient(0, height * 0.18, 0, height * 0.5);
      veil.addColorStop(0, "rgba(188, 208, 192, 0)");
      veil.addColorStop(0.58, "rgba(188, 208, 192, 0.035)");
      veil.addColorStop(1, "rgba(188, 208, 192, 0)");
      ctx.fillStyle = veil;
      ctx.fillRect(0, height * 0.18, width, height * 0.34);
    }
  }

  function ridgeVisibility(definition) {
    const distanceWeight = clamp((0.5 - definition.depth) * 1.55, 0, 0.58);
    return 1 - state.farClearance * distanceWeight;
  }

  function traceRidge(points, shift) {
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const x = point.x * state.width + shift;
      const y = point.y * state.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  function drawRidge(definition, index) {
    const shift = cameraShift(definition.parallax);
    const points = geometry.ridges[index];
    const topColor = definition.color;
    const gradient = ctx.createLinearGradient(0, state.height * (definition.base - 0.1), 0, state.height);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, index > 2 ? "#071512" : "#18322d");

    ctx.save();
    ctx.globalAlpha = definition.alpha * ridgeVisibility(definition);
    traceRidge(points, shift);
    ctx.lineTo(state.width * 1.25, state.height * 1.04);
    ctx.lineTo(state.width * -0.25, state.height * 1.04);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    if (QUALITY[state.quality].fineAtmosphere && index < 4) {
      ctx.clip();
      const flecks = geometry.textures[index];
      ctx.strokeStyle = "rgba(220, 234, 218, 0.025)";
      ctx.lineWidth = 0.7;
      for (const fleck of flecks) {
        const x = fleck.x * state.width * 1.5 - state.width * 0.25 + shift;
        const top = ridgeY(definition, fleck.x * 1.5 - 0.25);
        const y = top * state.height + fleck.y * state.height * 0.18;
        ctx.globalAlpha = fleck.alpha;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - fleck.length * state.width * 0.3, y + fleck.length * state.height);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = definition.alpha * ridgeVisibility(definition) * 0.18;
    traceRidge(points, shift);
    ctx.strokeStyle = "rgba(221, 237, 213, 0.72)";
    ctx.lineWidth = 0.75;
    ctx.stroke();
    ctx.restore();
  }

  function drawFogLayer(layer) {
    const texture = geometry.fogBands.get(layer.id);
    if (!texture) return;

    const { width, height } = state;
    const drawWidth = Math.max(width * 1.42, 920);
    const drawHeight = height * (0.29 + layer.spread * 0.75);
    const distributionOffset = ((layer.distribution - 50) / 100) * height * 0.27;
    const centerY = height * layer.baseY + distributionOffset;
    const drift = state.elapsed * layer.speed * 2.4;
    const baseOffset = cameraShift(layer.parallax) * 0.72 + drift;
    const offset = ((baseOffset % drawWidth) + drawWidth) % drawWidth;
    const farFade = 1 - state.farClearance * clamp((layer.depth - 0.2) * 0.58, 0, 0.5);
    const y = centerY - drawHeight * 0.5;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = layer.opacity * farFade;
    ctx.drawImage(texture, offset - drawWidth, y, drawWidth, drawHeight);
    ctx.drawImage(texture, offset, y, drawWidth, drawHeight);

    if (QUALITY[state.quality].fineAtmosphere) {
      const softOffset = offset * 0.56 + drawWidth * 0.18;
      ctx.globalAlpha = layer.opacity * farFade * 0.36;
      ctx.drawImage(
        texture,
        ((softOffset % drawWidth) + drawWidth) % drawWidth - drawWidth,
        y + drawHeight * 0.08,
        drawWidth,
        drawHeight * 0.72,
      );
    }
    ctx.restore();
  }

  function drawLightShafts(strength) {
    const quality = QUALITY[state.quality];
    const { width, height } = state;
    const origin = sunPosition();
    const rayCount = quality.beams;
    const baseAngle = Math.PI * 0.695;

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    for (let index = 0; index < rayCount; index += 1) {
      const centered = index - (rayCount - 1) / 2;
      const angle = baseAngle + centered * 0.052 + Math.sin(state.elapsed * 0.09 + index) * 0.004;
      const length = height * (0.78 + (index % 3) * 0.1);
      const spread = height * (0.024 + ((index * 7) % 5) * 0.006);
      const endX = origin.x + Math.cos(angle) * length;
      const endY = origin.y + Math.sin(angle) * length;
      const normalX = -Math.sin(angle);
      const normalY = Math.cos(angle);
      const gradient = ctx.createLinearGradient(origin.x, origin.y, endX, endY);
      gradient.addColorStop(0, `rgba(252, 247, 207, ${0.115 * strength})`);
      gradient.addColorStop(0.22, `rgba(245, 240, 198, ${0.078 * strength})`);
      gradient.addColorStop(0.72, `rgba(221, 226, 182, ${0.022 * strength})`);
      gradient.addColorStop(1, "rgba(205, 219, 181, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(origin.x - normalX * spread * 0.08, origin.y - normalY * spread * 0.08);
      ctx.lineTo(endX + normalX * spread, endY + normalY * spread);
      ctx.lineTo(endX - normalX * spread, endY - normalY * spread);
      ctx.lineTo(origin.x + normalX * spread * 0.08, origin.y + normalY * spread * 0.08);
      ctx.closePath();
      ctx.fill();

      if (quality.beamGlow && index % 2 === 0) {
        const core = ctx.createLinearGradient(origin.x, origin.y, endX, endY);
        core.addColorStop(0, `rgba(255, 250, 216, ${0.1 * strength})`);
        core.addColorStop(0.45, `rgba(255, 248, 204, ${0.03 * strength})`);
        core.addColorStop(1, "rgba(255, 248, 204, 0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.moveTo(origin.x - normalX * 1.4, origin.y - normalY * 1.4);
        ctx.lineTo(endX + normalX * spread * 0.19, endY + normalY * spread * 0.19);
        ctx.lineTo(endX - normalX * spread * 0.19, endY - normalY * spread * 0.19);
        ctx.lineTo(origin.x + normalX * 1.4, origin.y + normalY * 1.4);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawMotes() {
    const { width, height } = state;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const mote of geometry.motes) {
      const x = ((mote.x * width + state.elapsed * mote.drift + cameraShift(0.12)) % width + width) % width;
      const y =
        mote.y * height +
        Math.sin(state.elapsed * 0.23 + mote.phase) * height * 0.012;
      const fade = 0.55 + Math.sin(state.elapsed * 0.17 + mote.phase) * 0.45;
      ctx.globalAlpha = mote.alpha * fade;
      ctx.fillStyle = "rgba(235, 241, 210, 0.8)";
      ctx.beginPath();
      ctx.arc(x, y, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette() {
    const { width, height } = state;
    const vignette = ctx.createRadialGradient(
      width * 0.56,
      height * 0.46,
      Math.min(width, height) * 0.18,
      width * 0.56,
      height * 0.46,
      Math.max(width, height) * 0.76,
    );
    vignette.addColorStop(0, "rgba(2, 10, 10, 0)");
    vignette.addColorStop(0.64, "rgba(2, 10, 10, 0.055)");
    vignette.addColorStop(1, "rgba(1, 7, 7, 0.48)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const floor = ctx.createLinearGradient(0, height * 0.7, 0, height);
    floor.addColorStop(0, "rgba(2, 10, 9, 0)");
    floor.addColorStop(1, "rgba(2, 10, 9, 0.32)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
  }

  function roundedRectPath(x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawCanvasLabel(options) {
    const { x, y, width, height, index, title, meta, leaderLength, leaderAngle } = options;
    const anchorX = x + width * 0.06;
    const anchorY = y + height * 0.5;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(210, 230, 214, 0.2)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    const endX = x - Math.cos(leaderAngle) * leaderLength;
    const endY = y + Math.sin(leaderAngle) * leaderLength + height * 0.4;
    ctx.lineTo(x - leaderLength * 0.56, anchorY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(endX, endY, 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(222, 239, 198, 0.64)";
    ctx.fill();

    const panelFill = ctx.createLinearGradient(x, y, x, y + height);
    panelFill.addColorStop(0, "rgba(7, 20, 19, 0.91)");
    panelFill.addColorStop(1, "rgba(5, 15, 15, 0.84)");
    roundedRectPath(x, y, width, height, 5);
    ctx.fillStyle = panelFill;
    ctx.fill();
    ctx.strokeStyle = "rgba(213, 234, 216, 0.23)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = "rgba(218, 240, 177, 0.92)";
    ctx.fillRect(x + 10, y + 11, 2, height - 22);
    ctx.font = '600 8px "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = "rgba(218, 240, 177, 0.78)";
    ctx.fillText(index, x + 19, y + 16);
    ctx.font = '500 13px "Mist Serif", "Songti SC", "Noto Serif SC", Georgia, serif';
    ctx.fillStyle = "rgba(242, 248, 237, 0.94)";
    ctx.fillText(title, x + 19, y + 33);
    ctx.font = '8px "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = "rgba(201, 218, 204, 0.5)";
    ctx.fillText(meta, x + 19, y + 45);
    ctx.restore();
  }

  function drawLabels() {
    const { width, height } = state;
    const compact = width < 760;
    const labelWidth = compact ? 142 : 158;
    const labelHeight = 53;
    const right = compact ? 14 : 30;
    const depthShift = cameraShift(0.032);
    const x = width - labelWidth - right + depthShift;
    const firstY = clamp(height * 0.49, 128, height - labelHeight - 86);
    const secondY = firstY + labelHeight + 21;

    drawCanvasLabel({
      x,
      y: firstY,
      width: labelWidth,
      height: labelHeight,
      index: "NEAR / 01",
      title: "冷杉坡",
      meta: "ELEV · 1,842 M",
      leaderLength: compact ? 46 : 66,
      leaderAngle: 0.37,
    });

    if (!compact || height > 620) {
      drawCanvasLabel({
        x: x - 8,
        y: secondY,
        width: labelWidth,
        height: labelHeight,
        index: "MIST LINE / 02",
        title: "谷底流雾",
        meta: "VIS · 2.4 KM",
        leaderLength: compact ? 36 : 54,
        leaderAngle: 0.48,
      });
    }
  }

  function render() {
    const { width, height, dpr } = state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    drawSky();
    drawRidge(ridgeDefs[0], 0);
    drawRidge(ridgeDefs[1], 1);
    drawFogLayer(fogDefs[2]);
    drawRidge(ridgeDefs[2], 2);
    drawLightShafts(0.78);
    drawRidge(ridgeDefs[3], 3);
    drawFogLayer(fogDefs[1]);
    drawLightShafts(0.24);
    drawRidge(ridgeDefs[4], 4);
    drawFogLayer(fogDefs[0]);
    drawRidge(ridgeDefs[5], 5);
    drawMotes();
    drawVignette();
    drawLabels();
  }

  function setRangeFill(input) {
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const value = Number(input.value);
    const percentage = ((value - minimum) / (maximum - minimum)) * 100;
    input.style.setProperty("--fill", `${percentage}%`);
  }

  function createLayerControls() {
    const fragment = document.createDocumentFragment();
    fogDefs.forEach((layer) => {
      const card = document.createElement("article");
      card.className = "layer-card";
      card.dataset.layer = layer.id;
      card.innerHTML = `
        <div class="layer-heading">
          <span class="layer-index">${layer.index}</span>
          <span class="layer-name">${layer.name}</span>
          <span class="layer-depth">${layer.depthLabel} · ${layer.meters}</span>
        </div>
        <div class="layer-fields">
          <div class="field">
            <label for="${layer.id}Distribution">分布</label>
            <input
              class="range"
              id="${layer.id}Distribution"
              type="range"
              min="0"
              max="100"
              value="${layer.distribution}"
              aria-label="${layer.name}分布"
            />
            <output for="${layer.id}Distribution">${layer.distribution}%</output>
          </div>
          <div class="field">
            <label for="${layer.id}Speed">速度</label>
            <input
              class="range"
              id="${layer.id}Speed"
              type="range"
              min="0"
              max="10"
              step="0.1"
              value="${layer.speed}"
              aria-label="${layer.name}速度"
            />
            <output for="${layer.id}Speed">${layer.speed.toFixed(1)}×</output>
          </div>
        </div>
      `;

      const distribution = card.querySelector(`#${layer.id}Distribution`);
      const speed = card.querySelector(`#${layer.id}Speed`);
      distribution.addEventListener("input", () => {
        layer.distribution = Number(distribution.value);
        distribution.nextElementSibling.textContent = `${layer.distribution}%`;
        setRangeFill(distribution);
      });
      speed.addEventListener("input", () => {
        layer.speed = Number(speed.value);
        speed.nextElementSibling.textContent = `${layer.speed.toFixed(1)}×`;
        setRangeFill(speed);
      });
      [distribution, speed].forEach(setRangeFill);
      fragment.appendChild(card);
    });
    layerControls.appendChild(fragment);
  }

  function syncCameraUI() {
    const value = Math.round(state.camera * 100);
    cameraRange.value = String(value);
    cameraValue.textContent = `${value > 0 ? "+" : ""}${(state.camera).toFixed(1)}`;
    cameraReadout.textContent = `机位 ${String(value).padStart(3, "0").replace("-", "−")}`;
    setRangeFill(cameraRange);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function setAutoPan(enabled) {
    state.autoPan = enabled;
    state.autoBase = state.camera;
    state.autoStart = state.elapsed;
    autoPanButton.setAttribute("aria-pressed", String(enabled));
    autoPanButton.lastChild.textContent = enabled ? " 自动巡游" : " 自由机位";
  }

  function setCameraTarget(value, immediate = false) {
    state.cameraTarget = clamp(value, -1, 1);
    if (immediate) state.camera = state.cameraTarget;
    syncCameraUI();
  }

  function setQuality(quality) {
    if (!QUALITY[quality]) return;
    state.quality = quality;
    document.querySelectorAll("[data-quality]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.quality === quality);
    });
    app.dataset.quality = quality;
    resize();
    showToast(`已切换至${QUALITY[quality].label} · 山脊轮廓保持锁定`);
  }

  function downloadScreenshot() {
    render();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.download = `mist-valley-${state.quality}-${stamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast(`截图已保存 · ${canvas.width} × ${canvas.height}`);
  }

  function getRidgeSignature() {
    return geometry.ridges.map((points, index) => {
      const shift = cameraShift(ridgeDefs[index].parallax);
      return points.map((point) => [
        Number((point.x * state.width + shift).toFixed(3)),
        Number((point.y * state.height).toFixed(3)),
      ]);
    });
  }

  function getSceneState() {
    return {
      quality: state.quality,
      camera: Number(state.camera.toFixed(4)),
      cameraTarget: Number(state.cameraTarget.toFixed(4)),
      autoPan: state.autoPan,
      paused: Boolean(state.paused),
      elapsed: Number(state.elapsed.toFixed(3)),
      fps: state.fps,
      width: state.width,
      height: state.height,
      dpr: Number(state.dpr.toFixed(2)),
      farClearance: state.farClearance,
      layers: fogDefs.map((layer) => ({
        id: layer.id,
        distribution: layer.distribution,
        speed: layer.speed,
      })),
    };
  }

  function bindControls() {
    createLayerControls();
    setRangeFill(cameraRange);
    setRangeFill(farClearance);

    farClearance.addEventListener("input", () => {
      state.farClearance = Number(farClearance.value) / 100;
      farClearanceValue.textContent = `${farClearance.value}%`;
      setRangeFill(farClearance);
    });

    cameraRange.addEventListener("input", () => {
      setAutoPan(false);
      setCameraTarget(Number(cameraRange.value) / 100, true);
      dragHint.classList.add("is-hidden");
    });

    document.getElementById("panLeft").addEventListener("click", () => {
      setAutoPan(false);
      setCameraTarget(state.cameraTarget - 0.16);
      dragHint.classList.add("is-hidden");
    });

    document.getElementById("panRight").addEventListener("click", () => {
      setAutoPan(false);
      setCameraTarget(state.cameraTarget + 0.16);
      dragHint.classList.add("is-hidden");
    });

    autoPanButton.addEventListener("click", () => {
      setAutoPan(!state.autoPan);
    });

    document.getElementById("resetView").addEventListener("click", () => {
      setAutoPan(true);
      setCameraTarget(0);
      farClearance.value = "42";
      state.farClearance = 0.42;
      farClearanceValue.textContent = "42%";
      setRangeFill(farClearance);
    });

    document.querySelectorAll("[data-quality]").forEach((button) => {
      button.addEventListener("click", () => setQuality(button.dataset.quality));
    });

    document.getElementById("captureButton").addEventListener("click", downloadScreenshot);

    const panel = document.querySelector(".control-panel");
    document.getElementById("collapsePanel").addEventListener("click", () => {
      app.classList.add("panel-collapsed");
      panel.classList.add("is-collapsed");
    });
    document.getElementById("reopenPanel").addEventListener("click", () => {
      app.classList.remove("panel-collapsed");
      panel.classList.remove("is-collapsed");
    });

    canvas.addEventListener("pointerdown", (event) => {
      state.dragging = true;
      state.pointerStartX = event.clientX;
      state.pointerStartCamera = state.cameraTarget;
      setAutoPan(false);
      canvas.setPointerCapture(event.pointerId);
      dragHint.classList.add("is-hidden");
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!state.dragging) return;
      const moved = (event.clientX - state.pointerStartX) / state.width;
      setCameraTarget(state.pointerStartCamera - moved * 2.15);
    });

    const endDrag = (event) => {
      if (!state.dragging) return;
      state.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  }

  function updateClock() {
    const now = new Date();
    clockNode.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function animate(now) {
    const delta = state.lastFrame ? Math.min(52, now - state.lastFrame) : 16.67;
    state.lastFrame = now;
    state.frameCount += 1;

    if (!state.paused) {
      state.elapsed += delta / 1000;
      if (state.autoPan) {
        const phase = (state.elapsed - state.autoStart) * 0.13;
        state.cameraTarget = clamp(state.autoBase + Math.sin(phase) * 0.4, -1, 1);
      }
      const follow = 1 - Math.pow(0.0012, delta / 1000);
      state.camera += (state.cameraTarget - state.camera) * follow;
      syncCameraUI();
    }

    state.fpsFrames += 1;
    if (now - state.fpsAt >= 600) {
      const measured = (state.fpsFrames * 1000) / Math.max(1, now - state.fpsAt);
      state.fps = Math.round(measured);
      fpsNode.textContent = String(clamp(state.fps, 0, 120));
      state.fpsFrames = 0;
      state.fpsAt = now;
    }

    render();
    window.requestAnimationFrame(animate);
  }

  function init() {
    state.autoBase = 0;
    state.autoStart = 0;
    state.paused = false;
    state.camera = 0.08;
    state.cameraTarget = 0.08;
    app.dataset.quality = state.quality;
    bindControls();
    resize();
    syncCameraUI();
    updateClock();
    window.setInterval(updateClock, 1000);

    if (window.innerWidth < 700) {
      app.classList.add("panel-collapsed");
      document.querySelector(".control-panel").classList.add("is-collapsed");
    }

    window.addEventListener("resize", resize, { passive: true });
    window.setTimeout(() => dragHint.classList.add("is-hidden"), 7500);

    window.__mistValley = {
      setQuality,
      setAutoPan,
      setPaused(paused) {
        state.paused = Boolean(paused);
        render();
        return getSceneState();
      },
      setTime(seconds) {
        state.elapsed = Math.max(0, Number(seconds) || 0);
        render();
        return getSceneState();
      },
      setCamera(value) {
        setAutoPan(false);
        setCameraTarget(Number(value) || 0, true);
        render();
        return getSceneState();
      },
      setFarClearance(value) {
        state.farClearance = clamp(Number(value) || 0, 0, 1);
        farClearance.value = String(Math.round(state.farClearance * 100));
        farClearanceValue.textContent = `${farClearance.value}%`;
        setRangeFill(farClearance);
        render();
        return getSceneState();
      },
      getSceneState,
      getRidgeSignature,
      captureDataURL() {
        render();
        return canvas.toDataURL("image/png");
      },
      render,
    };

    window.requestAnimationFrame(animate);
  }

  init();
})();
