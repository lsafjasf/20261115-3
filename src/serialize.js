import { assertIntegrity, KIND } from './model.js';

// Deterministic deep clone: object keys sorted, arrays keep their order.
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalString(value) {
  return JSON.stringify(canonicalize(value));
}

// SHA-256 of the canonical text, same hash in browser and Node.
export async function sha256Hex(text) {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function countByKind(store) {
  const keyframes = store.layers.reduce((sum, layer) => sum + layer.keyframes.length, 0);
  return {
    assets: store.assets.length,
    layers: store.layers.length,
    keyframes,
    undoEntries: store.undo.length,
    redoEntries: store.redo.length,
  };
}

// Pure export: never mutates the live store, so repeated exports cannot
// accumulate duplicate objects inside the running editor. Timestamps are
// intentionally excluded from the canonical doc so round-trip hashes are
// stable across saves.
export function exportProject(store, now = 0) {
  assertIntegrity(store);
  const doc = canonicalize({
    version: store.version,
    createdAt: store.createdAt,
    counters: store.counters,
    canvas: store.canvas,
    timeline: store.timeline,
    assets: store.assets,
    layers: store.layers,
    undo: store.undo,
    redo: store.redo,
  });
  return {
    format: 'visual-editor-project',
    savedAt: now || store.updatedAt,
    doc,
    counts: countByKind(store),
  };
}

export async function exportJson(store, now = 0) {
  const project = exportProject(store, now);
  project.sha256 = await sha256Hex(canonicalString(project.doc));
  return JSON.stringify(project, null, 2);
}

function validateShape(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('IMPORT_INVALID: payload is not an object');
  const doc = raw.doc ?? raw;
  for (const key of ['counters', 'canvas', 'timeline', 'assets', 'layers', 'undo', 'redo']) {
    if (!(key in doc)) throw new Error(`IMPORT_INVALID: missing doc.${key}`);
  }
  if (!Array.isArray(doc.assets) || !Array.isArray(doc.layers)) {
    throw new Error('IMPORT_INVALID: assets/layers must be arrays');
  }
  if (typeof doc.timeline.duration !== 'number' || typeof doc.timeline.playhead !== 'number') {
    throw new Error('IMPORT_INVALID: timeline fields must be numbers');
  }
  return doc;
}

function assertUniqueIds(doc) {
  const seen = new Set();
  const groups = [
    ...doc.assets.map((x) => [x, KIND.ASSET]),
    ...doc.layers.map((x) => [x, KIND.LAYER]),
    ...doc.layers.flatMap((layer) => layer.keyframes.map((kf) => [kf, KIND.KEYFRAME])),
  ];
  for (const [entity, kind] of groups) {
    if (!entity?.id || typeof entity.id !== 'string') {
      throw new Error(`IMPORT_INVALID: ${kind} entity without id`);
    }
    if (seen.has(entity.id)) throw new Error(`IMPORT_DUPLICATE_ID: ${entity.id}`);
    seen.add(entity.id);
  }
}

// Import returns a fresh, fully cloned store. A dangling reference rejects
// the whole payload before the live editor state is replaced.
export function importProject(raw) {
  const doc = validateShape(typeof raw === 'string' ? JSON.parse(raw) : raw);
  assertUniqueIds(doc);
  const store = {
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: raw.savedAt ?? doc.updatedAt ?? 0,
    counters: { ...doc.counters },
    canvas: { ...doc.canvas },
    timeline: { ...doc.timeline },
    assets: doc.assets.map((asset) => ({
      ...asset,
      params: { ...asset.params },
    })),
    layers: doc.layers.map((layer) => ({
      ...layer,
      base: { ...layer.base },
      keyframes: layer.keyframes.map((kf) => ({ ...kf, props: { ...kf.props } })),
    })),
    undo: doc.undo.map((entry) => JSON.parse(JSON.stringify(entry))),
    redo: doc.redo.map((entry) => JSON.parse(JSON.stringify(entry))),
  };
  assertIntegrity(store);
  return store;
}

export function projectCounts(store) {
  return countByKind(store);
}
