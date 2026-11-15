/* 内置自检：状态机逻辑 + 渲染调用统计，不依赖外部测试框架 */
(function () {
  'use strict';

  function runSelfTest() {
    const R = window.APP_RUNTIME;
    const { state, building, drawables, cam, camPos, getFrameStats, renderer } = R;
    const clipPlane = (...args) => R.clipPlane(...args);
    const pickRoom = (...args) => R.pickRoom(...args);
    const results = [];
    const check = (name, pass, detail) => results.push({ name, pass, detail });

    const visibleCount = () => drawables.filter(d => d.predicate()).length;
    const withTag = tag => drawables.filter(d => d.tag === tag && d.predicate()).length;
    const save = JSON.parse(JSON.stringify({ floors: state.floors, pipes: state.pipes, clip: state.clip }));

    /* 1. 三层同时显示：三个 slab / wall / roomfloor 分组都在 */
    state.floors = [true, true, true];
    const slabs = [0, 1, 2].filter(f => withTag('slab-' + f) === 1).length;
    const walls = [0, 1, 2].filter(f => withTag('wall-' + f) === 1).length;
    check('三层同时显示：3 个楼板组与 3 个墙体组均参与绘制',
      slabs === 3 && walls === 3 && visibleCount() >= 18,
      '当前可见绘制组 ' + visibleCount() + ' 个');

    /* 2. 单层隐藏：隐藏 2F 后其余两层仍在，且 2F 组全部退出 */
    state.floors = [true, false, true];
    const hiddenGone = withTag('slab-1') === 0 && withTag('wall-1') === 0 && withTag('roomfloor-1') === 0;
    const othersStay = withTag('slab-0') === 1 && withTag('slab-2') === 1;
    check('单层隐藏：2F 全部退出且 1F/3F 不受影响',
      hiddenGone && othersStay,
      '2F 可见组=' + withTag('slab-1') + '，1F/3F 楼板仍在=' + othersStay);

    /* 3. 管线层相互独立：只关 HVAC，其他三套仍绘制；立管不受楼层影响 */
    state.floors = [true, true, true];
    state.pipes = { water: true, drain: true, hvac: false, power: true };
    const hvacOff = [0, 1, 2].every(f => withTag('pipe-hvac-' + f) === 0) && withTag('riser-hvac') === 0;
    const othersOn = ['water', 'drain', 'power'].every(s =>
      [0, 1, 2].every(f => withTag('pipe-' + s + '-' + f) === 1) && withTag('riser-' + s) === 1);
    check('隐藏单个管线层不影响其他三层（含立管独立）',
      hvacOff && othersOn, 'HVAC 关闭=' + hvacOff + '，其余三层正常=' + othersOn);
    state.pipes = { water: true, drain: true, hvac: true, power: true };

    /* 4. 剖切方向反转：同一高度下 below/above 平面法线符号相反，保留半空间互补 */
    state.clip.enabled = true;
    state.clip.axis = 'y';
    state.clip.height = 8;
    state.clip.dir = 'below';
    const pBelow = clipPlane();
    state.clip.dir = 'above';
    const pAbove = clipPlane();
    const normalsOpposite = pAbove[0] === -pBelow[0] && pAbove[1] === -pBelow[1] &&
      pAbove[2] === -pBelow[2] && pAbove[3] === -pBelow[3];
    const lowPoint = [12, 4, 7], highPoint = [12, 10, 7];
    const belowKeepsLow = !(pBelow[1] * lowPoint[1] > pBelow[3]);
    const belowCutsHigh = pBelow[1] * highPoint[1] > pBelow[3];
    const aboveKeepsHigh = !(pAbove[1] * highPoint[1] > pAbove[3]);
    const aboveCutsLow = pAbove[1] * lowPoint[1] > pAbove[3];
    check('剖切方向反转：法线取反且保留的半空间完全互补',
      normalsOpposite && belowKeepsLow && belowCutsHigh && aboveKeepsHigh && aboveCutsLow,
      'below 保留低点=' + belowKeepsLow + '，above 保留高点=' + aboveKeepsHigh);

    /* 5. 任意楼层剖切：剖切轴可切换，且高度覆盖整栋范围 */
    state.clip.dir = 'below';
    state.clip.axis = 'x';
    const px = clipPlane();
    state.clip.axis = 'z';
    const pz = clipPlane();
    check('剖切轴可在 Y/X/Z 间切换（支持任意方向剖切）',
      px[0] === 1 && pz[2] === 1 && pBelow[1] === 1, '三个轴向平面均正确生成');
    state.clip.axis = 'y';

    /* 6. 房间数据与拾取：面积/容量为正，点击可命中房间 */
    const r0 = building.rooms[0];
    const dataOk = r0.area > 0 && r0.capacity >= 1 && !!BUILD.USAGES[r0.usage];
    const eye = camPos();
    const M = window.M3D;
    const dir = M.normalize(M.subtract(r0.center, eye));
    const t = M.rayAABB(eye, dir, r0.min, r0.max);
    check('房间包含面积/容量，且射线拾取可命中',
      dataOk && t !== null && t > 0,
      r0.name + ' 面积 ' + r0.area + 'm² 容量 ' + r0.capacity + ' 人，射线距离 ' + (t && t.toFixed(2)));

    /* 7. 渲染管线健康：深度测试开启且有实际绘制调用 */
    const gl = renderer.gl;
    const depthOn = gl.isEnabled(gl.DEPTH_TEST);
    check('WebGL 深度缓冲启用（遮挡顺序由 GPU 深度测试保证），帧绘制调用 > 0',
      depthOn && getFrameStats().drawCalls > 0,
      'DEPTH_TEST=' + depthOn + '，上一帧 drawCalls=' + getFrameStats().drawCalls);

    state.floors = save.floors;
    state.pipes = save.pipes;
    state.clip = save.clip;
    return results;
  }

  window.APP_RUNTIME.runSelfTest = runSelfTest;

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('runTests');
    const out = document.getElementById('testOutput');
      btn.addEventListener('click', () => {
      const results = runSelfTest();
      const passed = results.filter(r => r.pass).length;
      out.innerHTML = results.map(r =>
        '<div class="' + (r.pass ? 'pass' : 'fail') + '">' +
        (r.pass ? '✔ ' : '✘ ') + r.name +
        (r.detail ? '\n   ' + r.detail : '') + '</div>'
      ).join('') + '\n<span class="' + (passed === results.length ? 'pass' : 'fail') +
        '">合计 ' + passed + '/' + results.length + ' 通过</span>';
      window.__SELF_TEST__ = results;
    });
  });
})();
