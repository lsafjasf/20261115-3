"use strict";
/* 程序化水面演示：离屏渲染地形/天空 -> 水面折射采样。
 * 不加载任何纹理；暂停时时间冻结，水面完全静止。 */

const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true });
if (!gl) { document.body.innerHTML = "<p style='color:#fff;padding:2em'>当前环境不支持 WebGL</p>"; throw new Error("no webgl"); }

// ---------- 小工具 ----------
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error("shader: " + gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error("link: " + gl.getProgramInfoLog(p));
  return p;
}
function uniforms(prog, names) {
  const out = {};
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

// ---------- 矩阵（列主序）----------
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0,
          0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, at, up) {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
          -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
          -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
          -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// ---------- 网格几何 ----------
function makeGrid(size, segs) {
  const verts = new Float32Array((segs + 1) * (segs + 1) * 2);
  let vi = 0;
  for (let j = 0; j <= segs; j++)
    for (let i = 0; i <= segs; i++) {
      verts[vi++] = (i / segs - 0.5) * size;
      verts[vi++] = (j / segs - 0.5) * size;
    }
  const idx = new Uint16Array(segs * segs * 6);
  let ii = 0;
  for (let j = 0; j < segs; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
      idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
      idx[ii++] = b; idx[ii++] = c; idx[ii++] = d;
    }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return { vbo, ibo, count: idx.length };
}

// ---------- 风场预设 ----------
// 每个分量: [dirX, dirZ, 基准振幅(m), 波长(m), 初相位]
// 振幅/波速再按风速缩放。A=局地风浪(短而陡、方向集中)；B=远区长涌(长而缓、略有展向)。
const WIND_PRESETS = {
  A: {
    name: "A 风浪",
    desc: "短波长、大波陡、方向集中",
    ampExp: 1.0, ampK: 0.028, spdK: 0.9,
    waves: [
      [0.94, 0.34, 0.60, 6.0, 0.0],
      [0.98, 0.20, 0.38, 3.6, 1.7],
      [0.89, 0.46, 0.22, 2.2, 3.9],
      [1.00, -0.06, 0.12, 1.3, 5.2],
    ],
  },
  B: {
    name: "B 长涌",
    desc: "长波长、小波陡、方向分散",
    ampExp: 0.7, ampK: 0.035, spdK: 1.1,
    waves: [
      [0.87, 0.50, 0.55, 18.0, 0.0],
      [0.97, 0.26, 0.30, 11.0, 2.3],
      [0.71, 0.71, 0.18, 7.5, 4.1],
      [0.99, -0.14, 0.10, 4.5, 1.2],
    ],
  },
};
let activePreset = "A";

// JS 侧波形镜像（与 WATER_VS 完全一致），用于实测统计
function waveSample(preset, wind, x, z, t) {
  const P = WIND_PRESETS[preset];
  const ampScale = P.ampK * Math.pow(wind, P.ampExp);
  const spdScale = P.spdK * (0.35 + 0.065 * wind);
  let h = 0, gx = 0, gz = 0;
  for (const [dx, dz, a0, len, ph0] of P.waves) {
    const amp = a0 * ampScale, k = 2 * Math.PI / len;
    const w = Math.sqrt(9.81 * k) * spdScale;
    const ph = (dx * x + dz * z) * k - w * t + ph0;
    h += amp * Math.sin(ph);
    gx += dx * amp * k * Math.cos(ph);
    gz += dz * amp * k * Math.cos(ph);
  }
  return { h, steep: Math.hypot(gx, gz) };
}
function measurePreset(preset, wind) {
  const N = 16, S = 40;
  let sum = 0, sum2 = 0, maxSteep = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const { h, steep } = waveSample(preset, wind,
        (i / (N - 1) - 0.5) * S, (j / (N - 1) - 0.5) * S, 0);
      sum += h; sum2 += h * h;
      if (steep > maxSteep) maxSteep = steep;
    }
  const mean = sum / (N * N);
  const sigma = Math.sqrt(Math.max(sum2 / (N * N) - mean * mean, 0));
  return { Hs: 4 * sigma, maxSteep };
}

// ---------- GL 程序与资源 ----------
const skyProg = program(SKY_VS, SKY_FS);
const terrProg = program(TERRAIN_VS, TERRAIN_FS);
const waterProg = program(WATER_VS, WATER_FS);

const skyU = uniforms(skyProg, ["uSunDir", "uCamPos", "uCamFwd", "uCamRight", "uCamUp", "uTanFov", "uAspect"]);
const terrU = uniforms(terrProg, ["uVP", "uSunDir", "uTide"]);
const waterU = uniforms(waterProg, ["uVP", "uTime", "uTide", "uAmpScale", "uSpdScale",
  "uWaves", "uWavePh", "uScene", "uRes", "uCamPos", "uSunDir", "uWind", "uRipple", "uDebug"]);

const waterGrid = makeGrid(64, 160);
const terrGrid = makeGrid(72, 200);
const skyQuad = (() => {
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return { vbo, count: 3 };
})();

// 离屏帧缓冲：地形+天空 -> 颜色纹理（折射采样源）
let fbo = null, fboTex = null, fboDepth = null;
function buildFBO(w, h) {
  if (fboTex) { gl.deleteTexture(fboTex); gl.deleteRenderbuffer(fboDepth); gl.deleteFramebuffer(fbo); }
  fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  fboDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, fboDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboDepth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ---------- 状态与 UI ----------
const ui = {};
for (const id of ["sunAz", "sunEl", "wind", "tide", "debugView", "btnPause", "btnStep",
                  "sunAzV", "sunElV", "windV", "tideV", "fps", "windTable", "colA", "colB"])
  ui[id] = document.getElementById(id);

const state = {
  paused: false,
  time: 0,           // 场景时间（暂停时冻结）
  yaw: 0.55, pitch: 0.50, dist: 38,
};

function sunDir() {
  const az = +ui.sunAz.value * Math.PI / 180;
  const el = +ui.sunEl.value * Math.PI / 180;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}

function refreshLabels() {
  ui.sunAzV.textContent = `${ui.sunAz.value}°`;
  ui.sunElV.textContent = `${ui.sunEl.value}°`;
  ui.windV.textContent = `${(+ui.wind.value).toFixed(1)} m/s`;
  ui.tideV.textContent = `${(+ui.tide.value).toFixed(2)} m`;
}
for (const id of ["sunAz", "sunEl", "wind", "tide"])
  ui[id].addEventListener("input", () => { refreshLabels(); updateWindTable(); });

ui.btnPause.addEventListener("click", () => {
  state.paused = !state.paused;
  ui.btnPause.textContent = state.paused ? "继续" : "暂停";
  ui.btnPause.classList.toggle("active", state.paused);
  ui.fps.classList.toggle("paused", state.paused);
});
ui.btnStep.addEventListener("click", () => {
  if (!state.paused) ui.btnPause.click();
  state.time += 0.1;
});

// 风场对比表
function updateWindTable() {
  const wind = +ui.wind.value;
  const rows = [];
  const mA = measurePreset("A", wind), mB = measurePreset("B", wind);
  const P = WIND_PRESETS;
  const fmt = (arr) => arr.map(w => w[3].toFixed(1)).join(" / ");
  rows.push(["波长 λ (m)", fmt(P.A.waves), fmt(P.B.waves)]);
  rows.push(["基准振幅 (m)",
    P.A.waves.map(w => w[2].toFixed(2)).join(" / "),
    P.B.waves.map(w => w[2].toFixed(2)).join(" / ")]);
  rows.push(["方向展布", "集中 (±20°)", "分散 (±45°)"]);
  rows.push(["实测 Hs (m)", mA.Hs.toFixed(2), mB.Hs.toFixed(2)]);
  rows.push(["实测最大波陡", mA.maxSteep.toFixed(2), mB.maxSteep.toFixed(2)]);
  const tbody = ui.windTable.querySelector("tbody");
  tbody.innerHTML = rows.map(r =>
    `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("");
  ui.colA.classList.toggle("cur", activePreset === "A");
  ui.colB.classList.toggle("cur", activePreset === "B");
}
ui.colA.addEventListener("click", () => { activePreset = "A"; updateWindTable(); });
ui.colB.addEventListener("click", () => { activePreset = "B"; updateWindTable(); });

// 鼠标拖动旋转视角
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener("pointerdown", e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", e => {
  if (!dragging) return;
  state.yaw -= (e.clientX - lastX) * 0.006;
  state.pitch = Math.min(1.35, Math.max(0.08, state.pitch + (e.clientY - lastY) * 0.004));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  state.dist = Math.min(70, Math.max(14, state.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });

// ---------- 渲染 ----------
function bindGrid(grid, loc) {
  gl.bindBuffer(gl.ARRAY_BUFFER, grid.vbo);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.ibo);
}

function drawSky(cam) {
  gl.useProgram(skyProg);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);
  const s = sunDir();
  gl.uniform3fv(skyU.uSunDir, s);
  gl.uniform3fv(skyU.uCamPos, cam.pos);
  gl.uniform3fv(skyU.uCamFwd, cam.fwd);
  gl.uniform3fv(skyU.uCamRight, cam.right);
  gl.uniform3fv(skyU.uCamUp, cam.up);
  gl.uniform1f(skyU.uTanFov, cam.tanFov);
  gl.uniform1f(skyU.uAspect, cam.aspect);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad.vbo);
  const loc = gl.getAttribLocation(skyProg, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
}

function drawTerrain(vp, tide) {
  gl.useProgram(terrProg);
  gl.uniformMatrix4fv(terrU.uVP, false, vp);
  gl.uniform3fv(terrU.uSunDir, sunDir());
  gl.uniform1f(terrU.uTide, tide);
  const loc = gl.getAttribLocation(terrProg, "aXZ");
  bindGrid(terrGrid, loc);
  gl.drawElements(gl.TRIANGLES, terrGrid.count, gl.UNSIGNED_SHORT, 0);
}

function drawWater(vp, cam, tide, wind) {
  const P = WIND_PRESETS[activePreset];
  gl.useProgram(waterProg);
  gl.uniformMatrix4fv(waterU.uVP, false, vp);
  gl.uniform1f(waterU.uTime, state.time);
  gl.uniform1f(waterU.uTide, tide);
  gl.uniform1f(waterU.uAmpScale, P.ampK * Math.pow(wind, P.ampExp));
  gl.uniform1f(waterU.uSpdScale, P.spdK * (0.35 + 0.065 * wind));
  const waves = [], phases = [];
  for (const w of P.waves) { waves.push(w[0], w[1], w[2], w[3]); phases.push(w[4], 0, 0, 0); }
  gl.uniform4fv(waterU.uWaves, waves);
  gl.uniform4fv(waterU.uWavePh, phases);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.uniform1i(waterU.uScene, 0);
  gl.uniform2f(waterU.uRes, canvas.width, canvas.height);
  gl.uniform3fv(waterU.uCamPos, cam.pos);
  gl.uniform3fv(waterU.uSunDir, sunDir());
  gl.uniform1f(waterU.uWind, wind);
  gl.uniform1f(waterU.uRipple, 0.015 + wind * 0.007);
  gl.uniform1i(waterU.uDebug, +ui.debugView.value);
  const loc = gl.getAttribLocation(waterProg, "aXZ");
  bindGrid(waterGrid, loc);
  gl.drawElements(gl.TRIANGLES, waterGrid.count, gl.UNSIGNED_SHORT, 0);
}

function resize() {
  const w = canvas.clientWidth * (window.devicePixelRatio || 1);
  const h = canvas.clientHeight * (window.devicePixelRatio || 1);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    buildFBO(w, h);
  }
}

let frames = 0, fpsLast = performance.now(), prevNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  resize();
  const dt = Math.min((now - prevNow) / 1000, 0.1);
  prevNow = now;
  if (!state.paused) state.time += dt;

  // FPS 统计
  frames++;
  if (now - fpsLast >= 500) {
    const fps = frames * 1000 / (now - fpsLast);
    ui.fps.textContent = `${fps.toFixed(fps < 10 ? 1 : 0)} FPS${state.paused ? " · 已暂停" : ""}`;
    frames = 0; fpsLast = now;
  }

  const tide = +ui.tide.value, wind = +ui.wind.value;
  const aspect = canvas.width / canvas.height;
  const target = [0, 0.5, 0];
  const cp = [
    target[0] + state.dist * Math.cos(state.pitch) * Math.cos(state.yaw),
    target[1] + state.dist * Math.sin(state.pitch),
    target[2] + state.dist * Math.cos(state.pitch) * Math.sin(state.yaw)];
  const view = lookAt(cp, target, [0, 1, 0]);
  const proj = perspective(50 * Math.PI / 180, aspect, 0.1, 400);
  const vp = mul4(proj, view);
  const fwd = [target[0] - cp[0], target[1] - cp[1], target[2] - cp[2]];
  const fl = Math.hypot(...fwd); fwd[0] /= fl; fwd[1] /= fl; fwd[2] /= fl;
  const right = [fwd[2], 0, -fwd[0]];
  const rl = Math.hypot(...right); right[0] /= rl; right[2] /= rl;
  const up = [right[1] * fwd[2] - right[2] * fwd[1],
              right[2] * fwd[0] - right[0] * fwd[2],
              right[0] * fwd[1] - right[1] * fwd[0]];
  const cam = { pos: cp, fwd, right, up, tanFov: Math.tan(25 * Math.PI / 180), aspect };

  // Pass 1：地形+天空 -> 离屏纹理（折射采样源）
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawSky(cam);
  drawTerrain(vp, tide);

  // Pass 2：主画面（天空 + 地形 + 水面）
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawSky(cam);
  drawTerrain(vp, tide);
  drawWater(vp, cam, tide, wind);
}

// ---------- 启动 ----------
buildFBO(2, 2);
refreshLabels();
updateWindTable();
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
requestAnimationFrame(frame);
