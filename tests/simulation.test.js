import test from "node:test";
import assert from "node:assert/strict";
import { CoolingSim, DAY_MINUTES, HOTSPOT_LIMIT_C } from "../simulation.js";

function findIdleRack(sim) {
  return sim.racks.find((rack) => rack.tasks.length === 0);
}

test("热点持续超过阈值后自动迁移任务到另一排", () => {
  const sim = new CoolingSim({ seed: 11 });
  sim.setFan(0, 52);
  sim.setFan(1, 52);
  sim.setFan(2, 52);
  sim.setCoolant(48);

  const source = findIdleRack(sim);
  assert.ok(source, "应存在空闲机柜");
  const task = sim.addTask(source.id, 8, 240, false);
  assert.ok(task);

  let migration = null;
  for (let minute = 0; minute < 90 && !migration; minute += 1) {
    sim.step();
    migration = sim.events.find(
      (event) => event.type === "auto-migration" && event.rackId === source.id
    );
  }

  assert.ok(migration, "应触发一次热点自动迁移");
  assert.ok(migration.sourceTemp >= HOTSPOT_LIMIT_C);
  assert.notEqual(migration.targetRackId, source.id);
  assert.notEqual(sim.rack(migration.targetRackId).row, source.row, "自动迁移应优先跨排");
  assert.equal(sim.task(migration.taskId).rackId, migration.targetRackId);
  assert.equal(source.autoMigrations, 1);
});

test("手动迁移移动最重任务并记录事件", () => {
  const sim = new CoolingSim({ seed: 23 });
  const source = sim.racks.find((rack) => rack.tasks.length >= 2);
  const target = sim.bestMigrationTarget(source, true);
  const sourceTaskCount = source.tasks.length;
  const targetTaskCount = target.tasks.length;
  const heaviest = [...source.tasks].sort((a, b) => b.kw - a.kw)[0];

  assert.equal(sim.migrateTask(source.id, target.id, false), true);
  assert.equal(source.tasks.length, sourceTaskCount - 1);
  assert.equal(target.tasks.length, targetTaskCount + 1);
  assert.equal(sim.task(heaviest.id).rackId, target.id);
  assert.equal(sim.events[0].type, "migration");
});

test("冷却机故障抬升供水温度并在 90 分钟后恢复", () => {
  const control = new CoolingSim({ seed: 47 });
  const failed = new CoolingSim({ seed: 47 });
  control.setFan(1, 72);
  failed.setFan(1, 72);
  const baselineSupply = failed.stats().supplyTemp;

  assert.equal(failed.triggerChillerFailure(90, false), true);
  assert.equal(failed.chiller.online, false);
  failed.step(30);
  control.step(30);

  assert.ok(failed.events.some((event) => event.type === "fault"));
  assert.ok(failed.stats().supplyTemp > baselineSupply + 4);
  assert.ok(failed.stats().maxTemp > control.stats().maxTemp);
  assert.equal(failed.chiller.failureCount, 1);

  failed.step(65);
  control.step(65);
  assert.equal(failed.chiller.online, true);
  assert.equal(failed.chiller.failureCount, 1);
  assert.ok(failed.events.some((event) => event.type === "recovery"));
  assert.ok(failed.stats().supplyTemp < failed.history.at(-1).supply + 0.1);
});

test("24 小时运行会完成并保留能耗统计", () => {
  const sim = new CoolingSim({ seed: 61 });
  sim.step(DAY_MINUTES);
  const stats = sim.stats();
  assert.equal(sim.finished, true);
  assert.equal(stats.running, false);
  assert.equal(stats.elapsedMin, DAY_MINUTES);
  assert.ok(stats.totalKwh > 0);
  assert.ok(stats.peak15Kw > 300);
  assert.equal(stats.progress, 1);
});
