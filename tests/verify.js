// 无头验证：node tests/verify.js
// 1) 默认配置 vs 推荐配置的双阈值判定
// 2) 局部调整 A/B：同一需求计划下仅移动公交停靠点，对比上下游拥堵
import { Simulation, buildPlan } from '../js/engine.js';
import { DEFAULT_CONFIG, BETTER_CONFIG, THRESHOLDS } from '../js/config.js';

function run(cfg, plan) {
  const sim = new Simulation(cfg, plan);
  const peak = { EB: 0, WB: 0, NB: 0, SB: 0 };
  while (!sim.finished) {
    sim.step();
    const q = sim.queueCounts();
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], q[k]);
  }
  return { stats: sim.stats(), peak };
}

const line = () => console.log('-'.repeat(74));
const describe = c =>
  `主干绿${c.gMain}s / 支路${c.gSide}s / 行人${c.gPed}s / 公交站${c.busStopX}m / 绕行${c.detourPct}%`;

console.log(`20 分钟模拟 · 阈值：平均等待 ≤ ${THRESHOLDS.avgWait}s，最大排队 ≤ ${THRESHOLDS.maxQueue} 辆\n`);

// ---- 场景一：默认（次优）配置 ----
const plan = buildPlan();
const def = run(DEFAULT_CONFIG, plan);
line();
console.log('【默认配置】%s', describe(DEFAULT_CONFIG));
console.log('  平均等待 %ss（%s）  最大排队 %s 辆（%s）  驶离 %s 辆  人车冲突 %s',
  def.stats.avgWait.toFixed(2), def.stats.passWait ? '达标' : '超标',
  def.stats.maxQueue, def.stats.passQueue ? '达标' : '超标',
  def.stats.throughput, def.stats.conflicts);
console.log('  分方向峰值排队：东行 %s / 西行 %s / 北行 %s / 南行 %s',
  def.peak.EB, def.peak.WB, def.peak.NB, def.peak.SB);

// ---- 场景二：推荐（综合治理）配置 ----
const good = run(BETTER_CONFIG, plan);
line();
console.log('【推荐配置】%s', describe(BETTER_CONFIG));
console.log('  平均等待 %ss（%s）  最大排队 %s 辆（%s）  驶离 %s 辆  人车冲突 %s',
  good.stats.avgWait.toFixed(2), good.stats.passWait ? '达标' : '超标',
  good.stats.maxQueue, good.stats.passQueue ? '达标' : '超标',
  good.stats.throughput, good.stats.conflicts);

// ---- 场景三：局部调整 A/B（只动公交停靠点）----
const cfgA = { ...DEFAULT_CONFIG, busStopX: 560 };
const cfgB = { ...DEFAULT_CONFIG, busStopX: 850 };
const a = run(cfgA, buildPlan());
const b = run(cfgB, buildPlan());
line();
console.log('【局部调整 A/B】同一随机交通流，仅把公交停靠点 560m（紧贴路口下游）→ 850m（学校下游）');
const row = (name, r) =>
  console.log(`  ${name.padEnd(12)}${String(r.stats.avgWait.toFixed(2)).padStart(9)}` +
    `${String(r.stats.maxQueue).padStart(9)}${String(r.peak.EB).padStart(9)}` +
    `${String(r.peak.WB).padStart(9)}${String(r.stats.throughput).padStart(9)}`);
console.log(`  ${'方案'.padEnd(12)}${'均停(s)'.padStart(9)}${'总峰排'.padStart(9)}` +
  `${'东行峰'.padStart(9)}${'西行峰'.padStart(9)}${'驶离'.padStart(9)}`);
row('A 站点560m', a);
row('B 站点850m', b);
line();
const dWait = a.stats.avgWait - b.stats.avgWait;
const dQueue = a.stats.maxQueue - b.stats.maxQueue;
console.log(`  结论：平均等待下降 ${dWait.toFixed(2)}s（${(100 * dWait / a.stats.avgWait).toFixed(1)}%），` +
  `峰值排队减少 ${dQueue} 辆（${(100 * dQueue / a.stats.maxQueue).toFixed(1)}%）`);
console.log('  上游西行峰值排队 %s → %s（%s）；东行下游峰值 %s → %s；吞吐量 %s → %s',
  a.peak.WB, b.peak.WB, a.peak.WB === b.peak.WB ? '不受影响' : '同步变化',
  a.peak.EB, b.peak.EB, a.stats.throughput, b.stats.throughput);

// ---- 断言 ----
line();
const assert = (cond, msg) => console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
assert(!def.stats.passQueue, '默认配置最大排队超标（治理前存在连锁拥堵）');
assert(good.stats.passWait && good.stats.passQueue, '推荐配置两项指标均达标');
assert(b.stats.maxQueue < a.stats.maxQueue, '局部调整后峰值排队下降');
assert(b.stats.avgWait < a.stats.avgWait, '局部调整后平均等待下降');
assert(b.peak.WB <= a.peak.WB, '局部调整不恶化上游西行方向');
assert(b.stats.throughput >= a.stats.throughput - 5, '局部调整基本不损失总吞吐量');

const risk = run({ ...BETTER_CONFIG, riskPed: true }, buildPlan()).stats;
assert(risk.conflicts > good.stats.conflicts + 100,
  `错误放行显著增加人车冲突（${good.stats.conflicts} → ${risk.conflicts}）`);
assert(good.stats.conflicts === 0, `正常配时人车冲突为 0（实测 ${good.stats.conflicts}）`);
console.log('');
