// 确定性测试：两个独立引擎执行相同的改道/优先级指令流，逐 tick 快照哈希必须完全一致。
import { createWorld } from '../src/world.js';
import { createEngine, findSafeRoute, hashSnapshot } from '../src/engine.js';
import { createAutoPilot } from '../src/autopilot.js';

// 阶段一：实例 A 由自动玩家完整跑一局，记录全部玩家指令
const worldA = createWorld();
const engineA = createEngine(worldA);
const commands = [];
engineA.onEvent((ev) => {
  if (ev.kind === 'reroute' || ev.kind === 'priority' || ev.kind === 'depart-now') {
    commands.push(JSON.parse(JSON.stringify(ev)));
  }
}, true);
const pilotA = createAutoPilot(worldA, engineA);
for (let i = 0; i < 180; i++) {
  pilotA.tick();
  engineA.step();
}
const hashesA = engineA.snapshots.map((s) => hashSnapshot(s));

// 阶段二：实例 B 从零开始，仅按记录的指令重放
const worldB = createWorld();
const engineB = createEngine(worldB);
let cursor = 0;
for (let tick = 0; tick < 180; tick++) {
  while (cursor < commands.length && commands[cursor].tick === tick) {
    const ev = commands[cursor++];
    if (ev.kind === 'priority') engineB.setPriority(ev.edgeId, ev.level, ev.source);
    else if (ev.kind === 'reroute') engineB.reroute(ev.busId, ev.path, ev.source, ev.reason);
    else if (ev.kind === 'depart-now') engineB.departNow(ev.busId, ev.source);
  }
  engineB.step();
}
const hashesB = engineB.snapshots.map((s) => hashSnapshot(s));

for (let i = 0; i < hashesA.length; i++) {
  if (hashesA[i] !== hashesB[i]) {
    console.error(`✘ 快照 #${i} 哈希分叉: ${hashesA[i]} != ${hashesB[i]}`);
    process.exit(1);
  }
}

if (engineA.evacuated !== engineB.evacuated || engineA.trapped.length !== engineB.trapped.length) {
  console.error('✘ 终局不一致');
  process.exit(1);
}

// 确认 findSafeRoute 对相同输入稳定
const route1 = findSafeRoute(worldA, 18, 7, 0, 0);
const route2 = findSafeRoute(worldA, 18, 7, 0, 0);
if (JSON.stringify(route1) !== JSON.stringify(route2)) {
  console.error('✘ 路径搜索不稳定');
  process.exit(1);
}

console.log(`✔ 确定性测试通过：${commands.length} 条指令重放，180 个 tick 哈希全一致，` +
  `撤离 ${engineB.evacuated} 人，被困 ${engineB.trapped.length} 辆`);
