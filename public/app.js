import { NodeGraph } from "../src/node-graph.js";

const graph = new NodeGraph();
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const logEl = document.getElementById("log");

const els = {
  nodeCount: document.getElementById("nodeCount"),
  edgeCount: document.getElementById("edgeCount"),
  listenerCount: document.getElementById("listenerCount"),
  cacheBytes: document.getElementById("cacheBytes"),
  tickCount: document.getElementById("tickCount"),
};

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(2)} KiB`;
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.split("\n")
    .slice(0, 40).join("\n");
}

function renderStats() {
  const metrics = graph.metrics();
  els.nodeCount.textContent = String(metrics.nodeCount);
  els.edgeCount.textContent = String(metrics.edgeCount);
  els.listenerCount.textContent = String(metrics.listenerCount);
  els.cacheBytes.textContent = formatBytes(metrics.estimatedCacheBytes);
  els.tickCount.textContent = String(graph.tickCount);
}

function nodePosition(index, total) {
  const cols = 5;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 200 + col * 150,
    y: 110 + row * 130,
  };
}

function renderCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth, clientHeight } = canvas;
  if (canvas.width !== clientWidth * dpr) {
    canvas.width = clientWidth * dpr;
    canvas.height = clientHeight * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, clientWidth, clientHeight);

  const nodes = [...graph.nodes.values()];
  const positions = new Map();
  nodes.forEach((node, index) => {
    positions.set(node.id, nodePosition(index, nodes.length));
  });

  // Edges first, so nodes draw on top.
  ctx.strokeStyle = "#5eb1ff";
  ctx.lineWidth = 1.5;
  for (const node of nodes) {
    const from = positions.get(node.id);
    for (const targetId of node.outputs.keys()) {
      const to = positions.get(targetId);
      if (!to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x + 96, from.y + 28);
      ctx.lineTo(to.x, to.y + 28);
      ctx.stroke();
    }
  }

  for (const [id, pos] of positions) {
    const node = graph.nodes.get(id);
    ctx.fillStyle = node.type === "audio" ? "#274060" : "#2d4a3e";
    ctx.strokeStyle = "#5eb1ff";
    ctx.beginPath();
    ctx.roundRect(pos.x, pos.y, 96, 56, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e6ebf5";
    ctx.font = "12px system-ui";
    ctx.fillText(`#${node.id} ${node.type}`, pos.x + 10, pos.y + 24);
    ctx.fillStyle = "#93a0b8";
    ctx.fillText(`${node.bufferSize} f32`, pos.x + 10, pos.y + 42);
  }
}

function render() {
  renderStats();
  renderCanvas();
}

graph.onStructureChange(() => render());
window.addEventListener("resize", renderCanvas);

function addChain(length = 5) {
  let previous = null;
  for (let index = 0; index < length; index += 1) {
    const node = graph.addNode(index % 2 === 0 ? "audio" : "graphics");
    if (previous) {
      graph.connect(previous.id, node.id);
    }
    previous = node;
  }
  log(`添加节点链 ${length} 个，当前 ${graph.nodes.size} 个节点`);
}

function removeAll() {
  const before = graph.nodes.size;
  const removed = [...graph.nodes.values()];
  const updatesBefore = removed.map((node) => node.updateCount);
  graph.removeAll();

  // Prove removed nodes never process again after the next ticks.
  graph.tick();
  graph.tick();
  const zombie = removed.some((node, index) =>
    node.updateCount !== updatesBefore[index]);
  log(`删除 ${before} 个节点；删除后仍收到更新: ${zombie ? "是(异常)" : "否"}`);
}

async function runSoak() {
  const button = document.getElementById("soakBtn");
  button.disabled = true;
  const cycles = 50;
  const firstPeak = { value: null };
  const lastPeak = { value: null };

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    addChain(5);
    graph.tick();
    if (cycle === 1) firstPeak.value = graph.snapshot();
    lastPeak.value = graph.snapshot();
    removeAll();
    if (cycle % 10 === 0) {
      log(`循环 ${cycle}/${cycles} 完成，节点数=${graph.nodes.size}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const identical = JSON.stringify(firstPeak.value) ===
    JSON.stringify(lastPeak.value);
  log(`50 次循环结束：首尾峰值资源一致 = ${identical ? "是" : "否"}，` +
    `当前缓存 = ${formatBytes(graph.metrics().estimatedCacheBytes)}`);
  button.disabled = false;
}

document.getElementById("addBtn").addEventListener("click", () => addChain());
document.getElementById("removeBtn").addEventListener("click", removeAll);
document.getElementById("soakBtn").addEventListener("click", runSoak);

addChain(5);
graph.tick();
render();
log("初始化完成：监听、连接与缓冲均在删除时显式释放");
