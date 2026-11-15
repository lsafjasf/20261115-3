// 四声道空间播放器核心引擎：房间几何、距离建模、三种播放模式的增益/延迟/频段参数。
// 纯函数实现，浏览器（实时 + 离线导出）与 Node（自动验证）共用同一份代码。

export const SOUND_SPEED = 343; // 声速 m/s

export const DEFAULT_ROOM = { x: 0, y: 0, width: 8, height: 6 };
export const DEFAULT_LISTENER = { x: 4, y: 3, angle: 0 }; // angle: 朝向，弧度，0 = 朝 +x
export const DEFAULT_SOURCE = { x: 2, y: 1.5 };

export const MODES = {
  stereo: { id: 'stereo', label: '普通立体声', channels: 2 },
  binaural: { id: 'binaural', label: '双耳 (ITD/ILD)', channels: 2 },
  quad: { id: 'quad', label: '四点环绕', channels: 4 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 房间坐标 → 确保声源/监听器不越界
export function clampToRoom(pos, room, margin = 0.15) {
  return {
    x: clamp(pos.x, room.x + margin, room.x + room.width - margin),
    y: clamp(pos.y, room.y + margin, room.y + room.height - margin),
  };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 声源相对监听器朝向的方位角：正前方 0，左侧为正，范围 (-pi, pi]
export function relativeAngle(source, listener) {
  const bearing = Math.atan2(source.y - listener.y, source.x - listener.x);
  let theta = bearing - listener.angle;
  while (theta > Math.PI) theta -= 2 * Math.PI;
  while (theta <= -Math.PI) theta += 2 * Math.PI;
  return theta;
}

// 距离参数：传播延迟、距离增益、空气吸收低通截止、三分段增益。
// 低/中/高频随距离衰减速度不同（空气对高频吸收更强）。
export function distanceParams(dist, options = {}) {
  const rolloff = options.rolloff ?? 1.0;
  const d = Math.max(dist, 0.05);
  const delaySec = d / SOUND_SPEED;
  const distanceGain = 1 / (1 + rolloff * d);
  // 1m 处几乎不滤波，距离越远截止频率越低（指数模型）
  const lowpassHz = clamp(18000 * Math.exp(-0.22 * rolloff * d), 300, 18000);
  // 以 250Hz / 2000Hz 为分界的三分段增益（简化的频段空气吸收模型）
  const lowGain = clamp(1.0 - 0.012 * d, 0.25, 1);
  const midGain = clamp(1.0 - 0.045 * d, 0.15, 1);
  const highGain = clamp(1.0 - 0.11 * d, 0.05, 1);
  return {
    distance: round4(d),
    delaySec: round6(delaySec),
    delayMs: round4(delaySec * 1000),
    distanceGain: round6(distanceGain),
    lowpassHz: Math.round(lowpassHz),
    bandGains: {
      low: round6(lowGain),
      mid: round6(midGain),
      high: round6(highGain),
    },
  };
}

// 镜像声源法：四面墙各产生一次一阶反射
export function imageSources(source, room) {
  const { x: rx, y: ry, width: w, height: h } = room;
  return [
    { wall: 'left', x: 2 * rx - source.x, y: source.y },
    { wall: 'right', x: 2 * (rx + w) - source.x, y: source.y },
    { wall: 'top', x: source.x, y: 2 * ry - source.y },
    { wall: 'bottom', x: source.x, y: 2 * (ry + h) - source.y },
  ];
}

function round4(v) { return Math.round(v * 1e4) / 1e4; }
function round6(v) { return Math.round(v * 1e6) / 1e6; }

// 计算一次“声径”（直达声或某条镜像反射）在指定模式下每通道的增益
function tapPanning(theta, mode) {
  if (mode === 'stereo') {
    // 等功率声像：左侧声源 theta>0 → 左声道
    const pan = clamp(-Math.sin(theta), -1, 1);
    const l = Math.cos((pan + 1) * Math.PI / 4);
    const r = Math.sin((pan + 1) * Math.PI / 4);
    return { gains: [l, r], extraDelay: [0, 0], extraCutoff: [null, null] };
  }
  if (mode === 'binaural') {
    return binauralPanning(theta);
  }
  return quadPanning(theta);
}

// 双耳模型：ITD（双耳时间差）+ ILD（双耳声级差）+ 声学阴影低通
const HEAD_RADIUS = 0.0875;

function binauralPanning(theta) {
  // Woodworth 近似 ITD；theta>0 声音来自左侧，左耳先到
  const itd = (HEAD_RADIUS / SOUND_SPEED) * (theta + Math.sin(theta));
  const leftDelay = itd > 0 ? 0 : -itd;
  const rightDelay = itd > 0 ? itd : 0;
  // ILD：远侧耳衰减，方位越偏越大，最高约 6dB
  const ildDb = -6 * Math.abs(Math.sin(theta));
  const farAtten = Math.pow(10, ildDb / 20);
  const leftGain = itd >= 0 ? 1 : farAtten;
  const rightGain = itd >= 0 ? farAtten : 1;
  // 远侧耳头部阴影：低通，正侧方时最低约 700Hz
  const farCutoff = clamp(18000 - (18000 - 700) * Math.abs(Math.sin(theta)), 700, 18000);
  return {
    gains: [leftGain, rightGain],
    extraDelay: [leftDelay, rightDelay],
    extraCutoff: [itd >= 0 ? null : farCutoff, itd >= 0 ? farCutoff : null],
  };
}

// 四点环绕：FL/FR/BL/BR 布置在房间四角方向，相邻两扇区做 VBAP 风格增益分配
const QUAD_SPEAKERS = [
  { ch: 0, name: 'FL', angle: Math.PI / 4 },
  { ch: 1, name: 'FR', angle: -Math.PI / 4 },
  { ch: 2, name: 'BR', angle: (-3 * Math.PI) / 4 },
  { ch: 3, name: 'BL', angle: (3 * Math.PI) / 4 },
];

function quadPanning(theta) {
  const gains = [0, 0, 0, 0];
  // 把 theta 映射到最近的两个扬声器之间的扇区
  const angles = QUAD_SPEAKERS.map((s) => s.angle);
  let prev = QUAD_SPEAKERS[3];
  for (const spk of QUAD_SPEAKERS) {
    if (angleInArc(theta, spk.angle, prev.angle)) {
      const span = arcSpan(prev.angle, spk.angle);
      let t = arcSpan(prev.angle, theta) / span; // 0=prev, 1=spk
      t = clamp(t, 0, 1);
      const g1 = Math.cos(t * Math.PI / 2);
      const g2 = Math.sin(t * Math.PI / 2);
      gains[prev.ch] = g1;
      gains[spk.ch] = g2;
      break;
    }
    prev = spk;
  }
  return { gains, extraDelay: [0, 0, 0, 0], extraCutoff: [null, null, null, null] };
}

function angleInArc(theta, a1, a2) {
  let t = theta;
  while (t < Math.min(a1, a2)) t += 2 * Math.PI;
  return t >= Math.min(a1, a2) && t < Math.max(a1, a2);
}

function arcSpan(a, b) {
  let d = b - a;
  while (d <= 0) d += 2 * Math.PI;
  return d;
}

export const DEFAULT_OPTIONS = {
  rolloff: 1.0,
  reflectionGain: 0.32, // 墙面反射系数
  wallLowpassHz: 4000, // 墙面反射额外低通
};

export function makeState(partial = {}) {
  return {
    room: { ...DEFAULT_ROOM, ...(partial.room || {}) },
    listener: { ...DEFAULT_LISTENER, ...(partial.listener || {}) },
    source: { ...DEFAULT_SOURCE, ...(partial.source || {}) },
    mode: partial.mode || 'stereo',
    options: { ...DEFAULT_OPTIONS, ...(partial.options || {}) },
  };
}

// 切换播放模式：只改 mode，几何坐标原样保留
export function withMode(state, mode) {
  if (!MODES[mode]) throw new Error(`未知模式: ${mode}`);
  return { ...state, mode };
}

function buildTap(kind, pathEnd, sourcePos, listener, mode, options, wall) {
  const dist = distance(pathEnd, listener);
  const acoustic = distanceParams(dist, options);
  const azimuth = relativeAngle(pathEnd, listener);
  const pan = tapPanning(azimuth, mode);
  const channels = MODES[mode].channels;
  let wallCutoff = null;
  let coefficient = 1;
  if (kind === 'reflection') {
    wallCutoff = options.wallLowpassHz;
    coefficient = options.reflectionGain;
  }
  const perChannel = Array.from({ length: channels }, (_, ch) => {
    const cutoffs = [acoustic.lowpassHz, pan.extraCutoff[ch], wallCutoff]
      .filter((v) => v !== null && v !== undefined);
    return {
      channel: ch,
      gain: round6(acoustic.distanceGain * coefficient * pan.gains[ch]),
      delaySec: round6(acoustic.delaySec + pan.extraDelay[ch]),
      lowpassHz: Math.round(Math.min(...cutoffs)),
    };
  });
  return {
    kind,
    wall: wall || null,
    path: { from: { ...sourcePos }, image: { ...pathEnd }, to: { ...listener } },
    azimuth: round4(azimuth),
    ...acoustic,
    reflectionCoefficient: coefficient,
    perChannel,
  };
}

// 主入口：根据当前状态生成完整空间声学模型（供实时播放、离线渲染、JSON 导出共用）
export function computeSpatialModel(input) {
  const state = input.mode ? input : makeState(input);
  const { room, listener, source, mode, options } = state;
  const channels = MODES[mode].channels;

  const direct = buildTap('direct', source, source, listener, mode, options);
  const reflections = imageSources(source, room).map((img) =>
    buildTap('reflection', img, source, listener, mode, options, img.wall));

  // 每个通道的汇总参数（所有声径能量合并后的总增益、最短延迟）
  const channelSummaries = Array.from({ length: channels }, (_, ch) => {
    const taps = [direct, ...reflections];
    const energy = taps.reduce((sum, tap) => sum + tap.perChannel[ch].gain ** 2, 0);
    const minDelay = Math.min(...taps.map((tap) => tap.perChannel[ch].delaySec));
    const minCutoff = Math.min(...taps.map((tap) => tap.perChannel[ch].lowpassHz));
    return {
      channel: ch,
      name: channelName(mode, ch),
      totalGain: round6(Math.sqrt(energy)),
      minDelaySec: round6(minDelay),
      minDelayMs: round4(minDelay * 1000),
      minLowpassHz: Math.round(minCutoff),
    };
  });

  return {
    mode,
    modeLabel: MODES[mode].label,
    channels,
    soundSpeed: SOUND_SPEED,
    room: { ...room },
    listener: { ...listener },
    source: { ...source },
    options: { ...options },
    wallDistances: wallDistances(source, room),
    direct,
    reflections,
    taps: [direct, ...reflections],
    channelSummaries,
    generatedAt: new Date().toISOString(),
  };
}

export function channelName(mode, ch) {
  if (mode === 'quad') return ['FL', 'FR', 'BR', 'BL'][ch];
  return ['L', 'R'][ch];
}

export function wallDistances(source, room) {
  const { x: rx, y: ry, width: w, height: h } = room;
  return {
    left: round4(source.x - rx),
    right: round4(rx + w - source.x),
    top: round4(source.y - ry),
    bottom: round4(ry + h - source.y),
  };
}
