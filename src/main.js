import {
  CONFIG,
  DESTINATIONS,
  ROUTES,
  createGame,
  startShift,
  togglePause,
  planUnload,
  planReorder,
  previewUnload,
  canReorder,
  moveQueueTruck,
  step,
  getTaskProgress,
  getOutcome,
  getTruck,
  getStack,
  formatMinute,
} from "./simulation.js";
import { YardRenderer } from "./renderer.js";
import { PortAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("yard-canvas");
const renderer = new YardRenderer(canvas);
const audio = new PortAudio();

let game = createGame();
const ui = {
  selectedTruckId: null,
  selectedStackId: null,
  selectedCraneId: "A",
  route: "laneN",
  load: 0.18,
  channelBlocked: false,
};

let speed = 1;
let accumulator = 0;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let lastEventSequence = game.eventSequence;
let lastStatus = game.status;
let currentHint = "选择待卸集卡，再点击同目的地箱位";
let outcomeShown = false;

const elements = {
  clock: $("clock-value"),
  task: $("task-value"),
  taskNote: $("task-note"),
  lane: $("lane-value"),
  laneNote: $("lane-note"),
  load: $("load-value"),
  loadBar: $("load-bar"),
  start: $("start-button"),
  pause: $("pause-button"),
  reset: $("reset-button"),
  queue: $("truck-list"),
  queueCount: $("queue-count"),
  cargo: $("cargo-summary"),
  selectionTag: $("selection-tag"),
  cranePicker: $("crane-picker"),
  routePicker: $("route-picker"),
  targetName: $("target-name"),
  dispatch: $("dispatch-button"),
  reorder: $("reorder-button"),
  events: $("event-list"),
  badge: $("canvas-badge"),
  badgeText: $("canvas-status"),
  hint: $("canvas-hint"),
  modal: $("modal"),
  modalEyebrow: $("modal-eyebrow"),
  modalTitle: $("modal-title"),
  modalBody: $("modal-body"),
  modalActions: $("modal-actions"),
  help: $("help-button"),
  sound: $("sound-button"),
};

function currentTruck() {
  return ui.selectedTruckId ? getTruck(game, ui.selectedTruckId) : null;
}

function currentStack() {
  return ui.selectedStackId ? getStack(game, ui.selectedStackId) : null;
}

function chooseIdleCrane() {
  const selected = game.cranes.find((crane) => crane.id === ui.selectedCraneId);
  if (!selected?.operation) return;
  const idle = game.cranes.find((crane) => !crane.operation);
  if (idle) ui.selectedCraneId = idle.id;
}

function selectTruck(truckId) {
  const truck = getTruck(game, truckId);
  if (!truck || truck.status !== "waiting") return;
  ui.selectedTruckId = truckId;
  ui.selectedStackId = null;
  chooseIdleCrane();
  currentHint = `已选 ${truck.plate}，请点击${DESTINATIONS[truck.destination].name}目的地箱位`;
  if (game.queue[0] !== truckId) {
    currentHint = `${truck.plate} 尚在队列第 ${game.queue.indexOf(truckId) + 1} 位，可先上移排队`;
  }
  updateUi(true);
}

function selectStack(stackId) {
  const stack = getStack(game, stackId);
  if (!stack) return;
  const truck = currentTruck();
  if (truck) {
    if (stack.reorderRequired) {
      ui.selectedTruckId = null;
      ui.selectedStackId = stackId;
      chooseIdleCrane();
      currentHint = `${stack.label} 重压轻，选择空闲吊机执行翻箱重排`;
      updateUi(true);
      return;
    }
    if (truck.destination !== stack.destination) {
      currentHint = `${stack.label} 与 ${DESTINATIONS[truck.destination].name} 目的地不符`;
      updateUi(true);
      return;
    }
    if (stack.reservedBy) {
      currentHint = "该箱位已被吊机锁定，请选择其他箱位";
      updateUi(true);
      return;
    }
    if (stack.boxes.length >= CONFIG.stackCapacity) {
      currentHint = "该箱位已满，请选择同目的地的另一箱位";
      updateUi(true);
      return;
    }
    ui.selectedStackId = stackId;
    const top = stack.boxes.at(-1);
    currentHint = top && truck.weight > top.weight
      ? `注意：${truck.weight}t 将压在 ${top.weight}t 上，会产生错叠重排`
      : `已选 ${stack.label}，可指定吊机与路径`;
    chooseIdleCrane();
  } else {
    ui.selectedStackId = stackId;
    if (stack.reorderRequired) {
      chooseIdleCrane();
      currentHint = `${stack.label} 重压轻，选择空闲吊机执行翻箱重排`;
    } else {
      currentHint = `${stack.label} · ${stack.boxes.length}/${CONFIG.stackCapacity} 箱`;
    }
  }
  updateUi(true);
}

function dispatchSelected() {
  if (game.status !== "running") {
    currentHint = "请先点击“开始班次”，再下达派工指令";
    updateUi(true);
    return;
  }
  const result = planUnload(game, {
    truckId: ui.selectedTruckId,
    stackId: ui.selectedStackId,
    craneId: ui.selectedCraneId,
    route: ui.route,
  });
  if (!result.ok) {
    currentHint = result.reason;
    audio.note("warning");
    updateUi(true);
    return;
  }
  audio.note("dispatch");
  const nextTruckId = game.queue[0] || null;
  ui.selectedTruckId = nextTruckId;
  ui.selectedStackId = null;
  chooseIdleCrane();
  currentHint = nextTruckId
    ? "下一辆集卡已就位，选择落箱位"
    : "全部集卡已进入作业，等待吊机完成";
  updateUi(true);
}

function reorderSelected() {
  if (game.status !== "running") {
    currentHint = "请先开始班次";
    updateUi(true);
    return;
  }
  const result = planReorder(game, {
    stackId: ui.selectedStackId,
    craneId: ui.selectedCraneId,
    route: ui.route,
  });
  if (!result.ok) {
    currentHint = result.reason;
    audio.note("warning");
    updateUi(true);
    return;
  }
  audio.note("dispatch");
  ui.selectedStackId = null;
  currentHint = "翻箱重排已开始，关注缓冲区与通道宽度";
  updateUi(true);
}

function beginShift() {
  if (game.status === "ready") {
    audio.start();
    startShift(game);
    lastStatus = game.status;
    currentHint = "班次开始：调整队列，利用两台吊机并行卸箱";
    updateUi(true);
    return;
  }
  if (game.status === "won" || game.status === "lost") showOutcome();
}

function setSpeed(nextSpeed) {
  speed = nextSpeed;
  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  });
}

function resetGame() {
  game = createGame();
  ui.selectedTruckId = null;
  ui.selectedStackId = null;
  ui.selectedCraneId = "A";
  ui.route = "laneN";
  currentHint = "选择待卸集卡，再点击同目的地箱位";
  accumulator = 0;
  lastEventSequence = game.eventSequence;
  lastStatus = game.status;
  outcomeShown = false;
  elements.modal.hidden = true;
  updateUi(true);
}

function togglePauseState() {
  if (game.status !== "running") return;
  togglePause(game);
  updateUi(true);
}

async function toggleSound() {
  if (!audio.context) await audio.start();
  audio.setMuted(!audio.muted);
  elements.sound.setAttribute("aria-pressed", String(!audio.muted));
  elements.sound.querySelector(".sound-icon").textContent = audio.muted ? "×" : "◖";
}

function openModal({ eyebrow, title, body, actions }) {
  elements.modalEyebrow.textContent = eyebrow;
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = body;
  elements.modalActions.innerHTML = actions;
  elements.modal.hidden = false;
}

function closeModal() {
  elements.modal.hidden = true;
}

function showHelp() {
  if (game.status === "running" && !game.paused) {
    togglePause(game);
    currentHint = "班次已为说明面板暂停，关闭后可继续";
  }
  openModal({
    eyebrow: "SHIFT BRIEF",
    title: "30 分钟潮汐班次",
    body: `
      <p>把三辆集卡上的箱体安排到正确目的地，并在 <strong>30 分钟</strong>内完成全部落箱与可能的翻箱任务。主通道任一列的双 lane 同时被占用，净宽会降为 0，本局将判定不合格。</p>
      <div class="rule-grid">
        <div class="rule-card"><span>01 · 车辆排队</span>只有队列首位可派工。用上下箭头调整顺序，优先处理截止时间紧的箱。</div>
        <div class="rule-card"><span>02 · 落箱层位</span>同目的地有两个箱位、每箱位三层。轻箱先落，再把重箱压上去，会新增翻箱重排任务。</div>
        <div class="rule-card"><span>03 · 吊机路径</span>北道 / 南道占用主通道；北绕 / 南绕更慢但离开主通道。注意另一台吊机的位置。</div>
        <div class="rule-card"><span>04 · 重排操作</span>点击红色错叠箱位，选空闲吊机和任意路径，执行翻箱后重箱回到底层。</div>
      </div>
      <p>声音会根据待卸车辆、吊机负载和通道回堵实时变化。按 <strong>空格</strong>暂停，按 <strong>R</strong> 重置。</p>
    `,
    actions: '<button class="primary-button" data-modal-action="close" type="button">进入堆场</button>',
  });
}

function showOutcome() {
  const outcome = getOutcome(game);
  const won = outcome.status === "won";
  openModal({
    eyebrow: won ? "SHIFT COMPLETE" : "SHIFT REPORT",
    title: won ? "班次达标" : "班次未达标",
    body: `
      <p>${outcome.reason || "潮汐窗口已关闭"}</p>
      <div class="outcome-grid">
        <div class="outcome-stat"><span>完成用时</span><strong>${formatMinute(outcome.time)}</strong></div>
        <div class="outcome-stat ${outcome.status === "won" ? "good" : "bad"}"><span>调度得分</span><strong>${outcome.score}</strong></div>
        <div class="outcome-stat ${outcome.channelViolations ? "bad" : "good"}"><span>通道违规</span><strong>${outcome.channelViolations}</strong></div>
      </div>
      <p>卸箱任务 <strong>${outcome.tasks.unloadsDone}/3</strong> · 翻箱任务 <strong>${outcome.tasks.reordersDone}/${outcome.tasks.reorderTasks}</strong> · 超时 <strong>${outcome.deadlineMisses}</strong></p>
    `,
    actions: `
      <button class="text-button" data-modal-action="close" type="button">查看堆场</button>
      <button class="primary-button" data-modal-action="reset" type="button">再开一班</button>
    `,
  });
  outcomeShown = true;
}

function computeLoad() {
  const waiting = game.queue.length;
  const busyCranes = game.cranes.filter((crane) => crane.operation).length;
  const blocked = game.stats.channelViolations > 0 ? 0.18 : 0;
  const backlog = (3 - waiting) * 0.055;
  const congestion = Math.min(0.22, game.stats.congestionMinutes * 0.008);
  return Math.max(
    0.08,
    Math.min(1, 0.12 + waiting * 0.075 + busyCranes * 0.24 + blocked + backlog + congestion),
  );
}

function updateMetrics() {
  const progress = getTaskProgress(game);
  elements.clock.textContent = formatMinute(game.time);
  elements.task.textContent = `${progress.completed} / ${progress.total}`;
  elements.taskNote.textContent = progress.reorderTasks
    ? `含翻箱 ${progress.reorderTasks}`
    : game.status === "won"
      ? "全部完成"
      : "待调度";
  elements.lane.textContent = `${game.channelWidth} 格`;
  elements.lane.style.color = game.channelBlocked
    ? "var(--red)"
    : game.channelWidth === 1
      ? "var(--amber)"
      : "var(--ink)";
  elements.laneNote.textContent = game.channelBlocked
    ? "双 lane 回堵"
    : game.channelWidth === 1
      ? "仅剩一格"
      : "通畅";
  elements.laneNote.style.color = game.channelBlocked ? "var(--red)" : "var(--muted-2)";

  ui.load = computeLoad();
  ui.channelBlocked = game.channelBlocked;
  elements.load.textContent = `${Math.round(ui.load * 100)}%`;
  elements.loadBar.style.width = `${Math.round(ui.load * 100)}%`;
  elements.loadBar.style.background = game.channelBlocked
    ? "linear-gradient(90deg, var(--red), #ff9b68)"
    : ui.load > 0.7
      ? "linear-gradient(90deg, var(--amber), var(--red))"
      : "linear-gradient(90deg, var(--cyan), var(--amber))";

  elements.queueCount.textContent = `${game.queue.length} 辆`;
  elements.start.textContent =
    game.status === "ready" ? "开始班次" : game.status === "running" ? "班次进行中" : "查看战报";
  elements.start.disabled = game.status === "running";
  elements.pause.disabled = game.status !== "running";
  elements.pause.textContent = game.paused ? "继续" : "暂停";

  elements.badge.classList.toggle("danger", game.channelBlocked || game.status === "lost");
  elements.badge.classList.toggle(
    "active",
    game.status === "running" && !game.channelBlocked && !game.paused,
  );
  elements.badgeText.textContent = game.channelBlocked
    ? "主通道零净宽"
    : game.status === "ready"
      ? "等待开始"
      : game.status === "won"
        ? "班次达标"
        : game.status === "lost"
          ? "班次未达标"
          : game.paused
            ? "模拟已暂停"
            : "堆场作业中";
  elements.hint.textContent = currentHint;
}

function renderQueue() {
  const trucks = game.queue.map((id) => getTruck(game, id)).filter(Boolean);
  if (!trucks.length) {
    elements.queue.innerHTML = '<div class="empty-state">队列已清空<br />吊机正在完成最后作业</div>';
    return;
  }
  elements.queue.innerHTML = trucks
    .map((truck, index) => {
      const destination = DESTINATIONS[truck.destination];
      const urgent = truck.deadline - game.time <= 5;
      return `
        <article
          class="truck-card ${ui.selectedTruckId === truck.id ? "selected" : ""} ${index === 0 ? "head-of-queue" : ""}"
          data-truck-id="${truck.id}"
          style="--dest-color: ${destination.color}"
        >
          <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
          <div class="truck-main">
            <div class="truck-topline">
              <span class="truck-plate">${truck.plate}</span>
              <span class="destination-pill">${destination.code} ${destination.name}</span>
            </div>
            <div class="truck-meta">
              <span>箱重 <strong>${truck.weight}t</strong></span>
              <span style="color:${urgent ? "var(--red)" : "inherit"}">截止 <strong>${formatMinute(truck.deadline)}</strong></span>
            </div>
          </div>
          <div class="queue-controls">
            <button type="button" data-queue-dir="-1" data-truck-id="${truck.id}" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-queue-dir="1" data-truck-id="${truck.id}" aria-label="下移" ${index === trucks.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCargo() {
  const truck = currentTruck();
  const stack = currentStack();
  const destination = truck ? DESTINATIONS[truck.destination] : null;

  if (!truck && !stack) {
    elements.selectionTag.textContent = "未选集卡";
    elements.cargo.innerHTML = '<div class="empty-state">从上方队列选择集卡<br />或直接点击画布中的车辆</div>';
    elements.dispatch.disabled = true;
    elements.dispatch.textContent = "确认派工";
    elements.targetName.textContent = "点击画布选择";
    elements.reorder.hidden = true;
    return;
  }

  if (truck) {
    elements.selectionTag.textContent = truck.plate;
    const isHead = game.queue[0] === truck.id;
    const topBox = stack?.boxes.at(-1);
    const risky = Boolean(topBox && truck.weight > topBox.weight);
    const preview = stack
      ? previewUnload(game, {
          truckId: truck.id,
          stackId: stack.id,
          craneId: ui.selectedCraneId,
          route: ui.route,
        })
      : null;
    const queueNote = !isHead
      ? `<div class="risk-note">当前队列第 ${game.queue.indexOf(truck.id) + 1} 位，需先上移至首位才能派工。</div>`
      : "";
    const stackNote = stack
      ? `<div class="risk-note ${risky ? "" : "safe-note"}">${
          risky
            ? `${truck.weight}t 将压在 ${topBox.weight}t 上：落箱后新增一次翻箱重排。`
            : `层位稳定：${stack.boxes.length + 1}/${CONFIG.stackCapacity} 层，预计 ${
                preview?.ok ? preview.minutes : "待定"
              } 分钟。`
        }</div>`
      : "";
    elements.cargo.innerHTML = `
      <div class="cargo-heading">
        <div>
          <h4>${truck.plate} · ${truck.weight}t 重箱</h4>
          <p>${destination.name}方向 · 截止 ${formatMinute(truck.deadline)}</p>
        </div>
        <span class="cargo-id">${truck.boxId}</span>
      </div>
      <div class="cargo-facts">
        <div class="cargo-fact"><span>箱重</span><strong>${truck.weight} t</strong></div>
        <div class="cargo-fact"><span>目的地</span><strong>${destination.code}</strong></div>
        <div class="cargo-fact"><span>落箱位</span><strong>${stack ? stack.id : "待选"}</strong></div>
      </div>
      ${queueNote}${stackNote}
    `;
    elements.dispatch.disabled = !(preview?.ok && game.status === "running");
    elements.dispatch.textContent = preview?.ok ? `确认派工 · ${ui.selectedCraneId} 吊机` : "确认派工";
    elements.targetName.textContent = stack ? `${stack.label} · ${stack.boxes.length + 1} 层` : "点击画布选择";
    elements.reorder.hidden = true;
  } else {
    elements.selectionTag.textContent = stack ? stack.id : "未选集卡";
    elements.cargo.innerHTML = `
      <div class="cargo-heading">
        <div>
          <h4>${stack.label}</h4>
          <p>${DESTINATIONS[stack.destination].name}方向 · ${stack.boxes.length}/${CONFIG.stackCapacity} 箱</p>
        </div>
        <span class="cargo-id">${stack.unstable ? "UNSTABLE" : "STABLE"}</span>
      </div>
      <div class="cargo-facts">
        ${stack.boxes.length
          ? stack.boxes.map((box) => `<div class="cargo-fact"><span>层 ${stack.boxes.indexOf(box) + 1}</span><strong>${box.weight} t</strong></div>`).join("")
          : '<div class="cargo-fact" style="grid-column: 1 / -1"><span>箱位状态</span><strong>空位可用</strong></div>'}
      </div>
      ${stack.reorderRequired ? '<div class="risk-note">检测到重压轻：需要调用吊机与缓冲区完成翻箱。</div>' : '<div class="risk-note safe-note">该箱位层序稳定。</div>'}
    `;
    elements.dispatch.disabled = true;
    elements.dispatch.textContent = "确认派工";
    elements.targetName.textContent = stack.label;
    const check = canReorder(game, stack.id, ui.selectedCraneId);
    elements.reorder.hidden = !(stack.reorderRequired && check.ok && game.status === "running");
    elements.reorder.textContent = `翻箱重排 · 吊机 ${ui.selectedCraneId}`;
  }
}

function renderControlState() {
  elements.cranePicker.querySelectorAll("[data-crane]").forEach((button) => {
    const crane = game.cranes.find((item) => item.id === button.dataset.crane);
    button.classList.toggle("active", ui.selectedCraneId === button.dataset.crane);
    button.querySelector("small").textContent = crane.operation ? "作业中" : "空闲";
  });
  elements.routePicker.querySelectorAll("[data-route]").forEach((button) => {
    button.classList.toggle("active", ui.route === button.dataset.route);
    button.querySelector("small").textContent = ROUTES[button.dataset.route].channel
      ? button.dataset.route === "laneN" ? "3 行" : "4 行"
      : "通道外";
  });
}

function renderEvents() {
  if (game.eventSequence === lastEventSequence && elements.events.childElementCount) return;
  const latest = game.eventSequence;
  elements.events.innerHTML = game.events
    .slice(0, 12)
    .map(
      (event) => `
        <li class="event-item" data-tone="${event.tone}">
          <span class="event-time">${formatMinute(event.time)}</span>${event.message}
        </li>
      `,
    )
    .join("");
  if (latest > lastEventSequence && game.events[0]?.tone === "danger" && audio.context) {
    audio.note("warning");
  }
  lastEventSequence = latest;
}

function updateUi(force = false) {
  renderQueue();
  renderCargo();
  renderControlState();
  renderEvents();
  updateMetrics();
  if (force && game.status !== "ready") {
    elements.hint.textContent = currentHint;
  }
}

elements.queue.addEventListener("click", (event) => {
  const directionButton = event.target.closest("[data-queue-dir]");
  if (directionButton) {
    event.stopPropagation();
    const result = moveQueueTruck(
      game,
      directionButton.dataset.truckId,
      Number(directionButton.dataset.queueDir),
    );
    if (!result.ok) {
      currentHint = result.error;
    } else {
      currentHint = "排队顺序已更新，可继续派工";
    }
    updateUi(true);
    return;
  }
  const card = event.target.closest("[data-truck-id]");
  if (card) selectTruck(card.dataset.truckId);
});

elements.cranePicker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-crane]");
  if (!button) return;
  ui.selectedCraneId = button.dataset.crane;
  updateUi(true);
});

elements.routePicker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-route]");
  if (!button) return;
  ui.route = button.dataset.route;
  currentHint = `${ROUTES[ui.route].name}路径已选择 · ${
    ROUTES[ui.route].channel ? "将占用主通道" : "绕行通道外"
  }`;
  updateUi(true);
});

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  const hit = renderer.hitTest(point.x, point.y);
  canvas.style.cursor = hit ? "pointer" : "crosshair";
});

canvas.addEventListener("click", (event) => {
  if (!elements.modal.hidden) return;
  const point = canvasPoint(event);
  const hit = renderer.hitTest(point.x, point.y);
  if (!hit) return;
  if (hit.type === "truck") selectTruck(hit.id);
  if (hit.type === "stack") selectStack(hit.id);
});

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

elements.dispatch.addEventListener("click", dispatchSelected);
elements.reorder.addEventListener("click", reorderSelected);
elements.start.addEventListener("click", beginShift);
elements.pause.addEventListener("click", togglePauseState);
elements.reset.addEventListener("click", resetGame);
elements.help.addEventListener("click", showHelp);
elements.sound.addEventListener("click", toggleSound);

document.querySelectorAll("[data-speed]").forEach((button) => {
  button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
});

elements.modalActions.addEventListener("click", (event) => {
  const action = event.target.closest("[data-modal-action]")?.dataset.modalAction;
  if (!action) return;
  if (action === "reset") {
    resetGame();
    return;
  }
  closeModal();
});

elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) closeModal();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.modal.hidden) {
    closeModal();
    return;
  }
  if (event.target.matches("button, input, textarea")) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePauseState();
  }
  if (event.key.toLowerCase() === "r") resetGame();
  if (event.key.toLowerCase() === "h") showHelp();
});

function simulationFrame(now) {
  const elapsed = Math.min(0.12, (now - lastFrame) / 1000);
  lastFrame = now;
  if (game.status === "running" && !game.paused) {
    accumulator += elapsed * speed;
    let guard = 0;
    while (accumulator >= 0.05 && guard < 20) {
      step(game, 0.05);
      accumulator -= 0.05;
      guard += 1;
      if (game.status !== "running") break;
    }
  }

  updateMetrics();
  audio.setLoad(
    ui.load,
    game.channelBlocked,
    game.cranes.filter((crane) => crane.operation).length,
  );
  renderer.draw(game, ui, now);

  if (now - lastUiUpdate > 110) {
    updateUi();
    lastUiUpdate = now;
  }

  if (game.status !== lastStatus) {
    if (game.status === "won") audio.note("success");
    if (game.status === "lost") audio.note("failure");
    if ((game.status === "won" || game.status === "lost") && !outcomeShown) {
      showOutcome();
    }
    lastStatus = game.status;
    updateUi(true);
  }
  requestAnimationFrame(simulationFrame);
}

updateUi(true);
requestAnimationFrame(simulationFrame);
