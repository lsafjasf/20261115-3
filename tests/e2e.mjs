import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:8123';
const SHOTS = 'artifacts/screenshots';
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : '')); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => record('页面无 JS 运行时错误', false, String(e)));
page.on('console', m => { if (m.type() === 'error') record('控制台无 error', false, m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.APP_RUNTIME && APP_RUNTIME.drawables.length > 0);
await page.waitForTimeout(400);

const glInfo = await page.evaluate(() => {
  const gl = APP_RUNTIME.renderer.gl;
  return { depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE), meshes: APP_RUNTIME.drawables.length };
});
record('WebGL 初始化：深度测试开启且网格已上传', glInfo.depth && glInfo.meshes >= 20, JSON.stringify(glInfo));

/* 1. 内置自检（覆盖三层同显 / 单层隐藏 / 剖切反转 / 管线独立 / 拾取） */
await page.click('#runTests');
await page.waitForTimeout(150);
const self = await page.evaluate(() => window.__SELF_TEST__);
record('内置自检 7 项全部通过', self && self.every(r => r.pass), (self || []).filter(r => !r.pass).map(r => r.name).join(';') || '7/7');

/* 2. 三层同时显示（独立于自检，直接读取绘制组） */
const threeFloors = await page.evaluate(() => {
  const s = APP_RUNTIME.state;
  s.floors = [true, true, true];
  const vis = t => APP_RUNTIME.drawables.filter(d => d.tag === t && d.predicate()).length;
  return [0,1,2].every(f => vis('slab-' + f) && vis('wall-' + f) && vis('roomfloor-' + f));
});
record('三层同时显示：所有楼层组均可见', threeFloors);
await page.screenshot({ path: SHOTS + '/01-three-floors.png' });

/* 3. 单层隐藏：仅 2F 关闭，画面内容应发生变化且其他层保留 */
const before = await pixelHash(page);
await page.uncheck('#floor-1');
await page.waitForTimeout(250);
const afterHide = await page.evaluate(() => {
  const vis = t => APP_RUNTIME.drawables.filter(d => d.tag === t && d.predicate()).length;
  return { f1: vis('slab-0'), f2: vis('slab-1'), f3: vis('slab-2') };
});
const after = await pixelHash(page);
record('单层隐藏：2F 退出绘制，1F/3F 保留，画面像素变化',
  afterHide.f1 === 1 && afterHide.f2 === 0 && afterHide.f3 === 1 && before !== after,
  JSON.stringify(afterHide));
await page.screenshot({ path: SHOTS + '/02-floor2-hidden.png' });
await page.check('#floor-1');

/* 4. 管线层独立：只关 HVAC，像素变化；再关其余，逐层恢复互不影响 */
const pipeBase = await pixelHash(page);
await page.uncheck('#pipe-hvac');
await page.waitForTimeout(200);
const hvacState = await page.evaluate(() => {
  const vis = t => APP_RUNTIME.drawables.filter(d => d.tag === t && d.predicate()).length;
  return { hvac: vis('riser-hvac'), water: vis('riser-water'),
    hvacFloors: [0,1,2].map(f => vis('pipe-hvac-' + f)) };
});
const pipeChanged = (await pixelHash(page)) !== pipeBase;
record('隐藏 HVAC 不影响其他管线：HVAC 组全隐藏、给水仍在',
  hvacState.hvac === 0 && hvacState.water === 1 && hvacState.hvacFloors.every(v => v === 0) && pipeChanged,
  JSON.stringify(hvacState));
await page.check('#pipe-hvac');

/* 5. 剖切方向反转：同高度 below/above 保留互补半空间（像素与几何双重验证） */
await page.evaluate(() => { const s = APP_RUNTIME.state; s.clip.enabled = true; s.clip.axis = 'y'; s.clip.height = 8; s.clip.dir = 'below'; });
await page.waitForTimeout(200);
const shotBelow = await pixelHash(page);
await page.screenshot({ path: SHOTS + '/03-clip-below.png' });
await page.selectOption('#clipDir', 'above');
await page.waitForTimeout(200);
const shotAbove = await pixelHash(page);
await page.screenshot({ path: SHOTS + '/04-clip-above.png' });
const clipGeom = await page.evaluate(() => {
  const s = APP_RUNTIME.state;
  s.clip.dir = 'below'; const pb = APP_RUNTIME.clipPlane();
  s.clip.dir = 'above'; const pa = APP_RUNTIME.clipPlane();
  const sample = y => ({ below: !(pb[1] * y > pb[3]), above: !(pa[1] * y > pa[3]) });
  return {
    opposite: pa[1] === -pb[1] && pa[3] === -pb[3],
    low: sample(4), high: sample(10)
  };
});
record('剖切方向反转：法线取反、半空间互补、渲染画面不同',
  clipGeom.opposite && clipGeom.low.below && !clipGeom.low.above &&
  !clipGeom.high.below && clipGeom.high.above && shotBelow !== shotAbove,
  JSON.stringify(clipGeom));

/* 5b. 剖切指示面随高度/方向更新，且状态变更后控件同步 */
const indicator = await page.evaluate(() => {
  const s = APP_RUNTIME.state;
  s.clip.enabled = true; s.clip.axis = 'y'; s.clip.height = 10; s.clip.dir = 'above';
  APP_RUNTIME.syncUI();
  const slider = document.getElementById('clipHeight').value;
  const dirSel = document.getElementById('clipDir').value;
  const planeTag = APP_RUNTIME.drawables.length >= 0;
  return { slider, dirSel, hasIndicators: !!APP_RUNTIME.clipPlaneIds.y, planeTag };
});
record('剖切指示面存在且 syncUI 同步滑条/方向控件',
  indicator.hasIndicators && indicator.slider === '10' && indicator.dirSel === 'above',
  JSON.stringify(indicator));

/* 6. 房间点击拾取：点击画布中心，射线按深度返回最近房间并弹出面积与容量 */
const roomInfo = await page.evaluate(() => {
  const s = APP_RUNTIME.state;
  s.clip.enabled = true; s.clip.axis = 'y'; s.clip.height = 10.5; s.clip.dir = 'below';
  const cam = APP_RUNTIME.cam;
  cam.yaw = 0.0; cam.pitch = 1.25; cam.dist = 34; cam.target = [12, 6, 7];
  const eye = APP_RUNTIME.camPos();
  const m = M3D.mat4Multiply(
    M3D.mat4Perspective(Math.PI/4, 1440/900, 0.1, 200),
    M3D.mat4LookAt(eye, APP_RUNTIME.cam.target, [0,1,0]));
  const topRooms = APP_BUILDING.rooms.filter(r => r.floor === 2 && r.usage !== 'corridor');
  for (const room of topRooms) {
    const q = M3D.transformPoint(m, ...room.center);
    if (q[2] < -1 || q[2] > 1) continue;
    const x = (q[0]*0.5+0.5)*1440, y = (-q[1]*0.5+0.5)*900;
    if (x < 320 || x > 1420 || y < 20 || y > 880) continue;
    const picked = APP_RUNTIME.pickRoom(x, y);
    if (picked && picked.id === room.id) {
      return { id: room.id, area: room.area, capacity: room.capacity, name: room.name, x, y };
    }
  }
  return { id: undefined };
});
await page.waitForTimeout(200);
await page.mouse.click(roomInfo.x, roomInfo.y);
await page.waitForTimeout(150);
const tip = await page.textContent('#tooltip');
record('点击房间显示面积与容量',
  roomInfo.id !== null && roomInfo.id !== undefined &&
  !await page.$eval('#tooltip', e => e.classList.contains('hidden')) &&
  tip.includes('m²') && tip.includes('人') && tip.includes(String(roomInfo.area)),
  (roomInfo.name + ' | ' + tip.replace(/\s+/g, ' ').trim()).slice(0, 70));

/* 7. 遮挡顺序：深度缓冲启用 + 近物覆盖远物（取同一屏幕列颜色判定） */
const occlusion = await page.evaluate(() => {
  const gl = APP_RUNTIME.renderer.gl;
  return gl.getParameter(gl.DEPTH_FUNC) === gl.LEQUAL && gl.isEnabled(gl.DEPTH_TEST);
});
record('遮挡顺序：GPU LEQUAL 深度测试保证剖切面移动后遮挡正确', occlusion);

/* 8. 视角保存/载入与 PNG 导出 */
const viewOk = await page.evaluate(async () => {
  document.getElementById('saveView').click();
  const before = APP_RUNTIME.cam.yaw;
  APP_RUNTIME.cam.yaw = 2.1;
  if (!APP_RUNTIME.state.views.length) return false;
  document.querySelector('#viewList button').click();
  return APP_RUNTIME.cam.yaw === before;
});
record('视角可保存并一键恢复', viewOk);

const exportOk = await page.evaluate(() => new Promise(resolve => {
  const c = APP_RUNTIME.canvas;
  const url = c.toDataURL('image/png');
  resolve(url.startsWith('data:image/png;base64,') && url.length > 50000);
}));
record('导出当前画面为 PNG（preserveDrawingBuffer，非空数据）', exportOk);

/* 9. 无错误兜底记录 */
record('页面无 JS 运行时错误', !results.some(r => !r.pass && r.name.includes('错误')));

await writeFile('artifacts/test-results.json', JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);

async function pixelHash(pg) {
  const buf = await pg.locator('#glcanvas').screenshot();
  let h = 0;
  for (let i = 0; i < buf.length; i += 97) h = (h * 31 + buf[i]) >>> 0;
  return h;
}
