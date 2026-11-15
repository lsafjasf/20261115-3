/* 主控：UI 绑定、仿真循环、摘要导出 */
(function () {
  'use strict';
  const { MicrogridSim, C } = window.MicrogridSim;
  const sim = new MicrogridSim();
  const renderer = new window.MicrogridRenderer(
    document.getElementById('scene'),
    document.getElementById('chart')
  );
  const audio = new window.WindAudio();

  const $ = id => document.getElementById(id);
  let running = false;
  let speed = 4;          // 仿真分钟 / 真实秒
  let acc = 0;
  let lastTs = 0;
  let lastEventLen = 0;

  const els = {
    clock: $('clock'), metrics: $('metrics'), eventList: $('eventList'),
    pitch: $('pitch'), pitchVal: $('pitchVal'),
    battMw: $('battMw'), battMwVal: $('battMwVal'),
    startBtn: $('startBtn'), pauseBtn: $('pauseBtn'), resetBtn: $('resetBtn'),
    audioBtn: $('audioBtn'), jsonBtn: $('jsonBtn'), csvBtn: $('csvBtn'),
    modal: $('modal'), modalTitle: $('modalTitle'), modalBody: $('modalBody'),
    modalJson: $('modalJson'), modalCsv: $('modalCsv'), modalClose: $('modalClose')
  };

  function syncControls() {
    sim.controls.pitch = Number(els.pitch.value);
    sim.controls.batteryMw = Number(els.battMw.value);
    els.pitchVal.textContent = sim.controls.pitch + '°';
    els.battMwVal.textContent = sim.controls.batteryMw.toFixed(1) + ' MW';
  }

  function bindSeg(id, attr, cb) {
    $(id).addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      [...$(id).children].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cb(btn.getAttribute(attr));
    });
  }

  bindSeg('battMode', 'data-mode', m => { sim.controls.batteryMode = m; });
  bindSeg('speedSeg', 'data-x', x => { speed = Number(x); });
  bindSeg('shedSeg', 'data-n', n => { sim.controls.shedCount = Number(n); });
  function setActive(id, attr, val) {
    [...$(id).children].forEach(b =>
      b.classList.toggle('active', b.getAttribute(attr) === String(val)));
  }
  $('shedOrder').addEventListener('change', e => {
    sim.controls.shedOrder = e.target.value.split(',').map(Number);
  });
  els.pitch.addEventListener('input', syncControls);
  els.battMw.addEventListener('input', syncControls);

  function fmtClock(min) {
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    return hh + ':' + mm;
  }

  function cls(v, warn, crit) {
    return v >= crit ? 'hot' : v >= warn ? 'warn' : 'ok';
  }

  function renderMetrics(snap) {
    const s = snap || { v: 0, windMw: 0, demand: 0, soc: sim.soc, temp: sim.temp,
      batt: 0, derate: 1, blackoutMw: 0, shedCount: 0 };
    const tempCls = cls(s.temp, C.T_DERATE, C.T_CRIT);
    const socCls = cls(1 - s.soc, 0.6, 0.85);
    const items = [
      ['风速', s.v.toFixed(1) + ' m/s', s.v >= C.CUT_OUT ? 'hot' : 'ok'],
      ['风电出力', s.windMw.toFixed(2) + ' MW', 'ok'],
      ['当前负荷', s.demand.toFixed(2) + ' MW', 'ok'],
      ['电池功率', (s.batt > 0 ? '放 ' : s.batt < 0 ? '充 ' : '— ') +
        Math.abs(s.batt).toFixed(2) + ' MW', 'ok'],
      ['SOC', (s.soc * 100).toFixed(1) + '%', socCls],
      ['电池温度', s.temp.toFixed(1) + ' °C', tempCls],
      ['热降额', (s.derate * 100).toFixed(0) + '%', s.derate < 1 ? 'warn' : 'ok'],
      ['累计断电', sim.blackoutMinutes + ' min', sim.blackoutMinutes ? 'hot' : 'ok'],
      ['切线/切换', s.shedCount + ' 线 · ' + sim.switches + ' 次', sim.switches > 40 ? 'warn' : 'ok'],
      ['寿命损耗', sim.wearPct.toFixed(3) + '%', 'ok']
    ];
    els.metrics.innerHTML = items.map(([k, v, c]) =>
      '<div class="metric"><div class="k">' + k + '</div><div class="v ' + c + '">' + v + '</div></div>'
    ).join('');
  }

  function renderEvents() {
    if (sim.events.length === lastEventLen) return;
    lastEventLen = sim.events.length;
    els.eventList.innerHTML = sim.events.slice(-40).reverse().map(ev =>
      '<li class="' + ev.level + '">[' + fmtClock(ev.t) + '] ' + ev.label + '</li>'
    ).join('');
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) {
      acc += dt * speed;
      while (acc >= 1 && (sim.status === 'running' || sim.status === 'ready')) {
        syncControls();
        sim.step();
        acc -= 1;
      }
      const snap = sim.history[sim.history.length - 1];
      if (snap) audio.update(snap);
      if (sim.status === 'done' || sim.status === 'failed') finish();
    }
    const snap = sim.history[sim.history.length - 1] || {
      v: sim.baseWind() + sim.gustDelta(), windMw: 0, demand: C.HOSPITAL_MW +
      C.LINE_MW.reduce((a, b) => a + b, 0), soc: sim.soc, temp: sim.temp,
      batt: 0, derate: 1, blackoutMw: 0, shedCount: 0, trip: 0, pitch: sim.controls.pitch
    };
    renderer.drawScene(snap, sim.controls);
    renderer.drawChart(sim.history);
    renderMetrics(snap);
    renderEvents();
    els.clock.textContent = fmtClock(sim.t);
    requestAnimationFrame(frame);
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '-' +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0');
  }

  function exportPayload() {
    const summary = sim.summary();
    summary.exportedAt = new Date().toISOString();
    summary.horizonHours = C.HORIZON_MIN / 60;
    summary.config = {
      turbines: C.TURBINES, ratedMwEach: C.RATED_MW,
      batteryMWh: C.BATT_CAP_MWH, batteryMaxMw: C.BATT_MAX_MW,
      hospitalMw: C.HOSPITAL_MW, interruptibleLinesMw: C.LINE_MW,
      tempSafeLimitC: C.T_CRIT
    };
    return summary;
  }

  function finish() {
    running = false;
    els.startBtn.disabled = true;
    els.jsonBtn.disabled = false;
    els.csvBtn.disabled = false;
    const ok = sim.success();
    audio.fanfare(ok);
    const s = sim.summary();
    els.modalTitle.textContent = ok ? '✅ 调度成功：12 小时零断电且温度安全' : '❌ 调度失败';
    els.modalBody.textContent = JSON.stringify(s, null, 2);
    els.modal.classList.remove('hidden');
  }

  els.startBtn.addEventListener('click', () => {
    if (sim.status === 'done' || sim.status === 'failed') return;
    running = true;
    lastTs = 0;
  });
  els.pauseBtn.addEventListener('click', () => { running = false; });
  els.resetBtn.addEventListener('click', () => {
    running = false;
    sim.reset();
    sim.controls.pitch = 0;
    sim.controls.batteryMode = 'auto';
    sim.controls.batteryMw = 2;
    sim.controls.shedCount = 0;
    sim.controls.shedOrder = [2, 1, 0];
    els.pitch.value = 0;
    els.battMw.value = 2;
    $('shedOrder').value = '2,1,0';
    setActive('battMode', 'data-mode', 'auto');
    setActive('shedSeg', 'data-n', 0);
    setActive('speedSeg', 'data-x', speed);
    lastEventLen = 0;
    els.startBtn.disabled = false;
    els.jsonBtn.disabled = true;
    els.csvBtn.disabled = true;
    els.modal.classList.add('hidden');
    els.eventList.innerHTML = '';
  });
  els.audioBtn.addEventListener('click', e => {
    audio.resume();
    audio.setEnabled(true);
    e.target.textContent = '🔊 音效已开';
  });
  els.jsonBtn.addEventListener('click', () =>
    download('wind-battery-summary-' + stamp() + '.json',
      JSON.stringify(exportPayload(), null, 2), 'application/json'));
  els.csvBtn.addEventListener('click', () =>
    download('wind-battery-timeseries-' + stamp() + '.csv', sim.toCsv(), 'text/csv'));
  els.modalJson.addEventListener('click', () =>
    download('wind-battery-summary-' + stamp() + '.json',
      JSON.stringify(exportPayload(), null, 2), 'application/json'));
  els.modalCsv.addEventListener('click', () =>
    download('wind-battery-timeseries-' + stamp() + '.csv', sim.toCsv(), 'text/csv'));
  els.modalClose.addEventListener('click', () => els.modal.classList.add('hidden'));

  syncControls();
  renderMetrics();
  requestAnimationFrame(frame);
})();
