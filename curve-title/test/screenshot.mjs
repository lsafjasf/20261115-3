// Visual verification: render the tool in headless Chrome across the
// required test matrix and save PNG screenshots to artifacts/.
// Run: node test/screenshot.mjs
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const PORT = 8474;
const server = spawn(process.execPath, ['server.mjs'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

await mkdir('../artifacts/shots', { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.HOME +
    '/.cache/puppeteer/chrome-headless-shell/linux-157.0.8103.50/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1340, height: 760 });

const cases = [
  // Three curve lengths via width presets + shapes.
  { name: '1-short-arc', text: 'Hello世界，曲线标题2026！', preset: 'arc', strength: 90, fontSize: 52 },
  { name: '2-medium-wave', text: 'Hello世界，这是Curve标题排版Engine测试2026！', preset: 'wave', strength: 70, fontSize: 48 },
  { name: '3-long-arc', text: '曲线上排布标题文字needs careful处理，中英文混排要自动换行并检查越界。Sharp bends must not flip！', preset: 'arc', strength: 50, fontSize: 44, maxLines: 3 },
  // Sharp bend stress test.
  { name: '4-sharp-hook', text: 'Hello世界，急弯测试Turn！', preset: 'hook', strength: 100, fontSize: 46 },
  // Font size variations.
  { name: '5-fontsize-small', text: 'Hello世界，曲线标题2026！', preset: 'wave', strength: 70, fontSize: 24 },
  { name: '6-fontsize-large', text: 'Hello世界，曲线标题2026！', preset: 'wave', strength: 70, fontSize: 96 },
  // Stroke weight （粗细） variations.
  { name: '7-weight-bold', text: 'Hello世界，曲线标题2026！', preset: 'arc', strength: 65, fontSize: 52, weight: 3 },
  // Overflow （越界） case.
  { name: '8-overflow', text: '这段文字实在太长太长了，definitely超出短曲线可容纳的范围，必须触发越界检查机制！', preset: 'arc', strength: 90, fontSize: 48, maxLines: 1 },
];

for (const c of cases) {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate((c) => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input'));
    };
    set('text', c.text);
    set('preset', c.preset);
    set('strength', c.strength);
    set('fontSize', c.fontSize);
    set('weight', c.weight ?? 0);
    set('maxLines', c.maxLines ?? 2);
  }, c);
  await new Promise((r) => setTimeout(r, 300));
  const status = await page.$eval('#status', (el) => el.textContent);
  const stats = await page.evaluate(() => ({
    lines: document.getElementById('s-lines').textContent,
    glyphs: document.getElementById('s-glyphs').textContent,
    clamp: document.getElementById('s-clamp').textContent,
    boost: document.getElementById('s-boost').textContent,
    overflow: document.getElementById('s-overflow').textContent,
  }));
  console.log(c.name.padEnd(20), JSON.stringify(stats), status.slice(0, 24));
  await page.screenshot({ path: `../artifacts/shots/${c.name}.png` });
}

// SVG export smoke test: click export and capture the download.
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: new URL('../../artifacts', import.meta.url).pathname,
});
await page.click('#export');
await new Promise((r) => setTimeout(r, 800));

await browser.close();
server.kill();
console.log('done');
