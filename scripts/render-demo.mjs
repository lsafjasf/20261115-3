import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDemoProject } from "../src/demo-project.js";
import { makeExportProject, normalizeProject } from "../src/project.js";
import { renderProjectToStereo } from "../src/synth.js";
import { encodeWav } from "../src/wav.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const project = normalizeProject(createDemoProject());
const jsonPath = `${root}/data/midnight-grid.json`;
const wavPath = `${root}/demo/midnight-grid-2x16-step.wav`;

writeFileSync(jsonPath, `${JSON.stringify(makeExportProject(project), null, 2)}\n`);

const rendered = renderProjectToStereo(project, {
  sampleRate: 44100,
  cycles: 2,
});
const wav = encodeWav(rendered.left, rendered.right, rendered.sampleRate);
writeFileSync(wavPath, wav);

let peak = 0;
for (let index = 0; index < rendered.frameCount; index += 1) {
  peak = Math.max(
    peak,
    Math.abs(rendered.left[index]),
    Math.abs(rendered.right[index]),
  );
}

console.log(`JSON  ${jsonPath}`);
console.log(`WAV   ${wavPath}`);
console.log(
  `Audio ${rendered.duration.toFixed(3)}s · 44.1kHz · stereo · peak ${peak.toFixed(3)}`,
);
