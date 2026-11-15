// Canvas 舞台：渲染房间、四角扬声器、墙面反射镜像、声源与监听器，并处理拖拽。

const HANDLE_R = 11;

function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class SpatialCanvas {
  constructor(canvas, state, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    this.onChange = onChange;
    this.scale = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.drag = null;
    this.bindEvents();
    this.draw();
  }

  setState(state) {
    this.state = state;
    this.draw();
  }

  // 世界坐标(米) → 画布像素
  layout() {
    const { room } = this.state;
    const pad = 46;
    const w = this.canvas.width - pad * 2;
    const h = this.canvas.height - pad * 2;
    this.scale = Math.min(w / room.width, h / room.height);
    this.offsetX = pad + (w - room.width * this.scale) / 2;
    this.offsetY = pad + (h - room.height * this.scale) / 2;
  }

  toPx(p) {
    return { x: this.offsetX + p.x * this.scale, y: this.offsetY + p.y * this.scale };
  }

  toWorld(px, py) {
    return { x: (px - this.offsetX) / this.scale, y: (py - this.offsetY) / this.scale };
  }

  bindEvents() {
    const pos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
        y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
      };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.layout();
      const p = pos(e);
      this.drag = this.hitTest(p);
      if (this.drag) this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        this.layout();
        this.canvas.style.cursor = this.hitTest(pos(e)) ? 'grabbing' : 'default';
        return;
      }
      const w = this.toWorld(pos(e).x, pos(e).y);
      this.applyDrag(w);
    });

    const end = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  hitTest(p) {
    const s = this.toPx(this.state.source);
    if (Math.hypot(p.x - s.x, p.y - s.y) <= HANDLE_R + 4) return { type: 'source' };
    const l = this.toPx(this.state.listener);
    if (Math.hypot(p.x - l.x, p.y - l.y) <= HANDLE_R + 4) return { type: 'listener' };
    const r = this.state.room;
    const walls = [
      { type: 'wall', wall: 'left', x: r.x, y: r.y + r.height / 2 },
      { type: 'wall', wall: 'right', x: r.x + r.width, y: r.y + r.height / 2 },
      { type: 'wall', wall: 'top', x: r.x + r.width / 2, y: r.y },
      { type: 'wall', wall: 'bottom', x: r.x + r.width / 2, y: r.y + r.height },
    ];
    for (const wall of walls) {
      const q = this.toPx(wall);
      if (Math.hypot(p.x - q.x, p.y - q.y) <= HANDLE_R + 3) return wall;
    }
    return null;
  }

  applyDrag(w) {
    const { state, drag } = this;
    if (drag.type === 'source') {
      state.source = this.clampInside(w);
    } else if (drag.type === 'listener') {
      state.listener = { ...state.listener, ...this.clampInside(w) };
    } else if (drag.type === 'wall') {
      this.resizeRoom(drag.wall, w);
    }
    this.onChange();
    this.draw();
  }

  clampInside(p) {
    const r = this.state.room;
    const m = 0.2;
    return {
      x: Math.min(Math.max(p.x, r.x + m), r.x + r.width - m),
      y: Math.min(Math.max(p.y, r.y + m), r.y + r.height - m),
    };
  }

  resizeRoom(wall, w) {
    const r = this.state.room;
    const minSize = 2.5;
    if (wall === 'left') r.x = Math.min(w.x, r.x + r.width - minSize);
    if (wall === 'right') r.width = Math.max(w.x - r.x, minSize);
    if (wall === 'top') r.y = Math.min(w.y, r.y + r.height - minSize);
    if (wall === 'bottom') r.height = Math.max(w.y - r.y, minSize);
    // 房间缩小后，把声源/监听器重新夹回边界内
    this.state.source = this.clampInside(this.state.source);
    this.state.listener = { ...this.state.listener, ...this.clampInside(this.state.listener) };
  }

  draw() {
    this.layout();
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawRoom();
    this.drawSpeakers();
    this.drawReflections();
    this.drawDirectPath();
    this.drawSource();
    this.drawListener();
  }

  drawRoom() {
    const { ctx } = this;
    const a = this.toPx(this.state.room);
    const w = this.state.room.width * this.scale;
    const h = this.state.room.height * this.scale;
    ctx.fillStyle = '#101624';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeRect(a.x, a.y, w, h);
    for (const [wx, wy] of [
      [a.x, a.y + h / 2], [a.x + w, a.y + h / 2],
      [a.x + w / 2, a.y], [a.x + w / 2, a.y + h],
    ]) {
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.arc(wx, wy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawSpeakers() {
    const { ctx } = this;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const r = this.state.room;
    const m = 0.35;
    const pts = this.state.mode === 'quad'
      ? [
        ['FL', r.x + m, r.y + m], ['FR', r.x + r.width - m, r.y + m],
        ['BR', r.x + r.width - m, r.y + r.height - m],
        ['BL', r.x + m, r.y + r.height - m],
      ]
      : [['L', r.x + m, r.y + r.height / 2], ['R', r.x + r.width - m, r.y + r.height / 2]];
    for (const [name, x, y] of pts) {
      const p = this.toPx({ x, y });
      ctx.fillStyle = this.state.mode === 'quad' ? '#a78bfa' : '#34d399';
      roundRectPath(ctx, p.x - 13, p.y - 10, 26, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#0b1020';
      ctx.fillText(name, p.x, p.y + 4);
    }
  }

  drawReflections() {
    const { ctx } = this;
    const images = this.reflectionImages();
    ctx.setLineDash([5, 5]);
    for (const img of images) {
      const a = this.toPx(this.state.source);
      const b = this.toPx(img);
      ctx.strokeStyle = 'rgba(251,191,36,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(251,191,36,0.5)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([]);
  }

  reflectionImages() {
    const s = this.state.source;
    const r = this.state.room;
    return [
      { x: 2 * r.x - s.x, y: s.y }, { x: 2 * (r.x + r.width) - s.x, y: s.y },
      { x: s.x, y: 2 * r.y - s.y }, { x: s.x, y: 2 * (r.y + r.height) - s.y },
    ];
  }

  drawDirectPath() {
    const { ctx } = this;
    const a = this.toPx(this.state.source);
    const b = this.toPx(this.state.listener);
    ctx.strokeStyle = 'rgba(52,211,153,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  drawSource() {
    const { ctx } = this;
    const p = this.toPx(this.state.source);
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fecaca';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('S', p.x, p.y + 4);
  }

  drawListener() {
    const { ctx } = this;
    const p = this.toPx(this.state.listener);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#bae6fd';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 朝向指示
    const tip = {
      x: p.x + Math.cos(this.state.listener.angle) * 22,
      y: p.y + Math.sin(this.state.listener.angle) * 22,
    };
    ctx.strokeStyle = '#bae6fd';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('L', p.x, p.y + 4);
  }
}
