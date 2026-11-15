(function (global) {
  "use strict";

  const CONFIG = Object.freeze({
    duration: 1200,
    totalBags: 120,
    targetCorrect: 96,
    seed: 630,
    jamAt: 335,
    recoveryDuration: 12,
    exitCapacity: 7,
    exitDrainBase: 36,
    pickerService: 2.8,
    pickerCooldown: 2.2,
    batchSize: 5,
    batchInterval: 49,
    firstBatchAt: 12
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pad = (value) => String(value).padStart(2, "0");
  const timeLabel = (seconds) => {
    const absolute = 6 * 3600 + clamp(seconds, 0, CONFIG.duration);
    return `${pad(Math.floor(absolute / 3600))}:${pad(Math.floor((absolute % 3600) / 60))}`;
  };

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(values, random) {
    const copy = values.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }

  function buildBagSchedule(seed) {
    const random = mulberry32(seed);
    const total = CONFIG.totalBags;
    const wrongIds = new Set(shuffled(Array.from({ length: total }, (_, id) => id), random).slice(0, 27));
    const laneCycle = [1, 2, 1, 3, 2, 3, 1, 2, 3, 2];
    const bags = [];

    for (let index = 0; index < total; index += 1) {
      const batch = Math.floor(index / CONFIG.batchSize);
      const lane = laneCycle[index % laneCycle.length];
      const group = lane === 1 ? 1 : lane === 3 ? 2 : random() > 0.42 ? 1 : 2;
      const pair = group === 1 ? [1, 2] : [3, 4];
      const actualExit = pair[random() > 0.5 ? 1 : 0];
      const wrong = wrongIds.has(index);
      const tagExit = wrong ? (actualExit === pair[0] ? pair[1] : pair[0]) : actualExit;
      const length = Math.round((0.9 + random() * 1.5) * 10) / 10;
      const offset = (index % CONFIG.batchSize) * 0.7;

      bags.push({
        id: index,
        serial: `BE ${String(1040 + index).padStart(4, "0")}`,
        lane,
        group,
        length,
        actualExit,
        tagExit,
        wrong,
        fixed: false,
        batch,
        spawnAt: CONFIG.firstBatchAt + batch * CONFIG.batchInterval + offset,
        status: "scheduled",
        stage: "scheduled",
        progress: 0,
        stageElapsed: 0,
        stageDuration: 0,
        manualHold: 0,
        queuedAt: 0,
        arrivedAt: null,
        counted: false
      });
    }

    return bags;
  }

  function createSimulation(options) {
    const settings = Object.assign({}, CONFIG, options || {});
    const state = {
      config: settings,
      time: 0,
      elapsedReal: 0,
      running: false,
      paused: false,
      ended: false,
      outcome: null,
      controls: {
        speeds: [1.05, 1.15, 0.95],
        priorities: [58, 47],
        pickerLane: 2
      },
      bags: buildBagSchedule(settings.seed),
      diverters: [
        { id: 1, queue: [], cooldown: 0, released: 0 },
        { id: 2, queue: [], cooldown: 0, released: 0 }
      ],
      exits: [1, 2, 3, 4].map((id) => ({
        id,
        queue: [],
        cooldown: 0,
        total: 0,
        correct: 0,
        drained: 0
      })),
      picker: {
        lane: 2,
        busy: null,
        cooldown: 0,
        inspected: 0,
        fixed: 0,
        totalHold: 0
      },
      jam: {
        active: false,
        occurred: false,
        clearing: false,
        queue: [],
        triggeredAt: null,
        clearedAt: null,
        recoveredBags: 0,
        releaseTimer: 0
      },
      recovery: {
        active: false,
        elapsed: 0,
        duration: settings.recoveryDuration,
        stage: "idle",
        completed: false
      },
      stats: {
        spawned: 0,
        delivered: 0,
        correct: 0,
        wrong: 0,
        fixed: 0,
        overflowCount: 0,
        overflows: [],
        jams: 0,
        jamBags: 0,
        recoveredBags: 0,
        peakLoad: 0,
        throughput: 0,
        occupancySum: 0,
        occupancySamples: 0
      },
      events: [],
      lastExitNotice: 0,
      load: 0.16
    };

    function emit(type, title, detail, level) {
      state.events.push({
        type,
        title,
        detail: detail || "",
        level: level || "info",
        at: state.time,
        clock: timeLabel(state.time)
      });
    }

    function setSpeeds(speeds) {
      state.controls.speeds = state.controls.speeds.map((current, index) =>
        clamp(Number(speeds[index] ?? current), 0.45, 1.65)
      );
    }

    function setPriority(index, value) {
      state.controls.priorities[index] = clamp(Number(value), 25, 75);
    }

    function setPickerLane(lane) {
      state.controls.pickerLane = clamp(Number(lane), 1, 3);
      state.picker.lane = state.controls.pickerLane;
    }

    function start() {
      if (state.running) return;
      state.running = true;
      emit("system", "固定班次启动", "行李序列与错标点已锁定 · Seed 0630", "success");
    }

    function pause(value) {
      if (!state.running || state.ended) return;
      state.paused = value == null ? !state.paused : Boolean(value);
      emit("system", state.paused ? "模拟已暂停" : "模拟继续", state.paused ? "线路保持当前状态" : "调度时钟恢复推进", "info");
    }

    function routeDuration(lane, stage, length) {
      const speed = state.controls.speeds[lane - 1];
      if (stage === "entry") return (11 + length * 3.6) / speed;
      if (stage === "merge") return (14 + length * 2.6) / speed;
      return (8 + length * 3.2) / speed;
    }

    function spawnBags() {
      for (const bag of state.bags) {
        if (bag.status !== "scheduled" || bag.spawnAt > state.time) continue;
        bag.status = "active";
        bag.stage = "entry";
        bag.progress = 0;
        bag.stageElapsed = 0;
        bag.stageDuration = routeDuration(bag.lane, "entry", bag.length);
        state.stats.spawned += 1;
      }
    }

    function findPickerCandidate() {
      return state.bags
        .filter((bag) =>
          bag.status === "active" &&
          bag.stage === "entry" &&
          bag.lane === state.picker.lane &&
          bag.wrong &&
          bag.progress > 0.18 &&
          bag.progress < 0.86
        )
        .sort((a, b) => b.progress - a.progress)[0] || null;
    }

    function updatePicker(dt) {
      if (state.picker.busy) {
        state.picker.busy.manualHold -= dt;
        state.picker.totalHold += dt;
        if (state.picker.busy.manualHold <= 0) {
          const bag = state.picker.busy;
          bag.wrong = false;
          bag.fixed = true;
          bag.tagExit = bag.actualExit;
          bag.status = "active";
          bag.stage = "entry";
          state.picker.fixed += 1;
          state.picker.inspected += 1;
          state.stats.fixed += 1;
          state.picker.busy = null;
          state.picker.cooldown = state.config.pickerCooldown;
          emit("picker", `${bag.serial} 标签已修正`, `人工复核改派 Y${bag.actualExit} · ${bag.length.toFixed(1)}m`, "success");
        }
        return;
      }

      state.picker.cooldown = Math.max(0, state.picker.cooldown - dt);
      if (state.picker.cooldown > 0) return;
      const candidate = findPickerCandidate();
      if (!candidate) return;

      candidate.status = "manual";
      candidate.manualHold = state.config.pickerService;
      state.picker.busy = candidate;
      state.picker.inspected += 1;
    }

    function queueLengthForDiverter(diverter) {
      return state.diverters[diverter - 1].queue.length;
    }

    function chooseDivertedBag(diverterIndex) {
      const diverter = state.diverters[diverterIndex];
      const pair = diverterIndex === 0 ? [1, 2] : [3, 4];
      const priority = state.controls.priorities[diverterIndex] / 100;
      const primary = diverter.queue.filter((bag) => bag.tagExit === pair[0]);
      const secondary = diverter.queue.filter((bag) => bag.tagExit === pair[1]);
      let chosen;

      if (!primary.length) chosen = secondary[0];
      else if (!secondary.length) chosen = primary[0];
      else chosen = (diverter.released % 100) / 100 < priority ? primary[0] : secondary[0];

      if (!chosen) return null;
      diverter.queue.splice(diverter.queue.indexOf(chosen), 1);
      diverter.released += 1;
      return chosen;
    }

    function enterJam(bag) {
      bag.status = "jam";
      bag.stage = "jam";
      bag.progress = clamp(bag.progress || 0.48, 0.25, 0.78);
      bag.queuedAt = state.time;
      state.jam.queue.push(bag);
      state.stats.jamBags += 1;
    }

    function beginChute(bag) {
      bag.status = "active";
      bag.stage = "chute";
      bag.progress = 0;
      bag.stageElapsed = 0;
      bag.stageDuration = routeDuration(bag.lane, "chute", bag.length);
    }

    function updateDiverters(dt) {
      for (let index = 0; index < state.diverters.length; index += 1) {
        const diverter = state.diverters[index];
        diverter.cooldown = Math.max(0, diverter.cooldown - dt);
        if (diverter.cooldown > 0 || !diverter.queue.length) continue;
        const bag = chooseDivertedBag(index);
        if (!bag) continue;

        if (state.jam.active && bag.tagExit === 1) {
          enterJam(bag);
        } else {
          beginChute(bag);
        }
        diverter.cooldown = 1.65 / Math.max(1, (state.controls.speeds[bag.lane - 1] + 1) * 0.5);
      }
    }

    function drainInterval(exitId) {
      const pairIndex = exitId <= 2 ? 0 : 1;
      const priority = state.controls.priorities[pairIndex];
      const ratio = exitId === pairIndex * 2 + 1 ? priority : 100 - priority;
      return settings.exitDrainBase / (0.65 + ratio / 100 * 0.7);
    }

    function arriveAtExit(bag) {
      const exit = state.exits[bag.tagExit - 1];
      bag.status = "exit";
      bag.stage = "exit";
      bag.progress = 1;
      bag.arrivedAt = state.time;
      bag.counted = true;
      exit.total += 1;
      state.stats.delivered += 1;

      if (bag.wrong) {
        state.stats.wrong += 1;
        if (state.time - state.lastExitNotice > 18) {
          state.lastExitNotice = state.time;
          emit("wrong", "错标行李抵达错误出口", `${bag.serial} → Y${bag.tagExit} · 实际应为 Y${bag.actualExit}`, "danger");
        }
      } else {
        state.stats.correct += 1;
        exit.correct += 1;
      }

      if (exit.queue.length >= state.config.exitCapacity) {
        const overflow = {
          exit: bag.tagExit,
          at: state.time,
          bag: bag.serial
        };
        state.stats.overflowCount += 1;
        state.stats.overflows.push(overflow);
        emit("overflow", `Y${bag.tagExit} 出口溢出`, `${bag.serial} 触发容量线 · 班次判定将失败`, "danger");
      }

      exit.queue.push(bag);
    }

    function updateBag(bag, dt) {
      if (bag.status === "manual") return;
      if (bag.status === "jam") return;
      if (bag.status === "exit" || bag.status === "done") return;

      if (bag.stage === "entry") {
        bag.progress += dt / Math.max(0.1, bag.stageDuration);
        if (bag.progress >= 1) {
          bag.stage = "merge";
          bag.progress = 0;
          bag.stageDuration = routeDuration(bag.lane, "merge", bag.length);
        }
        return;
      }

      if (bag.stage === "merge") {
        bag.progress += dt / Math.max(0.1, bag.stageDuration);
        if (bag.progress >= 1) {
          bag.stage = "diverter";
          bag.progress = 1;
          bag.queuedAt = state.time;
          state.diverters[bag.group - 1].queue.push(bag);
        }
        return;
      }

      if (bag.stage === "chute") {
        bag.progress += dt / Math.max(0.1, bag.stageDuration);
        if (state.jam.active && bag.tagExit === 1 && bag.progress >= 0.56) {
          enterJam(bag);
          return;
        }
        if (bag.progress >= 1) arriveAtExit(bag);
      }
    }

    function updateExits(dt) {
      for (const exit of state.exits) {
        exit.cooldown = Math.max(0, exit.cooldown - dt);
        if (exit.queue.length && exit.cooldown <= 0) {
          const bag = exit.queue.shift();
          bag.status = "done";
          bag.stage = "done";
          bag.progress = 1;
          exit.drained += 1;
          exit.cooldown = drainInterval(exit.id);
        }
      }
    }

    function triggerJam() {
      if (state.jam.occurred) return;
      state.jam.occurred = true;
      state.jam.active = true;
      state.jam.triggeredAt = state.time;
      state.stats.jams += 1;

      for (const bag of state.bags) {
        if (bag.stage === "chute" && bag.tagExit === 1) enterJam(bag);
      }

      emit("jam", "D1 / Y1 滑槽堵塞", "长件在弯道处错位 · 仅影响 Y1 分支", "danger");
    }

    function beginRecovery() {
      if (!state.jam.active || state.recovery.active || state.ended) return false;
      state.recovery.active = true;
      state.recovery.elapsed = 0;
      state.recovery.stage = "isolate";
      state.jam.clearing = false;
      state.jam.releaseTimer = 0;
      emit("recovery", "D1 局部恢复开始", "隔离 Y1 滑槽 · D2 与人工位继续运行", "warning");
      return true;
    }

    function updateRecovery(dt) {
      if (!state.recovery.active) return;
      const recovery = state.recovery;
      recovery.elapsed += dt;
      const ratio = clamp(recovery.elapsed / recovery.duration, 0, 1);

      if (ratio < 0.28) recovery.stage = "isolate";
      else if (ratio < 0.72) recovery.stage = "clear";
      else recovery.stage = "restart";

      if (ratio >= 0.3 && state.jam.active) {
        state.jam.active = false;
        state.jam.clearing = true;
        emit("recovery", "故障段已隔离", "Y1 滑槽重新开放 · 积压行李限速放行", "warning");
      }

      if (state.jam.clearing && state.jam.queue.length) {
        state.jam.releaseTimer -= dt;
        if (state.jam.releaseTimer <= 0) {
          const bag = state.jam.queue.shift();
          bag.status = "active";
          bag.stage = "chute";
          bag.progress = 0.58;
          bag.stageDuration = routeDuration(bag.lane, "chute", bag.length);
          state.jam.recoveredBags += 1;
          state.stats.recoveredBags += 1;
          state.jam.releaseTimer = 1.15;
        }
      }

      if (ratio >= 1) {
        for (const bag of state.jam.queue.splice(0)) {
          beginChute(bag);
          bag.progress = 0.6;
          state.jam.recoveredBags += 1;
          state.stats.recoveredBags += 1;
        }
        state.jam.clearing = false;
        state.jam.clearedAt = state.time;
        state.jam.active = false;
        recovery.active = false;
        recovery.completed = true;
        recovery.stage = "complete";
        emit("recovery", "D1 局部恢复完成", `积压 ${state.jam.recoveredBags} 件已回到 Y1 · 全线保持运行`, "success");
      }
    }

    function updateLoad() {
      const movingBags = state.bags.filter((bag) => bag.status === "active");
      const moving = movingBags.length;
      const jamBags = state.jam.queue.length;
      const exitLoad = state.exits.reduce((sum, exit) => sum + exit.queue.length, 0);
      const target = clamp(0.12 + moving * 0.045 + jamBags * 0.055 + exitLoad * 0.018, 0.08, 0.98);
      state.load += (target - state.load) * 0.06;
      state.stats.peakLoad = Math.max(state.stats.peakLoad, state.load);
      state.stats.occupancySum += movingBags.reduce((sum, bag) => sum + bag.length, 0);
      state.stats.occupancySamples += 1;
    }

    function finish() {
      if (state.ended) return;
      state.ended = true;
      state.running = false;
      const rate = state.stats.correct / state.config.totalBags;
      const success = rate >= state.config.targetCorrect / state.config.totalBags && state.stats.overflowCount === 0;
      state.outcome = {
        success,
        correct: state.stats.correct,
        rate,
        overflowCount: state.stats.overflowCount,
        recoveredBags: state.stats.recoveredBags,
        reason: success ? "completed" : state.stats.overflowCount ? "overflow" : "target"
      };
      emit(
        "result",
        success ? "班次目标达成" : "班次目标未达成",
        success ? `正确送出 ${state.stats.correct} 件 · 出口零溢出` : `正确 ${state.stats.correct}/96 · 溢出 ${state.stats.overflowCount}`,
        success ? "success" : "danger"
      );
    }

    function tick(delta) {
      if (!state.running || state.paused || state.ended) return state.events.splice(0);
      let remaining = Math.max(0, Math.min(Number(delta) || 0, 0.25));
      const collected = [];

      while (remaining > 0.0001 && !state.ended) {
        const step = Math.min(0.08, remaining);
        state.time = Math.min(state.config.duration, state.time + step);
        spawnBags();
        updatePicker(step);
        updateRecovery(step);

        if (!state.jam.occurred && state.time >= state.config.jamAt) triggerJam();

        for (const bag of state.bags) updateBag(bag, step);
        updateDiverters(step);
        updateExits(step);
        updateLoad();
        remaining -= step;

        if (state.time >= state.config.duration) finish();
      }

      collected.push(...state.events.splice(0));
      return collected;
    }

    function snapshot() {
      const activeBags = state.bags.filter((bag) => bag.status === "active" || bag.status === "manual" || bag.status === "jam");
      const occupancy = state.stats.occupancySamples
        ? state.stats.occupancySum / state.stats.occupancySamples
        : 0;
      return {
        time: state.time,
        remaining: Math.max(0, state.config.duration - state.time),
        progress: state.time / state.config.duration,
        running: state.running,
        paused: state.paused,
        ended: state.ended,
        outcome: state.outcome,
        controls: {
          speeds: state.controls.speeds.slice(),
          priorities: state.controls.priorities.slice(),
          pickerLane: state.controls.pickerLane
        },
        bags: state.bags.map((bag) => ({
          id: bag.id,
          serial: bag.serial,
          lane: bag.lane,
          group: bag.group,
          length: bag.length,
          actualExit: bag.actualExit,
          tagExit: bag.tagExit,
          wrong: bag.wrong,
          fixed: bag.fixed,
          status: bag.status,
          stage: bag.stage,
          progress: bag.progress
        })),
        activeBags: activeBags.length,
        diverters: state.diverters.map((diverter) => ({
          id: diverter.id,
          queueLength: diverter.queue.length
        })),
        exits: state.exits.map((exit) => ({
          id: exit.id,
          queueLength: exit.queue.length,
          total: exit.total,
          correct: exit.correct,
          drained: exit.drained,
          capacity: state.config.exitCapacity,
          bags: exit.queue.map((bag) => ({ id: bag.id, length: bag.length, wrong: bag.wrong }))
        })),
        jam: {
          active: state.jam.active,
          occurred: state.jam.occurred,
          clearing: state.jam.clearing,
          queueLength: state.jam.queue.length,
          recoveredBags: state.jam.recoveredBags
        },
        recovery: {
          active: state.recovery.active,
          completed: state.recovery.completed,
          elapsed: state.recovery.elapsed,
          duration: state.recovery.duration,
          ratio: clamp(state.recovery.elapsed / state.recovery.duration, 0, 1),
          stage: state.recovery.stage
        },
        picker: {
          lane: state.picker.lane,
          busy: Boolean(state.picker.busy),
          cooldown: state.picker.cooldown,
          fixed: state.picker.fixed
        },
        stats: Object.assign({}, state.stats, {
          occupancy,
          target: state.config.targetCorrect,
          total: state.config.totalBags
        }),
        load: state.load
      };
    }

    function runToEnd(options) {
      const runOptions = Object.assign({ autoRecoverDelay: 2, step: 0.08 }, options || {});
      if (!state.running) start();
      while (!state.ended) {
        tick(runOptions.step);
        if (
          runOptions.autoRecoverDelay != null &&
          state.jam.active &&
          !state.recovery.active &&
          state.time - state.jam.triggeredAt >= runOptions.autoRecoverDelay
        ) {
          beginRecovery();
        }
      }
      return snapshot();
    }

    return {
      start,
      tick,
      snapshot,
      runToEnd,
      pause,
      beginRecovery,
      setSpeeds,
      setPriority,
      setPickerLane,
      state,
      config: settings
    };
  }

  const api = { createSimulation, CONFIG, timeLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.BaggageSimulation = api;
})(typeof window !== "undefined" ? window : globalThis);
