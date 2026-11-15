// Node 冒烟测试：用最小 Canvas mock 跑通 render()，验证绘制逻辑无运行时错误。
import { createWorld } from '../src/world.js';
import { createEngine } from '../src/engine.js';
import { createAutoPilot } from '../src/autopilot.js';
import { render } from '../src/render.js';

function makeCtx() {
  const noop = () => {};
  return {
    canvas: { width: 960, height: 600 },
    fillRect: noop, clearRect: noop, beginPath: noop, arc: noop, fill: noop,
    stroke: noop, moveTo: noop, lineTo: noop, fillText: noop, setLineDash: noop,
    roundRect: noop,
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
  };
}

const world = createWorld();
const engine = createEngine(world);
const pilot = createAutoPilot(world, engine);
const ctx = makeCtx();

for (let i = 0; i < 180; i++) {
  pilot.tick();
  engine.step();
  render(ctx, world, engine, i === 179 ? { banner: '撤离成功', bannerColor: '#22c55e' } : {});
}

console.log(`render 冒烟通过：180 帧全部绘制成功，撤离 ${engine.evacuated}/${world.residentsTotal}`);
