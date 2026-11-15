export const TERRAIN_CONFIG = Object.freeze({
  grid: 8,
  extent: 8,
  baseY: -1.25,
  minHeight: 0,
  maxHeight: 5.6,
});

const EPSILON = 1e-7;
const QUANT = 1e5;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function seededHeight(x, z) {
  const broadRidge = 4.05 * Math.exp(-((x - 1.1) ** 2 + (z - 1.15) ** 2) / 3.7);
  const westPeak = 1.72 * Math.exp(-((x + 1.9) ** 2 + (z - 0.2) ** 2) / 2.8);
  const southShoulder = 1.02 * Math.exp(-((x + 0.5) ** 2 + (z + 2.25) ** 2) / 2.1);
  const eastValley = 0.82 * Math.exp(-((x - 2.45) ** 2 + (z + 2.05) ** 2) / 2.4);
  const ripples = 0.12 * Math.sin(x * 1.28 + 0.4) * Math.cos(z * 1.1) + 0.06 * Math.cos(x * 2.1 + z);
  return clamp(0.48 + broadRidge + westPeak + southShoulder - eastValley + ripples, 0.12, 5.25);
}

export class TerrainModel {
  constructor(options = {}) {
    this.grid = options.grid ?? TERRAIN_CONFIG.grid;
    this.extent = options.extent ?? TERRAIN_CONFIG.extent;
    this.baseY = options.baseY ?? TERRAIN_CONFIG.baseY;
    this.n = this.grid + 1;
    this.heights = new Float32Array(this.n * this.n);
    this.originalHeights = new Float32Array(this.n * this.n);
    this.revision = 0;
    this.reset();
  }

  get vertexCount() {
    return this.n * this.n;
  }

  get topTriangleCount() {
    return this.grid * this.grid * 2;
  }

  reset() {
    const half = this.extent / 2;
    const step = this.extent / this.grid;
    for (let row = 0; row < this.n; row += 1) {
      for (let col = 0; col < this.n; col += 1) {
        const index = row * this.n + col;
        const x = -half + col * step;
        const z = -half + row * step;
        const height = seededHeight(x, z);
        this.heights[index] = height;
        this.originalHeights[index] = height;
      }
    }
    this.revision = 0;
  }

  vertexPosition(index) {
    const row = Math.floor(index / this.n);
    const col = index % this.n;
    const step = this.extent / this.grid;
    const half = this.extent / 2;
    return {
      x: -half + col * step,
      y: this.heights[index],
      z: -half + row * step,
      row,
      col,
    };
  }

  setHeight(index, height) {
    if (!Number.isInteger(index) || index < 0 || index >= this.vertexCount) {
      throw new RangeError(`Vertex index out of range: ${index}`);
    }
    const next = clamp(Number(height), TERRAIN_CONFIG.minHeight, TERRAIN_CONFIG.maxHeight);
    if (Math.abs(this.heights[index] - next) < 1e-6) return false;
    this.heights[index] = next;
    this.revision += 1;
    return true;
  }

  resetVertex(index) {
    return this.setHeight(index, this.originalHeights[index]);
  }

  editedVertexCount() {
    let count = 0;
    for (let i = 0; i < this.heights.length; i += 1) {
      if (Math.abs(this.heights[i] - this.originalHeights[i]) > 1e-4) count += 1;
    }
    return count;
  }

  heightRange() {
    let min = Infinity;
    let max = -Infinity;
    for (const height of this.heights) {
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
    return { min, max };
  }

  buildSolid() {
    const positions = [];
    const triangles = [];
    const parts = [];
    const n = this.n;

    const addVertex = (x, y, z) => {
      positions.push(x, y, z);
      return positions.length / 3 - 1;
    };
    const addTriangle = (a, b, c) => {
      triangles.push(a, b, c);
    };

    for (let index = 0; index < this.vertexCount; index += 1) {
      const vertex = this.vertexPosition(index);
      addVertex(vertex.x, vertex.y, vertex.z);
    }

    const topStart = 0;
    for (let row = 0; row < this.grid; row += 1) {
      for (let col = 0; col < this.grid; col += 1) {
        const a = row * n + col;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        addTriangle(a, c, b);
        addTriangle(b, c, d);
      }
    }
    parts.push({ name: "TopSurface", start: topStart, count: triangles.length / 3 });

    const perimeter = [];
    for (let col = 0; col < n; col += 1) perimeter.push(col);
    for (let row = 1; row < n; row += 1) perimeter.push(row * n + n - 1);
    for (let col = n - 2; col >= 0; col -= 1) perimeter.push((n - 1) * n + col);
    for (let row = n - 2; row > 0; row -= 1) perimeter.push(row * n);

    const sideStart = triangles.length / 3;
    const sideVertexMap = new Map();
    const sideVertex = (topIndex) => {
      if (!sideVertexMap.has(topIndex)) {
        const vertex = this.vertexPosition(topIndex);
        sideVertexMap.set(topIndex, addVertex(vertex.x, this.baseY, vertex.z));
      }
      return sideVertexMap.get(topIndex);
    };

    for (let i = 0; i < perimeter.length; i += 1) {
      const a = perimeter[i];
      const b = perimeter[(i + 1) % perimeter.length];
      const aBottom = sideVertex(a);
      const bBottom = sideVertex(b);
      addTriangle(a, bBottom, b);
      addTriangle(a, aBottom, bBottom);
    }
    parts.push({ name: "SideWalls", start: sideStart, count: triangles.length / 3 - sideStart });

    const baseStart = triangles.length / 3;
    const half = this.extent / 2;
    const b0 = addVertex(-half, this.baseY, -half);
    const b1 = addVertex(half, this.baseY, -half);
    const b2 = addVertex(half, this.baseY, half);
    const b3 = addVertex(-half, this.baseY, half);
    addTriangle(b0, b3, b1);
    addTriangle(b1, b3, b2);
    parts.push({ name: "Base", start: baseStart, count: triangles.length / 3 - baseStart });

    return { positions, triangles, parts, topVertexCount: this.vertexCount };
  }

  triangleVertices(solid = this.buildSolid()) {
    const result = [];
    for (let i = 0; i < solid.triangles.length; i += 3) {
      const indices = [solid.triangles[i], solid.triangles[i + 1], solid.triangles[i + 2]];
      result.push(
        indices.map((index) => ({
          x: solid.positions[index * 3],
          y: solid.positions[index * 3 + 1],
          z: solid.positions[index * 3 + 2],
        })),
      );
    }
    return result;
  }

  buildSection(cutHeight) {
    const cut = clamp(Number(cutHeight), this.baseY, TERRAIN_CONFIG.maxHeight + 0.1);
    const { max } = this.heightRange();
    if (cut <= this.baseY + 1e-4 || cut >= max + 1e-4) {
      return this.emptySection(cut);
    }

    const solid = this.buildSolid();
    const probeY = cut + 1e-6;
    const segments = [];

    for (let i = 0; i < solid.triangles.length; i += 3) {
      const triangle = [0, 1, 2].map((offset) => {
        const index = solid.triangles[i + offset] * 3;
        return {
          x: solid.positions[index],
          y: solid.positions[index + 1],
          z: solid.positions[index + 2],
        };
      });

      const crossings = [];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = triangle[edge];
        const b = triangle[(edge + 1) % 3];
        if ((a.y > probeY) === (b.y > probeY)) continue;
        const denominator = b.y - a.y;
        if (Math.abs(denominator) < EPSILON) continue;
        const t = (probeY - a.y) / denominator;
        crossings.push({
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
        });
      }

      if (crossings.length === 2) {
        const dx = crossings[0].x - crossings[1].x;
        const dz = crossings[0].z - crossings[1].z;
        if (dx * dx + dz * dz > 1e-10) segments.push(crossings);
      }
    }

    const loops = assembleLoops(segments);
    const polygonSet = buildSectionPolygons(loops);
    const length = segments.reduce(
      (sum, [a, b]) => sum + Math.hypot(a.x - b.x, a.z - b.z),
      0,
    );
    const area = Math.abs(
      polygonSet.polygons.reduce(
        (sum, polygon) =>
          sum +
          Math.abs(signedArea(polygon.outer.points)) -
          polygon.holes.reduce((holeSum, hole) => holeSum + Math.abs(signedArea(hole.points)), 0),
        0,
      ),
    );

    return {
      cutHeight: cut,
      loops,
      polygons: polygonSet.polygons,
      segmentCount: segments.length,
      length,
      area,
      revision: this.revision,
      bounds: {
        minX: -this.extent / 2,
        maxX: this.extent / 2,
        minZ: -this.extent / 2,
        maxZ: this.extent / 2,
      },
    };
  }

  emptySection(cutHeight) {
    return {
      cutHeight: Number(cutHeight),
      loops: [],
      polygons: [],
      segmentCount: 0,
      length: 0,
      area: 0,
      revision: this.revision,
      bounds: {
        minX: -this.extent / 2,
        maxX: this.extent / 2,
        minZ: -this.extent / 2,
        maxZ: this.extent / 2,
      },
    };
  }

  exportOBJ() {
    const solid = this.buildSolid();
    const lines = [
      "# Terrain Slice Lab — editable triangulated terrain",
      `# Revision: ${this.revision}`,
      `# Edited vertices: ${this.editedVertexCount()}`,
      `# Vertices: ${solid.positions.length / 3}`,
      `# Triangles: ${solid.triangles.length / 3}`,
      "# Units: meters · Y is up · watertight solid",
      "o TerrainSolid",
    ];

    for (let i = 0; i < solid.positions.length; i += 3) {
      lines.push(
        `v ${formatNumber(solid.positions[i])} ${formatNumber(
          solid.positions[i + 1],
        )} ${formatNumber(solid.positions[i + 2])}`,
      );
    }

    for (const part of solid.parts) {
      lines.push(`g ${part.name}`);
      const end = part.start + part.count;
      for (let face = part.start; face < end; face += 1) {
        const offset = face * 3;
        lines.push(
          `f ${solid.triangles[offset] + 1} ${solid.triangles[offset + 1] + 1} ${
            solid.triangles[offset + 2] + 1
          }`,
        );
      }
    }

    return `${lines.join("\n")}\n`;
  }

  toJSON() {
    const section = this.buildSection(2.1);
    return {
      grid: this.grid,
      extent: this.extent,
      baseY: this.baseY,
      revision: this.revision,
      editedVertices: this.editedVertexCount(),
      heights: Array.from(this.heights),
      vertexCount: this.vertexCount,
      triangleCount: this.topTriangleCount,
      section: {
        cutHeight: section.cutHeight,
        loops: section.loops.length,
        segments: section.segmentCount,
        area: section.area,
      },
    };
  }
}

function formatNumber(value) {
  if (Math.abs(value) < 1e-9) return "0";
  return Number(value.toFixed(5)).toString();
}

function quantKey(point) {
  return `${Math.round(point.x * QUANT)},${Math.round(point.z * QUANT)}`;
}

function assembleLoops(rawSegments) {
  if (rawSegments.length === 0) return [];

  const segments = rawSegments.map(([a, b]) => ({
    a,
    b,
    aKey: quantKey(a),
    bKey: quantKey(b),
    used: false,
  }));
  const adjacency = new Map();

  const register = (key, segmentIndex, end) => {
    if (!adjacency.has(key)) adjacency.set(key, []);
    adjacency.get(key).push({ segmentIndex, end });
  };

  segments.forEach((segment, index) => {
    register(segment.aKey, index, "a");
    register(segment.bKey, index, "b");
  });

  const loops = [];
  for (let seed = 0; seed < segments.length; seed += 1) {
    if (segments[seed].used) continue;
    const loop = [];
    const start = segments[seed].a;
    const startKey = segments[seed].aKey;
    let current = segments[seed];
    let currentKey = startKey;
    let closed = false;
    loop.push(start);

    for (let guard = 0; guard < segments.length + 2; guard += 1) {
      current.used = true;
      const reverse = current.aKey === currentKey;
      const nextPoint = reverse ? current.b : current.a;
      const nextKey = reverse ? current.bKey : current.aKey;
      loop.push(nextPoint);

      if (nextKey === startKey) {
        closed = true;
        loop.pop();
        break;
      }

      const candidates = (adjacency.get(nextKey) ?? []).filter(
        (candidate) => !segments[candidate.segmentIndex].used,
      );
      if (candidates.length === 0) break;

      let chosen = candidates[0];
      if (candidates.length > 1) {
        const previous = loop[loop.length - 2] ?? start;
        const incoming = normalize2D(nextPoint.x - previous.x, nextPoint.z - previous.z);
        let bestDot = -Infinity;
        for (const candidate of candidates) {
          const candidateSegment = segments[candidate.segmentIndex];
          const candidatePoint =
            candidateSegment.aKey === nextKey ? candidateSegment.b : candidateSegment.a;
          const outgoing = normalize2D(candidatePoint.x - nextPoint.x, candidatePoint.z - nextPoint.z);
          const dot = incoming.x * outgoing.x + incoming.z * outgoing.z;
          if (dot > bestDot) {
            bestDot = dot;
            chosen = candidate;
          }
        }
      }

      current = segments[chosen.segmentIndex];
      currentKey = nextKey;
    }

    const cleaned = cleanLoop(loop);
    if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 1e-5) {
      loops.push({ points: cleaned, closed });
    }
  }

  return loops;
}

function normalize2D(x, z) {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

function cleanLoop(points) {
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-5) {
      deduped.push({ x: point.x, z: point.z });
    }
  }
  if (
    deduped.length > 1 &&
    Math.hypot(deduped[0].x - deduped.at(-1).x, deduped[0].z - deduped.at(-1).z) < 1e-5
  ) {
    deduped.pop();
  }
  if (deduped.length < 4) return deduped;

  const simplified = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const previous = deduped[(i - 1 + deduped.length) % deduped.length];
    const current = deduped[i];
    const next = deduped[(i + 1) % deduped.length];
    const cross =
      (current.x - previous.x) * (next.z - current.z) -
      (current.z - previous.z) * (next.x - current.x);
    const span =
      Math.hypot(current.x - previous.x, current.z - previous.z) +
      Math.hypot(next.x - current.x, next.z - current.z);
    if (Math.abs(cross) > 2e-6 * Math.max(1, span)) simplified.push(current);
  }
  return simplified.length >= 3 ? simplified : deduped;
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.z - next.x * current.z;
  }
  return area / 2;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z || EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function buildSectionPolygons(loops) {
  if (loops.length === 0) return { polygons: [], depths: [] };

  const loopData = loops.map((loop, index) => ({
    index,
    loop,
    area: Math.abs(signedArea(loop.points)),
    parent: -1,
    depth: 0,
  }));

  for (const child of loopData) {
    const sample = child.loop.points[0];
    let parent = null;
    for (const candidate of loopData) {
      if (candidate.index === child.index || candidate.area <= child.area) continue;
      if (pointInPolygon(sample, candidate.loop.points)) {
        if (!parent || candidate.area < parent.area) parent = candidate;
      }
    }
    if (parent) {
      child.parent = parent.index;
    }
  }

  const resolveDepth = (loopDatum, stack = new Set()) => {
    if (loopDatum.parent < 0) return 0;
    if (stack.has(loopDatum.index)) return 0;
    stack.add(loopDatum.index);
    return 1 + resolveDepth(loopData[loopDatum.parent], stack);
  };
  for (const item of loopData) item.depth = resolveDepth(item);

  const polygons = [];
  for (const loopDatum of loopData) {
    if (loopDatum.depth % 2 !== 0) continue;
    const holes = loopData
      .filter((candidate) => candidate.parent === loopDatum.index && candidate.depth % 2 === 1)
      .map((candidate) => candidate.loop);
    polygons.push({ outer: loopDatum.loop, holes });
  }

  return { polygons, depths: loopData.map((item) => item.depth) };
}

export function sectionToSVG(section, options = {}) {
  const width = options.width ?? 480;
  const height = options.height ?? 540;
  const padding = 54;
  const bounds = section.bounds;
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxZ - bounds.minZ;
  const drawingWidth = width - padding * 2;
  const drawingHeight = height - 128;
  const scale = Math.min(drawingWidth / worldWidth, drawingHeight / worldHeight);
  const originX = (width - worldWidth * scale) / 2;
  const originY = 84 + (drawingHeight - worldHeight * scale) / 2;

  const project = (point) => ({
    x: originX + (point.x - bounds.minX) * scale,
    y: originY + (bounds.maxZ - point.z) * scale,
  });

  const loopPath = (loop) => {
    const points = loop.points.map(project);
    if (points.length === 0) return "";
    const start = points[0];
    const rest = points
      .slice(1)
      .map((point) => `L ${formatSvg(point.x)} ${formatSvg(point.y)}`)
      .join(" ");
    return `M ${formatSvg(start.x)} ${formatSvg(start.y)} ${rest} Z`;
  };

  const allPaths = section.loops.map(loopPath).filter(Boolean).join(" ");
  const cutLabel = section.cutHeight.toFixed(2);
  const gridLines = [];
  for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += 1) {
    const top = project({ x, z: bounds.maxZ });
    const bottom = project({ x, z: bounds.minZ });
    gridLines.push(
      `<line x1="${formatSvg(top.x)}" y1="${formatSvg(top.y)}" x2="${formatSvg(
        bottom.x,
      )}" y2="${formatSvg(bottom.y)}"/>`,
    );
  }
  for (let z = Math.ceil(bounds.minZ); z <= bounds.maxZ; z += 1) {
    const left = project({ x: bounds.minX, z });
    const right = project({ x: bounds.maxX, z });
    gridLines.push(
      `<line x1="${formatSvg(left.x)}" y1="${formatSvg(left.y)}" x2="${formatSvg(
        right.x,
      )}" y2="${formatSvg(right.y)}"/>`,
    );
  }

  const emptyMessage =
    section.loops.length === 0
      ? `<text x="${width / 2}" y="${originY + (worldHeight * scale) / 2}" class="empty">NO INTERSECTION AT Y ${cutLabel}</text>`
      : "";
  const contourPaths = section.loops
    .map((loop) => `<path d="${loopPath(loop)}" class="contour"/>`)
    .join("\n    ");
  const areaLabel = section.area.toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terrain section at Y ${cutLabel}" data-cut-height="${cutLabel}" data-mesh-revision="${section.revision}">
  <title>Terrain section — Y ${cutLabel} m</title>
  <desc>Horizontal intersection of the editable triangulated terrain at height ${cutLabel} meters. ${section.loops.length} contour loops, ${areaLabel} square meters.</desc>
  <rect width="${width}" height="${height}" fill="#09100d"/>
  <g class="grid" stroke="#718678" stroke-opacity="0.11" stroke-width="0.6">${gridLines.join("")}</g>
  <g class="frame" fill="none" stroke="#718678" stroke-opacity="0.17" stroke-width="0.8">
    <rect x="${formatSvg(originX)}" y="${formatSvg(originY)}" width="${formatSvg(
      worldWidth * scale,
    )}" height="${formatSvg(worldHeight * scale)}"/>
  </g>
  <g fill="#cfe980" fill-opacity="0.2" fill-rule="evenodd" stroke="none">
    <path d="${allPaths}"/>
  </g>
  <g fill="none" stroke="#d7f875" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
    ${contourPaths}
  </g>
  <g fill="#d7f875" font-family="monospace" font-size="8" letter-spacing="1.4">
    <text x="18" y="24" font-size="10" letter-spacing="2.6">TERRAIN / SECTION</text>
    <text x="${width - 18}" y="24" text-anchor="end">Y ${cutLabel} M</text>
    <text x="18" y="${height - 24}" fill="#687d70" font-size="7">LOOPS ${String(
      section.loops.length,
    ).padStart(2, "0")}</text>
    <text x="${width - 18}" y="${height - 24}" fill="#687d70" font-size="7" text-anchor="end">AREA ${areaLabel} M²</text>
  </g>
  <g fill="#687d70" font-family="monospace" font-size="6.5" letter-spacing="1">
    <text x="${formatSvg(originX)}" y="${formatSvg(originY + worldHeight * scale + 15)}">W</text>
    <text x="${formatSvg(originX + worldWidth * scale)}" y="${formatSvg(
      originY + worldHeight * scale + 15,
    )}" text-anchor="end">E</text>
    <text x="${formatSvg(originX - 12)}" y="${formatSvg(originY + 6)}">N</text>
  </g>
  ${emptyMessage}
  <style>
    .contour{vector-effect:non-scaling-stroke}
    .empty{fill:#708377;font:7px monospace;letter-spacing:1.2px;text-anchor:middle}
  </style>
</svg>`;
}

function formatSvg(value) {
  return Number(value.toFixed(2)).toString();
}
