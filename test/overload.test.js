// 验证：发电机启动顺序错误 → 母线过载；顺序正确 → 正常带载。
const assert = require('assert');
const CampSim = require('../js/sim.js');

function settle(sim, n) { for (let i = 0; i < n; i++) sim.tick(); }

// 场景 1：错误顺序 —— 未预热、未点火空载，直接接载
{
  const sim = new CampSim(42);
  settle(sim, 3);
  const before = sim.battery.charge;
  const ok = sim.genConnectLoad();
  assert.strictEqual(ok, false, '错误顺序下接载应被拒绝');
  const overload = sim.events.find(e => e.type === 'OVERLOAD');
  assert.ok(overload, '应记录 OVERLOAD 事件');
  assert.strictEqual(sim.gen.state, 'OFF', '过载后发电机应跳闸回 OFF');
  assert.strictEqual(sim.gen.loadConnected, false, '过载后负载不应接入');
  assert.ok(sim.battery.charge <= before - 2.9, '电池应承受约 3kWh 冲击损耗');
  assert.strictEqual(sim.busFaultTicks, 1, '母线应进入故障 tick');
  console.log('PASS 场景1 错误顺序触发过载:', overload.msg);
}

// 场景 2：错误顺序 —— 预热未完成就点火，然后接载
{
  const sim = new CampSim(7);
  sim.genPreheat();
  const crankOk = sim.genCrank();
  assert.strictEqual(crankOk, false, '预热未完成点火应失败');
  assert.strictEqual(sim.gen.state, 'OFF');
  const ok = sim.genConnectLoad();
  assert.strictEqual(ok, false);
  assert.ok(sim.events.some(e => e.type === 'OVERLOAD'), '仍应触发过载');
  console.log('PASS 场景2 预热不足点火失败 + 接载过载');
}

// 场景 3：正确顺序 —— 预热 → 等待 → 点火 → 接载，无过载
{
  const sim = new CampSim(99);
  sim.genPreheat();
  settle(sim, 2);
  assert.strictEqual(sim.gen.state, 'READY');
  assert.strictEqual(sim.genCrank(), true);
  assert.strictEqual(sim.gen.state, 'ONLINE');
  assert.strictEqual(sim.genConnectLoad(), true, '正确顺序接载应成功');
  assert.ok(!sim.events.some(e => e.type === 'OVERLOAD'), '不应出现过载');
  const fuelBefore = sim.gen.fuelL;
  settle(sim, 6);
  assert.ok(sim.gen.fuelL < fuelBefore, '带载运转应消耗燃料');
  assert.ok(sim.lastBalance.gen > 0, '发电机应向母线供电');
  console.log('PASS 场景3 正确顺序无过载，剩余燃料:', sim.gen.fuelL.toFixed(1) + 'L');
}

console.log('全部通过：发电机启动顺序错误造成的过载已验证。');
