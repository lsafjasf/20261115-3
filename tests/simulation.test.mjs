import test from "node:test";
import assert from "node:assert/strict";
import {
  AIRCRAFT,
  FUEL_RESERVE,
  TFR,
  WEATHER,
  cloneConfig
} from "../src/scenario.js";
import {
  runPriorityAudit,
  simulate,
  summarize
} from "../src/simulation.js";

test("fixed scenario keeps one corridor and one TFR window", () => {
  assert.equal(WEATHER.corridor, "alpha");
  assert.ok(WEATHER.start < WEATHER.end);
  assert.ok(TFR.start < TFR.end);
  assert.equal(AIRCRAFT.length, 4);
});

test("standard priority plan lands all four aircraft before reserve", () => {
  const state = simulate(cloneConfig());
  const summary = summarize(state);

  assert.equal(summary.success, true);
  assert.equal(summary.conflictCount, 0);
  assert.equal(summary.landedCount, 4);
  assert.deepEqual(summary.landingSequence, ["U01", "U03", "U04", "U02"]);
  assert.ok(summary.elapsed < 130);
  assert.ok(summary.minSeparation >= 80);

  for (const flight of summary.flights) {
    assert.equal(flight.landedAt !== null, true);
    assert.ok(flight.landedFuel >= FUEL_RESERVE, flight.id);
  }
});

test("wrong priorities reproduce the fuel and merge conflict chain", () => {
  const audit = runPriorityAudit();

  assert.equal(audit.verified, true);
  assert.equal(audit.baseline.success, true);
  assert.equal(audit.fault.success, false);
  assert.equal(audit.fault.conflictCount, 2);

  const mergeConflict = audit.fault.conflicts.find(
    (conflict) =>
      conflict.ids.includes("U01") && conflict.ids.includes("U02")
  );
  assert.ok(mergeConflict);
  assert.ok(mergeConflict.separation < mergeConflict.limit);
  assert.ok(mergeConflict.time < 100);

  const lowFuel = audit.fault.flights.find((flight) => flight.id === "U01");
  assert.equal(lowFuel.fuelCritical, true);
  assert.ok(lowFuel.landedFuel < FUEL_RESERVE);

  const releaseOrder = audit.fault.events
    .filter((event) => event.title.includes("获准进近"))
    .map((event) => event.flightId);
  assert.deepEqual(releaseOrder, ["U04", "U03", "U02", "U01"]);
});

test("simulation result is deterministic at a fixed step", () => {
  const first = simulate(cloneConfig(), { dt: 0.05 });
  const second = simulate(cloneConfig(), { dt: 0.05 });

  assert.deepEqual(first.outcome, second.outcome);
  assert.deepEqual(
    first.events.map((event) => [event.time, event.title]),
    second.events.map((event) => [event.time, event.title])
  );
});
