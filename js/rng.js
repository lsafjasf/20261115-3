// 可重复的确定性随机数（mulberry32），保证同一需求计划下 A/B 公平对比
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 按每小时流量生成整个 20 分钟的到达计划表（时间戳数组，单位秒）
export function buildArrivals(rng, duration, waves, key) {
  const times = [];
  for (const w of waves) {
    const rate = w[key] / 3600;                 // 辆/秒
    const mean = 1 / rate;
    let t = w.t0 - Math.log(1 - rng()) * mean;  // 首个到达的相位随机
    while (t < w.t1) {
      if (t < duration) times.push(t);
      t += -Math.log(1 - rng()) * mean;
    }
  }
  times.sort((p, q) => p - q);
  return times;
}

// 每辆车是否被临时绕行分流（按比例确定性抽取）
export function buildDetourFlags(rng, n, pct) {
  const flags = new Array(n);
  for (let i = 0; i < n; i++) flags[i] = rng() * 100 < pct;
  return flags;
}
