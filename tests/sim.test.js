"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Simulation } = require("../sim.js");

function runToEnd(sim, maxTicks) {
  const ticks = maxTicks || 22000;
  for (let index = 0; index < ticks && sim.status === "running"; index += 1) {
    sim.update(0.05);
  }
  return sim.getSnapshot();
}

function applyReferencePlan(sim) {
  sim.setBarrier("a", "closed");
  sim.setBarrier("b", "open");
  sim.setTransformerDoor("sealed");
  sim.setGate("1", "exit");
  sim.setGate("2", "exit");
  sim.setPump("1", "high");
  sim.setPump("2", "low");
}

test("reference dispatch completes evacuation with a dry transformer room", () => {
  const sim = new Simulation();
  applyReferencePlan(sim);
  sim.start();
  const result = runToEnd(sim);

  assert.equal(result.status, "success", result.endReason);
  assert.equal(result.evacuated, result.totalPassengers);
  assert.ok(result.time < 15 * 60, "evacuation finished within the mission window");
  assert.ok(result.water.transformerLiters <= 2, "transformer room stayed dry");
  assert.ok(result.peakRisk < 70, "reference plan remained below the stampede alarm");
  assert.ok(result.stats.pumpTrips > 0, "high-power pump overload was exercised");
});

test("sealing both entrances creates a measurable stampede risk at west exit", () => {
  const sim = new Simulation();
  sim.setBarrier("a", "closed");
  sim.setBarrier("b", "closed");
  sim.setTransformerDoor("sealed");
  sim.setGate("1", "exit");
  sim.setGate("2", "exit");
  sim.setPump("1", "low");
  sim.start();

  let largestQueue = 0;
  let ticks = 0;
  while (sim.status === "running" && ticks < 22000) {
    sim.update(0.05);
    largestQueue = Math.max(largestQueue, sim.queues.westExit.length);
    ticks += 1;
  }
  const result = sim.getSnapshot();

  assert.equal(result.status, "success");
  assert.ok(result.peakRisk >= 82, "peak crush risk reached the danger band");
  assert.ok(result.stats.riskEvents >= 1);
  assert.ok(largestQueue >= 120, "west exit queue exceeded 120 people");
  assert.ok(
    result.logs.some((item) => item.level === "danger" && item.message.includes("西侧窄出口")),
    "danger log identifies the incorrect sealing consequence"
  );
});

test("leaving both storm entrances open without drainage floods the transformer room", () => {
  const sim = new Simulation();
  sim.start();
  const result = runToEnd(sim);

  assert.equal(result.status, "failed");
  assert.match(result.endReason, /变电室/);
  assert.ok(result.water.transformerLiters > 2);
});

test("reversing both gate banks from entry to exit improves evacuation flow", () => {
  const baseline = new Simulation();
  baseline.setBarrier("a", "closed");
  baseline.setBarrier("b", "open");
  baseline.setTransformerDoor("sealed");
  baseline.setGate("1", "entry");
  baseline.setGate("2", "entry");
  baseline.setPump("1", "high");
  baseline.start();
  const entryResult = runToEnd(baseline);

  const reversed = new Simulation();
  applyReferencePlan(reversed);
  reversed.start();
  const exitResult = runToEnd(reversed);

  assert.equal(entryResult.status, "success");
  assert.equal(exitResult.status, "success");
  assert.ok(exitResult.time < entryResult.time, "exit direction finishes earlier");
  assert.ok(exitResult.peakRisk < entryResult.peakRisk, "exit direction lowers crush risk");
});
