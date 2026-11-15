/* Node verification: generate two palettes, lock key colors, regenerate,
 * and prove locked colors keep identical source + per-view simulated hex. */
const C = require('./color.js');
const G = require('./generator.js');

const COUNT = 6;
const SETTINGS = { severity: 1, minContrast: 1.15, minDeltaE: 7 };
const simHex = (hex, view) =>
  C.rgbToHex(...C.simulate(C.hexToRgb(hex), view, SETTINGS.severity));

function verifyPalette(name, seed, lockIdx) {
  const first = G.generatePalette({ count: COUNT, seed, ...SETTINGS });
  const locked = new Array(COUNT).fill(null);
  lockIdx.forEach((i) => { locked[i] = first.colors[i]; });
  const second = G.generatePalette({
    count: COUNT, seed: seed + 500, locked, ...SETTINGS,
  });

  console.log(`\n=== ${name} ===`);
  console.log('初始配色 :', first.colors.join(' '));
  console.log('重生成后 :', second.colors.join(' '));
  console.log(`锁定槽位 : ${lockIdx.map((i) => 'C' + (i + 1)).join('、')}`);

  let ok = true;
  lockIdx.forEach((i) => {
    const sourceSame = first.colors[i] === second.colors[i];
    const perView = C.VIEWS.map((v) => {
      const a = simHex(first.colors[i], v);
      const b = simHex(second.colors[i], v);
      const same = a === b;
      ok = ok && same;
      return `    ${C.VIEW_LABELS[v].padEnd(10)} ${a}  ${same ? '=' : '!'}  ${b}`;
    });
    ok = ok && sourceSame;
    console.log(`\n  C${i + 1} ${first.colors[i].toUpperCase()} 源色${sourceSame ? '保持不变' : '发生改变'}`);
    perView.forEach((line) => console.log(line));
  });

  const unlockedMoved = second.colors.some((h, i) => !lockIdx.includes(i) && h !== first.colors[i]);
  console.log(`\n  非锁定色已重新生成 : ${unlockedMoved ? '是' : '否'}`);
  console.log(`  重生成后全视图安全 : ${second.passed ? '是' : '否'}`);
  if (!second.passed) {
    ok = false;
    second.report.failures.forEach((f) =>
      console.log(`    失败视图 ${f.view}: 对比度 ${f.minContrast.toFixed(2)} ΔE ${f.minDeltaE.toFixed(1)}`));
  }
  return ok;
}

const okA = verifyPalette('配色方案 A', 7, [0, 3]);
const okB = verifyPalette('配色方案 B', 42, [1, 4]);
console.log(`\n${okA && okB ? '✔ 全部验证通过：锁定色在五种视图中均未改变，两套配色均满足安全阈值。'
  : '✘ 验证失败，请检查上面的差异行。'}`);
process.exit(okA && okB ? 0 : 1);
