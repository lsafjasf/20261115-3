/* UI wiring, simulation tick loop and guided scenarios. */
(function () {
  'use strict';

  var sim = MineSim.createSimulation();
  var renderer = new MineRenderer(document.getElementById('mine'));
  var audio = new MineAudio();
  var speed = 4; // simulated minutes per real second
  var timer = null;
  var paused = false;

  function $(id) { return document.getElementById(id); }

  function fmtTime(t) {
    var hh = String(Math.floor(t / 60) + 8).padStart(2, '0');
    var mm = String(t % 60).padStart(2, '0');
    return hh + ':' + mm;
  }

  function renderHud() {
    var face = sim.nodeById.FACE;
    $('clock').textContent = fmtTime(sim.t);
    $('progressBar').style.width = sim.progress.toFixed(1) + '%';
    $('progressText').textContent = sim.progress.toFixed(0) + '%';
    $('faceGas').textContent = face.gas.toFixed(2) + ' %';
    $('faceDust').textContent = face.dust.toFixed(2) + ' mg/m³';
    $('faceFlow').textContent = sim.stats.faceFlow.toFixed(1);
    $('intakeFlow').textContent = sim.stats.intakeFlow.toFixed(1);
    $('mainState').textContent = sim.fans.main.on
      ? (sim.fans.main.reverse ? '反风中' : '运行') : '停机';
    $('localState').textContent =
      { off: '停机', force: '压入式', exhaust: '抽出式' }[sim.fans.local.mode];
    var gasBad = face.gas > sim.gasLimit;
    var dustBad = face.dust > sim.dustLimit;
    $('gasState').className = gasBad ? 'bad' : 'good';
    $('gasState').textContent = gasBad ? '超标' : '安全';
    $('dustState').className = dustBad ? 'bad' : 'good';
    $('dustState').textContent = dustBad ? '超标' : '安全';
    $('shortState').className = sim.alarms.shortCircuit ? 'bad' : 'good';
    $('shortState').textContent = sim.alarms.shortCircuit ? '短路报警' : '正常';

    var banner = $('banner');
    if (sim.status === 'won') {
      banner.className = 'banner ok show';
      banner.textContent = '任务完成：全部传感器低于安全阈值，工班内恢复生产';
    } else if (sim.status === 'lost') {
      banner.className = 'banner danger show';
      banner.textContent = '工班结束：仍有传感器超标，任务失败';
    } else if (sim.alarms.shortCircuit) {
      banner.className = 'banner danger show';
      banner.textContent = '报警：风流短路！新鲜风未送达工作面，请立即关闭 D2';
    } else if (sim.alarms.list.length > 0) {
      banner.className = 'banner warn show';
      banner.textContent = '报警：' + sim.alarms.list.length +
        ' 个传感器超标（瓦斯>' + sim.gasLimit + '% / 粉尘>' + sim.dustLimit + 'mg/m³）';
    } else {
      banner.className = 'banner show';
      banner.textContent = '所有传感器处于安全阈值内，继续完成本班作业';
    }
    renderLog();
    renderSensors();
  }

  function renderLog() {
    $('log').innerHTML = sim.log.slice(0, 9).map(function (entry) {
      return '<li class="' + entry.level + '"><span>' + fmtTime(entry.t) +
        '</span> ' + entry.text + '</li>';
    }).join('');
  }

  function renderSensors() {
    var rows = sim.nodes.filter(function (n) { return n.sensor; }).map(function (n) {
      var g = n.gas > sim.gasLimit ? 'bad' : 'good';
      var d = n.dust > sim.dustLimit ? 'bad' : 'good';
      return '<tr><td>' + n.id + '</td><td class="' + g + '">' +
        n.gas.toFixed(2) + '</td><td class="' + d + '">' +
        n.dust.toFixed(2) + '</td></tr>';
    }).join('');
    $('sensors').innerHTML = rows;
  }

  function frame() {
    renderer.draw(sim);
    renderHud();
    audio.update(sim);
  }

  function tick() {
    if (paused || sim.status !== 'running') return;
    MineSim.step(sim);
  }

  function start() {
    timer = setInterval(tick, 1000 / speed);
    setInterval(frame, 90);
  }

  function send(name, value) {
    audio.ensure();
    audio.click();
    MineSim.command(sim, name, value);
    if (sim.status === 'running') MineSim.step(sim);
    frame();
  }

  function reset(newSim) {
    sim = newSim || MineSim.createSimulation();
    paused = false;
    $('pauseBtn').textContent = '暂停';
    Object.keys(sim.doors).forEach(function (id) {
      var open = sim.doors[id].open;
      $(id).textContent = id + ' ' + (open ? '开' : '关');
      $(id).className = open ? 'ctrl warn' : 'ctrl';
    });
    frame();
  }

  function bindButtons() {
    Object.keys(sim.doors).forEach(function (id) {
      var btn = $(id);
      btn.addEventListener('click', function () {
        var open = !sim.doors[id].open;
        send('door', { id: id, open: open });
        btn.textContent = id + ' ' + (open ? '开' : '关');
        btn.className = open ? 'ctrl warn' : 'ctrl';
      });
    });
    $('mainOff').addEventListener('click', function () {
      send('mainFan', { on: false });
    });
    $('mainOn').addEventListener('click', function () {
      send('mainFan', { on: true });
    });
    $('reverseBtn').addEventListener('click', function () {
      send('reverse', { reverse: !sim.fans.main.reverse });
    });
    ['off', 'force', 'exhaust'].forEach(function (mode) {
      $('local_' + mode).addEventListener('click', function () {
        send('localFan', { mode: mode });
      });
    });
    $('pauseBtn').addEventListener('click', function () {
      paused = !paused;
      $('pauseBtn').textContent = paused ? '继续' : '暂停';
    });
    $('speedBtn').addEventListener('click', function () {
      speed = speed === 4 ? 12 : 4;
      clearInterval(timer);
      start();
      $('speedBtn').textContent = speed === 4 ? '速度 x1' : '速度 x3';
    });
    $('muteBtn').addEventListener('click', function () {
      audio.ensure();
      audio.setMuted(!audio.muted);
      $('muteBtn').textContent = audio.muted ? '取消静音' : '静音';
    });
    $('resetBtn').addEventListener('click', function () { reset(); });
    $('demoRecovery').addEventListener('click', demoRecovery);
    $('demoShort').addEventListener('click', demoShortCircuit);
  }

  // Guided recovery: correct procedure fast-forwarded, with logged milestones.
  function demoRecovery() {
    reset();
    MineSim.addLog(sim, '演练开始：确认主风机运行，启动压入式局扇', 'ok');
    MineSim.command(sim, 'localFan', { mode: 'force' });
    var safeAt = -1;
    var stage = setInterval(function () {
      for (var i = 0; i < 6; i++) {
        if (sim.status !== 'running') break;
        MineSim.step(sim);
        if (safeAt < 0 && MineSim.allSensorsSafe(sim) && !sim.alarms.shortCircuit) {
          safeAt = sim.t;
          MineSim.addLog(sim, '第 ' + sim.t + ' 分钟：全部传感器达标', 'ok');
        }
      }
      frame();
      if (sim.status !== 'running') clearInterval(stage);
    }, 120);
  }

  // Guided short-circuit: open D2 and hold the wrong state until alarm is obvious.
  function demoShortCircuit() {
    reset();
    MineSim.command(sim, 'localFan', { mode: 'force' });
    MineSim.addLog(sim, '违规操作：打开进回风短路风门 D2', 'danger');
    MineSim.command(sim, 'door', { id: 'D2', open: true });
    $('D2').textContent = 'D2 开';
    $('D2').className = 'ctrl warn';
    var minutes = 0;
    var stage = setInterval(function () {
      MineSim.step(sim);
      minutes += 1;
      frame();
      if (minutes >= 12 || sim.status !== 'running') clearInterval(stage);
    }, 350);
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindButtons();
    start();
    frame();
  });
})();
