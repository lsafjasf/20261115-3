// 验证脚本:1) 寒潮控制 2) 能量枯竭
const Sim = require("./sim.js");

function fmt(t) {
  const h = Math.floor(t / 60), m = t % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// 合理策略:按需求控制锅炉/补光/水泵
function smartPolicy(s) {
  const c = s.ctrl;
  const cold = Sim.coldSnapDrop(s, s.timeMin) > 0;
  // 锅炉:任一温区低于作物下限+2 或寒潮时开启
  const needHeat = s.zones.some((z) => z.temp < z.crop.tMin + 2);
  c.boilerOn = needHeat || (cold && s.zones.some((z) => z.temp < z.crop.tMin + 5));
  // 热量分配给最冷的区
  const defs = s.zones.map((z) => Math.max(0.05, z.crop.tMin + 4 - z.temp));
  const sum = defs[0] + defs[1] + defs[2];
  c.heatAlloc = defs.map((d) => d / sum);
  // 水泵:任一区缺水时开,全部补足才关(滞回避免频繁切换)
  const thirsty = s.zones.some((z) => z.moisture < z.crop.waterNeed - 0.1);
  const allFull = s.zones.every((z) => z.moisture > z.crop.waterNeed + 0.1);
  if (thirsty) c.pumpOn = true;
  else if (allFull) c.pumpOn = false;
  c.valve = s.zones.map((z) => (z.moisture < z.crop.waterNeed ? 0.7 : 0.1));
  // 补光:白天自然光不足时开,夜间关闭以省电
  const nat = Sim.naturalLight(s.timeMin);
  c.lightOn = s.zones.map((z) => nat > 0.05 && z.light < z.crop.lightNeed);
  // 遮阳:温度过高时启用
  c.shade = s.zones.map((z) => (z.temp > z.crop.tMax - 1 ? 0.7 : 0));
}

// 浪费策略:补光与水泵全开(电力设备)
function wastefulPolicy(s) {
  const c = s.ctrl;
  c.pumpOn = true;
  c.valve = [1, 1, 1];
  c.lightOn = [true, true, true];
  c.heatAlloc = [1 / 3, 1 / 3, 1 / 3];
}

function run(policy, opts) {
  const s = Sim.createState(opts);
  const trace = { minBattery: 100, blackoutAt: null, minTempDuringSnap: [99, 99, 99], snapChecked: false };
  while (s.timeMin < Sim.DAY_MIN && !s.failed) {
    policy(s);
    Sim.step(s);
    trace.minBattery = Math.min(trace.minBattery, s.battery);
    if (s.blackout && trace.blackoutAt === null) trace.blackoutAt = s.timeMin;
    if (Sim.coldSnapDrop(s, s.timeMin) > 0) {
      trace.snapChecked = true;
      s.zones.forEach((z, i) => { trace.minTempDuringSnap[i] = Math.min(trace.minTempDuringSnap[i], z.temp); });
    }
  }
  return { s, trace };
}

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}

// ===== 场景一:寒潮控制 =====
console.log("--- 场景一:寒潮控制(17:00-21:00 降温 14℃) ---");
{
  const { s, trace } = run(smartPolicy);
  check("寒潮确实发生并被监测", trace.snapChecked);
  s.zones.forEach((z, i) =>
    check("寒潮中" + z.crop.name + "温度不低于下限-3℃", trace.minTempDuringSnap[i] >= z.crop.tMin - 3,
      "最低 " + trace.minTempDuringSnap[i].toFixed(1) + "℃ / 下限 " + z.crop.tMin + "℃"));
  s.zones.forEach((z) =>
    check(z.crop.name + "保持健康(>=50)", z.health >= 50, "health=" + z.health.toFixed(1) + " 阶段=" + z.crop.stages[z.stage]));
  check("24 小时结束保留至少两成电量", s.battery >= 20, "battery=" + s.battery.toFixed(1) + "%");
  check("作物全部存活", !s.failed, s.failReason);
  check("判定成功", Sim.isWin(s));
}

// ===== 场景二:能量枯竭 =====
console.log("--- 场景二:能量枯竭(设备全开) ---");
{
  const { s, trace } = run(wastefulPolicy);
  check("发生断电(电量枯竭)", trace.blackoutAt !== null, "断电时刻 " + (trace.blackoutAt !== null ? fmt(trace.blackoutAt) : "无"));
  check("电量曾降至 1% 以下", trace.minBattery < 1, "min=" + trace.minBattery.toFixed(2) + "%");
  check("无法达成成功条件", !Sim.isWin(s), "battery=" + s.battery.toFixed(1) + "% failed=" + s.failed);
}

console.log(failures === 0 ? "\n全部验证通过 ✔" : "\n有 " + failures + " 项未通过 ✘");
process.exit(failures === 0 ? 0 : 1);
