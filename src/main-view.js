/* 主视图：固定步长模拟 + 插值渲染 + 暂停/倍速/失焦恢复 */
(function (global) {
  'use strict';

  var Physics = global.Physics;
  var createFixedStepLoop = global.FixedStepLoop.createFixedStepLoop;

  function initMainView() {
    var canvas = document.getElementById('main-canvas');
    var ctx = canvas.getContext('2d');
    var world = Physics.createWorld();
    var trail = [];
    var maxTrail = 240;

    var hud = {
      simTime: document.getElementById('hud-sim-time'),
      steps: document.getElementById('hud-steps'),
      fps: document.getElementById('hud-fps'),
      alpha: document.getElementById('hud-alpha'),
      scale: document.getElementById('hud-scale'),
      state: document.getElementById('hud-state')
    };

    var frameTimes = [];

    var loop = createFixedStepLoop(Physics.cloneWorld(world), {
      onRender: function (prev, current, alpha, simTime) {
        var rendered = Physics.interpolateBall(prev, current, alpha);
        draw(ctx, current, rendered, trail);
        trail.push(rendered);
        if (trail.length > maxTrail) {
          trail.shift();
        }

        var now = performance.now();
        if (frameTimes.length && now - frameTimes[0] > 1000) {
          frameTimes.shift();
        }
        frameTimes.push(now);

        var snap = loop.getSnapshot();
        hud.simTime.textContent = simTime.toFixed(3) + ' s';
        hud.steps.textContent = String(snap.steps);
        hud.fps.textContent = String(frameTimes.length);
        hud.alpha.textContent = alpha.toFixed(4);
        hud.scale.textContent = snap.timeScale.toFixed(2) + 'x';
        hud.state.textContent = snap.paused ? '已暂停' : '运行中';
      }
    });

    function draw(context, current, rendered, points) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#101826';
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.strokeStyle = 'rgba(120,170,255,0.35)';
      context.lineWidth = 2;
      context.beginPath();
      points.forEach(function (point, index) {
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      context.stroke();

      // 插值后的渲染位置（外发光）
      context.beginPath();
      context.arc(rendered.x, rendered.y, current.radius + 4, 0, Math.PI * 2);
      context.fillStyle = 'rgba(96,165,250,0.18)';
      context.fill();

      context.beginPath();
      context.arc(rendered.x, rendered.y, current.radius, 0, Math.PI * 2);
      context.fillStyle = '#60a5fa';
      context.fill();

      // 物理真值位置（小叉，用于直观看到插值偏差）
      context.strokeStyle = '#fbbf24';
      context.lineWidth = 2;
      var truth = current.ball;
      context.beginPath();
      context.moveTo(truth.x - 5, truth.y - 5);
      context.lineTo(truth.x + 5, truth.y + 5);
      context.moveTo(truth.x + 5, truth.y - 5);
      context.lineTo(truth.x - 5, truth.y + 5);
      context.stroke();
    }

    var pauseBtn = document.getElementById('btn-pause');
    pauseBtn.addEventListener('click', function () {
      var snap = loop.getSnapshot();
      loop.setPaused(!snap.paused);
      pauseBtn.textContent = snap.paused ? '暂停' : '继续';
    });

    document.querySelectorAll('[data-scale]').forEach(function (button) {
      button.addEventListener('click', function () {
        loop.setTimeScale(parseFloat(button.getAttribute('data-scale'), 10));
      });
    });

    document.getElementById('btn-reset').addEventListener('click', function () {
      global.location.reload();
    });

    // 失焦/切后台：停止累计真实时间，回来后重建基线
    function onHidden() {
      loop.resetTimingBaseline();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        onHidden();
      } else {
        loop.resetTimingBaseline();
      }
    });
    global.addEventListener('blur', onHidden);
    global.addEventListener('focus', function () {
      loop.resetTimingBaseline();
    });

    loop.start();
    global.__mainLoop = loop;
  }

  global.initMainView = initMainView;
})(typeof window !== 'undefined' ? window : globalThis);
