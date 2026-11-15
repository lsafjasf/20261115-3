import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEnvelope,
  migrateToCurrent,
} from "../src/save-schema.js";
import { LocalSaveStore, SaveWriteError } from "../src/save-store.js";
import {
  corruptLatestSnapshot,
  makeLegacyV1Payload,
  makeLegacyV2Payload,
  simulateInterruptedWrite,
} from "../src/save-simulation.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

function sampleSave(score = 3200) {
  return {
    progress: {
      playerName: "LIN",
      level: 7,
      score,
      playTimeSeconds: 1280,
    },
    settings: {
      musicVolume: 62,
      sfxVolume: 84,
      theme: "midnight",
      reducedMotion: false,
    },
    replaySummary: {
      id: "replay-20261115-001",
      playedAt: "2026-11-15T06:00:00.000Z",
      durationSeconds: 346,
      score,
      events: 512,
      outcome: "cleared",
    },
  };
}

function createStore(storage = new MemoryStorage()) {
  let tick = 0;
  return {
    storage,
    store: new LocalSaveStore(storage, {
      now: () => new Date(Date.UTC(2026, 10, 15, 6, 0, tick++)),
    }),
  };
}

test("正常保存后恢复最新完整快照，并保留上一份", () => {
  const { store, storage } = createStore();
  const first = store.save(sampleSave(1000));
  const firstRaw = storage.getItem(first.key);
  const second = store.save(sampleSave(2400));
  const result = store.load();

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(storage.getItem(first.key), firstRaw, "旧快照不应被覆盖");
  assert.equal(result.status, "ok");
  assert.equal(result.data.progress.score, 2400);
  assert.equal(result.source.sequence, 2);
  assert.equal(result.recovered, false);
});

test("最新快照损坏时回退到上一份完整快照", () => {
  const { store } = createStore();
  store.save(sampleSave(1000));
  store.save(sampleSave(2000));
  const damaged = corruptLatestSnapshot(store);
  const result = store.load();

  assert.equal(damaged.sequence, 2);
  assert.equal(result.status, "recovered");
  assert.equal(result.recovered, true);
  assert.equal(result.source.sequence, 1);
  assert.equal(result.data.progress.score, 1000);
  assert.equal(result.issues[0].code, "checksum");
  assert.match(result.message, /回退|坏副本/);
});

test("写入中断只留下坏副本，读取回退且不丢失旧快照", () => {
  const { store } = createStore();
  store.save(sampleSave(1000));
  store.save(sampleSave(2000));
  const interrupted = simulateInterruptedWrite(store, sampleSave(9999));
  const result = store.load();

  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.sequence, 3);
  assert.equal(result.status, "recovered");
  assert.equal(result.source.sequence, 2);
  assert.equal(result.data.progress.score, 2000);
  assert.equal(result.issues.length, 1);
});

test("v2 存档加载时迁移并保留旧快照", () => {
  const { store } = createStore();
  const current = sampleSave(1800);
  store.saveLegacySnapshot(2, makeLegacyV2Payload(current));

  const loaded = store.load();
  assert.equal(loaded.status, "migrated");
  assert.equal(loaded.migration.fromVersion, 2);
  assert.equal(loaded.migration.toVersion, 3);
  assert.deepEqual(loaded.migration.steps, ["v2 → v3"]);
  assert.equal(loaded.migration.warnings.length, 2);
  assert.equal(loaded.data.settings.reducedMotion, false);
  assert.equal(loaded.data.replaySummary.events, 0);

  store.save(loaded.data);
  const afterMigration = store.load();
  assert.equal(afterMigration.status, "ok");
  assert.equal(afterMigration.source.schemaVersion, 3);
  assert.equal(store.inspect().snapshots.length, 2, "迁移写入不应删除旧版本");
});

test("v1 可通过迁移链升级到当前版本", () => {
  const { store } = createStore();
  store.saveLegacySnapshot(1, makeLegacyV1Payload(sampleSave(777)));
  const loaded = store.load();

  assert.equal(loaded.status, "migrated");
  assert.equal(loaded.migration.fromVersion, 1);
  assert.deepEqual(loaded.migration.steps, ["v1 → v2", "v2 → v3"]);
  assert.equal(loaded.data.progress.playerName, "LIN");
  assert.equal(loaded.data.settings.theme, "system");
});

test("更高版本单独存在时拒绝读取，且不修改原数据", () => {
  const { store, storage } = createStore();
  const raw = JSON.stringify(
    buildEnvelope({
      schemaVersion: 4,
      sequence: 9,
      savedAt: "2026-11-15T06:00:00.000Z",
      payload: sampleSave(1),
    })
  );
  storage.setItem(store.keyForSlot("s1"), raw);
  const result = store.load();

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.match(result.message, /更高版本/);
  assert.equal(storage.getItem(store.keyForSlot("s1")), raw);
});

test("未来版本损坏时可回退，且不会视为可覆盖的最新有效快照", () => {
  const { store, storage } = createStore();
  store.save(sampleSave(1000));
  const future = JSON.stringify(
    buildEnvelope({
      schemaVersion: 4,
      sequence: 50,
      savedAt: "2026-11-15T07:00:00.000Z",
      payload: sampleSave(5000),
    })
  );
  storage.setItem(store.keyForSlot("s2"), future);
  const result = store.load();

  assert.equal(result.status, "recovered");
  assert.equal(result.source.sequence, 1);
  assert.equal(result.issues.some((issue) => issue.code === "future"), true);
});

test("没有任何已验证快照时拒绝覆盖仅有的未来版本副本", () => {
  const { store, storage } = createStore();
  const future = JSON.stringify(
    buildEnvelope({
      schemaVersion: 4,
      sequence: 1,
      savedAt: "2026-11-15T07:00:00.000Z",
      payload: sampleSave(5000),
    })
  );
  storage.setItem(store.keyForSlot("s1"), future);
  storage.setItem(store.keyForSlot("s2"), "{truncated");
  storage.setItem(store.keyForSlot("s3"), "{also-truncated");

  assert.throws(() => store.save(sampleSave(9000)), SaveWriteError);
  assert.equal(storage.getItem(store.keyForSlot("s1")), future);
  assert.equal(storage.getItem(store.keyForSlot("s2")), "{truncated");
});

test("存在完整快照时也不会覆盖未来版本槽位", () => {
  const { store, storage } = createStore();
  store.save(sampleSave(1000));
  store.save(sampleSave(2000));
  const future = JSON.stringify(
    buildEnvelope({
      schemaVersion: 4,
      sequence: 90,
      savedAt: "2026-11-15T07:00:00.000Z",
      payload: sampleSave(5000),
    })
  );
  storage.setItem(store.keyForSlot("s3"), future);

  const written = store.save(sampleSave(3000));
  assert.equal(written.slot, "s1", "应轮换最旧完整快照，而不是覆盖未来版本");
  assert.equal(storage.getItem(store.keyForSlot("s3")), future);
});

test("底层写入失败时旧快照仍可读取", () => {
  const { store, storage } = createStore();
  store.save(sampleSave(1000));
  store.save(sampleSave(2000));
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };

  assert.throws(() => store.save(sampleSave(3000)), SaveWriteError);
  storage.setItem = originalSetItem;

  const result = store.load();
  assert.equal(result.status, "ok");
  assert.equal(result.data.progress.score, 2000);
});

test("校验和正确但业务数据非法的快照会被跳过", () => {
  const { store, storage } = createStore();
  store.save(sampleSave(1000));
  const badData = sampleSave(2000);
  badData.settings.musicVolume = 900;
  const raw = JSON.stringify(
    buildEnvelope({
      schemaVersion: 3,
      sequence: 2,
      savedAt: "2026-11-15T06:30:00.000Z",
      payload: badData,
    })
  );
  storage.setItem(store.keyForSlot("s2"), raw);

  const result = store.load();
  assert.equal(result.status, "recovered");
  assert.equal(result.source.sequence, 1);
  assert.equal(result.skipped[0].code, "invalid-data");
});

test("迁移函数不修改输入对象", () => {
  const current = sampleSave(4400);
  const legacy = makeLegacyV2Payload(current);
  const snapshot = JSON.stringify(legacy);
  migrateToCurrent(2, legacy);
  assert.equal(JSON.stringify(legacy), snapshot);
});
