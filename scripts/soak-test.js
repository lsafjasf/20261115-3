import { NodeGraph } from "../src/node-graph.js";

/**
 * Fixed lifecycle soak test.
 * The graph is built and torn down 50 times. Resource snapshots taken
 * before the first cycle and after the last one must be identical, and
 * every removed node is proven not to receive any later update.
 */
const CYCLES = 50;
const NODES_PER_CYCLE = 20;
const BUFFER_SIZE = 1024;

function buildBatch(graph, batchSize) {
  const created = [];
  let previous = null;
  for (let index = 0; index < batchSize; index += 1) {
    const node = graph.addNode(index % 2 === 0 ? "audio" : "graphics",
      BUFFER_SIZE);
    if (previous !== null) {
      graph.connect(previous.id, node.id);
    }
    previous = node;
    created.push(node);
  }
  return created;
}

function formatBytes(value) {
  return `${value} B (${(value / 1024).toFixed(2)} KiB)`;
}

function run() {
  const graph = new NodeGraph();
  const failures = [];
  const gcAvailable = typeof globalThis.gc === "function";
  if (gcAvailable) {
    globalThis.gc();
    globalThis.gc();
  }
  const heapStart = gcAvailable ? process.memoryUsage().heapUsed : 0;

  // Baseline of the empty graph: every resource counter must return here.
  const baseline = graph.snapshot();
  graph.tick();

  let firstStable = null;
  let lastStable = null;
  let firstPeak = null;
  let lastPeak = null;
  let removedNodeUpdatesAfterDeath = 0;

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const batch = buildBatch(graph, NODES_PER_CYCLE);
    const peak = graph.snapshot();

    // Live processing while the batch exists.
    graph.tick();
    graph.tick();

    const beforeRemoval = batch.map((node) => node.updateCount);

    for (const node of batch) {
      graph.removeNode(node.id);
    }

    // Any tick after removal must not reach the disposed nodes.
    graph.tick();
    graph.tick();

    for (let index = 0; index < batch.length; index += 1) {
      const node = batch[index];
      if (node.updateCount !== beforeRemoval[index]) {
        removedNodeUpdatesAfterDeath += 1;
      }
      if (node.alive || node.buffer !== null ||
        node.inputs.size !== 0 || node.outputs.size !== 0 ||
        node._disposers.length !== 0) {
        failures.push(
          `cycle ${cycle}: node ${node.id} was not fully disposed`);
      }
    }

    const stable = graph.snapshot();
    if (cycle === 1) {
      firstStable = stable;
      firstPeak = peak;
    }
    lastStable = stable;
    lastPeak = peak;

    if (stable.nodeCount !== 0 || stable.edgeCount !== 0 ||
      stable.listenerCount !== 0 ||
      stable.estimatedCacheBytes !== 0) {
      failures.push(`cycle ${cycle}: resources leaked -> ${
        JSON.stringify(stable)}`);
    }
  }

  if (removedNodeUpdatesAfterDeath !== 0) {
    failures.push(
      `${removedNodeUpdatesAfterDeath} removed node(s) received updates`);
  }

  const endSnapshot = graph.snapshot();

  console.log("=== Node editor lifecycle soak test ===");
  console.log(`cycles: ${CYCLES}, nodes per cycle: ${
    NODES_PER_CYCLE}`);
  console.log("\n-- baseline (empty graph) --");
  console.table(baseline);
  console.log("-- stable snapshot after cycle 1 --");
  console.table(firstStable);
  console.log("-- peak snapshot during cycle 1 --");
  console.table(firstPeak);
  console.log(`-- stable snapshot after cycle ${CYCLES} --`);
  console.table(lastStable);
  console.log(`-- peak snapshot during cycle ${CYCLES} --`);
  console.table(lastPeak);

  const sameStable = JSON.stringify(firstStable) ===
    JSON.stringify(lastStable);
  const samePeak = JSON.stringify(firstPeak) === JSON.stringify(lastPeak);
  const backToBaseline = JSON.stringify(endSnapshot) ===
    JSON.stringify(baseline);

  console.log("\n=== first vs last resource comparison ===");
  console.log("peak while a batch is alive (cycle 1 -> cycle 50):");
  console.log(`nodeCount:            ${firstPeak.nodeCount} -> ${
    lastPeak.nodeCount}`);
  console.log(`edgeCount:            ${firstPeak.edgeCount} -> ${
    lastPeak.edgeCount}`);
  console.log(`listenerCount:        ${firstPeak.listenerCount} -> ${
    lastPeak.listenerCount}`);
  console.log(`estimatedCacheBytes:  ${formatBytes(
    firstPeak.estimatedCacheBytes)} -> ${formatBytes(
    lastPeak.estimatedCacheBytes)}`);
  console.log("stable after teardown (cycle 1 -> cycle 50):");
  console.log(`nodeCount:            ${firstStable.nodeCount} -> ${
    lastStable.nodeCount}`);
  console.log(`estimatedCacheBytes:  ${formatBytes(
    firstStable.estimatedCacheBytes)} -> ${formatBytes(
    lastStable.estimatedCacheBytes)}`);
  console.log(`peak first == last:   ${samePeak}`);
  console.log(`stable first == last: ${sameStable}`);
  console.log(`returned to baseline: ${backToBaseline}`);

  if (globalThis.gc) {
    globalThis.gc();
    globalThis.gc();
    const heapEnd = process.memoryUsage().heapUsed;
    const delta = heapEnd - heapStart;
    console.log(`\nheapUsed start:       ${formatBytes(heapStart)}`);
    console.log(`heapUsed end:         ${formatBytes(heapEnd)}`);
    console.log(`heap delta:           ${formatBytes(delta)} ` +
      "(runtime bookkeeping; graph resources are zero)");
  }

  const passed = failures.length === 0 && sameStable && samePeak &&
    backToBaseline;
  console.log(`\nRESULT: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) {
    for (const failure of failures) {
      console.log(` - ${failure}`);
    }
    process.exitCode = 1;
  }
}

run();
