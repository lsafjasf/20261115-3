import { COLS, ROWS, isRackCell } from "./config.js";

const cellKey = (x, y) => `${x},${y}`;

function isWalkable(x, y, noGo) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  if (isRackCell(x, y)) return false;
  return !noGo.has(cellKey(x, y));
}

function reconstruct(cameFrom, currentKey) {
  const path = [];
  let cursor = currentKey;
  while (cursor) {
    const [x, y] = cursor.split(",").map(Number);
    path.unshift({ x, y });
    cursor = cameFrom.get(cursor);
  }
  path.shift();
  return path;
}

export function findPath(start, goal, noGo = new Set()) {
  if (!goal || !isWalkable(goal.x, goal.y, noGo)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const startKey = cellKey(start.x, start.y);
  const goalKey = cellKey(goal.x, goal.y);
  const open = [
    {
      x: start.x,
      y: start.y,
      key: startKey,
      g: 0,
      f: Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y),
    },
  ];
  const cameFrom = new Map();
  const cost = new Map([[startKey, 0]]);
  const closed = new Set();

  while (open.length) {
    let bestIndex = 0;
    for (let index = 1; index < open.length; index += 1) {
      if (open[index].f < open[bestIndex].f) bestIndex = index;
    }
    const current = open.splice(bestIndex, 1)[0];
    if (closed.has(current.key)) continue;
    if (current.key === goalKey) return reconstruct(cameFrom, goalKey);
    closed.add(current.key);

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (closed.has(neighborKey)) continue;
      if (!isWalkable(neighbor.x, neighbor.y, noGo)) continue;

      const nextCost = current.g + 1;
      if (nextCost >= (cost.get(neighborKey) ?? Infinity)) continue;

      cameFrom.set(neighborKey, current.key);
      cost.set(neighborKey, nextCost);
      open.push({
        ...neighbor,
        key: neighborKey,
        g: nextCost,
        f: nextCost + Math.abs(neighbor.x - goal.x) + Math.abs(neighbor.y - goal.y),
      });
    }
  }

  return null;
}

export function pathLength(start, goal, noGo = new Set()) {
  const path = findPath(start, goal, noGo);
  return path ? path.length : Infinity;
}

export function nearestFreeCell(start, noGo = new Set(), occupied = new Set()) {
  const startKey = cellKey(start.x, start.y);
  const queue = [{ ...start, distance: 0 }];
  const visited = new Set([startKey]);

  while (queue.length) {
    const current = queue.shift();
    const key = cellKey(current.x, current.y);
    if (
      current.distance > 0 &&
      isWalkable(current.x, current.y, noGo) &&
      !occupied.has(key)
    ) {
      return { x: current.x, y: current.y };
    }

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey)) continue;
      if (!isWalkable(neighbor.x, neighbor.y, noGo)) continue;
      visited.add(neighborKey);
      queue.push({ ...neighbor, distance: current.distance + 1 });
    }
  }

  return null;
}

export function shortenPathThroughNoGo(path, noGo) {
  return path.some((cell) => noGo.has(cellKey(cell.x, cell.y)));
}

export { cellKey };
