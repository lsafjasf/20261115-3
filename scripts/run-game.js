// 无头完成一整局：自动玩家动态调度 6 辆巴士，输出改道记录与回放文件。
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createWorld, TICKS } from '../src/world.js';
import { createEngine, resultOf, hashSnapshot } from '../src/engine.js';
import { createAutoPilot } from '../src/autopilot.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const world = createWorld();
const engine = createEngine(world);
const events = [];
engine.onEvent((entry) => events.push({ ...entry }));
const pilot = createAutoPilot(world, engine);

for (let i = 0; i < TICKS; i++) {
  pilot.tick();
  engine.step();
}

const result = resultOf(engine);
const replay = {
  format: 'flood-evac-replay/1',
  seed: world.seed,
  ticks: TICKS,
  world: {
    shelterId: world.shelterId,
    residentsTotal: world.residentsTotal,
    evacTarget: world.evacTarget,
    blockedEdgeIds: world.blockedEdgeIds,
  },
  result,
  events,
  snapshots: engine.snapshots.map((s) => ({ ...s, hash: hashSnapshot(s) })),
};

mkdirSync(join(root, 'artifacts'), { recursive: true });
const out = join(root, 'artifacts', 'replay.json');
writeFileSync(out, JSON.stringify(replay, null, 1));

const reroutes = events.filter((e) => e.kind === 'reroute');
const detours = reroutes.filter((e) => e.reason !== 'initial-dispatch');
const traps = events.filter((e) => e.kind === 'trap');
const closed = events.filter((e) => e.kind === 'edge-closed');

console.log('=== 洪水撤离对局结果 ===');
console.log(`用时: ${engine.tick} tick (${(engine.tick * 10 / 60).toFixed(1)} 分钟)`);
console.log(`撤离: ${result.evacuated}/${result.total}（目标 ${result.target}，占比 ${(result.ratio * 100).toFixed(1)}%）`);
console.log(`被困巴士: ${traps.length ? traps.map((t) => t.busId).join(',') : '无'}`);
console.log(`水位切断路段: ${closed.length} 条；改道/调度指令: ${reroutes.length} 条（其中动态改道 ${detours.length} 条）`);
console.log(`道路优先级指令: ${events.filter((e) => e.kind === 'priority').length} 条`);
console.log(`结果: ${result.won ? '成功 ✔' : '失败 ✘'} — ${result.reason}`);
console.log(`回放文件: ${out}（${(JSON.stringify(replay).length / 1024).toFixed(1)} KB，快照 ${replay.snapshots.length} 份）`);
process.exit(result.won ? 0 : 1);
