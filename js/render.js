import { WORLD, LANE_Y } from './config.js';

const C = {
  grass: '#e8efe6', road: '#5b6470', edge: '#f4f5f7', lane: '#dfe4ea',
  stop: '#ffffff', hotLow: '#2ecc71', hotMid: '#f1c40f', hotHigh: '#e74c3c',
  car: '#3b82f6', bus: '#f59e0b', detour: '#8b5cf6', ped: '#ec4899',
  school: '#0ea5e9', bypass: '#a78bfa',
};

function heatColor(density) {
  // 0-120 辆/km 映射 绿→黄→红
  const t = Math.max(0, Math.min(1, density / 120));
  if (t < 0.5) return lerp([46, 204, 113], [241, 196, 15], t * 2);
  return lerp([241, 196, 15], [231, 76, 60], (t - 0.5) * 2);
}
function lerp(a, b, t) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

export class Renderer {
  constructor(ctx) { this.ctx = ctx; }

  draw(sim) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    this.drawHeat(sim);
    this.drawBypass(sim);
    this.drawRoads();
    this.drawCrosswalkAndSchool();
    this.drawBusStop(sim);
    this.drawSignals(sim);
    for (const v of sim.vehicles) this.drawVehicle(v);
    for (const p of sim.peds) this.drawPed(p);
  }

  drawRoads() {
    const ctx = this.ctx;
    // 主干道
    ctx.fillStyle = C.road;
    ctx.fillRect(0, WORLD.roadY - WORLD.laneW, WORLD.width, WORLD.laneW * 2);
    // 支路（十字路口）
    ctx.fillRect(WORLD.minorX - WORLD.laneW, 0, WORLD.laneW * 2, WORLD.height);
    // 车道中心线（虚线）
    ctx.strokeStyle = C.lane;
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.roadY); ctx.lineTo(WORLD.width, WORLD.roadY);
    ctx.moveTo(WORLD.minorX, 0); ctx.lineTo(WORLD.minorX, WORLD.height);
    ctx.stroke();
    ctx.setLineDash([]);
    // 路缘
    ctx.strokeStyle = C.edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, WORLD.roadY - WORLD.laneW, WORLD.width, WORLD.laneW * 2);
    this.drawStopLines();
  }

  drawStopLines() {
    const ctx = this.ctx;
    ctx.strokeStyle = C.stop;
    ctx.lineWidth = 2.5;
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    line(WORLD.stopEB, WORLD.roadY, WORLD.stopEB, WORLD.roadY + WORLD.laneW);
    line(WORLD.stopWB, WORLD.roadY - WORLD.laneW, WORLD.stopWB, WORLD.roadY);
    line(WORLD.minorX - WORLD.laneW, WORLD.stopNB, WORLD.minorX, WORLD.stopNB);
    line(WORLD.minorX, WORLD.stopSB, WORLD.minorX + WORLD.laneW, WORLD.stopSB);
  }

  // 主路按 100m 分段绘制密度热区（半透明覆盖车道）
  drawHeat(sim) {
    const ctx = this.ctx;
    sim.density.forEach((d, i) => {
      if (d < 4) return;
      ctx.fillStyle = heatColor(d);
      ctx.globalAlpha = 0.32;
      ctx.fillRect(i * 100, WORLD.roadY - WORLD.laneW, 100, WORLD.laneW * 2);
      ctx.globalAlpha = 1;
    });
  }

  drawBypass(sim) {
    if (sim.cfg.detourPct <= 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = C.bypass;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(150, LANE_Y.EB);
    ctx.lineTo(180, 400); ctx.lineTo(420, 430); ctx.lineTo(700, 430);
    ctx.lineTo(980, 400); ctx.lineTo(1010, LANE_Y.EB); ctx.lineTo(WORLD.mainMaxX, LANE_Y.EB);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.bypass;
    ctx.font = '12px sans-serif';
    ctx.fillText(`临时绕行 ${sim.cfg.detourPct}%`, 420, 452);
  }

  drawCrosswalkAndSchool() {
    const ctx = this.ctx;
    // 横道斑马线
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 5; i++) {
      const y = WORLD.roadY - WORLD.laneW + i * (WORLD.laneW * 2 / 5);
      ctx.fillRect(WORLD.schoolX - WORLD.crosswalkW / 2, y, WORLD.crosswalkW, 2.4);
    }
    // 学校建筑与路缘集结区
    ctx.fillStyle = C.school;
    ctx.fillRect(WORLD.schoolX - 34, 40, 68, 40);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('学校', WORLD.schoolX, 65);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(14,165,233,0.25)';
    ctx.fillRect(WORLD.schoolX - 16, 262, 32, 8);
  }

  drawBusStop(sim) {
    const ctx = this.ctx;
    const x = sim.cfg.busStopX;
    ctx.fillStyle = C.bus;
    ctx.fillRect(x - 3, WORLD.roadY + WORLD.laneW - 2, 6, 8);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#92400e';
    ctx.fillText('公交站', x - 16, WORLD.roadY + WORLD.laneW + 24);
  }

  drawSignals(sim) {
    const sig = sim.sig;
    const lamp = (x, y, on, color) => {
      this.ctx.beginPath();
      this.ctx.fillStyle = on ? color : '#374151';
      this.ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      this.ctx.fill();
    };
    // 路口两组机动车灯
    lamp(WORLD.stopEB - 8, WORLD.roadY + WORLD.laneW - 4, sig.eb, '#22c55e');
    lamp(WORLD.stopWB + 8, WORLD.roadY - WORLD.laneW + 4, sig.wb, '#22c55e');
    // 学校行人灯（红=禁止，绿=行人相位）
    const pedGreen = sig.phase === 'PED' || (sim.cfg.riskPed && sig.phase === 'MAIN');
    lamp(WORLD.schoolX - 16, 262, !pedGreen, '#ef4444');
    lamp(WORLD.schoolX - 16, 272, pedGreen, '#22c55e');
    if (sim.cfg.riskPed) {
      this.ctx.fillStyle = '#dc2626';
      this.ctx.font = 'bold 11px sans-serif';
      this.ctx.fillText('⚠ 人车混行', WORLD.schoolX - 24, 252);
    }
  }

  drawVehicle(v) {
    const ctx = this.ctx;
    const x = v.route === 'detour' ? v.x : (v.dir === 'EB' || v.dir === 'WB' ? v.pos : WORLD.minorX);
    const y = v.route === 'detour' ? v.y : (v.dir === 'EB' || v.dir === 'WB' ? v.lane : v.lanePos);
    const vertical = v.dir === 'NB' || v.dir === 'SB';
    const w = vertical ? 7 : v.len;
    const h = vertical ? v.len : 7;
    ctx.fillStyle = v.route === 'detour' ? C.detour : (v.kind === 'bus' ? C.bus : C.car);
    ctx.globalAlpha = v.dwelling ? 0.65 : 1;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (v.kind === 'bus') {
      ctx.fillStyle = '#7c2d12';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('B', x, y + 3);
      ctx.textAlign = 'left';
    }
  }

  drawPed(p) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.fillStyle = p.state === 'waiting' ? '#9ca3af' : C.ped;
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
