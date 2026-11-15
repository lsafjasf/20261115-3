import {
  NODE_DEFAULTS,
  SAMPLE_GRAPH,
  clone,
  createEdge,
  createNode,
  edgesEquivalent,
  findNode,
  graphsEquivalent,
  nearestPort,
  parseGraph,
  portPoint,
  removeNode,
  serializeGraph,
} from "./model.js";
import { routeAll, routesEquivalent } from "./router.js";
import { buildSvgDocument, downloadText, safeFilename } from "./export.js";
import { clampToCanvas, renderGraph, screenToCanvas } from "./render.js";
import { installGraphStyles } from "./svg-style.js";

const STORAGE_KEY = "flowboard.graph.v1";
const MAX_HISTORY = 60;

const svg = document.querySelector("#flow-svg");
const graphTitle = document.querySelector("#graph-title");
const graphTitleInput = document.querySelector("#graph-title-input");
const routeStatus = document.querySelector("#route-status");
const routeStatusText = document.querySelector("#route-status-text");
const undoButton = document.querySelector("#undo-button");
const redoButton = document.querySelector("#redo-button");
const emptyInspector = document.querySelector("#empty-inspector");
const nodeInspector = document.querySelector("#node-inspector");
const edgeInspector = document.querySelector("#edge-inspector");
const nodeTextInput = document.querySelector("#node-text-input");
const nodeTypeSelect = document.querySelector("#node-type-select");
const nodeIdTag = document.querySelector("#node-id-tag");
const nodeDegree = document.querySelector("#node-degree");
const nodeXInput = document.querySelector("#node-x-input");
const nodeYInput = document.querySelector("#node-y-input");
const edgeIdTag = document.querySelector("#edge-id-tag");
const edgeEndpoints = document.querySelector("#edge-endpoints");
const edgeLabelInput = document.querySelector("#edge-label-input");
const importFile = document.querySelector("#import-file");
const toast = document.querySelector("#toast");
const connectionPreview = document.querySelector("#connection-preview");

let graph = loadInitialGraph();
let selection = null;
let routes = routeAll(graph);
let undoStack = [];
let redoStack = [];
let dragState = null;
let connectState = null;
let toastTimer = 0;

function loadInitialGraph() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseGraph(saved);
  } catch {
    // A fresh sample is safer than blocking startup on stale local data.
  }
  return clone(SAMPLE_GRAPH);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeGraph(graph));
  } catch {
    // Editing remains functional when private browsing blocks storage.
  }
}

function validSelection() {
  if (!selection) return;
  if (selection.kind === "node" && !findNode(graph, selection.id)) selection = null;
  if (selection.kind === "edge" && !graph.edges.some((edge) => edge.id === selection.id)) selection = null;
}

function render() {
  validSelection();
  routes = routeAll(graph);
  renderGraph(svg, graph, routes, selection);
  updateChrome();
}

function updateChrome() {
  document.title = `${graph.title} · Flowboard`;
  graphTitle.textContent = graph.title;
  if (document.activeElement !== graphTitleInput) graphTitleInput.value = graph.title;
  const missing = graph.edges.length - routes.size;
  if (missing > 0) {
    routeStatusText.textContent = `${missing} 条连线无法避障`;
    routeStatus.classList.add("warning");
  } else {
    routeStatusText.textContent = `${graph.edges.length} 条连线 · 自动避障`;
    routeStatus.classList.remove("warning");
  }
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
  updateInspector();
}

function addEndpointChip(text) {
  const chip = document.createElement("div");
  chip.className = "endpoint-chip";
  chip.textContent = text;
  edgeEndpoints.append(chip);
}

function updateInspector() {
  const selectedNode = selection?.kind === "node" ? findNode(graph, selection.id) : null;
  const selectedEdge = selection?.kind === "edge" ? graph.edges.find((edge) => edge.id === selection.id) : null;
  emptyInspector.hidden = Boolean(selectedNode || selectedEdge);
  nodeInspector.hidden = !selectedNode;
  edgeInspector.hidden = !selectedEdge;

  if (selectedNode) {
    nodeIdTag.textContent = selectedNode.id;
    if (document.activeElement !== nodeTextInput) nodeTextInput.value = selectedNode.text;
    nodeTypeSelect.value = selectedNode.type;
    nodeXInput.value = Math.round(selectedNode.x);
    nodeYInput.value = Math.round(selectedNode.y);
    const degree = graph.edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id).length;
    nodeDegree.textContent = `${degree} 条`;
  }

  if (selectedEdge) {
    edgeIdTag.textContent = selectedEdge.id;
    edgeEndpoints.replaceChildren();
    const source = findNode(graph, selectedEdge.from);
    const target = findNode(graph, selectedEdge.to);
    addEndpointChip(`${source?.text ?? selectedEdge.from}  ·  ${selectedEdge.fromPort}`);
    addEndpointChip(`${target?.text ?? selectedEdge.to}  ·  ${selectedEdge.toPort}`);
    if (document.activeElement !== edgeLabelInput) edgeLabelInput.value = selectedEdge.label;
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function trimHistory(stack) {
  if (stack.length > MAX_HISTORY) stack.splice(0, stack.length - MAX_HISTORY);
}

function commit(mutator, message = "") {
  const next = clone(graph);
  mutator(next);
  if (graphsEquivalent(graph, next)) return false;
  undoStack.push(clone(graph));
  trimHistory(undoStack);
  redoStack = [];
  graph = next;
  validSelection();
  persist();
  render();
  if (message) showToast(message);
  return true;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(clone(graph));
  graph = undoStack.pop();
  selection = null;
  persist();
  render();
  showToast("已撤销上一步编辑");
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(clone(graph));
  trimHistory(undoStack);
  graph = redoStack.pop();
  selection = null;
  persist();
  render();
  showToast("已重做编辑");
}

function deleteSelection() {
  if (selection?.kind === "node") {
    const node = findNode(graph, selection.id);
    if (!node) return;
    const removedEdges = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length;
    const id = node.id;
    selection = null;
    commit((next) => {
      const result = removeNode(next, id);
      next.nodes = result.nodes;
      next.edges = result.edges;
    }, `已删除节点及 ${removedEdges} 条相连边，可撤销恢复`);
    return;
  }
  if (selection?.kind === "edge") {
    const id = selection.id;
    selection = null;
    commit((next) => {
      next.edges = next.edges.filter((edge) => edge.id !== id);
    }, "已删除连线，可撤销恢复");
  }
}

function beginDrag(event, node) {
  const nodeElement = event.target.closest(".node");
  const portElement = event.target.closest(".port");
  selection = { kind: "node", id: node.id };
  render();
  svg.setPointerCapture(event.pointerId);

  if (portElement) {
    const fromPort = portElement.dataset.port;
    connectState = {
      from: node.id,
      fromPort,
      start: portPoint(node, fromPort),
      pointerId: event.pointerId,
    };
    connectionPreview.classList.add("visible");
    return;
  }

  const start = screenToCanvas(svg, event.clientX, event.clientY);
  dragState = {
    id: node.id,
    start,
    nodeStart: { x: node.x, y: node.y },
    before: clone(graph),
    moved: false,
    pointerId: event.pointerId,
  };
  nodeElement.classList.add("dragging");
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  const nodeElement = event.target.closest?.(".node");
  if (nodeElement) {
    event.preventDefault();
    const node = findNode(graph, nodeElement.dataset.nodeId);
    if (node) beginDrag(event, node);
    return;
  }

  const edgeElement = event.target.closest?.(".edge");
  if (edgeElement) {
    event.preventDefault();
    selection = { kind: "edge", id: edgeElement.dataset.edgeId };
    render();
    return;
  }

  selection = null;
  render();
}

function drawPreview(point) {
  if (!connectState) return;
  const start = connectState.start;
  const midX = (start.x + point.x) / 2;
  const midY = (start.y + point.y) / 2;
  const horizontal = Math.abs(point.x - start.x) >= Math.abs(point.y - start.y);
  const d = horizontal
    ? `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${point.y} L ${point.x} ${point.y}`
    : `M ${start.x} ${start.y} L ${start.x} ${midY} L ${point.x} ${midY} L ${point.x} ${point.y}`;
  connectionPreview.setAttribute("d", d);
}

function handlePointerMove(event) {
  if (dragState?.pointerId === event.pointerId) {
    const point = screenToCanvas(svg, event.clientX, event.clientY);
    const dx = point.x - dragState.start.x;
    const dy = point.y - dragState.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) dragState.moved = true;
    if (!dragState.moved) return;
    const node = findNode(graph, dragState.id);
    if (!node) return;
    const next = clampToCanvas(dragState.nodeStart.x + dx, dragState.nodeStart.y + dy, node.width, node.height);
    node.x = Math.round(next.x);
    node.y = Math.round(next.y);
    render();
    return;
  }

  if (connectState?.pointerId === event.pointerId) {
    drawPreview(screenToCanvas(svg, event.clientX, event.clientY));
  }
}

function finishDrag() {
  if (dragState?.moved) {
    undoStack.push(dragState.before);
    trimHistory(undoStack);
    redoStack = [];
    persist();
    render();
    showToast("节点已移动，连线已自动重新避障");
  }
  dragState = null;
}

function finishConnection(event) {
  if (!connectState) return;
  const point = screenToCanvas(svg, event.clientX, event.clientY);
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const targetElement = hit?.closest?.(".node");
  const target = targetElement ? findNode(graph, targetElement.dataset.nodeId) : null;
  const sourceId = connectState.from;
  const fromPort = connectState.fromPort;
  connectState = null;
  connectionPreview.classList.remove("visible");
  connectionPreview.removeAttribute("d");
  if (!target || target.id === sourceId) return;

  const toPort = nearestPort(target, point);
  const edge = createEdge(sourceId, target.id, fromPort, toPort);
  selection = { kind: "edge", id: edge.id };
  commit((next) => {
    next.edges.push(edge);
  }, "已创建连线并自动避障");
}

function handlePointerUp(event) {
  if (dragState?.pointerId === event.pointerId) finishDrag();
  if (connectState?.pointerId === event.pointerId) finishConnection(event);
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
}

function handlePointerCancel(event) {
  if (dragState?.moved) {
    graph = dragState.before;
    persist();
    render();
    showToast("已取消本次移动");
  }
  dragState = null;
  connectState = null;
  connectionPreview.classList.remove("visible");
  connectionPreview.removeAttribute("d");
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  render();
}

function findOpenPosition(type) {
  const size = NODE_DEFAULTS[type] ?? NODE_DEFAULTS.process;
  const candidates = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      candidates.push({ x: 150 + column * 235, y: 150 + row * 145 });
    }
  }
  const open = candidates.find(({ x, y }) =>
    graph.nodes.every((node) =>
      x + size.width + 24 < node.x ||
      x > node.x + node.width + 24 ||
      y + size.height + 24 < node.y ||
      y > node.y + node.height + 24
    )
  );
  return open ?? { x: 500, y: 350 };
}

function addNode() {
  const type = document.querySelector("#add-type").value;
  const position = findOpenPosition(type);
  const labels = {
    start: "新的开始",
    end: "新的结束",
    process: "新的处理步骤",
    decision: "新的判断？",
    merge: "新的汇合",
    comment: "在这里补充说明。",
  };
  const node = createNode(type, position.x, position.y, labels[type]);
  selection = { kind: "node", id: node.id };
  commit((next) => {
    next.nodes.push(node);
  }, "已添加节点");
}

function replaceGraph(nextGraph, message, sameMessage = "当前流程图与载入内容一致") {
  const normalized = clone(nextGraph);
  if (graphsEquivalent(graph, normalized)) {
    showToast(sameMessage);
    return false;
  }
  undoStack.push(clone(graph));
  trimHistory(undoStack);
  redoStack = [];
  graph = normalized;
  selection = null;
  persist();
  render();
  showToast(message);
  return true;
}

function verifyReload() {
  try {
    const reloaded = parseGraph(serializeGraph(graph));
    const edgesMatch = edgesEquivalent(graph, reloaded);
    const routesMatch = routesEquivalent(routes, routeAll(reloaded));
    if (edgesMatch && routesMatch) {
      showToast(`重载校验通过：${graph.edges.length} 条连线及路径完全等价`);
    } else {
      showToast("重载校验失败：连线或路径不一致");
    }
    return edgesMatch && routesMatch;
  } catch (error) {
    showToast(`重载校验失败：${error.message}`);
    return false;
  }
}

function exportGraphJson() {
  const filename = `${safeFilename(graph.title)}.json`;
  downloadText(filename, serializeGraph(graph), "application/json;charset=utf-8");
  showToast(`已导出 ${filename}`);
}

let exportFontCssPromise = null;

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function loadExportFontCss() {
  if (!exportFontCssPromise) {
    exportFontCssPromise = fetch(new URL("../assets/NotoSansSC-subset.woff2", import.meta.url))
      .then(async (response) => {
        if (!response.ok) throw new Error("font unavailable");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const base64 = bytesToBase64(bytes);
        return `@font-face{font-family:"Flowboard Sans";src:url(data:font/woff2;base64,${base64}) format("woff2");font-weight:400 800;font-style:normal}`;
      })
      .catch(() => "");
  }
  return exportFontCssPromise;
}

async function exportGraphSvg() {
  const filename = `${safeFilename(graph.title)}.svg`;
  installGraphStyles(svg);
  const fontCss = await loadExportFontCss();
  const documentText = buildSvgDocument(svg, graph.title, fontCss);
  downloadText(filename, documentText, "image/svg+xml;charset=utf-8");
  showToast(`已导出 ${filename}`);
}

svg.addEventListener("pointerdown", handlePointerDown);
svg.addEventListener("pointermove", handlePointerMove);
svg.addEventListener("pointerup", handlePointerUp);
svg.addEventListener("pointercancel", handlePointerCancel);

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
document.querySelector("#add-node-button").addEventListener("click", addNode);

document.querySelector("#delete-node-button").addEventListener("click", () => {
  if (selection?.kind === "node") deleteSelection();
});

document.querySelector("#delete-edge-button").addEventListener("click", () => {
  if (selection?.kind === "edge") deleteSelection();
});

graphTitleInput.addEventListener("change", () => {
  const title = graphTitleInput.value.trim() || "未命名流程图";
  commit((next) => {
    next.title = title;
  }, "流程图名称已更新");
});

nodeTextInput.addEventListener("change", () => {
  if (selection?.kind !== "node") return;
  const id = selection.id;
  commit((next) => {
    const node = findNode(next, id);
    if (node) node.text = nodeTextInput.value.trim();
  });
});

nodeTypeSelect.addEventListener("change", () => {
  if (selection?.kind !== "node") return;
  const id = selection.id;
  const type = nodeTypeSelect.value;
  const defaults = NODE_DEFAULTS[type];
  commit((next) => {
    const node = findNode(next, id);
    if (!node) return;
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    node.type = type;
    node.width = defaults.width;
    node.height = defaults.height;
    const position = clampToCanvas(
      centerX - node.width / 2,
      centerY - node.height / 2,
      node.width,
      node.height
    );
    node.x = Math.round(position.x);
    node.y = Math.round(position.y);
  }, "节点类型已更新");
});

function updateNodePosition(axis, input) {
  if (selection?.kind !== "node") return;
  const id = selection.id;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  commit((next) => {
    const node = findNode(next, id);
    if (!node) return;
    const position = clampToCanvas(
      axis === "x" ? value : node.x,
      axis === "y" ? value : node.y,
      node.width,
      node.height
    );
    node.x = Math.round(position.x);
    node.y = Math.round(position.y);
  });
}

nodeXInput.addEventListener("change", () => updateNodePosition("x", nodeXInput));
nodeYInput.addEventListener("change", () => updateNodePosition("y", nodeYInput));

edgeLabelInput.addEventListener("change", () => {
  if (selection?.kind !== "edge") return;
  const id = selection.id;
  commit((next) => {
    const edge = next.edges.find((item) => item.id === id);
    if (edge) edge.label = edgeLabelInput.value.trim();
  });
});

document.querySelector("#reset-button").addEventListener("click", () => {
  replaceGraph(SAMPLE_GRAPH, "已载入双分支与汇合示例");
});

document.querySelector("#verify-button").addEventListener("click", verifyReload);
document.querySelector("#export-json-button").addEventListener("click", exportGraphJson);
document.querySelector("#export-svg-button").addEventListener("click", exportGraphSvg);
document.querySelector("#import-button").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const imported = parseGraph(await file.text());
    const roundTrip = parseGraph(serializeGraph(imported));
    const match = edgesEquivalent(imported, roundTrip);
    replaceGraph(
      imported,
      match
        ? `已重新载入 ${file.name}：${imported.edges.length} 条连线等价`
        : "文件已载入，但连线校验失败",
      match ? `重新载入校验通过：${imported.edges.length} 条连线等价` : "连线校验失败"
    );
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    importFile.value = "";
  }
});

document.addEventListener("keydown", (event) => {
  const editable = event.target.closest?.("input, textarea, select");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    if (editable) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
    if (editable) return;
    event.preventDefault();
    redo();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (editable || !selection) return;
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (event.key === "Escape") {
    selection = null;
    render();
  }
});

installGraphStyles(svg);
render();
