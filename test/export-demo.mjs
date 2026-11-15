// Export the app's default 5-layer scene (512x512) to artifacts/.
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Compositor = require("../src/compositor.js");
const PNGEncoder = require("../src/png.js");
const LayerFactory = require("../src/layers.js");

const W = 512, H = 512;
const scene = [
  { type: "background", params: {}, mode: "normal", opacity: 1 },
  { type: "stain", params: { seed: 9, count: 4 }, mode: "multiply", opacity: 0.6 },
  { type: "frost", params: { seed: 42 }, mode: "normal", opacity: 0.7 },
  { type: "stain", params: { seed: 77, count: 5 }, mode: "multiply", opacity: 0.9 },
  { type: "highlight", params: { seed: 101 }, mode: "screen", opacity: 0.8 },
].map((l) => ({ ...l, pixels: LayerFactory.generate(l.type, W, H, l.params) }));

const flat = Compositor.flatten(scene, W * H);
const png = PNGEncoder.encodePNG(flat, W, H);
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/composite.png", png);
fs.writeFileSync("artifacts/composite.raw.rgba", Buffer.from(flat));
console.log(`exported artifacts/composite.png (${png.length} bytes)`);
