import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  importProjectText,
  importProjectValue
} from "../src/project-importer.js";
import {
  exportProjectDocument,
  stringifyProjectDocument
} from "../src/project-export.js";
import {
  DEFAULTS,
  LIMITS,
  SCHEMA_VERSION
} from "../src/schema.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = join(testDirectory, "..", "fixtures");

async function loadFixture(name) {
  const text = await readFile(join(fixturesDirectory, name), "utf8");
  return { text, source: JSON.parse(text), result: importProjectText(text) };
}

test("有效工程完整恢复，未知字段进入 unknownFields", async () => {
  const { source, result } = await loadFixture("valid-project.json");
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);

  const expectedProject = structuredClone(source.project);
  delete expectedProject.futureProjectField;
  delete expectedProject.nodes[0].futureNodeField;
  delete expectedProject.assets[0].futureAssetField;
  assert.deepEqual(result.project, expectedProject);

  assert.equal(result.warnings.length, 4);
  assert.deepEqual(
    result.unknownFields.map((entry) => entry.path),
    [
      "$.futureRootField",
      "$.project.futureProjectField",
      "$.project.nodes[0].futureNodeField",
      "$.project.assets[0].futureAssetField"
    ]
  );
  assert.equal(result.project.futureProjectField, undefined);
  assert.deepEqual(result.unknownFields[0].value, {
    ownerTeam: "design-systems"
  });
  assert.deepEqual(result.stats.counts, {
    nodes: 3,
    edges: 2,
    assets: 1
  });
  assert.equal(result.stats.schemaVersion, SCHEMA_VERSION);

  const exported = exportProjectDocument(
    result.project,
    result.unknownFields
  );
  assert.deepEqual(exported, source);
  assert.match(
    stringifyProjectDocument(result.project, result.unknownFields),
    /futureRootField/
  );
});

test("缺少必填字段时返回可定位错误且不抛异常", async () => {
  const { result } = await loadFixture("missing-fields.json");
  assert.equal(result.ok, false);
  assert.equal(result.project, null);
  assert.ok(
    result.errors.some(
      (issue) =>
        issue.code === "MISSING_FIELD" && issue.path === "$.project.name"
    )
  );
  assert.ok(
    result.errors.some(
      (issue) =>
        issue.code === "MISSING_FIELD" &&
        issue.path === "$.project.nodes[0].title"
    )
  );
  assert.ok(
    result.errors.some(
      (issue) =>
        issue.code === "MISSING_FIELD" &&
        issue.path === "$.project.nodes[1].id"
    )
  );
});

test("类型错误会聚合到具体字段路径", async () => {
  const { result } = await loadFixture("wrong-types.json");
  assert.equal(result.ok, false);
  assert.equal(result.project, null);
  const typeErrorPaths = result.errors
    .filter((issue) => issue.code === "TYPE_MISMATCH")
    .map((issue) => issue.path);
  for (const expectedPath of [
    "$.project.id",
    "$.project.name",
    "$.project.settings.autosave",
    "$.project.nodes[0].title",
    "$.project.nodes[0].x",
    "$.project.nodes[0].tags",
    "$.project.nodes[0].data",
    "$.project.edges[0].id",
    "$.project.edges[0].to"
  ]) {
    assert.ok(typeErrorPaths.includes(expectedPath), expectedPath);
  }
  assert.ok(
    result.errors.some(
      (issue) => issue.code === "INVALID_TIMESTAMP" &&
        issue.path === "$.project.createdAt"
    )
  );
});

test("超大数组在逐项处理前被拒绝", async () => {
  const { result } = await loadFixture("oversized-array.json");
  assert.equal(result.ok, false);
  assert.equal(result.project, null);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, "ARRAY_LIMIT_EXCEEDED");
  assert.equal(result.errors[0].path, "$.project.nodes");
  assert.match(result.errors[0].actual, new RegExp(String(LIMITS.nodes + 1)));
});

test("不兼容版本给出支持范围并停止深层解析", async () => {
  const { result } = await loadFixture("incompatible-version.json");
  assert.equal(result.ok, false);
  assert.equal(result.project, null);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, "INCOMPATIBLE_SCHEMA_VERSION");
  assert.equal(result.errors[0].path, "$.schemaVersion");
  assert.equal(
    result.errors[0].expected,
    String(SCHEMA_VERSION)
  );
  assert.equal(result.stats.schemaVersion, 2);
});

test("省略可选字段时使用安全默认值并正常导入", () => {
  const result = importProjectValue({
    schemaVersion: 1,
    project: {
      id: "minimal",
      name: "最小工程",
      nodes: [{ id: "only-node", title: "唯一节点" }],
      edges: []
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.project, {
    id: "minimal",
    name: "最小工程",
    description: DEFAULTS.description,
    createdAt: null,
    updatedAt: null,
    settings: {
      theme: DEFAULTS.theme,
      autosave: DEFAULTS.autosave,
      gridSize: DEFAULTS.gridSize,
      snapToGrid: DEFAULTS.snapToGrid,
      locale: DEFAULTS.locale
    },
    nodes: [
      {
        id: "only-node",
        type: DEFAULTS.nodeType,
        title: "唯一节点",
        x: 0,
        y: 0,
        width: DEFAULTS.nodeWidth,
        height: DEFAULTS.nodeHeight,
        tags: [],
        data: {}
      }
    ],
    edges: [],
    assets: []
  });
});

test("JSON 语法错误包含行列和上下文，导入器不抛异常", () => {
  const result = importProjectText(
    '{\n  "schemaVersion": 1,\n  "project": {\n    "id": "broken",\n  }\n}'
  );
  assert.equal(result.ok, false);
  assert.equal(result.project, null);
  assert.equal(result.errors[0].code, "INVALID_JSON");
  assert.equal(result.errors[0].line, 5);
  assert.equal(result.errors[0].column, 3);
  assert.match(result.errors[0].snippet, /\^/);
});

test("根节点形状错误与缺失版本都返回结构化错误", () => {
  const arrayResult = importProjectText("[]");
  assert.equal(arrayResult.ok, false);
  assert.equal(arrayResult.errors[0].code, "ROOT_NOT_OBJECT");
  assert.equal(arrayResult.errors[0].path, "$");

  const versionResult = importProjectText('{"project": {}}');
  assert.equal(versionResult.ok, false);
  assert.equal(
    versionResult.errors[0].code,
    "MISSING_SCHEMA_VERSION"
  );
  assert.equal(versionResult.errors[0].path, "$.schemaVersion");
});

test("未知字段不会污染对象原型", () => {
  const text =
    '{"schemaVersion":1,"__proto__":{"polluted":true},"project":' +
    '{"id":"safe","name":"Safe","nodes":[],"edges":[]}}';
  const result = importProjectText(text);

  assert.equal(result.ok, true);
  assert.equal({}.polluted, undefined);
  assert.equal(result.project.polluted, undefined);
  assert.ok(
    result.unknownFields.some(
      (entry) =>
        entry.path === "$.__proto__" &&
        entry.value.polluted === true
    )
  );
});

test("含点、空格和引号的未知字段也能按原路径回导", () => {
  const source = JSON.parse(
    '{"schemaVersion":1,"project":{"id":"safe","name":"Safe",' +
      '"nodes":[{"id":"n1","title":"Node","future.key":{"a":1}}],' +
      '"edges":[],"custom field":"kept"}}'
  );
  const result = importProjectText(JSON.stringify(source));

  assert.equal(result.ok, true);
  assert.ok(
    result.unknownFields.some((entry) =>
      entry.path.includes('["future.key"]')
    )
  );
  const exported = exportProjectDocument(
    result.project,
    result.unknownFields
  );
  assert.equal(exported.project["custom field"], "kept");
  assert.deepEqual(exported.project.nodes[0]["future.key"], { a: 1 });
});

test("重复 ID 与悬空连线会被约束层拒绝", () => {
  const result = importProjectValue({
    schemaVersion: 1,
    project: {
      id: "constraints",
      name: "约束测试",
      nodes: [
        { id: "same", title: "A" },
        { id: "same", title: "B" }
      ],
      edges: [
        { id: "edge-1", from: "same", to: "missing-node" }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (issue) =>
        issue.code === "DUPLICATE_ID" &&
        issue.path === "$.project.nodes[1].id"
    )
  );
  assert.ok(
    result.errors.some(
      (issue) =>
        issue.code === "EDGE_REFERENCE_NOT_FOUND" &&
        issue.path === "$.project.edges[0].to"
    )
  );
});
