// city.js — deterministic isometric city model + geometry.
// Shared between the browser app (global `IsoCity`) and Node (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IsoCity = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const ROOF_STYLES = ["flat", "gable", "pyramid"];
  const COS30 = Math.cos(Math.PI / 6);
  const SIN30 = Math.sin(Math.PI / 6);

  // --- deterministic RNG -------------------------------------------------
  // Hash (seed, x, y) so every building's random traits depend ONLY on its
  // own grid position. Editing one building can never re-randomize others.
  function hash3(seed, x, y) {
    let h = (seed >>> 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (x + 0x85ebca6b), 0xc2b2ae35);
    h = Math.imul(h ^ (y + 0x27d4eb2f), 0x165667b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- city model --------------------------------------------------------
  // A building's base traits come from the seeded hash; user edits live in
  // `overrides` keyed "x,y", so the base city is never re-randomized.
  function generateCity(seed, size) {
    seed = seed >>> 0;
    const buildings = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rng = mulberry32(hash3(seed, x, y));
        if (rng() < 0.12) continue; // occasional empty lot / plaza
        buildings.push({
          x,
          y,
          height: 1 + Math.floor(rng() * 5), // 1..5 levels
          roof: ROOF_STYLES[Math.floor(rng() * ROOF_STYLES.length)],
          roofDir: rng() < 0.5 ? "x" : "y", // gable ridge direction
          hue: Math.floor(rng() * 360),
        });
      }
    }
    return { seed, size, buildings };
  }

  // params: { seed, size, overrides: { "x,y": { height?, roof? } } }
  function resolveCity(params) {
    const city = generateCity(params.seed, params.size);
    const overrides = params.overrides || {};
    for (const b of city.buildings) {
      const o = overrides[b.x + "," + b.y];
      if (!o) continue;
      if (Number.isFinite(o.height)) b.height = Math.max(1, Math.min(9, o.height | 0));
      if (ROOF_STYLES.includes(o.roof)) b.roof = o.roof;
    }
    return city;
  }

  // --- isometric geometry --------------------------------------------------
  const LEVEL_H = 0.55; // world units per level
  const ROOF_H = 0.45;
  const FOOT = 0.4; // half-size of building footprint inside a 1x1 tile

  function rotate(x, y, theta) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return [x * c - y * s, x * s + y * c];
  }

  // Painter depth: larger rx+ry is closer to the camera.
  function depthOf(b, theta) {
    const [rx, ry] = rotate(b.x, b.y, theta);
    return rx + ry;
  }

  function sortByDepth(buildings, theta) {
    return buildings
      .map((b) => ({ b, d: depthOf(b, theta) }))
      .sort((p, q) => p.d - q.d || p.b.x - q.b.x || p.b.y - q.b.y)
      .map((p) => p.b);
  }

  function shade(hue, sat, light) {
    return { h: hue, s: sat, l: light };
  }

  // World-space faces for one building. Each face:
  // { pts: [[x,y,z]...], color: {h,s,l}, tag }
  function buildingWorldFaces(b) {
    const x0 = b.x - FOOT, x1 = b.x + FOOT;
    const y0 = b.y - FOOT, y1 = b.y + FOOT;
    const h = b.height * LEVEL_H;
    const cx = b.x, cy = b.y;
    const wallA = shade(b.hue, 32, 62); // lit wall
    const wallB = shade(b.hue, 32, 46); // shaded wall
    const roofC = shade((b.hue + 180) % 360, 40, 42);
    const topC = shade(b.hue, 25, 72);
    const faces = [];
    faces.push({ pts: [[x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]], color: wallA, tag: "wall" });
    faces.push({ pts: [[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]], color: wallB, tag: "wall" });
    faces.push({ pts: [[x1, y1, 0], [x0, y1, 0], [x0, y1, h], [x1, y1, h]], color: wallA, tag: "wall" });
    faces.push({ pts: [[x0, y1, 0], [x0, y0, 0], [x0, y0, h], [x0, y1, h]], color: wallB, tag: "wall" });
    if (b.roof === "flat") {
      faces.push({ pts: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], color: topC, tag: "roof" });
    } else if (b.roof === "pyramid") {
      const apex = [cx, cy, h + ROOF_H];
      faces.push({ pts: [[x0, y0, h], [x1, y0, h], apex], color: roofC, tag: "roof" });
      faces.push({ pts: [[x1, y0, h], [x1, y1, h], apex], color: shade(roofC.h, roofC.s, roofC.l - 10), tag: "roof" });
      faces.push({ pts: [[x1, y1, h], [x0, y1, h], apex], color: roofC, tag: "roof" });
      faces.push({ pts: [[x0, y1, h], [x0, y0, h], apex], color: shade(roofC.h, roofC.s, roofC.l - 10), tag: "roof" });
    } else { // gable
      const r = h + ROOF_H;
      if (b.roofDir === "x") {
        faces.push({ pts: [[x0, y0, h], [x1, y0, h], [x1, cy, r], [x0, cy, r]], color: roofC, tag: "roof" });
        faces.push({ pts: [[x1, y1, h], [x0, y1, h], [x0, cy, r], [x1, cy, r]], color: shade(roofC.h, roofC.s, roofC.l - 10), tag: "roof" });
        faces.push({ pts: [[x0, y0, h], [x0, cy, r], [x0, y1, h]], color: wallA, tag: "roof" });
        faces.push({ pts: [[x1, y1, h], [x1, cy, r], [x1, y0, h]], color: wallB, tag: "roof" });
      } else {
        faces.push({ pts: [[x1, y0, h], [x1, y1, h], [cx, y1, r], [cx, y0, r]], color: roofC, tag: "roof" });
        faces.push({ pts: [[x0, y1, h], [x0, y0, h], [cx, y0, r], [cx, y1, r]], color: shade(roofC.h, roofC.s, roofC.l - 10), tag: "roof" });
        faces.push({ pts: [[x0, y0, h], [x1, y0, h], [cx, y0, r]], color: wallA, tag: "roof" });
        faces.push({ pts: [[x1, y1, h], [x0, y1, h], [cx, y1, r]], color: wallB, tag: "roof" });
      }
    }
    return faces;
  }

  // Project the whole city into screen space. Returns globally depth-sorted
  // faces: { pts: [[sx,sy]...], color, building } — draw back-to-front.
  function projectCity(city, theta, scale) {
    scale = scale || 40;
    const faces = [];
    for (const b of city.buildings) {
      for (const f of buildingWorldFaces(b)) {
        let depth = 0;
        const pts = f.pts.map(([wx, wy, wz]) => {
          const [rx, ry] = rotate(wx, wy, theta);
          depth += rx + ry;
          return [(rx - ry) * COS30 * scale, (rx + ry) * SIN30 * scale - wz * scale];
        });
        faces.push({ pts, color: f.color, tag: f.tag, depth: depth / f.pts.length, building: b });
      }
    }
    faces.sort((p, q) => p.depth - q.depth);
    return faces;
  }

  return {
    ROOF_STYLES,
    LEVEL_H,
    hash3,
    mulberry32,
    generateCity,
    resolveCity,
    rotate,
    depthOf,
    sortByDepth,
    buildingWorldFaces,
    projectCity,
  };
});
