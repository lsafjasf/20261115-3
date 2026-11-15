/*
 * 确定性固定步长物理世界：弹跳小球。
 * 同一步长、同一初始状态、同样的步进次数 => 完全相同的浮点状态，
 * 与渲染帧率无关。同时挂到 window / globalThis 供浏览器与 Node 复用。
 */
(function (global) {
  'use strict';

  var FIXED_DT = 1 / 120; // 120Hz 固定模拟步长（秒）

  function createWorld(config) {
    config = config || {};
    return {
      radius: 14,
      gravity: 900,
      restitution: 0.85,
      restVelocity: 40,
      width: config.width != null ? config.width : 800,
      height: config.height != null ? config.height : 420,
      ball: {
        x: config.x != null ? config.x : 80,
        y: config.y != null ? config.y : 80,
        vx: config.vx != null ? config.vx : 170,
        vy: config.vy != null ? config.vy : 0
      }
    };
  }

  function cloneWorld(world) {
    return {
      radius: world.radius,
      gravity: world.gravity,
      restitution: world.restitution,
      restVelocity: world.restVelocity,
      width: world.width,
      height: world.height,
      ball: {
        x: world.ball.x,
        y: world.ball.y,
        vx: world.ball.vx,
        vy: world.ball.vy
      }
    };
  }

  function reflect(bound, pos, velocity, restitution) {
    var overshoot = pos - bound;
    return {
      pos: bound - overshoot,
      vel: -Math.abs(velocity) * restitution
    };
  }

  /* 纯确定性步进：只依赖传入状态与固定 dt */
  function stepWorld(world, dt) {
    var ball = world.ball;
    var r = world.radius;
    var left = r;
    var right = world.width - r;
    var top = r;
    var bottom = world.height - r;

    ball.vy += world.gravity * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < left) {
      var hitL = reflect(left, ball.x, ball.vx, world.restitution);
      ball.x = hitL.pos;
      ball.vx = hitL.vel;
    } else if (ball.x > right) {
      var hitR = reflect(right, ball.x, ball.vx, world.restitution);
      ball.x = hitR.pos;
      ball.vx = hitR.vel;
    }

    if (ball.y < top) {
      var hitT = reflect(top, ball.y, ball.vy, world.restitution);
      ball.y = hitT.pos;
      ball.vy = hitT.vel;
    } else if (ball.y > bottom) {
      var hitB = reflect(bottom, ball.y, ball.vy, world.restitution);
      ball.y = hitB.pos;
      ball.vy = hitB.vel;
      if (Math.abs(ball.vy) < world.restVelocity) {
        ball.vy = 0; // 防止静止时反复微弹
      }
    }
  }

  /* 在相邻两个物理状态之间做线性插值，alpha ∈ [0,1] */
  function interpolateBall(previous, current, alpha) {
    // 浮点累加可能产生 1e-16 级的伪 alpha，钳制后避免“渲染点退回到上一状态”
    if (alpha < 1e-9) {
      alpha = 0;
    } else if (alpha > 1 - 1e-9) {
      alpha = 1;
    }
    var pb = previous.ball;
    var cb = current.ball;
    return {
      x: pb.x + (cb.x - pb.x) * alpha,
      y: pb.y + (cb.y - pb.y) * alpha
    };
  }

  global.Physics = {
    FIXED_DT: FIXED_DT,
    createWorld: createWorld,
    cloneWorld: cloneWorld,
    stepWorld: stepWorld,
    interpolateBall: interpolateBall
  };
})(typeof window !== 'undefined' ? window : globalThis);
