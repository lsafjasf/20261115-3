// 医院夜班物流模拟 —— Canvas 渲染 + Web Audio + 交互
(function () {
  'use strict';
  var Core = window.HospitalCore;
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');

  // ---------------- Web Audio ----------------
  var AudioSys = {
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 无音频环境 */ }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone: function (freq, dur, type, vol, delay) {
      if (!this.ctx) return;
      var t0 = this.ctx.currentTime + (delay || 0);
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    },
    ding: function () { this.tone(990, 0.18, 'sine', 0.10); },
    elevator: function () { this.tone(660, 0.1, 'sine', 0.07); },
    stat: function () { this.tone(880, 0.12, 'square', 0.08); this.tone(660, 0.12, 'square', 0.08, 0.14); this.tone(880, 0.12, 'square', 0.08, 0.28); },
    alarm: function () { this.tone(1240, 0.1, 'square', 0.09); this.tone(1240, 0.1, 'square', 0.09, 0.16); },
    spoil: function () { this.tone(180, 0.5, 'sawtooth', 0.12); },
    conflict: function () { this.tone(300, 0.15, 'square', 0.1); this.tone(240, 0.2, 'square', 0.1, 0.12); },
    fail: function () { this.tone(220, 0.5, 'sawtooth', 0.1); this.tone(160, 0.6, 'sawtooth', 0.1, 0.3); },
    win: function () { var n = [523, 659, 784, 1046]; for (var i = 0; i < n.length; i++) this.tone(n[i], 0.25, 'sine', 0.12, i * 0.18); },
    lose: function () { var n = [440, 370, 311, 220]; for (var i = 0; i < n.length; i++) this.tone(n[i], 0.3, 'sawtooth', 0.09, i * 0.22); }
  };

  // ---------------- 游戏状态 ----------------
  var game, selectedElev = 'A', preemptMode = false, paused = false, speed = 1;
  var endSoundPlayed = false;
  var orderRowRects = [], floorBtnRects = [], rackRects = [];

  function newGame() {
    game = new Core.HospitalGame({ seed: (Math.random() * 1e9) >>> 0 });
    endSoundPlayed = false;
    game.onEvent = function (e) {
      if (e.type === 'stat') AudioSys.stat();
      else if (e.type === 'alarm') AudioSys.alarm();
      else if (e.type === 'spoil') AudioSys.spoil();
      else if (e.type === 'deliver') AudioSys.ding();
      else if (e.type === 'elevator') AudioSys.elevator();
      else if (e.type === 'preempt-conflict') AudioSys.conflict();
      else if (e.type === 'preempt-forced') AudioSys.conflict();
      else if (e.type === 'fail') AudioSys.fail();
    };
  }
  newGame();

  // ---------------- 布局常量 ----------------
  var FLOOR_H = 84, TOP_Y = 70;
  var FLOOR_NAMES = { 1: '药房 / 冷库', 2: '库房', 3: '手术室 OR-1', 4: '手术室 OR-2', 5: '手术室 OR-3', 6: '病区' };
  function floorY(f) { return TOP_Y + (6 - f) * FLOOR_H; } // 楼层顶边 y
  var SHAFT = { A: 370, B: 440, W: 50 };

  // ---------------- 交互 ----------------
  cv.addEventListener('click', function (ev) {
    AudioSys.ensure();
    var r = cv.getBoundingClientRect();
    var x = (ev.clientX - r.left) * (cv.width / r.width);
    var y = (ev.clientY - r.top) * (cv.height / r.height);
    var i;
    for (i = 0; i < orderRowRects.length; i++) {
      var o = orderRowRects[i];
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) {
        if (o.status === 'pending') game.enqueueOrder(o.id);
        return;
      }
    }
    for (i = 0; i < floorBtnRects.length; i++) {
      var b = floorBtnRects[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        var force = document.getElementById('chkForce').checked;
        if (preemptMode) game.preempt(selectedElev, b.floor, { force: force });
        else game.addStop(selectedElev, b.floor);
        return;
      }
    }
    for (i = 0; i < rackRects.length; i++) {
      var k = rackRects[i];
      if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) {
        game.moveToFridge(k.floor, k.orderId);
        return;
      }
    }
  });

  document.getElementById('btnPause').onclick = function () {
    paused = !paused;
    this.textContent = paused ? '▶ 继续' : '⏸ 暂停';
    this.classList.toggle('active', paused);
  };
  document.getElementById('btnSpeed').onclick = function () {
    speed = speed >= 4 ? 1 : speed * 2;
    this.textContent = '▶ ' + speed + 'x';
  };
  document.getElementById('btnElevA').onclick = function () { selectedElev = 'A'; syncElevBtns(); };
  document.getElementById('btnElevB').onclick = function () { selectedElev = 'B'; syncElevBtns(); };
  function syncElevBtns() {
    document.getElementById('btnElevA').classList.toggle('active', selectedElev === 'A');
    document.getElementById('btnElevB').classList.toggle('active', selectedElev === 'B');
  }
  document.getElementById('btnPreempt').onclick = function () {
    preemptMode = !preemptMode;
    this.classList.toggle('active', preemptMode);
    this.classList.toggle('warn', true);
  };
  document.getElementById('btnRestart').onclick = function () { newGame(); };

  // ---------------- 渲染：楼体 ----------------
  function drawHeader() {
    ctx.fillStyle = '#1d2432';
    ctx.fillRect(0, 0, cv.width, 54);
    var totalMin = 23 * 60 + game.t; // 23:00 开始的夜班
    var hh = Math.floor(totalMin / 60) % 24, mm = Math.floor(totalMin % 60);
    ctx.fillStyle = '#eef2fa';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('🕐 ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm, 24, 35);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#8fa0bd';
    ctx.fillText('模拟 ' + game.t.toFixed(0) + ' / 180 分钟', 24, 50);

    // 时间进度条
    ctx.fillStyle = '#2a3347';
    ctx.fillRect(160, 24, 200, 10);
    ctx.fillStyle = '#4a7fbf';
    ctx.fillRect(160, 24, 200 * Math.min(1, game.t / 180), 10);

    // 报废率仪表
    var rate = game.spoilRate();
    ctx.fillStyle = '#9fb0cc';
    ctx.fillText('冷链报废率', 400, 24);
    ctx.fillStyle = '#2a3347';
    ctx.fillRect(400, 30, 160, 12);
    ctx.fillStyle = rate < game.cfg.spoilThreshold ? '#4caf7d' : '#e05c5c';
    ctx.fillRect(400, 30, 160 * Math.min(1, rate), 12);
    ctx.fillStyle = '#eef2fa';
    ctx.fillText((rate * 100).toFixed(0) + '%（阈值20%）', 566, 41);

    ctx.fillStyle = '#9fb0cc';
    ctx.fillText('已送达 ' + game.stats.delivered + ' 件', 680, 41);
    ctx.fillText('报废 ' + game.stats.spoiled + ' 件', 790, 41);
    ctx.fillText('失败 ' + game.stats.failed + ' 项', 890, 41);
    if (preemptMode) {
      ctx.fillStyle = '#d98a4b';
      ctx.fillText('⚡ 抢占模式：点击楼层按钮改道货梯' + selectedElev, 980, 41);
    }
  }

  function drawBuilding() {
    var f, i;
    rackRects = [];
    for (f = 1; f <= 6; f++) {
      var y = floorY(f);
      ctx.fillStyle = f % 2 ? '#1c2230' : '#1a1f2b';
      ctx.fillRect(16, y, 560, FLOOR_H - 4);
      ctx.strokeStyle = '#2c3648';
      ctx.strokeRect(16, y, 560, FLOOR_H - 4);
      ctx.fillStyle = '#7c8aa5';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(f + 'F', 26, y + 20);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#9fb0cc';
      ctx.fillText(FLOOR_NAMES[f], 26, y + 38);

      // 楼层按钮（设置停靠 / 抢占）
      var bx = 536, by = y + FLOOR_H / 2 - 16;
      floorBtnRects.push({ x: bx, y: by, w: 30, h: 30, floor: f });
      ctx.fillStyle = '#2a3347';
      ctx.fillRect(bx, by, 30, 30);
      ctx.strokeStyle = '#4a5a7a';
      ctx.strokeRect(bx, by, 30, 30);
      ctx.fillStyle = '#cdd8ec';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(String(f), bx + 11, by + 20);

      // 临时库存：冷藏柜（蓝）与常温架（灰）
      var st = game.storage[f];
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#6ec1ff';
      ctx.fillText('冷藏柜 ' + st.fridge.length + '/' + game.cfg.fridgeSlots, 130, y + 16);
      for (i = 0; i < game.cfg.fridgeSlots; i++) {
        ctx.fillStyle = i < st.fridge.length ? '#2f6f9f' : '#22303f';
        ctx.fillRect(130 + i * 34, y + 22, 30, 18);
        if (i < st.fridge.length) {
          ctx.fillStyle = '#bfe3ff';
          ctx.fillText('❄', 130 + i * 34 + 10, y + 36);
        }
      }
      ctx.fillStyle = '#c9b478';
      ctx.fillText('常温架 ' + st.rack.length, 130, y + 58);
      for (i = 0; i < st.rack.length && i < 6; i++) {
        var rec = st.rack[i];
        var rx = 130 + i * 34, ry = y + 62;
        rackRects.push({ x: rx, y: ry, w: 30, h: 16, floor: f, orderId: rec.orderId });
        ctx.fillStyle = rec.cold ? '#7a5a3a' : '#4a4a3a';
        ctx.fillRect(rx, ry, 30, 16);
        ctx.fillStyle = '#e8dcc0';
        ctx.fillText(rec.cold ? '❄!' : '□', rx + 9, ry + 13);
      }
    }

    // 电梯井
    ['A', 'B'].forEach(function (id) {
      var e = game.elevator(id);
      var x = SHAFT[id];
      ctx.fillStyle = '#141a24';
      ctx.fillRect(x, TOP_Y, SHAFT.W, FLOOR_H * 6 - 4);
      ctx.strokeStyle = selectedElev === id ? '#6ec1ff' : '#333f55';
      ctx.lineWidth = selectedElev === id ? 2 : 1;
      ctx.strokeRect(x, TOP_Y, SHAFT.W, FLOOR_H * 6 - 4);
      ctx.lineWidth = 1;

      // 轿厢（按浮点楼层插值）
      var carY = floorY(Math.ceil(e.floor)) + (Math.ceil(e.floor) - e.floor) * FLOOR_H + 22;
      ctx.fillStyle = e.coldRisk ? '#8a4a2b' : '#3a5a8a';
      ctx.fillRect(x + 4, carY, SHAFT.W - 8, 40);
      ctx.fillStyle = '#eef2fa';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(id, x + SHAFT.W / 2 - 5, carY + 17);
      ctx.font = '10px sans-serif';
      ctx.fillText(e.load.length + '载', x + SHAFT.W / 2 - 9, carY + 32);

      // 停靠队列
      ctx.fillStyle = '#9fb0cc';
      ctx.font = '11px sans-serif';
      var q = e.stops.length ? e.stops.join('→') : '空闲';
      ctx.fillText(id + ': ' + q, x - 6, TOP_Y - 8);
    });

    // 配送员
    game.couriers.forEach(function (c, idx) {
      var cx, cy;
      if (c.state === 'onboard') {
        var e = game.elevators[0].load.some(function (it) { return it.courierIdx === idx; }) ? game.elevators[0] : game.elevators[1];
        cx = SHAFT[e.id] + 14 + idx * 16;
        cy = floorY(Math.ceil(e.floor)) + (Math.ceil(e.floor) - e.floor) * FLOOR_H + 52;
      } else {
        cx = 300 + idx * 26;
        cy = floorY(Math.max(1, Math.round(c.floor))) + 56;
      }
      ctx.fillStyle = c.state === 'idle' ? '#5a6a85' : '#7dcf8a';
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10141c';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(c.id, cx - 7, cy + 3);
      if (c.carrying) {
        ctx.fillStyle = c.carrying.cold ? '#6ec1ff' : '#d8c27a';
        ctx.fillRect(cx + 7, cy - 10, 8, 8);
      }
    });
  }
  // ---------------- 渲染：右侧面板 ----------------
  var STATUS_LABEL = {
    'pending': '待出库', 'queued': '出库队列', 'picking': '拣货中', 'in-transit': '配送中',
    'stored': '常温架', 'stored-cold': '已冷藏', 'consumed': '已使用', 'spoiled': '已报废', 'failed': '超时失败'
  };
  var STATUS_COLOR = {
    'pending': '#e0b45c', 'queued': '#c9a86a', 'picking': '#8ab4d8', 'in-transit': '#6ec1ff',
    'stored': '#a89a6a', 'stored-cold': '#4caf7d', 'consumed': '#5a6a85', 'spoiled': '#e05c5c', 'failed': '#e05c5c'
  };

  function drawPanel() {
    var px = 600;
    ctx.fillStyle = '#1a1f2b';
    ctx.fillRect(px, TOP_Y, 564, 456);
    ctx.strokeStyle = '#2c3648';
    ctx.strokeRect(px, TOP_Y, 564, 456);
    ctx.fillStyle = '#9fb0cc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('出库订单（点击「待出库」安排发货）', px + 14, TOP_Y + 22);

    orderRowRects = [];
    var sorted = game.orders.slice().sort(function (a, b) {
      var rank = function (o) { return o.status === 'pending' ? 0 : (o.status === 'queued' || o.status === 'picking' || o.status === 'in-transit') ? 1 : 2; };
      return rank(a) - rank(b) || a.deadline - b.deadline;
    });
    var maxRows = 15;
    for (var i = 0; i < sorted.length && i < maxRows; i++) {
      var o = sorted[i];
      var ry = TOP_Y + 32 + i * 27;
      if (o.status === 'pending') {
        ctx.fillStyle = 'rgba(224,180,92,0.08)';
        ctx.fillRect(px + 8, ry - 14, 548, 24);
      }
      orderRowRects.push({ x: px + 8, y: ry - 14, w: 548, h: 24, id: o.id, status: o.status });

      ctx.font = '12px sans-serif';
      ctx.fillStyle = STATUS_COLOR[o.status] || '#dde3ee';
      ctx.fillText(STATUS_LABEL[o.status] || o.status, px + 14, ry + 3);
      ctx.fillStyle = o.cold ? '#6ec1ff' : '#d8c27a';
      ctx.fillText((o.cold ? '❄ ' : '') + o.item, px + 84, ry + 3);
      ctx.fillStyle = '#9fb0cc';
      ctx.fillText('→ ' + o.destFloor + 'F', px + 236, ry + 3);

      // 温控条：冷链物品离库时间
      if (o.cold && !o.spoiled && o.status !== 'consumed') {
        var frac = Math.min(1, o.outOfColdMin / game.cfg.coldLimit);
        ctx.fillStyle = '#2a3347';
        ctx.fillRect(px + 292, ry - 8, 90, 8);
        ctx.fillStyle = frac < 0.5 ? '#4caf7d' : frac < 0.75 ? '#e0b45c' : '#e05c5c';
        ctx.fillRect(px + 292, ry - 8, 90 * frac, 8);
        ctx.fillStyle = '#7c8aa5';
        ctx.font = '10px sans-serif';
        ctx.fillText(o.outOfColdMin.toFixed(0) + '/' + game.cfg.coldLimit + '分', px + 292, ry + 10);
        ctx.font = '12px sans-serif';
      }

      // 截止倒计时
      var remain = o.deadline - game.t;
      var urgent = remain < 10 && ['pending', 'queued', 'picking', 'in-transit'].indexOf(o.status) >= 0;
      ctx.fillStyle = o.status === 'consumed' ? '#5a6a85' : urgent ? '#e05c5c' : '#9fb0cc';
      ctx.fillText(o.status === 'consumed' ? '—' : '剩 ' + Math.max(0, remain).toFixed(0) + ' 分', px + 400, ry + 3);
      if (o.priority === 3) {
        ctx.fillStyle = '#e05c5c';
        ctx.fillText('STAT', px + 480, ry + 3);
      }
    }

    // 手术状态卡
    var sy = TOP_Y + 470;
    ctx.fillStyle = '#9fb0cc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('手术动态（优先级随需求紧迫度变化）', px + 14, sy - 8);
    game.surgeries.forEach(function (s, i) {
      var cx0 = px + 8 + i * 188;
      ctx.fillStyle = '#1d2432';
      ctx.fillRect(cx0, sy, 180, 74);
      ctx.strokeStyle = s.priority === 3 ? '#e05c5c' : s.priority === 2 ? '#e0b45c' : '#2c3648';
      ctx.strokeRect(cx0, sy, 180, 74);
      ctx.fillStyle = '#eef2fa';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(s.id + ' ' + s.name, cx0 + 8, sy + 17);
      ctx.fillStyle = s.priority === 3 ? '#e05c5c' : s.priority === 2 ? '#e0b45c' : '#4caf7d';
      ctx.fillText('优先级 ' + '★'.repeat(s.priority), cx0 + 8, sy + 33);
      var next = s.needs.find(function (n) { return !n.fulfilled && !n.failed; });
      ctx.font = '11px sans-serif';
      if (next) {
        var left = next.needAt - game.t;
        ctx.fillStyle = left < 10 ? '#e05c5c' : '#9fb0cc';
        ctx.fillText('下一需求: ' + next.item, cx0 + 8, sy + 50);
        ctx.fillText(left > 0 ? ('还有 ' + left.toFixed(0) + ' 分') : ('已超时 ' + (-left).toFixed(0) + ' 分'), cx0 + 8, sy + 65);
      } else {
        var anyFail = s.needs.some(function (n) { return n.failed; });
        ctx.fillStyle = anyFail ? '#e05c5c' : '#4caf7d';
        ctx.fillText(anyFail ? '✗ 有需求失败' : '✓ 全部满足', cx0 + 8, sy + 54);
      }
    });

    // 事件日志
    var ly = sy + 84;
    ctx.fillStyle = '#1a1f2b';
    ctx.fillRect(px, ly, 564, 680 - ly - 10);
    ctx.strokeStyle = '#2c3648';
    ctx.strokeRect(px, ly, 564, 680 - ly - 10);
    ctx.font = '11px sans-serif';
    var logs = game.log.slice(-6);
    for (var j = 0; j < logs.length; j++) {
      var l = logs[j];
      ctx.fillStyle = l.type === 'alarm' || l.type === 'spoil' || l.type === 'fail' ? '#e05c5c'
        : l.type === 'stat' ? '#e0b45c' : l.type.indexOf('preempt') === 0 ? '#d98a4b' : '#8fa0bd';
      ctx.fillText('[' + l.t.toFixed(0).padStart(3, ' ') + '分] ' + l.msg, px + 10, ly + 18 + j * 15);
    }
  }

  function drawResult() {
    if (!game.over) return;
    var res = game.result();
    ctx.fillStyle = 'rgba(10,13,20,0.85)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = res.win ? '#4caf7d' : '#e05c5c';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(res.win ? '✓ 夜班任务成功' : '✗ 任务失败', cv.width / 2, 260);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#dde3ee';
    ctx.fillText('用时 ' + res.timeMin + ' 分钟｜送达 ' + res.delivered + ' 件｜报废 ' + res.spoiled + '/' + res.coldTotal +
      '（' + (res.spoilRate * 100).toFixed(1) + '%）｜失败需求 ' + res.failedNeeds + ' 项', cv.width / 2, 310);
    ctx.fillStyle = '#8fa0bd';
    ctx.font = '14px sans-serif';
    ctx.fillText('点击「重新开局」再来一班', cv.width / 2, 350);
    ctx.textAlign = 'left';
  }

  // ---------------- 主循环 ----------------
  var lastTs = 0, acc = 0;
  function frame(ts) {
    var dtReal = Math.min(0.1, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (!paused && !game.over) {
      acc += dtReal * speed; // 1x = 1 模拟分钟/秒
      while (acc >= 0.05) { game.step(0.05); acc -= 0.05; }
    }
    if (game.over && !endSoundPlayed) {
      endSoundPlayed = true;
      if (game.result().win) AudioSys.win(); else AudioSys.lose();
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    floorBtnRects = [];
    drawHeader();
    drawBuilding();
    drawPanel();
    drawResult();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
