(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StationSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAP = { width: 1200, height: 720 };
  const MISSION_SECONDS = 15 * 60;
  const LITERS_PER_CM = 480;

  const NODES = {
    platform1: { x: 345, y: 688, label: "1号站台梯" },
    platform2: { x: 855, y: 688, label: "2号站台梯" },
    paid1: { x: 345, y: 585, label: "付费区西" },
    paid2: { x: 855, y: 585, label: "付费区东" },
    paidCore: { x: 620, y: 555, label: "付费区中" },
    westCorr: { x: 178, y: 500, label: "西侧通道" },
    westExit: { x: 78, y: 403, label: "西侧出口" },
    gateBus1: { x: 430, y: 462, label: "G1 闸机前" },
    gate1: { x: 430, y: 374, label: "G1 闸机后" },
    gateBus2: { x: 835, y: 462, label: "G2 闸机前" },
    gate2: { x: 835, y: 374, label: "G2 闸机后" },
    unpaid1: { x: 345, y: 306, label: "非付费区西" },
    unpaid2: { x: 855, y: 306, label: "非付费区东" },
    unpaidCore: { x: 620, y: 296, label: "非付费区中" },
    barrierA: { x: 345, y: 176, label: "A 入口挡水板" },
    exitA: { x: 345, y: 74, label: "A 北侧出口" },
    barrierB: { x: 875, y: 176, label: "B 入口挡水板" },
    exitB: { x: 875, y: 74, label: "B 东侧出口" }
  };

  const EDGES = [
    { id: "stair1", from: "platform1", to: "paid1", cap: 5.2, critical: "1号站台梯" },
    { id: "stair2", from: "platform2", to: "paid2", cap: 5.2, critical: "2号站台梯" },
    { id: "paid-west-core", from: "paid1", to: "paidCore", cap: 26 },
    { id: "paid-east-core", from: "paid2", to: "paidCore", cap: 26 },
    { id: "paid1-gate1", from: "paid1", to: "gateBus1", cap: 15 },
    { id: "paid2-gate2", from: "paid2", to: "gateBus2", cap: 15 },
    { id: "gate1", from: "gateBus1", to: "gate1", cap: 4.5, critical: "西闸机组", gate: "1" },
    { id: "gate2", from: "gateBus2", to: "gate2", cap: 4.5, critical: "东闸机组", gate: "2" },
    { id: "gate1-west", from: "gate1", to: "unpaid1", cap: 13 },
    { id: "gate1-core", from: "gate1", to: "unpaidCore", cap: 13 },
    { id: "gate2-east", from: "gate2", to: "unpaid2", cap: 13 },
    { id: "gate2-core", from: "gate2", to: "unpaidCore", cap: 13 },
    { id: "unpaid-west-core", from: "unpaid1", to: "unpaidCore", cap: 18 },
    { id: "unpaid-east-core", from: "unpaid2", to: "unpaidCore", cap: 18 },
    { id: "unpaid1-a", from: "unpaid1", to: "barrierA", cap: 7 },
    { id: "unpaid-core-a", from: "unpaidCore", to: "barrierA", cap: 7 },
    { id: "unpaid2-b", from: "unpaid2", to: "barrierB", cap: 7 },
    { id: "unpaid-core-b", from: "unpaidCore", to: "barrierB", cap: 7 },
    { id: "exitA", from: "barrierA", to: "exitA", cap: 3, critical: "A 北侧出口", barrier: "a", exit: "A" },
    { id: "exitB", from: "barrierB", to: "exitB", cap: 3, critical: "B 东侧出口", barrier: "b", exit: "B" },
    { id: "west-paid1", from: "paid1", to: "westCorr", cap: 9 },
    { id: "west-core", from: "paidCore", to: "westCorr", cap: 7 },
    { id: "westExit", from: "westCorr", to: "westExit", cap: 1.8, critical: "西侧窄出口", exit: "W" }
  ];

  const BARRIER_CAP = { open: 3, half: 1.1, closed: 0 };
  const BARRIER_LABEL = { open: "开启", half: "半挡", closed: "全封" };
  const GATE_CAP = { exit: 4.5, entry: 0.8 };
  const GATE_LABEL = { exit: "出站", entry: "进站" };
  const PUMP_RATE = { off: 0, low: 7.5, high: 18 };
  const PUMP_LABEL = { off: "停", low: "低档", high: "高档" };
  const SPAWN_WAVES = [
    { at: 0, count: 140, label: "晚高峰站台客流" },
    { at: 35, count: 110, label: "上行列车到达" },
    { at: 100, count: 130, label: "下行列车到达" },
    { at: 185, count: 150, label: "换乘客流汇入" },
    { at: 290, count: 160, label: "末班车乘客到达" }
  ];
  const TOTAL_PASSENGERS = SPAWN_WAVES.reduce((sum, wave) => sum + wave.count, 0);

  function distance(a, b) {
    return Math.hypot(NODES[a].x - NODES[b].x, NODES[a].y - NODES[b].y);
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  const EDGE_BY_ID = Object.fromEntries(EDGES.map((edge) => [edge.id, edge]));
  const EDGE_BY_PAIR = Object.fromEntries(EDGES.map((edge) => [edge.from + ">" + edge.to, edge]));
  const OUT_EDGES = {};
  for (const edge of EDGES) {
    (OUT_EDGES[edge.from] || (OUT_EDGES[edge.from] = [])).push(edge);
  }

  const EXIT_NODES = { A: "exitA", B: "exitB", W: "westExit" };

  function createInitialControls() {
    return {
      barriers: { a: "half", b: "open" },
      transformerDoor: "sealed",
      pumps: {
        1: { setting: "off", heat: 42, tripped: false },
        2: { setting: "off", heat: 42, tripped: false }
      },
      gates: { 1: "entry", 2: "exit" }
    };
  }

  class Simulation {
    constructor(options) {
      const opts = options || {};
      this.time = 0;
      this.status = "ready";
      this.endReason = "";
      this.controls = createInitialControls();
      this.passengers = [];
      this.nextPassengerId = 1;
      this.spawned = 0;
      this.evacuated = 0;
      this.nextWave = 0;
      this.totalPassengers = TOTAL_PASSENGERS;
      this.queues = {};
      this.edgeTokens = {};
      for (const edge of EDGES) {
        this.queues[edge.id] = [];
        this.edgeTokens[edge.id] = 1;
      }
      this.water = { north: 0, paid: 0, transformer: 0 };
      this.risk = 8;
      this.peakRisk = 8;
      this.riskZone = "人群分布正常";
      this.riskWarned = false;
      this.riskCleared = false;
      this.logs = [];
      this.logSerial = 0;
      this.rainScale = 1;
      this.lastPumpFlow = { 1: 0, 2: 0 };
      this.stats = { pumpTrips: 0, reroutes: 0, maxQueue: 0, riskEvents: 0 };
      this.fastForward = Boolean(opts.fastForward);
      this.addLog("系统就绪：站厅 690 人，暴雨倒灌警报已发布。", "info");
    }

    addLog(message, level) {
      const item = {
        id: ++this.logSerial,
        time: this.time,
        clock: formatTime(this.time),
        message,
        level: level || "info"
      };
      this.logs.unshift(item);
      if (this.logs.length > 80) this.logs.length = 80;
      return item;
    }

    start() {
      if (this.status !== "ready") return false;
      this.status = "running";
      this.addLog("应急疏散启动。自动寻路已接管全部客流。", "good");
      return true;
    }

    setBarrier(id, state) {
      if (!this.controls.barriers[id] || !BARRIER_LABEL[state]) return false;
      if (this.status === "success" || this.status === "failed") return false;
      const before = this.controls.barriers[id];
      if (before === state) return false;
      this.controls.barriers[id] = state;
      this.addLog(
        "入口 " + id.toUpperCase() + " 挡水板由" + BARRIER_LABEL[before] + "调整为" + BARRIER_LABEL[state] + "。",
        state === "closed" ? "warn" : "info"
      );
      if (state === "closed") {
        const exitId = id === "a" ? "exitA" : "exitB";
        this.releaseDeadQueue(exitId);
      }
      return true;
    }

    setTransformerDoor(state) {
      if (state !== "sealed" && state !== "open") return false;
      if (this.status === "success" || this.status === "failed") return false;
      if (this.controls.transformerDoor === state) return false;
      this.controls.transformerDoor = state;
      this.addLog(
        state === "sealed" ? "变电室防水门已密封。" : "变电室防水门已开启，渗水风险上升。",
        state === "sealed" ? "good" : "danger"
      );
      return true;
    }

    setPump(id, setting) {
      const pump = this.controls.pumps[id];
      if (!pump || !PUMP_LABEL[setting]) return false;
      if (this.status === "success" || this.status === "failed") return false;
      if (pump.setting === setting) return false;
      pump.setting = setting;
      this.addLog(
        "排水泵 P" + id + " 调至" + PUMP_LABEL[setting] + (pump.tripped ? "（仍处于过热保护）" : "。"),
        setting === "high" ? "warn" : "info"
      );
      return true;
    }

    setGate(id, direction) {
      if (!this.controls.gates[id] || !GATE_LABEL[direction]) return false;
      if (this.status === "success" || this.status === "failed") return false;
      if (this.controls.gates[id] === direction) return false;
      this.controls.gates[id] = direction;
      this.addLog(
        (id === "1" ? "西" : "东") + "闸机组切换为" + GATE_LABEL[direction] + "方向。",
        direction === "exit" ? "good" : "warn"
      );
      return true;
    }

    getEdgeCapacity(edge) {
      if (!edge) return 0;
      if (edge.barrier) return BARRIER_CAP[this.controls.barriers[edge.barrier]];
      if (edge.gate) return GATE_CAP[this.controls.gates[edge.gate]];
      return edge.cap;
    }

    getPumpFlow(id) {
      const pump = this.controls.pumps[id];
      if (!pump || pump.tripped || pump.setting === "off") return 0;
      return PUMP_RATE[pump.setting];
    }

    releaseDeadQueue(edgeId) {
      const queue = this.queues[edgeId];
      if (!queue || !queue.length) return;
      const stranded = queue.splice(0, queue.length);
      for (const passenger of stranded) {
        passenger.state = "node";
        passenger.edgeId = null;
        this.planPassengerRoute(passenger);
      }
    }

    findEdge(from, to) {
      return EDGE_BY_PAIR[from + ">" + to] || null;
    }

    edgeCost(edge) {
      const cap = this.getEdgeCapacity(edge);
      if (cap <= 0) return Infinity;
      const base = distance(edge.from, edge.to) / 43;
      const queue = this.queues[edge.id] ? this.queues[edge.id].length : 0;
      const queueWeight = edge.critical ? 0.7 : 0.16;
      let cost = base + (queue / Math.max(0.5, cap)) * queueWeight;
      if (edge.gate && this.controls.gates[edge.gate] === "entry") cost += 12;
      if (edge.barrier && this.controls.barriers[edge.barrier] === "half") cost += 2.5;
      return cost;
    }

    planPassengerRoute(passenger) {
      if (passenger.state === "queued") this.detachFromQueue(passenger);
      passenger.state = "node";
      passenger.edgeId = null;
      const start = passenger.currentNode;
      const distances = {};
      const previous = {};
      const visited = {};
      for (const node of Object.keys(NODES)) distances[node] = Infinity;
      distances[start] = 0;

      for (let step = 0; step < Object.keys(NODES).length; step += 1) {
        let current = null;
        let best = Infinity;
        for (const node of Object.keys(NODES)) {
          if (!visited[node] && distances[node] < best) {
            best = distances[node];
            current = node;
          }
        }
        if (!current) break;
        visited[current] = true;
        const outgoing = OUT_EDGES[current] || [];
        for (const edge of outgoing) {
          const cost = this.edgeCost(edge);
          if (!Number.isFinite(cost)) continue;
          const candidate = distances[current] + cost;
          if (candidate < distances[edge.to]) {
            distances[edge.to] = candidate;
            previous[edge.to] = current;
          }
        }
      }

      let target = "W";
      let targetNode = EXIT_NODES.W;
      if (distances[EXIT_NODES.B] < distances[targetNode]) {
        target = "B";
        targetNode = EXIT_NODES.B;
      }
      if (distances[EXIT_NODES.A] < distances[targetNode]) {
        target = "A";
        targetNode = EXIT_NODES.A;
      }

      if (!Number.isFinite(distances[targetNode])) {
        passenger.route = [start];
        passenger.routeIndex = 0;
        passenger.target = "W";
        return false;
      }

      const route = [targetNode];
      let cursor = targetNode;
      while (cursor !== start) {
        cursor = previous[cursor];
        if (!cursor) {
          passenger.route = [start];
          passenger.routeIndex = 0;
          passenger.target = "W";
          return false;
        }
        route.unshift(cursor);
      }
      passenger.route = route;
      passenger.routeIndex = 0;
      passenger.target = target;
      return true;
    }

    detachFromQueue(passenger) {
      if (!passenger.edgeId) return;
      const queue = this.queues[passenger.edgeId];
      if (!queue) return;
      const index = queue.indexOf(passenger);
      if (index >= 0) queue.splice(index, 1);
      passenger.edgeId = null;
    }

    requestNextEdge(passenger) {
      if (passenger.state === "exited") return;
      const route = passenger.route || [];
      const nextNode = route[passenger.routeIndex + 1];
      if (!nextNode) {
        this.planPassengerRoute(passenger);
        if (!passenger.route || passenger.route.length < 2) return;
        this.requestNextEdge(passenger);
        return;
      }
      let edge = this.findEdge(passenger.currentNode, nextNode);
      if (!edge || this.getEdgeCapacity(edge) <= 0) {
        this.planPassengerRoute(passenger);
        edge = this.findEdge(passenger.currentNode, passenger.route[1]);
        if (!edge) return;
      }
      passenger.state = "queued";
      passenger.edgeId = edge.id;
      passenger.queueEnteredAt = this.time;
      this.queues[edge.id].push(passenger);
    }

    replanPassenger(passenger) {
      if (passenger.state === "moving" || passenger.state === "exited") return;
      this.detachFromQueue(passenger);
      const before = passenger.route && passenger.route[passenger.routeIndex + 1];
      this.planPassengerRoute(passenger);
      const after = passenger.route && passenger.route[1];
      if (before !== after) this.stats.reroutes += 1;
      if (passenger.route.length > 1) this.requestNextEdge(passenger);
    }

    spawnPassenger() {
      const id = this.nextPassengerId++;
      const westPlatform = (id * 37) % 100 < 48;
      const start = westPlatform ? "platform1" : "platform2";
      const node = NODES[start];
      const passenger = {
        id,
        currentNode: start,
        x: node.x + ((id * 13) % 9) - 4,
        y: node.y + ((id * 7) % 7) - 3,
        speed: 41 + (id % 8) * 0.75,
        state: "node",
        edgeId: null,
        progress: 0,
        route: [],
        routeIndex: 0,
        target: "W",
        queueEnteredAt: this.time,
        spawnedAt: this.time,
        stress: 0
      };
      this.passengers.push(passenger);
      this.planPassengerRoute(passenger);
      if (passenger.route.length > 1) this.requestNextEdge(passenger);
      this.spawned += 1;
      return passenger;
    }

    updateSpawns() {
      while (this.nextWave < SPAWN_WAVES.length && this.time >= SPAWN_WAVES[this.nextWave].at) {
        const wave = SPAWN_WAVES[this.nextWave];
        for (let index = 0; index < wave.count; index += 1) this.spawnPassenger();
        this.addLog(wave.label + "：" + wave.count + " 人进入站厅。", "info");
        this.nextWave += 1;
      }
    }

    completeEdge(passenger, edge) {
      passenger.currentNode = edge.to;
      passenger.routeIndex += 1;
      passenger.progress = 0;
      passenger.edgeId = null;
      if (edge.exit) {
        passenger.state = "exited";
        passenger.x = NODES[edge.to].x;
        passenger.y = NODES[edge.to].y;
        this.evacuated += 1;
        return;
      }
      passenger.state = "node";
      this.requestNextEdge(passenger);
    }

    updatePassengers(dt) {
      for (const passenger of this.passengers) {
        if (passenger.state !== "moving") continue;
        const edge = EDGE_BY_ID[passenger.edgeId];
        if (!edge) {
          passenger.state = "node";
          this.requestNextEdge(passenger);
          continue;
        }
        const from = NODES[edge.from];
        const to = NODES[edge.to];
        const length = Math.max(8, distance(edge.from, edge.to));
        passenger.progress += (passenger.speed * dt) / length;
        const t = clamp(passenger.progress, 0, 1);
        passenger.x = from.x + (to.x - from.x) * t;
        passenger.y = from.y + (to.y - from.y) * t;
        if (passenger.progress >= 1) this.completeEdge(passenger, edge);
      }
    }

    updateQueues(dt) {
      for (const edge of EDGES) {
        const queue = this.queues[edge.id];
        const capacity = this.getEdgeCapacity(edge);
        if (capacity <= 0) {
          if (queue.length) this.releaseDeadQueue(edge.id);
          continue;
        }
        this.edgeTokens[edge.id] = Math.min(
          2.5,
          this.edgeTokens[edge.id] + capacity * dt
        );
        while (this.edgeTokens[edge.id] >= 1 && queue.length) {
          const passenger = queue.shift();
          this.edgeTokens[edge.id] -= 1;
          passenger.state = "moving";
          passenger.progress = 0;
          passenger.x = NODES[edge.from].x;
          passenger.y = NODES[edge.from].y;
        }
      }
      this.layoutQueues();
    }

    layoutQueues() {
      for (const edge of EDGES) {
        const queue = this.queues[edge.id];
        if (!queue.length) continue;
        const from = NODES[edge.from];
        const to = NODES[edge.to];
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const backX = -Math.cos(angle);
        const backY = -Math.sin(angle);
        const sideX = Math.cos(angle + Math.PI / 2);
        const sideY = Math.sin(angle + Math.PI / 2);
        for (let index = 0; index < queue.length; index += 1) {
          const passenger = queue[index];
          const row = Math.floor(index / 9);
          const column = index % 9;
          const back = 11 + row * 7.2;
          const side = (column - 4) * 3.8 + ((passenger.id * 7) % 5 - 2) * 0.55;
          passenger.x = from.x + backX * back + sideX * side;
          passenger.y = from.y + backY * back + sideY * side;
          passenger.queueIndex = index;
        }
      }
    }

    updatePumps(dt, northHasWater, paidHasWater) {
      for (const id of ["1", "2"]) {
        const pump = this.controls.pumps[id];
        const hasWater = id === "1" ? northHasWater : paidHasWater;
        if (pump.tripped) {
          pump.heat = Math.max(25, pump.heat - 2.75 * dt);
          if (pump.heat <= 55) {
            pump.tripped = false;
            this.addLog("排水泵 P" + id + " 温度降至 55°C，过热保护解除。", "good");
          }
          continue;
        }
        if (pump.setting !== "off" && hasWater) {
          pump.heat += (pump.setting === "high" ? 2.55 : 0.58) * dt;
          if (pump.heat >= 100) {
            pump.heat = 100;
            pump.tripped = true;
            this.stats.pumpTrips += 1;
            this.addLog("排水泵 P" + id + " 持续过载，电机过热停机！", "danger");
          }
        } else {
          pump.heat = Math.max(25, pump.heat - 1.75 * dt);
        }
      }
    }

    updateHydrology(dt) {
      this.rainScale = 0.35 + 0.65 * Math.exp(-this.time / 720);
      const inflowA = { open: 30, half: 11, closed: 0.65 }[this.controls.barriers.a] * this.rainScale;
      const inflowB = { open: 21, half: 7.5, closed: 0.45 }[this.controls.barriers.b] * this.rainScale;
      this.lastInflow = { a: inflowA, b: inflowB };
      this.water.north += (inflowA + inflowB) * dt;

      this.updatePumps(dt, this.water.north > 1, this.water.paid > 1);

      const flow1 = this.getPumpFlow(1);
      const removed1 = Math.min(this.water.north, flow1 * dt);
      this.water.north -= removed1;
      this.lastPumpFlow[1] = dt > 0 ? removed1 / dt : 0;

      if (this.water.north > 3000) {
        this.stats.overflowSeen = true;
      }
      let spill = 0;
      if (this.water.north > 3000) {
        spill = Math.min(45, (this.water.north - 3000) * 0.006);
        const moved = Math.min(this.water.north - 3000, spill * dt);
        this.water.north -= moved;
        this.water.paid += moved;
      }
      this.lastSpill = dt > 0 ? spill : 0;

      const flow2 = this.getPumpFlow(2);
      const removed2 = Math.min(this.water.paid, flow2 * dt);
      this.water.paid -= removed2;
      this.lastPumpFlow[2] = dt > 0 ? removed2 / dt : 0;

      let transformerInflow = 0;
      if (this.controls.transformerDoor === "open") {
        transformerInflow = Math.min(26, this.water.paid * 0.006);
      } else if (this.water.paid > 1200) {
        transformerInflow = Math.min(20, (this.water.paid - 1200) * 0.008);
      }
      if (transformerInflow > 0) {
        this.water.transformer += transformerInflow * dt;
      }
      this.lastTransformerInflow = transformerInflow;
    }

    updateRisk(dt) {
      let largest = 0;
      let zone = "人群分布正常";
      for (const edge of EDGES) {
        if (!edge.critical) continue;
        const size = this.queues[edge.id].length;
        if (size > largest) {
          largest = size;
          zone = edge.critical;
        }
      }
      this.stats.maxQueue = Math.max(this.stats.maxQueue, largest);
      if (largest > 36) {
        this.risk += dt * (0.8 + (largest - 36) * 0.08);
        this.riskZone = zone + "拥堵";
      } else {
        this.risk -= dt * 3.2;
        if (largest < 10) this.riskZone = "人群分布正常";
      }
      this.risk = clamp(this.risk, 0, 100);
      this.peakRisk = Math.max(this.peakRisk, this.risk);
      if (this.risk >= 82 && !this.riskWarned) {
        this.riskWarned = true;
        this.riskCleared = false;
        this.stats.riskEvents += 1;
        this.addLog("高密度拥挤警报：" + zone + "形成回流，踩踏风险升至危险区。", "danger");
      }
      if (this.risk < 45 && this.riskWarned) {
        this.riskWarned = false;
        this.riskCleared = true;
      }
    }

    finish(status, reason) {
      if (this.status !== "running") return;
      this.status = status;
      this.endReason = reason;
      if (status === "success") {
        this.addLog(
          "疏散完成：690 人全部离站，变电室保持干燥。用时 " + formatTime(this.time) + "。",
          "good"
        );
      } else {
        this.addLog("任务失败：" + reason, "danger");
      }
    }

    checkOutcome() {
      if (this.water.transformer > 2) {
        this.finish("failed", "积水侵入变电室，供电系统紧急断电。");
        return;
      }
      if (this.spawned >= this.totalPassengers && this.evacuated >= this.totalPassengers) {
        this.finish("success", "全部乘客已撤离，变电室保持干燥。");
        return;
      }
      if (this.time >= MISSION_SECONDS) {
        this.finish("failed", "15 分钟窗口结束，仍有 " + (this.totalPassengers - this.evacuated) + " 人滞留。");
      }
    }

    update(dt) {
      if (this.status !== "running") return;
      const step = clamp(dt || 0, 0, 0.25);
      this.time = Math.min(MISSION_SECONDS, this.time + step);
      this.updateSpawns();
      this.updateHydrology(step);
      this.updatePassengers(step);
      this.updateQueues(step);
      this.updateRisk(step);
      this.checkOutcome();
    }

    getWaterDepths() {
      return {
        north: this.water.north / LITERS_PER_CM / 100,
        paid: this.water.paid / 520 / 100,
        transformer: this.water.transformer / 16 / 100
      };
    }

    getSnapshot() {
      const depth = this.getWaterDepths();
      const active = this.passengers.filter((passenger) => passenger.state !== "exited");
      const inside = Math.max(0, this.spawned - this.evacuated);
      const remaining = Math.max(0, this.totalPassengers - this.evacuated);
      const riskTier = this.risk >= 70 ? "danger" : this.risk >= 38 ? "warn" : "safe";
      return {
        status: this.status,
        time: this.time,
        remainingTime: Math.max(0, MISSION_SECONDS - this.time),
        clock: formatTime(MISSION_SECONDS - this.time),
        remaining,
        inside,
        active,
        passengersInside: this.spawned - this.evacuated,
        spawned: this.spawned,
        evacuated: this.evacuated,
        totalPassengers: this.totalPassengers,
        water: {
          northLiters: this.water.north,
          paidLiters: this.water.paid,
          transformerLiters: this.water.transformer,
          northCm: depth.north,
          paidCm: depth.paid,
          transformerCm: depth.transformer,
          concourseCm: Math.max(depth.north, depth.paid)
        },
        pumps: {
          1: {
            setting: this.controls.pumps[1].setting,
            heat: this.controls.pumps[1].heat,
            tripped: this.controls.pumps[1].tripped,
            flow: this.lastPumpFlow[1]
          },
          2: {
            setting: this.controls.pumps[2].setting,
            heat: this.controls.pumps[2].heat,
            tripped: this.controls.pumps[2].tripped,
            flow: this.lastPumpFlow[2]
          }
        },
        risk: this.risk,
        peakRisk: this.peakRisk,
        riskTier,
        riskZone: this.riskZone,
        rainScale: this.rainScale,
        inout: this.lastInflow || { a: 0, b: 0 },
        queues: Object.fromEntries(EDGES.map((edge) => [edge.id, this.queues[edge.id].length])),
        stats: Object.assign({}, this.stats),
        logs: this.logs.slice(0, 12),
        controls: this.controls,
        missionSeconds: MISSION_SECONDS,
        endReason: this.endReason,
        depths: depth
      };
    }
  }

  return {
    Simulation,
    MAP,
    NODES,
    EDGES,
    BARRIER_LABEL,
    BARRIER_CAP,
    GATE_LABEL,
    GATE_CAP,
    PUMP_LABEL,
    PUMP_RATE,
    SPAWN_WAVES,
    MISSION_SECONDS,
    TOTAL_PASSENGERS,
    formatTime,
    distance
  };
});





