export const CONFIG = Object.freeze({
  cols: 13,
  rows: 9,
  maxTime: 30,
  cellMinutes: 0.3,
  liftMinutes: 0.8,
  dropMinutes: 0.8,
  stackCapacity: 3,
  channelRows: [3, 4],
  dock: { c: 1, r: 4 },
});

export const DESTINATIONS = Object.freeze({
  yangshan: { name: "洋山", code: "YS", color: "#45d7c7" },
  ningbo: { name: "宁波", code: "NB", color: "#ffc562" },
  qingdao: { name: "青岛", code: "QD", color: "#c49cff" },
});

export const ROUTES = Object.freeze({
  north: { name: "北绕", lane: 2, channel: false },
  laneN: { name: "北道", lane: 3, channel: true },
  laneS: { name: "南道", lane: 4, channel: true },
  south: { name: "南绕", lane: 7, channel: false },
});

export const STACKS = Object.freeze([
  { id: "N-YS", label: "北 · 洋山", col: 2, row: 1, destination: "yangshan", side: "north" },
  { id: "N-NB", label: "北 · 宁波", col: 5, row: 1, destination: "ningbo", side: "north" },
  { id: "N-QD", label: "北 · 青岛", col: 8, row: 1, destination: "qingdao", side: "north" },
  { id: "S-YS", label: "南 · 洋山", col: 2, row: 6, destination: "yangshan", side: "south" },
  { id: "S-NB", label: "南 · 宁波", col: 5, row: 6, destination: "ningbo", side: "south" },
  { id: "S-QD", label: "南 · 青岛", col: 8, row: 6, destination: "qingdao", side: "south" },
]);

export const BUFFER_SLOT = Object.freeze({
  id: "BUF-1",
  label: "翻箱缓冲区",
  col: 11,
  row: 1,
  approach: { c: 11, r: 2 },
});

const CRANE_HOMES = Object.freeze({
  A: { c: 1, r: 2 },
  B: { c: 11, r: 7 },
});

const TRUCK_SEED = Object.freeze([
  {
    id: "T-01",
    plate: "沪A·319",
    boxId: "BX-3107",
    weight: 24,
    destination: "yangshan",
    deadline: 14,
    enteredAt: 0,
  },
  {
    id: "T-02",
    plate: "浙B·582",
    boxId: "BX-8821",
    weight: 9,
    destination: "ningbo",
    deadline: 21,
    enteredAt: 0.4,
  },
  {
    id: "T-03",
    plate: "鲁Q·704",
    boxId: "BX-4436",
    weight: 12,
    destination: "yangshan",
    deadline: 28,
    enteredAt: 0.8,
  },
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));

export function approachForStack(stack) {
  return { c: stack.col, r: stack.side === "north" ? 2 : 5 };
}

function pushEvent(game, message, tone = "info", meta = {}) {
  game.eventSequence += 1;
  game.events.unshift({
    id: game.eventSequence,
    time: round(game.time),
    message,
    tone,
    ...meta,
  });
  game.events = game.events.slice(0, 60);
}

function cellKey(cell) {
  return `${cell.c}:${cell.r}`;
}

function isInside(cell) {
  return cell.c >= 0 && cell.c < CONFIG.cols && cell.r >= 0 && cell.r < CONFIG.rows;
}

function expandPoints(points) {
  const expanded = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const stepC = Math.sign(to.c - from.c);
    const stepR = Math.sign(to.r - from.r);
    let cursor = { ...from };
    while (cursor.c !== to.c || cursor.r !== to.r) {
      cursor = { c: cursor.c + stepC, r: cursor.r + stepR };
      if (isInside(cursor)) expanded.push(cursor);
    }
  }
  return expanded;
}

export function buildRoute(start, lane, end) {
  const points = [
    { ...start },
    { c: start.c, r: lane },
    { c: end.c, r: lane },
    { ...end },
  ];
  return expandPoints(points);
}

export function routeLength(start, lane, end) {
  return Math.max(1, buildRoute(start, lane, end).length);
}

export function routeMinutes(start, lane, end) {
  return routeLength(start, lane, end) * CONFIG.cellMinutes;
}

export function createGame() {
  const game = {
    status: "ready",
    paused: false,
    time: 0,
    eventSequence: 0,
    events: [],
    queue: TRUCK_SEED.map((truck) => truck.id),
    trucks: TRUCK_SEED.map((truck) => ({
      ...truck,
      status: "waiting",
      finishedAt: null,
      late: false,
      stackId: null,
    })),
    stacks: STACKS.map((stack, index) => ({
      ...stack,
      sequence: index,
      boxes: [],
      unstable: false,
      reorderRequired: false,
      reservedBy: null,
    })),
    buffers: [
      {
        ...BUFFER_SLOT,
        boxes: [],
        reservedBy: null,
      },
    ],
    cranes: ["A", "B"].map((id) => ({
      id,
      col: CRANE_HOMES[id].c,
      row: CRANE_HOMES[id].r,
      fromCol: CRANE_HOMES[id].c,
      fromRow: CRANE_HOMES[id].r,
      moveTimer: 0,
      status: "idle",
      blockedMinutes: 0,
      operation: null,
    })),
    stats: {
      unloadsDone: 0,
      reorderTasksCreated: 0,
      reordersDone: 0,
      channelViolations: 0,
      channelBlockedMinutes: 0,
      deadlineMisses: 0,
      congestionMinutes: 0,
      cellsTravelled: 0,
      startedAt: null,
    },
    channelBlocked: false,
    blockedColumns: [],
    channelWidth: 2,
    lastPlanError: null,
    finishReason: null,
  };

  pushEvent(game, "班次待命：3 辆集卡已进入西侧等候区", "info");
  pushEvent(game, "提示：重箱压轻箱会触发额外翻箱重排", "warning");
  return game;
}

export function getTaskProgress(game) {
  return {
    completed: game.stats.unloadsDone + game.stats.reordersDone,
    total: game.trucks.length + game.stats.reorderTasksCreated,
    unloadsDone: game.stats.unloadsDone,
    reordersDone: game.stats.reordersDone,
    reorderTasks: game.stats.reorderTasksCreated,
  };
}

export function getTruck(game, truckId) {
  return game.trucks.find((truck) => truck.id === truckId) || null;
}

export function getStack(game, stackId) {
  return game.stacks.find((stack) => stack.id === stackId) || null;
}

export function getBufferedBoxes(game) {
  return game.buffers.flatMap((buffer) => buffer.boxes);
}

export function startShift(game) {
  if (game.status !== "ready") return false;
  game.status = "running";
  game.stats.startedAt = game.time;
  pushEvent(game, "07:00 班次开始，潮汐窗口 30 分钟", "success");
  return true;
}

export function changeSpeed(game, speed) {
  if (![1, 2, 4].includes(speed)) return false;
  game.speed = speed;
  return true;
}

export function togglePause(game) {
  if (!["running", "lost", "won"].includes(game.status)) return game.paused;
  if (game.status === "running") game.paused = !game.paused;
  return game.paused;
}

export function moveQueueTruck(game, truckId, direction) {
  if (game.status === "won" || game.status === "lost") return { ok: false, error: "本局已结束" };
  const index = game.queue.indexOf(truckId);
  if (index < 0) return { ok: false, error: "该集卡已离开排队区" };
  const target = clamp(index + direction, 0, game.queue.length - 1);
  if (target === index) return { ok: false, error: "已经到达队列边界" };
  game.queue.splice(index, 1);
  game.queue.splice(target, 0, truckId);
  const truck = getTruck(game, truckId);
  pushEvent(game, `${truck.plate} 调整至队列第 ${target + 1} 位`, "info");
  return { ok: true, position: target };
}

export function canTargetStack(game, truck, stack) {
  if (!truck || !stack) return { ok: false, reason: "请选择集卡与箱位" };
  if (truck.destination !== stack.destination) {
    return { ok: false, reason: "目的地不符" };
  }
  if (stack.reservedBy) return { ok: false, reason: "该箱位已锁定" };
  if (stack.reorderRequired) return { ok: false, reason: "需先完成翻箱重排" };
  if (stack.boxes.length >= CONFIG.stackCapacity) return { ok: false, reason: "箱位已满" };
  return { ok: true, reason: "" };
}

export function isWeightInversion(boxes) {
  return boxes.some((box, index) => {
    const above = boxes[index + 1];
    return above && box.weight < above.weight;
  });
}

function buildDockPath(crane, routeKey) {
  const route = ROUTES[routeKey];
  return buildRoute({ c: crane.col, r: crane.row }, route.lane, CONFIG.dock);
}

function buildStackPath(start, stack, routeKey) {
  const route = ROUTES[routeKey];
  return buildRoute(start, route.lane, approachForStack(stack));
}

function reserveStack(game, stack, operationId) {
  stack.reservedBy = operationId;
}

function releaseStack(stack) {
  stack.reservedBy = null;
}

function pathMetrics(path) {
  return {
    cells: path.length,
    minutes: round(Math.max(0, path.length - 1) * CONFIG.cellMinutes),
  };
}

export function previewUnload(game, { truckId, stackId, craneId, route = "laneN" }) {
  const truck = getTruck(game, truckId);
  const stack = getStack(game, stackId);
  const crane = game.cranes.find((item) => item.id === craneId);
  if (!truck || !stack || !crane) return { ok: false, reason: "调度参数不完整" };
  if (game.queue[0] !== truckId) return { ok: false, reason: "仅可派工队列首位集卡" };
  if (crane.operation) return { ok: false, reason: `吊机 ${craneId} 正在作业` };
  if (!ROUTES[route]) return { ok: false, reason: "无效路径" };
  const targetCheck = canTargetStack(game, truck, stack);
  if (!targetCheck.ok) return targetCheck;

  const dockPath = buildDockPath(crane, route);
  const stackPath = buildStackPath(CONFIG.dock, stack, route);
  const dockMinutes = Math.max(0, dockPath.length - 1) * CONFIG.cellMinutes;
  const stackMinutes = Math.max(0, stackPath.length - 1) * CONFIG.cellMinutes;
  return {
    ok: true,
    routeName: ROUTES[route].name,
    occupancy: ROUTES[route].channel ? "主通道" : "通道外",
    minutes: round(dockMinutes + stackMinutes + CONFIG.liftMinutes + CONFIG.dropMinutes),
    dockPath,
    stackPath,
  };
}

export function planUnload(game, { truckId, stackId, craneId, route = "laneN" }) {
  if (game.status === "lost" || game.status === "won") {
    return { ok: false, reason: "本局已结束" };
  }
  const preview = previewUnload(game, { truckId, stackId, craneId, route });
  if (!preview.ok) return preview;

  const truck = getTruck(game, truckId);
  const stack = getStack(game, stackId);
  const crane = game.cranes.find((item) => item.id === craneId);
  const operationId = `OP-${game.eventSequence + 1}-${truckId}`;
  const operation = {
    id: operationId,
    type: "unload",
    truckId,
    stackId,
    craneId,
    route,
    phase: "travel",
    segment: "toDock",
    path: preview.dockPath,
    pathIndex: 0,
    actionTimer: 0,
  };

  game.queue.shift();
  truck.status = "loading";
  reserveStack(game, stack, operationId);
  crane.status = "working";
  crane.operation = operation;
  crane.moveTimer = 0;

  pushEvent(
    game,
    `吊机 ${craneId} 接单：${truck.plate} / ${truck.weight}t → ${stack.label}`,
    "info",
    { truckId, stackId, craneId, route },
  );
  pushEvent(game, `${ROUTES[route].name}路线已占用，预计 ${preview.minutes.toFixed(1)} 分钟`, "muted");
  return { ok: true, operationId, preview };
}

export function canReorder(game, stackId, craneId) {
  const stack = getStack(game, stackId);
  const crane = game.cranes.find((item) => item.id === craneId);
  if (!stack || !crane) return { ok: false, reason: "参数不完整" };
  if (!stack.reorderRequired) return { ok: false, reason: "该箱位无需重排" };
  if (stack.reservedBy) return { ok: false, reason: "该箱位正在作业" };
  if (crane.operation) return { ok: false, reason: `吊机 ${craneId} 正在作业` };
  if (game.buffers.some((buffer) => buffer.reservedBy)) {
    return { ok: false, reason: "翻箱缓冲区被占用" };
  }
  return { ok: true, reason: "" };
}

function buildReachablePath(start, stack, routeKey) {
  return buildStackPath({ c: start.col, r: start.row }, stack, routeKey);
}

export function planReorder(game, { stackId, craneId, route = "laneN" }) {
  if (game.status === "lost" || game.status === "won") {
    return { ok: false, reason: "本局已结束" };
  }
  const check = canReorder(game, stackId, craneId);
  if (!check.ok) return check;
  if (!ROUTES[route]) return { ok: false, reason: "无效路径" };

  const stack = getStack(game, stackId);
  const crane = game.cranes.find((item) => item.id === craneId);
  const buffer = game.buffers.find((item) => !item.reservedBy);
  const operationId = `RO-${game.eventSequence + 1}-${stackId}`;
  const toStack = buildReachablePath(crane, stack, route);
  const toBuffer = buildRoute(approachForStack(stack), ROUTES[route].lane, buffer.approach);
  const toRestack = buildRoute(buffer.approach, ROUTES[route].lane, approachForStack(stack));
  const operation = {
    id: operationId,
    type: "reorder",
    stackId,
    bufferId: buffer.id,
    craneId,
    route,
    phase: "travel",
    segment: "toStack",
    path: toStack,
    pathIndex: 0,
    actionTimer: 0,
    originalBoxes: stack.boxes.map((box) => ({ ...box })),
    segments: {
      toStack,
      toBuffer,
      toRestack,
    },
  };

  reserveStack(game, stack, operationId);
  buffer.reservedBy = operationId;
  crane.status = "working";
  crane.operation = operation;
  crane.moveTimer = 0;
  pushEvent(game, `吊机 ${craneId} 开始翻箱：${stack.label} 存在重压轻`, "warning");
  return { ok: true, operationId };
}

function moveCrane(game, crane, operation, dt) {
  if (operation.phase !== "travel") return;
  const endIndex = operation.path.length - 1;
  if (operation.pathIndex >= endIndex) {
    if (operation.segment === "toDock") {
      operation.phase = "lift";
      operation.actionTimer = CONFIG.liftMinutes;
      crane.status = "lifting";
      pushEvent(game, `吊机 ${crane.id} 到达卡口，开始起吊`, "muted");
    } else if (operation.type === "unload" && operation.segment === "toStack") {
      operation.phase = "drop";
      operation.actionTimer = CONFIG.dropMinutes;
      crane.status = "lifting";
      pushEvent(game, `吊机 ${crane.id} 到达箱位，开始落箱`, "muted");
    } else if (operation.type === "reorder" && operation.segment === "toStack") {
      operation.phase = "shuffle";
      operation.actionTimer = 1.2;
      crane.status = "lifting";
      pushEvent(game, `吊机 ${crane.id} 开始翻箱暂存`, "muted");
    } else if (operation.segment === "toBuffer") {
      operation.phase = "buffer";
      operation.actionTimer = CONFIG.liftMinutes;
      crane.status = "lifting";
    } else if (operation.segment === "toRestack") {
      operation.phase = "restack";
      operation.actionTimer = CONFIG.dropMinutes;
      crane.status = "lifting";
    }
    return;
  }

  crane.moveTimer = Math.max(0, crane.moveTimer - dt);
  if (crane.moveTimer > 0) return;
  const next = operation.path[operation.pathIndex + 1];
  const occupied = game.cranes.some(
    (other) => other.id !== crane.id && other.col === next.c && other.row === next.r,
  );
  if (occupied) {
    crane.blockedMinutes += dt;
    game.stats.congestionMinutes += dt;
    if (!crane.blockedReported) {
      crane.blockedReported = true;
      pushEvent(game, `吊机 ${crane.id} 路径冲突，正在等待前方让行`, "warning");
    }
    return;
  }

  crane.fromCol = crane.col;
  crane.fromRow = crane.row;
  crane.col = next.c;
  crane.row = next.r;
  operation.pathIndex += 1;
  crane.moveTimer = CONFIG.cellMinutes;
  crane.blockedReported = false;
  game.stats.cellsTravelled += 1;
}

function beginReorderTravel(game, crane, operation, segment, phase) {
  operation.segment = segment;
  operation.path = operation.segments[segment];
  operation.pathIndex = 0;
  operation.phase = "travel";
  crane.moveTimer = 0;
  crane.status = "working";
  if (segment === "toBuffer") {
    game.buffers
      .find((buffer) => buffer.id === operation.bufferId)
      .boxes.push({ id: "TEMP-HEAVY", weight: operation.originalBoxes.at(-1)?.weight || 0 });
    pushEvent(game, `重箱暂存至 ${operation.bufferId}，准备倒序回堆`, "muted");
  }
  if (phase) operation.phase = phase;
}

function parkCrane(crane) {
  const home = CRANE_HOMES[crane.id];
  crane.returnFrom = { c: crane.col, r: crane.row };
  crane.col = home.c;
  crane.row = home.r;
  crane.status = "idle";
  crane.moveTimer = 0;
  crane.blockedReported = false;
}

function finalizeUnload(game, crane, operation) {
  const truck = getTruck(game, operation.truckId);
  const stack = getStack(game, operation.stackId);
  const box = {
    id: truck.boxId,
    weight: truck.weight,
    destination: truck.destination,
    order: game.stats.unloadsDone + 1,
  };
  stack.boxes.push(box);
  truck.status = "done";
  truck.finishedAt = round(game.time);
  truck.stackId = stack.id;
  if (game.time > truck.deadline + 0.001) {
    truck.late = true;
    game.stats.deadlineMisses += 1;
    pushEvent(game, `${truck.plate} 超时落箱（截止 ${formatMinute(truck.deadline)}）`, "danger");
  } else {
    pushEvent(game, `${truck.plate} 落箱完成：${stack.label} · ${truck.weight}t`, "success");
  }

  game.stats.unloadsDone += 1;
  if (isWeightInversion(stack.boxes)) {
    stack.unstable = true;
    if (!stack.reorderRequired) {
      stack.reorderRequired = true;
      game.stats.reorderTasksCreated += 1;
      pushEvent(
        game,
        `${stack.label} 出现重压轻，新增翻箱重排任务`,
        "danger",
        { stackId: stack.id, type: "weight-inversion" },
      );
    }
  }

  releaseStack(stack);
  crane.operation = null;
  parkCrane(crane);
}

function finalizeReorder(game, crane, operation) {
  const stack = getStack(game, operation.stackId);
  const buffer = game.buffers.find((item) => item.id === operation.bufferId);
  stack.boxes = operation.originalBoxes
    .slice()
    .sort((left, right) => right.weight - left.weight || left.order - right.order);
  stack.unstable = false;
  stack.reorderRequired = false;
  buffer.boxes = [];
  releaseStack(stack);
  buffer.reservedBy = null;
  game.stats.reordersDone += 1;
  crane.operation = null;
  parkCrane(crane);
  pushEvent(game, `${stack.label} 翻箱完成，重箱已回到底层`, "success", {
    stackId: stack.id,
    type: "reorder-complete",
  });
}

function advanceAction(game, crane, operation, dt) {
  operation.actionTimer -= dt;
  if (operation.actionTimer > 0) return;

  if (operation.type === "unload") {
    if (operation.phase === "lift") {
      const truck = getTruck(game, operation.truckId);
      truck.status = "carried";
      operation.segment = "toStack";
      operation.path = buildStackPath(CONFIG.dock, getStack(game, operation.stackId), operation.route);
      operation.pathIndex = 0;
      operation.phase = "travel";
      crane.moveTimer = 0;
      crane.status = "working";
    } else if (operation.phase === "drop") {
      finalizeUnload(game, crane, operation);
    }
    return;
  }

  if (operation.phase === "shuffle") {
    beginReorderTravel(game, crane, operation, "toBuffer");
  } else if (operation.phase === "buffer") {
    beginReorderTravel(game, crane, operation, "toRestack");
  } else if (operation.phase === "restack") {
    finalizeReorder(game, crane, operation);
  }
}

function scanChannel(game, dt) {
  const laneNorth = new Set();
  const laneSouth = new Set();
  let channelOccupied = false;
  for (const crane of game.cranes) {
    if (crane.row === 3) {
      laneNorth.add(crane.col);
      channelOccupied = true;
    }
    if (crane.row === 4) {
      laneSouth.add(crane.col);
      channelOccupied = true;
    }
  }
  const conflicts = [...laneNorth].filter((col) => laneSouth.has(col)).sort((a, b) => a - b);
  const wasBlocked = game.channelBlocked;
  game.blockedColumns = conflicts;
  game.channelBlocked = conflicts.length > 0;
  game.channelWidth = game.channelBlocked ? 0 : channelOccupied ? 1 : 2;
  if (game.channelBlocked) {
    game.stats.channelBlockedMinutes += dt;
    if (!wasBlocked) {
      game.stats.channelViolations += 1;
      pushEvent(game, `主通道在 ${conflicts.map((col) => `C${col}`).join(" / ")} 被双向占用`, "danger");
    }
  } else if (wasBlocked) {
    pushEvent(game, "主通道恢复至少一格净宽", "success");
  }
}

function finishIfNeeded(game) {
  if (game.status !== "running") return;
  const allUnloaded = game.trucks.every((truck) => truck.status === "done");
  const activeWork = game.cranes.some((crane) => crane.operation);
  const pendingReorder = game.stacks.some((stack) => stack.reorderRequired);
  if (allUnloaded && !activeWork && !pendingReorder && game.queue.length === 0) {
    if (game.stats.deadlineMisses === 0 && game.stats.channelViolations === 0) {
      game.status = "won";
      game.finishReason = "全部任务完成，主通道全程至少一格净宽";
      pushEvent(game, "班次达标：装卸完成，通道保持畅通", "success");
    } else {
      game.status = "lost";
      game.finishReason = game.stats.deadlineMisses
        ? "存在超时任务"
        : "主通道曾缩减至零净宽";
      pushEvent(game, `班次未达标：${game.finishReason}`, "danger");
    }
    return;
  }

  if (game.time >= CONFIG.maxTime - 0.0001) {
    game.status = "lost";
    game.finishReason = pendingReorder
      ? "翻箱重排未完成"
      : allUnloaded
        ? "任务收尾未完成"
        : "30 分钟内未完成全部卸箱";
    pushEvent(game, `潮汐窗口关闭：${game.finishReason}`, "danger");
  }
}

function advanceCranes(game, dt) {
  for (const crane of game.cranes) {
    const operation = crane.operation;
    if (!operation) continue;
    if (operation.phase === "travel") {
      moveCrane(game, crane, operation, dt);
    } else {
      advanceAction(game, crane, operation, dt);
    }
  }
}

export function step(game, dt = 0.05) {
  if (game.status !== "running" || game.paused) return false;
  const safeDt = Math.min(dt, CONFIG.maxTime - game.time);
  if (safeDt <= 0) {
    finishIfNeeded(game);
    return false;
  }
  game.time = round(game.time + safeDt, 3);
  advanceCranes(game, safeDt);
  scanChannel(game, safeDt);
  finishIfNeeded(game);
  return true;
}

export function runFor(game, minutes, dt = 0.05) {
  const target = Math.min(CONFIG.maxTime, game.time + minutes);
  let guard = 0;
  while (game.time < target && game.status === "running" && guard < 100000) {
    step(game, Math.min(dt, target - game.time));
    guard += 1;
  }
  return game;
}

export function runUntilIdle(game, maxMinutes = CONFIG.maxTime, dt = 0.05) {
  const target = Math.min(CONFIG.maxTime, game.time + maxMinutes);
  let guard = 0;
  while (
    game.time < target &&
    game.status === "running" &&
    game.cranes.some((crane) => crane.operation) &&
    guard < 100000
  ) {
    step(game, dt);
    guard += 1;
  }
  return game;
}

export function formatMinute(value) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe + 0.0001);
  const seconds = Math.floor(((safe - minutes) * 60) + 0.0001);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getOutcome(game) {
  const tasks = getTaskProgress(game);
  const base = 1000;
  const penalty =
    Math.round(game.time * 7) +
    game.stats.reorderTasksCreated * 110 +
    game.stats.channelViolations * 140 +
    game.stats.deadlineMisses * 180 +
    Math.round(game.stats.congestionMinutes * 12);
  return {
    status: game.status,
    reason: game.finishReason,
    time: game.time,
    tasks,
    score: Math.max(0, base - penalty),
    channelViolations: game.stats.channelViolations,
    deadlineMisses: game.stats.deadlineMisses,
    reorderTasks: game.stats.reorderTasksCreated,
  };
}
