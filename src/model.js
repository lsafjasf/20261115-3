// Core document model: ids, factories, and referential integrity.

export const KIND = {
  ASSET: 'asset',
  LAYER: 'layer',
  KEYFRAME: 'keyframe',
};

export function createStore() {
  return {
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    counters: { [KIND.ASSET]: 0, [KIND.LAYER]: 0, [KIND.KEYFRAME]: 0 },
    canvas: { width: 960, height: 600, background: '#10131a' },
    timeline: { duration: 5000, playhead: 0, fps: 30 },
    assets: [],
    layers: [],
    undo: [],
    redo: [],
  };
}

export function nextId(store, kind) {
  const n = ++store.counters[kind];
  return `${kind}_${String(n).padStart(4, '0')}`;
}

const NUMERIC_PROPS = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'blur', 'radius', 'fontSize'];

export function defaultParams(kind) {
  if (kind === 'text') {
    return {
      text: 'Hello',
      x: 260, y: 220, width: 440, height: 160, rotation: 0,
      opacity: 1, blur: 0, radius: 0, fontSize: 64,
      fill: '#f4f7ff', stroke: '#000000', strokeWidth: 0,
      fontFamily: 'sans-serif',
    };
  }
  if (kind === 'ellipse') {
    return {
      text: '',
      x: 320, y: 200, width: 320, height: 200, rotation: 0,
      opacity: 1, blur: 0, radius: 0, fontSize: 16,
      fill: '#3da9fc', stroke: '#ffffff', strokeWidth: 2,
      fontFamily: 'sans-serif',
    };
  }
  return {
    text: '',
    x: 300, y: 180, width: 360, height: 240, rotation: 0,
    opacity: 1, blur: 0, radius: 18, fontSize: 16,
    fill: '#ef476f', stroke: '#ffffff', strokeWidth: 2,
    fontFamily: 'sans-serif',
  };
}

export function createAsset(store, { kind = 'rect', name = null, src = null, params = {} } = {}) {
  const id = nextId(store, KIND.ASSET);
  const asset = {
    id,
    kind,
    name: name ?? `${kind}-${id}`,
    src,
    params: { ...defaultParams(kind), ...params },
  };
  store.assets.push(asset);
  return asset;
}

export function createLayer(store, { assetId, name = null } = {}) {
  const asset = store.assets.find((a) => a.id === assetId);
  if (!asset) {
    throw new Error(`DANGLING_REF: asset ${assetId} does not exist`);
  }
  const id = nextId(store, KIND.LAYER);
  const layer = {
    id,
    name: name ?? `${asset.name}-layer`,
    assetId,
    visible: true,
    locked: false,
    base: { ...asset.params },
    keyframes: [],
  };
  store.layers.push(layer);
  return layer;
}

export function createKeyframe(store, layerId, time, props) {
  const layer = store.layers.find((l) => l.id === layerId);
  if (!layer) {
    throw new Error(`DANGLING_REF: layer ${layerId} does not exist`);
  }
  if (time < 0 || time > store.timeline.duration) {
    throw new Error(`OUT_OF_RANGE: keyframe time ${time} outside timeline`);
  }
  const existing = layer.keyframes.find((k) => k.time === time);
  if (existing) {
    existing.props = { ...existing.props, ...props };
    return existing;
  }
  const id = nextId(store, KIND.KEYFRAME);
  const keyframe = { id, time, easing: 'linear', props: { ...props } };
  layer.keyframes.push(keyframe);
  layer.keyframes.sort((a, b) => a.time - b.time);
  return keyframe;
}

// Collect every reference edge so integrity checks stay centralized.
export function referenceEdges(store) {
  const edges = [];
  for (const layer of store.layers) {
    edges.push({ from: layer.id, type: 'layer.assetId', to: layer.assetId });
  }
  return edges;
}

export function findDanglingReferences(store) {
  const assetIds = new Set(store.assets.map((a) => a.id));
  const layerIds = new Set(store.layers.map((l) => l.id));
  const errors = [];
  for (const edge of referenceEdges(store)) {
    if (!assetIds.has(edge.to)) {
      errors.push(`${edge.from} -> missing ${edge.type} target ${edge.to}`);
    }
  }
  for (const layer of store.layers) {
    for (const kf of layer.keyframes) {
      if (!layerIds.has(layer.id)) {
        errors.push(`${kf.id} -> missing layer ${layer.id}`);
      }
      if (typeof kf.time !== 'number' || kf.time < 0 || kf.time > store.timeline.duration) {
        errors.push(`${kf.id} -> time ${kf.time} outside timeline`);
      }
    }
  }
  return errors;
}

// Throwing guard used by every mutating command and by import.
export function assertIntegrity(store) {
  const errors = findDanglingReferences(store);
  if (errors.length) {
    throw new Error(`DANGLING_REF: ${errors.join('; ')}`);
  }
  return true;
}

export function isAssetInUse(store, assetId) {
  return store.layers.some((l) => l.assetId === assetId);
}

export { NUMERIC_PROPS };
