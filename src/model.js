export const CANVAS = { width: 1440, height: 920 };

export const PORT_OFFSETS = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

export const NODE_DEFAULTS = {
  start: { width: 168, height: 56 },
  end: { width: 168, height: 56 },
  process: { width: 196, height: 76 },
  decision: { width: 188, height: 104 },
  merge: { width: 184, height: 72 },
  comment: { width: 236, height: 118 },
};

export const SAMPLE_GRAPH = {
  version: 1,
  title: "审批流程 · 双分支与汇合",
  nodes: [
    { id: "start", type: "start", text: "提交申请", x: 626, y: 42, width: 168, height: 56 },
    { id: "review", type: "decision", text: "资料是否齐全？", x: 616, y: 150, width: 188, height: 104 },
    { id: "branch-dept", type: "process", text: "部门审批", x: 304, y: 342, width: 196, height: 76 },
    { id: "branch-fin", type: "process", text: "财务复核", x: 920, y: 342, width: 196, height: 76 },
    { id: "merge", type: "merge", text: "审批结果汇合", x: 618, y: 510, width: 184, height: 72 },
    { id: "done", type: "end", text: "归档完成", x: 626, y: 676, width: 168, height: 56 },
    {
      id: "note-branches",
      type: "comment",
      text: "两条分支并行处理：审批不通过时回到部门补正，通过后继续汇合。",
      x: 1110,
      y: 260,
      width: 236,
      height: 118,
    },
    {
      id: "note-merge",
      type: "comment",
      text: "汇合节点不判断结果，只表示两条路径在此重新进入主干。",
      x: 292,
      y: 548,
      width: 236,
      height: 118,
    },
  ],
  edges: [
    { id: "e-start-review", from: "start", to: "review", fromPort: "south", toPort: "north", label: "" },
    { id: "e-review-dept", from: "review", to: "branch-dept", fromPort: "west", toPort: "north", label: "驳回" },
    { id: "e-review-fin", from: "review", to: "branch-fin", fromPort: "east", toPort: "north", label: "通过" },
    { id: "e-dept-merge", from: "branch-dept", to: "merge", fromPort: "south", toPort: "west", label: "" },
    { id: "e-fin-merge", from: "branch-fin", to: "merge", fromPort: "south", toPort: "east", label: "" },
    { id: "e-merge-done", from: "merge", to: "done", fromPort: "south", toPort: "north", label: "" },
  ],
};

export function clone(value) {
  return structuredClone(value);
}

export function nodeBounds(node) {
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height,
  };
}

export function portPoint(node, port) {
  const [dx, dy] = PORT_OFFSETS[port] ?? PORT_OFFSETS.north;
  return {
    x: node.x + node.width / 2 + (dx * node.width) / 2,
    y: node.y + node.height / 2 + (dy * node.height) / 2,
  };
}

export function outwardPoint(node, port, distance = 22) {
  const point = portPoint(node, port);
  const [dx, dy] = PORT_OFFSETS[port] ?? PORT_OFFSETS.north;
  return { x: point.x + dx * distance, y: point.y + dy * distance };
}

export function nearestPort(node, point) {
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  const dx = (point.x - center.x) / Math.max(node.width / 2, 1);
  const dy = (point.y - center.y) / Math.max(node.height / 2, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

export function createNode(type, x, y, text = "新节点") {
  const defaults = NODE_DEFAULTS[type] ?? NODE_DEFAULTS.process;
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: `${type}-${suffix}`,
    type: type in NODE_DEFAULTS ? type : "process",
    text,
    x,
    y,
    width: defaults.width,
    height: defaults.height,
  };
}

export function createEdge(from, to, fromPort, toPort) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: `edge-${suffix}`,
    from,
    to,
    fromPort,
    toPort,
    label: "",
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function normalizeGraph(input) {
  assert(input && typeof input === "object", "JSON 根节点必须是对象");
  assert(Array.isArray(input.nodes) && Array.isArray(input.edges), "JSON 必须包含 nodes 与 edges 数组");

  const ids = new Set();
  const nodes = input.nodes.map((raw) => {
    assert(raw && typeof raw.id === "string", "节点缺少字符串 id");
    assert(!ids.has(raw.id), `节点 id 重复：${raw.id}`);
    ids.add(raw.id);
    const type = raw.type in NODE_DEFAULTS ? raw.type : "process";
    const defaults = NODE_DEFAULTS[type];
    const node = {
      id: raw.id,
      type,
      text: String(raw.text ?? ""),
      x: Number(raw.x),
      y: Number(raw.y),
      width: Number(raw.width ?? defaults.width),
      height: Number(raw.height ?? defaults.height),
    };
    assert(Number.isFinite(node.x) && Number.isFinite(node.y), `节点坐标无效：${raw.id}`);
    assert(node.width > 50 && node.height > 30, `节点尺寸无效：${raw.id}`);
    return node;
  });

  const edgeIds = new Set();
  const edges = input.edges.map((raw) => {
    assert(raw && typeof raw.id === "string", "连线缺少字符串 id");
    assert(!edgeIds.has(raw.id), `连线 id 重复：${raw.id}`);
    edgeIds.add(raw.id);
    assert(ids.has(raw.from) && ids.has(raw.to), `连线端点不存在：${raw.id}`);
    assert(PORT_OFFSETS[raw.fromPort] && PORT_OFFSETS[raw.toPort], `连线端口无效：${raw.id}`);
    return {
      id: raw.id,
      from: raw.from,
      to: raw.to,
      fromPort: raw.fromPort,
      toPort: raw.toPort,
      label: String(raw.label ?? ""),
    };
  });

  return {
    version: 1,
    title: String(input.title ?? "未命名流程图"),
    nodes,
    edges,
  };
}

export function serializeGraph(graph) {
  return JSON.stringify(normalizeGraph(graph), null, 2);
}

export function parseGraph(json) {
  let input;
  try {
    input = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  return normalizeGraph(input);
}

function sortedEdges(graph) {
  return graph.edges
    .map(({ id, from, to, fromPort, toPort, label }) => ({ id, from, to, fromPort, toPort, label }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function edgesEquivalent(a, b) {
  return JSON.stringify(sortedEdges(a)) === JSON.stringify(sortedEdges(b));
}

export function graphsEquivalent(a, b) {
  return JSON.stringify(normalizeGraph(a)) === JSON.stringify(normalizeGraph(b));
}

export function findNode(graph, id) {
  return graph.nodes.find((node) => node.id === id);
}

export function removeNode(graph, id) {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}
