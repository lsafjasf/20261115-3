import test from "node:test";
import assert from "node:assert/strict";
import { IncrementalPacker } from "../src/packer.js";
import {
  DEMO_ATLAS_SIZE,
  editPayload,
  editSprites,
  makeDemoFrames,
} from "../src/demo.js";
import {
  compareRasters,
  extractRegion,
  hashRaster,
  renderAtlas,
  verifyAtlasFrames,
} from "../src/raster.js";
import {
  createAtlasDocument,
  parseAtlasDocument,
} from "../src/atlas-json.js";
import {
  pngDataUrl,
  rasterFromDataUrl,
} from "./helpers/png.js";

function setup() {
  const frames = makeDemoFrames();
  const sources = new Map(
    frames.map((frame) => [frame.id, frame.raster]),
  );
  const packer = new IncrementalPacker({
    width: DEMO_ATLAS_SIZE,
    height: DEMO_ATLAS_SIZE,
    padding: 1,
  });
  packer.packInitial(frames);
  return { packer, sources };
}

function applyEdit(state, key) {
  const payload = editPayload(key);
  const report = state.packer.applyChanges(payload, { label: key });
  for (const [id, raster] of editSprites(key)) {
    state.sources.set(id, raster);
  }
  for (const id of payload.remove) {
    state.sources.delete(id);
  }
  return report;
}

function renderCurrent(packer, sources) {
  return renderAtlas(
    [...packer.frames.values()],
    sources,
    packer.width,
    packer.height,
  );
}

test("两次增量修改后每个帧的像素与源精灵完全一致", () => {
  const state = setup();
  const baselineFrames = new Map(
    [...state.packer.frames].map(([id, frame]) => [id, { ...frame }]),
  );
  const baselineAtlas = renderCurrent(state.packer, state.sources);

  const reportA = applyEdit(state, "A");
  const atlasA = renderCurrent(state.packer, state.sources);
  const visualA = verifyAtlasFrames(
    atlasA,
    [...state.packer.frames.values()],
    state.sources,
  );
  assert.equal(visualA.equal, true, JSON.stringify(visualA.mismatches));

  const sourceChangesA = new Set([
    ...editPayload("A").update.map((frame) => frame.id),
    ...editPayload("A").add.map((frame) => frame.id),
  ]);
  for (const [id, frame] of baselineFrames) {
    if (sourceChangesA.has(id) || reportA.removed.includes(id)) continue;
    const current = state.packer.frames.get(id);
    const before = extractRegion(
      baselineAtlas,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    );
    const after = extractRegion(
      atlasA,
      current.x,
      current.y,
      current.width,
      current.height,
    );
    assert.equal(compareRasters(before, after).equal, true, `${id} 视觉应一致`);
  }

  applyEdit(state, "B");
  const atlasB = renderCurrent(state.packer, state.sources);
  const visualB = verifyAtlasFrames(
    atlasB,
    [...state.packer.frames.values()],
    state.sources,
  );
  assert.equal(visualB.equal, true, JSON.stringify(visualB.mismatches));
  assert.notEqual(hashRaster(atlasA), hashRaster(atlasB));
  assert.equal(state.packer.frames.size, 100);
});

test("自包含 JSON 可恢复全部帧与像素", () => {
  const state = setup();
  applyEdit(state, "A");
  applyEdit(state, "B");
  const atlas = renderCurrent(state.packer, state.sources);
  const document = createAtlasDocument(state.packer, {
    image: pngDataUrl(atlas),
    createdAt: "2026-11-15T00:00:00.000Z",
  });
  const serialized = JSON.stringify(document);
  assert.ok(serialized.includes("data:image/png;base64,"));

  const parsed = parseAtlasDocument(serialized);
  assert.equal(parsed.frames.length, 100);
  assert.deepEqual(parsed.validation.checks, {
    integerCoordinates: true,
    insideBounds: true,
    positiveSlices: true,
    uniqueIds: true,
    overlapFree: true,
  });

  const decodedAtlas = rasterFromDataUrl(parsed.image);
  assert.equal(hashRaster(decodedAtlas), hashRaster(atlas));
  const restoredSources = new Map(
    parsed.frames.map((frame) => [
      frame.id,
      extractRegion(
        decodedAtlas,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
      ),
    ]),
  );
  const restored = new IncrementalPacker();
  restored.restore({
    width: parsed.width,
    height: parsed.height,
    padding: parsed.padding,
    frames: parsed.frames,
    stats: parsed.stats,
  });
  assert.equal(restored.frames.size, 100);
  assert.equal(restored.repackCount, state.packer.repackCount);
  assert.equal(restored.validate().valid, true);
  const restoredVisual = verifyAtlasFrames(
    decodedAtlas,
    [...restored.frames.values()],
    restoredSources,
  );
  assert.equal(restoredVisual.equal, true);
  for (const [id, source] of state.sources) {
    assert.equal(
      compareRasters(source, restoredSources.get(id)).equal,
      true,
      `${id} 恢复后像素应一致`,
    );
  }
});

test("JSON 导入会拒绝重叠与越界切片", () => {
  const state = setup();
  const document = createAtlasDocument(state.packer, {
    image: "data:image/png;base64,AA==",
  });
  const overlapping = structuredClone(document);
  overlapping.frames[1].x = overlapping.frames[0].x;
  overlapping.frames[1].y = overlapping.frames[0].y;
  assert.throws(
    () => parseAtlasDocument(JSON.stringify(overlapping)),
    /JSON 切片非法/,
  );

  const outside = structuredClone(document);
  outside.frames[0].x = outside.atlas.width;
  assert.throws(
    () => parseAtlasDocument(JSON.stringify(outside)),
    /JSON 切片非法/,
  );

  const fractional = structuredClone(document);
  fractional.frames[0].x = 0.5;
  assert.throws(
    () => parseAtlasDocument(JSON.stringify(fractional)),
    /必须是整数/,
  );
});
