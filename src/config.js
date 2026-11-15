export const COLS = 26;
export const ROWS = 15;
export const TICK_SECONDS = 0.62;
export const SHIFT_SECONDS = 1200;
export const TASK_COUNT = 100;
export const SUCCESS_RATE = 0.8;
export const RING_TRIGGER_SECONDS = 135;

const RACK_SPECS = [
  [5, 1, 4, 3],
  [5, 10, 4, 3],
  [11, 1, 4, 3],
  [11, 10, 4, 3],
  [17, 1, 4, 3],
  [17, 10, 4, 3],
];

export const RACKS = RACK_SPECS.map(([x, y, w, h], index) => ({
  id: `RACK-${String(index + 1).padStart(2, "0")}`,
  x,
  y,
  w,
  h,
}));

export const STATIONS = [
  { id: "S1", x: 2, y: 2, zone: "A-01", tone: "amber" },
  { id: "S2", x: 2, y: 6, zone: "A-02", tone: "amber" },
  { id: "S3", x: 2, y: 10, zone: "A-03", tone: "amber" },
  { id: "S4", x: 6, y: 13, zone: "B-01", tone: "amber" },
  { id: "S5", x: 21, y: 2, zone: "C-01", tone: "amber" },
  { id: "S6", x: 21, y: 6, zone: "C-02", tone: "amber" },
  { id: "S7", x: 21, y: 10, zone: "C-03", tone: "amber" },
  { id: "S8", x: 16, y: 13, zone: "D-01", tone: "amber" },
];

export const CHARGERS = [
  { id: "CH-1", bay: { x: 24, y: 3 }, approach: { x: 23, y: 3 } },
  { id: "CH-2", bay: { x: 24, y: 7 }, approach: { x: 23, y: 7 } },
  { id: "CH-3", bay: { x: 24, y: 11 }, approach: { x: 23, y: 11 } },
];

export const FIXED_STARTS = [
  { x: 1, y: 1, battery: 82 },
  { x: 1, y: 5, battery: 74 },
  { x: 1, y: 8, battery: 69 },
  { x: 1, y: 12, battery: 61 },
  { x: 4, y: 4, battery: 91 },
  { x: 4, y: 7, battery: 66 },
  { x: 4, y: 12, battery: 58 },
  { x: 9, y: 13, battery: 86 },
  { x: 9, y: 5, battery: 63 },
  { x: 15, y: 5, battery: 79 },
  { x: 15, y: 12, battery: 55 },
  { x: 22, y: 13, battery: 72 },
];

export const RING_CELLS = [
  { x: 11, y: 6 },
  { x: 12, y: 6 },
  { x: 12, y: 7 },
  { x: 11, y: 7 },
];

export const PRIORITIES = {
  1: { code: "P1", label: "紧急", tone: "red" },
  2: { code: "P2", label: "加急", tone: "amber" },
  3: { code: "P3", label: "常规", tone: "muted" },
};

export function isRackCell(x, y) {
  return RACKS.some(
    (rack) => x >= rack.x && x < rack.x + rack.w && y >= rack.y && y < rack.y + rack.h,
  );
}

export function stationById(id) {
  return STATIONS.find((station) => station.id === id);
}

export function createFixedTasks() {
  let seed = 0x0715a;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const tasks = [];
  let scheduled = 5;

  for (let index = 0; index < TASK_COUNT; index += 1) {
    const sourceIndex = Math.floor(random() * STATIONS.length);
    let destinationIndex = Math.floor(random() * (STATIONS.length - 1));
    if (destinationIndex >= sourceIndex) destinationIndex += 1;

    const roll = random();
    const priority = roll < 0.09 ? 1 : roll < 0.36 ? 2 : 3;
    const source = STATIONS[sourceIndex];
    const destination = STATIONS[destinationIndex];

    tasks.push({
      id: `T${String(index + 1).padStart(3, "0")}`,
      index,
      priority,
      initialPriority: priority,
      sourceId: source.id,
      destId: destination.id,
      source,
      dest: destination,
      scheduled,
      status: "pending",
      robotId: null,
      startedAt: null,
      completedAt: null,
      progress: 0,
    });

    scheduled += 9 + Math.floor(random() * 4);
  }

  return tasks;
}
