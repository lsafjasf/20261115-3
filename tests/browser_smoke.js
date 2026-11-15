/* Smoke test for the browser demo's collision math (run with node). */
"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
  path.join(__dirname, "..", "render", "browser_demo.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// Minimal browser stubs so the demo source can run under node.
const elements = {};
function makeEl() {
  return {
    value: "grid", checked: true, textContent: "",
    addEventListener() {}, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
}
global.document = {
  getElementById: id => (elements[id] = elements[id] || makeEl()),
};
global.canvas = {
  width: 1280, height: 760,
  addEventListener() {},
  getContext: () => ({
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc() {}, fill() {}, closePath() {}, strokeStyle: "", fillStyle: "",
    lineWidth: 0,
  }),
};
elements.view = global.canvas;
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => {};

// Expose internals for assertions.
const instrumented = script +
  "\nmodule.exports = { makeBody, collide, recomputeAabb, gridPairs, " +
  "brutePairs, sapRebuild, sapPairs, reset, bodies, gridCells };";
const Module = require("module");
const mod = new Module("demo");
mod._compile(instrumented, path.join(__dirname, "..", "render", "demo.js"));
const api = mod.exports;

function assert(condition, message) {
  if (!condition) throw new Error("assertion failed: " + message);
}

// Two overlapping axis-aligned rects.
const a = api.makeBody(0);
Object.assign(a, { shape: "rect", x: 0, y: 0, hw: 4, hh: 4, angle: 0 });
api.recomputeAabb(a);
const b = api.makeBody(1);
Object.assign(b, { shape: "rect", x: 6, y: 0, hw: 4, hh: 4, angle: 0 });
api.recomputeAabb(b);
let m = api.collide(a, b);
assert(m !== null, "overlapping rects should collide");
assert(Math.abs(m.depth - 2) < 1e-9, "penetration should be 2, got " + m.depth);
assert(Math.abs(Math.abs(m.normal[0]) - 1) < 1e-9, "normal should be X axis");
assert(m.points.length >= 1, "at least one contact point");

// Two separated circles do not collide.
const c1 = api.makeBody(2);
Object.assign(c1, { shape: "circle", x: 0, y: 0, r: 5 });
api.recomputeAabb(c1);
const c2 = api.makeBody(3);
Object.assign(c2, { shape: "circle", x: 20, y: 0, r: 5 });
api.recomputeAabb(c2);
assert(api.collide(c1, c2) === null, "separated circles should not collide");

// Broad phase parity: grid / SAP return the same pair set as brute force.
api.reset(250);
const brute = new Set(api.brutePairs().map(p => p.join(",")));
const grid = new Set(api.gridPairs().map(p => p.join(",")));
api.sapRebuild();
const sap = new Set(api.sapPairs().map(p => p.join(",")));
assert(brute.size === grid.size, "grid pair count differs");
for (const key of brute) assert(grid.has(key), "grid missing " + key);
assert(brute.size === sap.size, "sap pair count differs");
for (const key of brute) assert(sap.has(key), "sap missing " + key);

console.log("browser smoke test OK:",
            brute.size, "candidate pairs, rect depth", m.depth.toFixed(3));
