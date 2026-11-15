const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ART = path.join(__dirname, "artifacts");
fs.mkdirSync(ART, { recursive: true });

// ---------- color helpers ----------
function parseColor(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}
function luminance({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function blendOver(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}
function contrast(c1, c2) {
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const results = { themes: {}, focusTraversal: {}, layoutCheck: {}, failures: [] };

function check(name, ok, detail) {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  if (!ok) results.failures.push(line);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto("file://" + path.join(__dirname, "components.html"));

  const layoutSignatures = {};

  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(50);

    // ---- 1. preview screenshot ----
    await page.screenshot({
      path: path.join(ART, `preview-${theme}.png`),
      fullPage: true,
    });

    // ---- 2. layout signature (must be identical across themes) ----
    layoutSignatures[theme] = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll(".panel, .row, .btn, .switch, .tag, .slider").forEach((el) => {
        const r = el.getBoundingClientRect();
        out.push([el.className, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","));
      });
      return out;
    });

    // ---- 3. contrast checks on computed styles ----
    const colors = await page.evaluate(() => {
      const cs = (sel, prop) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      return {
        bodyBg: cs("body", "backgroundColor"),
        text: cs("body", "color"),
        muted: cs(".state-name", "color"),
        primaryBg: cs(".btn-primary", "backgroundColor"),
        primaryFg: cs(".btn-primary", "color"),
        secondaryFg: cs(".btn-secondary", "color"),
        surface: cs(".panel", "backgroundColor"),
        tagBg: cs(".tag", "backgroundColor"),
        tagFg: cs(".tag", "color"),
        focusRing: getComputedStyle(document.documentElement).getPropertyValue("--focus-ring").trim(),
      };
    });
    const hexToRgb = (h) => {
      const n = parseInt(h.slice(1), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    };
    const bg = parseColor(colors.bodyBg);
    const surface = parseColor(colors.surface);
    const ring = colors.focusRing.startsWith("#") ? hexToRgb(colors.focusRing) : parseColor(colors.focusRing);
    const pairs = [
      ["正文文字/页面背景", parseColor(colors.text), bg, 4.5],
      ["次要文字/页面背景", parseColor(colors.muted), surface, 4.5],
      ["主按钮文字/按钮底色", parseColor(colors.primaryFg), parseColor(colors.primaryBg), 4.5],
      ["次按钮文字/面板背景", parseColor(colors.secondaryFg), surface, 4.5],
      ["标签文字/标签底色", parseColor(colors.tagFg), parseColor(colors.tagBg), 4.5],
      ["焦点环/面板背景(非文字)", ring, surface, 3.0],
      ["焦点环/页面背景(非文字)", ring, bg, 3.0],
    ];
    results.themes[theme] = { contrast: {} };
    for (const [name, fg, bgc, min] of pairs) {
      const ratio = contrast(blendOver(fg, bgc), bgc);
      results.themes[theme].contrast[name] = +ratio.toFixed(2);
      check(`[${theme}] 对比度 ${name}`, ratio >= min, `${ratio.toFixed(2)}:1 (要求 ≥ ${min}:1)`);
    }
  }

  // ---- layout identical across themes ----
  const sameLayout =
    JSON.stringify(layoutSignatures.light) === JSON.stringify(layoutSignatures.dark);
  results.layoutCheck.identical = sameLayout;
  check("主题切换后布局完全一致", sameLayout,
    `${layoutSignatures.light.length} 个元素的几何签名比对`);

  // ---- 4. real keyboard traversal (Tab) in both themes ----
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.locator("#playground").scrollIntoViewIfNeeded();

    const collectFocus = async () => {
      return await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        // switch: focus ring lands on the .track sibling
        let ringEl = el;
        if (el.matches(".switch input")) ringEl = el.nextElementSibling;
        const rcs = getComputedStyle(ringEl);
        return {
          key: el.dataset.kb || el.id || el.className,
          tag: el.tagName.toLowerCase(),
          outlineStyle: rcs.outlineStyle,
          outlineWidth: rcs.outlineWidth,
          outlineColor: rcs.outlineColor,
          boxShadow: rcs.boxShadow,
        };
      });
    };

    // reset sequential focus navigation to the top of the page,
    // then traverse purely by keyboard (Tab)
    await page.mouse.click(2, 2);
    await page.evaluate(() => {
      if (document.activeElement) document.activeElement.blur();
    });
    const visited = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const info = await collectFocus();
      if (!info) break;
      visited.push(info);
      if (info.key === "slider") break; // last expected stop
    }

    results.focusTraversal[theme] = visited;
    const expected = ["themeToggle", "btn-primary", "btn-secondary", "switch", "tag-remove", "slider"];
    const gotKeys = visited.map((v) => v.key);
    const allExpected = expected.every((k) => gotKeys.includes(k));
    check(`[${theme}] Tab 遍历覆盖全部 6 类交互组件`, allExpected, gotKeys.join(" -> "));

    for (const v of visited) {
      const w = parseFloat(v.outlineWidth);
      const visible =
        (v.outlineStyle === "solid" && w >= 2 && v.outlineColor !== "rgba(0, 0, 0, 0)") ||
        (v.boxShadow && v.boxShadow !== "none");
      check(`[${theme}] 焦点可见: ${v.key}`, visible,
        `outline ${v.outlineWidth} ${v.outlineStyle} ${v.outlineColor}`);
    }

    // focus ring contrast vs page background (WCAG 1.4.11, >= 3:1)
    const ringCheck = await page.evaluate(() => {
      const ring = getComputedStyle(document.documentElement).getPropertyValue("--focus-ring").trim();
      const bg = getComputedStyle(document.body).backgroundColor;
      return { ring, bg };
    });
    const toRgb = (c) =>
      c.startsWith("#")
        ? (() => { const n = parseInt(c.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; })()
        : parseColor(c);
    const ratio = contrast(toRgb(ringCheck.ring), toRgb(ringCheck.bg));
    check(`[${theme}] 焦点环对比度 ≥ 3:1`, ratio >= 3, `${ratio.toFixed(2)}:1`);

    // slider responds to arrow keys while focused
    await page.locator('[data-kb="slider"]').focus();
    const before = await page.locator('[data-kb="slider"]').inputValue();
    await page.keyboard.press("ArrowRight");
    const after = await page.locator('[data-kb="slider"]').inputValue();
    check(`[${theme}] 滑杆方向键可调`, Number(after) === Number(before) + 1, `${before} -> ${after}`);

    // switch toggles with Space
    await page.locator('[data-kb="switch"]').focus();
    const wasChecked = await page.locator('[data-kb="switch"]').isChecked();
    await page.keyboard.press("Space");
    const nowChecked = await page.locator('[data-kb="switch"]').isChecked();
    check(`[${theme}] 开关空格键切换`, wasChecked !== nowChecked, `${wasChecked} -> ${nowChecked}`);
  }

  // screenshot of a focused element as visual evidence
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.locator('[data-kb="btn-primary"]').focus();
  await page.locator("#playground").screenshot({ path: path.join(ART, "focus-evidence-light.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.locator('[data-kb="switch"]').focus();
  await page.locator("#playground").screenshot({ path: path.join(ART, "focus-evidence-dark.png") });

  // ---- 5. export styles.json (tokens + per-state component styles, both themes) ----
  const stylesJson = { meta: { tool: "NovaDesk", generated: new Date().toISOString() }, themes: {} };
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(300); // let CSS transitions settle before sampling
    const data = await page.evaluate(() => {
      const vars = {};
      const rootStyle = getComputedStyle(document.documentElement);
      for (const name of ["--bg","--surface","--surface-2","--text","--text-muted","--border",
        "--primary","--primary-hover","--primary-active","--on-primary","--track-off",
        "--focus-ring","--danger","--tag-bg","--tag-text","--radius"]) {
        vars[name] = rootStyle.getPropertyValue(name).trim();
      }
      const pick = (el, props) => {
        const cs = getComputedStyle(el);
        const out = {};
        for (const p of props) out[p] = cs[p];
        return out;
      };
      const BTN_PROPS = ["backgroundColor","color","borderColor","borderRadius","outlineColor"];
      const stateOf = (sel) => pick(document.querySelector(sel), BTN_PROPS);
      return {
        tokens: vars,
        components: {
          buttonPrimary: {
            normal: stateOf("#gallery-buttons .row:nth-of-type(1) .btn-primary"),
            hover: stateOf("#gallery-buttons .btn-primary.is-hover"),
            pressed: stateOf("#gallery-buttons .btn-primary.is-active"),
            disabled: stateOf("#gallery-buttons .btn-primary[disabled]"),
            focus: stateOf("#gallery-buttons .btn-primary.is-focus"),
          },
          buttonSecondary: {
            normal: stateOf("#gallery-buttons .row:nth-of-type(1) .btn-secondary"),
            hover: stateOf("#gallery-buttons .btn-secondary.is-hover"),
            pressed: stateOf("#gallery-buttons .btn-secondary.is-active"),
            disabled: stateOf("#gallery-buttons .btn-secondary[disabled]"),
            focus: stateOf("#gallery-buttons .btn-secondary.is-focus"),
          },
          switch: {
            trackOff: pick(document.querySelector("#gallery-switches .track"),
              ["backgroundColor","borderRadius","width","height"]),
            trackOn: (() => {
              const on = document.querySelector("#gallery-switches input:checked + .track");
              return pick(on, ["backgroundColor"]);
            })(),
          },
          tag: pick(document.querySelector(".tag"),
            ["backgroundColor","color","borderRadius","fontSize","fontWeight"]),
          fieldLabel: pick(document.querySelector(".field-label"), ["color","fontWeight"]),
          slider: {
            track: pick(document.querySelector("#gallery-sliders .slider"),
              ["backgroundColor","borderColor","borderRadius","height"]),
            focusOutline: pick(document.querySelector("#gallery-sliders .slider.is-focus"),
              ["outlineColor","outlineWidth","outlineStyle"]),
          },
        },
      };
    });
    stylesJson.themes[theme] = data;
  }
  fs.writeFileSync(path.join(ART, "styles.json"), JSON.stringify(stylesJson, null, 2));

  // ---- 6. report ----
  fs.writeFileSync(path.join(ART, "verification-report.json"), JSON.stringify(results, null, 2));
  await browser.close();

  console.log("\n===== 汇总 =====");
  console.log(`失败项: ${results.failures.length}`);
  if (results.failures.length) {
    results.failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("全部检查通过 ✅");
})();
