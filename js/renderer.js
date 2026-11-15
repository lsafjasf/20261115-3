/* Canvas 场景与曲线渲染 */
(function (root) {
  'use strict';

  const C = root.MicrogridSim.C;

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas._w !== rect.width) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas._w = rect.width;
      canvas._h = rect.height;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { w: canvas._w, h: canvas._h, ctx: canvas.getContext('2d') };
  }

  class Renderer {
    constructor(sceneCanvas, chartCanvas) {
      this.scene = sceneCanvas;
      this.chart = chartCanvas;
      this.phase = 0;
      this.particles = [];
    }

    drawTurbine(ctx, x, baseY, scale, rotor, pitch, tripped) {
      ctx.save();
      ctx.translate(x, baseY);
      ctx.strokeStyle = tripped ? '#7a3b3b' : '#9db8d6';
      ctx.fillStyle = tripped ? '#7a3b3b' : '#9db8d6';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -95 * scale);
      ctx.stroke();
      ctx.fillRect(-14 * scale, -4 * scale, 28 * scale, 6 * scale);
      const hubY = -95 * scale;
      ctx.beginPath();
      ctx.arc(0, hubY, 5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = tripped ? '#ff8a8a' : '#5fd3ff';
      ctx.fill();
      ctx.translate(0, hubY);
      ctx.rotate(rotor);
      for (let b = 0; b < 3; b++) {
        ctx.save();
        ctx.rotate((b * 2 * Math.PI) / 3);
        ctx.rotate((pitch * Math.PI) / 180 * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-3.2 * scale, -8 * scale);
        ctx.lineTo(0, -46 * scale);
        ctx.lineTo(3.2 * scale, -8 * scale);
        ctx.closePath();
        ctx.fillStyle = tripped ? 'rgba(255,138,138,.55)' : 'rgba(220,235,255,.85)';
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    drawBuilding(ctx, x, baseY, w, h, color, label, sub, dark) {
      ctx.fillStyle = dark ? '#3a2020' : color;
      ctx.fillRect(x - w / 2, baseY - h, w, h);
      ctx.strokeStyle = '#24406b';
      ctx.strokeRect(x - w / 2, baseY - h, w, h);
      ctx.fillStyle = dark ? '#ff8a8a' : '#9fe7ff';
      for (let wy = baseY - h + 10; wy < baseY - 8; wy += 16) {
        for (let wx = x - w / 2 + 8; wx < x + w / 2 - 6; wx += 14) {
          ctx.fillRect(wx, wy, 6, 8);
        }
      }
      ctx.fillStyle = '#dbe6f5';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, baseY + 16);
      ctx.fillStyle = '#8aa3c4';
      ctx.font = '11px sans-serif';
      ctx.fillText(sub, x, baseY + 31);
    }

    drawBattery(ctx, x, baseY, soc, temp, derate) {
      const w = 92, h = 56;
      ctx.fillStyle = '#13243d';
      ctx.strokeStyle = '#2a4773';
      ctx.lineWidth = 2;
      ctx.fillRect(x - w / 2, baseY - h, w, h);
      ctx.strokeRect(x - w / 2, baseY - h, w, h);
      ctx.fillStyle = '#5fd3ff';
      ctx.fillRect(x + w / 2 - 4, baseY - h + 16, 6, h - 32);
      const fillW = (w - 16) * soc;
      const hot = temp > C.T_DERATE;
      ctx.fillStyle = hot ? '#ffb347' : '#37c98e';
      ctx.fillRect(x - w / 2 + 8, baseY - h + 10, fillW, 14);
      ctx.fillStyle = '#dbe6f5';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SOC ' + (soc * 100).toFixed(0) + '%', x, baseY - 12);
      const tColor = temp > C.T_CRIT ? '#ff8a8a' : hot ? '#ffd479' : '#7fe3b0';
      ctx.fillStyle = tColor;
      ctx.fillText(temp.toFixed(1) + '°C' + (derate < 1 ? ' · 降功率 ' + (derate * 100).toFixed(0) + '%' : ''), x, baseY + 2);
      ctx.fillStyle = '#8aa3c4';
      ctx.fillText('岸上储能 6MWh', x, baseY + 16);
    }

    spawnParticles(snap) {
      const flow = snap.servedMw;
      if (Math.random() < Math.min(0.5, flow / 12)) {
        this.particles.push({
          p: 0,
          speed: 0.006 + flow * 0.002,
          color: snap.blackoutMw > 0.001 ? '#ff8a8a' : '#5fd3ff',
          charge: snap.batt < -0.02
        });
      }
    }

    drawFlows(ctx, w, h) {
      const y = h - 118;
      const p1 = { x: w * 0.30, y }, p2 = { x: w * 0.52, y: y + 8 }, p3 = { x: w * 0.74, y };
      ctx.strokeStyle = '#24406b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();
      for (const pt of this.particles) {
        pt.p += pt.speed;
        if (pt.p > 1) { pt.dead = true; continue; }
        const x = p1.x + (p3.x - p1.x) * pt.p;
        const yy = p1.y + (p3.y - p1.y) * pt.p + Math.sin(pt.p * Math.PI * 2) * 4;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(x, yy, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      this.particles = this.particles.filter(p => !p.dead);
      ctx.fillStyle = '#8aa3c4';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('海上平台 → 岸基母线 → 医院 / 工厂', (p1.x + p3.x) / 2, y - 10);
    }

    drawScene(snap, controls) {
      const { w, h, ctx } = fit(this.scene);
      ctx.clearRect(0, 0, w, h);
      const horizon = h * 0.52;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#0d1b31');
      sky.addColorStop(1, '#173357');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizon);
      ctx.fillStyle = '#0a2036';
      ctx.fillRect(0, horizon, w, h - horizon);
      ctx.strokeStyle = 'rgba(95,211,255,.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const yy = horizon + 8 + i * 14;
        ctx.beginPath();
        ctx.moveTo(0, yy + Math.sin(this.phase * 2 + i) * 2);
        ctx.lineTo(w, yy + Math.cos(this.phase * 2 + i) * 2);
        ctx.stroke();
      }
      this.phase += 0.03;

      // 风速仪表
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8aa3c4';
      ctx.font = '12px sans-serif';
      ctx.fillText('风速 ' + snap.v.toFixed(1) + ' m/s' + (snap.v >= C.CUT_OUT ? '  ⚠ 超切出' : ''), 14, 22);
      ctx.fillText('桨距 ' + snap.pitch + '°', 14, 40);
      ctx.fillStyle = snap.blackoutMw > 0.001 ? '#ff8a8a' : '#7fe3b0';
      ctx.fillText(snap.blackoutMw > 0.001 ? '状态：断电中！' : '状态：供电正常', 14, 58);

      const baseY = horizon + 60;
      const tripped = snap.trip > 0;
      const spin = tripped ? 0 : this.phase * (0.6 + snap.v / 14);
      this.drawTurbine(ctx, w * 0.12, baseY, 0.95, spin, controls.pitch, tripped);
      this.drawTurbine(ctx, w * 0.22, baseY - 8, 1.1, spin, controls.pitch, tripped);
      this.drawTurbine(ctx, w * 0.32, baseY + 4, 0.9, spin, controls.pitch, tripped);
      ctx.fillStyle = '#9db8d6';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tripped ? '风机脱网 ' + snap.trip + ' min' : '风电 ' + snap.windMw.toFixed(1) + ' MW', w * 0.22, baseY + 46);

      this.drawBattery(ctx, w * 0.52, baseY + 18, snap.soc, snap.temp, snap.derate);
      this.drawBuilding(ctx, w * 0.74, baseY + 12, 64, 78, '#1d3a5f', '医院',
        C.HOSPITAL_MW + ' MW 不可中断', snap.blackoutMw > 0.001);
      const factoryDark = snap.shedCount >= 3;
      this.drawBuilding(ctx, w * 0.90, baseY + 12, 60, 58, '#243b55', '工厂',
        '切 ' + snap.shedCount + '/3 条线', factoryDark);

      if (snap.batt > 0.02 || snap.batt < -0.02) {
        ctx.fillStyle = snap.batt > 0 ? '#7fe3b0' : '#ffd479';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((snap.batt > 0 ? '放电 ' : '充电 ') + Math.abs(snap.batt).toFixed(1) + ' MW',
          w * 0.52, baseY - 52);
      }
      this.spawnParticles(snap);
      this.drawFlows(ctx, w, h);
    }
  }

  root.MicrogridRenderer = Renderer;

  Renderer.prototype.drawChart = function (history) {
    const { w, h, ctx } = fit(this.chart);
    ctx.clearRect(0, 0, w, h);
    const padL = 42, padR = 42, padT = 14, padB = 22;
    const pw = w - padL - padR, ph = h - padT - padB;
    ctx.strokeStyle = '#1e3354';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const yy = padT + (ph * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
    }
    if (history.length < 2) {
      ctx.fillStyle = '#6f87a8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('开始后显示 720 分钟时序曲线', w / 2, h / 2);
      return;
    }
    const N = C.HORIZON_MIN;
    const xOf = t => padL + (t / N) * pw;
    const series = [
      { key: 'v', max: 26, color: '#5fd3ff', label: '风速 m/s' },
      { key: 'windMw', max: 7, color: '#7fe3b0', label: '风电 MW' },
      { key: 'demand', max: 7, color: '#ffd479', label: '负荷 MW' },
      { key: 'temp', max: 80, color: '#ff8a8a', label: '温度 °C' }
    ];
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      history.forEach((d, i) => {
        const x = xOf(d.t);
        const y = padT + ph - (d[s.key] / s.max) * ph;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    // SOC 单独一条（百分比轴）
    ctx.strokeStyle = '#c08cff';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    history.forEach((d, i) => {
      const x = xOf(d.t);
      const y = padT + ph - d.soc * ph;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // 温度红线
    const yCrit = padT + ph - (C.T_CRIT / 80) * ph;
    ctx.strokeStyle = 'rgba(255,138,138,.5)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, yCrit);
    ctx.lineTo(w - padR, yCrit);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#6f87a8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let hr = 0; hr <= 12; hr += 2) {
      ctx.fillText(hr + 'h', xOf(hr * 60), h - 7);
    }
    const legend = series.map(s => s.label).concat(['SOC %', '65°C 红线']);
    const colors = series.map(s => s.color).concat(['#c08cff', '#ff8a8a']);
    ctx.textAlign = 'left';
    legend.forEach((t, i) => {
      const lx = padL + i * 110;
      ctx.fillStyle = colors[i];
      ctx.fillRect(lx, 3, 10, 3);
      ctx.fillStyle = '#8aa3c4';
      ctx.fillText(t, lx + 14, 9);
    });
  };
})(window);
