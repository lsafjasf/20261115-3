// Node 端验证：
// 1) 三个声源位置分别切换 stereo/binaural/quad，坐标必须保持不变；
// 2) 比较三位置的距离、延迟、增益、低通与频段增益的单调性；
// 3) 导出 WAV 头校验声道数，参数 JSON 可序列化且坐标一致；
// 4) 产物写入 artifacts/。

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeState, withMode, computeSpatialModel, MODES } from '../js/engine.js';
import { renderToWav, readWavHeader } from '../js/renderer.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'artifacts');

const THREE_POSITIONS = [
  { name: 'P1-near', label: 'P1 近场左前', source: { x: 2.2, y: 1.6 } },
  { name: 'P2-mid', label: 'P2 中场对角', source: { x: 2.0, y: 1.0 } },
  { name: 'P3-far', label: 'P3 远场右后', source: { x: 6.8, y: 5.1 } },
];

const failures = [];
const assert = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${msg}`);
};

async function main() {
  await mkdir(outDir, { recursive: true });
  const comparison = [];

  for (const pos of THREE_POSITIONS) {
    console.log(`\n=== ${pos.label} 起始 (${pos.source.x}, ${pos.source.y}) ===`);
    const base = makeState({ source: { ...pos.source }, mode: 'stereo' });
    const row = { position: pos.label, source: { ...pos.source }, modes: {} };

    for (const mode of Object.keys(MODES)) {
      const switched = withMode(base, mode);
      assert(
        switched.source.x === pos.source.x && switched.source.y === pos.source.y,
        `${mode}: 切换后声源仍在 (${pos.source.x}, ${pos.source.y})`);

      const model = computeSpatialModel(switched);
      const rendered = renderToWav(model, { durationSec: 1, signalType: 'sine' });
      const header = readWavHeader(rendered.wav);
      const expectedCh = MODES[mode].channels;
      assert(header.channels === expectedCh, `${mode}: WAV 声道数 = ${expectedCh}`);
      assert(header.sampleRate === rendered.sampleRate, `${mode}: WAV 采样率 = ${rendered.sampleRate}`);
      assert(header.totalSize === 44 + header.dataSize, `${mode}: WAV 尺寸与数据块一致`);

      const json = buildJson(model, rendered, pos.label);
      const text = JSON.stringify(json);
      const reparsed = JSON.parse(text);
      assert(
        reparsed.geometry.source.x === pos.source.x && reparsed.geometry.source.y === pos.source.y,
        `${mode}: JSON 中声源坐标与原坐标一致`);

      const stem = `${pos.name}_${mode}`;
      await writeFile(join(outDir, `${stem}.wav`), rendered.wav);
      await writeFile(join(outDir, `${stem}.json`), text);

      row.modes[mode] = {
        channels: expectedCh,
        source: { ...model.source },
        distance: model.direct.distance,
        delayMs: model.direct.delayMs,
        distanceGain: model.direct.distanceGain,
        lowpassHz: model.direct.lowpassHz,
        bandGains: model.direct.bandGains,
        channelSummaries: model.channelSummaries,
      };
    }
    comparison.push(row);
  }

  console.log('\n=== 三位置声学参数比较（stereo 直达声）===');
  console.table(comparison.map((r) => ({
    位置: r.position,
    坐标: `(${r.source.x},${r.source.y})`,
    距离m: r.modes.stereo.distance,
    延迟ms: r.modes.stereo.delayMs,
    距离增益: r.modes.stereo.distanceGain,
    低通Hz: r.modes.stereo.lowpassHz,
    低频: r.modes.stereo.bandGains.low,
    中频: r.modes.stereo.bandGains.mid,
    高频: r.modes.stereo.bandGains.high,
  })));

  const s = comparison.map((r) => r.modes.stereo);
  console.log('\n=== 距离单调性验证 ===');
  assert(s[1].delayMs > s[0].delayMs && s[2].delayMs > s[1].delayMs, '延迟随距离递增');
  assert(s[1].distanceGain < s[0].distanceGain && s[2].distanceGain < s[1].distanceGain, '增益随距离递减');
  assert(s[1].lowpassHz <= s[0].lowpassHz && s[2].lowpassHz <= s[1].lowpassHz, '低通截止随距离递减');
  assert(s[0].bandGains.high > s[2].bandGains.high, '高频吸收强于近场（P1 高频增益 > P3）');
  assert(s[0].bandGains.low > s[2].bandGains.low, '低频同样随距离衰减（P1 > P3）');

  // 双耳 ITD 与四点扇区的差异化检查
  const bin = comparison[0].modes.binaural.channelSummaries;
  assert(bin[0].minDelayMs !== bin[1].minDelayMs, '双耳模式左右耳延迟不同（ITD 生效）');
  const quad = comparison[0].modes.quad.channelSummaries;
  const silent = quad.filter((c) => c.totalGain === 0).length;
  assert(silent >= 1, '四点环绕对侧扬声器存在零增益扇区（VBAP 风格分配生效）');

  await writeFile(join(outDir, 'comparison.json'), JSON.stringify(comparison, null, 2));

  console.log(`\n产物目录: ${outDir}`);
  if (failures.length) {
    console.error(`\n${failures.length} 项失败:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\n全部验证通过 ✅');
}

function buildJson(model, rendered, positionLabel) {
  return {
    schemaVersion: 1,
    positionLabel,
    exportedAt: model.generatedAt,
    mode: model.mode,
    modeLabel: model.modeLabel,
    channels: model.channels,
    sampleRate: rendered.sampleRate,
    signal: { type: 'sine', durationSec: 1 },
    geometry: {
      room: model.room,
      listener: model.listener,
      source: model.source,
      wallDistances: model.wallDistances,
    },
    options: model.options,
    direct: model.direct,
    reflections: model.reflections,
    channelSummaries: model.channelSummaries,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
