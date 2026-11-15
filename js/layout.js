// 纯几何 / 排版参数模块：不依赖 DOM，可在 Node 中直接测试。

export const WIDTH_STEPS = [0.7, 0.85, 1.0, 1.15, 1.3];

// 仅使用系统字体，不加载任何外部字体文件。
export const FONT_STACK = [
  "system-ui",
  "-apple-system",
  "Segoe UI",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans CJK SC",
  "WenQuanYi Micro Hei",
  "sans-serif",
].join(", ");

// 以 em 为单位的保守墨盒估计（覆盖升部 / 降部），用于形变后包围盒与重叠检测。
export const INK = {
  ascentEm: 0.8,
  descentEm: 0.25,
};

export const LAYOUT = {
  padX: 48,
  padTop: 56,
  padBottom: 48,
  labelColumn: 168,
  lineEm: 1.25,
  rowGapEm: 0.9,
  baselineInsetEm: 0.82,
  maxStrokeEm: 0.075,
};

// 字重模拟：300/400 走系统原生字重，500+ 在 400 基础上用 SVG stroke 加粗。
export function baseFontWeight(weight) {
  return weight < 400 ? 300 : 400;
}

export function strokeEmForWeight(weight) {
  if (weight <= 400) return 0;
  return ((weight - 400) / 500) * LAYOUT.maxStrokeEm;
}

// 字宽 + 倾斜合并为单个 2x3 矩阵：x' = s*x + tan(a)*y，y' = y。
export function morphMatrix(scaleX, slantDeg) {
  const tan = Math.tan((slantDeg * Math.PI) / 180);
  return `matrix(${round6(scaleX)} ${round6(tan)} 0 1 0 0)`;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

// 文本未形变时的墨盒（包含描边外扩），坐标基于基线原点 (0,0)。
export function inkBox(textWidthPx, fontSizePx, strokeWidthPx) {
  const half = strokeWidthPx / 2;
  return {
    minX: -half,
    maxX: textWidthPx + half,
    minY: -INK.ascentEm * fontSizePx - half,
    maxY: INK.descentEm * fontSizePx + half,
  };
}

// 对包围盒施加 matrix(s, tan, 0, 1, 0, 0)，平移到文本基线 (originX, baselineY)。
export function transformBox(box, scaleX, slantDeg, originX, baselineY) {
  const tan = Math.tan((slantDeg * Math.PI) / 180);
  const corners = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const tx = originX + scaleX * x + tan * y;
    const ty = baselineY + y;
    minX = Math.min(minX, tx);
    maxX = Math.max(maxX, tx);
    minY = Math.min(minY, ty);
    maxY = Math.max(maxY, ty);
  }
  return { minX, maxX, minY, maxY };
}

function intersects(a, b) {
  return (
    a.minX < b.maxX &&
    b.minX < a.maxX &&
    a.minY < b.maxY &&
    b.minY < a.maxY
  );
}

// measureFn(text, fontPx, weight) -> 未压缩的文本像素宽度。
export function computeLayout(state, measureFn) {
  const { text, fontSize, weight, slant } = state;
  const strokeEm = strokeEmForWeight(weight);
  const strokeWidth = strokeEm * fontSize;
  const nativeWeight = baseFontWeight(weight);
  const rowPitch = fontSize * (LAYOUT.lineEm + LAYOUT.rowGapEm);
  const contentLeft = LAYOUT.padX + LAYOUT.labelColumn;

  const rows = WIDTH_STEPS.map((scale, index) => {
    const baselineY =
      LAYOUT.padTop +
      fontSize * LAYOUT.baselineInsetEm +
      index * rowPitch;
    const rawWidth = measureFn(text, fontSize, nativeWeight);
    const box = inkBox(rawWidth, fontSize, strokeWidth);
    const bbox = transformBox(box, scale, slant, contentLeft, baselineY);
    return {
      index,
      scale,
      label: `${Math.round(scale * 100)}%`,
      fontSize,
      baselineY,
      transform: morphMatrix(scale, slant),
      strokeWidth,
      nativeWeight,
      rawWidth,
      bbox,
    };
  });

  // 倾斜（skew）会让墨盒整体横向偏移，需要全局平移保证不被画布裁切。
  const rawMinX = Math.min(...rows.map((r) => r.bbox.minX));
  const rawMaxX = Math.max(...rows.map((r) => r.bbox.maxX));
  const rawMinY = Math.min(...rows.map((r) => r.bbox.minY));
  const offsetX = LAYOUT.padX - rawMinX;
  const offsetY = LAYOUT.padTop - rawMinY;

  const shiftedRows = rows.map((row) => {
    const bbox = {
      minX: row.bbox.minX + offsetX,
      maxX: row.bbox.maxX + offsetX,
      minY: row.bbox.minY + offsetY,
      maxY: row.bbox.maxY + offsetY,
    };
    return {
      ...row,
      textX: contentLeft + offsetX,
      baselineY: row.baselineY + offsetY,
      bbox,
    };
  });

  const maxRight = Math.max(...shiftedRows.map((r) => r.bbox.maxX));
  const lastBaseline = rows[rows.length - 1].baselineY;
  const rightPadding = LAYOUT.padX + LAYOUT.maxStrokeEm * fontSize;
  const width = Math.ceil(maxRight + rightPadding);
  const height = Math.ceil(
    lastBaseline + offsetY + INK.descentEm * fontSize + LAYOUT.padBottom
  );

  return {
    width,
    height,
    rows: shiftedRows,
    metrics: {
      minLeft: Math.min(...shiftedRows.map((r) => r.bbox.minX)),
      maxRight,
      rowPitch,
      contentLeft: contentLeft + offsetX,
      offsetX,
      offsetY,
      strokeWidth,
    },
  };
}

// 五档包围盒两两检测：返回发生重叠的档位对。
export function findRowOverlaps(layout) {
  const overlaps = [];
  const rows = layout.rows;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (intersects(rows[i].bbox, rows[j].bbox)) {
        overlaps.push([rows[i].label, rows[j].label]);
      }
    }
  }
  return overlaps;
}

// 检测内容是否越出画布。
export function findOutOfBounds(layout) {
  const violations = [];
  for (const row of layout.rows) {
    const b = row.bbox;
    if (b.minX < 0 || b.minY < 0 || b.maxX > layout.width || b.maxY > layout.height) {
      violations.push(row.label);
    }
  }
  return violations;
}

export function defaultGuides(layout) {
  const first = layout.rows[0];
  const last = layout.rows[layout.rows.length - 1];
  return [
    { id: "g-h-top", orientation: "h", pos: first.baselineY },
    { id: "g-h-bottom", orientation: "h", pos: last.baselineY },
    { id: "g-v-left", orientation: "v", pos: layout.metrics.contentLeft },
    { id: "g-v-right", orientation: "v", pos: layout.width - LAYOUT.padX },
  ];
}
