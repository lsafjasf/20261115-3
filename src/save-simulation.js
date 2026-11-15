import { cloneJson } from "./save-schema.js";
import { LocalSaveStore } from "./save-store.js";

export function ensureSnapshotHistory(store, payload, minimum = 2) {
  let inspection = store.inspect();
  while (inspection.snapshots.length < minimum) {
    store.save(payload);
    inspection = store.inspect();
  }
  return inspection;
}

export function corruptLatestSnapshot(store) {
  const inspection = store.inspect();
  if (inspection.snapshots.length < 2) {
    throw new Error("至少需要两份完整快照，拒绝破坏唯一副本");
  }
  const latest = inspection.snapshots[0];
  const envelope = JSON.parse(store.storage.getItem(latest.key));
  envelope.payload.replaySummary.durationSeconds += 17;
  store.storage.setItem(latest.key, JSON.stringify(envelope));
  return {
    slot: latest.slot,
    sequence: latest.sequence,
    key: latest.key,
    reason: "payload 被修改但校验和未同步，模拟位翻转/局部损坏",
  };
}

export function simulateInterruptedWrite(store, payload, ratio = 0.38) {
  ensureSnapshotHistory(store, payload, 2);
  let interrupted = false;
  let attemptedSlot = null;
  const faultyStorage = {
    getItem(key) {
      return store.storage.getItem(key);
    },
    setItem(key, value) {
      if (!interrupted) {
        interrupted = true;
        attemptedSlot = key;
        const cut = Math.max(1, Math.floor(value.length * ratio));
        store.storage.setItem(key, value.slice(0, cut));
        throw new Error("模拟进程在写入过程中终止");
      }
      return store.storage.setItem(key, value);
    },
    removeItem(key) {
      return store.storage.removeItem?.(key);
    },
  };
  const simulatedStore = new LocalSaveStore(faultyStorage, {
    namespace: store.namespace,
    slotCount: store.slotCount,
    now: store.now,
  });

  let writeError = null;
  try {
    simulatedStore.save(payload);
  } catch (error) {
    writeError = error;
  }
  return {
    interrupted: Boolean(writeError),
    slot: writeError?.details?.slot ?? null,
    sequence: writeError?.details?.sequence ?? null,
    key: attemptedSlot,
    message: writeError?.message ?? "故障注入未触发",
  };
}

export function makeLegacyV2Payload(currentData) {
  const legacy = cloneJson(currentData);
  delete legacy.settings.reducedMotion;
  delete legacy.replaySummary.events;
  return legacy;
}

export function makeLegacyV1Payload(currentData) {
  const { progress, settings, replaySummary } = cloneJson(currentData);
  return {
    game: {
      playerName: progress.playerName,
      level: Math.max(1, progress.level - 1),
      score: Math.max(0, progress.score - 1200),
    },
    sound: {
      music: settings.musicVolume,
      effects: settings.sfxVolume,
    },
    replay: {
      durationSeconds: replaySummary.durationSeconds,
      score: replaySummary.score,
      recordedAt: replaySummary.playedAt,
    },
  };
}
