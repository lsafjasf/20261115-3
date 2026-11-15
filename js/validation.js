import { RescueSimulation } from "./simulation.js";
import { WORLD, clamp, angleDelta } from "./config.js";

const STEP = 1 / 60;

function autopilot(sim, target, cruiseSpeed = 82) {
  const dx = target.x - sim.vehicle.x;
  const dy = target.y - sim.vehicle.y;
  const distance = Math.hypot(dx, dy);
  const desiredHeading = Math.atan2(dy, dx);
  const steer = distance < 9 ? 0 : clamp(angleDelta(desiredHeading, sim.vehicle.heading) * 2.4, -1, 1);
  const desiredSpeed = distance < 11 ? 0 : distance < 76 ? 13 : distance < 150 ? 28 : cruiseSpeed;
  const speed = sim.vehicle.speed;
  let drive = 0;
  let brake = false;
  if (speed > desiredSpeed + 3.5) {
    brake = true;
  } else if (speed < desiredSpeed - 4) {
    drive = 1;
  }
  if (distance < 14 && Math.abs(speed) < 5) {
    drive = 0;
    brake = true;
  }
  return { drive, steer, brake };
}

function runWaypoints(sim, waypoints, options = {}) {
  const limit = options.maxTime || 240;
  const arriveRadius = options.arriveRadius || 26;
  const cruiseSpeed = options.cruiseSpeed || 82;
  let index = 0;
  let steps = 0;
  const events = [];
  while (index < waypoints.length && sim.mode === "running" && steps * STEP < limit) {
    const target = waypoints[index];
    sim.update(STEP, autopilot(sim, target, target.speed || cruiseSpeed));
    for (const event of sim.events) {
      if (event.type !== "crack" && event.type !== "danger") events.push({ time: sim.elapsed, ...event });
    }
    if (Math.hypot(sim.vehicle.x - target.x, sim.vehicle.y - target.y) < arriveRadius) {
      index += 1;
    }
    steps += 1;
  }
  return { sim, waypointsReached: index, steps, events };
}

export const MISSION_ROUTE = [
  { x: 1010, y: 792, speed: 78 },
  { x: 1120, y: 760, speed: 62 },
  { x: 1217, y: 628, speed: 36 },
  { x: 1244, y: 675, speed: 50 },
  { x: 1240, y: 900, speed: 54 },
  { x: 1160, y: 906, speed: 46 },
  { x: 1170, y: 650, speed: 70 },
  { x: 1165, y: 370, speed: 70 },
  { x: 1010, y: 292, speed: 52 },
  { x: 918, y: 246, speed: 30 },
  { x: 1010, y: 310, speed: 54 },
  { x: 1200, y: 490, speed: 70 },
  { x: 1225, y: 760, speed: 70 },
  { x: 1200, y: 905, speed: 50 },
  { x: 650, y: 908, speed: 55 },
  { x: 310, y: 890, speed: 60 },
  { x: 280, y: 650, speed: 60 },
  { x: 320, y: 470, speed: 50 },
  { x: 432, y: 474, speed: 30 },
  { x: 360, y: 600, speed: 48 },
  { x: 350, y: 905, speed: 55 }
];

export function runFixedSeedMission() {
  const sim = new RescueSimulation(WORLD.seed);
  const result = runWaypoints(sim, MISSION_ROUTE, { maxTime: 260, arriveRadius: 25, cruiseSpeed: 78 });
  const snapshot = sim.snapshot();
  return {
    seed: WORLD.seed,
    mode: sim.mode,
    success: sim.mode === "won" && sim.safeCount === 3,
    safeCount: sim.safeCount,
    order: snapshot.orderNames,
    elapsed: Number(sim.elapsed.toFixed(2)),
    elapsedLabel: snapshot.elapsedLabel,
    waypointsReached: result.waypointsReached,
    crackGrowth: Number(snapshot.crackGrowth.toFixed(2)),
    peakStress: Number(sim.peakStress.toFixed(2)),
    vehicle: {
      x: Number(sim.vehicle.x.toFixed(2)),
      y: Number(sim.vehicle.y.toFixed(2))
    },
    events: result.events.filter((event) => ["pickup", "safe", "win", "sink", "warning"].includes(event.type))
  };
}

function createDetourRun() {
  const sim = new RescueSimulation(WORLD.seed);
  sim.vehicle.x = 676;
  sim.vehicle.y = 814;
  sim.vehicle.heading = -Math.PI / 2;
  sim.vehicle.speed = 0;
  sim.vehicle.aboard = ["cheng"];
  const cheng = sim.survivors.find((person) => person.id === "cheng");
  cheng.status = "aboard";
  cheng.aboardAt = 0;
  sim.order.push("cheng");
  sim.recordTrail(true);
  return sim;
}

const WRONG_DETOUR = [
  { x: 705, y: 772, speed: 90 },
  { x: 760, y: 655, speed: 96 },
  { x: 810, y: 548, speed: 96 },
  { x: 846, y: 440, speed: 92 },
  { x: 912, y: 362, speed: 82 }
];

const SAFE_DETOUR = [
  { x: 618, y: 760, speed: 82 },
  { x: 532, y: 690, speed: 82 },
  { x: 476, y: 600, speed: 76 },
  { x: 456, y: 522, speed: 64 },
  { x: 478, y: 462, speed: 48 }
];

function summarizeDetour(sim) {
  const snapshot = sim.snapshot();
  return {
    mode: sim.mode,
    elapsed: Number(sim.elapsed.toFixed(2)),
    crackLength: Number(snapshot.crackLength.toFixed(2)),
    crackGrowth: Number(snapshot.crackGrowth.toFixed(2)),
    crackCount: snapshot.crackCount,
    peakStress: Number(sim.peakStress.toFixed(2)),
    finalStress: Number(snapshot.localStress.toFixed(2)),
    support: Number(snapshot.support.toFixed(1)),
    position: {
      x: Number(sim.vehicle.x.toFixed(1)),
      y: Number(sim.vehicle.y.toFixed(1))
    }
  };
}

export function validateWrongDetour() {
  const wrongSim = createDetourRun();
  const wrongInitial = wrongSim.initialCrackLength;
  runWaypoints(wrongSim, WRONG_DETOUR, { maxTime: 32, arriveRadius: 22, cruiseSpeed: 90 });
  const safeSim = createDetourRun();
  runWaypoints(safeSim, SAFE_DETOUR, { maxTime: 32, arriveRadius: 22, cruiseSpeed: 78 });
  const wrong = summarizeDetour(wrongSim);
  const safe = summarizeDetour(safeSim);
  return {
    seed: WORLD.seed,
    step: STEP,
    comparisonWindowSeconds: 32,
    initialCrackLength: Number(wrongInitial.toFixed(2)),
    wrong,
    safe,
    crackGrowthDelta: Number((wrong.crackGrowth - safe.crackGrowth).toFixed(2)),
    propagationRatio: Number((wrong.crackGrowth / Math.max(1, safe.crackGrowth)).toFixed(2)),
    passed: wrong.crackGrowth > safe.crackGrowth * 1.25 || wrong.mode === "lost"
  };
}
