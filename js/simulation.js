export const ROUTE_LENGTH = 240;
export const CLEAR_POINT = 128;
export const LANE_ENTRY = 139;
export const BUFFER_STOP = 233;
export const PARK_FRONT = 216;
export const CAR_SPACING = 12;
export const CAR_LENGTH = 8;
export const BRAKE_DECEL = 1.05;
export const ROLLING_RESISTANCE = 0.018;

export const DESTINATIONS = [
  { id: "A", name: "东场", short: "东", capacity: 4, color: "#e5a34d", code: "E" },
  { id: "B", name: "中场", short: "中", capacity: 3, color: "#55b5a6", code: "M" },
  { id: "C", name: "西场", short: "西", capacity: 3, color: "#dc716d", code: "W" },
];

const CAR_SEQUENCE = [
  { code: "A-104", destination: "A", mass: 28 },
  { code: "B-217", destination: "B", mass: 31 },
  { code: "A-087", destination: "A", mass: 27 },
  { code: "C-332", destination: "C", mass: 34 },
  { code: "B-109", destination: "B", mass: 29 },
  { code: "A-266", destination: "A", mass: 30 },
  { code: "C-041", destination: "C", mass: 26 },
  { code: "B-385", destination: "B", mass: 33 },
  { code: "A-153", destination: "A", mass: 28 },
  { code: "C-298", destination: "C", mass: 32 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEnvironment(seed = 7) {
  const random = mulberry32(seed);
  const gradePercent = round(1.25 + random() * 0.55, 2);
  const windSpeed = round(0.4 + random() * 3.1, 1);
  const windDirection = random() > 0.5 ? 1 : -1;
  return {
    seed,
    gradePercent,
    windSpeed,
    windDirection,
    windAccel: round(windSpeed * windDirection * 0.006, 4),
  };
}

export function routeForDestination(destination) {
  return DESTINATIONS.findIndex((item) => item.id === destination);
}

export function destinationForRoute(route) {
  return DESTINATIONS[route] ?? DESTINATIONS[0];
}

export class YardSimulation {
  constructor({ seed = 7, environment = null } = {}) {
    this.initialSeed = seed;
    this.environment = environment ? { ...environment } : createEnvironment(seed);
    this.cars = [];
    this.nextIndex = 0;
    this.selectedRoute = 0;
    this.phase = "ready";
    this.elapsed = 0;
    this.collisions = 0;
    this.errors = 0;
    this.events = [];
    this.failure = null;
    this.successTimer = null;
    this.lastReleased = null;
    this.settings = {
      pushSpeed: 4.0,
      brakePoint: 194,
    };
    this.reset({ seed, environment: this.environment });
  }

  reset({ seed = this.initialSeed, environment = null, preserveSettings = false } = {}) {
    this.initialSeed = seed;
    this.environment = environment ? { ...environment } : createEnvironment(seed);
    this.cars = CAR_SEQUENCE.map((car, index) => ({
      id: `car-${index + 1}`,
      index,
      code: car.code,
      destination: car.destination,
      mass: car.mass,
      status: "staged",
      progress: 0,
      velocity: 0,
      acceleration: 0,
      route: null,
      parkingTarget: null,
      brakePoint: null,
      pushSpeed: null,
      brakeStarted: false,
      assisted: false,
      assistedTarget: null,
    }));
    this.nextIndex = 0;
    this.selectedRoute = 0;
    this.phase = "ready";
    this.elapsed = 0;
    this.collisions = 0;
    this.errors = 0;
    this.events = [];
    this.failure = null;
    this.successTimer = null;
    this.lastReleased = null;
    if (!preserveSettings) {
      this.settings = { pushSpeed: 4.0, brakePoint: 194 };
    }
    return this;
  }

  get currentCar() {
    return this.cars[this.nextIndex] ?? null;
  }

  get movingCars() {
    return this.cars.filter((car) => car.status === "rolling");
  }

  get parkedCars() {
    return this.cars.filter((car) => car.status === "parked");
  }

  get stalledCar() {
    return this.cars.find((car) => car.status === "stalled") ?? null;
  }

  get previousCar() {
    if (!this.lastReleased) return null;
    return this.cars.find((car) => car.id === this.lastReleased) ?? null;
  }

  get isComplete() {
    return this.cars.every((car) => car.status === "parked") && this.collisions === 0;
  }

  get releaseGate() {
    const previous = this.previousCar;
    if (!previous) {
      return { open: true, reason: "股道空闲，可以溜放", car: null };
    }
    if (previous.status === "rolling") {
      if (previous.progress >= CLEAR_POINT) {
        return { open: true, reason: "前车已清空，可以继续", car: previous };
      }
      return {
        open: false,
        reason: `前车距清空点 ${Math.max(0, Math.ceil(CLEAR_POINT - previous.progress))} m`,
        car: previous,
      };
    }
    if (previous.status === "parked" && previous.progress >= CLEAR_POINT) {
      return { open: true, reason: "前车已归位，可以继续", car: previous };
    }
    if (previous.status === "stalled") {
      return { open: false, reason: "前车未清空，需坡道补推", car: previous };
    }
    if (previous.status === "parked") {
      return { open: false, reason: "前车停在道岔咽喉，股道未清空", car: previous };
    }
    return { open: false, reason: "等待前车动作", car: previous };
  }

  get canRelease() {
    return (
      (this.phase === "ready" || this.phase === "running") &&
      Boolean(this.currentCar) &&
      this.releaseGate.open
    );
  }

  laneCars(route) {
    return this.cars.filter(
      (car) =>
        car.route === route &&
        (car.status === "parked" || car.status === "rolling") &&
        car.progress >= LANE_ENTRY,
    );
  }

  laneParkedCount(route) {
    return this.cars.filter((car) => car.route === route && car.status === "parked").length;
  }

  targetForLane(route) {
    const occupied = this.laneCars(route);
    if (!occupied.length) return PARK_FRONT;
    const candidates = occupied.map((car) =>
      car.status === "parked" && Number.isFinite(car.progress)
        ? car.progress
        : Number.isFinite(car.parkingTarget)
          ? car.parkingTarget
          : car.progress,
    );
    return Math.max(LANE_ENTRY + 6, Math.min(...candidates) - CAR_SPACING);
  }

  pushEvent(type, detail = {}) {
    this.events.push({ type, at: round(this.elapsed, 2), ...detail });
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  setRoute(route) {
    if (!Number.isInteger(route) || route < 0 || route >= DESTINATIONS.length) return false;
    if (this.phase === "success" || this.phase === "failure") return false;
    if (this.selectedRoute === route) return true;
    this.selectedRoute = route;
    this.pushEvent("switch", { route });
    return true;
  }

  setSettings({ pushSpeed, brakePoint } = {}) {
    if (Number.isFinite(pushSpeed)) {
      this.settings.pushSpeed = round(clamp(pushSpeed, 2, 5.2), 1);
    }
    if (Number.isFinite(brakePoint)) {
      this.settings.brakePoint = round(clamp(brakePoint, 100, 220), 0);
    }
    return { ...this.settings };
  }

  releaseCar(route = this.selectedRoute) {
    if (!this.canRelease) {
      return { ok: false, reason: this.releaseGate.reason };
    }
    if (!this.setRoute(route) && this.selectedRoute !== route) {
      return { ok: false, reason: "当前道岔不可操作" };
    }

    const car = this.currentCar;
    const laneCount = this.laneCars(route).length;
    if (laneCount >= DESTINATIONS[route].capacity) {
      return { ok: false, reason: `${DESTINATIONS[route].name}股道已满` };
    }

    car.status = "rolling";
    car.route = route;
    car.progress = 0;
    car.velocity = this.settings.pushSpeed;
    car.acceleration = 0;
    car.pushSpeed = this.settings.pushSpeed;
    car.brakePoint = this.settings.brakePoint;
    car.parkingTarget = this.targetForLane(route);
    car.brakeStarted = false;
    car.assisted = false;
    car.assistedTarget = null;
    this.nextIndex += 1;
    this.lastReleased = car.id;
    this.phase = "running";
    this.pushEvent("release", {
      carId: car.id,
      route,
      speed: car.pushSpeed,
      brakePoint: car.brakePoint,
      target: car.parkingTarget,
    });
    return { ok: true, car };
  }

  rescueStalledCar() {
    const car = this.stalledCar;
    if (!car || this.phase === "failure" || this.phase === "success") {
      return { ok: false, reason: "当前没有需要补推的车厢" };
    }
    const target = this.targetForLane(car.route);
    car.status = "rolling";
    car.velocity = 1.4;
    car.acceleration = 0;
    car.assisted = true;
    car.assistedTarget = Math.max(CLEAR_POINT + 5, target);
    this.pushEvent("rescue", { carId: car.id, target: car.assistedTarget });
    return { ok: true, car };
  }

  step(dt) {
    if (this.phase !== "running") return;
    const safeDt = clamp(dt, 0, 0.1);
    if (!safeDt) return;

    this.elapsed += safeDt;

    for (const car of this.movingCars) {
      this.updateCar(car, safeDt);
      if (this.phase === "failure") return;
    }

    this.detectInteractions();
    if (this.phase === "failure") return;

    for (const car of this.movingCars) {
      if (car.route !== null && car.destination !== DESTINATIONS[car.route].id && car.progress >= CLEAR_POINT) {
        this.errors += 1;
        this.fail("wrong-route", car, {
          detail: `${DESTINATIONS[car.route].name}错收${DESTINATIONS.find((d) => d.id === car.destination).name}车厢`,
        });
        return;
      }
    }

    for (const car of [...this.movingCars]) {
      if (car.progress >= BUFFER_STOP) {
        car.velocity = 0;
        this.collisions += 1;
        this.fail("buffer", car, { detail: "车钩越过止冲挡" });
        return;
      }
    }

    if (this.successTimer !== null) {
      this.successTimer -= safeDt;
      if (this.successTimer <= 0 && this.isComplete) {
        this.phase = "success";
        this.successTimer = null;
        this.pushEvent("success", { elapsed: round(this.elapsed, 2) });
      }
    }
  }

  updateCar(car, dt) {
    if (car.assisted) {
      car.velocity = Math.min(1.8, car.velocity + 0.35 * dt);
      car.acceleration = 0;
      car.progress += car.velocity * dt;
      if (car.progress >= car.assistedTarget) {
        car.progress = car.assistedTarget;
        car.velocity = 0;
        car.assisted = false;
        this.parkCar(car, "assist-park");
      }
      return;
    }

    if (car.velocity <= 0.02) {
      this.stopCar(car);
      return;
    }

    const gradeFactor = car.progress < CLEAR_POINT ? 1 : 0.45;
    const gradeAccel = this.environment.gradePercent * 0.085 * gradeFactor;
    let netAccel = gradeAccel + this.environment.windAccel - ROLLING_RESISTANCE;
    const braking = car.progress >= car.brakePoint;

    if (braking) {
      if (!car.brakeStarted) {
        car.brakeStarted = true;
        this.pushEvent("brake", { carId: car.id, at: round(car.progress, 1) });
      }
      netAccel -= BRAKE_DECEL;
    }

    car.acceleration = netAccel;
    car.velocity = Math.max(0, car.velocity + netAccel * dt);
    car.progress += car.velocity * dt;

    if (car.velocity <= 0.02) {
      this.stopCar(car);
    }
  }

  stopCar(car) {
    car.velocity = 0;
    car.acceleration = 0;
    if (car.progress < LANE_ENTRY) {
      car.status = "stalled";
      this.pushEvent("stalled", {
        carId: car.id,
        at: round(car.progress, 1),
        shortBy: round(LANE_ENTRY - car.progress, 1),
      });
    } else {
      this.parkCar(car);
    }
  }

  parkCar(car, reason = "park") {
    car.status = "parked";
    car.velocity = 0;
    car.acceleration = 0;
    car.brakeStarted = false;
    this.pushEvent("park", {
      carId: car.id,
      route: car.route,
      at: round(car.progress, 1),
      reason,
    });
    if (this.isComplete && this.successTimer === null) {
      this.successTimer = 1.1;
    }
  }

  detectInteractions() {
    for (const car of this.movingCars) {
      if (car.progress < LANE_ENTRY || car.route === null) continue;
      const carsAhead = this.cars.filter(
        (other) =>
          other !== car &&
          other.route === car.route &&
          other.progress > car.progress &&
          (other.status === "parked" || other.status === "rolling"),
      );
      if (!carsAhead.length) continue;
      const ahead = carsAhead.sort((a, b) => a.progress - b.progress)[0];
      const gap = ahead.progress - car.progress;
      const closingSpeed = car.velocity - (ahead.status === "parked" ? 0 : ahead.velocity);

      if (gap <= CAR_LENGTH) {
        if (closingSpeed > 0.55) {
          car.velocity = 0;
          car.status = "collided";
          this.collisions += 1;
          this.fail("rear-end", car, {
            detail: `以 ${round(closingSpeed * 3.6, 1)} km/h 撞上前车 ${ahead.code}`,
            otherId: ahead.id,
          });
        } else {
          car.progress = Math.max(LANE_ENTRY, ahead.progress - CAR_LENGTH - 0.01);
          car.velocity = 0;
          this.parkCar(car, "soft-couple");
        }
        return;
      }
    }
  }

  fail(reason, car, detail = {}) {
    if (this.phase === "failure" || this.phase === "success") return;
    this.phase = "failure";
    this.successTimer = null;
    this.failure = {
      reason,
      carId: car?.id ?? null,
      code: car?.code ?? null,
      at: round(this.elapsed, 2),
      ...detail,
    };
    this.pushEvent("failure", this.failure);
  }

  predictStoppingPoint({
    pushSpeed = this.settings.pushSpeed,
    brakePoint = this.settings.brakePoint,
    environment = this.environment,
  } = {}) {
    const dt = 0.02;
    let progress = 0;
    let velocity = clamp(pushSpeed, 2, 5.2);

    for (let index = 0; index < 20000; index += 1) {
      if (velocity <= 0.02) break;
      const gradeFactor = progress < CLEAR_POINT ? 1 : 0.45;
      let acceleration =
        environment.gradePercent * 0.085 * gradeFactor +
        environment.windAccel -
        ROLLING_RESISTANCE;
      if (progress >= brakePoint) acceleration -= BRAKE_DECEL;
      velocity = Math.max(0, velocity + acceleration * dt);
      progress += velocity * dt;
      if (progress > ROUTE_LENGTH + 24) break;
    }
    return round(progress, 1);
  }

  parkingTargetForRoute(route = this.selectedRoute) {
    return round(this.targetForLane(route), 1);
  }

  laneCounts() {
    return DESTINATIONS.map((_, route) => this.laneCars(route).length);
  }

  capture() {
    return {
      phase: this.phase,
      elapsed: round(this.elapsed, 3),
      selectedRoute: this.selectedRoute,
      nextIndex: this.nextIndex,
      collisions: this.collisions,
      errors: this.errors,
      environment: { ...this.environment },
      failure: this.failure ? { ...this.failure } : null,
      releaseGate: {
        open: this.releaseGate.open,
        reason: this.releaseGate.reason,
        carId: this.releaseGate.car?.id ?? null,
      },
      laneCounts: this.laneCounts(),
      targets: DESTINATIONS.map((_, route) => round(this.targetForLane(route), 3)),
      parkedCount: this.parkedCars.length,
      cars: this.cars.map((car) => ({
        id: car.id,
        index: car.index,
        code: car.code,
        destination: car.destination,
        mass: car.mass,
        status: car.status,
        progress: round(car.progress, 3),
        velocity: round(car.velocity, 3),
        route: car.route,
        parkingTarget: car.parkingTarget,
        brakePoint: car.brakePoint,
        brakeStarted: car.brakeStarted,
        assisted: car.assisted,
      })),
    };
  }
}
