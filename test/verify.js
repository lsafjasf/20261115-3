// test/verify.js — headless verification for the isometric city generator.
// Checks:
//   1. Two "machines" (separate Node processes) with the same seed produce
//      byte-identical cities.
//   2. Editing one building (height + roof) leaves every other building
//      untouched — no city-wide re-randomization.
//   3. Tall/short occlusion is correct and follows camera rotation.
// Writes artifacts (JSON + PNG + report) into artifacts/.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const C = require(path.join(__dirname, "..", "city.js"));
const { renderFaces, encodePng, hslToRgb } = require("./softrender.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "artifacts");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const SEED = 20261115;
const SIZE = 8;

// --- 1. same seed, two "machines" ------------------------------------------
const paramsA = { seed: SEED, size: SIZE, overrides: {} };
const cityA = C.resolveCity(paramsA);

const canonical = (params) =>
  JSON.stringify(C.resolveCity(params).buildings.map((b) => [b.x, b.y, b.height, b.roof, b.roofDir, b.hue]));
const hashInChild = (params) =>
  execFileSync(process.execPath, ["-e",
    `const C=require(${JSON.stringify(path.join(ROOT, "city.js"))});` +
    `const p=${JSON.stringify(params)};` +
    `const c=C.resolveCity(p).buildings.map(b=>[b.x,b.y,b.height,b.roof,b.roofDir,b.hue]);` +
    `process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify(c)).digest("hex"));`,
  ]).toString();

const hashMachine1 = hashInChild(paramsA);
const hashMachine2 = hashInChild(paramsA); // independent process == "second machine"
check("同 seed 两台机器生成一致", hashMachine1 === hashMachine2, `sha256=${hashMachine1.slice(0, 16)}…`);

// JSON export → import round-trip reproduces the city exactly.
const exported = JSON.stringify({ ...paramsA, buildings: cityA.buildings });
const reimported = JSON.parse(exported);
const cityRoundTrip = C.resolveCity(reimported);
check(
  "JSON 导出/导入往返一致",
  canonical(paramsA) === canonical(reimported) &&
    JSON.stringify(cityRoundTrip.buildings) === JSON.stringify(cityA.buildings)
);

// --- 2. edit isolation -------------------------------------------------------
const target = cityA.buildings.find((b) => b.height >= 3) || cityA.buildings[0];
const key = `${target.x},${target.y}`;
const paramsMod = {
  ...paramsA,
  overrides: { [key]: { height: 9, roof: target.roof === "pyramid" ? "flat" : "pyramid" } },
};
const cityMod = C.resolveCity(paramsMod);
const cityB = C.resolveCity(paramsA); // the untouched "second machine" city

check("修改后建筑总数不变", cityMod.buildings.length === cityB.buildings.length,
  `${cityMod.buildings.length} 栋`);

const diffs = [];
for (const bm of cityMod.buildings) {
  const bb = cityB.buildings.find((b) => b.x === bm.x && b.y === bm.y);
  if (!bb) {
    diffs.push(`(${bm.x},${bm.y}) 消失`);
    continue;
  }
  for (const f of ["height", "roof", "roofDir", "hue"]) {
    if (bm[f] !== bb[f]) diffs.push(`(${bm.x},${bm.y}).${f}: ${bb[f]} -> ${bm[f]}`);
  }
}
const targetDiffs = diffs.filter((d) => d.startsWith(`(${key})`));
const otherDiffs = diffs.filter((d) => !d.startsWith(`(${key})`));
check("仅目标建筑被修改", otherDiffs.length === 0 && targetDiffs.length === 2,
  `目标改动 ${targetDiffs.length} 处，其他建筑改动 ${otherDiffs.length} 处`);
check("其他建筑位置保持一致",
  cityMod.buildings.every((bm) => cityB.buildings.some((bb) => bb.x === bm.x && bb.y === bm.y)));

// --- 3. tall/short occlusion vs rotation -------------------------------------
// Controlled two-building scene: short at (0,0) h=1, tall at (1,0) h=6.
const scene = {
  seed: SEED,
  size: 2,
  buildings: [
    { x: 0, y: 0, height: 1, roof: "flat", roofDir: "x", hue: 210 }, // short
    { x: 1, y: 0, height: 6, roof: "flat", roofDir: "x", hue: 20 },  // tall
  ],
};
const SCALE = 60, W = 420, H = 420, CX = W / 2, CY = H / 2;

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Topmost face at screen point (px,py), walking the sorted list back-to-front.
function topmostAt(faces, px, py) {
  let hit = null;
  for (const f of faces) if (pointInPoly(px, py, f.pts)) hit = f;
  return hit;
}

function occlusionAt(theta) {
  const faces = C.projectCity(scene, theta, SCALE);
  const order = C.sortByDepth(scene.buildings, theta);
  const front = order[order.length - 1];
  const back = order[0];
  // Probe a grid of sample points across the back building's faces for one
  // covered by `front` (a short front building only covers a bottom strip,
  // so centroid-only probing would miss it).
  const samples = (pts) => {
    const out = [];
    const N = 16;
    if (pts.length === 4) {
      const [a, b, c, d] = pts;
      for (let i = 1; i < N; i++) {
        for (let j = 1; j < N; j++) {
          const u = i / N, v = j / N;
          out.push([
            (a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v,
            (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v,
          ]);
        }
      }
    } else {
      const [a, b, c] = pts;
      for (let i = 1; i < N; i++) {
        for (let j = 1; j < N - i; j++) {
          const u = i / N, v = j / N;
          out.push([
            a[0] * (1 - u - v) + b[0] * u + c[0] * v,
            a[1] * (1 - u - v) + b[1] * u + c[1] * v,
          ]);
        }
      }
    }
    return out;
  };
  let probe = null;
  for (const f of faces) {
    if (f.building !== back) continue;
    for (const [px, py] of samples(f.pts)) {
      const top = topmostAt(faces, px, py);
      if (top && top.building === front) {
        probe = { px, py, expected: top };
        break;
      }
    }
    if (probe) break;
  }
  return { faces, front, back, probe };
}

const THETA0 = Math.PI / 4;
const occ0 = occlusionAt(THETA0);
check("θ=45° 高楼在前遮挡低楼",
  occ0.front.height === 6 && !!occ0.probe,
  occ0.probe ? `低楼背面采样点被 (${occ0.front.x},${occ0.front.y}) 覆盖` : "未找到遮挡采样点");

const occ1 = occlusionAt(THETA0 + Math.PI);
check("旋转 180° 后遮挡关系同步翻转",
  occ1.front.height === 1 && !!occ1.probe,
  occ1.probe ? `现在矮楼 (${occ1.front.x},${occ1.front.y}) 在前` : "未找到遮挡采样点");

// Pixel-level check: render and compare the probed pixel's color to the
// front building's face color.
function pixelCheck(occ, label) {
  if (!occ.probe) return false;
  const fb = renderFaces(occ.faces, W, H, CX, CY);
  const [r, g, b] = fb.get(Math.round(occ.probe.px + CX), Math.round(occ.probe.py + CY));
  const [er, eg, eb] = hslToRgb(occ.probe.expected.color.h, occ.probe.expected.color.s, occ.probe.expected.color.l);
  const dist = Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb);
  check(`${label}：像素颜色属于前景建筑`, dist <= 12,
    `像素=(${r},${g},${b}) 期望≈(${er},${eg},${eb})`);
  return fb;
}
const fb0 = pixelCheck(occ0, "θ=45°");
const fb1 = pixelCheck(occ1, "θ=225°");

// --- artifacts ---------------------------------------------------------------
const fullFacesA = C.projectCity(cityA, THETA0 + 0.4, 34);
const fullFacesMod = C.projectCity(cityMod, THETA0 + 0.4, 34);
const pngOpts = [900, 640, 450, 300];
fs.writeFileSync(path.join(OUT, "city_a.png"), encodePng(renderFaces(fullFacesA, ...pngOpts)));
fs.writeFileSync(path.join(OUT, "city_a_modified.png"), encodePng(renderFaces(fullFacesMod, ...pngOpts)));
if (fb0) fs.writeFileSync(path.join(OUT, "occlusion_theta45.png"), encodePng(fb0));
if (fb1) fs.writeFileSync(path.join(OUT, "occlusion_theta225.png"), encodePng(fb1));
fs.writeFileSync(path.join(OUT, "city_a.json"), JSON.stringify({ ...paramsA, buildings: cityA.buildings }, null, 2));
fs.writeFileSync(path.join(OUT, "city_b.json"), JSON.stringify({ ...paramsA, buildings: cityB.buildings }, null, 2));
fs.writeFileSync(path.join(OUT, "city_a_modified.json"), JSON.stringify({ ...paramsMod, buildings: cityMod.buildings }, null, 2));

const report = {
  seed: SEED,
  size: SIZE,
  generatedAt: new Date().toISOString(),
  machineHashes: [hashMachine1, hashMachine2],
  modifiedBuilding: key,
  results,
  allPassed: results.every((r) => r.ok),
};
fs.writeFileSync(path.join(OUT, "verification_report.json"), JSON.stringify(report, null, 2));

console.log(`\n${report.allPassed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(report.allPassed ? 0 : 1);
