import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIMITS } from "../src/schema.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = join(
  scriptDirectory,
  "..",
  "fixtures",
  "oversized-array.json"
);

const nodes = Array.from({ length: LIMITS.nodes + 1 }, (_, index) => ({
  id: `bulk-${index + 1}`,
  title: `批量节点 ${index + 1}`
}));

const document = {
  schemaVersion: 1,
  project: {
    id: "oversized-array-demo",
    name: "超出数组上限的工程",
    nodes,
    edges: []
  }
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${outputPath} (${nodes.length} nodes)`);
