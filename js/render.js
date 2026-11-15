/* Canvas renderer: tunnel cross-section, flow arrows, pollution, doors, fans, crew. */
(function (root) {
  'use strict';

  var GAS_COLOR = 'rgba(80,200,120,0.55)';

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.phase = 0;
  }

  Renderer.prototype.draw = function (sim) {
    var ctx = this.ctx;
    var w = this.canvas.width, h = this.canvas.height;
    this.phase += 0.04;
    ctx.clearRect(0, 0, w, h);
    this.background(ctx, w, h);
    this.tunnels(ctx, sim);
    this.pollution(ctx, sim);
    this.edges(ctx, sim);
    this.doorsAndFans(ctx, sim);
    this.nodes(ctx, sim);
    this.workers(ctx, sim);
    this.legends(ctx);
  };

  Renderer.prototype.background = function (ctx, w, h) {
    ctx.fillStyle = '#14181d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (var x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  };

  Renderer.prototype.tunnels = function (ctx, sim) {
    var groups = [
      ['IN', 'M0', 'M1', 'M2', 'M3', 'FACE'],
      ['OUT', 'T0', 'T1', 'T2', 'T3'],
      ['B1', 'B2', 'B3']
    ];
    var self = this;
    groups.forEach(function (ids) {
      ctx.beginPath();
      ids.forEach(function (id, i) {
        var n = sim.nodeById[id];
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      });
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#3a434e';
      ctx.lineWidth = 34;
      ctx.stroke();
      ctx.strokeStyle = '#22282f';
      ctx.lineWidth = 26;
      ctx.stroke();
      ids.forEach(function (id) {
        var n = sim.nodeById[id];
        ctx.strokeStyle = 'rgba(160,175,190,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 15, Math.PI, 0);
        ctx.stroke();
      });
    });
    // Face end cap and working face hatch.
    var face = sim.nodeById.FACE;
    ctx.fillStyle = '#4a3b2e';
    ctx.fillRect(face.x + 14, face.y - 24, 12, 48);
    ctx.strokeStyle = '#7a6048';
    for (var i = -20; i <= 20; i += 8) {
      ctx.beginPath();
      ctx.moveTo(face.x + 16, face.y + i);
      ctx.lineTo(face.x + 24, face.y + i + 8);
      ctx.stroke();
    }
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '12px sans-serif';
    ctx.fillText('新鲜风入口', 8, 288);
    ctx.fillText('回风井 / 主风机', 8, 104);
  };

  Renderer.prototype.pollution = function (ctx, sim) {
    var self = this;
    sim.nodes.forEach(function (n) {
      if (n.id === 'IN' || n.id === 'OUT') return;
      var gasR = 8 + Math.min(26, n.gas * 12);
      var dustR = 6 + Math.min(24, n.dust * 1.6);
      if (n.dust > 0.05) {
        ctx.fillStyle = 'rgba(190,150,90,' + Math.min(0.5, n.dust / 12) + ')';
        ctx.beginPath();
        ctx.arc(n.x + Math.sin(self.phase + n.x) * 2, n.y,
          dustR + Math.sin(self.phase * 1.3 + n.y) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (n.gas > 0.02) {
        ctx.fillStyle = GAS_COLOR.replace('0.55', Math.min(0.6, n.gas / 2.2).toFixed(2));
        ctx.beginPath();
        ctx.arc(n.x, n.y - 3, gasR + Math.cos(self.phase + n.x) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  };

  Renderer.prototype.edges = function (ctx, sim) {
    var self = this;
    sim.edges.forEach(function (e) {
      var u = sim.nodeById[e.u], v = sim.nodeById[e.v];
      var flow = e.flow;
      if (Math.abs(flow) < 0.05) return;
      var speed = Math.min(1, Math.abs(flow) / 10);
      var color = flow >= 0 ? '#57c7e8' : '#e8a357';
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35 + speed * 0.4;
      ctx.lineWidth = 2 + speed * 2.5;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(v.x, v.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      self.arrows(ctx, u, v, flow, color);
    });
  };

  Renderer.prototype.arrows = function (ctx, u, v, flow, color) {
    var dx = v.x - u.x, dy = v.y - u.y;
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;
    var from = flow >= 0 ? u : v;
    var to = flow >= 0 ? v : u;
    var count = Math.max(1, Math.floor(len / 90));
    var offset = (this.phase * 18 * Math.sign(flow)) % (len / count);
    for (var i = 0; i < count; i++) {
      var d = ((len / count) * i + offset + len) % len;
      var x = from.x + ux * d;
      var y = from.y + uy * d;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(from.x + ux * (d + 7), from.y + uy * (d + 7));
      ctx.lineTo(x - uy * 5, y + ux * 5);
      ctx.lineTo(x + uy * 5, y - ux * 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = color;
    var ex = to.x - ux * 20, ey = to.y - uy * 20;
    ctx.beginPath();
    ctx.moveTo(to.x - ux * 8, to.y - uy * 8);
    ctx.lineTo(ex - uy * 6, ey + ux * 6);
    ctx.lineTo(ex + uy * 6, ey - ux * 6);
    ctx.closePath();
    ctx.fill();
  };

  Renderer.prototype.doorsAndFans = function (ctx, sim) {
    var self = this;
    Object.keys(sim.doors).forEach(function (id) {
      var door = sim.doors[id];
      var edge = sim.edgeById[door.edgeId];
      var u = sim.nodeById[edge.u], v = sim.nodeById[edge.v];
      var x = (u.x + v.x) / 2, y = (u.y + v.y) / 2;
      ctx.save();
      ctx.translate(x, y);
      var angle = Math.atan2(v.y - u.y, v.x - u.x);
      ctx.rotate(angle);
      ctx.fillStyle = door.open ? '#3d7a4d' : '#b24a4a';
      ctx.fillRect(-9, -9, 18, 18);
      ctx.strokeStyle = '#e8edf2';
      ctx.lineWidth = 2;
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.beginPath();
      if (door.open) {
        ctx.moveTo(-7, 7); ctx.lineTo(7, -7);
      } else {
        ctx.moveTo(-7, 0); ctx.lineTo(7, 0);
      }
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#c8d2dc';
      ctx.font = '11px sans-serif';
      ctx.fillText(id, x - 7, y - 14);
    });

    // Main fan at OUT, local fan on the duct.
    this.fan(ctx, sim.nodeById.OUT.x + 4, sim.nodeById.OUT.y,
      sim.fans.main.on, sim.fans.main.reverse);
    var duct = sim.edgeById.e_duct;
    var du = sim.nodeById[duct.u], dv = sim.nodeById[duct.v];
    this.fan(ctx, (du.x + dv.x) / 2, (du.y + dv.y) / 2,
      sim.fans.local.mode !== 'off', sim.fans.local.mode === 'exhaust');
  };

  Renderer.prototype.fan = function (ctx, x, y, on, reverse) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = on ? '#2b5f8f' : '#444';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9fd6ff';
    ctx.lineWidth = 2;
    for (var i = 0; i < 3; i++) {
      var a = this.phase * (reverse ? -2 : 2) + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.nodes = function (ctx, sim) {
    sim.nodes.forEach(function (n) {
      ctx.fillStyle = '#20262d';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
      ctx.fill();
      if (!n.sensor) return;
      var gasBad = n.gas > sim.gasLimit;
      var dustBad = n.dust > sim.dustLimit;
      ctx.fillStyle = gasBad || dustBad ? '#ff5d5d' : '#56e08a';
      ctx.beginPath();
      ctx.arc(n.x, n.y - 22, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dbe4ec';
      ctx.font = '10px sans-serif';
      ctx.fillText(n.id, n.x - 12, n.y + 26);
      ctx.fillText(n.gas.toFixed(2) + '%', n.x - 16, n.y + 38);
    });
  };

  Renderer.prototype.workers = function (ctx, sim) {
    var node = sim.nodeById[sim.workers.nodeId];
    for (var i = 0; i < 3; i++) {
      var x = node.x - 30 + i * 14;
      var y = node.y + 44 + Math.sin(this.phase + i) * 2;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(x, y - 8, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8edf2';
      ctx.fillRect(x - 4, y - 3, 8, 10);
    }
  };

  Renderer.prototype.legends = function (ctx) {
    var items = [
      ['#57c7e8', '正向风流'],
      ['#e8a357', '反向风流'],
      ['rgba(80,200,120,0.8)', '瓦斯云'],
      ['rgba(190,150,90,0.8)', '粉尘云'],
      ['#ff5d5d', '超标传感器']
    ];
    ctx.font = '12px sans-serif';
    items.forEach(function (it, i) {
      var x = 24 + i * 150, y = 568;
      ctx.fillStyle = it[0];
      ctx.fillRect(x, y - 9, 12, 12);
      ctx.fillStyle = '#c8d2dc';
      ctx.fillText(it[1], x + 18, y + 1);
    });
  };

  root.MineRenderer = Renderer;
})(window);
