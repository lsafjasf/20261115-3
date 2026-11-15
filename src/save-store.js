import {
  SAVE_SCHEMA_VERSION,
  SaveIssue,
  buildEnvelope,
  cloneJson,
  migrateToCurrent,
  parseAndVerifyEnvelope,
  validateCurrentPayload,
} from "./save-schema.js";

export const DEFAULT_NAMESPACE = "arcade-archive-v1";
export const DEFAULT_SLOT_COUNT = 3;

export class SaveWriteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SaveWriteError";
    this.code = "write-failed";
    this.details = details;
  }
}

export class LocalSaveStore {
  constructor(
    storage,
    { namespace = DEFAULT_NAMESPACE, slotCount = DEFAULT_SLOT_COUNT, now = () => new Date() } = {}
  ) {
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function"
    ) {
      throw new TypeError("storage 必须实现 getItem 和 setItem");
    }
    if (!Number.isInteger(slotCount) || slotCount < 2) {
      throw new RangeError("slotCount 至少为 2，确保当前快照始终有回退副本");
    }
    this.storage = storage;
    this.namespace = namespace;
    this.slotCount = slotCount;
    this.slotIds = Array.from({ length: slotCount }, (_, index) => `s${index + 1}`);
    this.now = now;
  }

  keyForSlot(slot) {
    return `${this.namespace}:snapshot:${slot}`;
  }

  load() {
    const inspection = this.inspect();
    const issues = inspection.issues.map((issue) => ({ ...issue }));
    const skipped = [];
    let selected = null;

    for (const candidate of inspection.snapshots) {
      try {
        const migration = migrateToCurrent(
          candidate.schemaVersion,
          candidate.payload
        );
        selected = { candidate, migration };
        break;
      } catch (error) {
        skipped.push({
          slot: candidate.slot,
          sequence: candidate.sequence,
          schemaVersion: candidate.schemaVersion,
          code: error.code ?? "invalid-data",
          message: error.message,
        });
      }
    }

    if (!selected) {
      const futureIssue = issues.find((issue) => issue.code === "future");
      const allFailures = [...issues, ...skipped];
      return {
        ok: false,
        status: "error",
        data: null,
        issues: allFailures,
        skipped,
        message: futureIssue
          ? "存档由更高版本创建，当前应用无法读取；原文件未被修改。"
          : allFailures.length
            ? "没有可用的完整快照，所有副本均已损坏或无法迁移。"
            : "尚无本地存档。",
      };
    }

    const { candidate, migration } = selected;
    const recovered = issues.length > 0 || skipped.length > 0;
    const migrated = migration.fromVersion !== SAVE_SCHEMA_VERSION;
    const status = migrated ? "migrated" : recovered ? "recovered" : "ok";

    return {
      ok: true,
      status,
      data: migration.data,
      source: {
        slot: candidate.slot,
        key: candidate.key,
        sequence: candidate.sequence,
        savedAt: candidate.savedAt,
        schemaVersion: candidate.schemaVersion,
      },
      recovered,
      issues,
      skipped,
      migration: migrated
        ? {
            fromVersion: migration.fromVersion,
            toVersion: SAVE_SCHEMA_VERSION,
            steps: migration.steps,
            warnings: migration.warnings,
            needsWrite: true,
          }
        : null,
      message: this._loadMessage({
        candidate,
        recovered,
        migrated,
        issues,
        skipped,
      }),
    };
  }

  inspect() {
    const snapshots = [];
    const issues = [];
    const slotStates = [];

    for (const slot of this.slotIds) {
      const key = this.keyForSlot(slot);
      let raw = null;
      try {
        raw = this.storage.getItem(key);
      } catch (error) {
        issues.push({
          slot,
          key,
          code: "read",
          message: `读取失败：${error.message}`,
        });
        slotStates.push({ slot, key, state: "unreadable" });
        continue;
      }
      if (raw === null) {
        slotStates.push({ slot, key, state: "empty" });
        continue;
      }
      try {
        const envelope = parseAndVerifyEnvelope(raw);
        snapshots.push({
          slot,
          key,
          sequence: envelope.sequence,
          savedAt: envelope.savedAt,
          schemaVersion: envelope.schemaVersion,
          payload: envelope.payload,
          bytes: raw.length,
        });
        slotStates.push({ slot, key, state: "complete" });
      } catch (error) {
        issues.push({
          slot,
          key,
          code: error.code ?? "corrupt",
          message: error.message,
          schemaVersion: error.details?.schemaVersion,
        });
        slotStates.push({ slot, key, state: "invalid" });
      }
    }

    snapshots.sort(
      (left, right) =>
        right.sequence - left.sequence ||
        Date.parse(right.savedAt) - Date.parse(left.savedAt)
    );
    return { snapshots, issues, slotStates };
  }

  save(payload) {
    const errors = validateCurrentPayload(payload);
    if (errors.length > 0) {
      throw new SaveIssue("invalid-data", errors.join("；"));
    }
    return this._commit(SAVE_SCHEMA_VERSION, cloneJson(payload));
  }

  saveLegacySnapshot(schemaVersion, payload) {
    if (schemaVersion >= SAVE_SCHEMA_VERSION) {
      throw new SaveIssue("invalid-envelope", "旧版本模拟仅支持低于当前 schema 的版本");
    }
    migrateToCurrent(schemaVersion, payload);
    return this._commit(schemaVersion, cloneJson(payload));
  }

  _commit(schemaVersion, payload) {
    const inspection = this.inspect();
    const target = this._chooseTarget(inspection);
    const sequence =
      inspection.snapshots.length > 0 ? inspection.snapshots[0].sequence + 1 : 1;
    const savedAt = this.now().toISOString();
    const envelope = buildEnvelope({ schemaVersion, sequence, savedAt, payload });
    const serialized = JSON.stringify(envelope);

    try {
      this.storage.setItem(target.key, serialized);
    } catch (error) {
      throw new SaveWriteError("写入未完成，原有完整快照未被覆盖。", {
        slot: target.slot,
        sequence,
        cause: error.message,
      });
    }

    try {
      const persisted = this.storage.getItem(target.key);
      const verified = parseAndVerifyEnvelope(persisted);
      if (verified.sequence !== sequence || verified.schemaVersion !== schemaVersion) {
        throw new SaveIssue("readback", "写入后校验发现快照内容不一致");
      }
    } catch (error) {
      throw new SaveWriteError("写入后校验失败，读取将回退到上一份完整快照。", {
        slot: target.slot,
        sequence,
        cause: error.message,
      });
    }

    return {
      ok: true,
      slot: target.slot,
      key: target.key,
      sequence,
      savedAt,
      schemaVersion,
      replacedCompleteSnapshot: target.previousState === "complete",
      remainingCompleteSnapshots: this.inspect().snapshots.length,
    };
  }

  _chooseTarget(inspection) {
    const completeBySlot = new Map(
      inspection.snapshots.map((snapshot) => [snapshot.slot, snapshot])
    );
    const latest = inspection.snapshots[0] ?? null;
    const stateBySlot = new Map(
      inspection.slotStates.map((state) => [state.slot, state.state])
    );
    const issueBySlot = new Map(
      inspection.issues.map((issue) => [issue.slot, issue])
    );

    if (!latest) {
      const emptySlot = this.slotIds.find(
        (slot) => (stateBySlot.get(slot) ?? "empty") === "empty"
      );
      if (!emptySlot) {
        throw new SaveWriteError(
          "没有空槽位且不存在已验证快照，拒绝覆盖未知或损坏的唯一副本。",
          { slots: this.slotIds }
        );
      }
      return {
        slot: emptySlot,
        key: this.keyForSlot(emptySlot),
        previousState: "empty",
      };
    }

    for (const slot of this.slotIds) {
      if (
        slot !== latest.slot &&
        !completeBySlot.has(slot) &&
        (stateBySlot.get(slot) ?? "empty") === "empty"
      ) {
        return {
          slot,
          key: this.keyForSlot(slot),
          previousState: "empty",
        };
      }
    }

    for (const slot of this.slotIds) {
      const issue = issueBySlot.get(slot);
      if (
        slot !== latest.slot &&
        issue &&
        issue.code !== "future" &&
        issue.code !== "read"
      ) {
        return {
          slot,
          key: this.keyForSlot(slot),
          previousState: "invalid",
        };
      }
    }

    const oldest = inspection.snapshots[inspection.snapshots.length - 1];
    if (!oldest || oldest.slot === latest.slot) {
      throw new SaveWriteError("没有安全槽位可写，拒绝覆盖唯一完整快照。", {
        latestSlot: latest.slot,
      });
    }
    return {
      slot: oldest.slot,
      key: oldest.key,
      previousState: "complete",
    };
  }

  _loadMessage({ candidate, recovered, migrated, issues, skipped }) {
    if (migrated) {
      const warnings = skipped.length
        ? `另有 ${skipped.length} 份快照无法加载；`
        : "";
      return `${warnings}已读取 v${candidate.schemaVersion} 存档，需要迁移到 v${SAVE_SCHEMA_VERSION}。`;
    }
    if (recovered) {
      const skippedNewer = skipped.filter(
        (item) => item.sequence > candidate.sequence
      ).length;
      return skippedNewer
        ? `较新的快照不可用，已回退到 #${candidate.sequence} 完整快照。`
        : `检测到 ${issues.length + skipped.length} 个坏副本，已使用 #${candidate.sequence} 完整快照。`;
    }
    return `已从 #${candidate.sequence} 快照正常恢复。`;
  }
}
