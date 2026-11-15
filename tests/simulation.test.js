import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimulation,
  setHospitalSource,
  setPumpSpeed,
  startPump,
  startRepair,
  resetBus,
  stepSimulation
} from '../src/simulation.js';

test('可行方案：错峰启动、负荷切换与回调泵速可完成六小时', () => {
  const sim = createSimulation();
  assert.equal(setHospitalSource(sim, 'generator').ok, true);
  assert.equal(setPumpSpeed(sim, 'B', 96).ok, true);
  assert.equal(startPump(sim, 'A').ok, true);

  for (let minute = 0; minute < 360 && sim.status === 'running'; minute += 1) {
    if (minute === 6) assert.equal(startPump(sim, 'B').ok, true);
    if (minute === 12) assert.equal(startPump(sim, 'C').ok, true);
    if (minute === 120) assert.equal(setPumpSpeed(sim, 'A', 65).ok, true);
    if (minute === 240) assert.equal(setPumpSpeed(sim, 'A', 55).ok, true);
    stepSimulation(sim, 1);
  }

  assert.equal(sim.status, 'won');
  assert.equal(sim.t, 360);
  assert.equal(sim.failures.length, 0);
  assert.equal(sim.hospital.everLostPower, false);
  assert.equal(sim.bus.trips, 0);
  assert.equal(sim.metrics.faults, 0);
  for (const zone of Object.values(sim.zones)) {
    assert.equal(zone.flooded, false, `${zone.name}不应进水`);
    assert.ok(zone.level < zone.threshold, `${zone.name}应低于阈值`);
  }
});

test('过载连锁：医院泵持续 110% 超载会导致设备损伤并最终淹区', () => {
  const sim = createSimulation();
  setHospitalSource(sim, 'generator');
  setPumpSpeed(sim, 'B', 110);
  assert.equal(startPump(sim, 'B').ok, true);

  for (let minute = 0; minute < 32 && !sim.pumps.B.faulted; minute += 1) {
    stepSimulation(sim, 1);
  }

  assert.equal(sim.pumps.B.faulted, true);
  assert.equal(sim.pumps.B.health, 0);
  assert.equal(sim.pumps.B.on, false);
  assert.equal(sim.metrics.faults, 1);
  assert.ok(sim.pumps.B.overloadMinutes >= 24);
  assert.equal(startPump(sim, 'B').ok, false);
  assert.equal(sim.status, 'running');

  while (sim.status === 'running') stepSimulation(sim, 1);

  assert.equal(sim.status, 'lost');
  assert.ok(sim.t > 24 && sim.t < 360);
  assert.deepEqual(
    sim.failures.map((failure) => failure.code),
    ['flood_hospital']
  );
  assert.equal(sim.zones.hospital.flooded, true);
  assert.ok(sim.zones.hospital.level >= sim.zones.hospital.threshold);
});

test('故障恢复：过载跳闸后可抢修并重新启泵', () => {
  const sim = createSimulation();
  setHospitalSource(sim, 'generator');
  setPumpSpeed(sim, 'B', 110);
  startPump(sim, 'B');
  for (let minute = 0; minute < 25; minute += 1) stepSimulation(sim, 1);

  assert.equal(sim.pumps.B.faulted, true);
  assert.equal(startRepair(sim, 'B').ok, true);
  for (let minute = 0; minute < 12; minute += 1) stepSimulation(sim, 1);

  assert.equal(sim.pumps.B.faulted, false);
  assert.equal(sim.pumps.B.health, 100);
  assert.equal(sim.metrics.repairs, 1);
  assert.equal(sim.status, 'running');
  setPumpSpeed(sim, 'B', 95);
  assert.equal(startPump(sim, 'B').ok, true);
  stepSimulation(sim, 1);
  assert.equal(sim.pumps.B.running, true);
  assert.ok(sim.pumps.B.flow > 0);
});

test('母线故障恢复：同时启动触发跳闸，冷却后复位并要求重新启泵', () => {
  const sim = createSimulation();
  setHospitalSource(sim, 'generator');
  for (const id of ['A', 'B', 'C']) {
    setPumpSpeed(sim, id, 100);
    startPump(sim, id);
  }
  stepSimulation(sim, 1);

  assert.equal(sim.status, 'running');
  assert.equal(sim.bus.tripped, true);
  assert.equal(sim.hospital.powered, true);
  assert.ok(Object.values(sim.pumps).every((pump) => !pump.on));
  assert.equal(resetBus(sim).ok, false);
  stepSimulation(sim, 3);
  assert.equal(resetBus(sim).ok, true);
  stepSimulation(sim, 1);
  assert.equal(sim.bus.tripped, false);
  assert.equal(sim.bus.voltage, 380);
});
