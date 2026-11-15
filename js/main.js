/* UI 接线：按钮、状态面板、日志、主循环。 */
(function () {
  'use strict';
  const sim = new CampSim(Date.now() % 100000);
  let speed = 0;               // 0=暂停 1=1x 4=4x
  let acc = 0, lastTs = 0, logged = 0;

  const $ = id => document.getElementById(id);
  const logEl = $('log'), banner = $('banner');

  function btn(parent, label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { CampAudio.start(); fn(b); refresh(); });
    parent.appendChild(b);
    return b;
  }

  // 取暖舱 / 负载
  const loadBox = $('loadBtns');
  const heaterBtns = sim.pods.map((p, i) =>
    btn(loadBox, p.name + ' 取暖', b => { sim.setHeater(i, !sim.pods[i].heater); }));
  const pumpBtn = btn(loadBox, '水泵', () => sim.togglePump());

  // 发电机
  const genBox = $('genBtns');
  btn(genBox, '① 预热', () => sim.genPreheat());
  btn(genBox, '② 点火', () => sim.genCrank());
  btn(genBox, '③ 接载', () => sim.genConnectLoad());
  const shutBtn = btn(genBox, '关机', () => sim.genShutdown());
  shutBtn.classList.add('danger');

  // 巡查
  const crewBox = $('crewBtns');
  const patrolBtns = sim.crew.map((c, i) =>
    btn(crewBox, c.name + ' 巡查', () => sim.sendPatrol(i)));

  // 模拟控制
  const simBox = $('simBtns');
  const pauseBtn = btn(simBox, '⏸ 暂停', () => { speed = 0; });
  const playBtn = btn(simBox, '▶ 1x', () => { speed = 1; });
  const fastBtn = btn(simBox, '▶▶ 4x', () => { speed = 4; });
  btn(simBox, '↻ 重开', () => location.reload());

  function bar(pct, color) {
    return '<div class="bar"><div style="width:' + Math.max(0, Math.min(100, pct)) +
      '%;background:' + color + '"></div></div>';
  }

  function refresh() {
    // 状态面板
    const s = $('statusCard');
    let html = '<h2>营地状态</h2>';
    html += '<div class="row"><span>电池电量</span>' + bar(sim.battery.charge / 40 * 100, '#5fd68a') +
      '<span class="val">' + sim.battery.charge.toFixed(1) + 'kWh</span></div>';
    html += '<div class="row"><span>电池温度</span><span class="val">' + sim.battery.temp.toFixed(1) + '°C</span></div>';
    html += '<div class="row"><span>燃料</span>' + bar(sim.gen.fuelL / 80 * 100, '#ffb347') +
      '<span class="val">' + sim.gen.fuelL.toFixed(1) + 'L</span></div>';
    html += '<div class="row"><span>积雪覆盖</span><span class="val">' +
      (sim.snowCover * 100).toFixed(0) + '%</span></div>';
    for (const c of sim.crew) {
      const col = c.health > 60 ? '#5fd68a' : c.health > 30 ? '#ffcf5c' : '#ff6b6b';
      html += '<div class="row"><span>' + c.name + '（' + sim.pods[c.pod].name + '）</span>' +
        bar(c.health, col) + '<span class="val">' + c.health.toFixed(0) + '</span></div>';
    }
    s.innerHTML = html;
    // 按钮态
    heaterBtns.forEach((b, i) => b.classList.toggle('on', sim.pods[i].heater));
    pumpBtn.classList.toggle('on', sim.pump);
    patrolBtns.forEach((b, i) => { b.disabled = sim.crew[i].patrolLeft > 0; });
    pauseBtn.classList.toggle('on', speed === 0);
    playBtn.classList.toggle('on', speed === 1);
    fastBtn.classList.toggle('on', speed === 4);
    // 日志
    while (logged < sim.events.length) {
      const e = sim.events[logged++];
      const d = document.createElement('div');
      d.className = e.type === 'OVERLOAD' ? 'bad' : e.type;
      d.textContent = (e.type === 'OVERLOAD' ? '⚠ ' : '') + e.msg;
      logEl.appendChild(d);
    }
    logEl.scrollTop = logEl.scrollHeight;
    // 结算
    if (sim.over) {
      speed = 0;
      banner.className = sim.result;
      banner.textContent = sim.result === 'win'
        ? '★ 任务成功：48 小时全员安全，燃料未耗尽'
        : '✝ 任务失败 —— 点击「重开」再试一次';
    }
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    acc += (ts - lastTs) / 1000;
    lastTs = ts;
    const step = 0.5; // 1x 时每 0.5s 一个 tick
    while (acc >= step) {
      acc -= step;
      for (let i = 0; i < speed; i++) { if (!sim.over) sim.tick(); }
      if (speed) refresh();
    }
    CampRender.draw(sim);
    CampAudio.update(sim);
    requestAnimationFrame(loop);
  }

  refresh();
  requestAnimationFrame(loop);
})();
