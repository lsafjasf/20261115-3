export const MAP_COLORS = {
  land: "#f1ebdd",
  landAlt: "#ede5d4",
  landWarm: "#f3e8d4",
  block: "#e7dfce",
  blockStroke: "#d9cfbb",
  park: "#bdcaa8",
  parkDark: "#9eb18d",
  water: "#8fc2c1",
  waterDeep: "#78b4b6",
  waterLine: "#579b9d",
  roadCasing: "#d2c7b2",
  road: "#fcfaf3",
  roadMajor: "#fffdf7",
  roadInk: "#57615a",
  transitBlue: "#2f7289",
  transitGold: "#c3912f",
  transitGreen: "#4f8060",
  text: "#3e4b43",
  textMuted: "#6e786e",
  marker: "#d95532",
  markerInk: "#26352d",
};

export const INITIAL_CAMERA = { x: 880, y: 573, zoom: 1.02 };

export const WATER = [
  {
    id: "bay",
    points: [
      [1341, -40],
      [1334, 92],
      [1306, 174],
      [1329, 258],
      [1283, 340],
      [1308, 422],
      [1274, 515],
      [1296, 592],
      [1258, 680],
      [1270, 758],
      [1237, 846],
      [1254, 934],
      [1207, 1020],
      [1240, 1110],
      [1210, 1240],
      [1810, 1240],
      [1810, -40],
    ],
  },
  {
    id: "inlet",
    points: [
      [1302, 593],
      [1286, 600],
      [1265, 616],
      [1240, 626],
      [1216, 650],
      [1194, 662],
      [1178, 684],
      [1190, 698],
      [1218, 680],
      [1243, 671],
      [1267, 649],
      [1294, 640],
      [1312, 618],
    ],
  },
];

export const RESERVOIRS = [
  {
    id: "north-reservoir",
    points: [
      [690, 138],
      [751, 121],
      [811, 142],
      [836, 189],
      [821, 238],
      [773, 262],
      [716, 244],
      [681, 201],
    ],
  },
];

export const CREEKS = [
  {
    id: "mill-creek",
    width: 16,
    points: [
      [760, 255],
      [754, 310],
      [773, 367],
      [766, 432],
      [790, 492],
      [792, 556],
      [822, 608],
      [842, 674],
      [880, 730],
      [925, 782],
      [975, 826],
      [1037, 855],
      [1102, 870],
      [1170, 875],
      [1230, 888],
      [1270, 911],
    ],
  },
];

export const PARKS = [
  {
    id: "northgate-park",
    name: "Northgate Park",
    points: [
      [985, 214],
      [1046, 184],
      [1115, 202],
      [1141, 255],
      [1112, 309],
      [1050, 329],
      [991, 302],
      [969, 256],
    ],
  },
  {
    id: "observatory-green",
    name: "Observatory Green",
    points: [
      [466, 369],
      [510, 340],
      [559, 355],
      [579, 402],
      [554, 448],
      [510, 467],
      [467, 446],
      [449, 404],
    ],
  },
  {
    id: "foundry-commons",
    name: "Foundry Commons",
    points: [
      [529, 827],
      [565, 807],
      [611, 816],
      [631, 853],
      [609, 888],
      [567, 899],
      [535, 880],
    ],
  },
  {
    id: "harbor-gardens",
    name: "Harbor Gardens",
    points: [
      [1074, 716],
      [1115, 699],
      [1143, 725],
      [1145, 766],
      [1113, 788],
      [1080, 775],
      [1064, 745],
    ],
  },
];

export const DISTRICTS = [
  {
    id: "northgate",
    fill: "#ebe6d8",
    points: [[846, 177], [1005, 148], [1189, 182], [1290, 279], [1251, 370], [1100, 407], [955, 393], [834, 326]],
  },
  {
    id: "old-quarter",
    fill: "#f0e5d1",
    points: [[598, 486], [755, 469], [921, 492], [1013, 578], [1004, 704], [910, 791], [746, 813], [618, 754], [554, 639]],
  },
  {
    id: "foundry",
    fill: "#ece7da",
    points: [[409, 575], [552, 532], [676, 563], [700, 688], [643, 803], [511, 861], [402, 811], [365, 692]],
  },
  {
    id: "harbor-west",
    fill: "#f2e9d8",
    points: [[1028, 432], [1190, 408], [1270, 466], [1260, 594], [1184, 688], [1062, 726], [992, 658], [987, 529]],
  },
];

export const PIERS = [
  { x: 1287, y: 596, w: 76, h: 9, angle: 0.07 },
  { x: 1299, y: 704, w: 92, h: 8, angle: 0.12 },
  { x: 1275, y: 779, w: 74, h: 7, angle: 0.16 },
];

export const AIRFIELD = {
  x: 1192,
  y: 858,
  angle: -0.25,
  length: 112,
  width: 18,
};

function rotate(x, y, cx, cy, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function makeBlocks({ cx, cy, cols, rows, cellW, cellH, gapX, gapY, angle, jitter = 0 }) {
  const blocks = [];
  const totalW = cols * cellW + (cols - 1) * gapX;
  const totalH = rows * cellH + (rows - 1) * gapY;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const left = cx - totalW / 2 + col * (cellW + gapX);
      const top = cy - totalH / 2 + row * (cellH + gapY);
      const wobble = Math.sin(row * 3.1 + col * 1.7) * jitter;
      const points = [
        [left + wobble, top],
        [left + cellW - wobble * 0.4, top + jitter * 0.25],
        [left + cellW, top + cellH],
        [left + wobble * 0.2, top + cellH - jitter * 0.2],
      ].map(([x, y]) => rotate(x, y, cx, cy, angle));
      blocks.push({ id: `block-${row}-${col}-${cx}`, points });
    }
  }
  return blocks;
}

export const BLOCKS = [
  ...makeBlocks({ cx: 735, cy: 674, cols: 5, rows: 5, cellW: 52, cellH: 31, gapX: 10, gapY: 8, angle: -0.055, jitter: 3 }),
  ...makeBlocks({ cx: 956, cy: 397, cols: 4, rows: 3, cellW: 56, cellH: 35, gapX: 9, gapY: 8, angle: 0.025, jitter: 2 }),
  ...makeBlocks({ cx: 562, cy: 687, cols: 3, rows: 3, cellW: 63, cellH: 38, gapX: 10, gapY: 9, angle: 0.06, jitter: 2 }),
  ...makeBlocks({ cx: 1140, cy: 560, cols: 2, rows: 4, cellW: 48, cellH: 31, gapX: 9, gapY: 7, angle: -0.02, jitter: 2 }),
];

function gridRoads({ cx, cy, cols, rows, cellW, cellH, gapX, gapY, angle, extX = 14, extY = 14 }) {
  const roads = [];
  const totalW = cols * cellW + (cols - 1) * gapX;
  const totalH = rows * cellH + (rows - 1) * gapY;
  for (let col = 0; col <= cols; col += 1) {
    const x = cx - totalW / 2 - gapX / 2 + col * (cellW + gapX);
    roads.push([
      rotate(x, cy - totalH / 2 - extY, cx, cy, angle),
      rotate(x, cy + totalH / 2 + extY, cx, cy, angle),
    ]);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = cy - totalH / 2 - gapY / 2 + row * (cellH + gapY);
    roads.push([
      rotate(cx - totalW / 2 - extX, y, cx, cy, angle),
      rotate(cx + totalW / 2 + extX, y, cx, cy, angle),
    ]);
  }
  return roads;
}

export const MINOR_ROADS = [
  ...gridRoads({ cx: 735, cy: 674, cols: 5, rows: 5, cellW: 52, cellH: 31, gapX: 10, gapY: 8, angle: -0.055 }),
  ...gridRoads({ cx: 956, cy: 397, cols: 4, rows: 3, cellW: 56, cellH: 35, gapX: 9, gapY: 8, angle: 0.025 }),
  ...gridRoads({ cx: 562, cy: 687, cols: 3, rows: 3, cellW: 63, cellH: 38, gapX: 10, gapY: 9, angle: 0.06 }),
  ...gridRoads({ cx: 1140, cy: 560, cols: 2, rows: 4, cellW: 48, cellH: 31, gapX: 9, gapY: 7, angle: -0.02 }),
];

export const MAJOR_ROADS = [
  {
    name: "Harbor Boulevard",
    weight: 8,
    points: [[372, 592], [470, 590], [561, 600], [653, 614], [742, 625], [825, 628], [905, 633], [987, 647], [1062, 666], [1132, 686], [1207, 716], [1280, 766]],
  },
  {
    name: "Meridian Avenue",
    weight: 7,
    points: [[598, 936], [652, 864], [693, 787], [739, 715], [789, 641], [841, 574], [902, 512], [958, 451], [1014, 390], [1085, 331], [1167, 292], [1246, 272]],
  },
  {
    name: "North Loop",
    weight: 6,
    points: [[474, 310], [553, 275], [641, 260], [731, 266], [820, 286], [910, 302], [1003, 304], [1090, 288], [1178, 254], [1250, 210]],
  },
  {
    name: "Foundry Road",
    weight: 6,
    points: [[490, 408], [508, 494], [515, 577], [520, 665], [527, 752], [541, 838], [562, 930]],
  },
  {
    name: "Market Street",
    weight: 5,
    points: [[608, 518], [679, 527], [751, 539], [827, 550], [902, 557], [975, 559], [1048, 551], [1119, 535], [1183, 512]],
  },
  {
    name: "Bridge Street",
    weight: 5,
    points: [[820, 590], [877, 605], [940, 621], [1004, 641], [1069, 669], [1134, 701], [1201, 739], [1261, 786]],
  },
  {
    name: "Observatory Way",
    weight: 4.5,
    points: [[412, 473], [469, 459], [526, 457], [589, 469], [649, 491], [711, 514], [775, 533]],
  },
  {
    name: "Airfield Link",
    weight: 5,
    points: [[1121, 935], [1178, 887], [1232, 837], [1281, 788], [1325, 730]],
  },
];

export const TRANSIT_LINES = [
  {
    id: "A",
    color: MAP_COLORS.transitBlue,
    points: [[427, 799], [506, 783], [590, 764], [676, 744], [760, 731], [846, 729], [931, 736], [1010, 747], [1087, 741], [1160, 720], [1224, 688], [1287, 654]],
  },
  {
    id: "B",
    color: MAP_COLORS.transitGold,
    points: [[692, 949], [724, 884], [760, 822], [803, 762], [849, 703], [897, 647], [946, 594], [997, 543], [1052, 487], [1104, 425], [1142, 355], [1155, 278]],
  },
  {
    id: "C",
    color: MAP_COLORS.transitGreen,
    points: [[461, 564], [523, 552], [590, 542], [654, 543], [717, 554], [782, 570], [850, 580], [918, 581], [984, 575], [1050, 565]],
  },
];

export const TRANSIT_STOPS = [
  { x: 506, y: 783, lines: ["A"] },
  { x: 676, y: 744, lines: ["A"] },
  { x: 846, y: 729, lines: ["A", "B"] },
  { x: 1010, y: 747, lines: ["A"] },
  { x: 1160, y: 720, lines: ["A"] },
  { x: 849, y: 703, lines: ["B"] },
  { x: 997, y: 543, lines: ["B"] },
  { x: 1142, y: 355, lines: ["B"] },
  { x: 523, y: 552, lines: ["C"] },
  { x: 654, y: 543, lines: ["C"] },
  { x: 782, y: 570, lines: ["C"] },
  { x: 918, y: 581, lines: ["C"] },
];

export const DISTRICT_LABELS = [
  { text: "OLD QUARTER", x: 714, y: 646, size: 15, color: "#4d5a51", tracking: 2.1, angle: -0.02 },
  { text: "NORTHGATE", x: 945, y: 358, size: 12, color: "#68756a", tracking: 1.8, angle: 0.02 },
  { text: "FOUNDRY", x: 558, y: 704, size: 11, color: "#68756a", tracking: 1.7, angle: 0.02 },
  { text: "HARBOR WEST", x: 1120, y: 474, size: 10, color: "#6a776e", tracking: 1.5, angle: -0.02 },
  { text: "OBSERVATORY HILL", x: 505, y: 395, size: 9, color: "#69766d", tracking: 1.1, angle: 0.01 },
];

export const WATER_LABELS = [
  { text: "NORTHLIGHT BAY", x: 1430, y: 420, size: 13, color: "#448487", tracking: 2.2, angle: 1.41 },
];

export const STREET_LABELS = [
  { text: "HARBOR BLVD", x: 842, y: 625, size: 7, angle: 0.04 },
  { text: "MERIDIAN AVE", x: 890, y: 530, size: 7, angle: -0.92 },
  { text: "NORTH LOOP", x: 670, y: 263, size: 7, angle: -0.12 },
  { text: "FOUNDRY RD", x: 522, y: 610, size: 7, angle: 1.53 },
];

export const LANDMARKS = [
  { id: "market", name: "Copper Market", x: 731, y: 586, number: "01", kind: "market" },
  { id: "tower", name: "Meridian Tower", x: 972, y: 406, number: "02", kind: "tower" },
  { id: "museum", name: "Lumen Museum", x: 901, y: 728, number: "03", kind: "museum" },
  { id: "ferry", name: "Tidewater Ferry", x: 1173, y: 676, number: "04", kind: "ferry" },
  { id: "park", name: "Northgate Park", x: 1063, y: 286, number: "05", kind: "park" },
  { id: "foundry", name: "Foundry Station", x: 594, y: 763, number: "06", kind: "station" },
  { id: "observatory", name: "Observatory Hill", x: 518, y: 435, number: "07", kind: "observatory" },
  { id: "airfield", name: "Harbor Airfield", x: 1292, y: 863, number: "08", kind: "airfield" },
];

export const DEFAULT_LAYERS = {
  terrain: true,
  blocks: true,
  roads: true,
  transit: true,
  labels: true,
  markers: true,
};

export function clampCamera(camera) {
  return {
    x: Math.min(1380, Math.max(420, camera.x)),
    y: Math.min(880, Math.max(270, camera.y)),
    zoom: Math.min(2.4, Math.max(0.68, camera.zoom)),
  };
}
