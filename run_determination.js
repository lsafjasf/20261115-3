/* 实际执行一次完整判定，并导出各传感器贡献记录到 artifacts/ */
'use strict';
const fs = require('fs');
const path = require('path');
const SIM = require('./sim.js');

function fmt(t) {
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 玩家配置：滑动平均滤波 + 等权重 + 90 秒持续判据
const cfg = SIM.defaultConfig();
const r = SIM.run(cfg);

console.log('=== 火山监测站 6 小时融合判定 ===');
console.log(`喷发时刻 ${fmt(SIM.ERUPTION_T)}，有效窗口 ${SIM.VALID_WINDOW / 3600}h`);
r.alerts.forEach((a, i) => {
  console.log(`报警#${i + 1}: ${fmt(a.start)} ~ ${fmt(a.end)}  提前量 ${(a.leadSec / 60).toFixed(1)}min  ${a.valid ? '有效' : '误报'}`);
});
console.log(`有效预警 ${r.validAlerts} 次，误报 ${r.falseAlarms} 次 => ${r.success ? '判定成功 ✅' : '判定失败 ❌'}`);
console.table(r.contributions);

const record = {
  exportedAt: new Date().toISOString(),
  scenario: {
    durationSec: SIM.DURATION, eruptionT: SIM.ERUPTION_T,
    precursorT0: SIM.PRECURSOR_T0, validWindowSec: SIM.VALID_WINDOW
  },
  config: r.config,
  determination: {
    alerts: r.alerts.map(a => ({
      startT: fmt(a.start), endT: fmt(a.end),
      leadMin: +(a.leadSec / 60).toFixed(1), valid: a.valid
    })),
    validAlerts: r.validAlerts, falseAlarms: r.falseAlarms, success: r.success
  },
  sensorContributions: r.contributions
};

const outDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'sensor_contributions.json'), JSON.stringify(record, null, 2));

const head = 'sensor,name,weight,threshold,filter,window,activeSec,noiseTriggeredSec,peakNorm,contribShare';
const csv = [head].concat(r.contributions.map(c =>
  [c.sensor, c.name, c.weight, c.threshold, c.filter, c.window,
   c.activeSec, c.noiseTriggeredSec, c.peakNorm, c.contribShare].join(',')
)).join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'sensor_contributions.csv'), csv);

console.log('已导出: artifacts/sensor_contributions.json, artifacts/sensor_contributions.csv');
process.exit(r.success ? 0 : 1);
