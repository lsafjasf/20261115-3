// 所有着色器源码。场景不加载任何纹理，噪声/地形/天空全部程序化生成。
"use strict";

// ---------- 公共 GLSL：噪声与地形高度 ----------
// 地形高度函数同时被地形 pass 与水面 pass 使用：
// 水面 shader 用它解析求水深与地形坡度，无需深度纹理。
const GLSL_COMMON = `
float hash21(vec2 p){
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
// 3 阶版本：细波纹/泡沫等高频细节使用，降低片元开销
float fbm3(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 3; i++){
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
// 海岸地形：整体沿 +x 抬升，叠加 fbm 起伏，形成海湾与岬角
float terrainH(vec2 p){
  float base = -3.2 + (p.x + 26.0) * 0.115;
  float hills = (fbm(p * 0.055) - 0.5) * 7.0;
  float detail = (fbm(p * 0.30 + 4.7) - 0.5) * 1.1;
  return base + hills * smoothstep(-14.0, 6.0, p.x) + detail;
}
vec3 skyColor(vec3 dir, vec3 sunDir){
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 sky = mix(vec3(0.78, 0.86, 0.94), vec3(0.22, 0.46, 0.78), pow(t, 0.6));
  float s = max(dot(dir, sunDir), 0.0);
  sky += vec3(1.0, 0.75, 0.45) * pow(s, 350.0) * 4.0;  // 太阳盘
  sky += vec3(1.0, 0.80, 0.55) * pow(s, 8.0) * 0.18;   // 日晕
  return sky;
}
`;

// ---------- 天空全屏四边形 ----------
const SKY_VS = `
attribute vec2 aPos;
varying vec2 vUV;
void main(){ vUV = aPos; gl_Position = vec4(aPos, 0.999, 1.0); }
`;
const SKY_FS = `
precision highp float;
varying vec2 vUV;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanFov;
uniform float uAspect;
${GLSL_COMMON}
void main(){
  vec3 dir = normalize(uCamFwd + uCamRight * (vUV.x * uAspect * uTanFov)
                              + uCamUp * (vUV.y * uTanFov));
  gl_FragColor = vec4(skyColor(dir, uSunDir), 1.0);
}
`;

// ---------- 地形 ----------
const TERRAIN_VS = `
attribute vec2 aXZ;
uniform mat4 uVP;
varying vec3 vPos;
${GLSL_COMMON}
void main(){
  float h = terrainH(aXZ);
  vPos = vec3(aXZ.x, h, aXZ.y);
  gl_Position = uVP * vec4(vPos, 1.0);
}
`;
const TERRAIN_FS = `
precision highp float;
varying vec3 vPos;
uniform vec3 uSunDir;
uniform float uTide;
${GLSL_COMMON}
void main(){
  float e = 0.35;
  vec2 p = vPos.xz;
  vec3 n = normalize(vec3(
    terrainH(p - vec2(e, 0.0)) - terrainH(p + vec2(e, 0.0)),
    2.0 * e,
    terrainH(p - vec2(0.0, e)) - terrainH(p + vec2(0.0, e))));
  float slope = 1.0 - n.y;
  float h = vPos.y;

  vec3 sand = vec3(0.76, 0.70, 0.52);
  vec3 grass = vec3(0.30, 0.46, 0.24);
  vec3 rock = vec3(0.42, 0.40, 0.38);
  vec3 col = mix(sand, grass, smoothstep(0.4, 1.6, h + (fbm(p * 0.6) - 0.5)));
  col = mix(col, rock, smoothstep(0.25, 0.55, slope));
  // 潮线附近湿沙
  col = mix(col, sand * 0.72, 1.0 - smoothstep(0.05, 0.45, abs(h - uTide)));

  float diff = max(dot(n, uSunDir), 0.0);
  vec3 lit = col * (0.28 + 0.85 * diff * vec3(1.0, 0.93, 0.82));
  gl_FragColor = vec4(lit, 1.0);
}
`;

// ---------- 水面 ----------
// 顶点：4 个正弦波分量叠加（色散关系 w=sqrt(gk)），波形参数由风场预设给出。
const WATER_VS = `
attribute vec2 aXZ;
uniform mat4 uVP;
uniform float uTime;
uniform float uTide;
uniform float uAmpScale;    // 风速缩放后的振幅系数
uniform float uSpdScale;    // 风速缩放后的波速系数
uniform vec4 uWaves[4];     // dirX, dirZ, 振幅, 波长
uniform vec4 uWavePh[4];    // 初相位, 方向权重(未用), 0, 0
varying vec3 vPos;
varying vec2 vGrad;         // 大波梯度（用于法线）
varying float vCrest;       // 波峰因子（泡沫用）
void main(){
  vec2 p = aXZ;
  float h = 0.0;
  vec2 g = vec2(0.0);
  float crest = 0.0;
  for(int i = 0; i < 4; i++){
    vec2 d = uWaves[i].xy;
    float amp = uWaves[i].z * uAmpScale;
    float k = 6.2831853 / uWaves[i].w;
    float w = sqrt(9.81 * k) * uSpdScale;
    float ph = dot(d, p) * k - w * uTime + uWavePh[i].x;
    h += amp * sin(ph);
    g += d * (amp * k * cos(ph));
    crest += amp * k * sin(ph);
  }
  vPos = vec3(p.x, uTide + h, p.y);
  vGrad = g;
  vCrest = crest;
  gl_Position = uVP * vec4(vPos, 1.0);
}
`;

// 片元：折射（采样离屏场景纹理）+ 深度雾 + 坡度相关岸边泡沫 + 菲涅尔天空反射
const WATER_FS = `
precision highp float;
varying vec3 vPos;
varying vec2 vGrad;
varying float vCrest;
uniform sampler2D uScene;   // 离屏渲染的地形+天空
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uTide;
uniform float uWind;
uniform float uRipple;      // 细波纹强度（随风速）
uniform int uDebug;         // 0 正常 1 仅折射 2 泡沫 3 深度 4 遮挡检验
${GLSL_COMMON}

// 细波纹：两层滚动噪声的数值梯度，扰动法线
vec2 rippleGrad(vec2 p, float t){
  vec2 q1 = p * 1.7 + vec2(t * 0.55, t * 0.32);
  vec2 q2 = p * 3.1 + vec2(-t * 0.42, t * 0.61);
  float e = 0.09;
  float gx = (fbm3(q1 + vec2(e, 0.0)) - fbm3(q1 - vec2(e, 0.0)))
           + (fbm3(q2 + vec2(e, 0.0)) - fbm3(q2 - vec2(e, 0.0))) * 0.6;
  float gz = (fbm3(q1 + vec2(0.0, e)) - fbm3(q1 - vec2(0.0, e)))
           + (fbm3(q2 + vec2(0.0, e)) - fbm3(q2 - vec2(0.0, e))) * 0.6;
  return vec2(gx, gz) / (2.0 * e);
}

void main(){
  vec2 p = vPos.xz;

  // --- 法线：大波梯度 + 细波纹 ---
  vec2 rg = rippleGrad(p, uTime) * uRipple;
  vec3 n = normalize(vec3(-(vGrad.x + rg.x), 1.0, -(vGrad.y + rg.y)));

  // --- 水深与地形坡度（解析地形函数，无需深度纹理）---
  float depth = max(uTide - terrainH(p), 0.0);
  float e = 0.3;
  vec2 tgrad = vec2(terrainH(p + vec2(e, 0.0)) - terrainH(p - vec2(e, 0.0)),
                    terrainH(p + vec2(0.0, e)) - terrainH(p - vec2(0.0, e))) / (2.0 * e);
  float slope = length(tgrad);

  // --- 折射：按法线偏移采样离屏场景 ---
  vec2 uv = gl_FragCoord.xy / uRes;
  float refrAmt = 0.06 * clamp(depth, 0.0, 1.2);
  vec2 ruv = clamp(uv + n.xz * refrAmt, vec2(0.001), vec2(0.999));
  vec3 refr = texture2D(uScene, ruv).rgb;
  // 水体吸收：随深度衰减红光
  refr *= vec3(exp(-depth * 0.45), exp(-depth * 0.18), exp(-depth * 0.10));

  // --- 深度雾：浅绿 -> 深蓝 ---
  vec3 shallowCol = vec3(0.16, 0.42, 0.45);
  vec3 deepCol = vec3(0.015, 0.09, 0.20);
  float fogF = 1.0 - exp(-depth * 0.55);
  vec3 waterCol = mix(mix(refr, shallowCol, 0.35), deepCol, fogF);

  // --- 菲涅尔天空反射 ---
  vec3 V = normalize(uCamPos - vPos);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, n), 0.0), 5.0);
  vec3 skyRef = skyColor(R, uSunDir);
  vec3 col = mix(waterCol, skyRef, fres);

  // --- 太阳高光 ---
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(n, H), 0.0), 240.0) * 1.6
             + pow(max(dot(n, H), 0.0), 60.0) * 0.25;
  col += vec3(1.0, 0.9, 0.75) * spec;

  // --- 岸边泡沫：密度随波带宽度变化，波带宽度与地形坡度成反比 ---
  // 缓坡 -> 潮间带宽 -> 泡沫带宽且密；陡坡 -> 窄而稀。
  float band = 0.9 / (0.12 + slope * 1.6);          // 泡沫带宽度(米)
  float edge = 1.0 - smoothstep(0.0, band, depth);  // 水线处为 1
  float foamN = fbm3(p * 1.9 + vec2(uTime * 0.35, -uTime * 0.27));
  float foamN2 = fbm3(p * 4.3 - vec2(uTime * 0.22, uTime * 0.4));
  // 波冲上岸时的脉动：用波峰因子调制
  float surge = 0.5 + 0.5 * sin(uTime * 1.3 - depth * 4.0 / max(band, 0.2));
  float foamDens = edge * (0.45 + 0.55 * surge);
  float foam = smoothstep(0.55, 0.8, foamDens * (0.55 + 0.45 * foamN) + foamN2 * 0.12 * edge);
  // 开阔水域波峰白沫（高风速时）
  float cap = smoothstep(0.42, 0.85, vCrest * 1.2 + foamN * 0.55)
            * smoothstep(6.0, 13.0, uWind) * 0.7;
  foam = clamp(foam + cap, 0.0, 1.0);
  vec3 foamCol = vec3(0.93, 0.96, 0.97);
  // 泡沫最后叠加 -> 遮挡其下的折射地形
  col = mix(col, foamCol, foam * 0.92);

  // --- 调试视图 ---
  if(uDebug == 1){ col = refr; }
  else if(uDebug == 2){ col = vec3(foam); }
  else if(uDebug == 3){ col = mix(vec3(0.1,0.6,0.4), vec3(0.0,0.0,0.4), fogF); }
  else if(uDebug == 4){
    // 遮挡检验：泡沫覆盖处显示红色，其余显示折射内容
    col = mix(refr, vec3(1.0, 0.1, 0.1), step(0.25, foam));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
