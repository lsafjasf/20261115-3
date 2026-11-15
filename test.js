/* 自动对局测试：跑完一整局并验证水带破裂后的重分配。 */
'use strict';
const Sim = require('./sim.js');

let failures = 0;
function check(name, cond, detail) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

const s = Sim.createGame(42);

// --- 初始部署：两台泵中速，两条水带分别压制火点1(上)与火点2(下) ---
Sim.setPump(s, 'A', 0.7);
Sim.setPump(s, 'B', 0.7);
const h1 = Sim.layHose(s, 'B', 6, 6, 4);    // → 火点1 (6,4)
const h2 = Sim.layHose(s, 'A', 33, 33, 20); // → 火点2 (33,20)
check('初始水带铺设', h1.ok && h2.ok, JSON.stringify(h1.error || h2.error || ''));

// --- 水压力学验证：开启支路越多，主干压力越低 ---
Sim.computeHydraulics(s);
const pB_oneBranch = s.mains.B.pressure;
Sim.setBranch(s, h1.hose.id, false);
Sim.computeHydraulics(s);
const pB_zeroBranch = s.mains.B.pressure;
Sim.setBranch(s, h1.hose.id, true);
check('支路开启拉低水压', pB_oneBranch < pB_zeroBranch,
  `1支路=${pB_oneBranch.toFixed(2)}bar < 0支路=${pB_zeroBranch.toFixed(2)}bar`);

// --- 跑局：t=70 铺设第三条水带压火点3；t=90 强制水带2破裂并重分配 ---
let burstDone = false, redistribDone = false;
let flowBeforeBurst = 0, flowAfterBurst = 0, pressureDuringLeak = 0;
let fire2WaterAfterRedistrib = 0, h4 = null;
let doorClosedAt = 0;

while (s.status === 'running' && s.t < Sim.SIM_SECONDS) {
  Sim.step(s);

  if (s.t === 70) {
    const h3 = Sim.layHose(s, 'B', 22, 22, 14); // → 火点3 (22,14)
    check('第三条水带铺设', h3.ok, h3.error || '');
  }

  if (s.t === 90 && !burstDone) {
    burstDone = true;
    flowBeforeBurst = h2.hose.flow;
    Sim.burstHose(s, h2.hose.id);
    Sim.computeHydraulics(s);
    flowAfterBurst = h2.hose.flow;
    pressureDuringLeak = s.mains.A.pressure;
  }

  if (s.t === 92 && !redistribDone) {
    redistribDone = true;
    Sim.setBranch(s, h2.hose.id, false);          // 关闭破裂支路，止住泄漏
    h4 = Sim.layHose(s, 'B', 33, 33, 20);         // 从主干B 重新铺设到火点2
    Sim.setPump(s, 'A', 1.0);                     // 提高泵速补偿压力
    Sim.setPump(s, 'B', 1.0);
    check('重分配：新水带铺设', h4.ok, h4.error || '');
  }

  if (s.t === 95 && h4 && h4.ok) {
    fire2WaterAfterRedistrib = s.fires[1].water;
  }

  if (!doorClosedAt && s.stats.doorsClosed > 0) doorClosedAt = s.t;
}

// --- 结果断言 ---
console.log(`\n对局结束: t=${s.t}s 状态=${s.status} 破裂=${s.stats.bursts} 封闭通道=${s.stats.doorsClosed}`);
check('破裂导致流量崩塌', flowAfterBurst < flowBeforeBurst * 0.2,
  `破裂前=${flowBeforeBurst.toFixed(2)} 破裂后=${flowAfterBurst.toFixed(2)}`);
check('破裂泄漏拉低主干压力', pressureDuringLeak < pB_oneBranch,
  `泄漏时主干A=${pressureDuringLeak.toFixed(2)}bar`);
check('重分配后火点2恢复供水', fire2WaterAfterRedistrib > 0.5,
  `火点2受水=${fire2WaterAfterRedistrib.toFixed(2)}`);
check('烟层降低能见度', s.stats.minVis < 0.6, `最低能见度=${s.stats.minVis.toFixed(2)}`);
check('结构受热封闭通道', s.stats.doorsClosed >= 1, `封闭于 t=${doorClosedAt}s`);
check('人员全部撤离', s.workers.every(w => w.evacuated),
  `撤离=${s.workers.filter(w => w.evacuated).length}/${s.workers.length}`);
check('无人员伤亡', s.workers.every(w => !w.dead));
check('20分钟内获胜', s.status === 'won' && s.t < Sim.SIM_SECONDS, `t=${s.t}s`);

console.log(failures === 0 ? '\n全部断言通过 ✔' : `\n${failures} 条断言失败 �’`);
process.exit(failures === 0 ? 0 : 1);
