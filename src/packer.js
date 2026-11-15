function rectRight(rect) {
  return rect.x + rect.width;
}

function rectBottom(rect) {
  return rect.y + rect.height;
}

function intersects(a, b) {
  return (
    a.x < rectRight(b) &&
    rectRight(a) > b.x &&
    a.y < rectBottom(b) &&
    rectBottom(a) > b.y
  );
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}

function sameRect(a, b) {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function clampRect(rect, width, height) {
  const x1 = Math.max(0, Math.min(width, rect.x));
  const y1 = Math.max(0, Math.min(height, rect.y));
  const x2 = Math.max(x1, Math.min(width, rect.x + rect.width));
  const y2 = Math.max(y1, Math.min(height, rect.y + rect.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function unionRects(rects) {
  const valid = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (valid.length === 0) {
    return null;
  }
  const x1 = Math.min(...valid.map((rect) => rect.x));
  const y1 = Math.min(...valid.map((rect) => rect.y));
  const x2 = Math.max(...valid.map((rect) => rectRight(rect)));
  const y2 = Math.max(...valid.map((rect) => rectBottom(rect)));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function subtractRect(free, used) {
  if (!intersects(free, used)) {
    return [free];
  }
  const pieces = [];
  if (used.x > free.x && used.x < rectRight(free)) {
    pieces.push({
      x: free.x,
      y: free.y,
      width: used.x - free.x,
      height: free.height,
    });
  }
  if (rectRight(used) < rectRight(free) && rectRight(used) > free.x) {
    pieces.push({
      x: rectRight(used),
      y: free.y,
      width: rectRight(free) - rectRight(used),
      height: free.height,
    });
  }
  if (used.y > free.y && used.y < rectBottom(free)) {
    pieces.push({
      x: free.x,
      y: free.y,
      width: free.width,
      height: used.y - free.y,
    });
  }
  if (rectBottom(used) < rectBottom(free) && rectBottom(used) > free.y) {
    pieces.push({
      x: free.x,
      y: rectBottom(used),
      width: free.width,
      height: rectBottom(free) - rectBottom(used),
    });
  }
  return pieces.filter((rect) => rect.width > 0 && rect.height > 0);
}

function pruneFreeRects(rects) {
  const unique = [];
  const seen = new Set();
  for (const rect of rects) {
    const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(rect);
    }
  }
  return unique.filter((rect, index) => {
    return !unique.some((other, otherIndex) => {
      return otherIndex !== index && contains(other, rect) && !sameRect(other, rect);
    });
  });
}

function normalizeSpec(spec) {
  const normalized = {
    id: String(spec.id),
    width: Number(spec.width),
    height: Number(spec.height),
  };
  if (
    spec.anchor &&
    Number.isFinite(Number(spec.anchor.x)) &&
    Number.isFinite(Number(spec.anchor.y))
  ) {
    normalized.anchor = {
      x: Math.round(Number(spec.anchor.x)),
      y: Math.round(Number(spec.anchor.y)),
    };
  }
  return normalized;
}

function validateSpec(spec) {
  if (!spec.id) {
    throw new Error("帧 id 不能为空");
  }
  if (
    !Number.isInteger(spec.width) ||
    !Number.isInteger(spec.height) ||
    spec.width <= 0 ||
    spec.height <= 0
  ) {
    throw new Error(`帧 ${spec.id} 的宽高必须是正整数`);
  }
}

export function frameArea(frames) {
  return frames.reduce((sum, frame) => sum + frame.width * frame.height, 0);
}

export function validateLayout(frames, width, height) {
  const errors = [];
  const ids = new Set();
  const checks = {
    integerCoordinates: true,
    insideBounds: true,
    positiveSlices: true,
    uniqueIds: true,
    overlapFree: true,
  };

  frames.forEach((frame, index) => {
    if (ids.has(frame.id)) {
      checks.uniqueIds = false;
      errors.push(`重复帧 id: ${frame.id}`);
    }
    ids.add(frame.id);
    const integral = ["x", "y", "width", "height"].every((key) =>
      Number.isInteger(frame[key]),
    );
    if (!integral) {
      checks.integerCoordinates = false;
      errors.push(`帧 ${frame.id || index} 含非整数切片坐标`);
    }
    if (frame.width <= 0 || frame.height <= 0) {
      checks.positiveSlices = false;
      errors.push(`帧 ${frame.id || index} 的切片尺寸非正数`);
    }
    if (
      frame.x < 0 ||
      frame.y < 0 ||
      rectRight(frame) > width ||
      rectBottom(frame) > height
    ) {
      checks.insideBounds = false;
      errors.push(
        `帧 ${frame.id || index} 超出图集范围: ${frame.x},${frame.y},${frame.width},${frame.height}`,
      );
    }
  });

  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      if (intersects(frames[i], frames[j])) {
        checks.overlapFree = false;
        errors.push(`帧 ${frames[i].id} 与 ${frames[j].id} 重叠`);
      }
    }
  }

  return { valid: errors.length === 0, errors, checks };
}

export class IncrementalPacker {
  constructor({ width = 1024, height = 1024, padding = 1 } = {}) {
    this.width = width;
    this.height = height;
    this.padding = padding;
    this.frames = new Map();
    this.freeRects = [];
    this.repackCount = 0;
    this.totalMoved = 0;
    this.atlasGrowths = 0;
    this.lastReport = null;
    this._resetFreeRects();
  }

  reset({ width = this.width, height = this.height } = {}) {
    this.width = width;
    this.height = height;
    this.frames.clear();
    this.freeRects = [];
    this.repackCount = 0;
    this.totalMoved = 0;
    this.atlasGrowths = 0;
    this.lastReport = null;
    this._resetFreeRects();
  }

  _resetFreeRects() {
    this.freeRects = [
      { x: 0, y: 0, width: this.width, height: this.height },
    ];
  }

  _reservedRect(frame) {
    return clampRect(
      {
        x: frame.x,
        y: frame.y,
        width: frame.width + this.padding,
        height: frame.height + this.padding,
      },
      this.width,
      this.height,
    );
  }

  _rebuildFreeRects() {
    this._resetFreeRects();
    const frames = [...this.frames.values()];
    for (const frame of frames) {
      const used = this._reservedRect(frame);
      this.freeRects = pruneFreeRects(
        this.freeRects.flatMap((free) => subtractRect(free, used)),
      );
    }
  }

  _findPlacement(width, height, anchor) {
    const slotWidth = width + this.padding;
    const slotHeight = height + this.padding;
    let best = null;

    for (const free of this.freeRects) {
      if (free.width < slotWidth || free.height < slotHeight) {
        continue;
      }
      const shortSide = Math.min(
        free.width - slotWidth,
        free.height - slotHeight,
      );
      const longSide = Math.max(
        free.width - slotWidth,
        free.height - slotHeight,
      );
      const distance = anchor
        ? Math.abs(free.x - anchor.x) + Math.abs(free.y - anchor.y)
        : 0;
      const score = shortSide * 8 + longSide + distance * 0.4;
      const candidate = { x: free.x, y: free.y, score, free };
      if (
        !best ||
        score < best.score ||
        (score === best.score && free.y < best.y) ||
        (score === best.score && free.y === best.y && free.x < best.x)
      ) {
        best = candidate;
      }
    }
    return best;
  }

  _growToFit(width, height) {
    if (width > this.width) {
      this.width = Math.ceil(width / 128) * 128;
    }
    if (height > this.height) {
      this.height = Math.ceil(height / 128) * 128;
    }
    this.atlasGrowths += 1;
    this._rebuildFreeRects();
  }

  _placeFrame(spec, anchor) {
    let placement = this._findPlacement(spec.width, spec.height, anchor);
    if (!placement) {
      const oldWidth = this.width;
      const oldHeight = this.height;
      const neededWidth = Math.max(this.width, spec.width + this.padding);
      const neededHeight = Math.max(
        this.height + 128,
        spec.height + this.padding,
      );
      this._growToFit(neededWidth, neededHeight);
      placement = this._findPlacement(spec.width, spec.height, anchor);
      if (!placement) {
        this.width = oldWidth;
        this.height = oldHeight;
        this._rebuildFreeRects();
        throw new Error(`无法为帧 ${spec.id} 找到合法位置`);
      }
    }

    const frame = {
      id: spec.id,
      x: placement.x,
      y: placement.y,
      width: spec.width,
      height: spec.height,
    };
    const used = clampRect(
      {
        x: placement.x,
        y: placement.y,
        width: spec.width + this.padding,
        height: spec.height + this.padding,
      },
      this.width,
      this.height,
    );
    this.freeRects = pruneFreeRects(
      this.freeRects.flatMap((free) => subtractRect(free, used)),
    );
    this.frames.set(frame.id, frame);
    return frame;
  }

  packInitial(specs, { label = "初始打包" } = {}) {
    const startedAt = performance.now();
    this.reset();
    const normalized = specs.map(normalizeSpec);
    normalized.forEach(validateSpec);
    const unique = new Set(normalized.map((spec) => spec.id));
    if (unique.size !== normalized.length) {
      throw new Error("初始帧 id 必须唯一");
    }

    const sorted = [...normalized].sort((a, b) => {
      const sideDelta =
        Math.max(b.width, b.height) - Math.max(a.width, a.height);
      if (sideDelta !== 0) return sideDelta;
      const areaDelta = b.width * b.height - a.width * a.height;
      if (areaDelta !== 0) return areaDelta;
      return a.id.localeCompare(b.id);
    });
    for (const spec of sorted) {
      this._placeFrame(spec, null);
    }

    const before = new Map();
    const changes = new Set(normalized.map((spec) => spec.id));
    const region = unionRects(
      [...this.frames.values()].map((frame) => ({ ...frame })),
    );
    const validation = this.validate();
    this.repackCount = 0;
    this.totalMoved = 0;
    this.lastReport = this._makeReport({
      label,
      before,
      changes,
      region,
      validation,
      startedAt,
    });
    return this.lastReport;
  }

  applyChanges(
    { add = [], remove = [], update = [] } = {},
    { label = "增量修改" } = {},
  ) {
    const startedAt = performance.now();
    const additions = add.map(normalizeSpec);
    const updates = update.map(normalizeSpec);
    additions.forEach(validateSpec);
    updates.forEach(validateSpec);

    const before = new Map(
      [...this.frames].map(([id, frame]) => [id, { ...frame }]),
    );
    const state = {
      width: this.width,
      height: this.height,
      frames: before,
      freeRects: this.freeRects.map((rect) => ({ ...rect })),
      repackCount: this.repackCount,
      totalMoved: this.totalMoved,
      atlasGrowths: this.atlasGrowths,
    };

    const removeIds = [...new Set(remove.map(String))];
    const addIds = additions.map((spec) => spec.id);
    if (new Set(addIds).size !== addIds.length) {
      throw new Error("新增帧 id 不能重复");
    }

    const changedIds = new Set([
      ...removeIds,
      ...updates.map((spec) => spec.id),
      ...addIds,
    ]);
    const removed = [];
    const resized = [];
    const regionParts = [];
    const touchedRects = [];
    const queued = [];

    try {
      for (const id of removeIds) {
        const frame = this.frames.get(id);
        if (!frame) {
          throw new Error(`无法删除不存在的帧 ${id}`);
        }
        regionParts.push({ ...frame });
        touchedRects.push({ ...frame, kind: "removed" });
        removed.push(id);
        this.frames.delete(id);
      }

      for (const spec of updates) {
        if (addIds.includes(spec.id)) {
          throw new Error(`帧 ${spec.id} 不能同时新增和修改`);
        }
        const previous = this.frames.get(spec.id);
        if (!previous) {
          throw new Error(`无法修改不存在的帧 ${spec.id}`);
        }
        if (
          previous.width === spec.width &&
          previous.height === spec.height
        ) {
          regionParts.push({ ...previous });
          touchedRects.push({ ...previous, kind: "modified" });
          continue;
        }
        regionParts.push({ ...previous });
        touchedRects.push({ ...previous, kind: "resized-old" });
        resized.push(spec.id);
        this.frames.delete(spec.id);
        queued.push({
          spec,
          anchor: {
            x: previous.x + Math.floor(previous.width / 2),
            y: previous.y + Math.floor(previous.height / 2),
          },
        });
      }

      for (const spec of additions) {
        if (this.frames.has(spec.id)) {
          throw new Error(`帧 ${spec.id} 已存在，不能重复新增`);
        }
        queued.push({ spec, anchor: spec.anchor || null });
      }

      this._rebuildFreeRects();
      const dirtyCenter = anchorFromRects(regionParts) || {
        x: Math.floor(this.width / 2),
        y: Math.floor(this.height / 2),
      };
      queued.sort((a, b) => {
        return (
          Math.max(b.spec.width, b.spec.height) -
          Math.max(a.spec.width, a.spec.height)
        );
      });
      for (const item of queued) {
        const frame = this._placeFrame(
          item.spec,
          item.anchor || dirtyCenter,
        );
        regionParts.push({ ...frame });
        touchedRects.push({
          ...frame,
          kind: resized.includes(item.spec.id) ? "resized-new" : "added",
        });
      }

      const validation = this.validate();
      if (!validation.valid) {
        throw new Error(`增量重排产生非法布局: ${validation.errors[0]}`);
      }

      const movedFrames = [];
      for (const [id, frame] of this.frames) {
        const previous = before.get(id);
        if (
          previous &&
          (previous.x !== frame.x ||
            previous.y !== frame.y ||
            previous.width !== frame.width ||
            previous.height !== frame.height)
        ) {
          movedFrames.push(id);
        }
      }

      const layoutChanged = addedOrRemovedOrResized(
        additions,
        removed,
        resized,
        movedFrames,
      );
      if (layoutChanged) {
        this.repackCount += 1;
      }
      this.totalMoved += movedFrames.length;
      const region = unionRects(regionParts);
      this.lastReport = this._makeReport({
        label,
        before,
        changes: changedIds,
        region,
        validation,
        startedAt,
        added: additions.map((spec) => spec.id),
        removed,
        modified: updates.map((spec) => spec.id),
        resized,
        movedFrames,
        layoutChanged,
        touchedRects,
      });
      return this.lastReport;
    } catch (error) {
      this.width = state.width;
      this.height = state.height;
      this.frames = new Map(
        [...state.frames].map(([id, frame]) => [id, { ...frame }]),
      );
      this.freeRects = state.freeRects;
      this.repackCount = state.repackCount;
      this.totalMoved = state.totalMoved;
      this.atlasGrowths = state.atlasGrowths;
      throw error;
    }
  }

  restore(snapshot) {
    const { width, height, padding = 1, frames, stats = {} } = snapshot;
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new Error("图集宽高必须是整数");
    }
    const normalized = frames.map((frame) => ({
      id: String(frame.id),
      x: Number(frame.x),
      y: Number(frame.y),
      width: Number(frame.width),
      height: Number(frame.height),
    }));
    const validation = validateLayout(normalized, width, height);
    if (!validation.valid) {
      throw new Error(`JSON 布局非法: ${validation.errors[0]}`);
    }
    this.width = width;
    this.height = height;
    this.padding = padding;
    this.frames = new Map(normalized.map((frame) => [frame.id, frame]));
    this.repackCount = stats.repackCount || 0;
    this.totalMoved = stats.totalMoved || 0;
    this.atlasGrowths = stats.atlasGrowths || 0;
    this._rebuildFreeRects();
    this.lastReport = null;
    return this.validate();
  }

  validate() {
    return validateLayout(
      [...this.frames.values()],
      this.width,
      this.height,
    );
  }

  utilization() {
    return (frameArea([...this.frames.values()]) / (this.width * this.height)) * 100;
  }

  toSnapshot() {
    return {
      width: this.width,
      height: this.height,
      padding: this.padding,
      frames: [...this.frames.values()].map((frame) => ({ ...frame })),
      stats: {
        repackCount: this.repackCount,
        totalMoved: this.totalMoved,
        atlasGrowths: this.atlasGrowths,
      },
    };
  }

  _makeReport({
    label,
    before,
    changes,
    region,
    validation,
    startedAt,
    added = [],
    removed = [],
    modified = [],
    resized = [],
    movedFrames = [],
    touchedRects = [],
    layoutChanged = true,
  }) {
    let moved = movedFrames;
    if (moved.length === 0 && before.size > 0) {
      moved = [];
    }
    const untouchedCount = [...this.frames.keys()].filter(
      (id) => !changes.has(id),
    ).length;
    return {
      label,
      durationMs: performance.now() - startedAt,
      repackCount: this.repackCount,
      layoutChanged,
      added,
      removed,
      modified,
      resized,
      movedFrames: [...moved],
      untouchedFrames: untouchedCount,
      frameCount: this.frames.size,
      repackRegion: region,
      touchedRects,
      touchedArea: touchedRects.reduce(
        (sum, rect) => sum + rect.width * rect.height,
        0,
      ),
      regionRatio:
        region && this.width * this.height > 0
          ? (region.width * region.height) / (this.width * this.height)
          : 0,
      atlas: {
        width: this.width,
        height: this.height,
        growths: this.atlasGrowths,
      },
      utilization: this.utilization(),
      validation,
    };
  }
}

function anchorFromRects(rects) {
  const union = unionRects(rects.filter((rect) => rect.width > 0));
  if (!union) {
    return null;
  }
  return {
    x: union.x + Math.floor(union.width / 2),
    y: union.y + Math.floor(union.height / 2),
  };
}

function addedOrRemovedOrResized(additions, removed, resized, movedFrames) {
  return (
    additions.length > 0 ||
    removed.length > 0 ||
    resized.length > 0 ||
    movedFrames.length > 0
  );
}
