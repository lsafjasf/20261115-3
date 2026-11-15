export const WORLD = Object.freeze({
  width: 2800,
  height: 1700,
  centerX: 1400,
  centerY: 850,
  name: "北境区域图",
  subtitle: "NORTH REACH · SEED 475",
});

export const COLORS = Object.freeze({
  ocean: "#7fa9ad",
  oceanDeep: "#5e8e95",
  oceanLight: "#a6c6c4",
  land: "#dfd9c5",
  landLight: "#eae4d1",
  landWarm: "#d8cfb6",
  ink: "#183d37",
  inkSoft: "#44675e",
  border: "#a9523b",
  borderLight: "#e3a584",
  contour: "#b5ad94",
  forest: "#6b8d72",
  river: "#5d9098",
  coral: "#cf674a",
});

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBlob({ cx, cy, rx, ry, seed, count = 112, roughness = 1 }) {
  const random = mulberry32(seed);
  const phase = random() * Math.PI * 2;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const wobble =
      1 +
      0.085 * Math.sin(angle * 3 + phase) +
      0.042 * Math.sin(angle * 7 - phase * 0.7) +
      0.024 * Math.sin(angle * 13 + phase * 1.9) +
      (random() - 0.5) * 0.018 * roughness;
    points.push({
      x: cx + Math.cos(angle) * rx * wobble,
      y: cy + Math.sin(angle) * ry * wobble,
      angle,
    });
  }
  return points;
}

function makeCoastUnderlay(points, distance, offset = 0) {
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const length = Math.hypot(tx, ty) || 1;
    const outward = 1 + offset;
    return {
      x: point.x + (ty / length) * distance * outward,
      y: point.y + (-tx / length) * distance * outward,
    };
  });
}

const mainlandPoints = makeBlob({
  cx: 1460,
  cy: 1000,
  rx: 1040,
  ry: 485,
  seed: 475,
  count: 144,
  roughness: 1.25,
});

const northIslandPoints = makeBlob({
  cx: 968,
  cy: 390,
  rx: 285,
  ry: 132,
  seed: 209,
  count: 82,
  roughness: 0.8,
});

const eastIslandPoints = makeBlob({
  cx: 2308,
  cy: 384,
  rx: 264,
  ry: 172,
  seed: 811,
  count: 78,
  roughness: 0.8,
});

const southIslandPoints = makeBlob({
  cx: 547,
  cy: 1222,
  rx: 118,
  ry: 74,
  seed: 154,
  count: 64,
  roughness: 0.7,
});

const smallIslandPoints = makeBlob({
  cx: 768,
  cy: 1345,
  rx: 70,
  ry: 42,
  seed: 309,
  count: 54,
  roughness: 0.6,
});

export const lands = [
  {
    id: "mainland",
    name: "北境大陆",
    points: mainlandPoints,
    fill: COLORS.land,
    coast: COLORS.ink,
    underlay: makeCoastUnderlay(mainlandPoints, 11),
  },
  {
    id: "north-island",
    name: "北屿",
    points: northIslandPoints,
    fill: COLORS.landLight,
    coast: COLORS.ink,
    underlay: makeCoastUnderlay(northIslandPoints, 9),
  },
  {
    id: "east-island",
    name: "东岬",
    points: eastIslandPoints,
    fill: COLORS.landLight,
    coast: COLORS.ink,
    underlay: makeCoastUnderlay(eastIslandPoints, 9),
  },
  {
    id: "south-island",
    name: "芦岛",
    points: southIslandPoints,
    fill: COLORS.land,
    coast: COLORS.ink,
    underlay: makeCoastUnderlay(southIslandPoints, 7),
  },
  {
    id: "small-island",
    name: "细沙洲",
    points: smallIslandPoints,
    fill: COLORS.land,
    coast: COLORS.ink,
    underlay: makeCoastUnderlay(smallIslandPoints, 6),
  },
];

export const borders = [
  {
    id: "west-border",
    name: "西境线",
    points: [
      { x: 1324, y: 541 },
      { x: 1358, y: 628 },
      { x: 1322, y: 713 },
      { x: 1349, y: 812 },
      { x: 1306, y: 914 },
      { x: 1332, y: 1018 },
      { x: 1287, y: 1112 },
      { x: 1237, y: 1230 },
      { x: 1231, y: 1337 },
      { x: 1188, y: 1439 },
    ],
  },
  {
    id: "east-border",
    name: "东境线",
    points: [
      { x: 1868, y: 524 },
      { x: 1839, y: 619 },
      { x: 1867, y: 711 },
      { x: 1903, y: 815 },
      { x: 1870, y: 928 },
      { x: 1905, y: 1030 },
      { x: 1936, y: 1138 },
      { x: 1917, y: 1248 },
      { x: 1934, y: 1365 },
      { x: 1914, y: 1444 },
    ],
  },
];

export const lakes = [
  {
    id: "mirror-lake",
    name: "镜湖",
    points: [
      { x: 1512, y: 1124 },
      { x: 1545, y: 1105 },
      { x: 1588, y: 1115 },
      { x: 1602, y: 1144 },
      { x: 1571, y: 1165 },
      { x: 1530, y: 1150 },
    ],
  },
  {
    id: "reed-lake",
    name: "苇泽",
    points: [
      { x: 1732, y: 1192 },
      { x: 1760, y: 1171 },
      { x: 1781, y: 1198 },
      { x: 1763, y: 1224 },
      { x: 1737, y: 1216 },
    ],
  },
];

export const rivers = [
  {
    id: "qi-river",
    name: "栖川",
    points: [
      { x: 1666, y: 797 },
      { x: 1642, y: 865 },
      { x: 1590, y: 912 },
      { x: 1576, y: 981 },
      { x: 1531, y: 1042 },
      { x: 1539, y: 1108 },
      { x: 1500, y: 1188 },
      { x: 1455, y: 1261 },
      { x: 1448, y: 1342 },
      { x: 1425, y: 1432 },
    ],
  },
  {
    id: "cinder-river",
    name: "赤水",
    points: [
      { x: 2041, y: 741 },
      { x: 2019, y: 814 },
      { x: 2048, y: 878 },
      { x: 2017, y: 946 },
      { x: 2025, y: 1027 },
      { x: 2077, y: 1112 },
      { x: 2095, y: 1205 },
      { x: 2071, y: 1292 },
      { x: 2096, y: 1398 },
    ],
  },
];

export const contours = [
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `west-contour-${index}`,
    points: makeBlob({
      cx: 1394,
      cy: 790,
      rx: 54 + index * 33,
      ry: 32 + index * 22,
      seed: 700 + index,
      count: 32,
      roughness: 0.65,
    }),
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `east-contour-${index}`,
    points: makeBlob({
      cx: 2013,
      cy: 703,
      rx: 39 + index * 30,
      ry: 25 + index * 20,
      seed: 910 + index,
      count: 30,
      roughness: 0.65,
    }),
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `south-contour-${index}`,
    points: makeBlob({
      cx: 1729,
      cy: 1331,
      rx: 38 + index * 28,
      ry: 22 + index * 18,
      seed: 1210 + index,
      count: 30,
      roughness: 0.65,
    }),
  })),
];

export const cities = [
  {
    id: "bai-harbor",
    name: "白港",
    en: "BAI HARBOR",
    region: "西岸",
    x: 1013,
    y: 860,
    rank: 1,
    kind: "port",
    note: "西岸航运中心",
  },
  {
    id: "qichuan",
    name: "栖川",
    en: "QICHUAN",
    region: "中境",
    x: 1508,
    y: 724,
    rank: 2,
    kind: "river",
    note: "栖川上游河谷",
  },
  {
    id: "lanqiu",
    name: "岚丘",
    en: "LANQIU",
    region: "东境",
    x: 1692,
    y: 932,
    rank: 2,
    kind: "hill",
    note: "东部丘陵站城",
  },
  {
    id: "songyuan",
    name: "松原",
    en: "SONGYUAN",
    region: "中境",
    x: 1580,
    y: 1262,
    rank: 3,
    kind: "plain",
    note: "南部松林平原",
  },
  {
    id: "chiyan",
    name: "赤岩",
    en: "CHIYAN",
    region: "东境",
    x: 2172,
    y: 1080,
    rank: 2,
    kind: "mine",
    note: "赤水河谷矿城",
  },
  {
    id: "luwan",
    name: "鹿湾",
    en: "LUWAN",
    region: "西岸",
    x: 1082,
    y: 1208,
    rank: 3,
    kind: "bay",
    note: "西南湾岸",
  },
  {
    id: "yunqiao",
    name: "云礁",
    en: "YUNQIAO",
    region: "东境",
    x: 2202,
    y: 692,
    rank: 2,
    kind: "cliff",
    note: "东北海崖",
  },
  {
    id: "beiwei",
    name: "北桅",
    en: "BEIWEI",
    region: "西岸",
    x: 1072,
    y: 640,
    rank: 3,
    kind: "port",
    note: "北方旧港",
  },
  {
    id: "beiyu",
    name: "北屿",
    en: "BEIYU",
    region: "离岛",
    x: 960,
    y: 382,
    rank: 3,
    kind: "island",
    note: "北境离岛",
  },
  {
    id: "dongjia",
    name: "东岬",
    en: "DONGJIA",
    region: "离岛",
    x: 2307,
    y: 376,
    rank: 3,
    kind: "island",
    note: "东部海岬",
  },
];

export const mountains = [
  { x: 1374, y: 768, size: 28 },
  { x: 1411, y: 793, size: 22 },
  { x: 1342, y: 812, size: 18 },
  { x: 1441, y: 751, size: 17 },
  { x: 2001, y: 687, size: 25 },
  { x: 2033, y: 720, size: 18 },
  { x: 1970, y: 718, size: 16 },
  { x: 1710, y: 1321, size: 21 },
  { x: 1752, y: 1342, size: 15 },
  { x: 1678, y: 1346, size: 14 },
  { x: 1182, y: 1022, size: 13 },
  { x: 1213, y: 1053, size: 10 },
];

export const forestClusters = [
  { x: 1160, y: 946, rx: 112, ry: 65, count: 22, seed: 31 },
  { x: 1477, y: 1264, rx: 130, ry: 58, count: 24, seed: 75 },
  { x: 1802, y: 1076, rx: 90, ry: 52, count: 14, seed: 96 },
  { x: 782, y: 949, rx: 78, ry: 48, count: 12, seed: 123 },
  { x: 2129, y: 1211, rx: 88, ry: 42, count: 14, seed: 166 },
  { x: 1556, y: 636, rx: 70, ry: 34, count: 10, seed: 208 },
];

export const settlements = [
  { x: 897, y: 763, r: 3 },
  { x: 1193, y: 1104, r: 2.5 },
  { x: 1252, y: 689, r: 2.3 },
  { x: 1416, y: 1019, r: 2.6 },
  { x: 1772, y: 806, r: 2.6 },
  { x: 1986, y: 937, r: 2.3 },
  { x: 2086, y: 1261, r: 2.8 },
  { x: 1553, y: 1394, r: 2.4 },
  { x: 1149, y: 1341, r: 2.4 },
  { x: 1873, y: 1202, r: 2.2 },
];

export const seaLabels = [
  { text: "镜 海", x: 2212, y: 1450, size: 34, rotate: -3 },
  { text: "西 湾", x: 584, y: 866, size: 25, rotate: 78 },
  { text: "北 岬 海", x: 1500, y: 255, size: 22, rotate: -2 },
];

export const regionLabels = [
  { text: "西 岸 郡", x: 1024, y: 1054, rotate: -4 },
  { text: "中 境 郡", x: 1600, y: 902, rotate: -3 },
  { text: "东 境 郡", x: 2065, y: 870, rotate: 4 },
];

export const texturedTufts = (() => {
  const random = mulberry32(4750);
  return Array.from({ length: 90 }, () => ({
    x: 620 + random() * 1700,
    y: 590 + random() * 760,
    length: 2 + random() * 3,
    angle: random() * Math.PI,
  }));
})();

export function forestTrees(cluster) {
  const random = mulberry32(cluster.seed);
  return Array.from({ length: cluster.count }, () => ({
    x: cluster.x + (random() - 0.5) * cluster.rx * 2,
    y: cluster.y + (random() - 0.5) * cluster.ry * 2,
    r: 4 + random() * 3,
  }));
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function landAt(point) {
  return lands.find((land) => pointInPolygon(point, land.points)) ?? null;
}

export function islandContainingCity(city) {
  return landAt({ x: city.x, y: city.y });
}

export function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function lineSegments(points, closed = false) {
  const segments = [];
  const end = closed ? points.length : points.length - 1;
  for (let i = 0; i < end; i += 1) {
    segments.push([points[i], points[(i + 1) % points.length]]);
  }
  return segments;
}

export const coastlineSegments = lands.flatMap((land) => lineSegments(land.points, true));

export const borderSegments = borders.flatMap((border) => lineSegments(border.points));

export const waterSegments = [
  ...lakes.flatMap((lake) => lineSegments(lake.points, true)),
  ...rivers.flatMap((river) => lineSegments(river.points)),
];

export const lineObstacles = [
  ...lands.map((land) => ({
    id: land.id,
    type: "coast",
    points: land.points,
    closed: true,
  })),
  ...borders.map((border) => ({
    id: border.id,
    type: "border",
    points: border.points,
    closed: false,
  })),
];

export const mapData = {
  world: WORLD,
  colors: COLORS,
  lands,
  borders,
  lakes,
  rivers,
  contours,
  cities,
  mountains,
  forestClusters,
  settlements,
  seaLabels,
  regionLabels,
  texturedTufts,
};
