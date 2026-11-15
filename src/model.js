/* 程序化建筑数据：3 层，无外部模型文件 */
(function (global) {
  'use strict';

  const FLOOR_H = 4;          // 每层层高（米）
  const FLOOR_COUNT = 3;
  const W = 24;               // 建筑宽（X）
  const D = 14;               // 建筑深（Z）
  const SLAB_T = 0.25;        // 楼板厚度
  const WALL_T = 0.2;         // 内墙厚度
  const WALL_H = 3.6;         // 墙高
  const CORRIDOR = 2;         // 中间走廊宽（Z 方向）

  const USAGES = {
    office:   { label: '办公', color: [0.36, 0.62, 0.95], perArea: 6 },
    meeting:  { label: '会议室', color: [0.95, 0.72, 0.30], perArea: 2 },
    lounge:   { label: '休息区', color: [0.45, 0.82, 0.62], perArea: 3 },
    storage:  { label: '储藏', color: [0.72, 0.66, 0.55], perArea: 12 },
    server:   { label: '机房', color: [0.62, 0.45, 0.82], perArea: 4 },
    lobby:    { label: '大堂', color: [0.92, 0.55, 0.45], perArea: 5 },
    lab:      { label: '实验室', color: [0.30, 0.78, 0.82], perArea: 4 },
    corridor: { label: '走廊', color: [0.62, 0.66, 0.72], perArea: 8 }
  };

  /* 每层 4 列 × 2 排房间（走廊两侧），走廊单独作为一个可拾取空间 */
  const FLOOR_PLAN = [
    ['office', 'meeting', 'office', 'lounge'],
    ['office', 'office', 'meeting', 'lobby'],
    ['lab', 'lab', 'server', 'storage']
  ];

  function buildBuilding() {
    const rooms = [];
    const walls = [];
    const slabs = [];
    const colW = W / 4;
    const sideD = (D - CORRIDOR) / 2;
    let rid = 0;

    for (let f = 0; f < FLOOR_COUNT; f++) {
      const baseY = f * FLOOR_H;
      const plan = FLOOR_PLAN[f];

      for (let c = 0; c < 4; c++) {
        for (let s = 0; s < 2; s++) {
          const x0 = c * colW;
          const z0 = s === 0 ? 0 : (D / 2 + CORRIDOR / 2);
          const usage = plan[c];
          const interiorW = colW - WALL_T;
          const interiorD = sideD - WALL_T;
          const area = round1(interiorW * interiorD);
          rooms.push({
            id: rid++, floor: f, usage,
            name: (f + 1) + 'F-' + USAGES[usage].label + (c + 1) + (s === 0 ? 'A' : 'B'),
            min: [x0, baseY + SLAB_T, z0],
            max: [x0 + colW, baseY + SLAB_T + WALL_H, z0 + sideD],
            center: [x0 + colW / 2, baseY + SLAB_T + 1.6, z0 + sideD / 2],
            area,
            capacity: Math.max(1, Math.floor(area / USAGES[usage].perArea))
          });
        }
      }

      rooms.push({
        id: rid++, floor: f, usage: 'corridor',
        name: (f + 1) + 'F-走廊',
        min: [0, baseY + SLAB_T, D / 2 - CORRIDOR / 2],
        max: [W, baseY + SLAB_T + WALL_H, D / 2 + CORRIDOR / 2],
        center: [W / 2, baseY + SLAB_T + 1.6, D / 2],
        area: round1(W * CORRIDOR),
        capacity: Math.floor(W * CORRIDOR / USAGES.corridor.perArea)
      });

      slabs.push({ min: [0, baseY, 0], max: [W, baseY + SLAB_T, D], floor: f });
      walls.push(...buildFloorWalls(f, baseY, colW, sideD));
    }

    return {
      floors: FLOOR_COUNT, floorH: FLOOR_H,
      width: W, depth: D, totalHeight: FLOOR_COUNT * FLOOR_H,
      rooms, walls, slabs
    };
  }

  function buildFloorWalls(f, baseY, colW, sideD) {
    const out = [];
    const y0 = baseY + SLAB_T;
    const y1 = y0 + WALL_H;
    const add = (x0, z0, x1, z1) =>
      out.push({ floor: f, min: [Math.min(x0, x1), y0, Math.min(z0, z1)],
        max: [Math.max(x0, x1), y1, Math.max(z0, z1)] });

    add(0, 0, W, WALL_T);
    add(0, D - WALL_T, W, D);
    add(0, 0, WALL_T, D);
    add(W - WALL_T, 0, W, D);
    add(0, D / 2 - CORRIDOR / 2 - WALL_T, W, D / 2 - CORRIDOR / 2);
    add(0, D / 2 + CORRIDOR / 2, W, D / 2 + CORRIDOR / 2 + WALL_T);

    for (let c = 1; c < 4; c++) {
      const x = c * colW;
      add(x - WALL_T / 2, 0, x + WALL_T / 2, sideD);
      add(x - WALL_T / 2, D - sideD, x + WALL_T / 2, D);
    }
    return out;
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  function buildPipes() {
    const systems = [
      { id: 'water',   label: '给水管', color: [0.25, 0.65, 1.00], radius: 0.10, z: 5.4 },
      { id: 'drain',   label: '排水管', color: [0.55, 0.45, 0.35], radius: 0.14, z: 5.9 },
      { id: 'hvac',    label: '暖通风管', color: [0.95, 0.75, 0.25], radius: 0.22, z: 6.5 },
      { id: 'power',   label: '电气桥架', color: [1.00, 0.55, 0.35], radius: 0.09, z: 7.1 }
    ];
    const segments = [];
    systems.forEach((sys, si) => {
      const y = 3.1 + si * 0.12;
      for (let f = 0; f < FLOOR_COUNT; f++) {
        const baseY = f * FLOOR_H;
        segments.push({
          system: sys.id, floor: f, radius: sys.radius,
          a: [0.8, baseY + y, sys.z], b: [W - 0.8, baseY + y, sys.z]
        });
        segments.push({
          system: sys.id, floor: f, radius: sys.radius,
          a: [4 + si * 1.2, baseY + y, sys.z],
          b: [4 + si * 1.2, baseY + y, 1.0]
        });
      }
      segments.push({
        system: sys.id, floor: -1, radius: sys.radius,
        a: [2 + si * 1.4, 0.2, sys.z],
        b: [2 + si * 1.4, FLOOR_COUNT * FLOOR_H - 0.4, sys.z]
      });
    });
    return { systems, segments };
  }

  /* 圆管 → 三角网格（沿分段方向拉伸圆周），返回 interleaved 顶点（位置+法线+颜色） */
  function tubeMesh(segments, systemColors, radial) {
    const positions = [], normals = [], colors = [];
    const push = (p, n, col) => {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(col[0], col[1], col[2]);
    };
    segments.forEach(seg => {
      const col = systemColors[seg.system];
      const ax = seg.b[0] - seg.a[0], ay = seg.b[1] - seg.a[1], az = seg.b[2] - seg.a[2];
      const len = Math.hypot(ax, ay, az) || 1;
      const dir = [ax / len, ay / len, az / len];
      const ref = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = M3D.normalize(M3D.cross(dir, ref));
      const v = M3D.normalize(M3D.cross(dir, u));
      const ringA = [], ringB = [];
      for (let i = 0; i < radial; i++) {
        const ang = (i / radial) * Math.PI * 2;
        const n = [
          u[0] * Math.cos(ang) + v[0] * Math.sin(ang),
          u[1] * Math.cos(ang) + v[1] * Math.sin(ang),
          u[2] * Math.cos(ang) + v[2] * Math.sin(ang)
        ];
        ringA.push([seg.a[0] + n[0] * seg.radius, seg.a[1] + n[1] * seg.radius, seg.a[2] + n[2] * seg.radius]);
        ringB.push([seg.b[0] + n[0] * seg.radius, seg.b[1] + n[1] * seg.radius, seg.b[2] + n[2] * seg.radius]);
        ringA[i].n = n;
        ringB[i].n = n;
      }
      for (let i = 0; i < radial; i++) {
        const j = (i + 1) % radial;
        const a0 = ringA[i], a1 = ringA[j], b0 = ringB[i], b1 = ringB[j];
        push(a0, a0.n, col); push(b0, b0.n, col); push(b1, b1.n, col);
        push(a0, a0.n, col); push(b1, b1.n, col); push(a1, a1.n, col);
      }
    });
    return { positions, normals, colors };
  }

  global.BUILD = {
    FLOOR_H, FLOOR_COUNT, W, D, USAGES, buildBuilding, buildPipes, tubeMesh
  };
})(window);
