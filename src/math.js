export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function vec3Normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function vec3Subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const rangeInverse = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (near + far) * rangeInverse,
    -1,
    0,
    0,
    near * far * 2 * rangeInverse,
    0,
  ]);
}

export function mat4LookAt(eye, target, up = [0, 1, 0]) {
  const z = vec3Normalize(vec3Subtract(eye, target));
  const x = vec3Normalize(vec3Cross(up, z));
  const y = vec3Cross(z, x);

  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -vec3Dot(x, eye),
    -vec3Dot(y, eye),
    -vec3Dot(z, eye),
    1,
  ]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    for (let row = 0; row < 4; row += 1) {
      out[offset + row] =
        a[row] * b[offset] +
        a[4 + row] * b[offset + 1] +
        a[8 + row] * b[offset + 2] +
        a[12 + row] * b[offset + 3];
    }
  }
  return out;
}

export function mat4RotationY(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    cosine,
    0,
    -sine,
    0,
    0,
    1,
    0,
    0,
    sine,
    0,
    cosine,
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function mat4RotationX(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    1,
    0,
    0,
    0,
    0,
    cosine,
    sine,
    0,
    0,
    -sine,
    cosine,
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function mat4Translation(x, y, z) {
  return new Float32Array([
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    x,
    y,
    z,
    1,
  ]);
}

export function mat3FromMat4(matrix) {
  return new Float32Array([
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[8],
    matrix[9],
    matrix[10],
  ]);
}
