import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const server = spawn(process.execPath, [join(here, 'static-server.js')], {
  env: { ...process.env, PORT: '8932' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', resolve));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto('http://localhost:8932/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#chart .label');
  const bundle = await page.evaluate(async () => {
    const { drawToCanvas } = await import('/src/pngExport.js');
    const chart = window.__chart;
    const canvas = drawToCanvas(chart.sampleSeries, chart.layout(), chart.view, 2);
    return {
      png: canvas.toDataURL('image/png'),
      svg: chart.renderSvg(chart.sampleSeries, chart.layout(), chart.view),
      dims: { w: canvas.width, h: canvas.height },
    };
  });
  await writeFile(
    join(root, 'artifacts', 'annotated-chart.baseline.png'),
    Buffer.from(bundle.png.split(',')[1], 'base64'),
  );
  await writeFile(join(root, 'artifacts', 'annotated-chart.baseline.svg'), bundle.svg);
  console.log('baseline written', bundle.dims);
} finally {
  await browser.close();
  server.kill();
}
