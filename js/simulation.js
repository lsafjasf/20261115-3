import {
  VEHICLE,
  WORLD,
  SURVIVORS,
  clamp,
  angleDelta,
  handlingForAboard,
  formatTime
} from "./config.js";
import { IceField } from "./ice.js";

export class RescueSimulation {
  constructor(seed = WORLD.seed) {
    this.seed = seed >>> 0;
    this.reset();
  }

  reset() {
    this.mode = "running";
    this.elapsed = 0;
    this.events = [];
    this.ice = new IceField(this.seed);
    this.initialCrackLength = this.ice.initialCrackLength;
    this.peakStress = 0;
    this.peakShock = 0;
    this.riskTimer = 0;
    this.lastTrailPose = null;
    this.trail = [];
    this.cooldowns = {};
    this.vehicle = {
      x: VEHICLE.startX,
      y: VEHICLE.startY,
      heading: VEHICLE.startHeading,
      speed: 0,
      steering: 0,
      drive: 0,
      braking: false,
      aboard: []
    };
    this.survivors = SURVIVORS.map((person) => ({
      ...person,
      status: "waiting",
      rescuedAt: null,
      aboardAt: null
    }));
    this.order = [];
    this.safeCount = 0;
    this.lastIce = null;
    this.collapseTimer = 0;
    this.recordTrail(true);
  }

  start() {
    if (this.mode === "ready") this.mode = "running";
  }

  handling() {
    return handlingForAboard(this.vehicle.aboard.length);
  }

  emit(type, message, data = {}) {
    this.events.push({ type, message, ...data });
  }

  canEmit(key, cooldown = 3) {
    if ((this.cooldowns[key] || 0) > this.elapsed) return false;
    this.cooldowns[key] = this.elapsed + cooldown;
    return true;
  }

  update(dt, input = {}) {
    if (this.mode !== "running") return this.snapshot();
    const step = clamp(dt, 0, 0.05);
    this.elapsed += step;
    this.events = [];
    const handling = this.handling();
    const vehicle = this.vehicle;
    const drive = clamp(input.drive || 0, -1, 1);
    const steer = clamp(input.steer || 0, -1, 1);
    const braking = Boolean(input.brake);
    vehicle.drive = drive;
    vehicle.steering = steer;
    vehicle.braking = braking;

    this._updateMotion(step, drive, steer, braking, handling);
    this._updateRescue(step, handling);
    if (this.mode !== "running") {
      this.recordTrail();
      return this.snapshot();
    }

    const onIce = vehicle.y < WORLD.shoreY + 4;
    this.lastIce = this.ice.update(step, vehicle, handling, onIce);
    this.peakStress = Math.max(this.peakStress, this.lastIce.localStress);
    this.peakShock += this.lastIce.shock;
    if (this.lastIce.crackGrowth > 0.004 && this.canEmit("crack", 0.65)) {
      this.emit("crack", "冰层发出断裂声", { intensity: clamp(this.lastIce.localStress / 90, 0.2, 1) });
    }
    this._updateDanger(step, onIce, handling);
    this.recordTrail();
    return this.snapshot();
  }

  _updateMotion(dt, drive, steer, braking, handling) {
    const vehicle = this.vehicle;
    if (braking) {
      const brakingSpeed = Math.abs(vehicle.speed);
      vehicle.speed = Math.max(0, brakingSpeed - handling.brake * dt) * Math.sign(vehicle.speed || 1);
    } else if (drive > 0) {
      if (vehicle.speed < 0) {
        vehicle.speed = Math.min(0, vehicle.speed + handling.brake * dt);
      } else {
        vehicle.speed = Math.min(handling.maxSpeed, vehicle.speed + handling.accel * dt);
      }
    } else if (drive < 0) {
      if (vehicle.speed > 0) {
        vehicle.speed = Math.max(0, vehicle.speed - handling.brake * dt);
      } else {
        vehicle.speed = Math.max(-VEHICLE.reverseSpeed, vehicle.speed - handling.accel * 0.52 * dt);
      }
    } else {
      const drag = 14 + Math.abs(vehicle.speed) * 0.08;
      if (Math.abs(vehicle.speed) <= drag * dt) vehicle.speed = 0;
      else vehicle.speed -= Math.sign(vehicle.speed) * drag * dt;
    }

    const direction = vehicle.speed >= 0 ? 1 : -1;
    const steeringAuthority = clamp(Math.abs(vehicle.speed) / 42, 0.18, 1);
    vehicle.heading += steer * handling.turnRate * steeringAuthority * direction * dt;
    vehicle.x += Math.cos(vehicle.heading) * vehicle.speed * dt;
    vehicle.y += Math.sin(vehicle.heading) * vehicle.speed * dt;
    vehicle.x = clamp(vehicle.x, 34, WORLD.width - 34);
    vehicle.y = clamp(vehicle.y, 52, WORLD.height - 24);
  }

  _updateRescue(dt, handling) {
    const vehicle = this.vehicle;
    const speed = Math.abs(vehicle.speed);
    for (const person of this.survivors) {
      if (person.status !== "waiting") continue;
      const distance = Math.hypot(vehicle.x - person.x, vehicle.y - person.y);
      if (distance < VEHICLE.pickupRadius && speed <= VEHICLE.pickupSpeed) {
        person.status = "aboard";
        person.aboardAt = this.elapsed;
        vehicle.aboard.push(person.id);
        this.order.push(person.id);
        this.emit("pickup", `${person.name} 已登车 · 载重增加`, { personId: person.id });
      } else if (distance < 92 && speed > VEHICLE.pickupSpeed && this.canEmit(`slow-${person.id}`, 3.2)) {
        this.emit("warning", `靠近 ${person.name} 时减速至 25 km/h 以下`, { personId: person.id });
      }
    }

    if (vehicle.y > WORLD.shoreY + 4) {
      if (vehicle.aboard.length > 0 && speed <= VEHICLE.shoreDropSpeed) {
        const dropped = this.survivors.filter((person) => person.status === "aboard");
        for (const person of dropped) {
          person.status = "safe";
          person.rescuedAt = this.elapsed;
          this.safeCount += 1;
          this.emit("safe", `${person.name} 已移交岸边救援队`, { personId: person.id });
        }
        vehicle.aboard = [];
        if (this.safeCount === this.survivors.length) {
          this.mode = "won";
          this.emit("win", "三名人员全部生还，车辆安全返岸", {});
        }
      } else if (vehicle.aboard.length > 0 && speed > VEHICLE.shoreDropSpeed && this.canEmit("shore-fast", 2.5)) {
        this.emit("warning", "岸边停靠超速 · 请刹车", {});
      }
    }
    this.peakStress = Math.max(this.peakStress, 0);
  }

  _updateDanger(dt, onIce, handling) {
    if (!onIce || this.mode !== "running") {
      this.riskTimer = Math.max(0, this.riskTimer - dt * 2);
      this.collapseTimer = Math.max(0, this.collapseTimer - dt);
      return;
    }
    const cell = this.ice.cellAt(this.vehicle.x, this.vehicle.y);
    const local = this.lastIce?.localStress || 0;
    const actualFailure = cell.stress >= 96 || local >= 96;
    if (actualFailure) {
      const urgency = 0.55 + Math.abs(this.vehicle.speed) / 190 + (cell.stress - 96) * 0.08;
      this.riskTimer += dt * urgency;
      this.collapseTimer = Math.max(this.collapseTimer, Math.min(2.4, (cell.stress - 86) / 8));
      if (this.canEmit("danger", 1.1)) {
        this.emit("danger", "承载力临界 · 立即驶离裂纹区", {});
      }
      if (this.riskTimer >= 1.08 || cell.broken) {
        this.mode = "lost";
        this.emit("sink", "冰层塌陷，救援车落水", {});
      }
    } else {
      this.riskTimer = Math.max(0, this.riskTimer - dt * 1.4);
      if (cell.stress >= 83 && this.canEmit("warn-stress", 4)) {
        this.emit("warning", "冰层正在持续开裂 · 降低速度", {});
      }
    }
    this.peakStress = Math.max(this.peakStress, local);
  }

  setWaypointSteering(point) {
    if (!point) return 0;
    const desired = Math.atan2(point.y - this.vehicle.y, point.x - this.vehicle.x);
    return clamp(angleDelta(desired, this.vehicle.heading) * 2.2, -1, 1);
  }

  recordTrail(force = false) {
    const vehicle = this.vehicle;
    const last = this.lastTrailPose;
    if (!force && last && Math.hypot(vehicle.x - last.x, vehicle.y - last.y) < 3.6) return;
    if (!force && last && Math.abs(angleDelta(vehicle.heading, last.heading)) < 0.015) {
      const distance = Math.hypot(vehicle.x - last.x, vehicle.y - last.y);
      if (distance < 3.6) return;
    }
    const rightX = Math.cos(vehicle.heading + Math.PI / 2);
    const rightY = Math.sin(vehicle.heading + Math.PI / 2);
    const halfGauge = 11.5;
    this.trail.push({
      x: vehicle.x,
      y: vehicle.y,
      heading: vehicle.heading,
      leftX: vehicle.x - rightX * halfGauge,
      leftY: vehicle.y - rightY * halfGauge,
      rightX: vehicle.x + rightX * halfGauge,
      rightY: vehicle.y + rightY * halfGauge,
      speed: vehicle.speed
    });
    if (this.trail.length > 2800) this.trail.splice(0, this.trail.length - 2800);
    this.lastTrailPose = { x: vehicle.x, y: vehicle.y, heading: vehicle.heading };
  }

  getBrakeDistance() {
    const speed = Math.abs(this.vehicle.speed);
    const handling = this.handling();
    return (speed * speed) / (2 * Math.max(1, handling.brake));
  }

  getDisplayMass() {
    return (4.8 + this.vehicle.aboard.length * 0.72).toFixed(1);
  }

  getStatusLabel() {
    if (this.mode === "lost") return "落水";
    if (this.mode === "won") return "返岸";
    const speed = Math.abs(this.vehicle.speed);
    if (this.vehicle.braking) return "急刹";
    if (speed > 140) return "高速";
    if (speed > 35) return "行进";
    if (speed > 1) return "缓行";
    return "待命";
  }

  snapshot() {
    return {
      mode: this.mode,
      elapsed: this.elapsed,
      elapsedLabel: formatTime(this.elapsed),
      safeCount: this.safeCount,
      order: [...this.order],
      orderNames: this.order.map((id) => this.survivors.find((person) => person.id === id)?.name || id),
      vehicle: { ...this.vehicle, aboard: [...this.vehicle.aboard] },
      survivors: this.survivors.map((person) => ({ ...person })),
      localStress: this.lastIce?.localStress || 0,
      support: this.lastIce?.support ?? 100,
      peakStress: this.peakStress,
      riskTimer: this.riskTimer,
      crackLength: this.ice.getCrackLength(),
      crackGrowth: this.ice.getCrackLength() - this.initialCrackLength,
      crackCount: this.ice.getCrackCount(),
      brakeDistance: this.getBrakeDistance(),
      events: this.events
    };
  }
}

export function driveToward(sim, point, options = {}) {
  const distance = Math.hypot(point.x - sim.vehicle.x, point.y - sim.vehicle.y);
  const arriveRadius = options.arriveRadius || 24;
  const slowRadius = options.slowRadius || 140;
  let drive = 1;
  if (Math.abs(sim.vehicle.speed) > (options.maxSpeed || 999)) drive = 0;
  if (distance < slowRadius && Math.abs(sim.vehicle.speed) > 38) drive = -1;
  if (distance < arriveRadius) drive = 0;
  return {
    drive,
    steer: sim.setWaypointSteering(point),
    brake: distance < arriveRadius
  };
}
