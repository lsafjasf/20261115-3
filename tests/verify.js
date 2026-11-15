/*
 * Headless verification:
 *  1. Full post-blast recovery under correct ventilation procedure.
 *  2. Airflow short-circuit (opening the intake/return crosscut) triggers alarm.
 *  3. Wrongly closing the face return door pushes pollution back to the face.
 */
'use strict';
var assert = require('assert');
var S = require('../js/sim.js');

var failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS  ' + name);
  } catch (err) {
    failures += 1;
    console.log('FAIL  ' + name + '\n      ' + err.message);
  }
}

check('爆破后初始状态：传感器全部超标', function () {
  var sim = S.createSimulation();
  assert.ok(sim.alarms.list.length >= 4, '应存在多个超标报警');
  assert.strictEqual(sim.alarms.shortCircuit, false);
  assert.ok(sim.nodeById.FACE.gas > S.GAS_LIMIT);
  assert.ok(sim.nodeById.FACE.dust > S.DUST_LIMIT);
});

check('正确规程（主风机+压入式局扇）可在工班内恢复并完成任务', function () {
  var sim = S.createSimulation();
  S.command(sim, 'localFan', { mode: 'force' });
  var safeAt = -1;
  for (var i = 0; i < S.SHIFT_MINUTES && sim.status === 'running'; i++) {
    S.step(sim);
    if (safeAt < 0 && S.allSensorsSafe(sim) && !sim.alarms.shortCircuit) safeAt = sim.t;
  }
  assert.ok(safeAt > 0 && safeAt < S.SHIFT_MINUTES, '应在工班内达标，实际 ' + safeAt);
  assert.strictEqual(sim.status, 'won', '任务应完成，实际 ' + sim.status);
  assert.strictEqual(sim.alarms.list.length, 0);
  assert.strictEqual(sim.alarms.shortCircuit, false);
  sim.nodes.filter(function (n) { return n.sensor; }).forEach(function (n) {
    assert.ok(n.gas <= S.GAS_LIMIT, n.id + ' 瓦斯超标');
    assert.ok(n.dust <= S.DUST_LIMIT, n.id + ' 粉尘超标');
  });
  console.log('      全部传感器在第 ' + safeAt + ' 分钟达标，第 ' + sim.t + ' 分钟完工');
});

check('打开进回风短路风门立即触发风流短路报警', function () {
  var sim = S.createSimulation();
  S.command(sim, 'localFan', { mode: 'force' });
  S.command(sim, 'door', { id: 'D2', open: true });
  S.step(sim);
  assert.strictEqual(sim.alarms.shortCircuit, true, '应触发短路报警');
  var normal = S.createSimulation();
  S.command(normal, 'localFan', { mode: 'force' });
  S.step(normal);
  var baseline = Math.abs(normal.edgeById.e_duct.flow);
  assert.ok(Math.abs(sim.edgeById.e_duct.flow) < 0.7 * baseline,
    '工作面风量应显著下降');
  S.run(sim, 60);
  assert.ok(sim.nodeById.FACE.gas > S.GAS_LIMIT, '工作面应持续积聚瓦斯');
  console.log('      短路流量 ' + sim.edgeById.e_d2.flow.toFixed(1) +
    '，工作面风量 ' + Math.abs(sim.edgeById.e_duct.flow).toFixed(1) +
    '（正常 ' + baseline.toFixed(1) + '）');
});

check('错误关闭工作面回风风门会把污染推向作业面', function () {
  var sim = S.createSimulation();
  S.command(sim, 'localFan', { mode: 'force' });
  var before = sim.nodeById.FACE.gas;
  S.command(sim, 'door', { id: 'D4', open: false });
  S.run(sim, 20);
  assert.ok(sim.nodeById.FACE.gas > before, '工作面瓦斯应不降反升');
  assert.ok(sim.nodeById.FACE.gas > 1.5, '瓦斯应严重积聚');
  assert.ok(sim.alarms.list.some(function (a) {
    return a.node === 'FACE' && a.type === 'gas';
  }), '工作面应出现瓦斯报警');
  console.log('      工作面瓦斯 ' + before.toFixed(2) + '% -> ' +
    sim.nodeById.FACE.gas.toFixed(2) + '%');
});

check('抽出式局扇把污风倒灌进风巷（错误操作路径）', function () {
  var sim = S.createSimulation();
  S.command(sim, 'localFan', { mode: 'exhaust' });
  S.run(sim, 30);
  assert.ok(Math.abs(sim.edgeById.e_duct.flow) < 3, '风筒流量应被反压抑制');
  assert.ok(sim.nodeById.FACE.gas > S.GAS_LIMIT, '工作面无法有效净化');
  assert.ok(sim.nodeById.FACE.gas > 1.8, '工作面污染应持续加重');
});

if (failures > 0) {
  console.log('\n' + failures + ' 项验证失败');
  process.exit(1);
}
console.log('\n全部验证通过');
