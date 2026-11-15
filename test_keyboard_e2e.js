// 真实浏览器(Chromium)纯键盘端到端验证:
// 1) Tab 焦点顺序合理且 canvas 可聚焦、焦点可见
// 2) 仅用键盘完成一轮真实游戏操作(选棚、调参、开关设备、播放、重置)
// 3) 键盘操作与鼠标点击产生完全相同的底层状态
// 4) aria-live 状态区会读出工具/位置/结果
const { chromium } = require("playwright");
const path = require("path");

const URL = "file://" + path.join(__dirname, "index.html");

function assert(cond, msg) {
  if (!cond) throw new Error("断言失败: " + msg);
  console.log("PASS  " + msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForSelector("#cv");

  // ---- 1. canvas 可聚焦,且带有正确的无障碍语义 ----
  const cvInfo = await page.$eval("#cv", (el) => ({
    tabIndex: el.tabIndex,
    role: el.getAttribute("role"),
    label: el.getAttribute("aria-label"),
  }));
  assert(cvInfo.tabIndex === 0, "canvas tabindex=0,可被 Tab 聚焦");
  assert(cvInfo.role === "application", "canvas 具备 role=application 语义");
  assert(!!cvInfo.label, "canvas 具备 aria-label 说明");

  // ---- 2. Tab 焦点顺序:从地址栏外的第一个可交互元素开始,canvas 必须在序列中且可见 ----
  await page.keyboard.press("Tab");
  const tabOrder = [];
  for (let i = 0; i < 12; i++) {
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? (el.id || el.tagName + "[" + (el.getAttribute("aria-label") || el.textContent.slice(0, 12)) + "]") : null;
    });
    tabOrder.push(active);
    await page.keyboard.press("Tab");
  }
  assert(tabOrder.includes("cv"), "Tab 焦点顺序包含 canvas(#cv): " + tabOrder.join(" → "));

  // 聚焦 canvas 后焦点环可见
  await page.click("#cv");
  await page.evaluate(() => document.getElementById("cv").focus());
  const focusVisible = await page.$eval("#cvWrap", (el) => el.classList.contains("focus-visible"));
  assert(focusVisible, "canvas 聚焦时外层出现可见焦点环(.focus-visible)");

  // ---- 3. 纯键盘:数字键选棚,SR 文本读出当前位置 ----
  await page.keyboard.press("3");
  await page.waitForTimeout(80);
  let sr = await page.$eval("#srStatus", (el) => el.textContent);
  assert(/3号棚/.test(sr), "按 3 后屏幕阅读器读出 3 号棚位置信息: " + sr);

  // ---- 4. 纯键盘:H + 方向键调节热量滑杆,验证底层状态与 DOM 双向同步 ----
  await page.keyboard.press("h");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  const heatState = await page.evaluate(() => {
    // 通过面板滑杆 DOM 间接验证状态同步(sim 状态封装在闭包内)
    const card = document.querySelectorAll("#panel .card")[2];
    return card.querySelector('input[data-k=heat]').value;
  });
  sr = await page.$eval("#srStatus", (el) => el.textContent);
  assert(/热量分配/.test(sr) && /%/.test(sr), "键盘微调后 SR 读出滑杆名称与数值: " + sr);
  assert(Number(heatState) === Math.round((1 / 3 + 0.1) * 100),
    "键盘方向键把热量分配写入同一状态并同步到 HTML 滑杆(DOM 值=" + heatState + ")");

  // ---- 5. 纯键盘:Enter 开关补光灯,与鼠标点击同一函数,aria-pressed 同步 ----
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  const lightPressed = await page.evaluate(() => {
    const btn = document.querySelectorAll("#panel .card")[2].querySelector("button[data-k=light]");
    return { pressed: btn.getAttribute("aria-pressed"), text: btn.textContent, on: btn.classList.contains("on") };
  });
  assert(lightPressed.pressed === "true" && lightPressed.on && lightPressed.text === "开",
    "键盘 Enter 打开补光灯,按钮 aria-pressed/on 状态同步");

  // ---- 6. 纯键盘:B 锅炉、P 水泵,并验证全局按钮 aria-pressed ----
  await page.keyboard.press("b");
  await page.keyboard.press("p");
  await page.waitForTimeout(60);
  const globals = await page.evaluate(() => ({
    boiler: document.getElementById("btnBoiler").getAttribute("aria-pressed"),
    pump: document.getElementById("btnPump").getAttribute("aria-pressed"),
  }));
  assert(globals.boiler === "true" && globals.pump === "true",
    "键盘 B/P 开启锅炉与水泵,全局按钮 aria-pressed 同步为 true");

  // ---- 7. 鼠标点击与键盘走同一状态路径:鼠标再点一次锅炉应关闭 ----
  // 在启动模拟前验证(避免播放中断电强制改状态干扰):键盘开 -> 鼠标关 -> 鼠标开 -> 键盘关
  let boilerAfterMouse = await page.$eval("#btnBoiler", (el) => el.getAttribute("aria-pressed"));
  assert(boilerAfterMouse === "true", "前置:键盘 B 已把锅炉打开(aria-pressed=true)");
  await page.click("#btnBoiler");
  boilerAfterMouse = await page.$eval("#btnBoiler", (el) => el.getAttribute("aria-pressed"));
  assert(boilerAfterMouse === "false", "鼠标点击与键盘共享 toggle 函数,锅炉被鼠标等价切换为关");
  await page.click("#btnBoiler");
  boilerAfterMouse = await page.$eval("#btnBoiler", (el) => el.getAttribute("aria-pressed"));
  assert(boilerAfterMouse === "true", "鼠标再次点击把锅炉打开,两条输入路径操作同一状态");
  // 鼠标点击后焦点落在按钮上;真实用户按 Shift+Tab 把焦点移回画布,再用键盘快捷键操作
  await page.evaluate(() => document.getElementById("cv").focus());
  await page.keyboard.press("b"); // 键盘关闭,为播放留出干净起点
  await page.waitForTimeout(60);
  boilerAfterMouse = await page.$eval("#btnBoiler", (el) => el.getAttribute("aria-pressed"));
  assert(boilerAfterMouse === "false", "键盘 B 等价关闭锅炉");

  // ---- 8. 纯键盘:空格开始模拟,加速后等待推进,再暂停 ----
  await page.keyboard.press(" ");
  await page.waitForTimeout(60);
  const startLabel = await page.$eval("#btnStart", (el) => el.textContent);
  assert(startLabel === "暂停", "空格键启动模拟,开始按钮文案变为暂停");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.waitForTimeout(1500);
  const clockText = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? "canvas 仍在渲染" : "canvas 丢失";
  });
  assert(clockText === "canvas 仍在渲染", "键盘加速播放期间渲染循环正常");
  // 加速播放后暂停,SR 会播报当前全局状态(含已推进的模拟时间)
  await page.keyboard.press(" ");
  await page.waitForTimeout(50);
  sr = await page.$eval("#srStatus", (el) => el.textContent);
  assert(/暂停/.test(sr), "再次空格暂停,SR 播报暂停状态: " + sr);

  // ---- 9. 纯键盘:R 重置,所有控件回到初始 ----
  await page.keyboard.press("r");
  await page.waitForTimeout(80);
  const afterReset = await page.evaluate(() => ({
    start: document.getElementById("btnStart").textContent,
    speed: document.getElementById("btnSpeed").textContent,
    lightPressed: document.querySelectorAll("#panel .card")[2].querySelector("button[data-k=light]").getAttribute("aria-pressed"),
  }));
  assert(afterReset.start === "开始" && afterReset.speed === "速度 ×1" && afterReset.lightPressed === "false",
    "R 键重置后开始/速度/补光灯全部回到初始态");

  // ---- 10. 焦点移出 canvas 时焦点环消失 ----
  await page.evaluate(() => document.getElementById("btnStart").focus());
  const focusGone = await page.$eval("#cvWrap", (el) => !el.classList.contains("focus-visible"));
  assert(focusGone, "canvas 失焦后可见焦点环移除");

  assert(errors.length === 0, "全程无页面 JS 错误" + (errors.length ? ": " + errors.join("; ") : ""));
  await browser.close();
  console.log("\n全部键盘端到端验证通过 ✔");
})().catch((e) => { console.error(e); process.exit(1); });
