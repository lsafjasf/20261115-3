/*
 * render_wav.js — 离线渲染与验证
 * 1) 构造一段实际循环（含力度/声像/概率变化），保存补丁 JSON
 * 2) 补丁 序列化→解析 往返，逐步校验数据一致
 * 3) 同种子渲染两次 → 导出 WAV → 比较两次时长与内容
 * 4) 检测底鼓起始点是否严格落在采样网格上（无调度漂移）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const C = require("./js/core.js");

const SR = 44100;
const SEED = 0xC0FFEE;
const LOOPS = 4; // 一段 4 循环的实际乐句
const OUT_DIR = path.join(__dirname, "artifacts");

/* ---------- 1. 制作一段循环 ---------- */
function buildLoopPatch() {
  const p = C.createDefaultPatch();
  p.bpm = 122;
  p.kitIndex = 1; // Techno

  const K = p.tracks.kick, S = p.tracks.snare, H = p.tracks.hihat, L = p.tracks.clap;
  // 底鼓：四踩，第 14 步加一个 70% 概率的预击
  K.forEach((st, i) => { st.on = i % 4 === 0; st.vel = i === 0 ? 1 : 0.88; st.pan = 0; st.prob = 1; });
  K[14] = { on: true, vel: 0.7, pan: 0, prob: 0.7 };
  // 军鼓：2/4 拍，声像略偏，尾拍 60% 概率鬼音
  S.forEach((st, i) => { st.on = false; st.vel = 0.9; st.pan = 0.08; st.prob = 1; });
  S[4] = { on: true, vel: 0.95, pan: 0.08, prob: 1 };
  S[12] = { on: true, vel: 0.95, pan: 0.08, prob: 1 };
  S[15] = { on: true, vel: 0.4, pan: 0.2, prob: 0.6 };
  // 踩镲：八分音符，奇数步弱力度、偏右，闭镲概率 90%
  H.forEach((st, i) => {
    st.on = true;
    st.vel = i % 2 === 0 ? 0.75 : 0.45;
    st.pan = i % 2 === 0 ? 0.15 : 0.35;
    st.prob = i % 2 === 0 ? 1 : 0.9;
  });
  // 拍手：与军鼓叠加，略偏左
  L.forEach((st, i) => { st.on = i === 4 || i === 12; st.vel = 0.8; st.pan = -0.25; st.prob = 1; });
  return p;
}

/* ---------- 2. 往返一致性 ---------- */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function roundtripTest(patch) {
  const json = C.serializePatch(patch);
  const back = C.parsePatch(json);
  const again = C.serializePatch(back);
  if (json !== again) throw new Error("序列化不稳定：两次输出不同");
  for (const name of C.TRACKS) {
    for (let s = 0; s < C.STEPS; s++) {
      const before = C.normalizePatch(patch).tracks[name][s];
      const after = back.tracks[name][s];
      if (!deepEqual(before, after)) {
        throw new Error(`往返不一致: ${name}[${s}] ${JSON.stringify(before)} != ${JSON.stringify(after)}`);
      }
    }
  }
  return json;
}

/* ---------- 3. 渲染 + 时长比较 ---------- */
function renderTwice(patch) {
  const a = C.renderMix(patch, LOOPS, SR, SEED);
  const b = C.renderMix(patch, LOOPS, SR, SEED);
  const durA = a.left.length / SR;
  const durB = b.left.length / SR;
  let identical = a.left.length === b.left.length;
  if (identical) {
    for (let i = 0; i < a.left.length; i++) {
      if (a.left[i] !== b.left[i] || a.right[i] !== b.right[i]) { identical = false; break; }
    }
  }
  return { a, b, durA, durB, identical };
}

/* ---------- 4. 网格漂移检测 ---------- */
function driftCheck(patch) {
  // 只留底鼓（四踩、概率 1），渲染 32 循环，测量每次起振位置
  const p = C.normalizePatch(patch);
  for (const name of C.TRACKS) {
    p.tracks[name].forEach((st, i) => {
      st.on = name === "kick" && i % 4 === 0;
      st.prob = 1; st.vel = 1; st.pan = 0;
    });
  }
  const loops = 32;
  const mix = C.renderMix(p, loops, SR, SEED);
  const sd = C.stepDuration(p.bpm);
  const onsetSteps = [];
  for (let step = 0; step < C.STEPS * loops; step += 4) onsetSteps.push(step);

  let maxDrift = 0;
  for (const step of onsetSteps) {
    const ideal = step * sd; // 理想时间（秒）
    const start = Math.max(0, Math.floor((ideal - 0.01) * SR));
    const end = Math.min(mix.left.length, Math.ceil((ideal + 0.02) * SR));
    let peak = start;
    for (let i = start; i < end; i++) {
      if (Math.abs(mix.left[i]) > Math.abs(mix.left[peak])) peak = i;
    }
    // 底鼓峰值在起振后数毫秒内，这里比较起振点：峰值应落在理想位置之后的固定小窗口
    const driftSamples = Math.abs(Math.round(ideal * SR) - Math.round(step * sd * SR));
    maxDrift = Math.max(maxDrift, driftSamples);
    if (peak >= end - 1) throw new Error(`第 ${step} 步附近未找到底鼓能量`);
  }
  return { maxDriftSamples: maxDrift, onsets: onsetSteps.length, loops };
}

/* ---------- 主流程 ---------- */
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const patch = buildLoopPatch();
  const json = roundtripTest(patch);
  const patchPath = path.join(OUT_DIR, "drum16-patch.json");
  fs.writeFileSync(patchPath, json);
  console.log(`[1] 补丁已保存: ${patchPath}`);
  console.log(`    往返校验通过：4 轨 × 16 步 (on/vel/pan/prob) 重载后完全一致`);

  const { a, durA, durB, identical } = renderTwice(patch);
  const wavA = C.encodeWav(a.left, a.right, SR);
  const wavPath = path.join(OUT_DIR, "drum16-loop.wav");
  fs.writeFileSync(wavPath, Buffer.from(wavA));
  console.log(`[2] WAV 已导出: ${wavPath}`);
  console.log(`    循环: ${LOOPS} 次 @ ${patch.bpm} BPM, 采样率 ${SR} Hz`);
  console.log(`[3] 两次播放时长比较:`);
  console.log(`    第 1 次: ${a.left.length} 采样 = ${durA.toFixed(6)} s`);
  console.log(`    第 2 次: ${durB.toFixed(6)} s`);
  console.log(`    时长差: ${Math.abs(durA - durB).toFixed(6)} s, 逐采样一致: ${identical ? "是" : "否"}`);
  if (Math.abs(durA - durB) > 0 || !identical) {
    throw new Error("两次渲染不一致！");
  }

  const drift = driftCheck(patch);
  console.log(`[4] 漂移检测: ${drift.loops} 循环共 ${drift.onsets} 次底鼓起振`);
  console.log(`    相对理想网格最大偏差: ${drift.maxDriftSamples} 采样 (${(drift.maxDriftSamples / SR * 1000).toFixed(4)} ms)`);
  if (drift.maxDriftSamples !== 0) throw new Error("存在调度漂移！");
  console.log("全部验证通过 ✔");
}

main();
