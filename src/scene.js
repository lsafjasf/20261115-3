export const WORLD = { width: 1280, height: 720 };

export const CAMERAS = [
  {
    id: "cam-a",
    number: "01",
    name: "WIDE",
    label: "广角",
    scale: 1,
    focusX: 640,
    focusY: 360,
    screenX: 640,
    screenY: 360,
    hue: "#8fb6c3"
  },
  {
    id: "cam-b",
    number: "02",
    name: "LEFT / 65",
    label: "左侧",
    scale: 1.48,
    focusX: 535,
    focusY: 395,
    screenX: 625,
    screenY: 365,
    hue: "#c8ff3d"
  },
  {
    id: "cam-c",
    number: "03",
    name: "CLOSE / 120",
    label: "近景",
    scale: 1.92,
    focusX: 740,
    focusY: 402,
    screenX: 632,
    screenY: 365,
    hue: "#ff7548"
  }
];

export const CAMERA_BY_ID = Object.fromEntries(CAMERAS.map((camera) => [camera.id, camera]));

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (from, to, amount) => from + (to - from) * amount;

export function sceneState(time) {
  const t = clamp(Number(time) || 0, 0, 15);
  const orbit = t * 0.62;
  const bounce = Math.sin(t * 2.45);
  const sway = Math.sin(t * 1.28);
  return {
    time: t,
    orbit,
    performerX: 640 + Math.sin(orbit) * 218 + Math.sin(t * 0.17) * 24,
    performerY: 493 + Math.abs(bounce) * -15 + Math.sin(t * 0.72) * 3,
    rotation: Math.sin(orbit) * 0.14 + Math.sin(t * 0.21) * 0.04,
    armSwing: Math.sin(t * 2.05) * 0.68 + Math.sin(t * 0.83) * 0.18,
    headTilt: Math.sin(t * 1.37 + 0.8) * 0.13,
    haloPulse: 1 + Math.sin(t * 1.57) * 0.035 + Math.sin(t * 4.05) * 0.008,
    beamSpread: 170 + Math.sin(t * 0.44) * 25,
    ringRotation: t * 0.24,
    shake: Math.sin(t * 12.7) * 0.6,
    aura: 0.72 + Math.sin(t * 1.57) * 0.2
  };
}

export function sceneSignature(time) {
  const state = sceneState(time);
  const round = (value) => Number(value.toFixed(5));
  return {
    time: round(state.time),
    x: round(state.performerX),
    y: round(state.performerY),
    rotation: round(state.rotation),
    armSwing: round(state.armSwing),
    headTilt: round(state.headTilt),
    haloPulse: round(state.haloPulse)
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawBackdrop(ctx, t, state) {
  const backdrop = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  backdrop.addColorStop(0, "#070b13");
  backdrop.addColorStop(0.42, "#0c1421");
  backdrop.addColorStop(0.72, "#101621");
  backdrop.addColorStop(1, "#07090d");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const horizonGlow = ctx.createRadialGradient(640, 352, 10, 640, 352, 470);
  horizonGlow.addColorStop(0, "rgba(24, 87, 112, 0.28)");
  horizonGlow.addColorStop(0.4, "rgba(17, 56, 76, 0.12)");
  horizonGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  for (let index = 0; index < 11; index += 1) {
    const x = 95 + index * 109;
    const height = 390 + Math.sin(index * 2.3) * 65;
    const alpha = 0.025 + (index % 3) * 0.012;
    ctx.fillStyle = `rgba(130, 216, 229, ${alpha})`;
    ctx.fillRect(x, 94, 2, height);
    ctx.fillStyle = `rgba(160, 230, 239, ${alpha * 0.55})`;
    ctx.fillRect(x - 4, 94, 10, height);
  }

  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = "#1c3745";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 452);
  ctx.bezierCurveTo(320, 390 + Math.sin(t * 0.3) * 5, 900, 410, 1280, 448);
  ctx.stroke();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = "#6fa9b7";
  ctx.beginPath();
  ctx.moveTo(0, 464);
  ctx.bezierCurveTo(350, 405, 910, 424, 1280, 460);
  ctx.stroke();
  ctx.restore();

  const vignette = ctx.createRadialGradient(640, 340, 160, 640, 360, 720);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.65, "rgba(0, 0, 0, 0.04)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
}

function drawHalo(ctx, t, state) {
  const cx = 640 + Math.sin(t * 0.24) * 13;
  const cy = 324 + Math.cos(t * 0.31) * 8;
  const radius = 238 * state.haloPulse;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.ringRotation * 0.18);

  const haloGlow = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius * 1.24);
  haloGlow.addColorStop(0, "rgba(0, 0, 0, 0)");
  haloGlow.addColorStop(0.72, "rgba(130, 255, 221, 0.035)");
  haloGlow.addColorStop(0.92, "rgba(115, 245, 222, 0.12)");
  haloGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haloGlow;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.24, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "rgba(146, 255, 230, 0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();

  const brokenRadius = radius - 17;
  ctx.strokeStyle = "rgba(200, 255, 61, 0.25)";
  ctx.lineWidth = 2.4;
  for (let segment = 0; segment < 8; segment += 1) {
    const start = (segment / 8) * TAU + t * 0.08;
    const length = 0.34 + 0.12 * Math.sin(segment * 1.8 + t * 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, brokenRadius, start, start + length);
    ctx.stroke();
  }

  ctx.rotate(-state.ringRotation * 0.48);
  ctx.strokeStyle = "rgba(113, 199, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.12, radius * 0.48, 0.1, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 117, 72, 0.12)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.82, radius * 0.34, -0.45, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let index = 0; index < 28; index += 1) {
    const seed = index * 12.9898;
    const phase = (seed + t * (0.1 + (index % 6) * 0.015)) % 1;
    const angle = index * 2.399 + t * (0.05 + (index % 4) * 0.012);
    const orbitRadius = 110 + ((index * 37) % 330);
    const x = cx + Math.cos(angle) * orbitRadius;
    const y = cy + Math.sin(angle) * orbitRadius * 0.58;
    const alpha = 0.12 + (0.5 + 0.5 * Math.sin(t * 1.8 + index)) * 0.3;
    const size = 0.8 + phase * 2.1;
    ctx.fillStyle = index % 5 === 0
      ? `rgba(200, 255, 61, ${alpha * 0.8})`
      : `rgba(116, 226, 239, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloor(ctx, t, state) {
  const floor = ctx.createLinearGradient(0, 423, 0, 720);
  floor.addColorStop(0, "#101820");
  floor.addColorStop(0.35, "#0d1218");
  floor.addColorStop(1, "#050709");
  ctx.fillStyle = floor;
  ctx.fillRect(0, 423, WORLD.width, 297);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(100, 183, 198, 0.12)";
  ctx.lineWidth = 1;
  const vanishX = 640 + Math.sin(t * 0.18) * 12;
  for (let index = -8; index <= 8; index += 1) {
    const bottomX = vanishX + index * 148;
    ctx.beginPath();
    ctx.moveTo(vanishX + index * 9, 423);
    ctx.lineTo(bottomX, 720);
    ctx.stroke();
  }
  for (let index = 0; index < 8; index += 1) {
    const depth = index / 8;
    const y = 423 + Math.pow(depth, 1.72) * 300;
    ctx.globalAlpha = 0.08 + depth * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
    ctx.stroke();
  }
  ctx.restore();

  const stageGlow = ctx.createRadialGradient(state.performerX, 505, 8, state.performerX, 505, 245);
  stageGlow.addColorStop(0, `rgba(120, 239, 217, ${0.13 * state.aura})`);
  stageGlow.addColorStop(0.45, "rgba(80, 188, 180, 0.06)");
  stageGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = stageGlow;
  ctx.beginPath();
  ctx.ellipse(state.performerX, 513, 255, 74, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(state.performerX, 518);
  ctx.scale(1, 0.25);
  ctx.strokeStyle = "rgba(200, 255, 61, 0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 102 + Math.sin(t * 1.5) * 5, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(125, 231, 222, 0.13)";
  for (let index = 0; index < 38; index += 1) {
    const phase = (index * 0.173 + t * 0.045) % 1;
    const side = index % 2 === 0 ? -1 : 1;
    const x = 640 + side * (35 + phase * 500) + Math.sin(index + t * 0.4) * 18;
    const y = 454 + phase * 230;
    ctx.globalAlpha = (1 - phase) * 0.62;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.globalAlpha = 1;
}

function drawBeams(ctx, t, state) {
  const beams = [
    { x: 280, target: state.performerX - 160, color: "rgba(110, 198, 218, 0.10)", width: 105 },
    { x: 640, target: state.performerX, color: "rgba(200, 255, 61, 0.075)", width: 128 },
    { x: 1000, target: state.performerX + 140, color: "rgba(255, 117, 72, 0.075)", width: 112 }
  ];

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  beams.forEach((beam, index) => {
    const spread = state.beamSpread * (0.82 + index * 0.11);
    const gradient = ctx.createLinearGradient(beam.x, 0, beam.target, 520);
    gradient.addColorStop(0, beam.color);
    gradient.addColorStop(0.72, beam.color.replace(/0\.\d+\)/, "0.025)"));
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(beam.x - beam.width * 0.46, -30);
    ctx.lineTo(beam.x + beam.width * 0.46, -30);
    ctx.lineTo(beam.target + spread, 538);
    ctx.lineTo(beam.target - spread, 538);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let index = 0; index < 20; index += 1) {
    const drift = (index / 20 + t * 0.017) % 1;
    const x = 230 + ((index * 73) % 820) + Math.sin(t * 0.5 + index) * 20;
    const y = 80 + drift * 390;
    ctx.fillStyle = `rgba(105, 195, 201, ${0.025 + (1 - drift) * 0.07})`;
    ctx.fillRect(x, y, 1.2 + (index % 3), 1.2 + (index % 3));
  }
  ctx.restore();
}

function drawFloatingObjects(ctx, t, state) {
  const objects = [
    { angle: 0.4, radius: 325, size: 26, color: "#6dd6c8", speed: 0.45 },
    { angle: 2.4, radius: 287, size: 17, color: "#c8ff3d", speed: -0.33 },
    { angle: 4.25, radius: 352, size: 21, color: "#ff8b63", speed: 0.28 }
  ];

  objects.forEach((object, index) => {
    const angle = object.angle + t * object.speed;
    const x = 640 + Math.cos(angle) * object.radius;
    const y = 330 + Math.sin(angle) * object.radius * 0.44;
    const depth = 0.75 + Math.sin(angle) * 0.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle * 1.4 + index);
    ctx.scale(depth, depth);
    ctx.strokeStyle = object.color;
    ctx.globalAlpha = 0.32 + depth * 0.25;
    ctx.lineWidth = 1.2;
    roundedRect(ctx, -object.size / 2, -object.size / 2, object.size, object.size, 2);
    ctx.stroke();
    ctx.globalAlpha *= 0.4;
    ctx.beginPath();
    ctx.moveTo(-object.size / 2, 0);
    ctx.lineTo(object.size / 2, 0);
    ctx.moveTo(0, -object.size / 2);
    ctx.lineTo(0, object.size / 2);
    ctx.stroke();
    ctx.restore();
  });

  ctx.save();
  ctx.translate(640, 414);
  ctx.scale(1, 0.21);
  ctx.rotate(-state.ringRotation * 0.35);
  ctx.setLineDash([5, 13]);
  ctx.strokeStyle = "rgba(138, 211, 215, 0.16)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 385, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawPerformer(ctx, t, state) {
  const x = state.performerX;
  const y = state.performerY;
  const breathe = Math.sin(t * 1.57) * 1.5;

  ctx.save();
  ctx.translate(x, y + state.shake);

  const aura = ctx.createRadialGradient(0, -115, 6, 0, -115, 74);
  aura.addColorStop(0, `rgba(187, 255, 211, ${0.13 * state.aura})`);
  aura.addColorStop(0.54, "rgba(60, 186, 186, 0.05)");
  aura.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.ellipse(0, -105, 82, 155, 0, 0, TAU);
  ctx.fill();

  ctx.rotate(state.rotation);
  ctx.translate(0, breathe);

  ctx.strokeStyle = "rgba(1, 3, 4, 0.85)";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(-12, -65);
  ctx.lineTo(-23 + swayLeg(t, -1) * 6, -3);
  ctx.moveTo(13, -65);
  ctx.lineTo(26 + swayLeg(t, 1) * 7, -2);
  ctx.stroke();

  ctx.strokeStyle = "#10191d";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(-13, -65);
  ctx.lineTo(-23 + swayLeg(t, -1) * 6, -3);
  ctx.moveTo(13, -65);
  ctx.lineTo(26 + swayLeg(t, 1) * 7, -2);
  ctx.stroke();

  ctx.fillStyle = "#1c292b";
  ctx.beginPath();
  ctx.moveTo(-20 + swayLeg(t, -1) * 6, -5);
  ctx.lineTo(-36 + swayLeg(t, -1) * 8, 0);
  ctx.lineTo(-18 + swayLeg(t, -1) * 6, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(20 + swayLeg(t, 1) * 7, -5);
  ctx.lineTo(39 + swayLeg(t, 1) * 8, 0);
  ctx.lineTo(20 + swayLeg(t, 1) * 7, 3);
  ctx.fill();

  const torso = ctx.createLinearGradient(-30, -132, 30, -60);
  torso.addColorStop(0, "#19292b");
  torso.addColorStop(0.55, "#224245");
  torso.addColorStop(1, "#101b1e");
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.moveTo(-17, -135);
  ctx.quadraticCurveTo(-31, -121, -28, -76);
  ctx.lineTo(-19, -57);
  ctx.lineTo(20, -56);
  ctx.lineTo(29, -79);
  ctx.quadraticCurveTo(31, -123, 16, -136);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(140, 246, 220, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-14, -132);
  ctx.lineTo(-21, -68);
  ctx.moveTo(15, -132);
  ctx.lineTo(22, -69);
  ctx.stroke();

  ctx.fillStyle = "rgba(200, 255, 61, 0.6)";
  ctx.fillRect(-3, -107, 6, 1);
  ctx.fillRect(-2, -92, 4, 1);

  drawArm(ctx, state.armSwing, -1, t);
  drawArm(ctx, state.armSwing, 1, t);

  ctx.save();
  ctx.translate(0, -153);
  ctx.rotate(state.headTilt);
  ctx.fillStyle = "#152527";
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 18, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(163, 248, 224, 0.32)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 18, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "rgba(200, 255, 61, 0.85)";
  ctx.fillRect(-7, -2, 5, 1);
  ctx.fillRect(2, -2, 5, 1);
  ctx.strokeStyle = "rgba(85, 168, 166, 0.45)";
  ctx.lineWidth = 2;
  for (let index = 0; index < 5; index += 1) {
    const offset = (index - 2) * 5;
    ctx.beginPath();
    ctx.moveTo(offset * 0.3, -14);
    ctx.quadraticCurveTo(offset * 1.4, -32 - Math.sin(t * 1.2 + index) * 7, offset * 0.4, -51);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(200, 255, 61, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, -153, 24 + Math.sin(t * 1.3) * 2, -2.55, 0.55);
  ctx.stroke();
  ctx.restore();
}

function swayLeg(t, side) {
  return Math.sin(t * 1.65 + side * 1.4) * 0.5 + 0.5;
}

function drawArm(ctx, swing, side, t) {
  const shoulderX = side * 18;
  const shoulderY = -129;
  const elbowX = side * (35 + swing * 12);
  const elbowY = -105 + Math.cos(swing + side * 0.6) * 8;
  const handX = side * (55 + swing * 28);
  const handY = -78 + Math.sin(swing * 1.6 + side) * 23;
  const gradient = ctx.createLinearGradient(shoulderX, shoulderY, handX, handY);
  gradient.addColorStop(0, "#223e40");
  gradient.addColorStop(1, "#0b1518");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.quadraticCurveTo(elbowX, elbowY, handX, handY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(160, 245, 220, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY - 2);
  ctx.quadraticCurveTo(elbowX, elbowY - 2, handX, handY);
  ctx.stroke();
  ctx.fillStyle = "rgba(200, 255, 61, 0.64)";
  ctx.beginPath();
  ctx.arc(handX, handY, 2.2 + Math.sin(t * 2 + side) * 0.4, 0, TAU);
  ctx.fill();
}

function drawForeground(ctx, t, state) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 14; index += 1) {
    const x = 70 + index * 89 + Math.sin(t * 0.31 + index * 1.7) * 45;
    const start = 140 + (index * 43) % 210;
    const length = 38 + (index % 4) * 23;
    ctx.strokeStyle = `rgba(120, 210, 215, ${0.025 + (index % 3) * 0.018})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, start);
    ctx.lineTo(x + Math.sin(t * 0.2 + index) * 3, start + length);
    ctx.stroke();
  }
  ctx.restore();

  const topFade = ctx.createLinearGradient(0, 0, 0, 70);
  topFade.addColorStop(0, "rgba(0, 0, 0, 0.4)");
  topFade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, WORLD.width, 70);
}

export function renderCamera(ctx, width, height, cameraId, time) {
  const camera = CAMERA_BY_ID[cameraId] || CAMERAS[0];
  const state = sceneState(time);
  const scale = Math.min(width / WORLD.width, height / WORLD.height);
  const offsetX = (width - WORLD.width * scale) / 2;
  const offsetY = (height - WORLD.height * scale) / 2;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.translate(camera.screenX - camera.focusX * camera.scale, camera.screenY - camera.focusY * camera.scale);
  ctx.scale(camera.scale, camera.scale);

  drawBackdrop(ctx, state.time, state);
  drawHalo(ctx, state.time, state);
  drawFloor(ctx, state.time, state);
  drawBeams(ctx, state.time, state);
  drawFloatingObjects(ctx, state.time, state);
  drawPerformer(ctx, state.time, state);
  drawForeground(ctx, state.time, state);
  ctx.restore();
}

export function renderTransition(ctx, width, height, sourceCanvas, targetCanvas, progress, transition) {
  const p = clamp(progress, 0, 1);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, width, height);

  if (transition === "cut" || transition === "dissolve") {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.globalAlpha = p;
    ctx.drawImage(targetCanvas, 0, 0, width, height);
    ctx.globalAlpha = 1;
  } else if (transition === "wipe") {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    const edge = width * p;
    const softEdge = Math.max(12, width * 0.045);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, edge, height);
    ctx.clip();
    ctx.drawImage(targetCanvas, 0, 0, width, height);
    ctx.restore();
    const edgeGradient = ctx.createLinearGradient(edge - softEdge, 0, edge + softEdge, 0);
    edgeGradient.addColorStop(0, "rgba(200, 255, 61, 0)");
    edgeGradient.addColorStop(0.5, "rgba(200, 255, 61, 0.12)");
    edgeGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = edgeGradient;
    ctx.fillRect(edge - softEdge, 0, softEdge * 2, height);
  } else if (transition === "slide") {
    const eased = 1 - Math.pow(1 - p, 3);
    ctx.drawImage(sourceCanvas, -eased * width, 0, width, height);
    ctx.drawImage(targetCanvas, (1 - eased) * width, 0, width, height);
    ctx.fillStyle = "rgba(200, 255, 61, 0.45)";
    ctx.fillRect((1 - eased) * width - 1, 0, 2, height);
  } else {
    if (p < 0.5) {
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
      ctx.fillStyle = `rgba(3, 5, 6, ${p * 2})`;
    } else {
      ctx.drawImage(targetCanvas, 0, 0, width, height);
      ctx.fillStyle = `rgba(3, 5, 6, ${(1 - p) * 2})`;
    }
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}
