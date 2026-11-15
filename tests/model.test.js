import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAYERS,
  FAULT,
  WORLD,
  assertLayerOrder,
  cloneLayers,
  createCut,
  layerBoundaries,
  sampleSection,
  surfaceElevation,
  toWorldY,
} from "../src/model.js";
import { buildSectionFigure } from "../src/section-figure.js";
import { buildSectionSVG } from "../src/export-svg.js";
import { sceneHeight } from "../src/render3d.js";

const cut = createCut(75, 0.3);

test("default section crosses F1 and preserves layer order", () => {
  const layers = cloneLayers();
  const section = sampleSection(layers, cut, 180);
  assert.equal(section.totalThicknessMeters, 495);
  assert.equal(section.faultThrowMeters, FAULT.throwMeters);
  assert.ok(section.faultDistanceKm > 0);
  assert.ok(section.faultDistanceKm < section.sectionLengthKm);
  assertLayerOrder(section.points);

  const shareTotal = section.layers.reduce((sum, layer) => sum + layer.sectionShare, 0);
  assert.ok(Math.abs(shareTotal - 1) < 0.002);
});

test("editing one layer thickness updates 3D height, 2D geometry, stats and SVG", () => {
  const beforeLayers = cloneLayers();
  const afterLayers = cloneLayers();
  const limestone = afterLayers.find((layer) => layer.id === "L3");
  limestone.thickness = 150;

  const beforeSection = sampleSection(beforeLayers, cut, 180);
  const afterSection = sampleSection(afterLayers, cut, 180);
  assert.equal(beforeSection.totalThicknessMeters, 495);
  assert.equal(afterSection.totalThicknessMeters, 535);
  assert.ok(Math.abs((afterSection.meanThicknessMeters - beforeSection.meanThicknessMeters) - 40) < 0.1);
  assert.ok(afterSection.layers[2].sectionShare > beforeSection.layers[2].sectionShare);
  assertLayerOrder(afterSection.points);

  const beforeFigure = buildSectionFigure(beforeSection, beforeLayers, 520, 480);
  const afterFigure = buildSectionFigure(afterSection, afterLayers, 520, 480);
  const limestoneBandBefore = beforeFigure.layerFigures[2].bottom[0].y - beforeFigure.layerFigures[2].top[0].y;
  const limestoneBandAfter = afterFigure.layerFigures[2].bottom[0].y - afterFigure.layerFigures[2].top[0].y;
  assert.ok(limestoneBandAfter > limestoneBandBefore + 20, "2D limestone band should visibly thicken");
  assert.ok(Math.abs(afterSection.faultThrowMeters - afterFigure.fault.throwMeters) < 0.1);

  const beforeHeight = sceneHeight(beforeLayers);
  const afterHeight = sceneHeight(afterLayers);
  assert.ok(Math.abs((afterHeight - beforeHeight) - toWorldY(40)) < 0.02, "3D block should grow by the same 40 m");

  const faultGapWest = surfaceElevation(afterLayers, FAULT.x - 0.01, 2) - surfaceElevation(afterLayers, FAULT.x + 0.01, 2);
  assert.ok(Math.abs(faultGapWest - toWorldY(FAULT.throwMeters)) < 0.02);

  const beforeSvg = buildSectionSVG(beforeLayers, cut);
  const afterSvg = buildSectionSVG(afterLayers, cut);
  assert.match(afterSvg, /<svg/);
  assert.match(afterSvg, /F₁ 70 m/);
  assert.match(afterSvg, /剖面长 8\.28 km/);
  assert.match(afterSvg, /平均地层厚度 536 m/);
  assert.notEqual(beforeSvg, afterSvg);
});

test("all default lithologies remain ordered and fault-offset by one throw", () => {
  const layers = cloneLayers();
  const west = layerBoundaries(layers, FAULT.x - 0.01, 3, false);
  const east = layerBoundaries(layers, FAULT.x + 0.01, 3, false);
  for (let index = 0; index < west.length; index += 1) {
    assert.ok(Math.abs((west[index] - east[index]) - toWorldY(FAULT.throwMeters)) < 0.01);
  }
  assert.equal(DEFAULT_LAYERS.length, 7);
  assert.ok(Math.abs(FAULT.x - WORLD.width / 2) < 1);
});
