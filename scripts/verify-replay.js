// 回放验证：从 replay.json 重建确定性世界，逐条重放玩家指令，
// 逐分钟比对快照哈希，确认改道记录可被完整、确定地回放。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createWorld, TICKS } from '../src/world.js';
import { createEngine, resultOf, hashSnapshot } from '../src/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const replay = JSON.parse(readFileSync(join(root, 'artifacts', 'replay.json'), 'utf8'));

const world = createWorld(replay.seed);
const engine = createEngine(world);

// 校验世界元数据一致
const checks = [
  ['shelterId', world.shelterId === replay.world.shelterId],
  ['residentsTotal', world.residentsTotal === replay.world.residentsTotal],
  ['evacTarget', world.evacTarget === replay.world.evacTarget],
  ['blockedEdges', JSON.stringify(world.blockedEdgeIds) === JSON.stringify(replay.world.blockedEdgeIds)],
];

// 按 tick 分组重放玩家指令（事件本身已按时间顺序记录）
const byTick = new Map();
for (const ev of replay.events) {
  if (!byTick.has(ev.tick)) byTick.set(ev.tick, []);
  byTick.get(ev.tick).push(ev);
}

let applied = 0;
const reroutes = [];
for (let tick = 0; tick < TICKS; tick++) {
  for (const ev of byTick.get(tick) ?? []) {
    if (ev.kind === 'priority') {
      engine.setPriority(ev.edgeId, ev.level, ev.source);
      applied += 1;
    } else if (ev.kind === 'reroute') {
      const ok = engine.reroute(ev.busId, ev.path, ev.source, ev.reason);
      if (!ok) throw new Error(`tick ${tick} 改道重放失败: ${JSON.stringify(ev)}`);
      reroutes.push(ev);
      applied += 1;
    } else if (ev.kind === 'depart-now') {
      engine.departNow(ev.busId, ev.source);
      applied += 1;
    }
    // board/unload/trap/edge-closed/route-halted 为引擎派生事件，不回放
  }
  engine.step();
}

// 逐快照比对
const liveSnapshots = engine.snapshots.map((s) => ({ ...s, hash: hashSnapshot(s) }));
let matched = 0;
const mismatches = [];
for (let i = 0; i < replay.snapshots.length; i++) {
  const a = replay.snapshots[i];
  const b = liveSnapshots[i];
  if (a.hash === b.hash) matched += 1;
  else mismatches.push({ tick: a.tick, recorded: a.hash, replay: b.hash });
}

const result = resultOf(engine);
const detours = reroutes.filter((e) => e.reason !== 'initial-dispatch');

console.log('=== 改道回放验证 ===');
for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✘'} 世界一致性 ${name}`);
console.log(`重放玩家指令: ${applied} 条（改道 ${reroutes.length}，其中动态改道 ${detours.length}）`);
console.log(`快照匹配: ${matched}/${replay.snapshots.length}`);
if (mismatches.length) {
  console.log('哈希不一致:', mismatches.slice(0, 5));
  process.exit(1);
}
console.log(`回放终局: 撤离 ${result.evacuated}/${result.total}，被困 [${result.trapped}]，` +
  `won=${result.won}`);
if (result.won !== replay.result.won || result.evacuated !== replay.result.evacuated) {
  console.log('✘ 回放终局与原局不一致');
  process.exit(1);
}
console.log('✔ 改道记录可完整、确定性回放，终局与原局一致');
