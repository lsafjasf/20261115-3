export const ROWS = 3;
export const COLS = 10;
export const DAY_MINUTES = 24 * 60;
export const HOTSPOT_LIMIT_C = 28.5;
export const CRITICAL_LIMIT_C = 31;
export const AUTO_MIGRATE_AFTER_MIN = 24;

const ROW_NAMES = ["A", "B", "C"];
const TAU_MIN = 5.5;

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, places = 1) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function formatSimTime(minutes, startHour = 8) {
  const absolute = startHour * 60 + minutes;
  const day = Math.floor(absolute / DAY_MINUTES) + 1;
  const clockMinutes = absolute % DAY_MINUTES;
  const hours = Math.floor(clockMinutes / 60);
  const mins = Math.floor(clockMinutes % 60);
  return `DAY ${String(day).padStart(2, "0")} · ${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export class CoolingSim {
  constructor(options = {}) {
    this.seed = options.seed ?? 20261115;
    this.startHour = options.startHour ?? 8;
    this.reset();
  }

  reset() {
    this.random = mulberry32(this.seed);
    this.elapsedMin = 0;
    this.running = true;
    this.finished = false;
    this.fan = [68, 64, 70];
    this.coolant = 64;
    this.chiller = {
      online: true,
      failedUntil: 0,
      failureStartedAt: null,
      failureCount: 0,
      faultSeverity: 0
    };
    this.tasks = [];
    this.nextTaskId = 1;
    this.nextTaskAt = 18;
    this.nextSurgeAt = 92;
    this.migrations = { auto: 0, manual: 0 };
    this.energy = {
      totalKwh: 0,
      coolingKwh: 0,
      wasteKwh: 0,
      peakKw: 0,
      peak15Kw: 0,
      hotspotRackMinutes: 0,
      criticalRackMinutes: 0,
      overcoolMinutes: 0
    };
    this.demandWindow = [];
    this.history = [];
    this.events = [];
    this.eventSeq = 1;
    this.racks = [];
    this.selectedRackId = null;

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        this.racks.push({
          id: `R${row + 1}-${String(col + 1).padStart(2, "0")}`,
          row,
          col,
          rowName: ROW_NAMES[row],
          baseKw: round(8.5 + this.random() * 2.7, 2),
          loadKw: 0,
          tempC: 25,
          hotspotMinutes: 0,
          migrationCooldown: 0,
          autoMigrations: 0,
          tasks: []
        });
      }
    }

    for (let index = 0; index < 34; index += 1) {
      const rack = this.racks[Math.floor(this.random() * this.racks.length)];
      this.addTask(rack.id, 1.25 + this.random() * 1.45, 80 + Math.floor(this.random() * 210), false);
    }

    this.updateLoads();
    const supply = this.supplyTemp();
    for (const rack of this.racks) {
      rack.tempC = this.targetTemp(rack, supply) - 0.6 + this.random() * 0.4;
    }
    this.log("system", "值班开始", "24 小时冷却优化任务已加载 · 稳定优先，压低峰值。");
    this.captureHistory();
  }

  log(type, title, detail, extra = {}) {
    this.events.unshift({
      id: this.eventSeq++,
      at: this.elapsedMin,
      time: formatSimTime(this.elapsedMin, this.startHour),
      type,
      title,
      detail,
      ...extra
    });
    this.events = this.events.slice(0, 80);
  }

  addTask(rackId, kw = 1.8, durationMin = 160, announce = true) {
    const rack = this.rack(rackId);
    if (!rack || rack.tasks.length >= 6) return null;
    const task = {
      id: `T${this.nextTaskId++}`,
      rackId,
      kw: round(kw, 2),
      startedAt: this.elapsedMin,
      remainingMin: durationMin
    };
    rack.tasks.push(task);
    this.tasks.push(task);
    this.updateLoads();
    if (announce) {
      this.log("workload", "新任务上线", `${rack.id} 接入 ${task.kw.toFixed(1)} kW 计算任务。`, {
        rackId
      });
    }
    return task;
  }

  rack(rackId) {
    return this.racks.find((rack) => rack.id === rackId);
  }

  task(taskId) {
    return this.tasks.find((task) => task.id === taskId);
  }

  updateLoads() {
    for (const rack of this.racks) {
      rack.loadKw = rack.baseKw + rack.tasks.reduce((sum, task) => sum + task.kw, 0);
    }
  }

  supplyTemp() {
    const base = 18.2 - (this.coolant - 55) * 0.04;
    return base + this.chiller.faultSeverity * 7.4;
  }

  targetTemp(rack, supply = this.supplyTemp()) {
    const rowBias = rack.row === 1 ? 0.15 : rack.row === 2 ? 0.35 : 0;
    const airflow = 0.42 + this.fan[rack.row] / 100 * 0.63;
    return supply + 0.55 + rowBias + rack.loadKw / airflow * 0.52;
  }

  setFan(row, percent) {
    if (!this.running || row < 0 || row >= ROWS) return false;
    const value = Math.max(20, Math.min(100, Number(percent)));
    this.fan[row] = round(value, 0);
    return true;
  }

  setCoolant(percent) {
    if (!this.running) return false;
    this.coolant = round(Math.max(20, Math.min(100, Number(percent))), 0);
    return true;
  }

  selectRack(rackId) {
    this.selectedRackId = this.rack(rackId) ? rackId : null;
    return this.selectedRackId;
  }

  setSelectedByHotspot() {
    const hottest = [...this.racks].sort((a, b) => b.tempC - a.tempC)[0];
    this.selectedRackId = hottest?.id ?? null;
    return this.selectedRackId;
  }

  bestMigrationTarget(source, requireOtherRow = false) {
    return this.racks
      .filter((candidate) => {
        if (candidate.id === source.id || candidate.tasks.length >= 6) return false;
        if (requireOtherRow && candidate.row === source.row) return false;
        return true;
      })
      .sort((a, b) => a.tempC - b.tempC)[0];
  }

  migrateTask(sourceId, targetId, automatic = false) {
    const source = this.rack(sourceId);
    const target = targetId ? this.rack(targetId) : this.bestMigrationTarget(source, true);
    if (!source || !target || source.id === target.id || !source.tasks.length) return false;
    if (target.tasks.length >= 6) return false;

    const task = [...source.tasks].sort((a, b) => b.kw - a.kw)[0];
    const fromSourceTemp = source.tempC;
    source.tasks.splice(source.tasks.indexOf(task), 1);
    target.tasks.push(task);
    task.rackId = target.id;
    source.autoMigrations += automatic ? 1 : 0;
    source.hotspotMinutes = 0;
    source.migrationCooldown = automatic ? 42 : 18;
    this.migrations[automatic ? "auto" : "manual"] += 1;
    this.updateLoads();

    this.log(
      automatic ? "auto-migration" : "migration",
      automatic ? "热点自动迁移" : "手动任务迁移",
      `${task.id} · ${task.kw.toFixed(1)} kW · ${source.id} → ${target.id}，迁移时 ${fromSourceTemp.toFixed(1)}°C。`,
      {
        rackId: source.id,
        targetRackId: target.id,
        taskId: task.id,
        sourceTemp: round(fromSourceTemp, 1),
        automatic
      }
    );
    return true;
  }

  triggerChillerFailure(durationMin = 90, auto = false) {
    if (!this.running || !this.chiller.online) return false;
    this.chiller.online = false;
    this.chiller.failureStartedAt = this.elapsedMin;
    this.chiller.failedUntil = this.elapsedMin + durationMin;
    this.chiller.failureCount += 1;
    this.log(
      "fault",
      auto ? "冷却机突发故障" : "冷却机故障演练",
      `厂级冷却机离线 ${durationMin} min，冷媒供水温度预计抬升。请提高风扇并迁移重任务。`
    );
    return true;
  }

  injectSurge(rackId) {
    if (!this.running) return null;
    const rack = rackId ? this.rack(rackId) : this.racks[Math.floor(this.random() * this.racks.length)];
    if (!rack) return null;
    const slots = Math.max(1, 4 - rack.tasks.length);
    let added = 0;
    for (let index = 0; index < slots; index += 1) {
      const task = this.addTask(rack.id, 2.1 + this.random() * 1.1, 55 + Math.floor(this.random() * 115), false);
      if (task) added += 1;
    }
    if (!added) return null;
    this.log("workload", "周期性负载抬升", `${rack.id} 同时接入 ${added} 个批处理任务。`, {
      rackId: rack.id
    });
    return rack.id;
  }

  step(minutes = 1) {
    if (!this.running) return this.stats();
    for (let minute = 0; minute < minutes && this.running; minute += 1) {
      this.advanceMinute();
    }
    return this.stats();
  }

  advanceMinute() {
    this.elapsedMin += 1;

    const faultTarget = this.chiller.online ? 0 : 1;
    this.chiller.faultSeverity += (faultTarget - this.chiller.faultSeverity) / 4;
    this.chiller.faultSeverity = Math.max(0, Math.min(1, this.chiller.faultSeverity));

    if (!this.chiller.online && this.elapsedMin >= this.chiller.failedUntil) {
      this.chiller.online = true;
      this.log("recovery", "冷却机恢复", "厂级冷却机重新上线，供水温度正在回落。");
    }

    this.updateTaskQueue();
    if (this.elapsedMin >= this.nextSurgeAt) {
      this.injectSurge();
      this.nextSurgeAt += 112 + Math.floor(this.random() * 74);
    }

    const supply = this.supplyTemp();
    for (const rack of this.racks) {
      const target = this.targetTemp(rack, supply);
      rack.tempC += (target - rack.tempC) / TAU_MIN;
      rack.migrationCooldown = Math.max(0, rack.migrationCooldown - 1);

      if (rack.tempC >= HOTSPOT_LIMIT_C) {
        rack.hotspotMinutes += 1;
        this.energy.hotspotRackMinutes += 1;
      } else {
        rack.hotspotMinutes = Math.max(0, rack.hotspotMinutes - 2);
      }
      if (rack.tempC >= CRITICAL_LIMIT_C) this.energy.criticalRackMinutes += 1;
    }

    for (const rack of this.racks) {
      if (
        rack.tempC >= HOTSPOT_LIMIT_C &&
        rack.hotspotMinutes >= AUTO_MIGRATE_AFTER_MIN &&
        rack.migrationCooldown === 0 &&
        rack.tasks.length > 0
      ) {
        this.migrateTask(rack.id, null, true);
      }
    }

    this.accountEnergy();
    if (this.elapsedMin % 5 === 0) this.captureHistory();

    if (this.elapsedMin >= DAY_MINUTES) {
      this.running = false;
      this.finished = true;
      this.log("system", "24 小时值班结束", "冷却策略已冻结，查看峰值、稳定性与迁移记录。");
    }
  }

  updateTaskQueue() {
    for (const task of this.tasks) task.remainingMin -= 1;
    const expired = this.tasks.filter((task) => task.remainingMin <= 0);
    if (expired.length) {
      for (const task of expired) {
        const rack = this.rack(task.rackId);
        if (rack) rack.tasks = rack.tasks.filter((candidate) => candidate.id !== task.id);
      }
      const expiredIds = new Set(expired.map((task) => task.id));
      this.tasks = this.tasks.filter((task) => !expiredIds.has(task.id));
      this.updateLoads();
    }

    if (this.elapsedMin >= this.nextTaskAt) {
      const rack = this.racks[Math.floor(this.random() * this.racks.length)];
      this.addTask(rack.id, 1.15 + this.random() * 1.65, 75 + Math.floor(this.random() * 220), false);
      this.nextTaskAt = this.elapsedMin + 18 + Math.floor(this.random() * 22);
    }
  }

  accountEnergy() {
    const supply = this.supplyTemp();
    const normalSupply = supply - this.chiller.faultSeverity * 7.4;
    const itKw = this.racks.reduce((sum, rack) => sum + rack.loadKw, 0);
    const fanKw = this.fan.reduce((sum, percent) => sum + 4.5 + 21 * (percent / 100) ** 3, 0);
    const overcoolPenalty = Math.max(0, 17.9 - normalSupply) * 8;
    const chillerKw = this.chiller.online
      ? 48 + this.coolant * 0.85 + overcoolPenalty
      : 9 + this.coolant * 0.08;
    const totalKw = itKw + fanKw + chillerKw + 6;
    const avgTemp = this.racks.reduce((sum, rack) => sum + rack.tempC, 0) / this.racks.length;

    this.energy.totalKwh += totalKw / 60;
    this.energy.coolingKwh += (fanKw + chillerKw) / 60;
    this.energy.wasteKwh += overcoolPenalty / 60;
    this.energy.peakKw = Math.max(this.energy.peakKw, totalKw);
    if (normalSupply < 16.6 || avgTemp < 21) this.energy.overcoolMinutes += 1;

    this.demandWindow.push(totalKw);
    if (this.demandWindow.length > 15) this.demandWindow.shift();
    const windowPeak = Math.max(...this.demandWindow);
    this.energy.peak15Kw = Math.max(this.energy.peak15Kw, windowPeak);
    this.current = { itKw, fanKw, chillerKw, totalKw, supply, avgTemp };
  }

  captureHistory() {
    const stats = this.stats();
    this.history.push({
      at: this.elapsedMin,
      time: formatSimTime(this.elapsedMin, this.startHour).split("· ")[1],
      itKw: stats.itKw,
      coolingKw: stats.coolingKw,
      totalKw: stats.totalKw,
      maxTemp: stats.maxTemp,
      avgTemp: stats.avgTemp,
      supply: stats.supplyTemp,
      peak15Kw: stats.peak15Kw
    });
    this.history = this.history.slice(-290);
  }

  stats() {
    const itKw = this.racks.reduce((sum, rack) => sum + rack.loadKw, 0);
    const fanKw = this.fan.reduce((sum, percent) => sum + 4.5 + 21 * (percent / 100) ** 3, 0);
    const supply = this.supplyTemp();
    const avgTemp = this.racks.reduce((sum, rack) => sum + rack.tempC, 0) / this.racks.length;
    const hottest = [...this.racks].sort((a, b) => b.tempC - a.tempC)[0];
    const coolingKw = this.current?.chillerKw ?? 0;
    const totalKw = this.current?.totalKw ?? itKw + fanKw + coolingKw + 6;
    const hotCount = this.racks.filter((rack) => rack.tempC >= HOTSPOT_LIMIT_C).length;
    const progress = Math.min(1, this.elapsedMin / DAY_MINUTES);
    const online = this.chiller.online;

    return {
      elapsedMin: this.elapsedMin,
      clock: formatSimTime(this.elapsedMin, this.startHour),
      progress,
      running: this.running,
      finished: this.finished,
      supplyTemp: round(supply, 1),
      avgTemp: round(avgTemp, 1),
      maxTemp: round(hottest?.tempC ?? 0, 1),
      hottestRack: hottest?.id ?? null,
      itKw: round(itKw, 1),
      fanKw: round(fanKw, 1),
      coolingKw: round(coolingKw, 1),
      totalKw: round(totalKw, 1),
      pue: round(itKw ? (totalKw / itKw) : 1, 2),
      hotCount,
      totalKwh: round(this.energy.totalKwh, 1),
      coolingKwh: round(this.energy.coolingKwh, 1),
      wasteKwh: round(this.energy.wasteKwh, 1),
      peakKw: round(this.energy.peakKw, 1),
      peak15Kw: round(this.energy.peak15Kw, 1),
      hotspotRackMinutes: this.energy.hotspotRackMinutes,
      criticalRackMinutes: this.energy.criticalRackMinutes,
      overcoolMinutes: this.energy.overcoolMinutes,
      autoMigrations: this.migrations.auto,
      manualMigrations: this.migrations.manual,
      chillerOnline: online,
      chillerFailures: this.chiller.failureCount,
      faultMinutesLeft: online ? 0 : Math.max(0, this.chiller.failedUntil - this.elapsedMin),
      stability: Math.max(
        0,
        round(
          100 -
            (this.energy.criticalRackMinutes / Math.max(1, this.elapsedMin)) * 68 -
            this.energy.overcoolMinutes / Math.max(1, this.elapsedMin) * 12,
          1
        )
      )
    };
  }

  summary() {
    const stats = this.stats();
    const stable = stats.criticalRackMinutes === 0 && stats.stability >= 90;
    const grade = stable && stats.peak15Kw < 590 ? "A" : stable ? "B" : stats.stability > 72 ? "C" : "D";
    return {
      ...stats,
      stable,
      grade,
      headline: stable ? "冷通道保持稳定" : "出现过热风险",
      notes: [
        `${stats.autoMigrations} 次热点自动迁移`,
        `${stats.chillerFailures} 次冷却机故障`,
        `15 min 峰值 ${stats.peak15Kw.toFixed(0)} kW`
      ]
    };
  }
}
