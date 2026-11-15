/**
 * Headless smoke test for the browser UI (public/app.js).
 * A tiny DOM/canvas stub lets the same module run under Node, proving
 * stats rendering, soak cycling and the no-update-after-removal check.
 */

const elements = new Map();
const clickHandlers = new Map();

class StubContext {
  setTransform() {}
  clearRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  fillText() {}
  roundRect() {}
}

function makeElement(id) {
  return {
    id,
    textContent: "",
    disabled: false,
    clientWidth: 1200,
    clientHeight: 800,
    getContext: () => new StubContext(),
    addEventListener(event, handler) {
      if (id) clickHandlers.set(`${id}:${event}`, handler);
    },
  };
}

globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) {
      elements.set(id, makeElement(id));
    }
    return elements.get(id);
  },
};

globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: () => {},
};

globalThis.requestAnimationFrame = (callback) => callback(0);
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback) => {
  queueMicrotask(callback);
  return 0;
};

await import("../public/app.js");
globalThis.setTimeout = originalSetTimeout;

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const text = (id) => elements.get(id).textContent;

// Initial render: one chain of five nodes with four edges.
assert(text("nodeCount") === "5", `initial node count, got ${text("nodeCount")}`);
assert(text("edgeCount") === "4", `initial edge count, got ${text("edgeCount")}`);
// Five node tick listeners plus the UI's own structure-changed listener.
assert(text("listenerCount") === "6", `initial listeners, got ${text("listenerCount")}`);
assert(text("cacheBytes").includes("KiB"), `cache shown, got ${text("cacheBytes")}`);

// Add another chain.
await clickHandlers.get("addBtn:click")();
assert(text("nodeCount") === "10", `after add, got ${text("nodeCount")}`);

// Remove everything: counters must return to zero.
await clickHandlers.get("removeBtn:click")();
assert(text("nodeCount") === "0", `after remove, got ${text("nodeCount")}`);
assert(text("edgeCount") === "0", `edges after remove, got ${text("edgeCount")}`);
assert(text("listenerCount") === "1",
  `only the UI listener remains, got ${text("listenerCount")}`);
assert(text("cacheBytes") === "48 B",
  `only UI listener overhead remains, got ${text("cacheBytes")}`);
assert(text("log").includes("删除后仍收到更新: 否"),
  "removed nodes must not receive updates");

// UI soak: 50 add/remove cycles, stats must end back at zero.
await clickHandlers.get("soakBtn:click")();
assert(text("nodeCount") === "0", `post-soak nodes, got ${text("nodeCount")}`);
assert(text("cacheBytes") === "48 B",
  `post-soak cache holds only UI listener, got ${text("cacheBytes")}`);
assert(text("log").includes("首尾峰值资源一致 = 是"),
  "soak peak resources must match between first and last cycle");

console.log("=== browser app headless smoke test ===");
if (failures.length === 0) {
  console.log("RESULT: PASS (render, remove, 50-cycle soak all clean)");
} else {
  console.log("RESULT: FAIL");
  for (const failure of failures) console.log(` - ${failure}`);
  process.exitCode = 1;
}
