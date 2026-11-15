// 页面内自检：三个声源位置 × 三种模式，验证模式切换后声源坐标不重置，
// 并比较距离对延迟/增益/频段的影响。逻辑与 test/verify.js 完全一致。

import { makeState, withMode, computeSpatialModel, MODES } from './engine.js';
import { renderToWav, readWavHeader } from './renderer.js';

export const THREE_POSITIONS = [
  { name: 'P1 近场左前', source: { x: 2.2, y: 1.6 } },
  { name: 'P2 中场对角', source: { x: 2.0, y: 1.0 } },
  { name: 'P3 远场右后', source: { x: 6.8, y: 5.1 } },
];

export function runSelfTest() {
  const lines = [];
  let allPass = true;

  for (const pos of THREE_POSITIONS) {
    const state = makeState({ source: { ...pos.source }, mode: 'stereo' });
    lines.push(`\n=== ${pos.name}  起始坐标 (${state.source.x}, ${state.source.y}) ===`);
    const rows = [];

    for (const mode of Object.keys(MODES)) {
      const switched = withMode(state, mode);
      const preserved = switched.source.x === pos.source.x && switched.source.y === pos.source.y;
      allPass &&= preserved;
      const model = computeSpatialModel(switched);
      const wav = renderToWav(model, { durationSec: 1, signalType: 'sine' });
      const header = readWavHeader(wav.wav);
      const d = model.direct;
      rows.push(
        `${mode.padEnd(9)} 坐标(${model.source.x},${model.source.y}) 保持:${preserved ? 'PASS' : 'FAIL'} ` +
        `距离:${d.distance}m 延迟:${d.delayMs}ms 增益:${d.distanceGain} 低通:${d.lowpassHz}Hz ` +
        `WAV:${header.channels}ch/${header.sampleRate}Hz`);
    }
    lines.push(...rows);
  }

  // 单调性验证：三个位置直达距离递增 → 延迟递增、增益递减、低通递减
  const compare = THREE_POSITIONS.map((p) => {
    const model = computeSpatialModel(makeState({ source: p.source }));
    return model.direct;
  });
  const mono =
    compare[1].delayMs > compare[0].delayMs && compare[2].delayMs > compare[1].delayMs &&
    compare[1].distanceGain < compare[0].distanceGain && compare[2].distanceGain < compare[1].distanceGain &&
    compare[1].lowpassHz <= compare[0].lowpassHz && compare[2].lowpassHz <= compare[1].lowpassHz;
  allPass &&= mono;
  lines.push(`\n距离→延迟递增/增益递减/低通递减: ${mono ? 'PASS' : 'FAIL'}`);
  lines.push(`\n总体结果: ${allPass ? '全部 PASS ✅' : '存在 FAIL ❌'}`);
  return { text: lines.join('\n'), pass: allPass };
}

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('selftestBtn');
  const out = document.getElementById('selftestOut');
  btn.addEventListener('click', () => {
    const result = runSelfTest();
    out.textContent = result.text;
  });
});
