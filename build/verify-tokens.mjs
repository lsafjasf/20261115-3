import { Resvg } from "@resvg/resvg-js";
import { ICON_NAMES } from "./icons.js";
import { standaloneSvg } from "./build.js";

function inkOf(svg) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 24 },
    background: "white",
  })
    .render()
    .asPng();
  const { decodePng } = require("./png.cjs");
  const { data, width, height, channels } = decodePng(png);
  let ink = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (channels === 4 ? data[i + 3] > 0 && data[i] < 200 : data[i] < 200) ink++;
  }
  return ink / (width * height);
}

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const base = {
  viewBox: 24,
  strokeWidth: 2,
  cornerRadius: 1.5,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
};

const scenarios = {
  "基线 sw=2 r=1.5": { defaults: base, overrides: {} },
  "全局加粗 sw=3": {
    defaults: { ...base, strokeWidth: 3 },
    overrides: {},
  },
  "全局大圆角 r=4": {
    defaults: { ...base, cornerRadius: 4 },
    overrides: {},
  },
  "全局加粗+局部铃铛覆盖 sw=1.5": {
    defaults: { ...base, strokeWidth: 3 },
    overrides: { bell: { strokeWidth: 1.5 } },
  },
};

const measure = {};
for (const [scenario, cfg] of Object.entries(scenarios)) {
  measure[scenario] = {};
  for (const name of ICON_NAMES) {
    measure[scenario][name] = Number(
      (inkOf(standaloneSvg(name, cfg.defaults, cfg.overrides)) * 100).toFixed(1),
    );
  }
}

console.log("24px 墨迹覆盖率 (%) 对照：\n");
console.table(measure);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    process.exitCode = 1;
  } else {
    console.log("PASS: " + msg);
  }
}

// 1. Global stroke change affects every icon.
const allGrew = ICON_NAMES.every(
  (n) => measure["全局加粗 sw=3"][n] > measure["基线 sw=2 r=1.5"][n],
);
assert(allGrew, "全局线宽 2→3 时，12 枚图标墨迹全部增加（联动生效）");

// 2. Global radius change changes a radius-driven icon's geometry.
const mailChanged =
  JSON.stringify(measure["全局大圆角 r=4"]) !==
  JSON.stringify(measure["基线 sw=2 r=1.5"]);
assert(mailChanged, "全局圆角 1.5→4 时，圆角类图标几何发生变化（联动生效）");

// 3. Local override isolates one icon from the global stroke change.
const bellOverride = measure["全局加粗+局部铃铛覆盖 sw=1.5"].bell;
const bellBase = measure["基线 sw=2 r=1.5"].bell;
const othersFollowGlobal = ICON_NAMES
  .filter((n) => n !== "bell")
  .every((n) => measure["全局加粗+局部铃铛覆盖 sw=1.5"][n] === measure["全局加粗 sw=3"][n]);
assert(
  bellOverride < bellBase && othersFollowGlobal,
  "局部覆盖后铃铛单独变细 (sw=1.5)，其余 11 枚仍跟随全局 sw=3",
);
