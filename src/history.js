import { assertIntegrity, isAssetInUse } from './model.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function run(store, cmd, direction) {
  const forward = direction === 'do';
  switch (cmd.type) {
    case 'addAsset': {
      const asset = clone(cmd.asset);
      if (forward) store.assets.splice(cmd.index, 0, asset);
      else store.assets = store.assets.filter((a) => a.id !== asset.id);
      break;
    }
    case 'removeAsset': {
      if (forward) {
        if (isAssetInUse(store, cmd.asset.id)) {
          throw new Error(`REFUSED: asset ${cmd.asset.id} is referenced by a layer`);
        }
        store.assets = store.assets.filter((a) => a.id !== cmd.asset.id);
      } else {
        store.assets.splice(cmd.index, 0, clone(cmd.asset));
      }
      break;
    }
    case 'addLayer': {
      if (forward) store.layers.splice(cmd.index, 0, clone(cmd.layer));
      else store.layers = store.layers.filter((l) => l.id !== cmd.layer.id);
      break;
    }
    case 'removeLayer': {
      if (forward) store.layers = store.layers.filter((l) => l.id !== cmd.layer.id);
      else store.layers.splice(cmd.index, 0, clone(cmd.layer));
      break;
    }
    case 'updateAsset': {
      const asset = store.assets.find((a) => a.id === cmd.assetId);
      asset.params = clone(forward ? cmd.after : cmd.before);
      break;
    }
    case 'updateLayerBase': {
      const layer = store.layers.find((l) => l.id === cmd.layerId);
      layer.base = clone(forward ? cmd.after : cmd.before);
      break;
    }
    case 'updateLayerFlags': {
      const layer = store.layers.find((l) => l.id === cmd.layerId);
      layer[cmd.field] = forward ? cmd.after : cmd.before;
      break;
    }
    case 'addKeyframe': {
      const layer = store.layers.find((l) => l.id === cmd.layerId);
      if (forward) {
        layer.keyframes.push(clone(cmd.keyframe));
        layer.keyframes.sort((a, b) => a.time - b.time);
      } else {
        layer.keyframes = layer.keyframes.filter((kf) => kf.id !== cmd.keyframe.id);
      }
      break;
    }
    case 'removeKeyframe': {
      const layer = store.layers.find((l) => l.id === cmd.layerId);
      if (forward) {
        layer.keyframes = layer.keyframes.filter((kf) => kf.id !== cmd.keyframe.id);
      } else {
        layer.keyframes.push(clone(cmd.keyframe));
        layer.keyframes.sort((a, b) => a.time - b.time);
      }
      break;
    }
    case 'updateTimeline': {
      Object.assign(store.timeline, clone(forward ? cmd.after : cmd.before));
      break;
    }
    default:
      throw new Error(`UNKNOWN_COMMAND: ${cmd.type}`);
  }
  assertIntegrity(store);
}

// Execute a user command, record it, and clear the redo branch.
export function pushCommand(store, cmd) {
  run(store, cmd, 'do');
  store.undo.push(clone(cmd));
  store.redo = [];
}

export function undo(store) {
  const cmd = store.undo.pop();
  if (!cmd) return null;
  run(store, cmd, 'undo');
  store.redo.push(clone(cmd));
  return cmd;
}

export function redo(store) {
  const cmd = store.redo.pop();
  if (!cmd) return null;
  run(store, cmd, 'do');
  store.undo.push(clone(cmd));
  return cmd;
}
