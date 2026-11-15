import test from "node:test";
import assert from "node:assert/strict";
import { createDemoProject } from "../demo.js";
import {
  collectKeyframesInRange,
  countKeyframes,
  deleteObject,
  getDescendantIds,
  normalizeProject,
  pasteKeyframes,
  projectSummary
} from "../model.js";

test("demo project is a ten-second parent-child scene", () => {
  const project = normalizeProject(createDemoProject());
  const rig = project.objects.find((object) => object.name === "Planet Rig");
  const core = project.objects.find((object) => object.name === "Beat Core");
  assert.equal(project.duration, 10);
  assert.ok(rig);
  assert.ok(core);
  assert.equal(core.parentId, rig.id);
  assert.ok(getDescendantIds(project, rig.id).includes(core.id));
  assert.ok(getDescendantIds(project, rig.id).length >= 10);
  assert.ok(projectSummary(project).keyframes > 100);
});

test("deleting a parent removes every descendant and its keyframes", () => {
  const project = normalizeProject(createDemoProject());
  const rig = project.objects.find((object) => object.name === "Planet Rig");
  const descendants = getDescendantIds(project, rig.id);
  const removed = deleteObject(project, rig.id);
  assert.deepEqual(new Set(removed), new Set([rig.id, ...descendants]));
  for (const id of removed) {
    assert.ok(!project.objects.some((object) => object.id === id));
  }
  for (const object of project.objects) {
    if (object.parentId) {
      assert.ok(project.objects.some((parent) => parent.id === object.parentId), `missing parent for ${object.name}`);
    }
  }
  assert.equal(countKeyframes(project), project.objects.reduce(
    (sum, object) => sum + Object.values(object.tracks).reduce((trackSum, track) => trackSum + track.length, 0),
    0
  ));
});

test("project JSON round trip preserves hierarchy and frame data", () => {
  const original = normalizeProject(createDemoProject());
  const before = countKeyframes(original);
  const serialized = JSON.parse(JSON.stringify(original));
  const restored = normalizeProject(serialized);
  const rig = restored.objects.find((object) => object.name === "Planet Rig");
  const core = restored.objects.find((object) => object.name === "Beat Core");
  assert.equal(countKeyframes(restored), before);
  assert.equal(core.parentId, rig.id);
  assert.equal(restored.duration, 10);
  assert.equal(restored.audio.beatInterval, 0.5);
});

test("copying a segment preserves relative keyframe timing", () => {
  const project = normalizeProject(createDemoProject());
  const clip = collectKeyframesInRange(project, 3, 4.5);
  assert.ok(clip.length > 0);
  const firstRelative = Math.min(...clip.map((entry) => entry.relativeTime));
  const result = pasteKeyframes(project, clip, 6);
  assert.equal(result, clip.length);
  const targetTimes = clip.map((entry) => project.objects
    .find((object) => object.id === entry.objectId)
    ?.tracks[entry.property]
    .some((key) => Math.abs(key.time - (6 + entry.relativeTime)) < 0.001));
  assert.ok(targetTimes.every(Boolean));
  assert.equal(firstRelative, Math.min(...clip.map((entry) => entry.relativeTime)));
});

test("cycles and malformed parent references are normalized to roots", () => {
  const project = normalizeProject(createDemoProject());
  const groupA = project.objects.filter((object) => object.type === "group")[0];
  const groupB = project.objects.filter((object) => object.type === "group")[1];
  groupA.parentId = groupB.id;
  groupB.parentId = groupA.id;
  project.objects[2].parentId = "missing-parent";
  const restored = normalizeProject(project);
  assert.equal(restored.objects.find((object) => object.id === groupA.id).parentId, null);
  assert.equal(restored.objects.find((object) => object.id === groupB.id).parentId, null);
  assert.ok(!restored.objects.some((object) => object.parentId === "missing-parent"));
});
