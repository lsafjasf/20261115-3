/*
 * core.js — 十六步鼓机共享内核
 * 同时运行于浏览器 (window.DrumCore) 与 Node (module.exports)。
 * 包含：补丁模型、四套合成参数(Kit)、采样级合成器、确定性随机数。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DrumCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STEPS = 16;
  var TRACKS = ["kick", "snare", "hihat", "clap"];

  /* ---------------- 四套合成参数 (Kit) ---------------- */
  var KITS = [
    {
      name: "House",
      kick:  { f0: 120, f1: 42, pitchDecay: 0.045, ampDecay: 0.38, click: 0.55, drive: 1.4 },
      snare: { tone: 185, toneLevel: 0.55, noiseLevel: 0.8, ampDecay: 0.16, bpFreq: 1800, bpQ: 0.9 },
      hihat: { hpFreq: 7800, ampDecay: 0.055, metal: 0.7, level: 0.5 },
      clap:  { bpFreq: 1150, bpQ: 1.4, bursts: 3, spread: 0.014, ampDecay: 0.24, level: 0.8 }
    },
    {
      name: "Techno",
      kick:  { f0: 160, f1: 38, pitchDecay: 0.03, ampDecay: 0.3, click: 0.8, drive: 2.2 },
      snare: { tone: 220, toneLevel: 0.4, noiseLevel: 1.0, ampDecay: 0.12, bpFreq: 2400, bpQ: 1.2 },
      hihat: { hpFreq: 8500, ampDecay: 0.03, metal: 0.9, level: 0.45 },
      clap:  { bpFreq: 1400, bpQ: 2.0, bursts: 4, spread: 0.011, ampDecay: 0.18, level: 0.85 }
    },
    {
      name: "LoFi",
      kick:  { f0: 95, f1: 45, pitchDecay: 0.07, ampDecay: 0.5, click: 0.25, drive: 1.1 },
      snare: { tone: 160, toneLevel: 0.7, noiseLevel: 0.55, ampDecay: 0.22, bpFreq: 1200, bpQ: 0.7 },
      hihat: { hpFreq: 6000, ampDecay: 0.09, metal: 0.4, level: 0.4 },
      clap:  { bpFreq: 900, bpQ: 1.0, bursts: 3, spread: 0.02, ampDecay: 0.3, level: 0.7 }
    },
    {
      name: "Electro",
      kick:  { f0: 140, f1: 50, pitchDecay: 0.055, ampDecay: 0.42, click: 0.4, drive: 1.6 },
      snare: { tone: 300, toneLevel: 0.5, noiseLevel: 0.9, ampDecay: 0.19, bpFreq: 2000, bpQ: 1.5 },
      hihat: { hpFreq: 9000, ampDecay: 0.12, metal: 1.0, level: 0.5 },
      clap:  { bpFreq: 1600, bpQ: 1.8, bursts: 5, spread: 0.009, ampDecay: 0.28, level: 0.9 }
    }
  ];

  /* ---------------- 确定性随机数 (mulberry32) ---------------- */
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 补丁模型 ---------------- */
  function defaultStep(trackIdx, stepIdx) {
    // 默认节奏型：四踩底鼓、2/4 拍军鼓、八分踩镲、第 4/12 步拍手
    var on = false;
    if (trackIdx === 0) on = stepIdx % 4 === 0;
    if (trackIdx === 1) on = stepIdx === 4 || stepIdx === 12;
    if (trackIdx === 2) on = stepIdx % 2 === 0;
    if (trackIdx === 3) on = stepIdx === 4 || stepIdx === 12;
    return { on: on, vel: 0.9, pan: 0, prob: 1 };
  }

  function createDefaultPatch() {
    var tracks = {};
    TRACKS.forEach(function (name, ti) {
      tracks[name] = [];
      for (var s = 0; s < STEPS; s++) tracks[name].push(defaultStep(ti, s));
    });
    return {
      version: 1,
      bpm: 122,
      kitIndex: 0,
      kits: JSON.parse(JSON.stringify(KITS)),
      tracks: tracks
    };
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // 校验并规范化外部载入的补丁，保证结构完整、数值在界内
  function normalizePatch(raw) {
    if (!raw || typeof raw !== "object") throw new Error("补丁不是对象");
    var base = createDefaultPatch();
    var p = {
      version: 1,
      bpm: clamp(Number(raw.bpm) || base.bpm, 40, 300),
      kitIndex: clamp(raw.kitIndex | 0, 0, 3),
      kits: base.kits,
      tracks: {}
    };
    if (Array.isArray(raw.kits)) {
      for (var k = 0; k < 4; k++) {
        if (raw.kits[k]) p.kits[k] = mergeKit(base.kits[k], raw.kits[k]);
      }
    }
    TRACKS.forEach(function (name) {
      var src = raw.tracks && raw.tracks[name];
      p.tracks[name] = [];
      for (var s = 0; s < STEPS; s++) {
        var d = base.tracks[name][s];
        var st = src && src[s] ? src[s] : {};
        p.tracks[name].push({
          on: !!st.on,
          vel: clamp(Number(st.vel != null ? st.vel : d.vel), 0, 1),
          pan: clamp(Number(st.pan != null ? st.pan : d.pan), -1, 1),
          prob: clamp(Number(st.prob != null ? st.prob : d.prob), 0, 1)
        });
      }
    });
    return p;
  }

  function mergeKit(base, over) {
    var out = JSON.parse(JSON.stringify(base));
    TRACKS.forEach(function (name) {
      if (over[name]) {
        Object.keys(out[name]).forEach(function (key) {
          if (typeof over[name][key] === "number" && isFinite(over[name][key])) {
            out[name][key] = over[name][key];
          }
        });
      }
    });
    if (typeof over.name === "string") out.name = over.name;
    return out;
  }

  function serializePatch(patch) {
    return JSON.stringify(normalizePatch(patch), null, 2);
  }

  function parsePatch(jsonText) {
    return normalizePatch(JSON.parse(jsonText));
  }
  /* ---------------- 采样级合成器 ----------------
   * renderVoice(instrument, params, vel, sr, rng) -> Float32Array (mono)
   * 浏览器与 Node 共用，保证导出的 WAV 与实时回放一致。
   */
  function renderVoice(instr, prm, vel, sr, rng) {
    switch (instr) {
      case "kick": return renderKick(prm, vel, sr);
      case "snare": return renderSnare(prm, vel, sr, rng);
      case "hihat": return renderHihat(prm, vel, sr, rng);
      case "clap": return renderClap(prm, vel, sr, rng);
      default: throw new Error("未知乐器: " + instr);
    }
  }

  function tail(seconds, sr) { return new Float32Array(Math.max(1, Math.ceil(seconds * sr))); }

  function renderKick(p, vel, sr) {
    var dur = p.ampDecay * 4 + 0.05;
    var out = tail(dur, sr);
    var phase = 0;
    for (var i = 0; i < out.length; i++) {
      var t = i / sr;
      var freq = p.f1 + (p.f0 - p.f1) * Math.exp(-t / p.pitchDecay);
      phase += (2 * Math.PI * freq) / sr;
      var env = Math.exp(-t / p.ampDecay);
      var clickEnv = Math.exp(-t / 0.004) * p.click;
      var s = Math.tanh((Math.sin(phase) * env + clickEnv * 0.6) * p.drive);
      out[i] = s * vel * 0.9;
    }
    return out;
  }

  // 简易双二阶滤波器（RBJ biquad）
  function biquad(type, freq, q, sr) {
    var w0 = 2 * Math.PI * freq / sr;
    var alpha = Math.sin(w0) / (2 * q);
    var cosw = Math.cos(w0);
    var b0, b1, b2, a0, a1, a2;
    if (type === "bp") {
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
    } else { // hp
      b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
    }
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return function (x) {
      var y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    };
  }

  function renderSnare(p, vel, sr, rng) {
    var dur = p.ampDecay * 4 + 0.05;
    var out = tail(dur, sr);
    var bp = biquad("bp", p.bpFreq, p.bpQ, sr);
    var phase = 0;
    for (var i = 0; i < out.length; i++) {
      var t = i / sr;
      var env = Math.exp(-t / p.ampDecay);
      phase += (2 * Math.PI * p.tone) / sr;
      var tone = Math.sin(phase) * p.toneLevel;
      var noise = bp(rng() * 2 - 1) * p.noiseLevel;
      out[i] = (tone + noise) * env * vel * 0.7;
    }
    return out;
  }

  function renderHihat(p, vel, sr, rng) {
    var dur = p.ampDecay * 4 + 0.03;
    var out = tail(dur, sr);
    var hp = biquad("hp", p.hpFreq, 0.707, sr);
    // 金属感：若干非谐波方波 + 高通噪声
    var ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    var phases = ratios.map(function () { return 0; });
    for (var i = 0; i < out.length; i++) {
      var t = i / sr;
      var env = Math.exp(-t / p.ampDecay);
      var metal = 0;
      for (var r = 0; r < ratios.length; r++) {
        phases[r] += (2 * Math.PI * 300 * ratios[r]) / sr;
        metal += Math.sign(Math.sin(phases[r])) / ratios.length;
      }
      var noise = hp(rng() * 2 - 1);
      out[i] = (metal * p.metal * 0.5 + noise * (1 - p.metal * 0.5)) * env * vel * p.level;
    }
    return out;
  }

  function renderClap(p, vel, sr, rng) {
    var dur = p.ampDecay * 4 + p.spread * p.bursts + 0.05;
    var out = tail(dur, sr);
    var bp = biquad("bp", p.bpFreq, p.bpQ, sr);
    for (var i = 0; i < out.length; i++) {
      var t = i / sr;
      // 多次短促噪声爆发模拟手掌拍击
      var env = 0;
      for (var b = 0; b < p.bursts; b++) {
        var bt = t - b * p.spread;
        if (bt >= 0) env += Math.exp(-bt / 0.008) * (b === p.bursts - 1 ? 1 : 0.55);
      }
      env += Math.exp(-t / p.ampDecay) * 0.6; // 尾巴混响感
      out[i] = bp(rng() * 2 - 1) * env * vel * p.level * 0.5;
    }
    return out;
  }

  /* ---------------- 步进时间网格（无漂移关键） ----------------
   * 任何一步的时间都由 起点 + 步号 × 步长 直接算出，
   * 绝不累加浮点增量，因此无论播放多久都不会累积漂移。
   */
  function stepDuration(bpm) { return 60 / bpm / 4; } // 16 分音符
  function stepTime(startTime, stepIndex, bpm) {
    return startTime + stepIndex * stepDuration(bpm);
  }

  /* ---------------- 离线混音 ----------------
   * renderMix(patch, loops, sr, seed) -> { left, right }
   * 用种子随机数解析概率，保证同种子两次渲染逐采样一致。
   * 等功率声像。步进偏移用 步号×步长 直接计算，无累积误差。
   */
  function renderMix(patch, loops, sr, seed) {
    var p = normalizePatch(patch);
    var rng = makeRng(seed == null ? 0xC0FFEE : seed);
    var kit = p.kits[p.kitIndex];
    var sd = stepDuration(p.bpm);
    var totalSteps = STEPS * loops;
    var totalSec = totalSteps * sd + 2.0; // 末尾留 2 秒尾巴
    var n = Math.ceil(totalSec * sr);
    var left = new Float32Array(n);
    var right = new Float32Array(n);

    for (var step = 0; step < totalSteps; step++) {
      var col = step % STEPS;
      var offset = Math.round(step * sd * sr); // 采样级网格，无漂移
      for (var t = 0; t < TRACKS.length; t++) {
        var name = TRACKS[t];
        var st = p.tracks[name][col];
        if (!st.on) continue;
        if (rng() >= st.prob) continue;
        var voice = renderVoice(name, kit[name], st.vel, sr, rng);
        var angle = (st.pan + 1) * Math.PI / 4; // 等功率声像
        var gL = Math.cos(angle), gR = Math.sin(angle);
        for (var i = 0; i < voice.length && offset + i < n; i++) {
          left[offset + i] += voice[i] * gL;
          right[offset + i] += voice[i] * gR;
        }
      }
    }
    // 软限幅
    for (var s = 0; s < n; s++) {
      left[s] = Math.tanh(left[s]);
      right[s] = Math.tanh(right[s]);
    }
    return { left: left, right: right };
  }

  /* ---------------- WAV 编码 (16-bit PCM 立体声) ---------------- */
  function encodeWav(left, right, sr) {
    var n = left.length;
    var dataSize = n * 2 * 2;
    var buf = new ArrayBuffer(44 + dataSize);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + dataSize, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 2, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataSize, true);
    var off = 44;
    for (var i = 0; i < n; i++) {
      var l = Math.max(-1, Math.min(1, left[i]));
      var r = Math.max(-1, Math.min(1, right[i]));
      v.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7FFF, true); off += 2;
      v.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7FFF, true); off += 2;
    }
    return buf;
  }

  return {
    STEPS: STEPS,
    TRACKS: TRACKS,
    KITS: KITS,
    makeRng: makeRng,
    createDefaultPatch: createDefaultPatch,
    normalizePatch: normalizePatch,
    serializePatch: serializePatch,
    parsePatch: parsePatch,
    renderVoice: renderVoice,
    renderMix: renderMix,
    encodeWav: encodeWav,
    stepDuration: stepDuration,
    stepTime: stepTime
  };
});
