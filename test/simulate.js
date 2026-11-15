// 自动测试：1) 自动策略打完整三小时模拟并获胜  2) 货梯抢占冲突
const { HospitalGame } = require('../src/core.js');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
}

// ---------- 用例一：货梯抢占冲突 ----------
function testElevatorPreemption() {
  console.log('\n[用例1] 货梯抢占冲突');
  const g = new HospitalGame({ seed: 7 });
  const cold = g.orders.find(o => o.cold);
  g.enqueueOrder(cold.id);

  // 先让配送员完成拣货、进入候梯状态，再派梯
  let guard = 0;
  while (!g.couriers.some(c => c.state === 'waiting') && guard++ < 2000) g.step(0.1);
  g.addStop('A', 1);
  g.addStop('A', cold.destFloor);

  // 推进模拟直到冷链订单装上货梯 A
  guard = 0;
  while (!g.elevator('A').load.some(it => it.orderId === cold.id) && guard++ < 2000) g.step(0.1);
  const elevA = g.elevator('A');
  assert(elevA.load.some(it => it.orderId === cold.id), '冷链订单已装上货梯A，电梯状态=' + elevA.state);
  assert(elevA.state === 'moving', '货梯A正在运行中（构成抢占前提）');

  // 非强制抢占：应被拒绝并记录冲突
  const r1 = g.preempt('A', 6);
  assert(!r1.ok && r1.reason === 'cold-aboard', '载有冷链货物的运行中货梯拒绝非强制抢占');
  assert(g.log.some(l => l.type === 'preempt-conflict'), '事件日志记录了 preempt-conflict');
  assert(elevA.stops[0] === cold.destFloor, '被拒绝后原停靠队列不变，下一站仍是 ' + cold.destFloor + 'F');

  // 强制抢占：成功但标记冷链风险，原停靠被顺延
  const r2 = g.preempt('A', 6, { force: true });
  assert(r2.ok && Array.isArray(r2.displaced) && r2.displaced[0] === cold.destFloor, '强制抢占成功，原停靠被顺延');
  assert(elevA.stops[0] === 6 && elevA.coldRisk === true, '货梯A改道6F且进入冷链风险状态');
  assert(g.log.some(l => l.type === 'preempt-forced'), '事件日志记录了 preempt-forced');

  // 冷链风险状态下，货物离库计时加倍
  const before = cold.outOfColdMin;
  for (let i = 0; i < 5 && elevA.load.some(it => it.orderId === cold.id); i++) g.step(0.1);
  const gained = cold.outOfColdMin - before;
  assert(gained > 0.9 && gained <= 1.1, '冷链风险下升温加倍（0.5分钟计入 ' + gained.toFixed(2) + ' 分钟）');

  // 空载货梯 B 可被自由抢占，无冲突
  const r3 = g.preempt('B', 5);
  assert(r3.ok && !r3.coldRisk && g.elevator('B').stops[0] === 5, '空载货梯B抢占成功且无冷链风险');
}

// ---------- 用例二：自动策略打完整局 ----------
function autoPolicy(g) {
  // 1) 按截止时间排序安排出库
  g.orders.filter(o => o.status === 'pending')
    .sort((a, b) => a.deadline - b.deadline)
    .forEach(o => g.enqueueOrder(o.id));

  // 2) 计算需要的停靠楼层
  const dests = new Set();
  g.orders.forEach(o => {
    if (['queued', 'picking', 'in-transit'].includes(o.status)) dests.add(o.destFloor);
  });
  const needPickup = g.outboundQueue.length > 0 || g.couriers.some(c => c.state === 'waiting');

  g.elevators.forEach(e => {
    if (needPickup && !e.stops.includes(1)) g.addStop(e.id, 1);
    dests.forEach(d => { if (!e.stops.includes(d)) g.addStop(e.id, d); });
  });

  // 3) 常温架上的冷链物品移入冷藏柜
  for (let f = 1; f <= g.cfg.floors; f++) {
    g.storage[f].rack.slice().forEach(r => { if (r.cold) g.moveToFridge(f, r.orderId); });
  }

  // 4) 有紧急订单且没有货梯回1F时，抢占较空的一部
  const urgent = g.orders.some(o => o.priority === 3 && ['pending', 'queued'].includes(o.status));
  if (urgent && !g.elevators.some(e => e.stops.includes(1) || e.floor === 1)) {
    const target = g.elevators.slice().sort((a, b) => a.stops.length - b.stops.length)[0];
    const r = g.preempt(target.id, 1);
    if (!r.ok) g.preempt(target.id, 1, { force: true });
  }
}

function testFullGame() {
  console.log('\n[用例2] 自动策略完成三小时模拟');
  const g = new HospitalGame({ seed: 20261115 });
  let ticks = 0;
  while (!g.over && ticks++ < 30000) {
    autoPolicy(g);
    g.step(0.1);
  }
  const res = g.result();
  console.log('  结果:', JSON.stringify(res));
  assert(g.over, '模拟正常结束，用时 ' + res.timeMin + ' 分钟');
  assert(res.failedNeeds === 0, '无手术需求失败、无STAT超时');
  assert(res.spoilRate < g.cfg.spoilThreshold, '报废率 ' + (res.spoilRate * 100).toFixed(1) + '% 低于阈值 ' + (g.cfg.spoilThreshold * 100) + '%');
  assert(res.win, '整局判定：成功');
  const statEvents = g.log.filter(l => l.type === 'stat').length;
  assert(statEvents > 0, '模拟期间发生了 ' + statEvents + ' 次动态事件（STAT/术中变化）');
}

testElevatorPreemption();
testFullGame();

console.log('\n' + (failures ? failures + ' 项断言失败' : '全部断言通过'));
process.exit(failures ? 1 : 0);
