import { WORLD, LANE_Y, DEMAND, THRESHOLDS } from './config.js';
import { makeRng, buildArrivals, buildDetourFlags } from './rng.js';
import { signalState } from './signals.js';
import { updateVehicle, updatePed } from './movement.js';

const DURATION = WORLD.simMinutes * 60;

// 预构建一次需求计划；不同配置复用同一计划 → A/B 对比只受策略影响
export function buildPlan(seed = DEMAND.seed) {
  const rng = makeRng(seed);
  const plan = {
    eb: buildArrivals(rng, DURATION, DEMAND.waves, 'eb'),
    wb: buildArrivals(rng, DURATION, DEMAND.waves, 'wb'),
    nb: buildArrivals(rng, DURATION, DEMAND.waves, 'side'),
    sb: buildArrivals(rng, DURATION, DEMAND.waves, 'side'),
    pedN: buildArrivals(rng, DURATION, DEMAND.waves, 'ped'),
    pedS: buildArrivals(rng, DURATION, DEMAND.waves, 'ped'),
    bus: buildArrivals(makeRng(seed + 7), DURATION,
      [{ t0: 0, t1: DURATION, eb: DEMAND.busEB, wb: 0, side: 0, ped: 0 }], 'eb'),
  };
  return plan;
}

export class Simulation {
  constructor(cfg, plan = buildPlan()) {
    this.cfg = { ...cfg };
    this.plan = plan;
    // 每个流独立的分流标记（同种子 → 同车辆在 A/B 中去向一致）
    this.rng = makeRng(DEMAND.seed + 99);
    this.flags = {
      eb: buildDetourFlags(this.rng, plan.eb.length, cfg.detourPct),
    };
    this.reset();
  }

  reset() {
    this.t = 0;
    this.vehicles = [];
    this.peds = [];
    this.ptr = { eb: 0, wb: 0, nb: 0, sb: 0, pedN: 0, pedS: 0, bus: 0 };
    // 入口被堵时未生成的需求保留到达时间戳（回堵到上游源头，源头等待计入延误）
    this.pending = { eb: [], wb: [], nb: [], sb: [], bus: [], pedN: [], pedS: [] };
    this.nextId = 1;
    this.queueMax = 0;
    this.conflicts = 0;
    this.conflictSet = new Set();
    this.throughput = 0;
    this.totalEntrants = 0;  // 累计进入路网的车辆（含已驶离）
    this.totalDelay = 0;     // 累计停车延误（车·秒）
    this.stepCount = 0;
    this.queueSamples = [];
    this.density = new Array(11).fill(0); // 主路按 100m 分段的最新密度
    this.finished = false;
    this.sig = signalState(this.cfg, 0);
    this.lastPedKey = -1;
    this.lastRiskKey = -1;
  }

  spawn() {
    const c = this.cfg;
    // 1) 到达时刻已到的需求先进入入口待行队列
    for (const key of ['eb', 'wb', 'nb', 'sb', 'pedN', 'pedS']) {
      while (this.ptr[key] < this.plan[key].length && this.plan[key][this.ptr[key]] <= this.t) {
        this.pending[key].push(this.plan[key][this.ptr[key]++]);
      }
    }
    while (this.ptr.bus < this.plan.bus.length && this.plan.bus[this.ptr.bus] <= this.t) {
      this.pending.bus.push(this.plan.bus[this.ptr.bus++]);
    }
    // 2) 入口有空位时把待行车辆放入路网（每步每入口放一辆，模拟源头汇流）
    this.flushMain('eb', 'EB', WORLD.mainMinX, LANE_Y.EB);
    this.flushMain('wb', 'WB', WORLD.mainMaxX, LANE_Y.WB);
    this.flushSide('nb', 'NB', WORLD.vMax);
    this.flushSide('sb', 'SB', WORLD.vMin);
    this.flushBus();
    this.flushPeds();
  }

  flushMain(key, dir, x0, lane) {
    while (this.pending[key].length > 0) {
      const arrivalIndex = this.ptr[key] - this.pending[key].length;
      const detour = dir === 'EB' && this.flags.eb[arrivalIndex];
      const startX = detour ? 150 : x0;
      if (this.blockedAt(startX, lane, WORLD.carLen)) return; // 入口回堵：保留待行
      const arrivedAt = this.pending[key].shift();
      this.totalDelay += Math.max(0, this.t - arrivedAt);
      this.vehicles.push(this.mkVeh(dir, 'car', startX, lane, detour ? 'detour' : 'straight'));
    }
  }

  flushSide(key, dir, start) {
    const lane = dir === 'NB' ? WORLD.nbLane : WORLD.sbLane;
    while (this.pending[key].length > 0) {
      if (this.blockedSide(start, lane)) return;
      const arrivedAt = this.pending[key].shift();
      this.totalDelay += Math.max(0, this.t - arrivedAt);
      this.vehicles.push({ ...this.mkVeh(dir, 'car', start, lane, 'straight'), lanePos: start, pos: start });
    }
  }

  flushBus() {
    while (this.pending.bus.length > 0) {
      if (this.blockedAt(WORLD.mainMinX, LANE_Y.EB, WORLD.busLen)) return;
      const arrivedAt = this.pending.bus.shift();
      this.totalDelay += Math.max(0, this.t - arrivedAt);
      this.vehicles.push(this.mkVeh('EB', 'bus', WORLD.mainMinX, LANE_Y.EB, 'straight'));
    }
  }

  flushPeds() {
    for (const key of ['pedN', 'pedS']) {
      while (this.pending[key].length > 0) {
        const fromNorth = key === 'pedN';
        this.pending[key].shift();
        this.peds.push({
          id: this.nextId++,
          x: WORLD.schoolX + (this.rng() - 0.5) * 6,
          y: fromNorth ? 268 : 292,
          y0: fromNorth ? 268 : 292,
          yTarget: fromNorth ? 292 : 268,
          dirY: fromNorth ? 1 : -1,
          state: 'waiting',
        });
      }
    }
  }

  mkVeh(dir, kind, pos, lane, route) {
    this.totalEntrants++;
    return {
      id: this.nextId++, dir, kind, route,
      pos, lane, lanePos: pos,
      x: pos, y: lane,
      len: kind === 'bus' ? WORLD.busLen : WORLD.carLen,
      speed: 0, dwell: 0, dwelling: false, dwellDone: false,
      wp: 0, waitAcc: 0, counted: false, born: this.t,
    };
  }

  // 行人相位放行路缘等待者；错误放行模式下主干绿灯也放人（制造人车冲突）
  releasePeds(sig) {
    const phaseKey = Math.floor(this.t / sig.cycle);
    const startOfPed = sig.phase === 'PED' && sig.x < WORLD.dt * 1.5;
    if (sig.phase === 'PED') {
      // 仅在每个行人相位起点成组放行，保证一组人能在相位内过街清空
      if (!startOfPed || this.lastPedKey === phaseKey) return;
      this.lastPedKey = phaseKey;
    } else if (this.cfg.riskPed && sig.phase === 'MAIN') {
      if (this.lastRiskKey === phaseKey) return; // 风险模式每个主干相位放一批
      this.lastRiskKey = phaseKey;
    } else {
      return;
    }
    for (const p of this.peds) {
      if (p.state === 'waiting') p.state = 'crossing';
    }
  }

  blockedAt(x, y, len) {
    return this.vehicles.some(v => v.route === 'straight' && v.lane === y &&
      Math.abs(v.pos - x) < (v.len + len) / 2 + 2);
  }

  blockedSide(pos, lane) {
    return this.vehicles.some(v => (v.dir === 'NB' || v.dir === 'SB') && v.lane === lane &&
      Math.abs(v.lanePos - pos) < WORLD.carLen + 2);
  }

  step() {
    if (this.finished) return this.stats();
    const dt = WORLD.dt;
    this.t += dt;
    const sig = signalState(this.cfg, this.t);
    this.sig = sig;

    this.spawn();

    for (const v of this.vehicles) {
      updateVehicle(v, this.vehicles, this.peds, this.cfg, sig, dt);
      if (v.speed < 0.6 && v.route === 'straight') {
        v.waitAcc += dt;
        this.totalDelay += dt;
      }
    }
    this.releasePeds(sig);
    for (const p of this.peds) updatePed(p, this.cfg, sig, dt);

    this.detectConflicts(sig);
    this.removeFinished();
    this.measure();

    if (this.t >= DURATION) {
      this.finished = true;
      this.measure(true);
    }
    return this.stats();
  }

  // 人车冲突：行人正在车道上且该方向机动车为绿灯（错误放行时发生）
  detectConflicts(sig) {
    // 正常 PED 相位无冲突；仅风险模式，或行人相位超时仍未离开横道时计数
    const riskyTiming = this.cfg.riskPed ||
      (sig.phase === 'MAIN' && this.peds.some(p => p.state === 'crossing'));
    if (!riskyTiming) return;
    const half = WORLD.crosswalkW / 2 + 2;
    for (const p of this.peds) {
      if (p.state !== 'crossing') continue;
      for (const v of this.vehicles) {
        if (v.route !== 'straight') continue;
        const laneY = v.lane;
        const onLane = (v.dir === 'EB' && Math.abs(laneY - LANE_Y.EB) < 1) ||
                       (v.dir === 'WB' && Math.abs(laneY - LANE_Y.WB) < 1);
        if (!onLane) continue;
        const green = (v.dir === 'EB' && sig.eb) || (v.dir === 'WB' && sig.wb);
        if (!green) continue;
        if (Math.abs(v.pos - p.x) < v.len / 2 + half &&
            Math.abs(laneY - p.y) < WORLD.laneW) {
          const key = `${p.id}:${v.id}`;
          if (!this.conflictSet.has(key)) {
            this.conflictSet.add(key);
            this.conflicts++;
          }
        }
      }
    }
  }

  removeFinished() {
    const keep = [];
    for (const v of this.vehicles) {
      let done = false;
      if (v.route === 'detour') done = v.wp >= 7;
      else if (v.dir === 'EB') done = v.pos > WORLD.mainMaxX + 10;
      else if (v.dir === 'WB') done = v.pos < WORLD.mainMinX - 10;
      else if (v.dir === 'NB') done = v.lanePos < WORLD.vMin - 10;
      else if (v.dir === 'SB') done = v.lanePos > WORLD.vMax + 10;
      if (done) {
        this.throughput++;
        if (!v.counted) { v.counted = true; }
      } else keep.push(v);
    }
    this.vehicles = keep;
    this.peds = this.peds.filter(p => p.state !== 'done');
  }

  // 排队：红灯/障碍下速度 <0.6 且位于停车线上游的连续车辆，按四方向分别计数
  queueCounts() {
    // 入口待行队列即「回堵到上游」的物理排队，一并计入
    const q = {
      EB: this.pending.eb.length + this.pending.bus.length,
      WB: this.pending.wb.length,
      NB: this.pending.nb.length,
      SB: this.pending.sb.length,
    };
    for (const v of this.vehicles) {
      if (v.speed >= 0.6 || v.route !== 'straight') continue;
      if (v.dir === 'EB' && v.pos < WORLD.schoolX) q.EB++;        // 含路口排队与公交站回堵
      else if (v.dir === 'WB' && v.pos > WORLD.stopWB) q.WB++;
      else if (v.dir === 'NB' && v.lanePos > WORLD.stopNB) q.NB++;
      else if (v.dir === 'SB' && v.lanePos < WORLD.stopSB) q.SB++;
    }
    return q;
  }

  measure(force = false) {
    this.stepCount++;
    // 每 5 个仿真秒采样一次（dt=0.25 → 20 步），结束时强制补采
    if (!force && this.stepCount % 20 !== 0) return;
    const q = this.queueCounts();
    const qTotal = Math.max(q.EB, q.WB, q.NB, q.SB);
    this.queueSamples.push(qTotal);
    this.queueMax = Math.max(this.queueMax, qTotal);

    // 主路 11 个 100m 分段密度（辆/km/车道），用于热区着色与音频
    this.density = new Array(11).fill(0);
    const onRoad = this.vehicles.filter(v => v.route === 'straight');
    for (const v of onRoad) {
      if (v.dir !== 'EB' && v.dir !== 'WB') continue;
      const i = Math.max(0, Math.min(10, Math.floor(v.pos / 100)));
      this.density[i]++;
    }
    this.density = this.density.map(n => (n / 100) * 1000);
  }

  stats() {
    const onRoad = this.vehicles.filter(v => v.route === 'straight');
    let pendingDelay = 0;
    let pendingN = 0;
    for (const key of ['eb', 'wb', 'nb', 'sb', 'bus']) {
      pendingN += this.pending[key].length;
      for (const at of this.pending[key]) pendingDelay += Math.max(0, this.t - at);
    }
    const entrants = this.totalEntrants + pendingN;
    const avgWait = entrants ? (this.totalDelay + pendingDelay) / entrants : 0;
    const liveQueue = Math.max(0, ...Object.values(this.queueCounts()));
    return {
      t: this.t,
      avgWait,
      maxQueue: this.queueMax,
      liveQueue,
      throughput: this.throughput,
      conflicts: this.conflicts,
      onRoad: onRoad.length,
      density: this.density,
      passWait: avgWait <= THRESHOLDS.avgWait,
      passQueue: this.queueMax <= THRESHOLDS.maxQueue,
      finished: this.finished,
    };
  }

  // 一次跑完整场模拟（无头验证用）
  runFull() {
    while (!this.finished) this.step();
    return this.stats();
  }
}
