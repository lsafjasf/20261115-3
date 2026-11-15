export const skyVertexShader = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.9999, 1.0);
}
`;

export const skyFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float starLayer(vec2 uv, float scale, float threshold) {
  vec2 grid = uv * scale;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float seed = hash21(cell);
  float size = mix(0.012, 0.045, hash21(cell + 9.2));
  float star = smoothstep(size, 0.0, length(local) * 0.75);
  float isVisible = step(threshold, seed);
  float twinkle = 0.45 + 0.55 * sin(uTime * (0.4 + seed) + seed * 30.0);
  return star * isVisible * twinkle;
}

void main() {
  vec2 centered = vUv - 0.5;
  centered.x *= uResolution.x / max(uResolution.y, 1.0);

  vec3 top = vec3(0.027, 0.067, 0.087);
  vec3 bottom = vec3(0.006, 0.024, 0.034);
  vec3 color = mix(bottom, top, smoothstep(0.0, 1.0, vUv.y));

  float halo = exp(-dot(centered, centered) * 5.5);
  color += vec3(0.018, 0.087, 0.079) * halo * 1.55;
  color += vec3(0.01, 0.033, 0.045) * exp(-abs(centered.y + 0.23) * 9.0);

  float stars = starLayer(vUv, 74.0, 0.89);
  stars += starLayer(vUv + 0.17, 41.0, 0.945) * 1.7;
  stars += starLayer(vUv + 0.73, 123.0, 0.972) * 0.6;
  color += vec3(0.5, 0.88, 0.86) * clamp(stars, 0.0, 1.7);

  float grain = hash21(gl_FragCoord.xy + uTime * 0.01) - 0.5;
  color += grain * 0.012;
  color *= 1.0 - distance(vUv, vec2(0.5)) * 0.34;

  outColor = vec4(color, 1.0);
}
`;

export const surfaceVertexShader = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;

void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(uNormalMatrix * aNormal);
  vUv = aUv;
  gl_Position = uProjection * uView * worldPosition;
}
`;

export const surfaceFragmentShader = `#version 300 es
precision highp float;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUv;

out vec4 outColor;

uniform sampler2D uTexture;
uniform vec3 uTint;
uniform vec3 uEmissiveColor;
uniform vec3 uCameraPosition;
uniform float uTime;
uniform float uEmissive;
uniform float uTexScale;
uniform float uOpacity;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  vec3 lightDirection = normalize(vec3(-0.55, 0.92, 0.42));
  vec3 textureSample = texture(uTexture, vUv * uTexScale).rgb;

  float diffuse = max(dot(normal, lightDirection), 0.0);
  float fill = max(dot(normal, normalize(vec3(0.42, 0.1, -0.8))), 0.0) * 0.24;
  float facing = max(dot(normal, viewDirection), 0.0);
  float rim = pow(1.0 - facing, 2.8);
  float specular = pow(max(dot(reflect(-lightDirection, normal), viewDirection), 0.0), 22.0);

  vec3 albedo = uTint * (0.34 + textureSample * 1.16);
  vec3 color = albedo * (0.2 + diffuse * 0.92 + fill);
  color += vec3(0.31, 0.86, 0.78) * rim * 0.25;
  color += vec3(0.82, 0.96, 0.92) * specular * 0.42;
  color += uEmissiveColor * uEmissive * (0.52 + textureSample.g * 1.35);

  float scan = smoothstep(0.48, 1.0, sin(vWorldPosition.y * 2.8 - uTime * 0.65) * 0.5 + 0.5);
  color += uEmissiveColor * scan * uEmissive * 0.2;

  float distanceToCamera = distance(vWorldPosition, uCameraPosition);
  float fog = smoothstep(13.0, 31.0, distanceToCamera);
  color = mix(color, vec3(0.016, 0.050, 0.060), fog * 0.58);

  outColor = vec4(color, uOpacity);
}
`;

export const lineVertexShader = `#version 300 es
in vec3 aPosition;

uniform mat4 uProjection;
uniform mat4 uView;
uniform float uTime;

out float vPulse;
out float vHeight;

void main() {
  vec3 position = aPosition;
  vPulse = sin(position.x * 1.7 + position.z * 1.34 + uTime * 1.45) * 0.5 + 0.5;
  vHeight = smoothstep(-0.2, 3.2, position.y);
  gl_Position = uProjection * uView * vec4(position, 1.0);
}
`;

export const lineFragmentShader = `#version 300 es
precision highp float;

in float vPulse;
in float vHeight;
out vec4 outColor;

uniform vec3 uColor;
uniform float uIntensity;

void main() {
  float alpha = (0.2 + vPulse * 0.54 + vHeight * 0.2) * uIntensity;
  outColor = vec4(uColor * (0.75 + vPulse * 0.65), alpha);
}
`;
