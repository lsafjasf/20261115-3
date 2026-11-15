/*
 * 固定时间步循环（fixed timestep + accumulator）。
 *
 * - 物理只以 FIXED_DT 推进，渲染帧率只影响插值 alpha，不影响模拟结果；
 * - 单帧真实时间被钳制，避免卡顿/切后台后“死亡螺旋”补步；
 * - 暂停只冻结模拟时间，恢复后继续，不丢状态也不补算暂停期间的时间；
 * - 倍速通过给累计时间乘 timeScale 实现，物理步长本身不变；
 * - 窗口失焦/隐藏时停止计时，重新可见时重置时间基线，杜绝大跳变。
 */
(function (global) {
  'use strict';

  var Physics = global.Physics;
  var MAX_FRAME_DELTA = 0.25; // 单帧最多计入 250ms 模拟时间

  function createFixedStepLoop(world, callbacks) {
    callbacks = callbacks || {};
    var FIXED_DT = Physics.FIXED_DT;

    var accumulator = 0;
    var simTime = 0;
    var timeScale = 1;
    var paused = false;
    var running = false;
    var lastTimestamp = 0;
    var rafId = 0;

    // prev 是“当前已确认物理状态”的前一个状态，用于插值
    var prevWorld = Physics.cloneWorld(world);
    var currentWorld = Physics.cloneWorld(world);

    function frame(timestamp) {
      if (!running) {
        return;
      }
      if (lastTimestamp === 0) {
        lastTimestamp = timestamp;
      }
      var realDelta = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      if (realDelta > MAX_FRAME_DELTA) {
        realDelta = MAX_FRAME_DELTA;
      }

      if (!paused) {
        accumulator += realDelta * timeScale;
        // 防止极端情况下单帧补步过多
        var maxAccumulated = MAX_FRAME_DELTA * timeScale;
        if (accumulator > maxAccumulated) {
          accumulator = maxAccumulated;
        }

        while (accumulator >= FIXED_DT) {
          // 每次步进前保存：多步后 prev 恰为最新状态的前一个物理状态，
          // 插值区间永远是相邻两步 [n-1, n]
          prevWorld = cloneBallState(currentWorld);
          Physics.stepWorld(currentWorld, FIXED_DT);
          accumulator -= FIXED_DT;
          simTime += FIXED_DT;
          if (callbacks.onStep) {
            callbacks.onStep(simTime);
          }
        }
      }

      var alpha = accumulator / FIXED_DT; // 始终在 [0,1)
      if (callbacks.onRender) {
        callbacks.onRender(prevWorld, currentWorld, alpha, simTime);
      }
      rafId = global.requestAnimationFrame(frame);
    }

    function cloneBallState(source) {
      return Physics.cloneWorld(source);
    }

    function start() {
      if (running) {
        return;
      }
      running = true;
      lastTimestamp = 0; // 由 rAF 首帧重新建立基线
      rafId = global.requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (rafId && global.cancelAnimationFrame) {
        global.cancelAnimationFrame(rafId);
      }
      rafId = 0;
    }

    function setPaused(value) {
      paused = !!value;
      if (!paused) {
        // 恢复时丢弃暂停期间积压的时间差
        accumulator = Math.min(accumulator, FIXED_DT);
      }
    }

    function setTimeScale(scale) {
      timeScale = scale > 0 ? scale : 0;
    }

    /* 失焦/隐藏恢复后调用：重置时间基线，下一帧不产生巨大 delta */
    function resetTimingBaseline() {
      lastTimestamp = 0;
      accumulator = 0;
    }

    function getSnapshot() {
      return {
        simTime: simTime,
        accumulator: accumulator,
        timeScale: timeScale,
        paused: paused,
        steps: Math.round(simTime / FIXED_DT),
        ball: {
          x: currentWorld.ball.x,
          y: currentWorld.ball.y,
          vx: currentWorld.ball.vx,
          vy: currentWorld.ball.vy
        }
      };
    }

    return {
      start: start,
      stop: stop,
      setPaused: setPaused,
      setTimeScale: setTimeScale,
      resetTimingBaseline: resetTimingBaseline,
      getSnapshot: getSnapshot,
      getWorld: function () { return currentWorld; }
    };
  }

  global.FixedStepLoop = {
    createFixedStepLoop: createFixedStepLoop,
    MAX_FRAME_DELTA: MAX_FRAME_DELTA
  };
})(typeof window !== 'undefined' ? window : globalThis);
