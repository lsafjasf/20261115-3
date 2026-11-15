// 全局几何与仿真常量（世界坐标单位：米，时间单位：秒）
export const WORLD = {
  width: 1100,          // 画布逻辑宽（世界单位即像素，1px = 1m）
  height: 560,
  roadY: 280,           // 主干道中心线
  laneW: 14,            // 车道宽
  nbLane: 273,          // 北行（向上）车道中心
  sbLane: 287,          // 南行（向下）车道中心
  minorX: 480,          // 十字路口（支路）中心
  stopEB: 470,          // 东行停车线
  stopWB: 490,          // 西行停车线
  stopNB: 270,          // 北行停车线（支路，从南向北）
  stopSB: 290,          // 南行停车线
  crosswalkW: 9,        // 人行横道（学校）宽度
  schoolX: 760,
  schoolNorth: 252,     // 北侧行人集结区
  schoolSouth: 308,     // 南侧行人集结区
  mainMinX: 20,
  mainMaxX: 1080,
  vMin: -120,           // 支路北端
  vMax: 680,            // 支路南端
  carLen: 5,
  busLen: 11,
  vFree: 13.9,          // 期望车速 ≈ 50km/h
  vPed: 2.4,           // 行人过街速度（含小跑）
  dt: 0.25,             // 固定仿真步长
  simMinutes: 20,
};

// 各车道中心：东行 EB（由西向东，南侧 y=287）；西行 WB（北侧 y=273）
export const LANE_Y = { EB: 287, WB: 273 };

// 目标阈值（20 分钟模拟结束时判定）
export const THRESHOLDS = {
  avgWait: 18,          // 平均等待时间（秒，含入口源头排队）
  maxQueue: 14,         // 最大排队（辆）
};

// 可调整参数的取值范围（供 UI 与校验共用）
export const RANGES = {
  gMain: [18, 90],
  gSide: [8, 45],
  gPed: [6, 40],
  busStopX: [540, 980],
  detourPct: [0, 60],
};

// 默认（次优）配置：初始故意造成连锁拥堵
export const DEFAULT_CONFIG = {
  gMain: 55,
  gSide: 12,
  gPed: 8,             // 短于过街所需 10s → 行人滞留到下一相位，埋下人车冲突
  busStopX: 560,        // 公交站紧贴路口下游，停靠会回堵到路口
  detourPct: 0,
  riskPed: false,       // 错误放行：行人与机动车同时绿灯
};

// 推荐配置（用于「局部调整」验证与一键建议）
export const BETTER_CONFIG = {
  gMain: 32,
  gSide: 14,
  gPed: 12,            // 大于过街时间(10s)，行人可在相位内清空
  busStopX: 900,        // 公交站移到学校下游，停靠不再截断路口-学校段
  detourPct: 55,        // 过半东行需求走南侧临时绕行，削减路口与公交站压力
  riskPed: false,
};

// 公交专用停靠时长（秒）
export const BUS_DWELL = 30;
export const BUS_HEADWAY = 100;   // 公交发车间隔
export const ALL_RED = 2;         // 相位切换全红清空时间

// 需求生成（20 分钟）—— 固定随机种子保证 A/B 公平对比
export const DEMAND = {
  seed: 20261115,
  // 各时段每小时流量，含学校上下学高峰
  waves: [
    { t0: 0, t1: 240, eb: 640, wb: 570, side: 200, ped: 70 },
    { t0: 240, t1: 480, eb: 900, wb: 810, side: 230, ped: 280 }, // 上学高峰
    { t0: 480, t1: 780, eb: 710, wb: 660, side: 210, ped: 110 },
    { t0: 780, t1: 1020, eb: 970, wb: 880, side: 260, ped: 310 }, // 放学高峰
    { t0: 1020, t1: 1200, eb: 660, wb: 600, side: 200, ped: 80 },
  ],
  busEB: 3600 / BUS_HEADWAY, // 东行公交每小时约 26 辆
};
