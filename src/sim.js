import {
  CHARGERS,
  FIXED_STARTS,
  PRIORITIES,
  RING_CELLS,
  RING_TRIGGER_SECONDS,
  SHIFT_SECONDS,
  STATIONS,
  SUCCESS_RATE,
  TASK_COUNT,
  TICK_SECONDS,
  createFixedTasks,
  isRackCell,
  stationById,
} from "./config.js";
import {
  cellKey,
  findPath,
  nearestFreeCell,
  shortenPathThroughNoGo,
} from "./pathfinding.js";

const CHARGE_RATE = 2.1;
const CHARGE_TARGET = 88;
const LOW_BATTERY = 24;
const MOVE_COST = 0.25;
const IDLE_DRAIN = 0.014;

export class WarehouseSim {
  constructor() {
    this.speed = 4;
    this.running = true;
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.accumulator = 0;
    this.tasks = createFixedTasks();
    this.robots = FIXED_STARTS.map((start, index) => ({
      id: `R${String(index + 1).padStart(2, "0")}`,
      x: start.x,
      y: start.y,
      home: { x: start.x, y: start.y },
      fromX: start.x,
      fromY: start.y,
      moveStarted: -10,
      battery: start.battery,
      route: [],
      state: "idle",
      taskId: null,
      chargerId: null,
      waitTicks: 0,
      totalWaitTicks: 0,
      dwellUntil: 0,
      trail: [{ x: start.x, y: start.y }],
      low: false,
      stranded: false,
      ringReturn: null,
      blockLoggedAt: -100,
      holdUntil: 0,
    }));
    this.chargers = CHARGERS.map((charger) => ({
      ...charger,
      state: "free",
      robotId: null,
      queue: [],
      completed: 0,
    }));
    this.noGo = new Set();
    this.stationReservations = new Map();
    this.rules = {
      loopYield: false,
      lowBattery: true,
      fairQueue: true,
    };
    this.stats = {
      done: 0,
      deadlocks: 0,
      resolvedDeadlocks: 0,
      finished: false,
      success: false,
      endReason: null,
    };
    this.deadlockActive = null;
    this.deadlockCooldownUntil = 0;
    this.scriptedRingTriggered = false;
    this.eventLog = [];
    this.uiVersion = 0;
    this.running = true;
    this.speed = 4;
    this.accumulator = 0;
    this.log("班次启动，12 台机器人完成自检。", "normal");
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener(this));
  }

  log(text, tone = "normal", time = this.elapsed) {
    this.eventLog.unshift({ text, tone, time });
    this.eventLog = this.eventLog.slice(0, 30);
    this.uiVersion += 1;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  setRunning(running) {
    this.running = running;
  }

  setRule(rule, enabled) {
    this.rules[rule] = enabled;
    if (rule === "fairQueue" && enabled) this.reorderChargingQueues();
    if (rule === "loopYield" && enabled && this.deadlockActive) {
      this.resolveDeadlock("manual_rule");
    }
    this.uiVersion += 1;
  }

  update(realDeltaSeconds) {
    if (!this.running || this.stats.finished) return;
    const scaled = Math.min(realDeltaSeconds, 0.12) * this.speed;
    this.elapsed = Math.min(SHIFT_SECONDS, this.elapsed + scaled);
    this.accumulator += scaled;

    let iterations = 0;
    while (this.accumulator >= TICK_SECONDS && iterations < 24) {
      this.tick();
      this.accumulator -= TICK_SECONDS;
      iterations += 1;
    }

    if (this.elapsed >= SHIFT_SECONDS) this.finishShift("timeout");
  }

  tick() {
    this.triggerScheduledEvents();
    this.triggerLowBatteryRecovery();
    this.assignTasks();
    this.advanceCharging();
    this.moveRobots();
    this.handleArrivals();
    this.detectDeadlock();
    if (this.rules.loopYield && this.deadlockActive) {
      this.resolveDeadlock("policy");
    }

    for (const robot of this.robots) {
      if (robot.state === "idle" || robot.state === "ring") {
        robot.battery = Math.max(0, robot.battery - IDLE_DRAIN * TICK_SECONDS);
      }
      robot.low = robot.battery < LOW_BATTERY;
    }

    if (this.stats.done >= TASK_COUNT) this.finishShift("all_done");
  }

  triggerScheduledEvents() {
    if (
      !this.scriptedRingTriggered &&
      this.elapsed >= RING_TRIGGER_SECONDS
    ) {
      this.scriptedRingTriggered = true;
      this.forceRingWait();
    }
  }

  taskForRobot(robot) {
    return robot.taskId ? this.tasks.find((task) => task.id === robot.taskId) : null;
  }

  reserve(task) {
    this.stationReservations.set(task.sourceId, task.id);
    this.stationReservations.set(task.destId, task.id);
  }

  releaseStation(stationId, taskId) {
    if (this.stationReservations.get(stationId) === taskId) {
      this.stationReservations.delete(stationId);
    }
  }

  assignTasks() {
    const now = this.elapsed;
    const idleRobots = this.robots.filter(
      (robot) => robot.state === "idle" && !robot.stranded,
    );
    if (!idleRobots.length) return;

    const available = this.tasks
      .filter(
        (task) =>
          task.status === "pending" &&
          task.scheduled <= now &&
          !this.stationReservations.has(task.sourceId) &&
          !this.stationReservations.has(task.destId),
      )
      .sort((a, b) => a.priority - b.priority || a.scheduled - b.scheduled);

    for (const task of available) {
      if (this.stationReservations.has(task.sourceId)) continue;
      if (this.stationReservations.has(task.destId)) continue;

      let bestRobot = null;
      let bestPath = null;
      let bestDistance = Infinity;

      for (const robot of idleRobots) {
        if (this.rules.lowBattery && robot.battery < LOW_BATTERY + 5) continue;
        if (robot.stranded) continue;
        const path = findPath(robot, task.source, this.noGo);
        if (!path || path.length >= bestDistance) continue;
        bestRobot = robot;
        bestPath = path;
        bestDistance = path.length;
      }

      if (!bestRobot) break;

      this.reserve(task);
      task.status = "assigned";
      task.robotId = bestRobot.id;
      task.startedAt = now;
      task.progress = 0.04;
      bestRobot.taskId = task.id;
      bestRobot.state = "pickup";
      bestRobot.route = bestPath;
      bestRobot.dwellUntil = 0;
      bestRobot.waitTicks = 0;
      idleRobots.splice(idleRobots.indexOf(bestRobot), 1);
      this.uiVersion += 1;
      if (!idleRobots.length) break;
    }
  }

  triggerLowBatteryRecovery() {
    for (const robot of this.robots) {
      if (robot.state !== "idle") continue;
      const threshold = this.rules.lowBattery ? LOW_BATTERY : 7;
      if (robot.battery < threshold) this.beginCharging(robot);
    }
  }

  beginCharging(robot) {
    if (!robot || robot.state !== "idle") return false;
    let best = null;
    let bestPath = null;
    let bestCost = Infinity;

    for (const charger of this.chargers) {
      const path = findPath(robot, charger.approach, this.noGo);
      if (!path) continue;
      const cost = path.length * 1000 + charger.queue.length * 0.01;
      if (cost < bestCost) {
        best = charger;
        bestPath = path;
        bestCost = cost;
      }
    }

    if (!best) {
      if (this.elapsed - robot.blockLoggedAt > 12) {
        this.log(`${robot.id} 无法抵达充电道，等待通道开放。`, "alert");
        robot.blockLoggedAt = this.elapsed;
      }
      return false;
    }

    best.queue.push(robot.id);
    robot.chargerId = best.id;
    robot.state = "toCharge";
    robot.route = bestPath;
    robot.waitTicks = 0;
    robot.dwellUntil = 0;
    this.log(
      `${robot.id} 电量 ${Math.round(robot.battery)}%，走最短路径前往 ${best.id}。`,
      "charge",
    );
    return true;
  }

  advanceCharging() {
    for (const charger of this.chargers) {
      if (charger.state === "charging" && charger.robotId) {
        const robot = this.robots.find((item) => item.id === charger.robotId);
        if (!robot) continue;
        robot.battery = Math.min(CHARGE_TARGET, robot.battery + CHARGE_RATE * TICK_SECONDS);
        if (robot.battery >= CHARGE_TARGET) this.finishCharging(charger, robot);
      }
    }
  }

  finishCharging(charger, robot) {
    charger.state = "free";
    charger.robotId = null;
    charger.queue = charger.queue.filter((id) => id !== robot.id);
    charger.completed += 1;
    robot.state = "idle";
    robot.chargerId = null;
    robot.route = [];
    robot.waitTicks = 0;
    robot.battery = CHARGE_TARGET;
    this.sendToStaging(robot);
    this.log(`${robot.id} 充电完成，电量恢复至 ${CHARGE_TARGET}%。`, "charge");

    const nextId = charger.queue[0];
    const nextRobot = this.robots.find((item) => item.id === nextId);
    if (nextRobot && nextRobot.route.length === 0) this.startCharging(charger, nextRobot);
  }

  startCharging(charger, robot) {
    if (charger.state !== "free" || charger.queue[0] !== robot.id) return false;
    if (robot.x !== charger.approach.x || robot.y !== charger.approach.y) return false;
    if (
      this.robots.some(
        (other) =>
          other.id !== robot.id &&
          other.x === charger.bay.x &&
          other.y === charger.bay.y,
      )
    ) {
      return false;
    }
    charger.state = "charging";
    charger.robotId = robot.id;
    robot.fromX = robot.x;
    robot.fromY = robot.y;
    robot.x = charger.bay.x;
    robot.y = charger.bay.y;
    robot.moveStarted = this.elapsed;
    robot.state = "charging";
    robot.route = [];
    robot.waitTicks = 0;
    return true;
  }

  reorderChargingQueues() {
    for (const charger of this.chargers) {
      if (!this.rules.fairQueue) {
        charger.queue.sort((a, b) => {
          const robotA = this.robots.find((robot) => robot.id === a);
          const robotB = this.robots.find((robot) => robot.id === b);
          return (robotA?.battery ?? 100) - (robotB?.battery ?? 100);
        });
      }
    }
  }

  moveRobots() {
    const occupancy = new Map();
    for (const robot of this.robots) occupancy.set(cellKey(robot.x, robot.y), robot);

    for (const robot of this.robots) {
      if (!robot.route.length || robot.state === "charging") continue;
      if (robot.holdUntil > this.elapsed) continue;
      if (robot.route.some((cell) => shortenPathThroughNoGo([cell], this.noGo))) {
        this.replanRobot(robot);
        if (!robot.route.length) continue;
      }

      const next = robot.route[0];
      const occupant = occupancy.get(cellKey(next.x, next.y));
      if (occupant && occupant.id !== robot.id) {
        robot.waitTicks += 1;
        robot.totalWaitTicks += 1;
        if (occupant.state === "idle" && robot.waitTicks >= 2) {
          this.moveIdleAside(occupant, occupancy);
        }
        if (robot.waitTicks >= 2 && robot.waitTicks % 3 === 0) {
          this.replanAroundTraffic(robot);
        }
        if (
          robot.waitTicks >= 10 &&
          !this.deadlockActive &&
          robot.state !== "ring"
        ) {
          this.breakLocalJam(robot, occupancy);
        }
        continue;
      }

      occupancy.delete(cellKey(robot.x, robot.y));
      robot.fromX = robot.x;
      robot.fromY = robot.y;
      robot.x = next.x;
      robot.y = next.y;
      robot.moveStarted = this.elapsed;
      robot.route.shift();
      robot.battery = Math.max(0, robot.battery - MOVE_COST);
      robot.waitTicks = 0;
      occupancy.set(cellKey(robot.x, robot.y), robot);

      const lastTrail = robot.trail[robot.trail.length - 1];
      if (!lastTrail || lastTrail.x !== robot.x || lastTrail.y !== robot.y) {
        robot.trail.push({ x: robot.x, y: robot.y });
        robot.trail = robot.trail.slice(-20);
      }

      if (robot.battery <= 0 && robot.state !== "charging") {
        robot.stranded = true;
        robot.state = "stranded";
        robot.route = [];
        this.log(`${robot.id} 电量耗尽，等待救援。`, "alert");
      }
    }
  }

  handleArrivals() {
    for (const robot of this.robots) {
      if (robot.route.length > 0 || robot.state === "charging") continue;
      const task = this.taskForRobot(robot);

      if (robot.state === "pickup" && task) {
        const source = stationById(task.sourceId);
        if (robot.x !== source.x || robot.y !== source.y) {
          this.replanRobot(robot);
          continue;
        }
        task.status = "carrying";
        task.progress = 0.42;
        this.releaseStation(task.sourceId, task.id);
        robot.state = "drop";
        robot.route = findPath(robot, task.dest, this.noGo) ?? [];
        if (!robot.route.length && (robot.x !== task.dest.x || robot.y !== task.dest.y)) {
          this.log(`${robot.id} 至 ${task.id} 卸货点路径中断。`, "alert");
        }
        continue;
      }

      if (robot.state === "drop" && task) {
        if (robot.x !== task.dest.x || robot.y !== task.dest.y) {
          this.replanRobot(robot);
          continue;
        }
        task.status = "done";
        task.completedAt = this.elapsed;
        task.progress = 1;
        this.stats.done += 1;
        this.releaseStation(task.destId, task.id);
        robot.taskId = null;
        robot.state = "idle";
        robot.route = [];
        robot.dwellUntil = 0;
        if (
          robot.battery < (this.rules.lowBattery ? LOW_BATTERY : 7)
        ) {
          this.beginCharging(robot);
        } else {
          this.sendToStaging(robot);
        }
        this.uiVersion += 1;
        this.log(
          `${task.id} 完成：${task.sourceId} → ${task.destId}（${PRIORITIES[task.priority].label}）`,
          "success",
        );
        continue;
      }

      if (robot.state === "toCharge" || robot.state === "chargeQueue") {
        const charger = this.chargers.find((item) => item.id === robot.chargerId);
        if (charger) this.startCharging(charger, robot);
        continue;
      }

      if (robot.state === "returning") {
        robot.state = "idle";
        continue;
      }

      if (robot.state === "ring" && !this.deadlockActive) {
        this.resumeFromRing(robot);
      }
    }
  }

  goalForRobot(robot) {
    const task = this.taskForRobot(robot);
    if (robot.state === "pickup" && task) return task.source;
    if (robot.state === "drop" && task) return task.dest;
    if (robot.state === "toCharge" || robot.state === "chargeQueue") {
      const charger = this.chargers.find((item) => item.id === robot.chargerId);
      return charger ? charger.approach : null;
    }
    if (robot.state === "returning") return robot.home;
    return null;
  }

  sendToStaging(robot) {
    if (!robot.home) return;
    if (robot.x === robot.home.x && robot.y === robot.home.y) {
      robot.state = "idle";
      return;
    }
    const path = findPath(robot, robot.home, this.noGo);
    if (path) {
      robot.route = path;
      robot.state = "returning";
      return;
    }
    const occupied = new Set(this.robots.map((item) => cellKey(item.x, item.y)));
    const parking = nearestFreeCell(robot, this.noGo, occupied);
    if (parking) {
      robot.route = findPath(robot, parking, this.noGo) ?? [];
      robot.state = robot.route.length ? "returning" : "idle";
    } else {
      robot.state = "idle";
    }
  }

  replanRobot(robot) {
    const goal = this.goalForRobot(robot);
    if (!goal) return false;
    const path = findPath(robot, goal, this.noGo);
    if (!path) {
      robot.route = [];
      if (this.elapsed - robot.blockLoggedAt > 10) {
        this.log(`${robot.id} 的路径被禁行区截断，等待调度。`, "alert");
        robot.blockLoggedAt = this.elapsed;
      }
      return false;
    }
    robot.route = path;
    return true;
  }

  replanAroundTraffic(robot) {
    const goal = this.goalForRobot(robot);
    if (!goal) return false;
    const blocked = new Set(this.noGo);
    for (const other of this.robots) {
      if (other.id !== robot.id) blocked.add(cellKey(other.x, other.y));
    }
    const path = findPath(robot, goal, blocked);
    if (!path || !path.length) return false;
    robot.route = path;
    robot.waitTicks = Math.max(0, robot.waitTicks - 1);
    return true;
  }

  occupiedEquipment() {
    const blocked = new Set();
    for (const station of STATIONS) blocked.add(cellKey(station.x, station.y));
    for (const charger of CHARGERS) {
      blocked.add(cellKey(charger.approach.x, charger.approach.y));
      blocked.add(cellKey(charger.bay.x, charger.bay.y));
    }
    return blocked;
  }

  moveIdleAside(robot, occupancy) {
    if (robot.state !== "idle") return false;
    const equipment = this.occupiedEquipment();
    const blocked = new Set([...this.noGo, ...equipment]);
    const occupied = new Set(occupancy.keys());
    occupied.delete(cellKey(robot.x, robot.y));
    const safe = nearestFreeCell(robot, blocked, occupied);
    if (!safe) return false;
    robot.fromX = robot.x;
    robot.fromY = robot.y;
    robot.x = safe.x;
    robot.y = safe.y;
    robot.moveStarted = this.elapsed;
    robot.holdUntil = this.elapsed + 1.2;
    robot.trail.push({ ...safe });
    robot.trail = robot.trail.slice(-20);
    occupancy.delete(cellKey(robot.fromX, robot.fromY));
    occupancy.set(cellKey(safe.x, safe.y), robot);
    return true;
  }

  breakLocalJam(robot, occupancy) {
    const equipment = this.occupiedEquipment();
    const blocked = new Set([...this.noGo, ...equipment]);
    const occupied = new Set(occupancy.keys());
    occupied.delete(cellKey(robot.x, robot.y));
    const safe = nearestFreeCell(robot, blocked, occupied);
    if (!safe) return false;
    robot.fromX = robot.x;
    robot.fromY = robot.y;
    robot.x = safe.x;
    robot.y = safe.y;
    robot.moveStarted = this.elapsed;
    robot.waitTicks = 0;
    robot.holdUntil = this.elapsed + 1.1;
    robot.trail.push({ ...safe });
    robot.trail = robot.trail.slice(-20);
    occupancy.delete(cellKey(robot.fromX, robot.fromY));
    occupancy.set(cellKey(safe.x, safe.y), robot);
    this.replanRobot(robot);
    if (this.elapsed - robot.blockLoggedAt > 18) {
      this.log(`${robot.id} 检测到局部顶死，倒车让行并重新规划。`, "fixed");
      robot.blockLoggedAt = this.elapsed;
    }
    return true;
  }

  applyNoGoChange() {
    for (const robot of this.robots) {
      if (robot.route.length && robot.route.some((cell) => this.noGo.has(cellKey(cell.x, cell.y)))) {
        this.replanRobot(robot);
      }
    }
  }

  toggleNoGo(x, y) {
    const key = cellKey(x, y);
    if (this.noGo.has(key)) {
      this.noGo.delete(key);
      this.applyNoGoChange();
      this.log(`解除禁行格 ${x + 1}-${y + 1}。`, "fixed");
      this.uiVersion += 1;
      return true;
    }

    if (isRackCell(x, y)) return false;
    if (this.robots.some((robot) => robot.x === x && robot.y === y)) return false;
    const isEquipment =
      STATIONS.some((station) => station.x === x && station.y === y) ||
      CHARGERS.some(
        (charger) =>
          (charger.bay.x === x && charger.bay.y === y) ||
          (charger.approach.x === x && charger.approach.y === y),
      );
    if (isEquipment) return false;

    this.noGo.add(key);
    this.applyNoGoChange();
    this.log(`布设临时禁行格 ${x + 1}-${y + 1}，相关车辆重新寻路。`, "fixed");
    this.uiVersion += 1;
    return true;
  }

  clearNoGo() {
    if (!this.noGo.size) return;
    this.noGo.clear();
    this.applyNoGoChange();
    this.log("临时禁行区已全部清除。", "fixed");
    this.uiVersion += 1;
  }

  jumpTo(targetSeconds) {
    const target = Math.max(0, Math.min(SHIFT_SECONDS - 10, targetSeconds));
    if (target <= this.elapsed) return false;
    this.elapsed = target;
    this.accumulator = 0;
    this.scriptedRingTriggered = false;
    this.deadlockActive = null;
    this.stats.finished = false;
    this.rules.loopYield = false;
    this.log("跳转至 02:10，02:15 将注入固定环形等待压力样本。", "fixed");
    this.uiVersion += 1;
    return true;
  }

  forceRingWait() {
    const selected = [];
    const seen = new Set();

    for (const cell of RING_CELLS) {
      const occupant = this.robots.find(
        (robot) =>
          robot.x === cell.x &&
          robot.y === cell.y &&
          !robot.chargerId &&
          !robot.stranded &&
          !seen.has(robot.id),
      );
      if (occupant) {
        selected.push(occupant);
        seen.add(occupant.id);
      }
    }

    const fallback = this.robots.filter(
      (robot) => !robot.chargerId && !robot.stranded && !seen.has(robot.id),
    );
    for (const robot of fallback) {
      if (selected.length >= RING_CELLS.length) break;
      selected.push(robot);
      seen.add(robot.id);
    }

    if (selected.length < RING_CELLS.length) return;
    const ringRobots = selected.slice(0, RING_CELLS.length);

    ringRobots.forEach((robot, index) => {
      robot.ringReturn = {
        state: robot.state,
        taskId: robot.taskId,
        chargerId: robot.chargerId,
      };
      const cell = RING_CELLS[index];
      const next = RING_CELLS[(index + 1) % RING_CELLS.length];
      robot.fromX = cell.x;
      robot.fromY = cell.y;
      robot.x = cell.x;
      robot.y = cell.y;
      robot.moveStarted = -10;
      robot.route = [{ ...next }];
      robot.state = "ring";
      robot.dwellUntil = 0;
      robot.waitTicks = 15;
      robot.totalWaitTicks += 15;
      robot.trail.push({ ...cell });
      robot.trail = robot.trail.slice(-20);
    });

    this.createDeadlock(
      ringRobots.map((robot) => robot.id),
      "scripted",
    );
    this.log(
      `压力样本命中：${ringRobots.map((robot) => robot.id).join(" → ")} 形成闭环等待。`,
      "alert",
    );
  }

  createDeadlock(robotIds, scenario = "dynamic") {
    if (this.deadlockActive) return;
    this.stats.deadlocks += 1;
    const snapshots = {};
    for (const id of robotIds) {
      const robot = this.robots.find((item) => item.id === id);
      if (!robot) continue;
      snapshots[id] = robot.ringReturn ?? {
        state: robot.state,
        taskId: robot.taskId,
        chargerId: robot.chargerId,
      };
    }
    this.deadlockActive = {
      id: `DL-${this.stats.deadlocks}`,
      robotIds,
      detectedAt: this.elapsed,
      scenario,
      snapshots,
    };
    this.uiVersion += 1;
    this.notify();
  }

  detectDeadlock() {
    if (
      this.deadlockActive ||
      !this.scriptedRingTriggered ||
      this.elapsed < this.deadlockCooldownUntil
    ) {
      return;
    }

    const occupancy = new Map();
    for (const robot of this.robots) {
      occupancy.set(cellKey(robot.x, robot.y), robot);
    }
    const waitingFor = new Map();
    for (const robot of this.robots) {
      if (!robot.route.length || robot.state === "charging") continue;
      const next = robot.route[0];
      const occupant = occupancy.get(cellKey(next.x, next.y));
      if (occupant && occupant.id !== robot.id) waitingFor.set(robot.id, occupant.id);
    }

    const visited = new Set();
    for (const robot of this.robots) {
      if (visited.has(robot.id) || !waitingFor.has(robot.id)) continue;
      const path = [];
      const localIndex = new Map();
      let cursor = robot.id;
      let cycle = null;

      while (cursor && !visited.has(cursor)) {
        if (localIndex.has(cursor)) {
          cycle = path.slice(localIndex.get(cursor));
          break;
        }
        localIndex.set(cursor, path.length);
        path.push(cursor);
        cursor = waitingFor.get(cursor);
      }
      path.forEach((id) => visited.add(id));
      if (!cycle || cycle.length < 2) continue;

      const waitingEnough = cycle.every((id) => {
        const member = this.robots.find((item) => item.id === id);
        return (member?.waitTicks ?? 0) >= 4;
      });
      if (waitingEnough) {
        this.createDeadlock(cycle, "dynamic");
        this.log(`检测到动态环形等待：${cycle.join(" → ")}。`, "alert");
        return;
      }
    }
  }

  resolveDeadlock(reason = "policy") {
    const active = this.deadlockActive;
    if (!active) return false;

    const entries = active.robotIds
      .map((id) => {
        const robot = this.robots.find((item) => item.id === id);
        if (!robot) return null;
        return {
          robot,
          saved: robot.ringReturn ?? active.snapshots[id] ?? {
            state: robot.state,
            taskId: robot.taskId,
            chargerId: robot.chargerId,
          },
        };
      })
      .filter(Boolean);
    if (!entries.length) return false;

    const priorityOf = (entry) => {
      const task = entry.saved.taskId
        ? this.tasks.find((item) => item.id === entry.saved.taskId)
        : null;
      return task?.priority ?? 4;
    };
    entries.sort((a, b) => priorityOf(b) - priorityOf(a));
    const yielding = entries[0];

    const occupied = new Set(this.robots.map((robot) => cellKey(robot.x, robot.y)));
    occupied.delete(cellKey(yielding.robot.x, yielding.robot.y));
    const safe = nearestFreeCell(yielding.robot, this.noGo, occupied);
    if (safe) {
      yielding.robot.fromX = yielding.robot.x;
      yielding.robot.fromY = yielding.robot.y;
      yielding.robot.x = safe.x;
      yielding.robot.y = safe.y;
      yielding.robot.moveStarted = this.elapsed;
      yielding.robot.trail.push({ ...safe });
      yielding.robot.trail = yielding.robot.trail.slice(-20);
    }
    yielding.robot.holdUntil = this.elapsed + 2.4;

    for (const entry of entries) {
      const { robot, saved } = entry;
      robot.ringReturn = null;
      robot.state = saved.state;
      robot.taskId = saved.taskId;
      robot.chargerId = saved.chargerId;
      robot.waitTicks = 0;
      robot.dwellUntil = 0;
      const goal = this.goalForRobot(robot);
      robot.route = goal ? findPath(robot, goal, this.noGo) ?? [] : [];
    }

    this.deadlockActive = null;
    this.deadlockCooldownUntil = this.elapsed + 35;
    this.stats.resolvedDeadlocks += 1;
    this.uiVersion += 1;
    this.log(
      `${yielding.robot.id} 按低优先级让行规则退出环路，其余车辆恢复路径（${reason === "manual_rule" ? "手动启用" : "策略接管"}）。`,
      "fixed",
    );
    this.notify();
    return true;
  }

  resumeFromRing(robot) {
    const saved = robot.ringReturn;
    if (!saved) {
      robot.state = "idle";
      return;
    }
    robot.ringReturn = null;
    robot.state = saved.state;
    robot.taskId = saved.taskId;
    robot.chargerId = saved.chargerId;
    robot.waitTicks = 0;
    const goal = this.goalForRobot(robot);
    robot.route = goal ? findPath(robot, goal, this.noGo) ?? [] : [];
  }

  cyclePriority(taskId) {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task || task.status === "done") return;
    task.priority = (task.priority % 3) + 1;
    this.log(
      `${task.id} 优先级调整为 ${PRIORITIES[task.priority].code} · ${PRIORITIES[task.priority].label}。`,
      "fixed",
    );
    this.uiVersion += 1;
  }

  finishShift(reason) {
    if (this.stats.finished) return;
    this.stats.finished = true;
    this.running = false;
    const threshold = Math.ceil(TASK_COUNT * SUCCESS_RATE);
    const throughputOk = this.stats.done >= threshold;
    const deadlockOk = !this.deadlockActive;
    this.stats.success = throughputOk && deadlockOk;
    this.stats.endReason = !throughputOk
      ? "throughput"
      : !deadlockOk
        ? "deadlock"
        : reason;
    const verdict = this.stats.success ? "达标" : "未达标";
    this.log(
      `20:00 班次结束：${this.stats.done}/${TASK_COUNT}，${verdict}。`,
      this.stats.success ? "success" : "alert",
    );
    this.uiVersion += 1;
    this.notify();
  }

  statusText(robot) {
    const task = this.taskForRobot(robot);
    if (robot.state === "pickup" && task) return `前往 ${task.sourceId} 取货`;
    if (robot.state === "drop" && task) return `运往 ${task.destId} 卸货`;
    if (robot.state === "toCharge") return `前往 ${robot.chargerId} 充电`;
    if (robot.state === "chargeQueue") return `${robot.chargerId} 排队`;
    if (robot.state === "charging") return `${robot.chargerId} 充电中`;
    if (robot.state === "ring") return "环路等待";
    if (robot.state === "returning") return "返回泊位";
    if (robot.state === "stranded") return "电量耗尽";
    return "待命 / 等单";
  }

  get completionRate() {
    return this.stats.done / TASK_COUNT;
  }

  get density() {
    const active = this.robots.filter(
      (robot) => robot.taskId || robot.chargerId || robot.state === "ring",
    ).length;
    return active / this.robots.length;
  }

  get averageBattery() {
    return (
      this.robots.reduce((sum, robot) => sum + robot.battery, 0) /
      this.robots.length
    );
  }

  get averageWaitSeconds() {
    const wait = this.robots.reduce((sum, robot) => sum + robot.waitTicks, 0);
    return (wait / this.robots.length) * TICK_SECONDS;
  }

  get chargingQueueCount() {
    return this.chargers.reduce(
      (sum, charger) => sum + charger.queue.length + (charger.state === "charging" ? 1 : 0),
      0,
    );
  }

  get openTaskCount() {
    return this.tasks.filter((task) => task.status !== "done").length;
  }

  robotAt(x, y) {
    return this.robots.find((robot) => robot.x === x && robot.y === y) ?? null;
  }
}
