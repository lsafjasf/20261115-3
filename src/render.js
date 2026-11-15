// Canvas 渲染：街网、车辆、水位覆盖、热区、路障与优先级标记。
import { waterLevelAt } from './world.js';

const STATE_COLOR = { idle: '#94a3b8', moving: '#38bdf8', dwelling: '#fbbf24', trapped: '#ef4444' };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function render(ctx, world, engine, opts = {}) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const water = waterLevelAt(engine.tick);

  // 背景
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);

  // 水位覆盖层：海拔低于当前水位的区域填蓝色，越深越浓
  for (const node of world.nodes) {
    if (node.elev < water) {
      const depth = Math.min(1, (water - node.elev) / 1.4);
      ctx.fillStyle = `rgba(56,189,248,${0.12 + depth * 0.35})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 70, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 道路
  for (const e of world.edges) {
    const a = world.nodes[e.from], b = world.nodes[e.to];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (e.blocked) {
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 7;
      ctx.setLineDash([10, 8]);
    } else if (!isOpen(e, engine.tick)) {
      ctx.strokeStyle = 'rgba(56,189,248,0.55)';
      ctx.lineWidth = 5;
      ctx.setLineDash([4, 6]);
    } else {
      ctx.strokeStyle = e.priority > 0 ? '#a3e635' : '#475569';
      ctx.lineWidth = e.priority > 0 ? 4 + e.priority : 3;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (e.priority > 0 && !e.blocked) {
      ctx.fillStyle = '#a3e635';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('P' + e.priority, (a.x + b.x) / 2, (a.y + b.y) / 2 - 4);
    }
  }

  // 节点：热区（居民区）按人口着色
  for (const node of world.nodes) {
    const isHome = world.homeIds.includes(node.id);
    const isShelter = node.id === world.shelterId;
    ctx.beginPath();
    ctx.arc(node.x, node.y, isShelter ? 14 : 10, 0, Math.PI * 2);
    if (isShelter) {
      ctx.fillStyle = '#22c55e';
    } else if (isHome) {
      const heat = Math.min(1, node.residents / 28);
      ctx.fillStyle = `rgb(${239},${Math.round(180 - heat * 120)},${Math.round(60 - heat * 40)})`;
    } else {
      ctx.fillStyle = '#334155';
    }
    ctx.fill();
    ctx.strokeStyle = node.elev < water ? '#38bdf8' : '#1e293b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    if (isHome) ctx.fillText(`${node.residents}`, node.x, node.y - 16);
    if (isShelter) ctx.fillText('避难所', node.x, node.y - 20);
    ctx.fillText(String(node.id), node.x, node.y + 4);
    ctx.textAlign = 'left';
  }

  // 巴士
  for (const bus of engine.buses) {
    let x, y;
    if (bus.state === 'moving' && bus.edge) {
      const a = world.nodes[bus.fromNode], b = world.nodes[bus.toNode];
      const t = 1 - bus.remaining / bus.edgeLength;
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
    } else {
      const n = world.nodes[bus.node];
      x = n.x; y = n.y;
    }
    ctx.beginPath();
    ctx.arc(x, y + (bus.id % 3) * 4 - 4, 8, 0, Math.PI * 2);
    ctx.fillStyle = STATE_COLOR[bus.state];
    ctx.fill();
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#0b1220';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(bus.id), x, y + (bus.id % 3) * 4);
    ctx.textAlign = 'left';
  }

  // HUD
  const minute = Math.floor(engine.tick / 6);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`时间 ${minute}:${String((engine.tick % 6) * 10).padStart(2, '0')}  水位 ${water.toFixed(2)}m`, 14, 22);
  ctx.fillText(`已撤离 ${engine.evacuated}/${world.residentsTotal}（目标 ${world.evacTarget}）`, 14, 42);
  ctx.fillText(`被困 ${engine.trapped.length} 辆`, 14, 62);
  if (opts.banner) {
    ctx.fillStyle = opts.bannerColor || '#fbbf24';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.banner, width / 2, 30);
    ctx.textAlign = 'left';
  }
}

function isOpen(edge, tick) {
  return !edge.blocked && tick <= edge.cutTick;
}
