export const SCHEMA_VERSION = 1;

export const LIMITS = Object.freeze({
  sourceBytes: 8 * 1024 * 1024,
  nodes: 2000,
  edges: 10000,
  assets: 2000,
  tagsPerNode: 20,
  projectName: 200,
  projectDescription: 5000,
  nodeTitle: 240,
  edgeLabel: 240,
  locale: 32,
  tagLength: 40,
  identifier: 128,
  pathLength: 2048,
  coordinate: 1_000_000,
  dimension: 100_000,
  assetBytes: Number.MAX_SAFE_INTEGER
});

export const DEFAULTS = Object.freeze({
  projectName: "未命名工程",
  nodeTitle: "未命名节点",
  nodeType: "task",
  theme: "system",
  autosave: true,
  gridSize: 20,
  snapToGrid: true,
  locale: "zh-CN",
  description: "",
  nodeWidth: 160,
  nodeHeight: 96,
  edgeLabel: "",
  assetKind: "other"
});

export const THEMES = Object.freeze(["system", "light", "dark"]);
export const NODE_TYPES = Object.freeze(["task", "note", "milestone"]);
export const ASSET_KINDS = Object.freeze([
  "image",
  "document",
  "audio",
  "video",
  "other"
]);

export const ROOT_KEYS = Object.freeze(["schemaVersion", "project"]);
export const PROJECT_KEYS = Object.freeze([
  "id",
  "name",
  "description",
  "createdAt",
  "updatedAt",
  "settings",
  "nodes",
  "edges",
  "assets"
]);
export const SETTINGS_KEYS = Object.freeze([
  "theme",
  "autosave",
  "gridSize",
  "snapToGrid",
  "locale"
]);
export const NODE_KEYS = Object.freeze([
  "id",
  "type",
  "title",
  "x",
  "y",
  "width",
  "height",
  "tags",
  "data"
]);
export const EDGE_KEYS = Object.freeze([
  "id",
  "from",
  "to",
  "label",
  "data"
]);
export const ASSET_KEYS = Object.freeze([
  "id",
  "name",
  "kind",
  "path",
  "sizeBytes",
  "metadata"
]);
