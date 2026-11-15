const assert = require('assert');
const { MicrogridSim, C, GUST_EVENTS } = require('../js/sim.js');

function goodPilotControls(sim, v) {
  const c = sim.controls;
  // 大风前顺桨保命，平时放开桨距抢出力
  c.pitch = v >= C.CUT_OUT - 1.5 ? C.FEATHER_PITCH + 5 : 0;
  c.batteryMode = 'auto';
  c.batteryMw = C.BATT_MAX_MW;
  // 低电量时按顺序切掉工厂线，保住医院
  c.shedOrder = [2, 1, 0];
  if (v < 7 || sim.soc < 0.2) c.shedCount = 2;
  else if (v < 9 || sim.soc < 0.35) c.shedCount = 1;
  else c.shedCount = 0;
}

function run(controller, seed) {
  const sim = new MicrogridSim(seed);
  while (sim.status === 'ready' || sim.status === 'running') {
    const v = sim.windSpeed();
    controller(sim, v);
    sim.step();
  }
  return sim;
}

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ✓ ' + name);
}

console.log('场景 A：合格调度员（顺桨 + 自动储能 + 顺序切负荷）');
const good = run(goodPilotControls);
const gs = good.summary();
console.log(JSON.stringify(gs, null, 2));
check('完成 720 分钟', () => assert.strictEqual(gs.elapsedMin, 720));
check('零断电', () => assert.strictEqual(gs.blackoutMinutes, 0));
check('最高温度不超过安全线', () => assert.ok(gs.maxTempC <= C.T_CRIT, 'maxTemp=' + gs.maxTempC));
check('判定成功', () => assert.strictEqual(gs.success, true));
check('阵风期间无脱网（顺桨生效）', () => assert.strictEqual(gs.tripMinutes, 0));

console.log('\n场景 B：莽夫（从不顺桨、电池强行放电）');
const bad = run((sim) => {
  sim.controls.pitch = 0;
  sim.controls.batteryMode = 'discharge';
  sim.controls.batteryMw = C.BATT_MAX_MW;
  sim.controls.shedOrder = [0, 1, 2];
});
const bs = bad.summary();
console.log(JSON.stringify(bs, null, 2));
check('莽夫触发风机脱网', () => assert.ok(bs.tripMinutes > 0, 'trip=' + bs.tripMinutes));
check('莽夫最终失败', () => assert.strictEqual(bs.success, false));
check('失败原因非空', () => assert.ok(bs.failureReasons.length > 0));

console.log('\n场景 C：CSV 导出行数与时长一致');
const csv = good.toCsv();
check('CSV 含表头 + 720 行', () => assert.strictEqual(csv.trim().split('\n').length, 721));

check('阵风事件表已加载', () => assert.strictEqual(GUST_EVENTS.length, 2));
console.log('\n全部 ' + pass + ' 项断言通过');
