import test from "node:test";
import assert from "node:assert/strict";
import { TerrainModel, sectionToSVG } from "../src/terrain.js";

test("terrain exposes an editable watertight triangulated mesh", () => {
  const model = new TerrainModel();
  const solid = model.buildSolid();

  assert.equal(model.vertexCount, 81);
  assert.equal(model.topTriangleCount, 128);
  assert.equal(solid.positions.length / 3, 117);
  assert.equal(solid.triangles.length / 3, 194);
  assert.deepEqual(
    solid.parts.map((part) => [part.name, part.count]),
    [
      ["TopSurface", 128],
      ["SideWalls", 64],
      ["Base", 2],
    ],
  );

  const section = model.buildSection(2.1);
  assert.ok(section.segmentCount > 0);
  assert.ok(section.loops.length > 0);
  assert.ok(section.loops.every((loop) => loop.closed));
  assert.ok(section.area > 0);
});

test("editing three vertices updates both SVG and OBJ exports", () => {
  const model = new TerrainModel();
  const beforeSection = model.buildSection(2.1);
  const beforeSvg = sectionToSVG(beforeSection, { width: 1600, height: 1200 });
  const beforeObj = model.exportOBJ();
  const edits = [
    [41, 2.42],
    [49, 1.55],
    [50, 5.2],
  ];

  for (const [index, height] of edits) {
    assert.equal(model.setHeight(index, height), true);
  }

  const afterSection = model.buildSection(2.1);
  const afterSvg = sectionToSVG(afterSection, { width: 1600, height: 1200 });
  const afterObj = model.exportOBJ();

  assert.equal(model.revision, 3);
  assert.equal(model.editedVertexCount(), 3);
  assert.notEqual(afterSvg, beforeSvg);
  assert.notEqual(afterObj, beforeObj);
  assert.match(afterSvg, /data-mesh-revision="3"/);
  assert.match(afterSvg, /data-cut-height="2.10"/);
  assert.match(afterSvg, /<path d="M /);
  assert.match(afterObj, /# Revision: 3/);
  assert.match(afterObj, /# Edited vertices: 3/);
  assert.match(afterObj, /g TopSurface/);
  assert.match(afterObj, /g SideWalls/);
  assert.match(afterObj, /g Base/);

  const beforeArea = beforeSection.area;
  const afterArea = afterSection.area;
  assert.notEqual(afterArea, beforeArea);
});

test("sections remain closed across arbitrary cut heights", () => {
  const model = new TerrainModel();
  for (const cut of [0.2, 0.8, 1.4, 2.1, 2.8, 3.5, 4.4, 5.0]) {
    const section = model.buildSection(cut);
    assert.ok(section.segmentCount >= 0);
    assert.ok(section.loops.every((loop) => loop.closed));
    assert.ok(section.loops.every((loop) => loop.points.length >= 3));
    const svg = sectionToSVG(section);
    assert.match(svg, /<svg/);
    assert.match(svg, /data-cut-height=/);
  }
});

test("OBJ uses one-based faces and finite coordinates", () => {
  const model = new TerrainModel();
  const obj = model.exportOBJ();
  const faces = obj.split("\n").filter((line) => line.startsWith("f "));
  const vertices = obj.split("\n").filter((line) => line.startsWith("v "));

  assert.equal(vertices.length, 117);
  assert.equal(faces.length, 194);
  for (const face of faces) {
    const indices = face.slice(2).split(" ").map(Number);
    assert.equal(indices.length, 3);
    assert.ok(indices.every((index) => index >= 1 && index <= vertices.length));
  }
  assert.doesNotMatch(obj, /NaN|Infinity/);
});
