export const WORLD = { width: 1200, height: 720 };
export const FIELD = {
  x: 960,
  y: 350,
  terminalRadius: 210,
  runway: { x1: 900, y1: 350, x2: 1120, y2: 350 }
};

export const SEPARATION = 62;
export const RELEASE_GAP = 5.6;
export const FUEL_RESERVE = 18;
export const MAX_TIME = 150;
export const SPEEDS = {
  slow: { value: 18, label: "节油", burn: 0.78 },
  normal: { value: 25, label: "标准", burn: 1 },
  fast: { value: 32, label: "优先", burn: 1.3 }
};

export const WEATHER = {
  id: "CB-04",
  corridor: "alpha",
  start: 16,
  end: 54,
  center: { x: 470, y: 128 },
  radius: 190,
  label: "对流云团锁闭 ALPHA"
};

export const TFR = {
  id: "TFR-12",
  start: 24,
  end: 68,
  center: { x: 782, y: 352 },
  radius: 108,
  label: "地勤车队穿越 FINAL"
};

export const EVENTS = [
  { id: "weather-on", time: WEATHER.start, label: "ALPHA 天气关闭", tone: "weather" },
  { id: "tfr-on", time: TFR.start, label: "临时净空区激活", tone: "danger" },
  { id: "weather-off", time: WEATHER.end, label: "ALPHA 天气转好", tone: "weather" },
  { id: "tfr-off", time: TFR.end, label: "净空区解除", tone: "safe" }
];

function buildRoute(id, label, points, holdIndex, fafIndex) {
  let total = 0;
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
    lengths.push(total);
  }
  return {
    id,
    label,
    points,
    lengths,
    total,
    holdDist: lengths[holdIndex],
    holdPoint: points[holdIndex],
    fafDist: lengths[fafIndex],
    fafPoint: points[fafIndex],
    landDist: total
  };
}

const ALPHA_POINTS = [
  { x: 30, y: 100 },
  { x: 180, y: 100 },
  { x: 320, y: 135 },
  { x: 470, y: 185 },
  { x: 560, y: 220 },
  { x: 650, y: 270 },
  { x: 740, y: 315 },
  { x: 830, y: 350 },
  { x: 930, y: 350 },
  { x: 1070, y: 350 }
];

const BRAVO_POINTS = [
  { x: 500, y: 710 },
  { x: 550, y: 680 },
  { x: 605, y: 630 },
  { x: 640, y: 570 },
  { x: 655, y: 520 },
  { x: 680, y: 470 },
  { x: 730, y: 420 },
  { x: 780, y: 385 },
  { x: 830, y: 350 },
  { x: 930, y: 350 },
  { x: 1070, y: 350 }
];

export const ROUTES = {
  alpha: buildRoute("alpha", "ALPHA", ALPHA_POINTS, 4, 7),
  bravo: buildRoute("bravo", "BRAVO", BRAVO_POINTS, 4, 8)
};

export const AIRCRAFT = [
  {
    id: "U01",
    name: "苔原",
    type: "HX-4 / 冷链",
    route: "alpha",
    launch: 0,
    startFuel: 50,
    color: "#f5c95e",
    config: { speed: "fast", radius: 42, priority: 1 }
  },
  {
    id: "U02",
    name: "沙丘",
    type: "HX-4 / 医疗",
    route: "alpha",
    launch: 10,
    startFuel: 72,
    color: "#75d5c5",
    config: { speed: "slow", radius: 42, priority: 4 }
  },
  {
    id: "U03",
    name: "雨燕",
    type: "HX-4 / 备件",
    route: "bravo",
    launch: 10,
    startFuel: 90,
    color: "#9caef7",
    config: { speed: "slow", radius: 42, priority: 2 }
  },
  {
    id: "U04",
    name: "铁杉",
    type: "HX-4 / 电池",
    route: "bravo",
    launch: 15,
    startFuel: 97,
    color: "#f39a7d",
    config: { speed: "slow", radius: 42, priority: 3 }
  }
];

export const WRONG_PRIORITIES = {
  U01: { priority: 4 },
  U02: { priority: 3 },
  U03: { priority: 2 },
  U04: { priority: 1 }
};

export const SCENARIO = {
  id: "SCN-04 / 晨雾窗口",
  title: "四机 · 双走廊进近",
  subtitle: "两条进港走廊、单跑道终端区、固定事件窗口",
  seed: "20261115-3",
  world: WORLD,
  field: FIELD,
  weather: WEATHER,
  tfr: TFR,
  events: EVENTS,
  routes: ROUTES,
  aircraft: AIRCRAFT
};

export function pointAt(route, distance) {
  const clamped = Math.max(0, Math.min(distance, route.total));
  for (let i = 1; i < route.lengths.length; i += 1) {
    if (clamped <= route.lengths[i]) {
      const start = route.points[i - 1];
      const end = route.points[i];
      const length = route.lengths[i] - route.lengths[i - 1];
      const t = length === 0 ? 0 : (clamped - route.lengths[i - 1]) / length;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        heading: Math.atan2(end.y - start.y, end.x - start.x)
      };
    }
  }
  const last = route.points.at(-1);
  return { x: last.x, y: last.y, heading: 0 };
}

export function cloneConfig(overrides = {}) {
  return AIRCRAFT.map((plane) => ({
    id: plane.id,
    ...plane.config,
    ...(overrides[plane.id] || {})
  }));
}
