/* Canvas 渲染：营地剖面、风雪、能量流与温度。 */
(function () {
  'use strict';
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, GROUND = 470;

  // 雪粒子
  const flakes = [];
  for (let i = 0; i < 260; i++) {
    flakes.push({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 2.2, s: Math.random() });
  }

  const POD_X = [150, 400, 650], POD_W = 150, POD_H = 110;

  function tempColor(t) {
    // -40(蓝) → 20(暖橙)
    const k = Math.max(0, Math.min(1, (t + 40) / 60));
    const r = Math.round(40 + 215 * k), g = Math.round(90 + 110 * k), b = Math.round(220 - 160 * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawPod(x, pod, idx, sim) {
    const y = GROUND;
    // 舱体（圆顶剖面）
    ctx.beginPath();
    ctx.moveTo(x - POD_W / 2, y);
    ctx.quadraticCurveTo(x, y - POD_H - 40, x + POD_W / 2, y);
    ctx.closePath();
    ctx.fillStyle = '#1a2438';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = tempColor(pod.temp);
    ctx.stroke();
    // 内部热光
    const glow = ctx.createRadialGradient(x, y - 30, 5, x, y - 30, 70);
    glow.addColorStop(0, tempColor(pod.temp).replace('rgb', 'rgba').replace(')', ',0.55)'));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - POD_W / 2, y - POD_H - 30, POD_W, POD_H + 30);
    // 窗户
    ctx.fillStyle = pod.heater ? '#ffd27a' : '#233049';
    ctx.fillRect(x - 14, y - 52, 28, 22);
    // 标签与温度
    ctx.fillStyle = '#cfe0f5';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pod.name + (pod.heater ? ' 🔥' : ''), x, y + 16);
    ctx.fillStyle = tempColor(pod.temp);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(pod.temp.toFixed(1) + '°C', x, y - 70);
    // 舱内人员
    const c = sim.crew[idx];
    if (c && c.patrolLeft === 0) {
      ctx.fillStyle = c.health > 40 ? '#9fd8ff' : '#ff6b6b';
      ctx.beginPath(); ctx.arc(x, y - 18, 7, 0, 7); ctx.fill();
    }
    // 舱B 画电池组
    if (idx === 1) {
      const b = sim.battery;
      ctx.fillStyle = '#0d1420';
      ctx.fillRect(x - 30, y - 26, 60, 22);
      ctx.strokeStyle = tempColor(b.temp); ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 30, y - 26, 60, 22);
      ctx.fillStyle = '#5fd68a';
      ctx.fillRect(x - 28, y - 24, 56 * (b.charge / 40), 18);
      ctx.fillStyle = '#cfe0f5'; ctx.font = '10px sans-serif';
      ctx.fillText('电池 ' + b.temp.toFixed(0) + '°C', x, y - 32);
    }
  }

  function drawGenerator(sim) {
    const x = 770, y = GROUND;
    ctx.fillStyle = '#241f2e';
    ctx.fillRect(x - 34, y - 44, 68, 44);
    ctx.strokeStyle = sim.gen.state === 'ONLINE' ? '#5fd68a' : '#4a5570';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 34, y - 44, 68, 44);
    ctx.fillStyle = '#cfe0f5'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    const label = { OFF: '停机', PREHEAT: '预热中', READY: '可点火', ONLINE: sim.gen.loadConnected ? '带载' : '空载' }[sim.gen.state];
    ctx.fillText('发电机·' + label, x, y - 50);
    // 排烟
    if (sim.gen.state === 'ONLINE') {
      ctx.fillStyle = 'rgba(180,190,205,0.5)';
      const ph = (Date.now() / 300) % 3;
      for (let i = 0; i < 3; i++) {
        const yy = y - 48 - ((ph + i) % 3) * 12;
        ctx.beginPath(); ctx.arc(x + 22 + ((ph + i) % 3) * 5, yy, 4 + i, 0, 7); ctx.fill();
      }
    }
  }

  function drawSolar(sim) {
    const x = 60, y = GROUND;
    ctx.strokeStyle = '#4a5570'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y - 46); ctx.stroke();
    ctx.save();
    ctx.translate(x + 8, y - 50); ctx.rotate(-0.5);
    ctx.fillStyle = '#12325e';
    ctx.fillRect(-26, -8, 64, 26);
    // 积雪覆盖
    ctx.fillStyle = 'rgba(235,242,252,' + (sim.snowCover * 0.95) + ')';
    ctx.fillRect(-26, -8, 64, 26 * sim.snowCover);
    ctx.restore();
    ctx.fillStyle = '#7d90ad'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('太阳能 ' + sim.solarKW().toFixed(1) + 'kW', x + 10, y + 14);
  }

  function drawBus(sim) {
    // 母线：连接太阳能、三舱、发电机
    const y = GROUND - 150;
    ctx.strokeStyle = sim.busFaultTicks > 0 ? '#ff6b6b' : '#ffb347';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -(Date.now() / 40) % 14;
    ctx.beginPath();
    ctx.moveTo(70, y);
    ctx.lineTo(770, y);
    for (const px of POD_X) { ctx.moveTo(px, y); ctx.lineTo(px, GROUND - POD_H - 10); }
    ctx.moveTo(770, y); ctx.lineTo(770, GROUND - 44);
    ctx.moveTo(70, y); ctx.lineTo(70, GROUND - 60);
    ctx.stroke();
    ctx.setLineDash([]);
    // 功率文字
    const b = sim.lastBalance;
    ctx.fillStyle = '#ffb347'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('母线  需求 ' + b.demand.toFixed(1) + 'kW │ 太阳能 ' + b.solar.toFixed(1) +
      ' │ 发电机 ' + b.gen.toFixed(1) + ' │ 电池 ' + (b.battery >= 0 ? '-' : '+') +
      Math.abs(b.battery).toFixed(1) + (b.brownout ? '  ⚠欠压' : ''), 80, y - 8);
  }

  function drawSky(sim) {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    const k = sim.blizzard;
    g.addColorStop(0, 'rgb(' + (8 + 20 * k) + ',' + (12 + 18 * k) + ',' + (26 + 22 * k) + ')');
    g.addColorStop(1, '#101a30');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND);
    // 风雪粒子：风速决定水平漂移
    const windPx = sim.wind * 0.9;
    ctx.fillStyle = 'rgba(230,240,255,0.85)';
    for (const f of flakes) {
      f.x -= windPx * (0.3 + f.s) * 0.16;
      f.y += (1 + f.s * 2) * (0.6 + sim.blizzard);
      if (f.x < -5) f.x = W + 5;
      if (f.y > GROUND) { f.y = -5; f.x = Math.random() * W; }
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
    }
    // 地面积雪
    ctx.fillStyle = '#dfe8f4';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#c6d3e6';
    ctx.fillRect(0, GROUND, W, 4);
  }

  function drawHUD(sim) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#cfe0f5';
    ctx.fillText(sim.clock(), 14, 24);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#7d90ad';
    ctx.fillText('室外 ' + sim.outsideC.toFixed(1) + '°C   风速 ' + sim.wind.toFixed(0) +
      ' m/s   暴风雪 ' + (sim.blizzard * 100).toFixed(0) + '%   燃料 ' +
      sim.gen.fuelL.toFixed(1) + 'L', 14, 44);
    // 巡查中的人员
    for (const c of sim.crew) {
      if (c.patrolLeft > 0) {
        const px = 150 + (sim.crew.indexOf(c) * 220) + Math.random() * 60;
        ctx.fillStyle = '#ffcf5c';
        ctx.beginPath(); ctx.arc(px, GROUND - 8, 6, 0, 7); ctx.fill();
        ctx.fillText(c.name + ' 巡查中', px + 10, GROUND - 10);
      }
    }
  }

  window.CampRender = {
    draw(sim) {
      ctx.clearRect(0, 0, W, H);
      drawSky(sim);
      drawSolar(sim);
      for (let i = 0; i < 3; i++) drawPod(POD_X[i], sim.pods[i], i, sim);
      drawGenerator(sim);
      drawBus(sim);
      drawHUD(sim);
    }
  };
})();
