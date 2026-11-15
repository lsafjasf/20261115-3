import { outwardPoint, portPoint } from "./model.js";

const EPS = 0.01;
const DEFAULTS = { padding: 14, stub: 24 };

function expandedBounds(node, padding) {
  return {
    left: node.x - padding,
    top: node.y - padding,
    right: node.x + node.width + padding,
    bottom: node.y + node.height + padding,
  };
}

function segmentClear(a, b, obstacles) {
  if (Math.abs(a.x - b.x) < EPS) {
    const x = a.x;
    const low = Math.min(a.y, b.y);
    const high = Math.max(a.y, b.y);
    return !obstacles.some((box) =>
      x > box.left + EPS &&
      x < box.right - EPS &&
      Math.max(low, box.top) < Math.min(high, box.bottom) - EPS
    );
  }
  if (Math.abs(a.y - b.y) < EPS) {
    const y = a.y;
    const low = Math.min(a.x, b.x);
    const high = Math.max(a.x, b.x);
    return !obstacles.some((box) =>
      y > box.top + EPS &&
      y < box.bottom - EPS &&
      Math.max(low, box.left) < Math.min(high, box.right) - EPS
    );
  }
  return false;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= item.priority) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }

  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let child = left;
        if (right < this.items.length && this.items[right].priority < this.items[left].priority) child = right;
        if (this.items[child].priority >= last.priority) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return root;
  }
}

function uniqueSorted(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > EPS);
}

function axisKey(xIndex, yIndex) {
  return `${xIndex}:${yIndex}`;
}

function shortestPath(start, end, xs, ys, obstacles) {
  const startKey = `${xs.indexOf(start.x)}:${ys.indexOf(start.y)}`;
  const endKey = `${xs.indexOf(end.x)}:${ys.indexOf(end.y)}`;
  if (startKey.startsWith("-1") || endKey.startsWith("-1")) return null;

  const open = new MinHeap();
  const cameFrom = new Map();
  const cost = new Map([[startKey, 0]]);
  open.push({ key: startKey, x: start.x, y: start.y, cost: 0, priority: 0 });

  while (open.items.length) {
    const current = open.pop();
    if (current.key === endKey) {
      const points = [];
      let key = endKey;
      while (key) {
        const [xIndex, yIndex] = key.split(":").map(Number);
        points.push({ x: xs[xIndex], y: ys[yIndex] });
        key = cameFrom.get(key);
      }
      return points.reverse();
    }
    if (current.cost > (cost.get(current.key) ?? Infinity) + EPS) {
      continue;
    }

    const xIndex = xs.indexOf(current.x);
    const yIndex = ys.indexOf(current.y);
    const neighbours = [
      [xIndex - 1, yIndex],
      [xIndex + 1, yIndex],
      [xIndex, yIndex - 1],
      [xIndex, yIndex + 1],
    ];
    for (const [nextX, nextY] of neighbours) {
      if (nextX < 0 || nextY < 0 || nextX >= xs.length || nextY >= ys.length) continue;
      const next = { x: xs[nextX], y: ys[nextY] };
      if (!segmentClear(current, next, obstacles)) continue;
      const step = Math.abs(current.x - next.x) + Math.abs(current.y - next.y);
      const nextCost = cost.get(current.key) + step;
      const key = axisKey(nextX, nextY);
      if (nextCost >= (cost.get(key) ?? Infinity) - EPS) continue;
      cost.set(key, nextCost);
      cameFrom.set(key, current.key);
      open.push({
        key,
        x: next.x,
        y: next.y,
        cost: nextCost,
        priority: nextCost + Math.abs(next.x - end.x) + Math.abs(next.y - end.y),
      });
    }
  }
  return null;
}

function simplify(points) {
  const unique = points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return Math.abs(point.x - previous.x) > EPS || Math.abs(point.y - previous.y) > EPS;
  });
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1];
    const next = unique[index + 1];
    return !(
      (Math.abs(previous.x - point.x) < EPS && Math.abs(point.x - next.x) < EPS) ||
      (Math.abs(previous.y - point.y) < EPS && Math.abs(point.y - next.y) < EPS)
    );
  });
}

export function routeEdge(graph, edge, options = {}) {
  const { padding, stub } = { ...DEFAULTS, ...options };
  const source = graph.nodes.find((node) => node.id === edge.from);
  const target = graph.nodes.find((node) => node.id === edge.to);
  if (!source || !target) return null;

  const startAnchor = portPoint(source, edge.fromPort);
  const endAnchor = portPoint(target, edge.toPort);
  const start = outwardPoint(source, edge.fromPort, stub);
  const end = outwardPoint(target, edge.toPort, stub);
  const fallbackPaddings = [...new Set([padding, 10, 6, 2, 0])]
    .filter((value) => value <= padding)
    .sort((a, b) => b - a);
  let path = null;
  for (const candidatePadding of fallbackPaddings) {
    const obstacles = graph.nodes.map((node) => expandedBounds(node, candidatePadding));
    const xs = uniqueSorted([start.x, end.x, ...obstacles.flatMap((box) => [box.left, box.right])]);
    const ys = uniqueSorted([start.y, end.y, ...obstacles.flatMap((box) => [box.top, box.bottom])]);
    path = shortestPath(start, end, xs, ys, obstacles);
    if (path) break;
  }
  if (!path) return null;

  const points = simplify([startAnchor, ...path, endAnchor]);
  return {
    id: edge.id,
    points,
    labelPoint: pointAlong(points, pathLength(points) / 2),
  };
}

export function routeAll(graph, options = {}) {
  const routes = new Map();
  for (const edge of graph.edges) {
    const route = routeEdge(graph, edge, options);
    if (route) routes.set(edge.id, route);
  }
  return routes;
}

export function pathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return length;
}

export function pointAlong(points, distance) {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segment = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    if (remaining <= segment || index === points.length - 1) {
      const ratio = segment === 0 ? 0 : Math.min(1, remaining / segment);
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
    remaining -= segment;
  }
  return points[0];
}

export function routeToPath(points) {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
}

export function routeHitsNode(route, node, padding = 0) {
  if (!route) return false;
  const left = node.x + padding;
  const right = node.x + node.width - padding;
  const top = node.y + padding;
  const bottom = node.y + node.height - padding;
  for (let index = 1; index < route.points.length; index += 1) {
    const a = route.points[index - 1];
    const b = route.points[index];
    if (Math.abs(a.x - b.x) < EPS) {
      const x = a.x;
      const low = Math.min(a.y, b.y);
      const high = Math.max(a.y, b.y);
      if (x > left + EPS && x < right - EPS && Math.max(low, top) < Math.min(high, bottom) - EPS) return true;
    }
    if (Math.abs(a.y - b.y) < EPS) {
      const y = a.y;
      const low = Math.min(a.x, b.x);
      const high = Math.max(a.x, b.x);
      if (y > top + EPS && y < bottom - EPS && Math.max(low, left) < Math.min(high, right) - EPS) return true;
    }
  }
  return false;
}

export function routesEquivalent(a, b) {
  if (a.size !== b.size) return false;
  for (const [id, route] of a) {
    const other = b.get(id);
    if (!other || route.points.length !== other.points.length) return false;
    for (let index = 0; index < route.points.length; index += 1) {
      if (Math.abs(route.points[index].x - other.points[index].x) > EPS) return false;
      if (Math.abs(route.points[index].y - other.points[index].y) > EPS) return false;
    }
  }
  return true;
}
