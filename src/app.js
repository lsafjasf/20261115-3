/* 主应用：相机、显隐状态、剖切、拾取、标注、视角保存、导出、自检 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const canvas = $('glcanvas');
  const overlay = $('overlay');
  const octx = overlay.getContext('2d');

  const building = BUILD.buildBuilding();
  const pipeData = BUILD.buildPipes();
  const renderer = new GL.Renderer(canvas);

  /* ---- 显隐状态 ---- */
  const state = {
    floors: [true, true, true],
    pipes: { water: true, drain: true, hvac: true, power: true },
    clip: { enabled: true, height: 8, dir: 'below', axis: 'y' },
    labels: true,
    selectedRoomId: null,
    views: []
  };

  /* ---- 网格分组：楼板/墙按层，房间地面按层，管线按“系统×层 + 立管” ---- */
  const drawables = [];
  function addDrawable(meshData, predicate, tag) {
    const id = renderer.upload(meshData, tag);
    drawables.push({ id, predicate, tag, selected: false });
    return id;
  }

  const slabColor = [0.78, 0.76, 0.72];
  const wallColor = [0.88, 0.88, 0.85];
  for (let f = 0; f < building.floors; f++) {
    addDrawable(GL.mergeBoxes(building.slabs.filter(s => s.floor === f)
      .map(s => ({ min: s.min, max: s.max, color: slabColor }))),
      () => state.floors[f], 'slab-' + f);
    addDrawable(GL.mergeBoxes(building.walls.filter(w => w.floor === f)
      .map(w => ({ min: w.min, max: w.max, color: wallColor }))),
      () => state.floors[f], 'wall-' + f);
    const floorRooms = building.rooms.filter(r => r.floor === f && r.usage !== 'corridor');
    addDrawable(GL.mergeBoxes(floorRooms.map(r => {
      const top = r.min[1] + 0.04;
      return {
        min: [r.min[0] + 0.05, r.min[1], r.min[2] + 0.05],
        max: [r.max[0] - 0.05, top, r.max[2] - 0.05],
        color: BUILD.USAGES[r.usage].color
      };
    })), () => state.floors[f], 'roomfloor-' + f);
  }
  const sysColor = {};
  pipeData.systems.forEach(s => { sysColor[s.id] = s.color; });
  pipeData.systems.forEach(sys => {
    for (let f = 0; f < building.floors; f++) {
      const segs = pipeData.segments.filter(sg => sg.system === sys.id && sg.floor === f);
      const mesh = BUILD.tubeMesh(segs, sysColor, 12);
      addDrawable(mesh, () => state.pipes[sys.id] && state.floors[f], 'pipe-' + sys.id + '-' + f);
    }
    const riser = pipeData.segments.filter(sg => sg.system === sys.id && sg.floor === -1);
    addDrawable(BUILD.tubeMesh(riser, sysColor, 12),
      () => state.pipes[sys.id], 'riser-' + sys.id);
  });

  /* ---- 剖切平面指示（半透明），按轴选择、平移到剖切高度 ---- */
  const gridColor = [0.35, 0.85, 1.0];
  const lineColor = [0.75, 0.95, 1.0];
  const t = 0.06, Wd = building.width, Dd = building.depth, Hd = building.totalHeight;
  const g = 0.05;
  function gridBoxes(axis) {
    const boxes = [];
    if (axis === 'y') {
      boxes.push({ min: [0, -t / 2, 0], max: [Wd, t / 2, Dd], color: gridColor });
      for (let x = 0; x <= Wd; x += 2) boxes.push({ min: [x - g / 2, -t, 0], max: [x + g / 2, t, Dd], color: lineColor });
      for (let z = 0; z <= Dd; z += 2) boxes.push({ min: [0, -t, z - g / 2], max: [Wd, t, z + g / 2], color: lineColor });
    } else if (axis === 'x') {
      boxes.push({ min: [-t / 2, 0, 0], max: [t / 2, Hd, Dd], color: gridColor });
      for (let y = 0; y <= Hd; y += 2) boxes.push({ min: [-t, y - g / 2, 0], max: [t, y + g / 2, Dd], color: lineColor });
      for (let z = 0; z <= Dd; z += 2) boxes.push({ min: [-t, 0, z - g / 2], max: [t, Hd, z + g / 2], color: lineColor });
    } else {
      boxes.push({ min: [0, 0, -t / 2], max: [Wd, Hd, t / 2], color: gridColor });
      for (let x = 0; x <= Wd; x += 2) boxes.push({ min: [x - g / 2, 0, -t], max: [x + g / 2, Hd, t], color: lineColor });
      for (let y = 0; y <= Hd; y += 2) boxes.push({ min: [0, y - g / 2, -t], max: [Wd, y + g / 2, t], color: lineColor });
    }
    return boxes;
  }
  const clipPlaneIds = {
    y: renderer.upload(GL.mergeBoxes(gridBoxes('y')), 'clip-y'),
    x: renderer.upload(GL.mergeBoxes(gridBoxes('x')), 'clip-x'),
    z: renderer.upload(GL.mergeBoxes(gridBoxes('z')), 'clip-z')
  };

  /* ---- 相机（轨道） ---- */
  const cam = { yaw: 0.72, pitch: 0.42, dist: 38, target: [12, 5.5, 7] };
  function camPos() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [
      cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * sp,
      cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)
    ];
  }

  window.APP_STATE = state;
  window.APP_BUILDING = building;

  /* 其余模块在后续脚本块中挂到 window.APP_RUNTIME */
  window.APP_RUNTIME = { building, pipeData, state, cam, camPos, drawables, canvas, overlay, renderer, clipPlaneIds };
})();
(function () {
  'use strict';
  const R = window.APP_RUNTIME;
  const { building, state, cam, camPos, drawables, canvas, overlay, renderer } = R;
  const octx = overlay.getContext('2d');
  let viewMat, projMat, invViewProj;
  let frameStats = { drawCalls: 0, clippedFragmentsHint: 0 };

  function clipPlane() {
    const ax = state.clip.axis;
    const sign = state.clip.dir === 'below' ? 1 : -1;
    const normal = [0, 0, 0];
    normal[ax === 'x' ? 0 : ax === 'z' ? 2 : 1] = sign;
    return [normal[0], normal[1], normal[2], sign * state.clip.height];
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    overlay.width = canvas.width;
    overlay.height = canvas.height;
  }

  function render() {
    resize();
    const gl = renderer.gl;
    const eye = camPos();
    projMat = M3D.mat4Perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    viewMat = M3D.mat4LookAt(eye, cam.target, [0, 1, 0]);
    invViewProj = M3D.mat4Invert(M3D.mat4Multiply(projMat, viewMat));
    renderer.beginFrame(viewMat, projMat, eye, {
      enabled: state.clip.enabled, plane: clipPlane()
    });
    frameStats.drawCalls = 0;
    drawables.forEach(d => {
      if (!d.predicate()) return;
      renderer.draw(d.id, false);
      frameStats.drawCalls++;
    });
    if (state.clip.enabled) {
      const axis = state.clip.axis;
      const h = state.clip.height;
      const offset = { x: [h, 0, 0], y: [0, h, 0], z: [0, 0, h] }[axis];
      const tint = state.clip.dir === 'below' ? [0.35, 0.85, 1.0] : [1.0, 0.65, 0.35];
      renderer.setTint(tint);
      renderer.drawTransparent(R.clipPlaneIds[axis], 0.28,
        M3D.mat4Translate(offset[0], offset[1], offset[2]));
      frameStats.drawCalls++;
    }
    drawOverlay(eye);
    requestAnimationFrame(render);
  }

  function drawOverlay(eye) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.labels) return;
    const w = overlay.width, h = overlay.height;
    octx.font = `${Math.round(13 * (w / overlay.clientWidth || 1))}px sans-serif`;
    octx.textAlign = 'center';
    building.rooms.forEach(room => {
      if (!state.floors[room.floor]) return;
      if (state.clip.enabled && isClipped(room.center)) return;
      const screen = project(room.center);
      if (!screen || screen[2] < -1 || screen[2] > 1) return;
      const sx = (screen[0] * 0.5 + 0.5) * w;
      const sy = (-screen[1] * 0.5 + 0.5) * h;
      const col = BUILD.USAGES[room.usage].color;
      const rgb = `rgb(${col.map(v => Math.round(v * 255)).join(',')})`;
      octx.fillStyle = 'rgba(8,14,26,0.78)';
      const label = room.name.replace(/^\dF-/, '');
      const tw = octx.measureText(label).width;
      octx.beginPath();
      octx.roundRect(sx - tw / 2 - 7, sy - 20, tw + 14, 18, 5);
      octx.fill();
      octx.fillStyle = rgb;
      octx.fillRect(sx - tw / 2 - 3, sy - 16, 4, 10);
      octx.fillStyle = '#e6ecf5';
      octx.fillText(label, sx, sy - 6);
    });
  }

  function isClipped(p) {
    if (!state.clip.enabled) return false;
    const pl = clipPlane();
    return pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] > pl[3];
  }

  function project(p) {
    const m = M3D.mat4Multiply(projMat, viewMat);
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0) return null;
    const q = M3D.transformPoint(m, p[0], p[1], p[2]);
    return [q[0], q[1], q[2]];
  }

  function pickRoom(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const eye = camPos();
    const projNow = M3D.mat4Perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 200);
    const viewNow = M3D.mat4LookAt(eye, cam.target, [0, 1, 0]);
    const inv = M3D.mat4Invert(M3D.mat4Multiply(projNow, viewNow));
    const near = M3D.transformPoint(inv, ndcX, ndcY, -1);
    const far = M3D.transformPoint(inv, ndcX, ndcY, 1);
    const dir = M3D.normalize(M3D.subtract(far, near));
    let best = null, bestT = Infinity;
    building.rooms.forEach(room => {
      if (!state.floors[room.floor]) return;
      if (state.clip.enabled && isClipped(room.center)) return;
      const t = M3D.rayAABB(eye, dir, room.min, room.max);
      if (t !== null && t < bestT) { bestT = t; best = room; }
    });
    return best;
  }

  Object.assign(R, {
    renderer, render, resize, clipPlane, isClipped, project, pickRoom,
    getFrameStats: () => frameStats
  });
})();
(function () {
  'use strict';
  const R = window.APP_RUNTIME;
  const { building, state, cam, canvas, pickRoom } = R;
  const $ = id => document.getElementById(id);
  const tooltip = $('tooltip');

  /* ---- 轨道相机交互 ---- */
  let drag = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) {
      const room = pickRoom(e.clientX, e.clientY);
      canvas.style.cursor = room ? 'pointer' : 'default';
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.button === 2 || drag.shift) {
      const s = cam.dist * 0.0016;
      const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
      cam.target[0] -= dx * s * right[0];
      cam.target[2] -= dx * s * right[2];
      cam.target[1] += dy * s;
    } else {
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * 0.006));
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && !drag.moved && drag.button === 0) showRoomInfo(pickRoom(e.clientX, e.clientY), e.clientX, e.clientY);
    drag = null;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.max(8, Math.min(90, cam.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  function showRoomInfo(room, x, y) {
    if (!room) { tooltip.classList.add('hidden'); state.selectedRoomId = null; return; }
    state.selectedRoomId = room.id;
    const u = BUILD.USAGES[room.usage];
    tooltip.innerHTML =
      '<h3>' + room.name + '</h3>' +
      line('楼层', (room.floor + 1) + 'F') +
      line('用途', u.label) +
      line('面积', room.area.toFixed(1) + ' m²') +
      line('额定容量', room.capacity + ' 人') +
      line('坐标', 'X' + room.center[0].toFixed(1) + ' / Z' + room.center[2].toFixed(1));
    tooltip.classList.remove('hidden');
    const px = Math.min(x + 16, window.innerWidth - 230);
    const py = Math.min(y + 16, window.innerHeight - 170);
    tooltip.style.left = px + 'px';
    tooltip.style.top = py + 'px';
  }
  function line(k, v) {
    return '<div class="line"><span class="k">' + k + '</span><span>' + v + '</span></div>';
  }

  /* ---- 楼层开关 ---- */
  const floorBox = $('floorToggles');
  for (let f = 0; f < building.floors; f++) {
    const el = makeToggle('floor-' + f, (f + 1) + 'F 楼层', [0.55, 0.7, 0.95]);
    el.querySelector('input').addEventListener('change', e => {
      state.floors[f] = e.target.checked;
      el.classList.toggle('off', !e.target.checked);
    });
    floorBox.appendChild(el);
  }

  /* ---- 管线系统开关（相互独立） ---- */
  const pipeBox = $('pipeToggles');
  R.pipeData.systems.forEach(sys => {
    const el = makeToggle('pipe-' + sys.id, sys.label, sys.color);
    el.querySelector('input').addEventListener('change', e => {
      state.pipes[sys.id] = e.target.checked;
      el.classList.toggle('off', !e.target.checked);
    });
    pipeBox.appendChild(el);
  });

  /* ---- 用途图例 ---- */
  const legend = $('usageLegend');
  Object.values(BUILD.USAGES).forEach(u => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = '<span class="dot" style="background:rgb(' +
      u.color.map(v => Math.round(v * 255)).join(',') + ')"></span>' + u.label;
    legend.appendChild(item);
  });
  $('labelToggle').addEventListener('change', e => { state.labels = e.target.checked; });

  /* ---- 剖切控制 ---- */
  const clipH = $('clipHeight'), clipHVal = $('clipHeightVal');
  clipHVal.textContent = state.clip.height.toFixed(1) + ' m';
  clipH.addEventListener('input', () => {
    state.clip.height = parseFloat(clipH.value);
    clipHVal.textContent = state.clip.height.toFixed(1) + ' m';
  });
  $('clipEnable').addEventListener('change', e => { state.clip.enabled = e.target.checked; });
  $('clipDir').addEventListener('change', e => { state.clip.dir = e.target.value; });
  $('clipAxis').addEventListener('change', e => { state.clip.axis = e.target.value; });

  function syncUI() {
    clipH.value = state.clip.height;
    clipHVal.textContent = state.clip.height.toFixed(1) + ' m';
    $('clipEnable').checked = state.clip.enabled;
    $('clipDir').value = state.clip.dir;
    $('clipAxis').value = state.clip.axis;
    for (let f = 0; f < building.floors; f++) {
      $('floor-' + f).checked = state.floors[f];
      $('floor-' + f).closest('.toggle').classList.toggle('off', !state.floors[f]);
    }
    R.pipeData.systems.forEach(sys => {
      const input = $('pipe-' + sys.id);
      input.checked = state.pipes[sys.id];
      input.closest('.toggle').classList.toggle('off', !state.pipes[sys.id]);
    });
  }
  R.syncUI = syncUI;

  /* ---- 视角保存/加载/导出 ---- */
  $('saveView').addEventListener('click', () => {
    const name = '视角 ' + (state.views.length + 1);
    state.views.push({ name, cam: JSON.parse(JSON.stringify(cam)) });
    renderViewList();
  });
  $('resetView').addEventListener('click', () => {
    cam.yaw = 0.72; cam.pitch = 0.42; cam.dist = 38; cam.target = [12, 5.5, 7];
  });
  function renderViewList() {
    const ul = $('viewList');
    ul.innerHTML = '';
    state.views.forEach((v, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'name'; span.textContent = v.name;
      const go = document.createElement('button');
      go.textContent = '载入';
      go.addEventListener('click', () => Object.assign(cam, JSON.parse(JSON.stringify(v.cam))));
      const del = document.createElement('button');
      del.className = 'secondary'; del.textContent = '删除';
      del.addEventListener('click', () => { state.views.splice(i, 1); renderViewList(); });
      li.append(span, go, del);
      ul.appendChild(li);
    });
  }
  $('exportPng').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'building-section-' + Date.now() + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  function makeToggle(id, label, color) {
    const el = document.createElement('label');
    el.className = 'toggle';
    el.innerHTML = '<input type="checkbox" id="' + id + '" checked /><span class="dot" style="background:rgb(' +
      color.map(v => Math.round(v * 255)).join(',') + ')"></span><span>' + label + '</span>';
    return el;
  }

  R.render();
})();
