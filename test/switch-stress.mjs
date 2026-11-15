// 自动化压力测试:在真实浏览器中反复切换声场 20 轮,
// 记录每轮切换前后的活动节点数与 JS 堆内存,验证无泄漏。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
};

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const browser = await puppeteer.launch({
  headless: 'shell',
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

const page = await browser.newPage();
page.on('pageerror', (err) => console.error('PAGE_ERROR:', err.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });

const ROUNDS = 20;
const sceneNames = ['rain', 'forest', 'city'];
const records = [];

async function measure() {
  const metrics = await page.metrics();
  return page.evaluate(
    ({ heap }) => ({
      nodes: window.__activeNodeCount(),
      scene: window.__engine.scene?.name ?? '-',
      ctxState: window.__engine.context?.state ?? '-',
      heapMB: +(heap / 1024 / 1024).toFixed(2),
    }),
    { heap: metrics.JSHeapUsedSize }
  );
}

// 启动首个场景
await page.click('button.scene[data-scene="rain"]');
await new Promise((r) => setTimeout(r, 300));
const initial = await measure();
console.log('初始状态:', JSON.stringify(initial));

for (let round = 1; round <= ROUNDS; round++) {
  const name = sceneNames[round % sceneNames.length];
  const before = await measure();
  await page.click(`button.scene[data-scene="${name}"]`);
  await new Promise((r) => setTimeout(r, 250));
  const after = await measure();
  records.push({ round, name, before: before.nodes, after: after.nodes, heapMB: after.heapMB });
  console.log(
    `第 ${String(round).padStart(2)} 轮 -> ${name.padEnd(6)} 节点 ${before.nodes} -> ${after.nodes}  堆 ${after.heapMB} MB  ctx=${after.ctxState}`
  );
}

// 暂停 / 继续 / 重建各执行一次
await page.click('#pauseBtn');
await new Promise((r) => setTimeout(r, 200));
const paused = await measure();
console.log('暂停后:', JSON.stringify(paused));
await page.click('#pauseBtn');
await new Promise((r) => setTimeout(r, 200));
await page.click('#rebuildBtn');
await new Promise((r) => setTimeout(r, 200));
const rebuilt = await measure();
console.log('继续+重建后:', JSON.stringify(rebuilt));

// 停止后应只剩 master 增益节点
await page.click('#stopBtn');
await new Promise((r) => setTimeout(r, 200));
const stopped = await measure();
console.log('停止后:', JSON.stringify(stopped));

// 泄漏判定:同一场景每轮节点数必须一致,堆增长应有限
const perScene = {};
for (const r of records) {
  (perScene[r.name] ??= new Set()).add(r.after);
}
const sceneStable = Object.values(perScene).every((s) => s.size === 1);
const heapGrowth = records.at(-1).heapMB - records[0].heapMB;
console.log('---');
console.log(
  '各场景节点数:',
  Object.entries(perScene)
    .map(([k, s]) => `${k}=${[...s].join('/')}`)
    .join('  ')
);
console.log(`堆内存变化: ${records[0].heapMB} MB -> ${records.at(-1).heapMB} MB (Δ ${heapGrowth.toFixed(2)} MB)`);
console.log('停止后残留节点数:', stopped.nodes, '(应为 1,仅 master)');

const pass =
  sceneStable &&
  stopped.nodes === 1 &&
  Math.abs(heapGrowth) < 5;
console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');

await browser.close();
server.close();
process.exit(pass ? 0 : 1);
