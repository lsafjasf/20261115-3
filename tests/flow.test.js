import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SAMPLE_GRAPH,
  clone,
  edgesEquivalent,
  findNode,
  graphsEquivalent,
  parseGraph,
  removeNode,
  serializeGraph,
} from "../src/model.js";
import { routeAll, routeHitsNode, routesEquivalent } from "../src/router.js";

test("示例图实际包含两条分支、一个汇合节点和注释", () => {
  const nodes = SAMPLE_GRAPH.nodes;
  const decision = findNode(SAMPLE_GRAPH, "review");
  const merge = findNode(SAMPLE_GRAPH, "merge");
  assert.equal(decision.type, "decision");
  assert.equal(merge.type, "merge");

  const branchTargets = SAMPLE_GRAPH.edges
    .filter((edge) => edge.from === "review")
    .map((edge) => findNode(SAMPLE_GRAPH, edge.to));
  assert.equal(branchTargets.length, 2);
  assert.deepEqual(branchTargets.map((node) => node.id).sort(), ["branch-dept", "branch-fin"]);

  const mergeInputs = SAMPLE_GRAPH.edges.filter((edge) => edge.to === "merge");
  assert.equal(mergeInputs.length, 2);
  assert.deepEqual(mergeInputs.map((edge) => edge.from).sort(), ["branch-dept", "branch-fin"]);
  assert.equal(nodes.filter((node) => node.type === "comment").length, 2);
});

test("所有连线都绕开节点，并且路径为水平/垂直折线", () => {
  const routes = routeAll(SAMPLE_GRAPH);
  assert.equal(routes.size, SAMPLE_GRAPH.edges.length);
  for (const edge of SAMPLE_GRAPH.edges) {
    const route = routes.get(edge.id);
    assert.ok(route, `连线 ${edge.id} 应有路径`);
    for (const node of SAMPLE_GRAPH.nodes) {
      assert.equal(routeHitsNode(route, node), false, `连线 ${edge.id} 穿过了节点 ${node.id}`);
    }
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1];
      const current = route.points[index];
      assert.ok(
        Math.abs(previous.x - current.x) < 0.01 || Math.abs(previous.y - current.y) < 0.01,
        `连线 ${edge.id} 的第 ${index} 段不是正交线段`
      );
    }
  }
});

test("拖动节点后重新路由，仍不穿过任何节点", () => {
  const graph = clone(SAMPLE_GRAPH);
  const before = routeAll(graph);
  const branch = findNode(graph, "branch-dept");
  branch.x = 440;
  branch.y = 444;
  const after = routeAll(graph);
  assert.equal(after.size, graph.edges.length);
  assert.equal(routesEquivalent(before, after), false, "移动节点后路径应发生变化");
  for (const edge of graph.edges) {
    for (const node of graph.nodes) {
      assert.equal(routeHitsNode(after.get(edge.id), node), false, `重路由后 ${edge.id} 穿过 ${node.id}`);
    }
  }
});

test("删除节点会移除所有相连边，撤销快照完整恢复", () => {
  const original = clone(SAMPLE_GRAPH);
  const beforeRoutes = routeAll(original);
  const deleted = removeNode(original, "branch-dept");
  const remainingNodeIds = new Set(deleted.nodes.map((node) => node.id));
  assert.equal(remainingNodeIds.has("branch-dept"), false);
  assert.equal(deleted.edges.some((edge) => edge.id === "e-review-dept"), false);
  assert.equal(deleted.edges.some((edge) => edge.id === "e-dept-merge"), false);
  assert.equal(deleted.edges.some((edge) => edge.id === "e-review-fin"), true);
  assert.equal(deleted.nodes.length, original.nodes.length - 1);
  assert.equal(deleted.edges.length, original.edges.length - 2);

  const undoSnapshot = clone(SAMPLE_GRAPH);
  assert.equal(edgesEquivalent(undoSnapshot, original), true);
  assert.equal(routeHitsNode(beforeRoutes.get("e-dept-merge"), findNode(undoSnapshot, "merge")), false);
  assert.equal(routesEquivalent(beforeRoutes, routeAll(undoSnapshot)), true);
});

test("导出 JSON 后重新载入，节点与连线及路由完全等价", () => {
  const json = serializeGraph(SAMPLE_GRAPH);
  const reloaded = parseGraph(json);
  assert.deepEqual(reloaded, SAMPLE_GRAPH);
  assert.equal(edgesEquivalent(SAMPLE_GRAPH, reloaded), true);
  assert.equal(routesEquivalent(routeAll(SAMPLE_GRAPH), routeAll(reloaded)), true);
});

test("仓库内示例 JSON 与默认画布等价", () => {
  const example = parseGraph(readFileSync(new URL("../examples/approval-flow.json", import.meta.url), "utf8"));
  assert.equal(graphsEquivalent(example, SAMPLE_GRAPH), true);
  assert.equal(edgesEquivalent(example, SAMPLE_GRAPH), true);
  assert.equal(routesEquivalent(routeAll(example), routeAll(SAMPLE_GRAPH)), true);
});

test("非法连线端点会被 JSON 校验拒绝", () => {
  const invalid = clone(SAMPLE_GRAPH);
  invalid.edges[0].to = "missing-node";
  assert.throws(() => parseGraph(JSON.stringify(invalid)), /端点不存在/);
});
