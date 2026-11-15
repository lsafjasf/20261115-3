// 验证脚本：检查拼贴工程在“重排”前后均不遮挡主标题安全区。
// 运行：node verify.mjs [工程文件路径]
import { readFileSync, writeFileSync } from "node:fs";
import { STAGE, SAFE_ZONE, findSafeZoneViolations, rotatedCorners } from "./js/geometry.js";

const projectPath = process.argv[2] || "artifacts/collage-project.json";
const project = JSON.parse(readFileSync(projectPath, "utf8"));

let failures = 0;
function check(label, cond, detail = "") {
  const ok = Boolean(cond);
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

function inStage(layer) {
  return rotatedCorners(layer).every(
    (p) => p.x >= 0 && p.x <= STAGE.width && p.y >= 0 && p.y <= STAGE.height
  );
}

// 1) 自检：把图层移进安全区，检测器必须报警
const intruder = {
  ...project.layers[0],
  id: "__test__",
  x: SAFE_ZONE.x + SAFE_ZONE.width / 2,
  y: SAFE_ZONE.y + SAFE_ZONE.height / 2,
  rotation: 15,
};
check(
  "检测器自检：安全区内的图层被识别",
  findSafeZoneViolations([intruder]).includes("__test__")
);

// 2) 当前拼贴不遮挡标题
const hitsBefore = findSafeZoneViolations(project.layers);
check("当前拼贴不遮挡主标题安全区", hitsBefore.length === 0, hitsBefore.join(","));

// 3) 所有图层都在舞台范围内
check(
  "所有图层均在舞台范围内",
  project.layers.every(inStage)
);

// 4) 模拟一次重排：交换层级顺序 + 移动/旋转/缩放各图层
const rearranged = project.layers.map((l) => ({ ...l, crop: { ...l.crop } })).reverse();
const moves = {
  sunset: { x: 250, y: 410, rotation: -4, scale: 0.68 },
  night: { x: 500, y: 498, rotation: -3, scale: 0.52 },
  geometry: { x: 700, y: 395, rotation: 7, scale: 0.55 },
};
for (const layer of rearranged) Object.assign(layer, moves[layer.id] || {});

const hitsAfter = findSafeZoneViolations(rearranged);
check("重排后不遮挡主标题安全区", hitsAfter.length === 0, hitsAfter.join(","));
check("重排后所有图层仍在舞台范围内", rearranged.every(inStage));

// 5) 重排结果写回工程文件（保留裁切与透明度字段）
if (hitsAfter.length === 0) {
  const out = { ...project, layers: rearranged };
  writeFileSync(projectPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n重排结果已写回 ${projectPath}`);
  for (const l of rearranged) {
    console.log(
      `  · ${l.name}: 位置(${l.x},${l.y}) 旋转${l.rotation}° 缩放${l.scale} ` +
        `透明度${l.opacity} 裁切[${l.crop.x},${l.crop.y} ${l.crop.w}×${l.crop.h}]`
    );
  }
}

if (failures) {
  console.error(`\n${failures} 项检查失败`);
  process.exit(1);
}
console.log("\n全部检查通过：重排未遮挡主标题安全区。");
