import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalSaveStore } from "../src/save-store.js";
import {
  corruptLatestSnapshot,
  makeLegacyV2Payload,
  simulateInterruptedWrite,
} from "../src/save-simulation.js";
import { FileStorage } from "./file-storage.mjs";

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "save-vault-sim-"));
let clockTick = 0;

function makeStore(name) {
  const root = path.join(TEMP_ROOT, name);
  const storage = new FileStorage(root);
  const store = new LocalSaveStore(storage, {
    namespace: "demo-archive",
    now: () => new Date(Date.UTC(2026, 10, 15, 6, 0, clockTick++)),
  });
  return { store, storage, root };
}

function sampleSave(score, replayId = "replay-demo-001") {
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
      id: replayId,
      playedAt: "2026-11-15T06:00:00.000Z",
      durationSeconds: 346,
      score,
      events: 512,
      outcome: "cleared",
    },
  };
}

function section(title, detail) {
  console.log(`\n[${title}]`);
  console.log(detail);
}

function summarize(result) {
  if (!result.ok) {
    return JSON.stringify({ ok: false, status: result.status, message: result.message });
  }
  return JSON.stringify(
    {
      status: result.status,
      sequence: result.source.sequence,
      slot: result.source.slot,
      schemaVersion: result.source.schemaVersion,
      score: result.data.progress.score,
      recovered: result.recovered,
      migration: result.migration
        ? {
            from: result.migration.fromVersion,
            to: result.migration.toVersion,
            steps: result.migration.steps,
          }
        : null,
    },
    null,
    2
  );
}

try {
  const normal = makeStore("01-normal");
  normal.store.save(sampleSave(1200));
  normal.store.save(sampleSave(3400));
  const normalLoad = normal.store.load();
  assert.equal(normalLoad.status, "ok");
  assert.equal(normalLoad.source.sequence, 2);
  assert.equal(normalLoad.data.progress.score, 3400);
  section("PASS 正常恢复", `${summarize(normalLoad)}\n文件: ${normal.storage.snapshotFiles().length} 份`);

  const corrupted = makeStore("02-corrupt");
  corrupted.store.save(sampleSave(1200));
  corrupted.store.save(sampleSave(3400));
  const damaged = corruptLatestSnapshot(corrupted.store);
  const corruptLoad = corrupted.store.load();
  assert.equal(corruptLoad.status, "recovered");
  assert.equal(corruptLoad.source.sequence, 1);
  assert.equal(corruptLoad.data.progress.score, 1200);
  section(
    "PASS 损坏回退",
    `${summarize(corruptLoad)}\n故意损坏: #${damaged.sequence} (${damaged.slot})\n提示: ${corruptLoad.message}`
  );

  const interrupted = makeStore("03-interrupt");
  interrupted.store.save(sampleSave(1200));
  interrupted.store.save(sampleSave(3400));
  const interruption = simulateInterruptedWrite(interrupted.store, sampleSave(9999));
  const interruptLoad = interrupted.store.load();
  assert.equal(interruption.interrupted, true);
  assert.equal(interruptLoad.status, "recovered");
  assert.equal(interruptLoad.source.sequence, 2);
  assert.equal(interruptLoad.data.progress.score, 3400);
  section(
    "PASS 中断写入",
    `${summarize(interruptLoad)}\n截断快照: #${interruption.sequence} (${interruption.slot})\n提示: ${interruptLoad.message}`
  );

  const upgraded = makeStore("04-upgrade");
  upgraded.store.save(sampleSave(2000));
  upgraded.store.saveLegacySnapshot(2, makeLegacyV2Payload(sampleSave(2500)));
  const migratedLoad = upgraded.store.load();
  assert.equal(migratedLoad.status, "migrated");
  assert.equal(migratedLoad.migration.fromVersion, 2);
  const persisted = upgraded.store.save(migratedLoad.data);
  const postMigration = upgraded.store.load();
  assert.equal(postMigration.status, "ok");
  assert.equal(postMigration.source.schemaVersion, 3);
  assert.equal(upgraded.store.inspect().snapshots.length >= 2, true);
  section(
    "PASS 版本升级",
    `${summarize(migratedLoad)}\n迁移写入: #${persisted.sequence}\n迁移后读取: ${postMigration.message}\n旧 v2 快照仍保留: ${upgraded.store.inspect().snapshots.some((item) => item.schemaVersion === 2)}`
  );

  console.log(`\n临时快照目录: ${TEMP_ROOT}`);
  console.log("结果: 4/4 路径通过");
} catch (error) {
  console.error("\n模拟失败:", error);
  process.exitCode = 1;
} finally {
  if (process.exitCode !== 1 && !process.env.KEEP_SIM_FILES) {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
}
