import {
  ASSET_KINDS,
  ASSET_KEYS,
  DEFAULTS,
  EDGE_KEYS,
  LIMITS,
  NODE_KEYS,
  NODE_TYPES,
  PROJECT_KEYS,
  ROOT_KEYS,
  SCHEMA_VERSION,
  SETTINGS_KEYS,
  THEMES
} from "./schema.js";

const SUPPORTED_VERSIONS = Object.freeze([SCHEMA_VERSION]);
const textEncoder = new TextEncoder();
const identifierPattern = /^[A-Za-z_$][\w$]*$/;

function describeType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function describeActual(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    const serialized = JSON.stringify(value);
    return serialized.length > 80 ? `${serialized.slice(0, 77)}...` : serialized;
  }
  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }
  return describeType(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function childPath(path, key) {
  return identifierPattern.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function indexedPath(path, index) {
  return `${path}[${index}]`;
}

function sourceBytes(text) {
  return textEncoder.encode(text).byteLength;
}

function createCollector() {
  const errors = [];
  const warnings = [];
  const unknownFields = [];

  return {
    errors,
    warnings,
    unknownFields,
    documentVersion: null,
    error(issue) {
      errors.push({ severity: "error", ...issue });
    },
    warn(issue) {
      warnings.push({ severity: "warning", ...issue });
    },
    unknown(path, key, value) {
      unknownFields.push({ path: childPath(path, key), value });
      warnings.push({
        severity: "warning",
        layer: "shape",
        code: "UNKNOWN_FIELD_PRESERVED",
        path: childPath(path, key),
        message: "检测到 schema 未定义字段，已保留在 unknownFields 中。"
      });
    }
  };
}

function parseSource(text, collector) {
  if (typeof text !== "string") {
    collector.error({
      layer: "input",
      code: "INPUT_NOT_TEXT",
      path: "$",
      expected: "string",
      actual: describeType(text),
      message: "导入内容必须是 JSON 文本。"
    });
    return { fatal: true, data: null, bytes: 0 };
  }

  if (text.length > LIMITS.sourceBytes) {
    collector.error({
      layer: "input",
      code: "SOURCE_TOO_LARGE",
      path: "$",
      expected: `<= ${LIMITS.sourceBytes} bytes`,
      actual: `>= ${text.length} bytes`,
      message: "文件过大，已在编码和解析前停止导入。"
    });
    return { fatal: true, data: null, bytes: text.length };
  }

  const bytes = sourceBytes(text);
  if (bytes > LIMITS.sourceBytes) {
    collector.error({
      layer: "input",
      code: "SOURCE_TOO_LARGE",
      path: "$",
      expected: `<= ${LIMITS.sourceBytes} bytes`,
      actual: `${bytes} bytes`,
      message: "文件过大，已在解析前停止导入。"
    });
    return { fatal: true, data: null, bytes };
  }

  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (withoutBom.trim() === "") {
    collector.error({
      layer: "parse",
      code: "EMPTY_DOCUMENT",
      path: "$",
      expected: "JSON object",
      actual: "empty text",
      message: "文件内容为空。"
    });
    return { fatal: true, data: null, bytes };
  }

  try {
    return { fatal: false, data: JSON.parse(withoutBom), bytes };
  } catch (parseError) {
    const location = parseErrorLocation(parseError, withoutBom);
    collector.error({
      layer: "parse",
      code: "INVALID_JSON",
      path: "$",
      message: `JSON 语法错误：${parseError.message}`,
      line: location.line,
      column: location.column,
      snippet: location.snippet,
      hint: "请检查该行附近的逗号、引号或括号。"
    });
    return { fatal: true, data: null, bytes };
  }
}

function parseErrorLocation(parseError, text) {
  const positionMatch = /position\s+(\d+)/i.exec(parseError.message);
  const lineColumnMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(
    parseError.message
  );

  let line = Number(lineColumnMatch?.[1] ?? 1);
  let column = Number(lineColumnMatch?.[2] ?? 1);
  if (!lineColumnMatch && positionMatch) {
    const offset = Math.min(Number(positionMatch[1]), text.length);
    const before = text.slice(0, offset);
    line = before.split("\n").length;
    column = offset - before.lastIndexOf("\n");
  }

  const sourceLine = text.split("\n")[line - 1] ?? "";
  const clippedStart = Math.max(0, column - 40);
  const clippedLine = sourceLine.slice(clippedStart, clippedStart + 100);
  const caretOffset = Math.max(0, column - 1 - clippedStart);
  return {
    line,
    column,
    snippet: `${clippedLine}\n${" ".repeat(caretOffset)}^`
  };
}

export function importProjectText(text, options = {}) {
  const collector = createCollector();
  let parsed;
  try {
    parsed = parseSource(text, collector);
    if (parsed.fatal) {
      return buildResult(collector, null, parsed.bytes, options);
    }
    const project = validateDocument(parsed.data, collector);
    return buildResult(collector, project, parsed.bytes, options);
  } catch (unexpectedError) {
    collector.error({
      layer: "internal",
      code: "IMPORT_FAILED",
      path: "$",
      message: "导入过程中发生未预期错误，现有工程未受影响。",
      hint: "请重试；若问题持续，请提交该 JSON 文件。"
    });
    return buildResult(
      collector,
      null,
      parsed?.bytes ?? 0,
      options,
      unexpectedError
    );
  }
}

export function importProjectValue(value, options = {}) {
  const collector = createCollector();
  try {
    const project = validateDocument(value, collector);
    return buildResult(collector, project, 0, options);
  } catch (unexpectedError) {
    collector.error({
      layer: "internal",
      code: "IMPORT_FAILED",
      path: "$",
      message: "导入过程中发生未预期错误，现有工程未受影响。"
    });
    return buildResult(collector, null, 0, options, unexpectedError);
  }
}

function buildResult(collector, candidate, bytes, options, internalError) {
  const ok = collector.errors.length === 0;
  const counts = candidate
    ? {
        nodes: candidate.nodes.length,
        edges: candidate.edges.length,
        assets: candidate.assets.length
      }
    : null;

  return {
    ok,
    project: ok ? candidate : null,
    errors: collector.errors,
    warnings: collector.warnings,
    unknownFields: collector.unknownFields,
    stats: {
      bytes,
      schemaVersion: collector.documentVersion,
      supportedVersions: [...SUPPORTED_VERSIONS],
      counts
    },
    ...(internalError && options.includeDebugError
      ? { debugError: String(internalError) }
      : {})
  };
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function captureUnknownFields(record, allowedKeys, path, collector) {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      collector.unknown(path, key, record[key]);
    }
  }
}

function readString(record, key, path, configuration, collector) {
  const fieldPath = childPath(path, key);
  const fallback = configuration.fallback ?? "";
  if (!hasOwn(record, key) || record[key] === undefined) {
    if (configuration.required) {
      collector.error({
        layer: "fields",
        code: "MISSING_FIELD",
        path: fieldPath,
        expected: "non-empty string",
        actual: "undefined",
        message: `缺少必填字段 ${key}。`
      });
    }
    return fallback;
  }

  const value = record[key];
  if (typeof value !== "string") {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: fieldPath,
      expected: "string",
      actual: `${describeType(value)} (${describeActual(value)})`,
      message: `${key} 必须是字符串。`
    });
    return fallback;
  }

  if (configuration.required && value.trim() === "") {
    collector.error({
      layer: "fields",
      code: "EMPTY_REQUIRED_VALUE",
      path: fieldPath,
      expected: "non-empty string",
      actual: '""',
      message: `${key} 不能为空。`
    });
    return fallback;
  }

  if (configuration.maxLength && value.length > configuration.maxLength) {
    collector.error({
      layer: "fields",
      code: "STRING_TOO_LONG",
      path: fieldPath,
      expected: `<= ${configuration.maxLength} characters`,
      actual: `${value.length} characters`,
      message: `${key} 超过长度上限，已截断为安全值。`
    });
    return value.slice(0, configuration.maxLength);
  }

  return value;
}

function readNumber(record, key, path, configuration, collector) {
  const fieldPath = childPath(path, key);
  const fallback = configuration.fallback ?? 0;
  if (!hasOwn(record, key) || record[key] === undefined) {
    if (configuration.required) {
      collector.error({
        layer: "fields",
        code: "MISSING_FIELD",
        path: fieldPath,
        expected: "number",
        actual: "undefined",
        message: `缺少必填字段 ${key}。`
      });
    }
    return fallback;
  }

  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: fieldPath,
      expected: "finite number",
      actual: `${describeType(value)} (${describeActual(value)})`,
      message: `${key} 必须是有限数字。`
    });
    return fallback;
  }

  if (configuration.integer && !Number.isInteger(value)) {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: fieldPath,
      expected: "integer",
      actual: String(value),
      message: `${key} 必须是整数。`
    });
    return fallback;
  }

  if (
    (configuration.min !== undefined && value < configuration.min) ||
    (configuration.max !== undefined && value > configuration.max)
  ) {
    const expected = `${configuration.min ?? "-∞"}..${
      configuration.max ?? "∞"
    }`;
    collector.error({
      layer: "constraints",
      code: "NUMBER_OUT_OF_RANGE",
      path: fieldPath,
      expected,
      actual: String(value),
      message: `${key} 超出允许范围，已使用安全默认值。`
    });
    return fallback;
  }

  return value;
}

function readBoolean(record, key, path, fallback, collector) {
  if (!hasOwn(record, key) || record[key] === undefined) {
    return fallback;
  }
  const value = record[key];
  if (typeof value !== "boolean") {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: childPath(path, key),
      expected: "boolean",
      actual: `${describeType(value)} (${describeActual(value)})`,
      message: `${key} 必须是布尔值。`
    });
    return fallback;
  }
  return value;
}

function readEnum(record, key, path, allowedValues, fallback, collector) {
  const fieldPath = childPath(path, key);
  if (!hasOwn(record, key) || record[key] === undefined) {
    return fallback;
  }
  const value = record[key];
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    collector.error({
      layer: "fields",
      code: "INVALID_ENUM_VALUE",
      path: fieldPath,
      expected: allowedValues.join(" | "),
      actual: `${describeType(value)} (${describeActual(value)})`,
      message: `${key} 不是受支持的值，已使用安全默认值。`
    });
    return fallback;
  }
  return value;
}

function readRecord(record, key, path, fallback, collector) {
  const fieldPath = childPath(path, key);
  if (!hasOwn(record, key) || record[key] === undefined) {
    return fallback;
  }
  if (!isRecord(record[key])) {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: fieldPath,
      expected: "object",
      actual: `${describeType(record[key])} (${describeActual(record[key])})`,
      message: `${key} 必须是对象。`
    });
    return fallback;
  }
  return record[key];
}

function readTimestamp(record, key, path, collector) {
  const fieldPath = childPath(path, key);
  if (!hasOwn(record, key) || record[key] === undefined) {
    return null;
  }
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: fieldPath,
      expected: "ISO 8601 string",
      actual: `${describeType(value)} (${describeActual(value)})`,
      message: `${key} 必须是 ISO 8601 时间字符串。`
    });
    return null;
  }
  if (Number.isNaN(Date.parse(value))) {
    collector.error({
      layer: "fields",
      code: "INVALID_TIMESTAMP",
      path: fieldPath,
      expected: "valid ISO 8601 string",
      actual: describeActual(value),
      message: `${key} 不是有效时间。`
    });
    return null;
  }
  return value;
}

function readArray(record, key, path, configuration, collector) {
  const fieldPath = childPath(path, key);
  if (!hasOwn(record, key) || record[key] === undefined) {
    if (configuration.required) {
      collector.error({
        layer: "fields",
        code: "MISSING_FIELD",
        path: fieldPath,
        expected: "array",
        actual: "undefined",
        message: `缺少必填数组 ${key}。`
      });
    }
    return [];
  }
  const value = record[key];
  if (!Array.isArray(value)) {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: fieldPath,
      expected: "array",
      actual: `${describeType(value)} (${describeActual(value)})`,
      message: `${key} 必须是数组。`
    });
    return [];
  }
  if (value.length > configuration.maxItems) {
    collector.error({
      layer: "constraints",
      code: "ARRAY_LIMIT_EXCEEDED",
      path: fieldPath,
      expected: `<= ${configuration.maxItems} items`,
      actual: `${value.length} items`,
      message: `${key} 数量超过上限；为避免卡顿，本次未逐项处理。`,
      hint: "请拆分工程或先减少该数组。"
    });
    return [];
  }
  return value;
}

function validateDocument(data, collector) {
  if (!isRecord(data)) {
    collector.error({
      layer: "shape",
      code: "ROOT_NOT_OBJECT",
      path: "$",
      expected: "object",
      actual: `${describeType(data)} (${describeActual(data)})`,
      message: "JSON 根节点必须是对象。"
    });
    return null;
  }

  captureUnknownFields(data, ROOT_KEYS, "$", collector);
  const versionPath = "$.schemaVersion";
  if (!hasOwn(data, "schemaVersion")) {
    collector.error({
      layer: "version",
      code: "MISSING_SCHEMA_VERSION",
      path: versionPath,
      expected: `integer ${SCHEMA_VERSION}`,
      actual: "undefined",
      message: "缺少 schemaVersion，无法确认文件版本。"
    });
    return null;
  }

  if (typeof data.schemaVersion !== "number" || !Number.isInteger(data.schemaVersion)) {
    collector.error({
      layer: "version",
      code: "INVALID_SCHEMA_VERSION",
      path: versionPath,
      expected: "integer",
      actual: `${describeType(data.schemaVersion)} (${describeActual(
        data.schemaVersion
      )})`,
      message: "schemaVersion 必须是整数。"
    });
    return null;
  }

  if (!SUPPORTED_VERSIONS.includes(data.schemaVersion)) {
    collector.documentVersion = data.schemaVersion;
    collector.error({
      layer: "version",
      code: "INCOMPATIBLE_SCHEMA_VERSION",
      path: versionPath,
      expected: SUPPORTED_VERSIONS.join(" | "),
      actual: String(data.schemaVersion),
      message: `版本 ${data.schemaVersion} 与当前导入器不兼容。`,
      hint: `当前支持版本：${SUPPORTED_VERSIONS.join(", ")}。`
    });
    return null;
  }
  collector.documentVersion = data.schemaVersion;

  if (!hasOwn(data, "project")) {
    collector.error({
      layer: "shape",
      code: "MISSING_FIELD",
      path: "$.project",
      expected: "object",
      actual: "undefined",
      message: "缺少 project 对象。"
    });
    return null;
  }

  if (!isRecord(data.project)) {
    collector.error({
      layer: "shape",
      code: "TYPE_MISMATCH",
      path: "$.project",
      expected: "object",
      actual: `${describeType(data.project)} (${describeActual(data.project)})`,
      message: "project 必须是对象。"
    });
    return null;
  }

  return validateProject(data.project, collector);
}

function validateProject(rawProject, collector) {
  const path = "$.project";
  captureUnknownFields(rawProject, PROJECT_KEYS, path, collector);

  const id = readString(
    rawProject,
    "id",
    path,
    { required: true, maxLength: LIMITS.identifier, fallback: "imported-project" },
    collector
  );
  const name = readString(
    rawProject,
    "name",
    path,
    {
      required: true,
      maxLength: LIMITS.projectName,
      fallback: DEFAULTS.projectName
    },
    collector
  );
  const description = readString(
    rawProject,
    "description",
    path,
    { maxLength: LIMITS.projectDescription, fallback: DEFAULTS.description },
    collector
  );
  const createdAt = readTimestamp(rawProject, "createdAt", path, collector);
  const updatedAt = readTimestamp(rawProject, "updatedAt", path, collector);

  const rawSettings = readRecord(rawProject, "settings", path, {}, collector);
  const settings = validateSettings(rawSettings, childPath(path, "settings"), collector);
  const rawNodes = readArray(
    rawProject,
    "nodes",
    path,
    { required: true, maxItems: LIMITS.nodes },
    collector
  );
  const rawEdges = readArray(
    rawProject,
    "edges",
    path,
    { required: true, maxItems: LIMITS.edges },
    collector
  );
  const rawAssets = readArray(
    rawProject,
    "assets",
    path,
    { required: false, maxItems: LIMITS.assets },
    collector
  );

  const nodes = validateNodes(rawNodes, collector);
  const edges = validateEdges(rawEdges, nodes, collector);
  const assets = validateAssets(rawAssets, collector);

  return {
    id,
    name,
    description,
    createdAt,
    updatedAt,
    settings,
    nodes,
    edges,
    assets
  };
}

function validateSettings(rawSettings, path, collector) {
  captureUnknownFields(rawSettings, SETTINGS_KEYS, path, collector);
  return {
    theme: readEnum(
      rawSettings,
      "theme",
      path,
      THEMES,
      DEFAULTS.theme,
      collector
    ),
    autosave: readBoolean(
      rawSettings,
      "autosave",
      path,
      DEFAULTS.autosave,
      collector
    ),
    gridSize: readNumber(
      rawSettings,
      "gridSize",
      path,
      { min: 5, max: 200, integer: true, fallback: DEFAULTS.gridSize },
      collector
    ),
    snapToGrid: readBoolean(
      rawSettings,
      "snapToGrid",
      path,
      DEFAULTS.snapToGrid,
      collector
    ),
    locale: readString(
      rawSettings,
      "locale",
      path,
      { maxLength: LIMITS.locale, fallback: DEFAULTS.locale },
      collector
    )
  };
}

function validateNodes(rawNodes, collector) {
  const nodes = [];
  const seenIds = new Set();
  const collectionPath = "$.project.nodes";

  rawNodes.forEach((rawNode, index) => {
    const path = indexedPath(collectionPath, index);
    if (!isRecord(rawNode)) {
      collector.error({
        layer: "shape",
        code: "ARRAY_ITEM_NOT_OBJECT",
        path,
        expected: "object",
        actual: `${describeType(rawNode)} (${describeActual(rawNode)})`,
        message: "节点必须是对象，该项已跳过。"
      });
      return;
    }

    captureUnknownFields(rawNode, NODE_KEYS, path, collector);
    const fallbackId = `node-${index + 1}`;
    let id = readString(
      rawNode,
      "id",
      path,
      { required: true, maxLength: LIMITS.identifier, fallback: fallbackId },
      collector
    );
    if (seenIds.has(id)) {
      collector.error({
        layer: "constraints",
        code: "DUPLICATE_ID",
        path: childPath(path, "id"),
        expected: "unique node id",
        actual: describeActual(id),
        message: `节点 ID "${id}" 重复。`
      });
      id = uniqueFallbackId(id, seenIds, index);
    }
    seenIds.add(id);

    const node = {
      id,
      type: readEnum(
        rawNode,
        "type",
        path,
        NODE_TYPES,
        DEFAULTS.nodeType,
        collector
      ),
      title: readString(
        rawNode,
        "title",
        path,
        {
          required: true,
          maxLength: LIMITS.nodeTitle,
          fallback: DEFAULTS.nodeTitle
        },
        collector
      ),
      x: readNumber(
        rawNode,
        "x",
        path,
        { min: -LIMITS.coordinate, max: LIMITS.coordinate, fallback: 0 },
        collector
      ),
      y: readNumber(
        rawNode,
        "y",
        path,
        { min: -LIMITS.coordinate, max: LIMITS.coordinate, fallback: 0 },
        collector
      ),
      width: readNumber(
        rawNode,
        "width",
        path,
        { min: 1, max: LIMITS.dimension, fallback: DEFAULTS.nodeWidth },
        collector
      ),
      height: readNumber(
        rawNode,
        "height",
        path,
        { min: 1, max: LIMITS.dimension, fallback: DEFAULTS.nodeHeight },
        collector
      ),
      tags: validateTags(rawNode, path, collector),
      data: readRecord(rawNode, "data", path, {}, collector)
    };
    nodes.push(node);
  });

  return nodes;
}

function uniqueFallbackId(id, seenIds, index) {
  let candidate = `${id}__duplicate_${index + 1}`;
  let suffix = 1;
  while (seenIds.has(candidate)) {
    candidate = `${id}__duplicate_${index + 1}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function validateTags(rawNode, path, collector) {
  const tagsPath = childPath(path, "tags");
  if (!hasOwn(rawNode, "tags") || rawNode.tags === undefined) {
    return [];
  }
  if (!Array.isArray(rawNode.tags)) {
    collector.error({
      layer: "fields",
      code: "TYPE_MISMATCH",
      path: tagsPath,
      expected: "array of strings",
      actual: `${describeType(rawNode.tags)} (${describeActual(rawNode.tags)})`,
      message: "tags 必须是字符串数组。"
    });
    return [];
  }
  if (rawNode.tags.length > LIMITS.tagsPerNode) {
    collector.error({
      layer: "constraints",
      code: "ARRAY_LIMIT_EXCEEDED",
      path: tagsPath,
      expected: `<= ${LIMITS.tagsPerNode} items`,
      actual: `${rawNode.tags.length} items`,
      message: "节点标签数量超过上限。"
    });
    return [];
  }

  const tags = [];
  rawNode.tags.forEach((tag, tagIndex) => {
    const tagPath = indexedPath(tagsPath, tagIndex);
    if (typeof tag !== "string") {
      collector.error({
        layer: "fields",
        code: "TYPE_MISMATCH",
        path: tagPath,
        expected: "string",
        actual: `${describeType(tag)} (${describeActual(tag)})`,
        message: "标签必须是字符串。"
      });
      return;
    }
    if (tag.length > LIMITS.tagLength) {
      collector.error({
        layer: "constraints",
        code: "STRING_TOO_LONG",
        path: tagPath,
        expected: `<= ${LIMITS.tagLength} characters`,
        actual: `${tag.length} characters`,
        message: "标签过长，已截断为安全值。"
      });
      tags.push(tag.slice(0, LIMITS.tagLength));
      return;
    }
    tags.push(tag);
  });
  return tags;
}

function validateEdges(rawEdges, nodes, collector) {
  const edges = [];
  const seenIds = new Set();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const collectionPath = "$.project.edges";

  rawEdges.forEach((rawEdge, index) => {
    const path = indexedPath(collectionPath, index);
    if (!isRecord(rawEdge)) {
      collector.error({
        layer: "shape",
        code: "ARRAY_ITEM_NOT_OBJECT",
        path,
        expected: "object",
        actual: `${describeType(rawEdge)} (${describeActual(rawEdge)})`,
        message: "连线必须是对象，该项已跳过。"
      });
      return;
    }

    captureUnknownFields(rawEdge, EDGE_KEYS, path, collector);
    const fallbackId = `edge-${index + 1}`;
    let id = readString(
      rawEdge,
      "id",
      path,
      { required: true, maxLength: LIMITS.identifier, fallback: fallbackId },
      collector
    );
    if (seenIds.has(id)) {
      collector.error({
        layer: "constraints",
        code: "DUPLICATE_ID",
        path: childPath(path, "id"),
        expected: "unique edge id",
        actual: describeActual(id),
        message: `连线 ID "${id}" 重复。`
      });
      id = uniqueFallbackId(id, seenIds, index);
    }
    seenIds.add(id);

    const from = readString(
      rawEdge,
      "from",
      path,
      { required: true, maxLength: LIMITS.identifier, fallback: "" },
      collector
    );
    const to = readString(
      rawEdge,
      "to",
      path,
      { required: true, maxLength: LIMITS.identifier, fallback: "" },
      collector
    );
    validateEdgeReference(from, nodeIds, childPath(path, "from"), collector);
    validateEdgeReference(to, nodeIds, childPath(path, "to"), collector);

    edges.push({
      id,
      from,
      to,
      label: readString(
        rawEdge,
        "label",
        path,
        { maxLength: LIMITS.edgeLabel, fallback: DEFAULTS.edgeLabel },
        collector
      ),
      data: readRecord(rawEdge, "data", path, {}, collector)
    });
  });

  return edges;
}

function validateEdgeReference(reference, nodeIds, path, collector) {
  if (reference !== "" && !nodeIds.has(reference)) {
    collector.error({
      layer: "constraints",
      code: "EDGE_REFERENCE_NOT_FOUND",
      path,
      expected: "existing node id",
      actual: describeActual(reference),
      message: `连线引用了不存在的节点 "${reference}"。`
    });
  }
}

function validateAssets(rawAssets, collector) {
  const assets = [];
  const seenIds = new Set();
  const collectionPath = "$.project.assets";

  rawAssets.forEach((rawAsset, index) => {
    const path = indexedPath(collectionPath, index);
    if (!isRecord(rawAsset)) {
      collector.error({
        layer: "shape",
        code: "ARRAY_ITEM_NOT_OBJECT",
        path,
        expected: "object",
        actual: `${describeType(rawAsset)} (${describeActual(rawAsset)})`,
        message: "资源必须是对象，该项已跳过。"
      });
      return;
    }

    captureUnknownFields(rawAsset, ASSET_KEYS, path, collector);
    const fallbackId = `asset-${index + 1}`;
    let id = readString(
      rawAsset,
      "id",
      path,
      { required: true, maxLength: LIMITS.identifier, fallback: fallbackId },
      collector
    );
    if (seenIds.has(id)) {
      collector.error({
        layer: "constraints",
        code: "DUPLICATE_ID",
        path: childPath(path, "id"),
        expected: "unique asset id",
        actual: describeActual(id),
        message: `资源 ID "${id}" 重复。`
      });
      id = uniqueFallbackId(id, seenIds, index);
    }
    seenIds.add(id);

    assets.push({
      id,
      name: readString(
        rawAsset,
        "name",
        path,
        { maxLength: LIMITS.projectName, fallback: "未命名资源" },
        collector
      ),
      kind: readEnum(
        rawAsset,
        "kind",
        path,
        ASSET_KINDS,
        DEFAULTS.assetKind,
        collector
      ),
      path: readString(
        rawAsset,
        "path",
        path,
        { required: true, maxLength: LIMITS.pathLength, fallback: "" },
        collector
      ),
      sizeBytes: readNumber(
        rawAsset,
        "sizeBytes",
        path,
        { min: 0, max: LIMITS.assetBytes, integer: true, fallback: 0 },
        collector
      ),
      metadata: readRecord(rawAsset, "metadata", path, {}, collector)
    });
  });

  return assets;
}
