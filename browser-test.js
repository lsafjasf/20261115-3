const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  // Inject a local CJK font so headless Linux renders Chinese glyphs.
  const fontB64 = fs.readFileSync(path.resolve(__dirname, '.fonts/NotoSansSC.ttf')).toString('base64');
  await page.addStyleTag({
    content: `@font-face { font-family: 'NotoLocal'; src: url(data:font/ttf;base64,${fontB64}); }
      body, button, input, pre, .swatch .hex { font-family: 'NotoLocal', sans-serif !important; }`,
  });
  await page.waitForTimeout(300);
  await page.waitForSelector('.palette-card');

  const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('PASS:', msg); };

  // Two palette cards, each with 6 swatches and 5 canvases.
  assert(await page.locator('.palette-card').count() === 2, '渲染两套配色卡片');
  assert(await page.locator('.swatch').count() === 12, '共 12 个色卡');
  assert(await page.locator('canvas').count() === 10, '共 10 个模拟视图 Canvas（每套 5 个）');

  // Both palettes pass default thresholds.
  const badges = await page.locator('.badge').allInnerTexts();
  assert(badges.every((b) => b.includes('安全')), '默认阈值下两套均显示安全: ' + badges.join(' | '));

  // Metrics show numeric contrast and deltaE per view.
  const metricCount = await page.locator('.metric').count();
  assert(metricCount === 10, '每套 5 个视图实时指标（共 10）');

  // Auto verification output present and successful.
  const verifyText = await page.locator('#verify-output').innerText();
  assert(verifyText.includes('验证通过'), '页面自动运行锁定验证并通过');

  // Lock a swatch in palette A, regenerate, confirm its hex persists.
  const hexBefore = await page.locator('.palette-card').first().locator('.swatch .hex').first().innerText();
  await page.locator('.palette-card').first().locator('.swatch button').first().click();
  assert(await page.locator('.palette-card').first().locator('.swatch.locked').count() === 1, '点击后出现锁定态');
  await page.locator('.palette-card').first().locator('h2 button').click();
  await page.waitForTimeout(50);
  const hexCycle = await page.locator('.palette-card').first().locator('.swatch .hex').allInnerTexts();
  assert(hexCycle[0] === hexBefore, '重生成后锁定色保持不变 ' + hexCycle[0]);

  // Danger blocking: pick an unsafe color (duplicate of an existing swatch).
  page.once('dialog', (d) => d.dismiss());
  const dupHex = await page.locator('.palette-card').first().locator('.swatch .hex').nth(1).innerText();
  const targetPicker = page.locator('.palette-card').first().locator('.swatch input[type=color]').nth(2);
  await targetPicker.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, dupHex.toLowerCase());
  await page.waitForTimeout(50);
  const afterBlock = await page.locator('.palette-card').first().locator('.swatch .hex').nth(2).innerText();
  assert(afterBlock.toLowerCase() !== dupHex.toLowerCase(), '危险重复色被拦截，未写入色卡');

  // Tighten thresholds beyond what is achievable -> fail badge appears.
  await page.locator('#min-deltae').evaluate((el) => { el.value = '15'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(50);
  const strictBadges = await page.locator('.badge.fail').count();
  assert(strictBadges >= 1, '过严阈值触发危险组合标记（阻止提示生效）');

  // Restore defaults for the screenshot so it shows the safe state.
  await page.locator('#min-deltae').evaluate((el) => { el.value = '7'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);

  assert(errors.length === 0, '无 JS 错误: ' + errors.join('; '));
  await page.screenshot({ path: 'artifacts/app-preview.png', fullPage: true });
  await browser.close();
  console.log('\n全部浏览器测试通过，截图已保存到 artifacts/app-preview.png');
})().catch((e) => { console.error(e.message); process.exit(1); });
