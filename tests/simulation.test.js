import test from "node:test";
import assert from "node:assert/strict";

import {
  CLEAR_POINT,
  DESTINATIONS,
  LANE_ENTRY,
  ROUTE_LENGTH,
  YardSimulation,
  createEnvironment,
} from "../js/simulation.js";

const ENV = createEnvironment(7);
const STEP = 0.05;

function tuneBrake(sim, target) {
  let best = 100;
  let bestDistance = Infinity;
  for (let brakePoint = 100; brakePoint <= 220; brakePoint += 1) {
    const predicted = sim.predictStoppingPoint({ brakePoint });
    const distance = Math.abs(predicted - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = brakePoint;
    }
  }
  return best;
}

function advanceUntil(sim, predicate, limit = 100000) {
  for (let index = 0; index < limit; index += 1) {
    if (predicate()) return index;
    sim.step(STEP);
  }
  throw new Error("simulation did not reach expected state");
}

function releaseAndPark(sim, route) {
  const target = sim.targetForLane(route);
  const brakePoint = tuneBrake(sim, target);
  sim.setSettings({ pushSpeed: 4, brakePoint });
  const result = sim.releaseCar(route);
  assert.equal(result.ok, true, result.reason);
  const car = result.car;
  advanceUntil(sim, () => car.status === "parked" || sim.phase === "failure");
  assert.equal(car.status, "parked");
  return car;
}

test("前车未越过清空点时，下一节车厢不能发车", () => {
  const sim = new YardSimulation({ environment: ENV });
  sim.setSettings({ pushSpeed: 4, brakePoint: tuneBrake(sim, 216) });
  assert.equal(sim.releaseCar(0).ok, true);
  assert.equal(sim.releaseGate.open, false);
  assert.equal(sim.canRelease, false);
  assert.equal(sim.releaseCar(1).ok, false);

  const first = sim.cars[0];
  advanceUntil(sim, () => first.progress >= CLEAR_POINT + 0.1);
  assert.equal(sim.releaseGate.open, true);
  assert.equal(sim.canRelease, true);
});

test("错股溜放会中止作业并计为整列回场重编", () => {
  const sim = new YardSimulation({ environment: ENV });
  sim.setSettings({ pushSpeed: 4, brakePoint: 190 });
  assert.equal(sim.releaseCar(1).ok, true);
  advanceUntil(sim, () => sim.phase === "failure");
  assert.equal(sim.failure.reason, "wrong-route");
  assert.equal(sim.errors, 1);
  assert.equal(sim.collisions, 0);
});

test("迟制动且进入已占股道会追尾前车", () => {
  const sim = new YardSimulation({ environment: ENV });

  const first = releaseAndPark(sim, 0);
  assert.equal(first.destination, "A");
  assert.ok(first.progress > CLEAR_POINT);

  const second = releaseAndPark(sim, 1);
  assert.equal(second.destination, "B");

  sim.setSettings({ pushSpeed: 5.2, brakePoint: 220 });
  const thirdResult = sim.releaseCar(0);
  assert.equal(thirdResult.ok, true, thirdResult.reason);
  assert.equal(thirdResult.car.destination, "A");

  advanceUntil(sim, () => sim.phase === "failure");
  assert.equal(sim.failure.reason, "rear-end");
  assert.equal(sim.failure.otherId, first.id);
  assert.equal(sim.collisions, 1);
  assert.ok(thirdResult.car.progress <= first.progress);
});

test("制动过早停在咽喉时可以补推清空，但仍不能提前发后车", () => {
  const sim = new YardSimulation({ environment: ENV });
  sim.setSettings({ pushSpeed: 2, brakePoint: 100 });
  const result = sim.releaseCar(0);
  assert.equal(result.ok, true);
  advanceUntil(sim, () => sim.stalledCar !== null);
  assert.ok(result.car.progress < LANE_ENTRY);
  assert.equal(sim.canRelease, false);

  assert.equal(sim.rescueStalledCar().ok, true);
  assert.equal(sim.canRelease, false);
  advanceUntil(sim, () => result.car.status === "parked");
  assert.ok(result.car.progress >= LANE_ENTRY);
  assert.equal(sim.collisions, 0);
});

test("按目标制动点逐车溜放可在无碰撞情况下完成三列", () => {
  const sim = new YardSimulation({ environment: ENV });
  const routes = [];

  while (sim.currentCar) {
    const car = sim.currentCar;
    const route = DESTINATIONS.findIndex((item) => item.id === car.destination);
    routes.push(route);
    releaseAndPark(sim, route);
  }

  advanceUntil(sim, () => sim.phase === "success", 100);
  assert.equal(sim.phase, "success");
  assert.equal(sim.collisions, 0);
  assert.equal(sim.errors, 0);
  assert.equal(sim.parkedCars.length, 10);
  assert.deepEqual(sim.laneCounts(), [4, 3, 3]);
  assert.ok(sim.cars.every((car) => car.progress <= ROUTE_LENGTH));
  assert.deepEqual(
    routes,
    sim.cars.map((car) => DESTINATIONS.findIndex((item) => item.id === car.destination)),
  );
});
