import {
  createStore, isAssetInUse, KIND, defaultParams,
} from './model.js';
import { pushCommand, undo, redo } from './history.js';
import { exportJson, importProject, projectCounts, canonicalString, sha256Hex } from './serialize.js';
import { renderScene } from './renderer.js';
import { saveNow, loadSaved, hasSavedProject, STORAGE_KEY } from './storage.js';

const state = {
  store: createStore(),
  selectedAssetId: null,
  selectedLayerId: null,
  message: '',
};

const $ = (id) => document.getElementById(id);

function defaultAssetParams(kind) {
  return defaultParams(kind);
}

function notify(message, isError = false) {
  const bar = $('status');
  state.message = message;
  bar.textContent = message;
  bar.className = isError ? 'status error' : 'status';
}

function refreshAndRender() {
  renderScene($('stage'), state.store);
  renderPanels();
}

function doCommand(cmd, successMessage) {
  try {
    pushCommand(state.store, cmd);
    refreshAndRender();
    if (successMessage) notify(successMessage);
  } catch (err) {
    notify(err.message, true);
  }
}

async function handleSave() {
  try {
    await saveNow(state.store);
    const hash = await docHash(state.store);
    notify(`Saved. doc sha256=${hash.slice(0, 16)}… counts=${JSON.stringify(projectCounts(state.store))}`);
    renderPanels();
  } catch (err) {
    notify(err.message, true);
  }
}

function handleLoad() {
  try {
    const restored = loadSaved();
    if (!restored) {
      notify('No saved project in localStorage', true);
      return;
    }
    state.store = restored;
    state.selectedAssetId = restored.assets[0]?.id ?? null;
    state.selectedLayerId = restored.layers[0]?.id ?? null;
    refreshAndRender();
    notify(`Loaded. counts=${JSON.stringify(projectCounts(restored))}`);
  } catch (err) {
    notify(`Load blocked: ${err.message}`, true);
  }
}

export async function docHash(targetStore = state.store) {
  return sha256Hex(canonicalString(extractDoc(targetStore)));
}

function extractDoc(store) {
  return JSON.parse(JSON.stringify({
    version: store.version,
    createdAt: store.createdAt,
    counters: store.counters,
    canvas: store.canvas,
    timeline: store.timeline,
    assets: store.assets,
    layers: store.layers,
    undo: store.undo,
    redo: store.redo,
  }));
}

window.editor = {
  state,
  doCommand,
  refreshAndRender,
  handleSave,
  handleLoad,
  docHash,
  projectCounts: () => projectCounts(state.store),
  importText: (text) => {
    state.store = importProject(text);
    refreshAndRender();
    return projectCounts(state.store);
  },
  exportText: () => exportJson(state.store, 0),
  storageKey: STORAGE_KEY,
};

document.addEventListener('DOMContentLoaded', () => {
  if (hasSavedProject()) {
    try {
      state.store = loadSaved();
      notify('Restored previous session from localStorage');
    } catch (err) {
      notify(`Saved project rejected: ${err.message}`, true);
    }
  }
  bindUi();
  state.selectedAssetId = state.store.assets[0]?.id ?? null;
  state.selectedLayerId = state.store.layers[0]?.id ?? null;
  refreshAndRender();
});

function bindUi() {
  $('addRect').addEventListener('click', () => addAssetOfKind('rect'));
  $('addEllipse').addEventListener('click', () => addAssetOfKind('ellipse'));
  $('addText').addEventListener('click', () => addAssetOfKind('text'));
  $('deleteAsset').addEventListener('click', deleteSelectedAsset);
  $('addLayer').addEventListener('click', addLayerForAsset);
  $('deleteLayer').addEventListener('click', deleteSelectedLayer);
  $('addKeyframe').addEventListener('click', addKeyframeAtPlayhead);
  $('removeKeyframe').addEventListener('click', removeKeyframeAtPlayhead);
  $('undo').addEventListener('click', () => { undo(state.store); refreshAndRender(); });
  $('redo').addEventListener('click', () => { redo(state.store); refreshAndRender(); });
  $('save').addEventListener('click', handleSave);
  $('load').addEventListener('click', handleLoad);
  $('exportFile').addEventListener('click', downloadExport);
  $('importFile').addEventListener('change', uploadImport);
  $('playhead').addEventListener('input', (event) => {
    const before = { ...state.store.timeline };
    const after = { ...before, playhead: Number(event.target.value) };
    doCommand({ type: 'updateTimeline', before, after });
  });
  $('duration').addEventListener('change', (event) => {
    const before = { ...state.store.timeline };
    const after = { ...before, duration: Number(event.target.value) };
    doCommand({ type: 'updateTimeline', before, after });
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo(state.store);
      refreshAndRender();
    } else if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'z'))) {
      event.preventDefault();
      redo(state.store);
      refreshAndRender();
    } else if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      handleSave();
    }
  });
}

function addAssetOfKind(kind) {
  const id = `asset_${String(state.store.counters[KIND.ASSET] + 1).padStart(4, '0')}`;
  const draft = {
    id,
    kind,
    name: `${kind}-${id}`,
    src: null,
    params: defaultAssetParams(kind),
  };
  const index = state.store.assets.length;
  doCommand({ type: 'addAsset', asset: draft, index });
  state.selectedAssetId = draft.id;
  refreshAndRender();
}

function deleteSelectedAsset() {
  const asset = state.store.assets.find((a) => a.id === state.selectedAssetId);
  if (!asset) return;
  if (isAssetInUse(state.store, asset.id)) {
    notify('Delete blocked: asset is referenced by one or more layers', true);
    return;
  }
  const index = state.store.assets.indexOf(asset);
  doCommand({ type: 'removeAsset', asset, index });
  state.selectedAssetId = state.store.assets[0]?.id ?? null;
  refreshAndRender();
}

function addLayerForAsset() {
  if (!state.selectedAssetId) {
    notify('Select an asset first', true);
    return;
  }
  const asset = state.store.assets.find((a) => a.id === state.selectedAssetId);
  const id = `layer_${String(state.store.counters[KIND.LAYER] + 1).padStart(4, '0')}`;
  const draft = {
    id,
    name: `${asset.name}-layer`,
    assetId: asset.id,
    visible: true,
    locked: false,
    base: { ...asset.params },
    keyframes: [],
  };
  const index = state.store.layers.length;
  doCommand({ type: 'addLayer', layer: draft, index });
  state.selectedLayerId = draft.id;
  refreshAndRender();
}

function deleteSelectedLayer() {
  const layer = state.store.layers.find((l) => l.id === state.selectedLayerId);
  if (!layer) return;
  const index = state.store.layers.indexOf(layer);
  doCommand({ type: 'removeLayer', layer, index });
  state.selectedLayerId = state.store.layers[0]?.id ?? null;
  refreshAndRender();
}

function addKeyframeAtPlayhead() {
  const layer = state.store.layers.find((l) => l.id === state.selectedLayerId);
  if (!layer) {
    notify('Select a layer first', true);
    return;
  }
  const time = state.store.timeline.playhead;
  const existing = layer.keyframes.find((kf) => kf.time === time);
  if (existing) {
    notify('A keyframe already exists at the playhead', true);
    return;
  }
  const id = `keyframe_${String(++state.store.counters[KIND.KEYFRAME]).padStart(4, '0')}`;
  state.store.counters[KIND.KEYFRAME] -= 1;
  const keyframe = { id, time, easing: 'linear', props: { ...layer.base } };
  doCommand({ type: 'addKeyframe', layerId: layer.id, keyframe });
  refreshAndRender();
}

function removeKeyframeAtPlayhead() {
  const layer = state.store.layers.find((l) => l.id === state.selectedLayerId);
  if (!layer) return;
  const time = state.store.timeline.playhead;
  const keyframe = layer.keyframes.find((kf) => kf.time === time);
  if (!keyframe) {
    notify('No keyframe at the playhead', true);
    return;
  }
  doCommand({ type: 'removeKeyframe', layerId: layer.id, keyframe });
  refreshAndRender();
}

function renderPanels() {
  const { store } = state;
  $('playhead').max = store.timeline.duration;
  $('playhead').value = store.timeline.playhead;
  $('duration').value = store.timeline.duration;
  $('counts').textContent = JSON.stringify(projectCounts(store));
  $('stackInfo').textContent = `undo: ${store.undo.length} / redo: ${store.redo.length}`;

  const assetList = $('assetList');
  assetList.innerHTML = '';
  for (const asset of store.assets) {
    const item = document.createElement('li');
    item.className = asset.id === state.selectedAssetId ? 'selected' : '';
    item.textContent = `${asset.id} · ${asset.kind} · ${asset.name}`;
    item.addEventListener('click', () => {
      state.selectedAssetId = asset.id;
      renderPanels();
    });
    assetList.appendChild(item);
  }

  const layerList = $('layerList');
  layerList.innerHTML = '';
  for (const layer of store.layers) {
    const item = document.createElement('li');
    item.className = layer.id === state.selectedLayerId ? 'selected' : '';
    const linked = store.assets.some((a) => a.id === layer.assetId);
    item.textContent = `${layer.id} → ${layer.assetId}${linked ? '' : ' (DANGLING)'} · kf:${layer.keyframes.length}`;
    item.addEventListener('click', () => {
      state.selectedLayerId = layer.id;
      renderPanels();
    });
    layerList.appendChild(item);
  }
  renderTimeline();
  renderInspector();
}

function renderTimeline() {
  const { store } = state;
  const track = $('timelineTrack');
  track.innerHTML = '';
  for (const layer of store.layers) {
    const row = document.createElement('div');
    row.className = 'track-row';
    const label = document.createElement('span');
    label.className = 'track-label';
    label.textContent = layer.id;
    row.appendChild(label);
    for (const kf of layer.keyframes) {
      const mark = document.createElement('span');
      mark.className = 'kf-mark';
      mark.style.left = `${(kf.time / store.timeline.duration) * 100}%`;
      mark.title = `${kf.id} @ ${kf.time}ms`;
      row.appendChild(mark);
    }
    track.appendChild(row);
  }
}

function renderInspector() {
  const inspector = $('inspector');
  inspector.innerHTML = '';
  const asset = state.store.assets.find((a) => a.id === state.selectedAssetId);
  const layer = state.store.layers.find((l) => l.id === state.selectedLayerId);
  if (asset) inspector.appendChild(buildAssetForm(asset));
  if (layer) inspector.appendChild(buildLayerForm(layer));
  if (!asset && !layer) {
    inspector.innerHTML = '<p class="muted">Select an asset or layer to edit parameters.</p>';
  }
}

function buildAssetForm(asset) {
  const box = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = `Asset ${asset.id} (${asset.kind})`;
  box.appendChild(title);
  for (const key of Object.keys(asset.params)) {
    box.appendChild(buildField(asset.params[key], key, (value) => {
      const before = { ...asset.params };
      const after = { ...before, [key]: value };
      doCommand({ type: 'updateAsset', assetId: asset.id, before, after });
    }));
  }
  return box;
}

function buildLayerForm(layer) {
  const box = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = `Layer ${layer.id}`;
  box.appendChild(title);
  for (const key of Object.keys(layer.base)) {
    box.appendChild(buildField(layer.base[key], key, (value) => {
      const before = { ...layer.base };
      const after = { ...before, [key]: value };
      doCommand({ type: 'updateLayerBase', layerId: layer.id, before, after });
    }));
  }
  const visible = document.createElement('label');
  visible.className = 'flag';
  visible.innerHTML = '<input type="checkbox"> visible';
  visible.querySelector('input').checked = layer.visible;
  visible.querySelector('input').addEventListener('change', (event) => {
    doCommand({
      type: 'updateLayerFlags', layerId: layer.id, field: 'visible',
      before: layer.visible, after: event.target.checked,
    });
  });
  box.appendChild(visible);
  return box;
}

function buildField(current, key, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const isNumber = typeof current === 'number';
  const isColor = typeof current === 'string' && /^#[0-9a-f]{6}$/i.test(current);
  wrap.innerHTML = `<span>${key}</span>`;
  const input = document.createElement('input');
  input.type = isColor ? 'color' : isNumber ? 'number' : 'text';
  input.value = current;
  input.addEventListener('change', () => {
    onChange(isNumber ? Number(input.value) : input.value);
  });
  wrap.appendChild(input);
  return wrap;
}

async function downloadExport() {
  const json = await exportJson(state.store, 0);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'project.json';
  anchor.click();
  URL.revokeObjectURL(url);
  notify('Project JSON exported');
}

function uploadImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.store = importProject(String(reader.result));
      state.selectedAssetId = state.store.assets[0]?.id ?? null;
      state.selectedLayerId = state.store.layers[0]?.id ?? null;
      refreshAndRender();
      notify('Project JSON imported');
    } catch (err) {
      notify(`Import blocked: ${err.message}`, true);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}
