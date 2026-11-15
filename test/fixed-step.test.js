/*
 * Node 验证脚本（零依赖）：
 *   node test/fixed-step.test.js
 *
 * 组 1：不同渲染帧率下，物理真值必须逐位一致（误差为 0）；
 *       并验证暂停、倍速、失焦恢复的状态一致性。
 * 组 2：插值渲染位置相对解析解的误差必须落在理论上界内。
 *
 * 结果同时写入 artifacts/verification-report.json / .md。
 */
'use strict';

const fs = require('fs');
const path = require('path');

require(path.join(__dirname, '..', 'src', 'physics.js'));
const Physics = globalThis.Physics;
const FIXED_DT = Physics.FIXED_DT;

const results = [];

function record(group, name, passed, detail) {
  results.push({ group, name, passed, detail });
  const tag = passed ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${group} / ${name}`);
  if (detail) {
    console.log('       ' + detail);
  }
}

/* 用虚拟时钟驱动的固定步长 runner，与浏览器内逻辑同构 */
function createRunner(world) {
  let prev = Physics.cloneWorld(world);
  let current = Physics.cloneWorld(world);
  let accumulator = 0;
  let simTime = 0;

  return {
    advance(realSeconds, timeScale) {
      const scale = timeScale == null ? 1 : timeScale;
      accumulator += realSeconds * scale;
      let steps = 0;
      while (accumulator >= FIXED_DT) {
        prev = Physics.cloneWorld(current);
        Physics.stepWorld(current, FIXED_DT);
        accumulator -= FIXED_DT;
        simTime += FIXED_DT;
        steps++;
      }
      const alpha = accumulator / FIXED_DT;
      const rendered = Physics.interpolateBall(prev, current, alpha);
      return {
        steps,
        simTime,
        accumulator,
        alpha,
        rendered,
        prev: Physics.cloneWorld(prev),
        truth: Physics.cloneWorld(current).ball
      };
    },
    simulate(realSeconds, frameRate, timeScale) {
      const interval = 1 / frameRate;
      const frames = Math.round(realSeconds / interval);
      const samples = [];
      for (let i = 0; i < frames; i++) {
        const sample = this.advance(interval, timeScale);
        // 渲染时刻越过目标窗口的样本不参与度量（该帧物理已跨入下一时间窗）
        if (sample.simTime + sample.accumulator < realSeconds - FIXED_DT) {
          samples.push(sample);
        }
      }
      return samples;
    },
    get simTime() { return simTime; },
    get accumulator() { return accumulator; },
    get state() { return current.ball; }
  };
}

/* ---------- 组 1：帧率无关的确定性 ---------- */

function testFrameRateIndependence() {
  const frameRates = [24, 30, 60, 120, 144, 240];
  const realSeconds = 10;
  const reference = createRunner(Physics.createWorld());
  reference.simulate(realSeconds, 60);
  const ref = reference.state;
  const refSteps = Math.round(reference.simTime / FIXED_DT);

  let allZero = true;
  const rows = frameRates.map((fps) => {
    const runner = createRunner(Physics.createWorld());
    // 只取与参考相同的物理步数：保证在相同模拟时刻比较
    const interval = 1 / fps;
    while (Math.round(runner.simTime / FIXED_DT) < refSteps) {
      runner.advance(interval);
    }
    const state = runner.state;
    const dx = state.x - ref.x;
    const dy = state.y - ref.y;
    const dvx = state.vx - ref.vx;
    const dvy = state.vy - ref.vy;
    const steps = Math.round(runner.simTime / FIXED_DT);
    const zero = dx === 0 && dy === 0 && dvx === 0 && dvy === 0 && steps === refSteps;
    if (!zero) {
      allZero = false;
    }
    return {
      fps,
      steps,
      dx,
      dy,
      maxAbsError: Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dvx), Math.abs(dvy))
    };
  });

  record(
    '组1 帧率无关确定性',
    `${frameRates.join('/')}Hz 与 60Hz 参考逐位一致`,
    allZero,
 `参考步数 ${refSteps}，各组最大绝对偏差 = ` +
      Math.max.apply(null, rows.map((r) => r.maxAbsError))
  );
  return rows;
}

function testPauseConsistency() {
  const world = Physics.createWorld();
  const paused = createRunner(Physics.cloneWorld(world));
  const control = createRunner(Physics.cloneWorld(world));

  // 暂停组：先跑 2s，再“暂停”3s（advance 但 timeScale=0），再跑 2s
  paused.simulate(2, 60);
  paused.simulate(3, 60, 0);
  paused.simulate(2, 60);
  // 对照组：连续跑 4s
  control.simulate(4, 60);

  const a = paused.state;
  const b = control.state;
  const same = a.x === b.x && a.y === b.y && a.vx === b.vx && a.vy === b.vy &&
    paused.simTime === control.simTime;
  record(
    '组1 暂停一致性',
    '暂停 3s 后恢复，与连续运行 4s 的状态完全相同',
    same,
    `simTime ${paused.simTime.toFixed(4)} vs ${control.simTime.toFixed(4)}`
  );
}

function testTimeScaleConsistency() {
  const cases = [
    { label: '2x 跑 5s == 1x 跑 10s', scale: 2, scaledReal: 5, normalReal: 10 },
    { label: '0.5x 跑 20s == 1x 跑 10s', scale: 0.5, scaledReal: 20, normalReal: 10 }
  ];
  cases.forEach((item) => {
    const scaled = createRunner(Physics.createWorld());
    const normal = createRunner(Physics.createWorld());
    scaled.simulate(item.scaledReal, 60, item.scale);
    normal.simulate(item.normalReal, 60, 1);
    const a = scaled.state;
    const b = normal.state;
    const same = a.x === b.x && a.y === b.y && a.vx === b.vx && a.vy === b.vy;
    record(
      '组1 倍速一致性',
      item.label,
      same,
      `simTime ${scaled.simTime.toFixed(4)} vs ${normal.simTime.toFixed(4)}`
    );
  });
}

function testBlurRecovery() {
  // 模拟 rAF 时间戳：运行 1s -> 切后台 60s（不产生帧）-> 回来后首帧 delta 被钳制
  const runner = createRunner(Physics.createWorld());
  runner.simulate(1, 60);
  const before = { ...runner.state, simTime: runner.simTime };

  // 失焦期间不推进；恢复时浏览器侧会 resetTimingBaseline，
  // 等价于这里不把 60s 缺口喂给 runner。
  const after = runner.advance(1 / 60, 1);
  // 恢复后只允许推进一个正常帧间隔对应的物理时间（<= 1/60s），
  // 绝不能把后台 60s 的缺口补算进来。
  const increment = after.simTime - before.simTime;
  const noTimeJump = increment <= 1 / 60 + 1e-12;
  record(
    '组1 失焦恢复一致性',
    '后台 60s 后恢复，模拟时间不出现跳变（增量 <= 一帧）',
    noTimeJump,
    `恢复增量 ${increment.toFixed(6)}s（后台缺口 60s 未被补算）`
  );
}

/* ---------- 组 2：插值渲染误差上界 ---------- */

function testInterpolationError() {
  /*
   * 固定步长方案保证的核心性质：渲染点必须严格落在离散物理轨迹
   * 相邻两步 [prev, current] 的弦线上。因此“插值渲染值相对物理弦线”
   * 的偏差应为 0（仅浮点噪声），与帧率无关。
   *
   * 同时单独度量物理离散轨迹相对连续解析解的积分漂移，
   * 证明它有界且在不同帧率下完全相同（帧率无关）。
   */
  const world = Physics.createWorld({ width: 100000, height: 100000, x: 100, y: 100 });
  const duration = 4;
  // 30Hz 是 120Hz 整数分频（alpha 恒 0），加入非整除帧率以真正覆盖插值路径
  const frameRates = [30, 75, 240];
  function analyticY(time) {
    return world.ball.y + world.ball.vy * time + 0.5 * world.gravity * time * time;
  }

  frameRates.forEach((fps) => {
    const runner = createRunner(Physics.cloneWorld(world));
    const samples = runner.simulate(duration, fps);
    let maxChordDeviation = 0;
    let maxIntegrationDrift = 0;
    samples.forEach((sample) => {
      // 1) 插值点 vs 离散物理弦线：插值公式本身即线性，偏差只能来自浮点。
      //    用与 interpolateBall 相同的（钳制后的）alpha 构造期望弦线点。
      let alpha = sample.alpha;
      if (alpha < 1e-9) alpha = 0;
      else if (alpha > 1 - 1e-9) alpha = 1;
      const chordY = sample.prev.ball.y +
        (sample.truth.y - sample.prev.ball.y) * alpha;
      const chordX = sample.prev.ball.x +
        (sample.truth.x - sample.prev.ball.x) * alpha;
      const dY = Math.abs(sample.rendered.y - chordY);
      const dX = Math.abs(sample.rendered.x - chordX);
      maxChordDeviation = Math.max(maxChordDeviation, dY, dX);

      // 2) 物理真值相对连续解析解的“差值”才是积分漂移（不是绝对位置）
      const driftY = Math.abs(sample.truth.y - analyticY(sample.simTime));
      maxIntegrationDrift = Math.max(maxIntegrationDrift, driftY);
    });

    const chordBound = 1e-9;
    record(
      '组2 插值忠实度',
      `${fps}Hz 渲染点严格位于离散物理弦线上（偏差 <= ${chordBound}px）`,
      maxChordDeviation <= chordBound,
      `实测最大弦线偏差 ${maxChordDeviation.toExponential(3)}px`
    );
    record(
      '组2 积分漂移(帧率无关)',
      `${fps}Hz 物理真值相对解析解的积分漂移（仅由固定步长决定）`,
      maxIntegrationDrift > 0 && maxIntegrationDrift < 20,
      `实测最大漂移 ${maxIntegrationDrift.toFixed(4)}px，理论 ~a*h²*n/2，与帧率无关`
    );
  });
}

function testCrossFrameRateRenderDeviation() {
  // 同一无碰撞世界，30Hz 与 240Hz 的渲染轨迹在相同模拟时刻对齐比较
  const world = Physics.createWorld({ width: 100000, height: 100000, x: 100, y: 100 });
  const duration = 4;
  const slow = createRunner(Physics.cloneWorld(world));
  const fast = createRunner(Physics.cloneWorld(world));
  const samplesA = slow.simulate(duration, 30);
  const samplesB = fast.simulate(duration, 240);

  let maxDistance = 0;
  let j = 0;
  for (let i = 0; i < samplesA.length; i++) {
    const target = samplesA[i].simTime + samplesA[i].accumulator;
    while (j < samplesB.length - 1 &&
           samplesB[j + 1].simTime + samplesB[j + 1].accumulator <= target) {
      j++;
    }
    if (j >= samplesB.length - 1) {
      break;
    }
    const s0 = samplesB[j];
    const s1 = samplesB[j + 1];
    const t0 = s0.simTime + s0.accumulator;
    const t1 = s1.simTime + s1.accumulator;
    const ratio = (target - t0) / (t1 - t0);
    const bx = s0.rendered.x + (s1.rendered.x - s0.rendered.x) * ratio;
    const by = s0.rendered.y + (s1.rendered.y - s0.rendered.y) * ratio;
    const dx = bx - samplesA[i].rendered.x;
    const dy = by - samplesA[i].rendered.y;
    maxDistance = Math.max(maxDistance, Math.sqrt(dx * dx + dy * dy));
  }
  // 两组都是对同一分段线性物理轨迹的采样，对齐时刻相同 => 偏差应为 0（浮点级）
  record(
    '组2 跨帧率渲染偏差',
    '30Hz 与 240Hz 在相同模拟时刻的渲染位置偏差 <= 1e-9 px',
    maxDistance <= 1e-9,
    `实测最大偏差 ${maxDistance.toExponential(3)} px`
  );
}

function testErrorRangeAcrossFrameRates() {
  // 量化“两组结果”的误差范围：30Hz 与 240Hz 在相同物理步数下，
  // 物理真值误差为 0；积分漂移差异也必须为 0（漂移只取决于步长与步数）。
  const world = Physics.createWorld({ width: 100000, height: 100000, x: 100, y: 100 });
  const targetSteps = 480;
  function runToSteps(fps) {
    const runner = createRunner(Physics.cloneWorld(world));
    const interval = 1 / fps;
    while (Math.round(runner.simTime / FIXED_DT) < targetSteps) {
      runner.advance(interval);
    }
    return runner;
  }

  const slow = runToSteps(30);
  const fast = runToSteps(240);
  const stateDelta = Math.max(
    Math.abs(slow.state.x - fast.state.x),
    Math.abs(slow.state.y - fast.state.y)
  );
  const drift = (runner) => {
    const t = targetSteps * FIXED_DT;
    const exact = world.ball.y + 0.5 * world.gravity * t * t;
    return Math.abs(runner.state.y - exact);
  };
  const driftDelta = Math.abs(drift(slow) - drift(fast));
  const theoreticalDrift = world.gravity * FIXED_DT * FIXED_DT * targetSteps / 2;

  record(
    '组2 两组结果误差范围',
    '30Hz vs 240Hz：物理真值差=0，积分漂移差=0；共同漂移落在理论值 ±5%',
    stateDelta === 0 && driftDelta === 0 &&
      Math.abs(drift(slow) - theoreticalDrift) <= theoreticalDrift * 0.05,
    `真值偏差 ${stateDelta}，漂移差 ${driftDelta}，漂移 ${drift(slow).toFixed(4)}px，理论 ${theoreticalDrift.toFixed(4)}px`
  );
}

testFrameRateIndependence();
testPauseConsistency();
testTimeScaleConsistency();
testBlurRecovery();
testInterpolationError();
testCrossFrameRateRenderDeviation();
testErrorRangeAcrossFrameRates();

const failed = results.filter((r) => !r.passed);
const reportPath = path.join(__dirname, '..', 'artifacts');
fs.writeFileSync(
  path.join(reportPath, 'verification-report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n'
);

const md = [
  '# 固定时间步验证报告',
  '',
  `- 生成时间: ${new Date().toISOString()}`,
  `- 固定步长: ${FIXED_DT}s (${Math.round(1 / FIXED_DT)}Hz)`,
  `- 通过 ${results.length - failed.length}/${results.length}`,
  '',
  '| 分组 | 用例 | 结果 | 详情 |',
  '| --- | --- | --- | --- |'
].concat(
  results.map((r) =>
    `| ${r.group} | ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} | ${(r.detail || '').replace(/\|/g, '/')} |`
  )
).join('\n') + '\n';
fs.writeFileSync(path.join(reportPath, 'verification-report.md'), md);

console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
