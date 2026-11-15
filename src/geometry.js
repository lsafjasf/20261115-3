import { vec3Normalize } from "./math.js";

const FLOATS_PER_VERTEX = 8;

function terrainHeight(x, z) {
  return (
    -0.19 +
    Math.sin(x * 0.43 + 0.8) * Math.cos(z * 0.37) * 0.13 +
    Math.sin((x + z) * 0.72) * 0.035
  );
}

function packVertex(target, position, normal, uv) {
  target.push(
    position[0],
    position[1],
    position[2],
    normal[0],
    normal[1],
    normal[2],
    uv[0],
    uv[1],
  );
}

function addQuad(target, indices, corners, normal, uvScale = 1) {
  const base = target.length / FLOATS_PER_VERTEX;
  const uvs = [
    [0, 0],
    [uvScale, 0],
    [uvScale, uvScale],
    [0, uvScale],
  ];

  corners.forEach((corner, index) => {
    packVertex(target, corner, normal, uvs[index]);
  });

  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function transformPoint(point, center, yaw) {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [
    center[0] + point[0] * cosine + point[2] * sine,
    center[1] + point[1],
    center[2] - point[0] * sine + point[2] * cosine,
  ];
}

function appendBox(target, indices, center, size, yaw) {
  const halfWidth = size[0] / 2;
  const halfHeight = size[1] / 2;
  const halfDepth = size[2] / 2;
  const local = [
    [-halfWidth, -halfHeight, -halfDepth],
    [halfWidth, -halfHeight, -halfDepth],
    [halfWidth, halfHeight, -halfDepth],
    [-halfWidth, halfHeight, -halfDepth],
    [-halfWidth, -halfHeight, halfDepth],
    [halfWidth, -halfHeight, halfDepth],
    [halfWidth, halfHeight, halfDepth],
    [-halfWidth, halfHeight, halfDepth],
  ];
  const points = local.map((point) => transformPoint(point, center, yaw));

  const normal = (value) => vec3Normalize([
    value[0] * Math.cos(yaw) + value[2] * Math.sin(yaw),
    value[1],
    -value[0] * Math.sin(yaw) + value[2] * Math.cos(yaw),
  ]);

  addQuad(target, indices, [points[4], points[5], points[6], points[7]], normal([0, 0, 1]));
  addQuad(target, indices, [points[1], points[0], points[3], points[2]], normal([0, 0, -1]));
  addQuad(target, indices, [points[5], points[1], points[2], points[6]], normal([1, 0, 0]));
  addQuad(target, indices, [points[0], points[4], points[7], points[3]], normal([-1, 0, 0]));
  addQuad(target, indices, [points[3], points[7], points[6], points[2]], normal([0, 1, 0]));
  addQuad(target, indices, [points[0], points[1], points[5], points[4]], normal([0, -1, 0]));
}

export function buildTerrain(size = 25, segments = 48) {
  const vertices = [];
  const indices = [];
  const step = size / segments;
  const epsilon = 0.03;

  for (let row = 0; row <= segments; row += 1) {
    const z = -size / 2 + row * step;
    for (let column = 0; column <= segments; column += 1) {
      const x = -size / 2 + column * step;
      const height = terrainHeight(x, z);
      const slopeX = (terrainHeight(x + epsilon, z) - terrainHeight(x - epsilon, z)) / (epsilon * 2);
      const slopeZ = (terrainHeight(x, z + epsilon) - terrainHeight(x, z - epsilon)) / (epsilon * 2);
      const normal = vec3Normalize([-slopeX, 1, -slopeZ]);
      packVertex(vertices, [x, height, z], normal, [column / segments, row / segments]);
    }
  }

  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const topLeft = row * (segments + 1) + column;
      const bottomLeft = (row + 1) * (segments + 1) + column;
      indices.push(topLeft, bottomLeft, topLeft + 1);
      indices.push(topLeft + 1, bottomLeft, bottomLeft + 1);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    indexCount: indices.length,
  };
}

export function buildStructures() {
  const vertices = [];
  const indices = [];

  for (let index = 0; index < 28; index += 1) {
    const angle = (index / 28) * Math.PI * 2;
    const radius = 7.4 + Math.sin(index * 2.13) * 0.38;
    const height = 0.85 + ((index * 7) % 11) * 0.16;
    const width = 0.22 + ((index * 3) % 4) * 0.035;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ground = terrainHeight(x, z);
    appendBox(
      vertices,
      indices,
      [x, ground + height / 2, z],
      [width, height, width * 0.72],
      -angle + 0.18,
    );
  }

  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2 + 0.17;
    const radius = 4.55;
    const height = 0.38 + (index % 3) * 0.13;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ground = terrainHeight(x, z);
    appendBox(
      vertices,
      indices,
      [x, ground + height / 2, z],
      [0.36, height, 0.36],
      -angle,
    );
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    indexCount: indices.length,
  };
}

export function buildCore(radius = 0.78, stacks = 22, slices = 30) {
  const vertices = [];
  const indices = [];

  for (let stack = 0; stack <= stacks; stack += 1) {
    const v = stack / stacks;
    const phi = v * Math.PI;
    for (let slice = 0; slice <= slices; slice += 1) {
      const u = slice / slices;
      const theta = u * Math.PI * 2;
      const normal = [
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ];
      packVertex(
        vertices,
        [normal[0] * radius, normal[1] * radius, normal[2] * radius],
        normal,
        [u, 1 - v],
      );
    }
  }

  for (let stack = 0; stack < stacks; stack += 1) {
    for (let slice = 0; slice < slices; slice += 1) {
      const first = stack * (slices + 1) + slice;
      const second = first + slices + 1;
      indices.push(first, first + 1, second, first + 1, second + 1, second);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    indexCount: indices.length,
  };
}

function appendCircle(vertices, center, radius, segments, tilt = 0) {
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    vertices.push(
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius * tilt,
      center[2] + Math.sin(angle) * radius,
    );
  }
}

export function buildLineField() {
  const vertices = [];
  const ranges = [];

  let start = vertices.length / 3;
  appendCircle(vertices, [0, 2.42, 0], 1.55, 112, 0.08);
  ranges.push({ first: start, count: 112, mode: "LINE_LOOP" });

  start = vertices.length / 3;
  appendCircle(vertices, [0, 2.42, 0], 2.22, 144, 0.18);
  ranges.push({ first: start, count: 144, mode: "LINE_LOOP" });

  start = vertices.length / 3;
  appendCircle(vertices, [0, 0.035, 0], 9.8, 180);
  ranges.push({ first: start, count: 180, mode: "LINE_LOOP" });

  start = vertices.length / 3;
  appendCircle(vertices, [0, 0.034, 0], 10.15, 180);
  ranges.push({ first: start, count: 180, mode: "LINE_LOOP" });

  start = vertices.length / 3;
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const inner = 4.2;
    const outer = 9.65;
    vertices.push(
      Math.cos(angle) * inner,
      0.04,
      Math.sin(angle) * inner,
      Math.cos(angle) * outer,
      0.04,
      Math.sin(angle) * outer,
    );
  }
  ranges.push({ first: start, count: 24, mode: "LINES" });

  return {
    vertices: new Float32Array(vertices),
    indexCount: vertices.length / 3,
    ranges,
  };
}
