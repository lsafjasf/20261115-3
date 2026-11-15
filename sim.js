/* 火山监测站多源融合仿真核心 —— 浏览器与 Node 通用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VolcanoSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DURATION = 6 * 3600;       // 6 小时模拟，步长 1s
  var ERUPTION_T = 5 * 3600;     // 喷发时刻
  var PRECURSOR_T0 = 3.1 * 3600; // 前兆起始
  var VALID_WINDOW = 2.5 * 3600; // 喷发前该窗口内的预警视为有效

  var SENSORS = [
    { id: 'tilt',       name: '倾斜仪',   unit: 'urad', base: 2.0,  sens: 46.0,  noiseAmp: 1.6,  color: '#e0a458' },
    { id: 'gas',        name: 'SO2气体',  unit: 'kt/d', base: 0.4,  sens: 9.0,   noiseAmp: 0.35, color: '#7fc97f' },
    { id: 'infrasound', name: '次声',     unit: 'Pa',   base: 0.15, sens: 4.2,   noiseAmp: 0.22, color: '#b085f5' },
    { id: 'seismic',    name: '地震RSAM', unit: 'cts',  base: 12.0, sens: 150.0, noiseAmp: 9.0,  color: '#e06060' }
  ];

  // 确定性伪随机（可复现）
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 前兆强度：缓慢起始 -> 加速上升 -> 喷发前逼近 1
  function precursorLevel(t) {
    if (t < PRECURSOR_T0) return 0;
    var x = (t - PRECURSOR_T0) / (ERUPTION_T - PRECURSOR_T0);
    return Math.pow(x, 1.6);
  }

  // 预生成设备噪声突发事件（单传感器、互不相关 —— 与真实前兆的关键区别）
  function makeNoiseEvents(seed) {
    var rng = makeRng(seed);
    var events = SENSORS.map(function () { return []; });
    SENSORS.forEach(function (s, i) {
      var n = 6 + Math.floor(rng() * 5);
      for (var k = 0; k < n; k++) {
        events[i].push({
          t: Math.floor(rng() * (DURATION - 200)),
          dur: 8 + Math.floor(rng() * 50),
          amp: s.sens * (0.25 + rng() * 0.45) // 足以越过单传感器阈值
        });
      }
    });
    return events;
  }

  function defaultConfig() {
    return {
      seed: 20261115,
      alertThreshold: 0.55, // 融合得分报警线
      persistence: 90,      // 持续判据：连续秒数
      sensors: SENSORS.map(function () {
        return { weight: 1.0, threshold: 0.35, filter: 'ma', window: 31 };
      })
    };
  }

  // 生成原始信号（真实前兆 + 设备噪声）
  function generateRaw(cfg) {
    var rng = makeRng(cfg.seed ^ 0x9e3779b9);
    var noiseEvents = makeNoiseEvents(cfg.seed);
    var raw = SENSORS.map(function () { return new Float32Array(DURATION); });
    var truth = new Float32Array(DURATION);
    for (var t = 0; t < DURATION; t++) {
      var p = precursorLevel(t);
      truth[t] = p;
      SENSORS.forEach(function (s, i) {
        var v = s.base + s.sens * p + (rng() * 2 - 1) * s.noiseAmp;
        for (var e = 0; e < noiseEvents[i].length; e++) {
          var ev = noiseEvents[i][e];
          if (t >= ev.t && t < ev.t + ev.dur) {
            var ph = (t - ev.t) / ev.dur;
            v += ev.amp * Math.sin(Math.PI * ph); // 脉冲形设备噪声
          }
        }
        raw[i][t] = Math.max(0, v);
      });
    }
    return { raw: raw, truth: truth, noiseEvents: noiseEvents };
  }

  // 滤波：ma=滑动平均, median=中值, none=不过滤
  function applyFilter(series, type, win) {
    var n = series.length, out = new Float32Array(n);
    if (type === 'none' || win < 3) { out.set(series); return out; }
    var half = Math.floor(win / 2), buf = [];
    var sum = 0;
    for (var i = 0; i < n; i++) {
      if (type === 'ma') {
        sum += series[i];
        if (i >= win) sum -= series[i - win];
        var a = Math.max(0, i - win + 1);
        out[i] = sum / (i - a + 1);
      } else {
        buf.length = 0;
        for (var j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) buf.push(series[j]);
        buf.sort(function (x, y) { return x - y; });
        out[i] = buf[buf.length >> 1];
      }
    }
    return out;
  }

  function normalize(v, s) {
    var x = (v - s.base) / s.sens;
    return x < 0 ? 0 : (x > 1 ? 1 : x);
  }

  // 主仿真：返回逐秒融合结果、报警事件、传感器贡献
  function run(userCfg) {
    var cfg = Object.assign(defaultConfig(), userCfg || {});
    var gen = generateRaw(cfg);
    var filtered = SENSORS.map(function (s, i) {
      return applyFilter(gen.raw[i], cfg.sensors[i].filter, cfg.sensors[i].window);
    });
    var norm = filtered.map(function (f, i) {
      var out = new Float32Array(DURATION);
      for (var t = 0; t < DURATION; t++) out[t] = normalize(f[t], SENSORS[i]);
      return out;
    });

    var wSum = 0;
    cfg.sensors.forEach(function (c) { wSum += c.weight; });
    if (wSum <= 0) wSum = 1;

    var fused = new Float32Array(DURATION);
    var contrib = SENSORS.map(function () { return new Float32Array(DURATION); });
    var stats = SENSORS.map(function () {
      return { activeSec: 0, contribSum: 0, peak: 0, falseActiveSec: 0 };
    });

    for (var t = 0; t < DURATION; t++) {
      var score = 0;
      for (var i = 0; i < SENSORS.length; i++) {
        var c = cfg.sensors[i];
        var active = norm[i][t] >= c.threshold;
        var part = active ? c.weight * norm[i][t] : 0;
        score += part;
        contrib[i][t] = part / wSum;
        var st = stats[i];
        if (active) {
          st.activeSec++;
          if (gen.truth[t] < 0.05) st.falseActiveSec++; // 无前兆时被激活 = 噪声触发
        }
        st.contribSum += contrib[i][t];
        if (norm[i][t] > st.peak) st.peak = norm[i][t];
      }
      fused[t] = score / wSum;
    }

    // 持续判据 -> 报警事件
    var alerts = [], runLen = 0, start = -1;
    for (var t2 = 0; t2 < DURATION; t2++) {
      if (fused[t2] >= cfg.alertThreshold) {
        if (runLen === 0) start = t2;
        runLen++;
      } else {
        if (runLen >= cfg.persistence) alerts.push({ start: start, end: t2 - 1 });
        runLen = 0;
      }
    }
    if (runLen >= cfg.persistence) alerts.push({ start: start, end: DURATION - 1 });

    // 判定：喷发前 VALID_WINDOW 内触发的报警为有效，其余为误报
    var valid = 0, falseAlarms = 0;
    alerts.forEach(function (a) {
      a.leadSec = ERUPTION_T - a.start;
      a.valid = a.start < ERUPTION_T && a.leadSec <= VALID_WINDOW;
      if (a.valid) valid++; else falseAlarms++;
    });

    var totalContrib = 0;
    stats.forEach(function (s) { totalContrib += s.contribSum; });
    var contributions = SENSORS.map(function (s, i) {
      return {
        sensor: s.id, name: s.name, unit: s.unit,
        weight: cfg.sensors[i].weight, threshold: cfg.sensors[i].threshold,
        filter: cfg.sensors[i].filter, window: cfg.sensors[i].window,
        activeSec: stats[i].activeSec,
        noiseTriggeredSec: stats[i].falseActiveSec,
        peakNorm: +stats[i].peak.toFixed(4),
        contribShare: totalContrib > 0 ? +(stats[i].contribSum / totalContrib).toFixed(4) : 0
      };
    });

    return {
      config: cfg, fused: fused, norm: norm, raw: gen.raw, truth: gen.truth,
      alerts: alerts, validAlerts: valid, falseAlarms: falseAlarms,
      success: valid >= 1 && falseAlarms <= 1,
      contributions: contributions
    };
  }

  return {
    DURATION: DURATION, ERUPTION_T: ERUPTION_T, PRECURSOR_T0: PRECURSOR_T0,
    VALID_WINDOW: VALID_WINDOW, SENSORS: SENSORS,
    defaultConfig: defaultConfig, run: run
  };
});
