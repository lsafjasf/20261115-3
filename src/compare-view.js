/*
 * 轨迹对比视图：用虚拟时钟分别以两种“渲染帧率”驱动同一份确定性物理。
 * 物理步进完全一致（同样的 simTime => 同样的步数与状态），
 * 区别只在渲染采样时刻与插值 alpha，因此差异仅来自插值误差。
 */
(function (global) {
  'use strict';

  var Physics = global.Physics;

  function createRunner(frameRate, baseWorld) {
    var FIXED_DT = Physics.FIXED_DT;
    var frameInterval = 1 / frameRate;
    var prev = Physics.cloneWorld(baseWorld);
    var current = Physics.cloneWorld(baseWorld);
    var accumulator = 0;
    var simTime = 0;
    var renderedSamples = [];
    var checkpoints = [];

    function advance(realSeconds) {
      accumulator += realSeconds;
      while (accumulator >= FIXED_DT) {
        prev = Physics.cloneWorld(current);
        Physics.stepWorld(current, FIXED_DT);
        accumulator -= FIXED_DT;
        simTime += FIXED_DT;
        checkpoints.push({
          simTime: simTime,
          x: current.ball.x,
          y: current.ball.y,
          vx: current.ball.vx,
          vy: current.ball.vy
        });
      }
      var alpha = accumulator / FIXED_DT;
      var rendered = Physics.interpolateBall(prev, current, alpha);
      renderedSamples.push({
        simTime: simTime + accumulator,
        x: rendered.x,
        y: rendered.y
      });
    }

    return {
      frameRate: frameRate,
      frameInterval: frameInterval,
      advance: advance,
      getSimTime: function () { return simTime; },
      getSteps: function () { return Math.round(simTime / FIXED_DT); },
      getSamples: function () { return renderedSamples; },
      getCheckpoints: function () { return checkpoints; },
      getCurrent: function () { return current; }
    };
  }

  function initCompareView() {
    var canvas = document.getElementById('compare-canvas');
    var ctx = canvas.getContext('2d');
    var baseWorld = Physics.createWorld();

    var selectA = document.getElementById('rate-a');
    var selectB = document.getElementById('rate-b');
    var runnerA = createRunner(parseInt(selectA.value, 10), baseWorld);
    var runnerB = createRunner(parseInt(selectB.value, 10), baseWorld);

    var virtualTime = 0;
    var timeScale = 1;
    var paused = false;
    var maxSimSeconds = 12;
    var metrics = document.getElementById('compare-metrics');

    function rebuildRunners() {
      runnerA = createRunner(parseInt(selectA.value, 10), baseWorld);
      runnerB = createRunner(parseInt(selectB.value, 10), baseWorld);
      virtualTime = 0;
      metrics.textContent = '运行中，等待采样…';
    }

    selectA.addEventListener('change', rebuildRunners);
    selectB.addEventListener('change', rebuildRunners);

    var pauseBtn = document.getElementById('compare-pause');
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      pauseBtn.textContent = paused ? '继续' : '暂停';
    });
    document.querySelectorAll('[data-compare-scale]').forEach(function (button) {
      button.addEventListener('click', function () {
        timeScale = parseFloat(button.getAttribute('data-compare-scale'), 10);
      });
    });
    document.getElementById('compare-restart').addEventListener('click', rebuildRunners);

    var lastNow = performance.now();

    function frame(now) {
      var realDelta = Math.min((now - lastNow) / 1000, 0.1);
      lastNow = now;

      if (!paused && virtualTime < maxSimSeconds) {
        virtualTime += realDelta * timeScale;
        pumpRunner(runnerA);
        pumpRunner(runnerB);
      }

      draw();
      updateMetrics();
      global.requestAnimationFrame(frame);
    }

    // 虚拟时钟走到 runner 下一个采样点时才触发一帧
    function pumpRunner(runner) {
      var nextFrameAt = runner.getSamples().length * runner.frameInterval;
      while (nextFrameAt <= virtualTime && runner.getSimTime() < maxSimSeconds) {
        runner.advance(runner.frameInterval);
        nextFrameAt += runner.frameInterval;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#101826';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawTrail(runnerA.getSamples(), '#60a5fa');
      drawTrail(runnerB.getSamples(), '#f472b6');
      drawHead(runnerA, '#60a5fa');
      drawHead(runnerB, '#f472b6');
    }

    function drawTrail(samples, color) {
      if (samples.length < 2) {
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      samples.forEach(function (sample, index) {
        if (index === 0) {
          ctx.moveTo(sample.x, sample.y);
        } else {
          ctx.lineTo(sample.x, sample.y);
        }
      });
      ctx.stroke();
    }

    function drawHead(runner, color) {
      var samples = runner.getSamples();
      if (!samples.length) {
        return;
      }
      var head = samples[samples.length - 1];
      ctx.beginPath();
      ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // 把两组渲染样本对齐到相同模拟时刻后比较位置
    function updateMetrics() {
      var samplesA = runnerA.getSamples();
      var samplesB = runnerB.getSamples();
      if (samplesA.length < 2 || samplesB.length < 2) {
        return;
      }
      var maxDistance = 0;
      var maxAt = 0;
      var compared = 0;
      var tolerance = 1e-9;
      var j = 0;
      for (var i = 0; i < samplesA.length; i++) {
        var target = samplesA[i].simTime;
        while (j < samplesB.length - 1 && samplesB[j + 1].simTime <= target) {
          j++;
        }
        if (j >= samplesB.length - 1) {
          break;
        }
        var b0 = samplesB[j];
        var b1 = samplesB[j + 1];
        var span = b1.simTime - b0.simTime;
        if (span < tolerance) {
          continue;
        }
        var ratio = (target - b0.simTime) / span;
        var bx = b0.x + (b1.x - b0.x) * ratio;
        var by = b0.y + (b1.y - b0.y) * ratio;
        var dx = bx - samplesA[i].x;
        var dy = by - samplesA[i].y;
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxDistance) {
          maxDistance = distance;
          maxAt = target;
        }
        compared++;
      }

      var physicsEqual = compareCheckpoints(runnerA, runnerB);
      metrics.innerHTML =
        '帧率 ' + runnerA.frameRate + 'Hz vs ' + runnerB.frameRate + 'Hz' +
        ' | 物理步数 ' + runnerA.getSteps() + ' / ' + runnerB.getSteps() +
        ' | 物理真值完全一致: ' + (physicsEqual ? '是' : '否') +
        ' | 对齐 ' + compared + ' 个采样点' +
        ' | 最大渲染偏差 ' + maxDistance.toFixed(4) + ' px @ ' +
        maxAt.toFixed(3) + 's';
    }

    function compareCheckpoints(a, b) {
      var ca = a.getCheckpoints();
      var cb = b.getCheckpoints();
      var count = Math.min(ca.length, cb.length);
      for (var i = 0; i < count; i++) {
        if (ca[i].x !== cb[i].x || ca[i].y !== cb[i].y ||
            ca[i].vx !== cb[i].vx || ca[i].vy !== cb[i].vy) {
          return false;
        }
      }
      return ca.length === cb.length || count > 0;
    }

    global.requestAnimationFrame(frame);
  }

  global.initCompareView = initCompareView;
})(typeof window !== 'undefined' ? window : globalThis);
