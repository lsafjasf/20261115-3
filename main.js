/* 火山监测站前端：控制面板、播放循环、Canvas 渲染、Web Audio 低频反馈 */
(function () {
  'use strict';
  var SIM = window.VolcanoSim;
  var SENSORS = SIM.SENSORS;
  var DURATION = SIM.DURATION, ERUPTION_T = SIM.ERUPTION_T;

  // ---------- 状态 ----------
  var result = null;      // 完整仿真结果（预计算，逐秒播放）
  var tSim = 0;           // 当前播放到的模拟秒
  var playing = false;
  var firedAlerts = [];   // 播放中确认的报警事件
  var alertRun = 0, alertStart = -1, alertActive = false;
  var erupted = false, finished = false, evaluated = false;

  // ---------- 配置读取 ----------
  function readConfig() {
    var cfg = SIM.defaultConfig();
    cfg.alertThreshold = +document.getElementById('alertThr').value;
    cfg.persistence = +document.getElementById('persist').value;
    SENSORS.forEach(function (s, i) {
      cfg.sensors[i] = {
        weight: +document.getElementById('w' + i).value,
        threshold: +document.getElementById('th' + i).value,
        filter: document.getElementById('f' + i).value,
        window: +document.getElementById('win' + i).value
      };
    });
    return cfg;
  }

  // ---------- 控制面板 ----------
  function buildPanel() {
    var host = document.getElementById('sensorControls');
    SENSORS.forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'sensor-block';
      d.innerHTML =
        '<div class="sname" style="color:' + s.color + '">' + s.name + ' (' + s.unit + ')</div>' +
        '<label>权重 <span id="w' + i + 'v"></span><input type="range" id="w' + i + '" min="0" max="2" step="0.05" value="1"></label>' +
        '<label>阈值 <span id="th' + i + 'v"></span><input type="range" id="th' + i + '" min="0.1" max="0.8" step="0.01" value="0.35"></label>' +
        '<label>滤波 <select id="f' + i + '">' +
        '<option value="ma">滑动平均</option><option value="median">中值</option><option value="none">不过滤</option></select>' +
        ' 窗长 <input type="range" id="win' + i + '" min="3" max="121" step="2" value="31" style="width:45%"><span id="win' + i + 'v"></span></label>';
      host.appendChild(d);
    });
    bindLabels();
  }

  function bindLabels() {
    var pairs = [['alertThr', 'alertThrVal'], ['persist', 'persistVal']];
    SENSORS.forEach(function (s, i) {
      pairs.push(['w' + i, 'w' + i + 'v'], ['th' + i, 'th' + i + 'v'], ['win' + i, 'win' + i + 'v']);
    });
    pairs.forEach(function (p) {
      var el = document.getElementById(p[0]);
      var out = document.getElementById(p[1]);
      var f = function () { out.textContent = el.value; };
      el.addEventListener('input', f); f();
    });
    var sp = document.getElementById('speed');
    var spv = document.getElementById('speedVal');
    var sf = function () { spv.textContent = ['60', '120', '300', '600', '1200', '2400'][sp.value - 1] + 'x'; };
    sp.addEventListener('input', sf); sf();
  }

  // ---------- Web Audio：仅低频反馈 ----------
  var audio = null;
  function initAudio() {
    if (audio) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // 无音频环境时静默降级
    var ctx = new AC();
    var osc = ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 42; // 低频隆隆声
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 120; // 硬限制：只输出低频
    var gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    osc.start();
    audio = { ctx: ctx, osc: osc, gain: gain };
  }
  function updateAudio() {
    if (!audio) return;
    var t = Math.min(tSim, DURATION - 1);
    var level = result ? result.fused[t] : 0;
    var target = playing ? Math.min(0.5, level * 0.6) : 0;
    if (alertActive) target = Math.min(0.6, target + 0.25);
    audio.gain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.15);
    audio.osc.frequency.setTargetAtTime(38 + level * 40, audio.ctx.currentTime, 0.2);
  }

  // ---------- 日志 ----------
  function log(msg, cls) {
    var ul = document.getElementById('log');
    var li = document.createElement('li');
    if (cls) li.className = cls;
    li.textContent = '[' + fmtClock(tSim) + '] ' + msg;
    ul.insertBefore(li, ul.firstChild);
  }
  function fmtClock(t) {
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
    return 'T+' + [h, m, s].map(function (x) { return String(x).padStart(2, '0'); }).join(':');
  }

  // ---------- 播放循环 ----------
  function reset() {
    playing = false; tSim = 0; firedAlerts = [];
    alertRun = 0; alertStart = -1; alertActive = false;
    erupted = false; finished = false; evaluated = false;
    document.getElementById('log').innerHTML = '';
    document.getElementById('btnStart').textContent = '▶ 启动';
    var v = document.getElementById('verdict');
    v.textContent = '模拟中……'; v.className = '';
    result = SIM.run(readConfig());
    renderContribTable(true);
    drawAll();
  }

  function step(dtReal) {
    if (!playing || finished) return;
    var rate = [60, 120, 300, 600, 1200, 2400][+document.getElementById('speed').value - 1];
    var prev = tSim;
    tSim = Math.min(DURATION - 1, tSim + dtReal * rate);
    // 持续判据逐秒推进
    var thr = result.config.alertThreshold, persist = result.config.persistence;
    for (var t = Math.floor(prev); t <= Math.floor(tSim); t++) {
      if (result.fused[t] >= thr) {
        if (alertRun === 0) alertStart = t;
        alertRun++;
        if (alertRun === persist) {
          alertActive = true;
          firedAlerts.push({ start: alertStart });
          log('🚨 预警触发！道路封闭、居民区疏散', 'alert');
        }
      } else {
        if (alertActive) { log('预警解除', 'warn'); }
        alertActive = false; alertRun = 0;
      }
    }
    if (!erupted && tSim >= ERUPTION_T) {
      erupted = true;
      log('🌋 火山喷发！', 'alert');
      evaluate();
    }
    if (tSim >= DURATION - 1 && !finished) {
      finished = true; playing = false;
      if (!evaluated) evaluate();
      document.getElementById('btnStart').textContent = '▶ 启动';
    }
    updateAudio();
    drawAll();
  }

  function evaluate() {
    evaluated = true;
    var valid = 0, falseAlarms = 0;
    firedAlerts.forEach(function (a) {
      var lead = ERUPTION_T - a.start;
      if (a.start < ERUPTION_T && lead <= SIM.VALID_WINDOW) valid++;
      else falseAlarms++;
    });
    var ok = valid >= 1 && falseAlarms <= 1;
    var v = document.getElementById('verdict');
    v.className = ok ? 'ok' : 'bad';
    v.textContent = (ok ? '✅ 判定成功' : '❌ 判定失败') +
      ' — 有效预警 ' + valid + ' 次，误报 ' + falseAlarms + ' 次';
    log(v.textContent, ok ? 'good' : 'alert');
    renderContribTable(false);
  }

  // ---------- 贡献表 ----------
  function renderContribTable(live) {
    var tb = document.querySelector('#contribTable tbody');
    tb.innerHTML = '';
    var rows;
    if (live) {
      // 播放中：按已播放时长统计
      var cfg = result.config, tEnd = Math.max(1, Math.floor(tSim));
      var wSum = 0;
      cfg.sensors.forEach(function (c) { wSum += c.weight || 0; });
      if (wSum <= 0) wSum = 1;
      var sums = SENSORS.map(function () { return 0; });
      var act = SENSORS.map(function () { return 0; });
      for (var t = 0; t < tEnd; t++) {
        for (var i = 0; i < SENSORS.length; i++) {
          var c = cfg.sensors[i];
          if (result.norm[i][t] >= c.threshold) {
            act[i]++;
            sums[i] += c.weight * result.norm[i][t] / wSum;
          }
        }
      }
      var tot = sums.reduce(function (a, b) { return a + b; }, 0);
      rows = SENSORS.map(function (s, i) {
        return [s.name, cfg.sensors[i].weight, cfg.sensors[i].threshold,
          cfg.sensors[i].filter, act[i], '—', '—',
          tot > 0 ? (100 * sums[i] / tot).toFixed(1) + '%' : '0%'];
      });
    } else {
      rows = result.contributions.map(function (c) {
        return [c.name, c.weight, c.threshold, c.filter + '/' + c.window,
          c.activeSec, c.noiseTriggeredSec, c.peakNorm, (100 * c.contribShare).toFixed(1) + '%'];
      });
    }
    rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = r.map(function (x) { return '<td>' + x + '</td>'; }).join('');
      tr.firstChild.style.color = SENSORS[i].color;
      tb.appendChild(tr);
    });
  }

  // ---------- 导出 ----------
  function exportRecord() {
    if (!result) return;
    var record = {
      exportedAt: new Date().toISOString(),
      scenario: { durationSec: DURATION, eruptionT: ERUPTION_T, validWindowSec: SIM.VALID_WINDOW },
      config: result.config,
      determination: {
        alerts: result.alerts, validAlerts: result.validAlerts,
        falseAlarms: result.falseAlarms, success: result.success
      },
      sensorContributions: result.contributions
    };
    var blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sensor_contributions.json';
    a.click();
    URL.revokeObjectURL(a.href);
    log('已导出传感器贡献记录 JSON', 'good');
  }

  // ---------- 波形 Canvas ----------
  var waveCv = document.getElementById('waveCanvas');
  var waveCtx = waveCv.getContext('2d');

  function drawWaves() {
    var W = waveCv.width, H = waveCv.height;
    var ctx = waveCtx;
    ctx.clearRect(0, 0, W, H);
    var strips = SENSORS.length + 1;
    var sh = H / strips;
    var cfg = result.config;
    var tEnd = Math.floor(tSim);
    var xOf = function (t) { return 70 + (W - 80) * t / DURATION; };

    // 时间轴刻度（小时）
    ctx.fillStyle = '#5c6b7d'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    for (var h = 0; h <= 6; h++) ctx.fillText(h + 'h', xOf(h * 3600), H - 3);
    // 喷发时刻标记
    ctx.strokeStyle = 'rgba(255,90,90,.5)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xOf(ERUPTION_T), 0); ctx.lineTo(xOf(ERUPTION_T), H - 14); ctx.stroke();
    ctx.setLineDash([]);

    for (var i = 0; i < SENSORS.length; i++) {
      var y0 = i * sh, s = SENSORS[i], c = cfg.sensors[i];
      ctx.fillStyle = '#9fb0c3'; ctx.textAlign = 'left'; ctx.font = '11px sans-serif';
      ctx.fillText(s.name, 6, y0 + 14);
      // 阈值线
      var yThr = y0 + sh - 8 - c.threshold * (sh - 18);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(70, yThr); ctx.lineTo(W - 10, yThr); ctx.stroke();
      ctx.setLineDash([]);
      // 原始信号（淡）与滤波后归一化信号（亮）
      drawSeries(ctx, result.raw[i], s, tEnd, xOf, y0, sh, 'rgba(255,255,255,.14)', true);
      drawSeries(ctx, result.norm[i], null, tEnd, xOf, y0, sh, s.color, false);
    }
    // 融合得分条
    var fy = SENSORS.length * sh;
    ctx.fillStyle = '#9fb0c3'; ctx.textAlign = 'left';
    ctx.fillText('融合得分', 6, fy + 14);
    var yA = fy + sh - 8 - cfg.alertThreshold * (sh - 18);
    ctx.strokeStyle = 'rgba(255,180,77,.6)'; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(70, yA); ctx.lineTo(W - 10, yA); ctx.stroke();
    ctx.setLineDash([]);
    // 报警区间着色
    ctx.fillStyle = 'rgba(255,80,80,.12)';
    result.alerts.forEach(function (a) {
      if (a.start > tEnd) return;
      ctx.fillRect(xOf(a.start), fy + 2, xOf(Math.min(a.end, tEnd)) - xOf(a.start), sh - 16);
    });
    drawSeries(ctx, result.fused, null, tEnd, xOf, fy, sh, '#7fd4ff', false);
    // 播放头
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(xOf(tEnd), 0); ctx.lineTo(xOf(tEnd), H - 14); ctx.stroke();
  }

  function drawSeries(ctx, series, sensor, tEnd, xOf, y0, sh, color, isRaw) {
    ctx.strokeStyle = color; ctx.lineWidth = isRaw ? 0.6 : 1.2;
    ctx.beginPath();
    var stepPx = Math.max(1, Math.floor(tEnd / 900));
    for (var t = 0; t <= tEnd; t += stepPx) {
      var v = series[t];
      if (isRaw && sensor) v = Math.max(0, Math.min(1, (v - sensor.base) / sensor.sens));
      var x = xOf(t), y = y0 + sh - 8 - v * (sh - 18);
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // ---------- 火山剖面 + 风险区 Canvas ----------
  var volCv = document.getElementById('volcanoCanvas');
  var volCtx = volCv.getContext('2d');
  var ashParticles = [];

  function drawVolcano() {
    var W = volCv.width, H = volCv.height, ctx = volCtx;
    ctx.clearRect(0, 0, W, H);
    var t = Math.min(Math.floor(tSim), DURATION - 1);
    var risk = result ? result.fused[t] : 0;
    var groundY = H - 60, peakX = W * 0.5, peakY = H * 0.22;

    // 天空与大地
    ctx.fillStyle = '#10131a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1c232e'; ctx.fillRect(0, groundY, W, H - groundY);

    // 风险区：道路（左）与居民区（右）
    var zoneColor = alertActive ? 'rgba(255,70,70,.35)' :
      risk > 0.35 ? 'rgba(255,180,77,.25)' : 'rgba(127,201,127,.15)';
    ctx.fillStyle = zoneColor;
    ctx.fillRect(30, groundY - 26, W * 0.28, 26);   // 道路
    ctx.fillRect(W * 0.66, groundY - 40, W * 0.3, 40); // 居民区
    ctx.fillStyle = '#9fb0c3'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(alertActive ? '道路·封闭' : '道路', 30 + W * 0.14, groundY - 32);
    ctx.fillText(alertActive ? '居民区·疏散' : '居民区', W * 0.66 + W * 0.15, groundY - 46);
    // 居民区小房子
    for (var hx = 0; hx < 5; hx++) {
      var bx = W * 0.68 + hx * W * 0.055;
      ctx.fillStyle = '#3a4552';
      ctx.fillRect(bx, groundY - 18, 22, 18);
      ctx.beginPath(); ctx.moveTo(bx - 2, groundY - 18);
      ctx.lineTo(bx + 11, groundY - 28); ctx.lineTo(bx + 24, groundY - 18);
      ctx.closePath(); ctx.fill();
    }

    // 火山剖面
    ctx.beginPath();
    ctx.moveTo(peakX - W * 0.3, groundY);
    ctx.lineTo(peakX - 26, peakY);
    ctx.lineTo(peakX + 26, peakY);
    ctx.lineTo(peakX + W * 0.3, groundY);
    ctx.closePath();
    ctx.fillStyle = '#4a3f35'; ctx.fill();
    ctx.strokeStyle = '#5d5145'; ctx.stroke();
    // 岩浆房与通道（亮度随融合风险）
    var glow = Math.min(1, risk * 1.4);
    ctx.fillStyle = 'rgba(255,' + Math.floor(120 - 80 * glow) + ',40,' + (0.25 + 0.65 * glow) + ')';
    ctx.beginPath();
    ctx.ellipse(peakX, groundY - 24, 60 + 20 * glow, 18 + 8 * glow, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(peakX - 7, peakY, 14, groundY - 24 - peakY);

    // 喷发粒子
    if (erupted) {
      for (var k = 0; k < 6; k++) {
        ashParticles.push({
          x: peakX + (Math.random() - 0.5) * 30, y: peakY,
          vx: (Math.random() - 0.5) * 2.4, vy: -2 - Math.random() * 3,
          r: 2 + Math.random() * 4, life: 1
        });
      }
    }
    ashParticles = ashParticles.filter(function (p) { return p.life > 0; });
    ashParticles.forEach(function (p) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.02; p.life -= 0.004;
      ctx.fillStyle = 'rgba(120,120,120,' + (p.life * 0.8) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });

    // 风险指示
    ctx.fillStyle = '#9fb0c3'; ctx.textAlign = 'left';
    ctx.fillText('融合风险 ' + (risk * 100).toFixed(0) + '%', 30, 26);
    ctx.fillStyle = alertActive ? '#ff7b7b' : risk > 0.35 ? '#ffb84d' : '#7fc97f';
    ctx.fillText(alertActive ? '状态：预警中' : risk > 0.35 ? '状态：关注' : '状态：正常', 30, 44);
  }

  function drawAll() {
    if (!result) return;
    drawWaves();
    drawVolcano();
    document.getElementById('clock').textContent = fmtClock(tSim);
  }

  // ---------- 启动 ----------
  var lastTs = 0;
  function loop(ts) {
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    step(Math.min(dt, 0.1));
    requestAnimationFrame(loop);
  }

  document.getElementById('btnStart').addEventListener('click', function () {
    initAudio();
    if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
    if (finished) reset();
    playing = !playing;
    this.textContent = playing ? '⏸ 暂停' : '▶ 继续';
    if (playing) log('模拟启动 / 继续');
  });
  document.getElementById('btnReset').addEventListener('click', function () {
    reset(); log('已按当前参数重新仿真');
  });
  document.getElementById('btnExport').addEventListener('click', exportRecord);

  buildPanel();
  reset();
  requestAnimationFrame(loop);
})();
