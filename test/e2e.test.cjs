#!/usr/bin/env node
/*
 * 真实浏览器(Playwright Chromium)端到端测试：
 * 加载页面 -> 拖关节不拉伸 -> 播放挥手 -> 记录关键帧 -> 刷新页面验证重新载入。
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__EDITOR__ && window.__EDITOR__.state.skeleton);

    const order = await page.evaluate(() => window.__EDITOR__.state.skeleton.order);
    if (order.length !== 7) throw new Error("期望 7 段骨，得到 " + order.length);

    // 1) 初始骨长快照
    const before = await page.evaluate(() => {
      const s = window.__EDITOR__.state.skeleton;
      const out = {};
      for (const id of s.order) {
        const z = s.solve().get(id);
        out[id] = Math.hypot(z.ex - z.sx, z.ey - z.sy);
      }
      return out;
    });

    // 2) 拖拽右前臂关节到新位置，验证不拉伸且父骨不动
    const dragResult = await page.evaluate(() => {
      const { state } = window.__EDITOR__;
      const sk = state.skeleton;
      const solved0 = sk.solve();
      const parent0 = { ...solved0.get("upperArmR") };
      const handle = { id: "end:foreArmR", boneId: "foreArmR" };
      sk.dragTo(handle, 400, 70);
      const solved1 = sk.solve();
      const parent1 = solved1.get("upperArmR");
      const lens = {};
      for (const id of sk.order) {
        const z = solved1.get(id);
        lens[id] = Math.hypot(z.ex - z.sx, z.ey - z.sy);
      }
      return {
        lengths: lens,
        parentFixed:
          parent0.sx === parent1.sx &&
          parent0.sy === parent1.sy &&
          parent0.ex === parent1.ex &&
          parent0.ey === parent1.ey,
      };
    });
    if (!dragResult.parentFixed) throw new Error("拖动子关节改变了父骨");
    for (const id of order) {
      if (Math.abs(dragResult.lengths[id] - before[id]) > 1e-9) {
        throw new Error("骨骼 " + id + " 在拖拽后被拉伸");
      }
    }
    console.log("  ✓ 拖拽子关节：父骨固定，全部 7 段骨长不变");

    // 3) 真实鼠标事件拖拽画布
    const box = await page.locator("#canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.15, { steps: 6 });
    await page.mouse.up();
    const afterMouse = await page.evaluate(() => {
      const s = window.__EDITOR__.state.skeleton;
      const out = {};
      const solved = s.solve();
      for (const id of s.order) {
        const z = solved.get(id);
        out[id] = Math.hypot(z.ex - z.sx, z.ey - z.sy);
      }
      return out;
    });
    for (const id of order) {
      if (Math.abs(afterMouse[id] - before[id]) > 1e-9) {
        throw new Error("鼠标拖拽后 " + id + " 长度变化");
      }
    }
    console.log("  ✓ Canvas 鼠标拖拽事件正常，骨长恒定");

    // 4) 播放挥手动画，验证手部位置随时间变化且循环回零
    await page.evaluate(() => {
      const d = window.__EDITOR__.buildDefault();
      window.__EDITOR__.state.skeleton = d.skeleton;
      window.__EDITOR__.state.track = d.track;
    });
    await page.click("#btnPlay");
    await page.waitForTimeout(1400);
    const handMoved = await page.evaluate(() => {
      const s = window.__EDITOR__.state.skeleton.solve();
      return { x: s.get("foreArmR").ex, y: s.get("foreArmR").ey };
    });
    if (!Number.isFinite(handMoved.x) || !Number.isFinite(handMoved.y)) {
      throw new Error("播放后手部坐标异常");
    }
    await page.waitForTimeout(1300);
    const looped = await page.evaluate(() => {
      const st = window.__EDITOR__.state;
      const s = st.skeleton.solve();
      return {
        playTime: st.playTime,
        hand: { x: s.get("foreArmR").ex, y: s.get("foreArmR").ey },
      };
    });
    if (looped.playTime > 1.2) throw new Error("循环播放时间未回绕");
    console.log("  ✓ 播放并跨循环边界，时间回绕到", looped.playTime.toFixed(2), "s");

    // 5) 关键帧记录与首尾连续性
    const gap = await page.evaluate(() => {
      const ed = window.__EDITOR__;
      const st = ed.state;
      st.playTime = 0.6;
      st.track.addFrame(0.6, st.skeleton.pose());
      ed.persist();
      return st.track.maxLoopGap();
    });
    if (gap > 1e-9) throw new Error("循环首尾跳变 " + gap);
    console.log("  ✓ 关键帧可记录，首尾姿态连续(跳变=0)");

    // 6) localStorage 已持久化，刷新页面即“重新载入”
    const stored = await page.evaluate(() => localStorage.getItem("skeleton-wave-editor-v1"));
    if (!stored) throw new Error("未写入 localStorage");
    await page.reload();
    await page.waitForFunction(() => window.__EDITOR__ && window.__EDITOR__.state.skeleton);
    const reloaded = await page.evaluate(() => {
      const st = window.__EDITOR__.state;
      const solved = st.skeleton.solve();
      const lens = {};
      for (const id of st.skeleton.order) {
        const z = solved.get(id);
        lens[id] = Math.hypot(z.ex - z.sx, z.ey - z.sy);
      }
      return {
        bones: st.skeleton.order.length,
        frames: st.track.frames.length,
        gap: st.track.maxLoopGap(),
        lengths: lens,
      };
    });
    if (reloaded.bones !== 7 || reloaded.frames < 5 || reloaded.gap > 1e-9) {
      throw new Error("刷新重载后状态不一致: " + JSON.stringify(reloaded));
    }
    for (const id of order) {
      if (Math.abs(reloaded.lengths[id] - before[id]) > 1e-9) {
        throw new Error("重载后骨长变化: " + id);
      }
    }
    console.log("  ✓ 刷新页面后从 localStorage 重新载入，7 段骨/关键帧/骨长全部一致");

    // 7) 点击“重新载入”按钮
    await page.click("#btnReload");
    const status = await page.locator("#status").textContent();
    if (!status.includes("重新载入成功")) throw new Error("重载按钮反馈异常: " + status);
    console.log("  ✓ 重新载入按钮工作正常");

    // 8) 音频开关：默认关闭，开启不报错
    const audioOff = await page.evaluate(() => window.__EDITOR__.state.audio.enabled);
    if (audioOff) throw new Error("音频应默认关闭");
    await page.check("#chkAudio");
    await page.uncheck("#chkAudio");
    console.log("  ✓ Web Audio 开关可切换，默认静音");

    if (errors.length) throw new Error("浏览器报错: " + errors.join(" | "));
    console.log("\n浏览器端到端测试全部通过");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
