// 高密度 2D 场景：3 个视差层，每层数千个运动实体。
// 关键约束：draw() 永远按 0->1->2 的固定层序绘制，
// 滚动 / 暂停 / 显隐只影响“画什么”，绝不改变“绘制顺序”。
(function (global) {
  const LAYER_DEFS = [
    { count: 12000, size: 2, speed: 6,  parallax: 0.2, color: '#3a5a8c' }, // 远景
    { count: 8000,  size: 4, speed: 14, parallax: 0.5, color: '#4c9a6a' }, // 中景
    { count: 5000,  size: 7, speed: 26, parallax: 1.0, color: '#c98a3d' }, // 近景
  ];
  const WORLD_W = 4000;
  const WORLD_H = 3000;

  function createScene() {
    const layers = LAYER_DEFS.map((def, li) => {
      const items = new Float32Array(def.count * 4); // x, y, phase, hueShift
      for (let i = 0; i < def.count; i++) {
        items[i * 4] = Math.random() * WORLD_W;
        items[i * 4 + 1] = Math.random() * WORLD_H;
        items[i * 4 + 2] = Math.random() * Math.PI * 2;
        items[i * 4 + 3] = li * 40 + Math.random() * 30;
      }
      return { def, items };
    });

    let simTime = 0;

    function update(dt) {
      simTime += dt;
    }

    // 固定层序绘制；visible 只控制跳过，不打乱顺序。
    function draw(ctx, camX, camY, visible, w, h) {
      ctx.fillStyle = '#0b0e13';
      ctx.fillRect(0, 0, w, h);
      for (let li = 0; li < layers.length; li++) {
        if (!visible[li]) continue;
        const { def, items } = layers[li];
        const offX = -camX * def.parallax;
        const offY = -camY * def.parallax;
        ctx.fillStyle = def.color;
        for (let i = 0; i < def.count; i++) {
          const b = i * 4;
          const drift = simTime * def.speed;
          let x = (items[b] + drift + offX) % WORLD_W;
          let y = (items[b + 1] + Math.sin(simTime + items[b + 2]) * 20 + offY) % WORLD_H;
          if (x < 0) x += WORLD_W;
          if (y < 0) y += WORLD_H;
          if (x > w + 8 || y > h + 8) continue;
          const s = def.size + Math.sin(simTime * 2 + items[b + 2]) * 0.8;
          ctx.fillRect(x, y, s, s);
        }
      }
    }

    return { update, draw };
  }

  global.createScene = createScene;
})(typeof self !== 'undefined' ? self : this);
