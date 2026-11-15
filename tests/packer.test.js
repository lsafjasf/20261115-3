import test from "node:test";
import assert from "node:assert/strict";
import {
  IncrementalPacker,
  unionRects,
  validateLayout,
} from "../src/packer.js";
import {
  DEMO_ATLAS_SIZE,
  editPayload,
  makeDemoFrames,
} from "../src/demo.js";

function positions(packer) {
  return new Map(
    [...packer.frames].map(([id, frame]) => [id, { ...frame }]),
  );
}

function createPacker() {
  const frames = makeDemoFrames();
  const packer = new IncrementalPacker({
    width: DEMO_ATLAS_SIZE,
    height: DEMO_ATLAS_SIZE,
    padding: 1,
  });
  packer.packInitial(frames);
  return { frames, packer };
}

test("100 帧基线布局合法且利用率符合预期", () => {
  const { packer } = createPacker();
  assert.equal(packer.frames.size, 100);
  assert.equal(packer.repackCount, 0);
  assert.ok(packer.utilization() >= 65, "初始利用率应高于 65%");
  assert.equal(packer.validate().valid, true);
});

test("两次增量修改只移动变更帧并产生不同局部区域", () => {
  const { packer } = createPacker();
  const baseline = positions(packer);

  const reportA = packer.applyChanges(editPayload("A"), { label: "A" });
  const afterA = positions(packer);
  assert.equal(packer.repackCount, 1);
  assert.equal(packer.frames.size, 100);
  assert.deepEqual(
    [...reportA.movedFrames].sort(),
    ["f011", "f069"],
  );
  assert.equal(reportA.validation.valid, true);
  assert.ok(reportA.regionRatio < 0.12);
  assert.ok(reportA.touchedArea > 0);

  const stableAtA = [...baseline.keys()].filter(
    (id) =>
      !reportA.movedFrames.includes(id) &&
      !reportA.removed.includes(id) &&
      !reportA.added.includes(id),
  );
  for (const id of stableAtA) {
    assert.deepEqual(afterA.get(id), baseline.get(id), `稳定帧 ${id} 不应移动`);
  }

  const beforeB = positions(packer);
  const reportB = packer.applyChanges(editPayload("B"), { label: "B" });
  assert.equal(packer.repackCount, 2);
  assert.equal(packer.frames.size, 100);
  assert.deepEqual(
    [...reportB.movedFrames].sort(),
    ["f012", "f092", "f098"],
  );
  assert.equal(reportB.validation.valid, true);
  assert.ok(reportB.regionRatio < 0.12);
  assert.notDeepEqual(reportA.repackRegion, reportB.repackRegion);

  const afterB = positions(packer);
  for (const [id, frame] of beforeB) {
    if (
      reportB.movedFrames.includes(id) ||
      reportB.removed.includes(id)
    ) {
      continue;
    }
    assert.deepEqual(afterB.get(id), frame, `B 阶段稳定帧 ${id} 不应移动`);
  }
});

test("布局校验能拒绝重叠、越界和非法坐标", () => {
  const valid = validateLayout(
    [{ id: "a", x: 0, y: 0, width: 10, height: 10 }],
    100,
    100,
  );
  assert.equal(valid.valid, true);

  const overlap = validateLayout(
    [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 10, y: 10, width: 20, height: 20 },
    ],
    100,
    100,
  );
  assert.equal(overlap.valid, false);
  assert.equal(overlap.checks.overlapFree, false);

  const outside = validateLayout(
    [{ id: "a", x: 91, y: 0, width: 10, height: 10 }],
    100,
    100,
  );
  assert.equal(outside.checks.insideBounds, false);

  const fractional = validateLayout(
    [{ id: "a", x: 0.5, y: 0, width: 10, height: 10 }],
    100,
    100,
  );
  assert.equal(fractional.checks.integerCoordinates, false);
});

test("图集空间不足时扩展图集且不重排稳定帧", () => {
  const packer = new IncrementalPacker({ width: 64, height: 64, padding: 1 });
  packer.packInitial([
    { id: "a", width: 40, height: 40 },
    { id: "b", width: 20, height: 20 },
  ]);
  const before = positions(packer);
  const report = packer.applyChanges({
    add: [{ id: "c", width: 60, height: 60 }],
  });
  assert.equal(report.validation.valid, true);
  assert.equal(packer.atlasGrowths, 1);
  assert.ok(packer.width > 64 || packer.height > 64);
  assert.deepEqual(positions(packer).get("a"), before.get("a"));
  assert.deepEqual(positions(packer).get("b"), before.get("b"));
});

test("非法修改会回滚且保持原布局", () => {
  const { packer } = createPacker();
  const before = packer.toSnapshot();
  assert.throws(
    () =>
      packer.applyChanges({
        update: [{ id: "missing-frame", width: 20, height: 20 }],
      }),
    /无法修改不存在的帧/,
  );
  assert.deepEqual(packer.toSnapshot(), before);
  assert.equal(unionRects(before.frames).width > 0, true);
});
