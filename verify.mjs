// 验证脚本：实际渲染三段音效 -> 按顺序播放(渲染) -> 检测节点泄漏 -> 导出混音 WAV
import { OfflineAudioContext } from 'node-web-audio-api';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { SfxEngine } from './src/engine.js';
import { PRESETS, PRESET_ORDER } from './src/presets.js';
import { encodeWav, concatenateBuffers } from './src/wav.js';

const SR = 44100;
const STORE_FILE = new URL('./artifacts/saved-chains.json', import.meta.url).pathname;

// 用文件模拟 localStorage，验证“保存模块链”功能
const fileStorage = {
  getItem: (k) => (existsSync(STORE_FILE) ? JSON.parse(readFileSync(STORE_FILE, 'utf8'))[k] ?? null : null),
  setItem: (k, v) => writeFileSync(STORE_FILE, JSON.stringify({ [k]: v })),
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

function rms(buffer) {
  const d = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  return Math.sqrt(sum / d.length);
}

async function renderSfx(name, def) {
  const ctx = new OfflineAudioContext(1, Math.ceil((def.duration + 0.3) * SR), SR);
  const engine = new SfxEngine(ctx);
  engine.play(name, def, 0);
  const nodesWhilePlaying = engine.activeNodeCount;
  const buffer = await ctx.startRendering();
  engine.stop(); // 播放完毕销毁链
  return { buffer, nodesWhilePlaying, nodesAfterStop: engine.activeNodeCount };
}

console.log('== 1. 依次渲染三种音效（开门 -> 脚步 -> 金属碰撞）==');
const rendered = [];
for (const name of PRESET_ORDER) {
  const def = PRESETS[name];
  const { buffer, nodesWhilePlaying, nodesAfterStop } = await renderSfx(name, def);
  rendered.push(buffer);
  const level = rms(buffer);
  check(`${def.label}: 渲染出声`, level > 0.001, `RMS=${level.toFixed(4)}`);
  check(`${def.label}: 播放中节点已登记`, nodesWhilePlaying > 0, `${nodesWhilePlaying} 个节点`);
  check(`${def.label}: 停止后无节点泄漏`, nodesAfterStop === 0, `剩余 ${nodesAfterStop}`);
  writeFileSync(new URL(`./artifacts/${name}.wav`, import.meta.url).pathname, Buffer.from(encodeWav(buffer)));
}

console.log('\n== 2. 同一上下文内切换音效，旧链必须完全销毁 ==');
{
  const ctx = new OfflineAudioContext(1, SR * 4, SR);
  const engine = new SfxEngine(ctx);
  engine.play('door', PRESETS.door, 0);
  const doorNodes = engine.activeNodeCount;
  engine.play('footsteps', PRESETS.footsteps, 0); // 切换：内部先 stop 旧链
  const afterSwitch = engine.activeNodeCount;
  check('切换后旧链节点全部移除', afterSwitch > 0 && afterSwitch !== doorNodes,
    `door=${doorNodes} -> footsteps=${afterSwitch}`);
  engine.play('metal', PRESETS.metal, 0);
  engine.stop();
  check('全部停止后注册表清零', engine.activeNodeCount === 0, `剩余 ${engine.activeNodeCount}`);
  await ctx.startRendering();
}

console.log('\n== 3. 保存 / 读取模块链 ==');
{
  const ctx = new OfflineAudioContext(1, SR, SR);
  const engine = new SfxEngine(ctx, fileStorage);
  for (const name of PRESET_ORDER) engine.saveChain(name, PRESETS[name]);
  const loaded = engine.loadAllChains();
  const ok = PRESET_ORDER.every((n) => JSON.stringify(loaded[n]) === JSON.stringify(PRESETS[n]));
  check('三条模块链保存并可完整读回', ok);
  engine.stop();
}

console.log('\n== 4. 导出顺序混音 WAV ==');
{
  const mixCtx = new OfflineAudioContext(1, SR, SR);
  const mix = concatenateBuffers(mixCtx, rendered, 0.2);
  const wav = encodeWav(mix);
  const path = new URL('./artifacts/mix.wav', import.meta.url).pathname;
  writeFileSync(path, Buffer.from(wav));
  check('混音 WAV 已导出', wav.byteLength > 44,
    `mix.wav ${(wav.byteLength / 1024).toFixed(1)} KB, ${(mix.length / SR).toFixed(2)}s`);
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
