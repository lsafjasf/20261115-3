import {
  WORLD,
  cities,
  landAt,
} from "./map-data.js";
import {
  checkLabelCollisions,
  evaluateBox,
  layoutLabels,
  measureCityLabel,
  rectFromCenter,
  screenToWorld,
  verifyLabelGeometry,
  worldToScreen,
} from "./label-layout.js";
import { drawScene } from "./renderer.js";
import { buildSvg, downloadSvg } from "./svg-export.js";

const canvas = document.querySelector("#mapCanvas");
const stage = document.querySelector("#mapStage");
const ctx = canvas.getContext("2d");
const zoomReadout = document.querySelector("#zoomReadout");
const zoomStatus = document.querySelector("#zoomStatus");
const worldReadout = document.querySelector("#worldReadout");
const totalLabels = document.querySelector("#totalLabels");
const pinnedLabels = document.querySelector("#pinnedLabels");
const validCandidates = document.querySelector("#validCandidates");
const candidateToggle = document.querySelector("#candidateToggle");
const unreadableToggle = document.querySelector("#unreadableToggle");
const candidateGrid = document.querySelector("#candidateGrid");
const candidateSummary = document.querySelector("#candidateSummary");
const selectedName = document.querySelector("#selectedName");
const selectedEnglish = document.querySelector("#selectedEnglish");
const selectedIndex = document.querySelector("#selectedIndex");
const selectedCoords = document.querySelector("#selectedCoords");
const citySymbol = document.querySelector("#citySymbol");
const pinToggle = document.querySelector("#pinToggle");
const labelList = document.querySelector("#labelList");
const healthBadge = document.querySelector(".health-badge");
const collisionStatus = document.querySelector("#collisionStatus");
const verificationResult = document.querySelector("#verificationResult");
const toast = document.querySelector("#toast");

const state = {
  view: { scale: 1, panX: 0, panY: 0, width: 1, height: 1 },
  baseScale: 1,
  zoomFactor: 1,
  selectedId: "bai-harbor",
  pinnedWorld: {},
  manualSlots: {},
  showCandidates: true,
  showUnreadable: false,
  layout: null,
  dpr: 1,
  drag: null,
  dragBlocked: false,
  pointerWorld: { x: 0, y: 0 },
  ready: false,
  toastTimer: null,
};

function cityById(id) {
  return cities.find((city) => city.id === id) ?? cities[0];
}

function cityLand(city) {
  return landAt({ x: city.x, y: city.y });
}

function clampZoom(scale) {
  const min = state.baseScale;
  const max = state.baseScale * 5;
  return Math.max(min, Math.min(max, scale));
}

function fitView() {
  const width = state.view.width;
  const height = state.view.height;
  state.baseScale = Math.min(
    (width - 42) / WORLD.width,
    (height - 36) / WORLD.height,
  );
  state.zoomFactor = 1;
  state.view.scale = state.baseScale;
  state.view.panX = (width - WORLD.width * state.baseScale) / 2;
  state.view.panY = (height - WORLD.height * state.baseScale) / 2;
}

function zoomAt(factor, screenPoint) {
  const anchor = screenPoint ?? {
    x: state.view.width / 2,
    y: state.view.height / 2,
  };
  const world = screenToWorld(anchor, state.view);
  const nextScale = clampZoom(state.view.scale * factor);
  state.view.scale = nextScale;
  state.view.panX = anchor.x - world.x * nextScale;
  state.view.panY = anchor.y - world.y * nextScale;
  state.zoomFactor = nextScale / state.baseScale;
  updateAll();
}

function refreshLayout() {
  state.layout = layoutLabels({
    ctx,
    cities,
    view: state.view,
    pinnedWorld: state.pinnedWorld,
    selectedId: state.selectedId,
    manualSlots: state.manualSlots,
  });
  return state.layout;
}

function render() {
  if (!state.layout) refreshLayout();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  drawScene(ctx, {
    width: state.view.width,
    height: state.view.height,
    view: state.view,
    layout: state.layout,
    selectedId: state.selectedId,
    showCandidates: state.showCandidates,
    showUnreadable: state.showUnreadable,
  });
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const previousCenter = screenToWorld(
    { x: state.view.width / 2, y: state.view.height / 2 },
    state.view,
  );
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.dpr = dpr;
  state.view.width = rect.width;
  state.view.height = rect.height;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  if (!state.ready) {
    fitView();
    return;
  }

  const nextBase = Math.min(
    (rect.width - 42) / WORLD.width,
    (rect.height - 36) / WORLD.height,
  );
  state.baseScale = nextBase;
  state.view.scale = nextBase * state.zoomFactor;
  state.view.panX = rect.width / 2 - previousCenter.x * state.view.scale;
  state.view.panY = rect.height / 2 - previousCenter.y * state.view.scale;
  state.layout = null;
}

function updateCandidateGrid() {
  candidateGrid.replaceChildren();
  const selected = cityById(state.selectedId);
  const candidates = state.layout?.candidates ?? [];
  const current = state.layout?.labels.find((label) => label.cityId === selected.id);
  const valid = candidates.filter((candidate) => candidate.valid).length;
  validCandidates.textContent = candidates.length ? `${valid}` : "—";
  candidateSummary.textContent = candidates.length
    ? `8 个候选 · ${valid} 个可用`
    : "当前城市没有候选数据";

  for (const candidate of [...candidates].sort((a, b) => a.slot - b.slot)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `candidate-chip ${candidate.valid ? "is-valid" : "is-invalid"}`;
    if (current?.slot === candidate.slot && !current.pinned) button.classList.add("is-current");
    button.textContent = candidate.direction.key;
    button.title = candidate.valid
      ? `${candidate.direction.label}侧候选 · 点击定位`
      : candidate.reason;
    button.setAttribute("aria-label", `${candidate.direction.label}侧候选：${candidate.reason}`);
    button.addEventListener("click", () => chooseCandidate(candidate.slot));
    candidateGrid.append(button);
  }
}

function updateSelectedCard() {
  const selected = cityById(state.selectedId);
  const label = state.layout?.labels.find((item) => item.cityId === selected.id);
  const pinned = Boolean(state.pinnedWorld[selected.id]);
  const worldX = pinned ? state.pinnedWorld[selected.id].x : label?.worldX ?? selected.x;
  const worldY = pinned ? state.pinnedWorld[selected.id].y : label?.worldY ?? selected.y;

  selectedName.textContent = selected.name;
  selectedEnglish.textContent = selected.en;
  selectedIndex.textContent = `CITY ${String(cities.indexOf(selected) + 1).padStart(2, "0")}`;
  selectedCoords.textContent = `X ${Math.round(worldX)} · Y ${Math.round(worldY)}`;
  citySymbol.textContent = selected.name.slice(0, 1);
  pinToggle.classList.toggle("is-pinned", pinned);
  pinToggle.querySelector("span").textContent = pinned ? "已固定" : "固定";
  pinToggle.setAttribute("aria-pressed", String(pinned));
}

function updateLabelList() {
  labelList.replaceChildren();
  for (const [index, city] of cities.entries()) {
    const label = state.layout?.labels.find((item) => item.cityId === city.id);
    const pinned = Boolean(state.pinnedWorld[city.id]);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "label-row";
    if (city.id === state.selectedId) row.classList.add("is-selected");
    if (pinned) row.classList.add("is-pinned");

    const number = document.createElement("span");
    number.className = "label-index";
    number.textContent = String(index + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "label-row-name";
    name.textContent = city.name;
    const english = document.createElement("small");
    english.textContent = city.en;
    name.append(english);

    const status = document.createElement("span");
    status.className = `label-state${pinned ? " is-pinned" : ""}`;
    status.textContent = pinned ? "固定" : label?.hidden ? "隐藏" : "自动";

    const pin = document.createElement("span");
    pin.className = "mini-pin";
    pin.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 1.6 3.5 3.5-.8.8.5 2.2-.7.7-2.4-2.4-2.2 3.1-.6-.6 3.1-2.2-2.4-2.4.7-.7 2.2.5.8-.8"/></svg>';
    row.append(number, name, status, pin);
    row.addEventListener("click", () => locateCity(city.id));
    labelList.append(row);
  }
}

function updateStatus() {
  const collisions = checkLabelCollisions(state.layout?.labels ?? []);
  const geometry = verifyLabelGeometry(state.layout?.labels ?? [], state.view);
  const crossing = geometry.filter((item) => !item.valid).length;
  const pinnedCount = Object.keys(state.pinnedWorld).length;
  const visibleLabels = state.layout?.labels.filter((label) => !label.hidden).length ?? 0;
  totalLabels.textContent = String(visibleLabels);
  pinnedLabels.textContent = String(pinnedCount);
  const zoomText = `${Math.round(state.zoomFactor * 100)}%`;
  zoomReadout.textContent = zoomText;
  zoomStatus.textContent = `缩放 ${zoomText}`;
  collisionStatus.textContent =
    collisions.length || crossing
      ? `${collisions.length} 处标签碰撞 · ${crossing} 处压线`
      : "0 个标签碰撞 · 0 处压线";
  healthBadge.classList.toggle("is-warning", collisions.length > 0 || crossing > 0);
  healthBadge.innerHTML = `<i></i> ${
    collisions.length || crossing ? `${collisions.length + crossing} 处问题` : "无碰撞"
  }`;
}

function updateAll() {
  if (!state.ready) return;
  state.layout = refreshLayout();
  updateSelectedCard();
  updateCandidateGrid();
  updateLabelList();
  updateStatus();
  render();
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function selectCity(cityId) {
  state.selectedId = cityId;
  state.dragBlocked = false;
  state.layout = refreshLayout();
  updateSelectedCard();
  updateCandidateGrid();
  updateLabelList();
  updateStatus();
  render();
}

function locateCity(cityId) {
  selectCity(cityId);
  const city = cityById(cityId);
  const point = worldToScreen(city, state.view);
  const dx = state.view.width / 2 - point.x;
  const dy = state.view.height / 2 - point.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    state.view.panX += dx;
    state.view.panY += dy;
    state.layout = refreshLayout();
    render();
  }
}

function chooseCandidate(slot) {
  const selected = cityById(state.selectedId);
  const candidate = state.layout.candidates.find((item) => item.slot === slot);
  if (!candidate) return;
  if (!candidate.valid) {
    showToast(`该候选不可用：${candidate.reason}`, true);
    return;
  }
  const world = screenToWorld({ x: candidate.box.cx, y: candidate.box.cy }, state.view);
  if (state.pinnedWorld[selected.id]) {
    state.pinnedWorld[selected.id] = { x: world.x, y: world.y, slot };
  } else {
    state.manualSlots[selected.id] = slot;
  }
  updateAll();
  showToast(`${selected.name} · 已定位到${candidate.direction.label}侧候选`);
}

function toggleSelectedPin() {
  const selected = cityById(state.selectedId);
  if (state.pinnedWorld[selected.id]) {
    delete state.pinnedWorld[selected.id];
    state.dragBlocked = false;
    updateAll();
    showToast(`${selected.name} · 已解除固定，将参与自动避让`);
    return;
  }

  const label = state.layout.labels.find((item) => item.cityId === selected.id);
  if (!label || label.hidden) {
    showToast("当前标签没有可固定的有效位置", true);
    return;
  }
  state.pinnedWorld[selected.id] = {
    x: label.worldX,
    y: label.worldY,
    slot: label.slot,
  };
  updateAll();
  showToast(`${selected.name} · 已固定在世界坐标 X ${Math.round(label.worldX)} / Y ${Math.round(label.worldY)}`);
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function labelAt(point) {
  if (!state.layout) return null;
  for (let index = state.layout.labels.length - 1; index >= 0; index -= 1) {
    const label = state.layout.labels[index];
    if (label.hidden) continue;
    const { box } = label;
    if (
      point.x >= box.x &&
      point.x <= box.right &&
      point.y >= box.y &&
      point.y <= box.bottom
    ) {
      return label;
    }
  }
  return null;
}

function beginLabelDrag(event, label, point) {
  state.selectedId = label.cityId;
  state.dragBlocked = false;
  const labelPoint = worldToScreen(
    {
      x: state.pinnedWorld[label.cityId]?.x ?? label.worldX,
      y: state.pinnedWorld[label.cityId]?.y ?? label.worldY,
    },
    state.view,
  );
  state.drag = {
    mode: "label-pending",
    cityId: label.cityId,
    startX: point.x,
    startY: point.y,
    offsetX: point.x - labelPoint.x,
    offsetY: point.y - labelPoint.y,
    pointerId: event.pointerId,
  };
  selectCity(label.cityId);
}

function ensureLabelPinnedForDrag() {
  const city = cityById(state.drag.cityId);
  if (state.pinnedWorld[city.id]) return;
  const label = state.layout.labels.find((item) => item.cityId === city.id);
  if (!label || label.hidden) return;
  state.pinnedWorld[city.id] = {
    x: label.worldX,
    y: label.worldY,
    slot: label.slot,
  };
}

function dragLabel(point) {
  const city = cityById(state.drag.cityId);
  ensureLabelPinnedForDrag();
  const metric = measureCityLabel(ctx, city);
  const center = {
    x: point.x - state.drag.offsetX,
    y: point.y - state.drag.offsetY,
  };
  const nextBox = rectFromCenter(center.x, center.y, metric.width, metric.height);
  const result = evaluateBox({
    box: nextBox,
    city,
    land: cityLand(city),
    view: state.view,
    labels: state.layout.labels,
    checkViewport: true,
  });
  if (!result.valid) {
    state.dragBlocked = true;
    return;
  }
  const world = screenToWorld(center, state.view);
  const slot = state.layout.candidates.find(
    (candidate) => Math.abs(candidate.box.cx - center.x) < 2 && Math.abs(candidate.box.cy - center.y) < 2,
  )?.slot;
  state.pinnedWorld[city.id] = { x: world.x, y: world.y, slot: slot ?? null };
  state.dragBlocked = false;
  updateSelectedCard();
  updateStatus();
  state.layout = refreshLayout();
  render();
}

function endPointerInteraction(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  canvas.classList.remove("is-dragging");
  if (drag.mode === "label" || drag.mode === "label-pending") {
    const city = cityById(drag.cityId);
    if (drag.mode === "label-pending") {
      updateAll();
    } else if (state.dragBlocked) {
      updateAll();
      showToast("该位置压线或与其他标签重叠，标签保持在上一有效位置", true);
    } else {
      updateAll();
      const world = state.pinnedWorld[city.id];
      showToast(
        `${city.name} · 已固定于 X ${Math.round(world.x)} / Y ${Math.round(world.y)}`,
      );
    }
  } else {
    updateAll();
  }
  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const point = pointerPosition(event);
  const label = labelAt(point);
  canvas.setPointerCapture?.(event.pointerId);
  if (label) {
    beginLabelDrag(event, label, point);
    return;
  }
  state.drag = {
    mode: "pan",
    startX: point.x,
    startY: point.y,
    panX: state.view.panX,
    panY: state.view.panY,
    pointerId: event.pointerId,
  };
  canvas.classList.add("is-dragging");
}

function onPointerMove(event) {
  const point = pointerPosition(event);
  const world = screenToWorld(point, state.view);
  state.pointerWorld = world;
  worldReadout.textContent = `X ${Math.round(world.x).toString().padStart(4, "0")} · Y ${Math.round(world.y).toString().padStart(4, "0")}`;

  if (!state.drag || state.drag.pointerId !== event.pointerId) {
    canvas.classList.toggle("is-over-label", Boolean(labelAt(point)));
    return;
  }

  if (state.drag.mode === "pan") {
    state.view.panX = state.drag.panX + point.x - state.drag.startX;
    state.view.panY = state.drag.panY + point.y - state.drag.startY;
    state.layout = refreshLayout();
    render();
    return;
  }

  const distance = Math.hypot(point.x - state.drag.startX, point.y - state.drag.startY);
  if (state.drag.mode === "label-pending") {
    if (distance < 3) return;
    state.drag.mode = "label";
    canvas.classList.add("is-dragging");
    ensureLabelPinnedForDrag();
  }
  dragLabel(point);
}

function onPointerUp(event) {
  endPointerInteraction(event);
}

function onWheel(event) {
  event.preventDefault();
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  const factor = Math.exp(-delta * 0.0013);
  zoomAt(factor, pointerPosition(event));
}

function zoomStep(direction) {
  zoomAt(direction > 0 ? 1.26 : 1 / 1.26);
}

function capturePinnedWorld() {
  return Object.fromEntries(
    Object.entries(state.pinnedWorld).map(([id, value]) => [
      id,
      { x: value.x, y: value.y },
    ]),
  );
}

function runPinnedVerification() {
  const before = capturePinnedWorld();
  const ids = Object.keys(before);
  const startZoom = state.zoomFactor;
  if (!ids.length) {
    verificationResult.className = "verification-result is-error";
    verificationResult.innerHTML =
      '<span class="result-dot"></span><span>未找到固定标签。请先拖动或固定一个城市标签。</span>';
    showToast("请先固定至少一个标签", true);
    return { passed: false, reason: "no-pinned-labels" };
  }

  zoomAt(1.26);
  zoomAt(1.26);
  const afterLayout = refreshLayout();
  const after = capturePinnedWorld();
  const details = ids.map((id) => {
    const label = afterLayout.labels.find((item) => item.cityId === id);
    const city = cityById(id);
    const renderedWorld = label ? { x: label.worldX, y: label.worldY } : null;
    return {
      id,
      name: city.name,
      before: before[id],
      after: after[id],
      renderedWorld,
      drift: renderedWorld
        ? Math.hypot(renderedWorld.x - before[id].x, renderedWorld.y - before[id].y)
        : Infinity,
    };
  });
  const maxDrift = Math.max(...details.map((detail) => detail.drift));
  const collisions = checkLabelCollisions(afterLayout.labels);
  const geometry = verifyLabelGeometry(afterLayout.labels, state.view);
  const crossing = geometry.filter((item) => !item.valid);
  const passed = maxDrift < 0.001 && collisions.length === 0 && crossing.length === 0;
  const endZoom = state.zoomFactor;

  verificationResult.className = `verification-result ${passed ? "is-success" : "is-error"}`;
  const coordinateLine = details
    .slice(0, 2)
    .map(
      (detail) =>
        `${detail.name}  ${detail.before.x.toFixed(1)}, ${detail.before.y.toFixed(1)} → ${detail.renderedWorld.x.toFixed(1)}, ${detail.renderedWorld.y.toFixed(1)}`,
    )
    .join("\n");
  verificationResult.innerHTML = `<span class="result-dot"></span><span>${passed ? "✓ 验证通过" : "× 验证失败"} · ${details.length} 个固定标签\n最大漂移 ${maxDrift.toFixed(4)} px · ${collisions.length + crossing.length} 处冲突 · 缩放 ${Math.round(startZoom * 100)}% → ${Math.round(endZoom * 100)}%\n${coordinateLine}</span>`;
  showToast(
    passed
      ? `验证通过：放大两级后 ${details.length} 个固定标签世界坐标不变`
      : `验证失败：检测到 ${collisions.length + crossing.length} 处冲突`,
    !passed,
  );
  updateAll();
  return {
    passed,
    maxDrift,
    collisions: collisions.length,
    crossing: crossing.length,
    startZoom,
    endZoom,
    details,
  };
}

function exportMap() {
  const svg = buildSvg({
    cities,
    labels: state.layout.labels,
    view: state.view,
    pinnedWorld: state.pinnedWorld,
    selectedId: state.selectedId,
  });
  downloadSvg(svg, "north-reach-labels.svg");
  showToast("SVG 已导出 · 地形、边界、城市与标签为独立矢量图层");
  return svg;
}

function attachEvents() {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerleave", () => {
    if (!state.drag) canvas.classList.remove("is-over-label");
  });
  canvas.addEventListener("dblclick", (event) => {
    if (!labelAt(pointerPosition(event))) zoomAt(1.26, pointerPosition(event));
  });

  document.querySelector("#zoomInButton").addEventListener("click", () => zoomStep(1));
  document.querySelector("#zoomOutButton").addEventListener("click", () => zoomStep(-1));
  document.querySelector("#resetViewButton").addEventListener("click", () => {
    fitView();
    updateAll();
    showToast("视图已适应图幅");
  });
  document.querySelector("#verifyButton").addEventListener("click", runPinnedVerification);
  document.querySelector("#exportButton").addEventListener("click", exportMap);
  document.querySelector("#exportButtonBottom").addEventListener("click", exportMap);
  pinToggle.addEventListener("click", toggleSelectedPin);
  candidateToggle.addEventListener("change", () => {
    state.showCandidates = candidateToggle.checked;
    render();
  });
  unreadableToggle.addEventListener("change", () => {
    state.showUnreadable = unreadableToggle.checked;
    render();
  });

  const helpDialog = document.querySelector("#helpDialog");
  document.querySelector("#helpButton").addEventListener("click", () => helpDialog.showModal());
  document.querySelector("#closeHelpButton").addEventListener("click", () => helpDialog.close());
  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "+" || event.key === "=") zoomStep(1);
    if (event.key === "-" || event.key === "_") zoomStep(-1);
    if (event.key === "0") {
      fitView();
      updateAll();
    }
  });
}

async function initialize() {
  await document.fonts.ready;
  resizeCanvas();
  state.ready = true;
  state.layout = refreshLayout();

  for (const id of ["bai-harbor", "songyuan"]) {
    const label = state.layout.labels.find((item) => item.cityId === id);
    if (!label || label.hidden) continue;
    state.pinnedWorld[id] = {
      x: label.worldX,
      y: label.worldY,
      slot: label.slot,
    };
  }

  updateAll();
  attachEvents();
  setViewBounds();
}

function setViewBounds() {
  const observer = new ResizeObserver(() => {
    if (!state.ready) return;
    resizeCanvas();
    updateAll();
  });
  observer.observe(stage);
}

window.mapApp = {
  getState: () => {
    const labels = state.layout?.labels ?? [];
    const collisions = checkLabelCollisions(labels);
    const geometry = verifyLabelGeometry(labels, state.view);
    return {
      view: { ...state.view },
      zoomFactor: state.zoomFactor,
      pinnedWorld: capturePinnedWorld(),
      selectedId: state.selectedId,
      showCandidates: state.showCandidates,
      showUnreadable: state.showUnreadable,
      collisions: collisions.length,
      crossing: geometry.filter((item) => !item.valid).length,
      labels: labels.map((label) => ({
        cityId: label.cityId,
        name: label.name,
        x: label.worldX,
        y: label.worldY,
        pinned: label.pinned,
        hidden: label.hidden,
        slot: label.slot,
        box: {
          x: label.box.x,
          y: label.box.y,
          width: label.box.width,
          height: label.box.height,
        },
      })),
    };
  },
  runPinnedVerification,
  exportSvg: () => {
    const svg = buildSvg({
      cities,
      labels: state.layout.labels,
      view: state.view,
      pinnedWorld: state.pinnedWorld,
      selectedId: state.selectedId,
    });
    downloadSvg(svg, "north-reach-labels.svg");
    return svg;
  },
  zoomStep,
};

initialize();
