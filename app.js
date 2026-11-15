import {
  TRACKS,
  TRACK_MAP,
  clamp,
  clone,
  collectKeyframesInRange,
  countKeyframes,
  deleteObject,
  findKeyframe,
  formatTime,
  getChildren,
  getDescendantIds,
  getTrack,
  getValues,
  keyframeTimes,
  makeObject,
  moveKeyframe,
  normalizeProject,
  pasteKeyframes,
  removeKeyframe,
  round,
  setKeyframe,
  setParent,
  uid
} from "./model.js";
import { createDemoProject } from "./demo.js";
import { beatInfo, getWorldMatrices, hitTest, parentLocalDelta, renderScene } from "./renderer.js";

const AUTOSAVE_KEY = "orbit-keyframe-studio-v1";
const $ = (id) => document.getElementById(id);
const dom = {
  stage: $("stage"),
  hierarchy: $("hierarchy"),
  inspector: $("inspector"),
  timelineRows: $("timeline-rows"),
  timelineContent: $("timeline-content"),
  timelineScroll: $("timeline-scroll"),
  rulerLane: $("ruler-lane"),
  rulerTicks: $("ruler-ticks"),
  rulerBeats: $("ruler-beats"),
  rangeSelection: $("range-selection"),
  playhead: $("playhead"),
  waveform: $("waveform"),
  audioLane: $("audio-lane"),
  audioBeats: $("audio-beats"),
  projectName: $("project-name"),
  duplicateBtn: $("duplicate-btn"),
  sceneTitle: $("scene-title"),
  resolution: $("resolution-label"),
  timeCurrent: $("time-current"),
  timeTotal: $("time-total"),
  beatDots: $("beat-dots"),
  beatCount: $("beat-count"),
  playButton: $("play-btn"),
  undoBtn: $("undo-btn"),
  redoBtn: $("redo-btn"),
  saveState: $("save-state"),
  fileInput: $("file-input"),
  audioInput: $("audio-input"),
  toast: $("toast"),
  exportOverlay: $("export-overlay"),
  exportProgress: $("export-progress"),
  exportPercent: $("export-percent"),
  exportTime: $("export-time"),
  exportCaption: $("export-caption")
};

const state = {
  project: null,
  selectedId: null,
  selectedKey: null,
  time: 0,
  playing: false,
  playStartedAt: 0,
  playStartTime: 0,
  pxPerSec: 120,
  rangeStart: 0,
  rangeEnd: 2,
  collapsed: new Set(),
  clipboard: null,
  waveform: null,
  canvasDrag: null,
  keyDrag: null,
  rulerDrag: null,
  saveTimer: null,
  toastTimer: null,
  audio: null,
  audioContext: null,
  lastBeatIndex: -1,
  exporting: false
};

const history = {
  stack: [],
  index: -1
};

const icons = {
  group: '<svg viewBox="0 0 24 24"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7"/></svg>',
  rect: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="6.5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M8 20h8"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6c2 0 3.8.8 5.2 1.8M21 12s-3.5 6-9 6c-2 0-3.8-.8-5.2-1.8M3 3l18 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.4-2"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M5 12h9a5 5 0 0 1 0 10h-2"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M19 12h-9a5 5 0 0 0 0 10h2"/></svg>'
};

function icon(type) {
  return icons[type] || icons.rect;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message, isError = false) {
  clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", isError);
  dom.toast.classList.add("show");
  state.toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2600);
}

function loadInitialProject() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      const parsed = normalizeProject(JSON.parse(saved));
      if (parsed.objects.length) return parsed;
    }
  } catch {
    // A corrupt autosave should never block the demo project.
  }
  return normalizeProject(createDemoProject());
}

function resetHistory() {
  history.stack = [clone(state.project)];
  history.index = 0;
  updateUndoButtons();
}

function checkpoint() {
  if (state.exporting) return;
  const current = clone(state.project);
  if (JSON.stringify(current) === JSON.stringify(history.stack[history.index])) return;
  history.stack = history.stack.slice(0, history.index + 1);
  history.stack.push(current);
  if (history.stack.length > 70) history.stack.shift();
  history.index = history.stack.length - 1;
  updateUndoButtons();
  autosave();
}

function undo() {
  if (history.index <= 0) return;
  pause(false);
  history.index -= 1;
  state.project = normalizeProject(clone(history.stack[history.index]));
  state.selectedKey = null;
  ensureSelection();
  state.time = clamp(state.time, 0, state.project.duration);
  refreshAll();
  autosave();
  toast("已撤销");
}

function redo() {
  if (history.index >= history.stack.length - 1) return;
  pause(false);
  history.index += 1;
  state.project = normalizeProject(clone(history.stack[history.index]));
  state.selectedKey = null;
  ensureSelection();
  state.time = clamp(state.time, 0, state.project.duration);
  refreshAll();
  autosave();
  toast("已重做");
}

function updateUndoButtons() {
  dom.undoBtn.disabled = history.index <= 0;
  dom.redoBtn.disabled = history.index >= history.stack.length - 1;
}

function autosave() {
  clearTimeout(state.saveTimer);
  dom.saveState.textContent = "保存中…";
  state.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.project));
      dom.saveState.textContent = "已保存";
    } catch {
      dom.saveState.textContent = "存储已满";
    }
  }, 220);
}

function ensureSelection() {
  if (!state.project.objects.some((object) => object.id === state.selectedId)) {
    state.selectedId = state.project.objects.find((object) => !object.parentId)?.id || state.project.objects[0]?.id || null;
  }
  if (state.selectedKey) {
    const found = findKeyframe(state.project, state.selectedKey.objectId, state.selectedKey.property, state.selectedKey.keyId);
    if (!found) state.selectedKey = null;
  }
}

function selectedObject() {
  return state.project.objects.find((object) => object.id === state.selectedId) || null;
}

function refreshAll(options = {}) {
  document.title = `${state.project.name} · Orbit Studio`;
  dom.projectName.value = state.project.name;
  dom.sceneTitle.textContent = state.project.name;
  dom.resolution.textContent = `${state.project.width} × ${state.project.height}`;
  dom.timeTotal.textContent = formatTime(state.project.duration);
  $("fps-label").textContent = `${state.project.fps} FPS`;
  renderHierarchy();
  renderInspector();
  renderTimeline();
  renderCanvas();
  updateTimeUI();
  updateAudioMeta();
  updateUndoButtons();
  if (options.loadAudio) loadProjectAudio();
}

function parentGroupsFor(object) {
  if (!object) return state.project.objects.filter((item) => item.type === "group");
  return state.project.objects.filter(
    (item) => item.type === "group" && item.id !== object.id && !getDescendantIds(state.project, object.id).includes(item.id)
  );
}

function makeUniqueName(base) {
  const names = new Set(state.project.objects.map((object) => object.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function stagePoint(event) {
  const rect = dom.stage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.project.width,
    y: ((event.clientY - rect.top) / rect.height) * state.project.height
  };
}

function renderCanvas() {
  renderScene(dom.stage, state.project, state.time, { selectedId: state.selectedId });
  dom.stage.parentElement.style.aspectRatio = `${state.project.width} / ${state.project.height}`;
}

function setPlayhead(time, options = {}) {
  state.time = clamp(Number(time) || 0, 0, state.project.duration);
  if (state.playing) {
    state.playStartTime = state.time;
    state.playStartedAt = performance.now();
    if (state.audio) state.audio.currentTime = state.time;
  } else if (state.audio) {
    state.audio.currentTime = state.time;
  }
  renderCanvas();
  updateTimeUI();
  if (options.inspector !== false) renderInspector();
}

function updateTimeUI() {
  dom.timeCurrent.textContent = formatTime(state.time);
  const fraction = state.time / state.project.duration;
  dom.playhead.style.left = `${228 + fraction * state.project.duration * state.pxPerSec}px`;
  const beat = beatInfo(state.time, state.project.audio.beatInterval, state.project.audio.offset);
  dom.beatCount.textContent = beat.index >= 0 ? String(beat.index + 1).padStart(2, "0") : "--";
  [...dom.beatDots.children].forEach((dot, index) => dot.classList.toggle("active", beat.index >= 0 && index === beat.beat));
  dom.playButton.classList.toggle("playing", state.playing);
  dom.playButton.setAttribute("aria-label", state.playing ? "暂停" : "播放");
}

function initialize() {
  dom.undoBtn.innerHTML = icons.undo;
  dom.redoBtn.innerHTML = icons.redo;
  for (let index = 0; index < 4; index += 1) {
    const dot = document.createElement("i");
    dom.beatDots.append(dot);
  }
  state.project = loadInitialProject();
  state.selectedId = state.project.objects.find((object) => object.name === "Planet Rig")?.id
    || state.project.objects.find((object) => !object.parentId)?.id
    || null;
  state.rangeEnd = Math.min(2, state.project.duration);
  resetHistory();
  refreshAll({ loadAudio: true });
  bindEvents();
  setInterval(() => {
    if (state.playing) return;
    updateTimeUI();
  }, 250);
}

function renderHierarchy() {
  const nodes = (parentId, depth) => {
    let html = "";
    const children = getChildren(state.project, parentId).slice().reverse();
    for (const object of children) {
      const objectChildren = getChildren(state.project, object.id);
      const hasChildren = objectChildren.length > 0;
      const collapsed = state.collapsed.has(object.id);
      const selected = object.id === state.selectedId;
      html += `
        <div class="tree-node" style="padding-left:${depth * 13}px">
          <div class="tree-item ${selected ? "selected" : ""}" data-id="${object.id}">
            ${hasChildren
              ? `<button class="tree-toggle" data-action="collapse" title="${collapsed ? "展开" : "折叠"}">${collapsed ? "▶" : "▼"}</button>`
              : `<span class="tree-toggle"></span>`}
            <span class="tree-icon" style="color:${selected ? "var(--accent)" : ""}">${icon(object.type)}</span>
            <span class="tree-name">${escapeHtml(object.name)}</span>
            <span class="tree-type">${object.type === "group" ? "GRP" : object.type}</span>
            <span class="tree-actions">
              <button data-action="visible" class="${object.visible ? "" : "is-off"}" title="${object.visible ? "隐藏" : "显示"}">${icon(object.visible ? "eye" : "eyeOff")}</button>
              <button data-action="lock" class="${object.locked ? "is-off" : ""}" title="${object.locked ? "解锁" : "锁定"}">${icon(object.locked ? "lock" : "unlock")}</button>
            </span>
          </div>
          ${hasChildren && !collapsed ? `<div class="tree-children">${nodes(object.id, depth + 1)}</div>` : ""}
        </div>`;
    }
    return html;
  };
  const html = nodes(null, 0);
  dom.hierarchy.innerHTML = html || '<div class="inspector-empty">场景中还没有对象</div>';
  const count = $("hierarchy-count");
  if (count) count.textContent = state.project.objects.length;
}

function makeField(label, value, attributes, unit = "") {
  return `
    <div class="field ${attributes.includes("wide") ? "wide" : ""}">
      <label>${label}${attributes.includes("key-mark")
        ? `<span class="key-mark ${attributes.includes("animated") ? "animated" : ""}"></span>`
        : ""}</label>
      <div class="input-wrap ${unit ? "field-with-unit" : ""}">
        <input ${attributes.replace("key-mark", "").replace("animated", "").replace("wide", "")} value="${escapeHtml(value)}" />
        ${unit ? `<span class="field-unit">${unit}</span>` : ""}
      </div>
    </div>`;
}

function transformField(label, property, value, unit) {
  const track = getTrack(selectedObject(), property);
  const atTime = track.some((key) => Math.abs(key.time - state.time) <= 0.0015);
  const animated = track.length > 1;
  return `
    <div class="field">
      <label>${label}<span class="key-mark ${animated ? "animated" : ""} ${atTime ? "at-time" : ""}" title="${atTime ? "当前时间已有关键帧" : ""}"></span></label>
      <div class="input-wrap field-with-unit">
        <input type="number" step="any" data-transform="${property}" value="${round(value, 2)}" />
        <span class="field-unit">${unit}</span>
      </div>
    </div>`;
}

function renderInspector() {
  const object = selectedObject();
  if (!object) {
    dom.inspector.innerHTML = `
      <div class="inspector-empty">
        <div class="empty-orbit"></div>
        选择一个对象<br />查看并编辑它的属性
      </div>`;
    return;
  }
  const values = getValues(object, state.time);
  const parents = parentGroupsFor(object);
  const parentOptions = [
    `<option value="" ${!object.parentId ? "selected" : ""}>场景根级</option>`,
    ...parents.map((group) => `<option value="${group.id}" ${group.id === object.parentId ? "selected" : ""}>${escapeHtml(group.name)}</option>`)
  ].join("");
  const descendants = getDescendantIds(state.project, object.id).length;
  const objectKeys = TRACKS.reduce((sum, track) => sum + getTrack(object, track.key).length, 0);
  const selectedKeyData = state.selectedKey
    ? findKeyframe(state.project, state.selectedKey.objectId, state.selectedKey.property, state.selectedKey.keyId)
    : null;
  const selectedKeyHtml = selectedKeyData ? `
    <div class="keyframe-callout">
      <div class="keyframe-top">
        <span class="diamond"></span>
        <strong>${TRACK_MAP[selectedKeyData.property].label} 关键帧</strong>
        <span class="object-id">${selectedKeyData.key.id.slice(-6)}</span>
      </div>
      <div class="field-grid">
        <div class="field">
          <label>时间</label>
          <div class="input-wrap field-with-unit">
            <input type="number" min="0" max="${state.project.duration}" step="0.001" data-key-field="time" value="${round(selectedKeyData.key.time, 3)}" />
            <span class="field-unit">s</span>
          </div>
        </div>
        <div class="field">
          <label>数值</label>
          <input type="number" step="any" data-key-field="value" value="${round(selectedKeyData.key.value, 3)}" />
        </div>
        <div class="field wide">
          <label>缓动</label>
          <select data-key-field="ease">
            ${["easeInOut", "linear", "easeIn", "easeOut", "hold"].map((ease) =>
              `<option value="${ease}" ${selectedKeyData.key.ease === ease ? "selected" : ""}>${ease}</option>`
            ).join("")}
          </select>
        </div>
      </div>
      <div class="keyframe-actions">
        <button class="mini-button danger" data-inspector-action="delete-key" ${getTrack(object, selectedKeyData.property).length <= 1 ? "disabled" : ""}>删除关键帧</button>
      </div>
    </div>` : "";

  let shapeHtml = "";
  if (object.type !== "group") {
    shapeHtml = `
      <div class="inspector-section">
        <div class="section-title"><span>SHAPE</span><span>${object.type}</span></div>
        <div class="field-grid">
          ${makeField("宽度", round(object.style.width, 1), 'type="number" step="1" data-style="width"', "px")}
          ${makeField("高度", round(object.style.height, 1), 'type="number" step="1" data-style="height"', "px")}
          ${object.type === "rect" ? makeField("圆角", round(object.style.radius, 1), 'type="number" step="1" data-style="radius"', "px") : ""}
          ${makeField("描边宽度", round(object.style.strokeWidth, 1), 'type="number" step="0.5" data-style="strokeWidth"', "px")}
          ${makeField("填充", object.style.fill || "transparent", 'class="wide" type="text" data-style="fill" spellcheck="false"')}
          ${makeField("描边", object.style.stroke || "transparent", 'class="wide" type="text" data-style="stroke" spellcheck="false"')}
        </div>
      </div>`;
    if (object.type === "text") {
      shapeHtml += `
        <div class="inspector-section">
          <div class="section-title"><span>TYPE</span></div>
          <div class="field-grid">
            <div class="field wide">
              <label>文字内容</label>
              <textarea data-style="text">${escapeHtml(object.style.text || "")}</textarea>
            </div>
            ${makeField("字号", round(object.style.fontSize, 1), 'type="number" step="1" data-style="fontSize"', "px")}
            ${makeField("字重", object.style.fontWeight || 700, 'type="number" step="100" data-style="fontWeight"')}
            ${makeField("对齐", object.style.align || "center", 'type="text" data-style="align" spellcheck="false"')}
            ${makeField("字间距", round(object.style.letterSpacing ?? 1.5, 1), 'type="number" step="0.1" data-style="letterSpacing"', "px")}
          </div>
        </div>`;
    }
  }

  dom.inspector.innerHTML = `
    <div class="selected-object-head">
      <div class="object-badge">${icon(object.type)}</div>
      <div>
        <strong>${escapeHtml(object.name)}</strong>
        <small>${object.type}${object.parentId ? " · child layer" : " · root layer"}</small>
      </div>
      <span class="object-id">${object.id.slice(-5)}</span>
    </div>
    <div class="inspector-section">
      <div class="section-title"><span>OBJECT</span><span>${objectKeys} KF</span></div>
      <div class="field-grid">
        <div class="field wide">
          <label>名称</label>
          <input type="text" data-object-field="name" value="${escapeHtml(object.name)}" />
        </div>
        <div class="field wide">
          <label>父级对象</label>
          <select data-object-field="parent">${parentOptions}</select>
        </div>
        ${makeField("开始", round(object.start, 2), 'type="number" min="0" step="0.1" data-object-field="start"', "s")}
        ${makeField("结束", round(object.end, 2), 'type="number" min="0" step="0.1" data-object-field="end"', "s")}
        <div class="check-row"><span>可见</span><input type="checkbox" data-object-field="visible" ${object.visible ? "checked" : ""} /></div>
        <div class="check-row"><span>锁定</span><input type="checkbox" data-object-field="locked" ${object.locked ? "checked" : ""} /></div>
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-title"><span>TRANSFORM</span><span>${formatTime(state.time)}</span></div>
      <div class="field-grid">
        ${transformField("X", "x", values.x, "px")}
        ${transformField("Y", "y", values.y, "px")}
        ${transformField("旋转", "rotation", values.rotation, "°")}
        ${transformField("不透明度", "opacity", values.opacity * 100, "%")}
        ${transformField("缩放 X", "scaleX", values.scaleX, "×")}
        ${transformField("缩放 Y", "scaleY", values.scaleY, "×")}
      </div>
      <div class="keyframe-actions">
        <button class="mini-button" data-inspector-action="add-transform-keys">打 6 项关键帧</button>
        <button class="mini-button" data-inspector-action="focus-keyframe">定位当前关键帧</button>
      </div>
      ${selectedKeyHtml}
    </div>
    ${shapeHtml}
    <div class="inspector-section">
      <div class="section-title"><span>HIERARCHY</span></div>
      <div class="check-row"><span>子对象</span><strong style="font-size:9px;color:var(--muted)">${descendants}</strong></div>
      <div class="check-row"><span>关键帧</span><strong style="font-size:9px;color:var(--muted)">${objectKeys}</strong></div>
    </div>`;
}

function laneWidth() {
  return Math.max(320, state.project.duration * state.pxPerSec);
}

function laneGridHtml(showRange = true) {
  const width = laneWidth();
  const interval = state.project.audio.beatInterval;
  const offset = state.project.audio.offset;
  const beatLines = [];
  for (let index = 0; index <= Math.ceil((state.project.duration - offset) / interval) + 1; index += 1) {
    const time = offset + index * interval;
    if (time >= 0 && time <= state.project.duration) {
      beatLines.push(`<i class="beat-line" style="left:${(time / state.project.duration) * 100}%"></i>`);
    }
  }
  const secondLines = [];
  for (let second = 0; second <= Math.ceil(state.project.duration); second += 1) {
    if (second <= state.project.duration) {
      secondLines.push(`<i class="second-line" style="left:${(second / state.project.duration) * 100}%"></i>`);
    }
  }
  let range = "";
  if (showRange && state.rangeEnd > state.rangeStart) {
    range = `<div class="lane-range" style="left:${(state.rangeStart / state.project.duration) * 100}%;width:${((state.rangeEnd - state.rangeStart) / state.project.duration) * 100}%"></div>`;
  }
  return `<div class="lane-grid">${beatLines.join("")}${secondLines.join("")}</div>${range}`;
}

function keyHtml(object, property, key, values) {
  const selected = state.selectedKey?.objectId === object.id
    && state.selectedKey?.property === property
    && state.selectedKey?.keyId === key.id;
  const easeClass = key.ease === "hold" ? "hold" : key.ease === "linear" ? "ease" : "";
  return `<button class="keyframe ${easeClass} ${selected ? "selected" : ""}"
    data-object-id="${object.id}" data-property="${property}" data-key-id="${key.id}"
    style="left:clamp(5px, ${(key.time / state.project.duration) * 100}%, calc(100% - 5px))"
    title="${TRACK_MAP[property].label} · ${key.time.toFixed(2)}s · ${key.ease}"></button>`;
}

function propertyValue(object, property) {
  const value = getValues(object, state.time)[property];
  if (property === "opacity") return `${round(value * 100, 0)}%`;
  if (property === "rotation") return `${round(value, 1)}°`;
  if (property.startsWith("scale")) return `${round(value, 2)}×`;
  return `${round(value, 1)}`;
}

function objectDepth(object) {
  let depth = 0;
  let current = object;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    depth += 1;
    current = state.project.objects.find((item) => item.id === current.parentId);
  }
  return depth;
}

function renderTimeline() {
  const width = laneWidth();
  dom.timelineContent.style.width = `${228 + width}px`;
  dom.rulerLane.style.width = `${width}px`;
  dom.audioLane.style.width = `${width}px`;
  $("zoom-label").textContent = `${state.pxPerSec} px/s`;
  $("range-in").value = round(state.rangeStart, 2);
  $("range-out").value = round(state.rangeEnd, 2);
  $("audio-meta").textContent = `${state.project.audio.beatInterval}s / ${Math.round(60 / state.project.audio.beatInterval)} BPM`;
  $("audio-name").textContent = state.project.audio.name || "节拍网格";

  const rulerTicks = [];
  const beatLines = [];
  const interval = state.project.audio.beatInterval;
  const offset = state.project.audio.offset;
  for (let second = 0; second <= Math.ceil(state.project.duration); second += 1) {
    if (second > state.project.duration) continue;
    rulerTicks.push(`<i class="tick" style="left:${(second / state.project.duration) * 100}%"></i>`);
    rulerTicks.push(`<span class="tick-label" style="left:${(second / state.project.duration) * 100}%">${second === 0 ? "0s" : `${second}s`}</span>`);
  }
  for (let index = 0; index <= Math.ceil((state.project.duration - offset) / interval) + 1; index += 1) {
    const time = offset + index * interval;
    if (time >= 0 && time <= state.project.duration) {
      rulerTicks.push(`<i class="tick beat" style="left:${(time / state.project.duration) * 100}%"></i>`);
      beatLines.push(`<i style="left:${(time / state.project.duration) * 100}%"></i>`);
    }
  }
  dom.rulerTicks.innerHTML = rulerTicks.join("");
  dom.rulerBeats.innerHTML = beatLines.join("");
  updateRangeVisual();

  const rows = [];
  const renderObjectRows = (parentId) => {
    for (const object of getChildren(state.project, parentId).slice().reverse()) {
      const depth = objectDepth(object);
      const selected = object.id === state.selectedId;
      const children = getChildren(state.project, object.id);
      const collapsed = state.collapsed.has(object.id);
      const times = keyframeTimes(object);
      const markers = times.map(([time, properties]) =>
        `<span class="summary-key ${properties.length > 1 ? "multi" : ""}" style="left:clamp(4px, ${(time / state.project.duration) * 100}%, calc(100% - 4px))"></span>`
      ).join("");
      rows.push(`
        <div class="track-row object-row ${selected ? "selected" : ""}" data-object-row="${object.id}">
          <div class="track-label object-track-label" data-select-object="${object.id}" style="--depth:${depth}">
            ${children.length
              ? `<button class="chevron" data-timeline-collapse="${object.id}">${collapsed ? "▶" : "▼"}</button>`
              : '<span class="chevron"></span>'}
            <span class="layer-icon">${icon(object.type)}</span>
            <span class="name">${escapeHtml(object.name)}</span>
            <span class="duration">${round(object.start, 1)}–${round(object.end, 1)}s</span>
          </div>
          <div class="track-lane summary-lane" data-object-id="${object.id}" style="width:${width}px">
            ${laneGridHtml()}${markers}
          </div>
        </div>`);
      if (selected) {
        for (const track of TRACKS) {
          const keys = getTrack(object, track.key);
          rows.push(`
            <div class="track-row property-row" data-property-row="${track.key}">
              <div class="track-label property-label" style="--depth:${depth}">
                <span class="property-color" style="background:${track.color}"></span>
                <span class="property-name">${track.label}</span>
                <span class="property-value">${propertyValue(object, track.key)}</span>
              </div>
              <div class="track-lane property-lane" data-object-id="${object.id}" data-property="${track.key}" style="width:${width}px">
                ${laneGridHtml()}${keys.map((key) => keyHtml(object, track.key, key)).join("")}
              </div>
            </div>`);
        }
      }
      if (!collapsed) renderObjectRows(object.id);
    }
  };
  renderObjectRows(null);
  dom.timelineRows.innerHTML = rows.join("");
  drawWaveform();
  updateTimelineStatus();
  updateTimeUI();
  requestAnimationFrame(scrollSelectedRowIntoView);
}

function scrollSelectedRowIntoView() {
  if (!state.selectedId) return;
  const row = dom.timelineRows.querySelector(`.object-row[data-object-row="${state.selectedId}"]`);
  if (!row) return;
  const top = row.offsetTop;
  const visibleTop = dom.timelineScroll.scrollTop + 36;
  const visibleBottom = dom.timelineScroll.scrollTop + dom.timelineScroll.clientHeight - 90;
  if (top < visibleTop || top > visibleBottom) {
    dom.timelineScroll.scrollTo({ top: Math.max(0, top - 70), behavior: "smooth" });
  }
}

function updateRangeVisual() {
  if (state.rangeEnd <= state.rangeStart) {
    dom.rangeSelection.classList.remove("visible");
    return;
  }
  dom.rangeSelection.classList.add("visible");
  dom.rangeSelection.style.left = `${(state.rangeStart / state.project.duration) * 100}%`;
  dom.rangeSelection.style.width = `${((state.rangeEnd - state.rangeStart) / state.project.duration) * 100}%`;
}

function updateTimelineStatus() {
  const object = selectedObject();
  $("timeline-selection").textContent = object
    ? `已选择：${object.name} · ${object.parentId ? "子级" : "根级"}`
    : "未选择对象";
  const keyCount = countKeyframes(state.project);
  const rangeText = state.rangeEnd > state.rangeStart ? ` · 帧段 ${round(state.rangeStart, 2)}–${round(state.rangeEnd, 2)}s` : "";
  $("keyframe-status").textContent = `${keyCount} 个关键帧${rangeText}`;
  $("copy-range-btn").disabled = !(state.rangeEnd > state.rangeStart);
  $("paste-range-btn").disabled = !state.clipboard?.length;
}

function updateAudioMeta() {
  $("audio-meta").textContent = `${state.project.audio.beatInterval}s / ${Math.round(60 / state.project.audio.beatInterval)} BPM`;
  $("audio-name").textContent = state.project.audio.name || "节拍网格";
  const interval = state.project.audio.beatInterval;
  const offset = state.project.audio.offset;
  const beats = [];
  for (let index = 0; index <= Math.ceil((state.project.duration - offset) / interval) + 1; index += 1) {
    const time = offset + index * interval;
    if (time >= 0 && time <= state.project.duration) {
      beats.push(`<i style="position:absolute;top:0;bottom:0;width:1px;background:rgba(110,231,199,.24);left:${(time / state.project.duration) * 100}%"></i>`);
    }
  }
  dom.audioBeats.innerHTML = beats.join("");
  drawWaveform();
}

function drawWaveform() {
  const canvas = dom.waveform;
  const width = Math.max(2, Math.round(laneWidth()));
  const height = 84;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(110, 231, 199, 0.10)";
  ctx.fillRect(0, height / 2, width, 1);
  if (!state.waveform?.length) {
    ctx.strokeStyle = "rgba(110, 231, 199, 0.20)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 7) {
      const h = 1 + (Math.sin(x * 0.17) + 1) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, height / 2 - h);
      ctx.lineTo(x + 0.5, height / 2 + h);
      ctx.stroke();
    }
    return;
  }
  const peaks = state.waveform;
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const peak = peaks[Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length))] || 0;
    const barHeight = Math.max(1, peak * (height / 2 - 4));
    ctx.moveTo(x, height / 2 - barHeight);
    ctx.lineTo(x, height / 2 + barHeight);
  }
  ctx.strokeStyle = "rgba(110, 231, 199, 0.48)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function selectObject(id, options = {}) {
  state.selectedId = id;
  state.selectedKey = options.keepKey ? state.selectedKey : null;
  if (options.timeline === false) {
    renderHierarchy();
    renderInspector();
    renderCanvas();
    [...dom.timelineRows.querySelectorAll(".track-row.object-row")].forEach((row) => {
      row.classList.toggle("selected", row.dataset.objectRow === id);
    });
    updateTimelineStatus();
  } else {
    renderHierarchy();
    renderInspector();
    renderTimeline();
    renderCanvas();
  }
}

function addObject(type) {
  pause(false);
  const current = selectedObject();
  const parentId = current?.type === "group" ? current.id : current?.parentId || null;
  if (current?.locked) {
    toast("当前对象已锁定", true);
    return;
  }
  let x = state.project.width / 2;
  let y = state.project.height / 2;
  if (parentId) {
    const parent = state.project.objects.find((object) => object.id === parentId);
    const matrices = getWorldMatrices(state.project, state.time);
    const inverse = matrices.get(parentId)?.matrix.inverse();
    if (parent && inverse) {
      const local = inverse.transformPoint(new DOMPoint(x, y));
      x = local.x;
      y = local.y;
    }
  }
  const baseName = { group: "新建组", rect: "矩形", ellipse: "椭圆", text: "文字" }[type];
  const object = makeObject(type, {
    name: makeUniqueName(baseName),
    parentId,
    x,
    y,
    duration: state.project.duration
  });
  if (type === "text") object.style.text = "NEW LAYER";
  state.project.objects.push(object);
  state.selectedId = object.id;
  state.selectedKey = null;
  state.collapsed.delete(parentId);
  checkpoint();
  refreshAll();
  toast(`已添加${object.name}`);
}

function duplicateSelected() {
  const object = selectedObject();
  if (!object) return;
  pause(false);
  const ids = new Set([object.id, ...getDescendantIds(state.project, object.id)]);
  const idMap = new Map();
  for (const id of ids) idMap.set(id, uid("obj"));
  const copies = state.project.objects.filter((item) => ids.has(item.id)).map((item) => {
    const copy = clone(item);
    copy.id = idMap.get(item.id);
    copy.name = item.id === object.id ? `${item.name} copy` : item.name;
    copy.parentId = item.parentId && ids.has(item.parentId) ? idMap.get(item.parentId) : item.parentId;
    for (const track of TRACKS) {
      for (const key of getTrack(copy, track.key)) key.id = uid("key");
    }
    return copy;
  });
  const maxIndex = Math.max(...state.project.objects.map((item, index) => (ids.has(item.id) ? index : -1)));
  state.project.objects.splice(maxIndex + 1, 0, ...copies);
  state.selectedId = idMap.get(object.id);
  state.selectedKey = null;
  checkpoint();
  refreshAll();
  toast(`已复制 ${copies.length} 个对象`);
}

function deleteSelected() {
  const object = selectedObject();
  if (!object) return;
  pause(false);
  const removed = deleteObject(state.project, object.id);
  const fallback = object.parentId
    ? state.project.objects.find((item) => item.id === object.parentId)
    : state.project.objects.find((item) => !item.parentId);
  state.selectedId = fallback?.id || state.project.objects[0]?.id || null;
  state.selectedKey = null;
  checkpoint();
  refreshAll();
  toast(`已删除 ${removed.length} 个对象及其关键帧`);
}

function keyTimeFromClientX(clientX, lane) {
  const rect = lane.getBoundingClientRect();
  return clamp(((clientX - rect.left) / Math.max(1, rect.width)) * state.project.duration, 0, state.project.duration);
}

function snappedTime(time) {
  const fps = state.project.fps;
  return clamp(Math.round(time * fps) / fps, 0, state.project.duration);
}

function updateKeyMarker(time) {
  if (!state.selectedKey || !state.keyDrag) return;
  const marker = dom.timelineRows.querySelector(
    `.keyframe[data-key-id="${state.selectedKey.keyId}"]`
  );
  if (marker) marker.style.left = `${(time / state.project.duration) * 100}%`;
}

function updateRangeInputs() {
  $("range-in").value = round(state.rangeStart, 2);
  $("range-out").value = round(state.rangeEnd, 2);
  updateRangeVisual();
  for (const lane of dom.timelineRows.querySelectorAll(".track-lane")) {
    let shade = lane.querySelector(".lane-range");
    if (state.rangeEnd > state.rangeStart) {
      if (!shade) {
        shade = document.createElement("div");
        shade.className = "lane-range";
        lane.prepend(shade);
      }
      shade.style.left = `${(state.rangeStart / state.project.duration) * 100}%`;
      shade.style.width = `${((state.rangeEnd - state.rangeStart) / state.project.duration) * 100}%`;
    } else {
      shade?.remove();
    }
  }
  updateTimelineStatus();
}

function handleInspectorChange(event) {
  const target = event.target;
  const object = selectedObject();
  if (!object) return;
  if (target.dataset.transform) {
    const property = target.dataset.transform;
    let value = Number(target.value);
    if (!Number.isFinite(value)) return;
    if (property === "opacity") value = clamp(value / 100, 0, 1);
    const key = setKeyframe(state.project, object.id, property, state.time, value);
    if (key) state.selectedKey = { objectId: object.id, property, keyId: key.id };
    checkpoint();
    refreshAll();
    return;
  }
  if (target.dataset.objectField) {
    const field = target.dataset.objectField;
    if (field === "name") {
      object.name = target.value.trim() || object.name;
    } else if (field === "parent") {
      if (!setParent(state.project, object.id, target.value || null)) {
        toast("无法设置该父级：会形成循环或父级不是组", true);
        return;
      }
      state.collapsed.delete(target.value);
    } else if (field === "start") {
      object.start = clamp(Number(target.value) || 0, 0, object.end);
    } else if (field === "end") {
      object.end = clamp(Number(target.value) || 0, object.start, state.project.duration);
    } else if (field === "visible") {
      object.visible = target.checked;
    } else if (field === "locked") {
      object.locked = target.checked;
    }
    checkpoint();
    refreshAll();
    return;
  }
  if (target.dataset.style) {
    const field = target.dataset.style;
    const numeric = ["width", "height", "radius", "strokeWidth", "fontSize", "fontWeight", "letterSpacing"];
    if (numeric.includes(field)) {
      object.style[field] = clamp(Number(target.value) || 0, 0, 100000);
    } else {
      object.style[field] = target.value;
    }
    checkpoint();
    renderCanvas();
    renderTimeline();
    return;
  }
  if (target.dataset.keyField && state.selectedKey) {
    const found = findKeyframe(state.project, state.selectedKey.objectId, state.selectedKey.property, state.selectedKey.keyId);
    if (!found) return;
    if (target.dataset.keyField === "time") {
      moveKeyframe(state.project, found.object.id, found.property, found.key.id, Number(target.value));
    } else if (target.dataset.keyField === "value") {
      found.key.value = Number(target.value) || 0;
    } else if (target.dataset.keyField === "ease") {
      found.key.ease = target.value;
    }
    checkpoint();
    refreshAll();
  }
}

function handleInspectorClick(event) {
  const action = event.target.closest("[data-inspector-action]")?.dataset.inspectorAction;
  if (!action) return;
  const object = selectedObject();
  if (!object) return;
  if (action === "add-transform-keys") {
    const values = getValues(object, state.time);
    let firstKey = null;
    for (const track of TRACKS) {
      const key = setKeyframe(state.project, object.id, track.key, state.time, values[track.key]);
      firstKey ||= key;
    }
    if (firstKey) state.selectedKey = { objectId: object.id, property: "x", keyId: firstKey.id };
    checkpoint();
    refreshAll();
    toast("已在当前时间创建变换关键帧");
  } else if (action === "focus-keyframe") {
    for (const track of TRACKS) {
      const key = getTrack(object, track.key).find((item) => Math.abs(item.time - state.time) <= 0.0015);
      if (key) {
        state.selectedKey = { objectId: object.id, property: track.key, keyId: key.id };
        renderInspector();
        renderTimeline();
        return;
      }
    }
    toast("当前时间没有关键帧");
  } else if (action === "delete-key" && state.selectedKey) {
    if (removeKeyframe(state.project, state.selectedKey.objectId, state.selectedKey.property, state.selectedKey.keyId)) {
      state.selectedKey = null;
      checkpoint();
      refreshAll();
      toast("关键帧已删除");
    } else {
      toast("每个属性至少保留一个关键帧", true);
    }
  }
}

function handleHierarchyClick(event) {
  const item = event.target.closest(".tree-item");
  if (!item) return;
  const object = state.project.objects.find((entry) => entry.id === item.dataset.id);
  if (!object) return;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "collapse") {
    if (state.collapsed.has(object.id)) state.collapsed.delete(object.id);
    else state.collapsed.add(object.id);
    renderHierarchy();
    renderTimeline();
    return;
  }
  if (action === "visible") {
    object.visible = !object.visible;
    checkpoint();
    refreshAll();
    return;
  }
  if (action === "lock") {
    object.locked = !object.locked;
    checkpoint();
    refreshAll();
    return;
  }
  selectObject(object.id);
}

function onStagePointerDown(event) {
  if (event.button !== 0 || state.exporting) return;
  const point = stagePoint(event);
  const hit = hitTest(state.project, state.time, point.x, point.y, state.selectedId);
  if (!hit) {
    state.selectedId = null;
    state.selectedKey = null;
    renderHierarchy();
    renderInspector();
    renderTimeline();
    renderCanvas();
    return;
  }
  selectObject(hit.id);
  if (hit.locked) {
    toast("对象已锁定，无法拖动", true);
    return;
  }
  pause(false);
  const values = getValues(hit, state.time);
  state.canvasDrag = {
    objectId: hit.id,
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    valueX: values.x,
    valueY: values.y,
    moved: false
  };
  dom.stage.setPointerCapture(event.pointerId);
  dom.stage.style.cursor = "grabbing";
  event.preventDefault();
}

function onStagePointerMove(event) {
  if (!state.canvasDrag || state.canvasDrag.pointerId !== event.pointerId) return;
  const point = stagePoint(event);
  const dx = point.x - state.canvasDrag.startX;
  const dy = point.y - state.canvasDrag.startY;
  if (Math.abs(dx) + Math.abs(dy) < 0.4) return;
  state.canvasDrag.moved = true;
  const local = parentLocalDelta(state.project, state.canvasDrag.objectId, state.time, dx, dy);
  setKeyframe(state.project, state.canvasDrag.objectId, "x", state.time, state.canvasDrag.valueX + local.x);
  setKeyframe(state.project, state.canvasDrag.objectId, "y", state.time, state.canvasDrag.valueY + local.y);
  renderCanvas();
  const object = selectedObject();
  if (object) {
    const xInput = dom.inspector.querySelector('[data-transform="x"]');
    const yInput = dom.inspector.querySelector('[data-transform="y"]');
    if (xInput && document.activeElement !== xInput) xInput.value = round(getValues(object, state.time).x, 2);
    if (yInput && document.activeElement !== yInput) yInput.value = round(getValues(object, state.time).y, 2);
  }
}

function onStagePointerUp(event) {
  if (!state.canvasDrag || state.canvasDrag.pointerId !== event.pointerId) return;
  const moved = state.canvasDrag.moved;
  state.canvasDrag = null;
  dom.stage.style.cursor = "grab";
  try {
    dom.stage.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture can already be released by the browser.
  }
  if (moved) {
    checkpoint();
    renderTimeline();
    renderInspector();
  }
}

function onTimelinePointerDown(event) {
  const keyTarget = event.target.closest(".keyframe");
  if (keyTarget) {
    event.preventDefault();
    pause(false);
    const objectId = keyTarget.dataset.objectId;
    const property = keyTarget.dataset.property;
    const keyId = keyTarget.dataset.keyId;
    const found = findKeyframe(state.project, objectId, property, keyId);
    if (!found) return;
    state.selectedId = objectId;
    state.selectedKey = { objectId, property, keyId };
    renderHierarchy();
    renderInspector();
    renderCanvas();
    dom.timelineRows.querySelectorAll(".keyframe.selected").forEach((item) => item.classList.remove("selected"));
    keyTarget.classList.add("selected");
    const lane = keyTarget.closest(".track-lane");
    state.keyDrag = {
      objectId,
      property,
      keyId,
      lane,
      startClientX: event.clientX,
      originalTime: found.key.time,
      lastTime: found.key.time,
      moved: false
    };
    document.body.style.cursor = "ew-resize";
    return;
  }
  const collapse = event.target.closest("[data-timeline-collapse]")?.dataset.timelineCollapse;
  if (collapse) {
    if (state.collapsed.has(collapse)) state.collapsed.delete(collapse);
    else state.collapsed.add(collapse);
    renderHierarchy();
    renderTimeline();
    return;
  }
  const select = event.target.closest("[data-select-object]")?.dataset.selectObject;
  if (select) {
    selectObject(select);
    return;
  }
  const lane = event.target.closest(".track-lane");
  if (lane) {
    const time = snappedTime(keyTimeFromClientX(event.clientX, lane));
    pause(false);
    setPlayhead(time);
    event.preventDefault();
  }
}

function startRulerDrag(event) {
  if (event.button !== 0) return;
  pause(false);
  const time = snappedTime(keyTimeFromClientX(event.clientX, dom.rulerLane));
  const rangeMode = event.shiftKey;
  state.rulerDrag = {
    mode: rangeMode ? "range" : "seek",
    anchor: time,
    pointerId: event.pointerId
  };
  if (rangeMode) {
    state.rangeStart = time;
    state.rangeEnd = time;
    updateRangeInputs();
  } else {
    setPlayhead(time, { inspector: false });
  }
  event.preventDefault();
}

function onGlobalPointerMove(event) {
  if (state.keyDrag) {
    const time = snappedTime(state.keyDrag.originalTime + (
      (event.clientX - state.keyDrag.startClientX) / Math.max(1, state.keyDrag.lane.getBoundingClientRect().width)
    ) * state.project.duration);
    if (time !== state.keyDrag.lastTime) {
      moveKeyframe(state.project, state.keyDrag.objectId, state.keyDrag.property, state.keyDrag.keyId, time);
      state.keyDrag.lastTime = time;
      state.keyDrag.moved = true;
      updateKeyMarker(time);
      renderCanvas();
      const valueLabel = state.keyDrag.lane.closest(".track-row")?.querySelector(".property-value");
      if (valueLabel) valueLabel.textContent = propertyValue(selectedObject(), state.keyDrag.property);
    }
  }
  if (state.rulerDrag) {
    const time = snappedTime(keyTimeFromClientX(event.clientX, dom.rulerLane));
    if (state.rulerDrag.mode === "range") {
      state.rangeStart = Math.min(state.rulerDrag.anchor, time);
      state.rangeEnd = Math.max(state.rulerDrag.anchor, time);
      updateRangeInputs();
    } else {
      setPlayhead(time, { inspector: false });
    }
  }
}

function onGlobalPointerUp() {
  if (state.keyDrag) {
    const moved = state.keyDrag.moved;
    const time = state.keyDrag.lastTime;
    state.keyDrag = null;
    document.body.style.cursor = "";
    if (moved) {
      checkpoint();
      renderTimeline();
      renderInspector();
      renderCanvas();
      toast(`关键帧已移动到 ${time.toFixed(2)}s`);
    }
  }
  if (state.rulerDrag) {
    const wasRange = state.rulerDrag.mode === "range";
    state.rulerDrag = null;
    if (wasRange) {
      updateRangeInputs();
      renderTimeline();
    } else {
      renderTimeline();
      renderInspector();
    }
  }
}

function copyRange() {
  if (state.rangeEnd <= state.rangeStart) {
    toast("请先在标尺上选择帧段", true);
    return;
  }
  state.clipboard = collectKeyframesInRange(state.project, state.rangeStart, state.rangeEnd);
  updateTimelineStatus();
  toast(`已复制 ${state.clipboard.length} 个关键帧 · ${round(state.rangeStart, 2)}–${round(state.rangeEnd, 2)}s`);
}

function pasteRange() {
  if (!state.clipboard?.length) {
    toast("剪贴板中没有帧段", true);
    return;
  }
  pause(false);
  const pasted = pasteKeyframes(state.project, state.clipboard, state.time);
  state.selectedKey = null;
  checkpoint();
  refreshAll();
  toast(`已从播放头 ${formatTime(state.time)} 粘贴 ${pasted} 个关键帧`);
}

function updateRangeFromInputs() {
  const start = clamp(Number($("range-in").value) || 0, 0, state.project.duration);
  const end = clamp(Number($("range-out").value) || 0, 0, state.project.duration);
  state.rangeStart = Math.min(start, end);
  state.rangeEnd = Math.max(start, end);
  updateRangeInputs();
  renderTimeline();
}

function syncAudio(options = {}) {
  if (!state.audio?.src || state.project.audio.dataUrl === "") return;
  state.audio.volume = state.project.audio.volume;
  if (options.play) {
    state.audio.currentTime = state.time;
    state.audio.play().catch(() => {});
  } else if (options.pause) {
    state.audio.pause();
  }
}

function playbackFrame(now) {
  if (!state.playing) return;
  const elapsed = (now - state.playStartedAt) / 1000;
  let time = state.playStartTime + elapsed;
  if (time >= state.project.duration) {
    state.time = state.project.duration;
    pause(false);
    renderCanvas();
    updateTimeUI();
    renderInspector();
    return;
  }
  state.time = time;
  if (state.audio && !state.audio.paused && Math.abs(state.audio.currentTime - time) > 0.09) {
    state.audio.currentTime = time;
  }
  const beat = beatInfo(state.time, state.project.audio.beatInterval, state.project.audio.offset);
  if (beat.index !== state.lastBeatIndex) {
    state.lastBeatIndex = beat.index;
    updateTimeUI();
  }
  renderCanvas();
  dom.timeCurrent.textContent = formatTime(state.time);
  dom.playhead.style.left = `${228 + (state.time / state.project.duration) * laneWidth()}px`;
  dom.timeCurrent.style.transform = beat.pulse > 0.8 ? "scale(1.04)" : "";
  updateInspectorLive();
  requestAnimationFrame(playbackFrame);
}

function updateInspectorLive() {
  const object = selectedObject();
  if (!object || !dom.inspector.querySelector("[data-transform]")) return;
  const values = getValues(object, state.time);
  const inputMap = { x: values.x, y: values.y, rotation: values.rotation, opacity: values.opacity * 100, scaleX: values.scaleX, scaleY: values.scaleY };
  for (const [property, value] of Object.entries(inputMap)) {
    const input = dom.inspector.querySelector(`[data-transform="${property}"]`);
    if (input && document.activeElement !== input) input.value = round(value, 2);
  }
  const label = dom.inspector.querySelector(".section-title span:last-child");
  if (label && label.textContent.includes(":")) label.textContent = formatTime(state.time);
  const propertyRows = dom.timelineRows.querySelectorAll(".track-row.property-row");
  propertyRows.forEach((row) => {
    const property = row.dataset.propertyRow;
    const value = row.querySelector(".property-value");
    if (value) value.textContent = propertyValue(object, property);
  });
}

function play() {
  if (state.exporting) return;
  if (state.playing) {
    pause();
    return;
  }
  if (state.time >= state.project.duration - 0.001) state.time = 0;
  state.playing = true;
  state.playStartedAt = performance.now();
  state.playStartTime = state.time;
  state.lastBeatIndex = beatInfo(state.time, state.project.audio.beatInterval, state.project.audio.offset).index;
  syncAudio({ play: true });
  updateTimeUI();
  requestAnimationFrame(playbackFrame);
}

function pause(render = true) {
  const wasPlaying = state.playing;
  state.playing = false;
  syncAudio({ pause: true });
  if (wasPlaying && render) {
    updateTimeUI();
    renderCanvas();
    renderInspector();
  }
}

function stepFrames(direction) {
  pause(false);
  const step = 1 / state.project.fps;
  setPlayhead(snappedTime(state.time + direction * step));
  renderTimeline();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(extension) {
  const base = state.project.name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "orbit-project"}.${extension}`;
}

function exportProjectJson() {
  const payload = {
    ...clone(state.project),
    version: 1,
    exportedAt: new Date().toISOString()
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), safeFilename("json"));
  toast(`工程 JSON 已导出 · ${payload.objects.length} 个对象 / ${countKeyframes(payload)} 个关键帧`);
}

async function importProjectFile(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    loadProjectData(parsed);
    toast(`工程已载入 · ${state.project.objects.length} 个对象 / ${countKeyframes(state.project)} 个关键帧`);
  } catch (error) {
    toast(`载入失败：${error.message}`, true);
  } finally {
    dom.fileInput.value = "";
  }
}

function loadProjectData(raw) {
  pause(false);
  const normalized = normalizeProject(raw);
  state.project = normalized;
  state.selectedId = normalized.objects.find((object) => object.name === "Planet Rig")?.id
    || normalized.objects.find((object) => !object.parentId)?.id
    || normalized.objects[0]?.id
    || null;
  state.selectedKey = null;
  state.time = 0;
  state.rangeStart = 0;
  state.rangeEnd = Math.min(2, normalized.duration);
  state.clipboard = null;
  state.waveform = null;
  state.collapsed.clear();
  resetHistory();
  refreshAll({ loadAudio: true });
  autosave();
}

function loadDemoProject() {
  loadProjectData(createDemoProject());
  toast("十秒示例已载入 · 45 个对象 / 544 个关键帧");
}

async function loadProjectAudio() {
  if (!state.audio) {
    state.audio = new Audio();
    state.audio.preload = "auto";
  }
  const source = state.project.audio.dataUrl;
  state.audio.volume = state.project.audio.volume;
  if (!source) {
    state.audio.pause();
    state.audio.removeAttribute("src");
    state.waveform = null;
    drawWaveform();
    return;
  }
  if (state.audio.src !== source) {
    state.audio.src = source;
    state.audio.load();
  }
  const token = uid("wave");
  state.waveToken = token;
  try {
    const buffer = await (await fetch(source)).arrayBuffer();
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(buffer);
    const peaks = new Float32Array(1200);
    const channel = decoded.getChannelData(0);
    const bucket = Math.max(1, Math.floor(channel.length / peaks.length));
    for (let index = 0; index < peaks.length; index += 1) {
      let peak = 0;
      const start = index * bucket;
      const end = Math.min(channel.length, start + bucket);
      for (let sample = start; sample < end; sample += 2) peak = Math.max(peak, Math.abs(channel[sample]));
      peaks[index] = Math.min(1, peak);
    }
    await context.close();
    if (state.waveToken === token && state.project.audio.dataUrl === source) {
      state.waveform = peaks;
      drawWaveform();
    }
  } catch {
    state.waveform = null;
    drawWaveform();
  }
}

function handleAudioFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.project.audio.name = file.name;
    state.project.audio.dataUrl = String(reader.result);
    checkpoint();
    updateAudioMeta();
    loadProjectAudio();
    autosave();
    toast(`音频已载入：${file.name} · 播放头与节拍共用时间`);
  };
  reader.onerror = () => toast("音频读取失败", true);
  reader.readAsDataURL(file);
}

async function exportWebM() {
  if (state.exporting) return;
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    toast("当前浏览器不支持 WebM 录制，请使用 Chrome 或 Edge", true);
    return;
  }
  pause(false);
  state.exporting = true;
  dom.exportOverlay.hidden = false;
  dom.exportProgress.style.width = "0%";
  dom.exportPercent.textContent = "0%";
  dom.exportTime.textContent = `00:00 / ${formatTime(state.project.duration, false)}`;
  dom.exportCaption.textContent = `逐帧渲染 ${state.project.duration.toFixed(1)} 秒动画，请保持页面打开。`;

  const canvas = document.createElement("canvas");
  canvas.width = state.project.width;
  canvas.height = state.project.height;
  const canvasStream = canvas.captureStream(state.project.fps);
  let stream = canvasStream;
  let exportAudio = null;
  let audioContext = null;
  if (state.project.audio.dataUrl) {
    try {
      exportAudio = new Audio(state.project.audio.dataUrl);
      exportAudio.volume = state.project.audio.volume;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 900);
        exportAudio.addEventListener("canplay", () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        exportAudio.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("音频无法载入"));
        }, { once: true });
        exportAudio.load();
      });
      audioContext = new AudioContext();
      await audioContext.resume();
      const source = audioContext.createMediaElementSource(exportAudio);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);
    } catch {
      exportAudio = null;
      stream = canvasStream;
    }
  }
  const mimeTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 8_000_000
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const finished = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => reject(event.error || new Error("录制失败"));
  });

  recorder.start(200);
  if (exportAudio) {
    exportAudio.currentTime = 0;
    exportAudio.play().catch(() => {});
  }
  const startedAt = performance.now();
  const renderLoop = (now) => {
    const time = Math.min(state.project.duration, (now - startedAt) / 1000);
    renderScene(canvas, state.project, time);
    const percent = Math.round((time / state.project.duration) * 100);
    dom.exportProgress.style.width = `${Math.min(100, percent)}%`;
    dom.exportPercent.textContent = `${Math.min(100, percent)}%`;
    dom.exportTime.textContent = `${formatTime(time, false)} / ${formatTime(state.project.duration, false)}`;
    if (time < state.project.duration) {
      requestAnimationFrame(renderLoop);
    } else {
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 160);
    }
  };
  requestAnimationFrame(renderLoop);

  try {
    await finished;
    exportAudio?.pause();
    if (audioContext) await audioContext.close();
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    if (!blob.size) throw new Error("浏览器没有生成视频数据");
    downloadBlob(blob, safeFilename("webm"));
    dom.exportProgress.style.width = "100%";
    dom.exportPercent.textContent = "100%";
    toast(`WebM 已导出 · ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
  } catch (error) {
    exportAudio?.pause();
    if (audioContext) await audioContext.close().catch(() => {});
    stream.getTracks().forEach((track) => track.stop());
    toast(`导出失败：${error.message}`, true);
  } finally {
    setTimeout(() => {
      dom.exportOverlay.hidden = true;
      state.exporting = false;
      renderCanvas();
    }, 350);
  }
}

function zoomTimeline(delta) {
  state.pxPerSec = clamp(state.pxPerSec + delta, 60, 320);
  renderTimeline();
}

function stepToTime(time) {
  pause(false);
  setPlayhead(snappedTime(clamp(time, 0, state.project.duration)));
  renderTimeline();
}

function fitStage() {
  const panel = dom.stage.parentElement;
  const rail = dom.stage.parentElement.parentElement;
  const ratio = state.project.width / state.project.height;
  const availableWidth = Math.max(240, rail.clientWidth - 56);
  const availableHeight = Math.max(135, rail.clientHeight - 40);
  const width = Math.min(availableWidth, availableHeight * ratio);
  panel.style.width = `${width}px`;
  panel.style.height = `${width / ratio}px`;
  panel.style.maxWidth = "none";
  panel.style.maxHeight = "none";
  renderCanvas();
  toast("舞台已适应窗口");
}

function bindEvents() {
  dom.projectName.addEventListener("change", () => {
    state.project.name = dom.projectName.value.trim() || "未命名工程";
    checkpoint();
    refreshAll();
  });
  dom.undoBtn.addEventListener("click", undo);
  dom.redoBtn.addEventListener("click", redo);
  dom.duplicateBtn.addEventListener("click", duplicateSelected);
  $("demo-btn").addEventListener("click", loadDemoProject);
  $("delete-btn").addEventListener("click", deleteSelected);
  $("add-menu-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $("add-menu");
    menu.hidden = !menu.hidden;
  });
  $("add-menu").addEventListener("click", (event) => {
    const type = event.target.closest("[data-add]")?.dataset.add;
    if (!type) return;
    addObject(type);
    $("add-menu").hidden = true;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#add-menu") && !event.target.closest("#add-menu-btn")) $("add-menu").hidden = true;
  });
  dom.hierarchy.addEventListener("click", handleHierarchyClick);
  dom.inspector.addEventListener("change", handleInspectorChange);
  dom.inspector.addEventListener("click", handleInspectorClick);
  dom.stage.addEventListener("pointerdown", onStagePointerDown);
  dom.stage.addEventListener("pointermove", onStagePointerMove);
  dom.stage.addEventListener("pointerup", onStagePointerUp);
  dom.stage.addEventListener("pointercancel", onStagePointerUp);
  dom.timelineRows.addEventListener("pointerdown", onTimelinePointerDown);
  dom.rulerLane.addEventListener("pointerdown", startRulerDrag);
  dom.audioLane.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pause(false);
    setPlayhead(snappedTime(keyTimeFromClientX(event.clientX, dom.audioLane)));
    renderTimeline();
  });
  window.addEventListener("pointermove", onGlobalPointerMove);
  window.addEventListener("pointerup", onGlobalPointerUp);
  window.addEventListener("pointercancel", onGlobalPointerUp);

  $("copy-range-btn").addEventListener("click", copyRange);
  $("paste-range-btn").addEventListener("click", pasteRange);
  $("range-in").addEventListener("change", updateRangeFromInputs);
  $("range-out").addEventListener("change", updateRangeFromInputs);
  $("mark-beat-range").addEventListener("click", () => {
    state.rangeStart = clamp(Math.floor(state.time / state.project.audio.beatInterval) * state.project.audio.beatInterval, 0, state.project.duration);
    state.rangeEnd = Math.min(state.project.duration, state.rangeStart + state.project.audio.beatInterval * 4);
    updateRangeInputs();
    renderTimeline();
  });
  $("zoom-out").addEventListener("click", () => zoomTimeline(-20));
  $("zoom-in").addEventListener("click", () => zoomTimeline(20));

  dom.playButton.addEventListener("click", play);
  $("jump-start").addEventListener("click", () => stepToTime(0));
  $("jump-end").addEventListener("click", () => stepToTime(state.project.duration));
  $("step-back").addEventListener("click", () => stepFrames(-1));
  $("step-forward").addEventListener("click", () => stepFrames(1));
  $("fit-btn").addEventListener("click", fitStage);

  $("json-btn").addEventListener("click", exportProjectJson);
  $("import-btn").addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    if (file) importProjectFile(file);
  });
  $("webm-btn").addEventListener("click", exportWebM);
  $("audio-upload-btn").addEventListener("click", () => dom.audioInput.click());
  dom.audioInput.addEventListener("change", () => {
    const file = dom.audioInput.files?.[0];
    handleAudioFile(file);
    dom.audioInput.value = "";
  });

  document.addEventListener("keydown", (event) => {
    const editing = event.target.matches("input, textarea, select");
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (editing) return;
    if (event.key === " ") {
      event.preventDefault();
      play();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepToTime(state.time - (event.shiftKey ? 10 : 1) / state.project.fps);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepToTime(state.time + (event.shiftKey ? 10 : 1) / state.project.fps);
    } else if (event.key === "Home") {
      event.preventDefault();
      stepToTime(0);
    } else if (event.key === "End") {
      event.preventDefault();
      stepToTime(state.project.duration);
    }
  });

  window.addEventListener("beforeunload", () => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.project));
    } catch {
      // Best-effort persistence only.
    }
  });
}

initialize();

window.orbitStudio = {
  getProject: () => clone(state.project),
  getAudioState: () => ({
    hasAudio: Boolean(state.audio?.src),
    sourceTime: state.audio?.currentTime || 0,
    playheadTime: state.time,
    paused: state.audio?.paused ?? true
  }),
  getSelection: () => ({
    objectId: state.selectedId,
    key: state.selectedKey ? clone(state.selectedKey) : null,
    time: state.time
  }),
  loadProject: (data) => loadProjectData(data),
  select: (id) => selectObject(id),
  seek: (time) => stepToTime(time),
  copyRange: (start, end) => {
    state.rangeStart = Math.max(0, Math.min(start, end));
    state.rangeEnd = Math.min(state.project.duration, Math.max(start, end));
    updateRangeInputs();
    copyRange();
  },
  pasteAt: (time) => {
    state.time = clamp(time, 0, state.project.duration);
    pasteRange();
  },
  undo,
  redo
};
