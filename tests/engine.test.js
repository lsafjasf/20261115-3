import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditFlow,
  createSimulation,
  editTerrain,
  generateTerrain,
  hydrologySignature,
  refreshHydrology,
  stepSimulation,
} from '../src/engine.js';
import { runRainfallComparison, simulateComparisonScenario } from '../src/scenarios.js';

function assertContinuousOutlet(simulation, label = 'flow network') {
  const { width, height, outlet } = simulation.terrain;
  const { receiver } = simulation.routing;
  for (let cell = 0; cell < receiver.length; cell += 1) {
    let cursor = cell;
    let depth = 0;
    const seen = new Set();
    while (cursor >= 0) {
      assert.ok(cursor >= 0 && cursor < receiver.length, `${label}: receiver out of bounds`);
      assert.ok(!seen.has(cursor), `${label}: cycle at ${cursor}`);
      seen.add(cursor);
      const next = receiver[cursor];
      if (next >= 0) {
        const dx = Math.abs((next % width) - (cursor % width));
        const dy = Math.abs(Math.floor(next / width) - Math.floor(cursor / width));
        assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, `${label}: non-D8 receiver`);
      }
      cursor = next;
      depth += 1;
      assert.ok(depth < width * height, `${label}: path never reaches outlet`);
    }
    assert.equal(cursor, -1, `${label}: path terminates away from outlet`);
    assert.equal(receiver[outlet], -1, `${label}: outlet must terminate routing`);
  }
}

test('terrain generation is stable for the same seed and changes for another seed', () => {
  const first = generateTerrain(467);
  const replay = generateTerrain(467);
  const different = generateTerrain(468);
  assert.equal(hydrologySignature(createSimulation(first, {
    rainfall: 100, hardness: 1.1, dt: 1,
  })).split('-')[0], hydrologySignature(createSimulation(replay, {
    rainfall: 100, hardness: 1.1, dt: 1,
  })).split('-')[0]);
  assert.notEqual(hydrologySignature(createSimulation(first, {
    rainfall: 100, hardness: 1.1, dt: 1,
  })).split('-')[0], hydrologySignature(createSimulation(different, {
    rainfall: 100, hardness: 1.1, dt: 1,
  })).split('-')[0]);
});

test('D8 network is continuous to the single outlet and conserves rainfall', () => {
  const simulation = createSimulation(generateTerrain(467), {
    rainfall: 100,
    hardness: 1.1,
    dt: 1,
  });
  assertContinuousOutlet(simulation, 'initial');
  const audit = auditFlow(simulation);
  assert.equal(audit.discontinuity, 0);
  assert.equal(audit.cycles, 0);
  assert.ok(audit.relativeError < 1e-12, `relative balance error ${audit.relativeError}`);
  assert.ok(Math.abs(audit.outletFlow - audit.totalInput) < 1e-8);
});

test('erosion and deposition remain deterministically routed after stepping', () => {
  const first = createSimulation(generateTerrain(467), {
    rainfall: 120,
    hardness: 1.1,
    dt: 1,
  });
  const replay = createSimulation(generateTerrain(467), {
    rainfall: 120,
    hardness: 1.1,
    dt: 1,
  });
  stepSimulation(first, 7);
  stepSimulation(replay, 7);
  assertContinuousOutlet(first, 'step 7');
  assert.equal(auditFlow(first).discontinuity, 0);
  assert.equal(auditFlow(first).cycles, 0);
  assert.equal(hydrologySignature(first), hydrologySignature(replay));
  assert.ok(first.totals.eroded > 0);
  assert.ok(first.totals.deposited > 0);
});

test('a local terrain edit recalculates its affected upstream catchment and preserves routing', () => {
  const simulation = createSimulation(generateTerrain(467), {
    rainfall: 100,
    hardness: 1.1,
    dt: 1,
  });
  const edit = editTerrain(simulation, 42, 34, 6, 24);
  assert.ok(edit.modified.length > 0);
  assert.ok(edit.affectedCount > 0);
  assert.ok(edit.affectedCount >= edit.modified.length);
  assert.equal(simulation.routing.receiver.length, simulation.terrain.width * simulation.terrain.height);
  assertContinuousOutlet(simulation, 'after local edit');
  const refreshed = refreshHydrology(simulation.terrain, simulation.params.rainfall);
  assert.equal(hydrologySignature(simulation), hydrologySignature({
    terrain: simulation.terrain,
    routing: refreshed.routing,
    hydrology: refreshed.hydrology,
  }));
});

test('three rainfall scenarios respond monotonically and reproduce exactly', async () => {
  const comparison = await runRainfallComparison({
    seed: 467,
    hardness: 1.1,
    dt: 1,
    yieldControl: false,
  });
  assert.equal(comparison.results.length, 3);
  assert.equal(comparison.allReproducible, true);
  for (const result of comparison.results) {
    assert.equal(result.discontinuity, 0);
    assert.equal(result.cycles, 0);
    assert.ok(result.conservationError < 1e-12);
    assert.equal(result.signature, result.replaySignature);
  }
  assert.ok(comparison.results[1].outletFlow > comparison.results[0].outletFlow);
  assert.ok(comparison.results[2].outletFlow > comparison.results[1].outletFlow);
  assert.ok(comparison.results[1].eroded > comparison.results[0].eroded);
  assert.ok(comparison.results[2].eroded > comparison.results[1].eroded);
  assert.ok(comparison.results[1].deposited > comparison.results[0].deposited);
  assert.ok(comparison.results[2].deposited > comparison.results[1].deposited);
});

test('same scenario recipe reproduces both terrain and hydrology arrays', () => {
  const first = simulateComparisonScenario(467, 100, 1.1, 1, 8);
  const replay = simulateComparisonScenario(467, 100, 1.1, 1, 8);
  assert.equal(first.terrainHash, replay.terrainHash);
  assert.equal(first.hydrologyHash, replay.hydrologyHash);
  assert.equal(first.signature, replay.signature);
});
