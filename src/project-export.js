import { SCHEMA_VERSION } from "./schema.js";

const pathTokenPattern =
  /(?:\.([A-Za-z_$][\w$]*))|(?:\[(\d+)\])|(?:\[("(?:[^"\\]|\\.)*")\])/g;

function parseProjectPath(path) {
  if (typeof path !== "string" || !path.startsWith("$")) {
    throw new TypeError("未知字段路径必须以 $ 开头。");
  }
  if (path === "$") {
    return [];
  }

  const segments = [];
  let cursor = 1;
  pathTokenPattern.lastIndex = cursor;
  let match = pathTokenPattern.exec(path);
  while (match) {
    if (match.index !== cursor) {
      throw new TypeError(`无法解析未知字段路径：${path}`);
    }
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push(Number(match[2]));
    } else {
      segments.push(JSON.parse(match[3]));
    }
    cursor = pathTokenPattern.lastIndex;
    if (cursor >= path.length) {
      break;
    }
    match = pathTokenPattern.exec(path);
  }

  if (cursor !== path.length) {
    throw new TypeError(`无法解析未知字段路径：${path}`);
  }
  return segments;
}

function defineOwnProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function applyUnknownField(document, path, value) {
  const segments = parseProjectPath(path);
  if (segments.length === 0) {
    throw new TypeError("未知字段路径不能指向文档根节点。");
  }

  let parent = document;
  for (const segment of segments.slice(0, -1)) {
    const next = parent?.[segment];
    if (next === null || typeof next !== "object") {
      throw new TypeError(`未知字段路径不存在：${path}`);
    }
    parent = next;
  }
  defineOwnProperty(parent, segments.at(-1), value);
}

export function exportProjectDocument(project, unknownFields = []) {
  if (project === null || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("project 必须是对象。");
  }

  const document = {
    schemaVersion: SCHEMA_VERSION,
    project: structuredClone(project)
  };
  for (const entry of unknownFields) {
    applyUnknownField(document, entry.path, structuredClone(entry.value));
  }
  return document;
}

export function stringifyProjectDocument(project, unknownFields = []) {
  return `${JSON.stringify(exportProjectDocument(project, unknownFields), null, 2)}\n`;
}
