export const SAVE_FORMAT = "arcade-save-envelope/v1";
export const SAVE_SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3];
export const THEMES = ["midnight", "daylight", "system"];
export const REPLAY_OUTCOMES = ["cleared", "retired", "abandoned"];

export class SaveIssue extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SaveIssue";
    this.code = code;
    this.details = details;
  }
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function checksumFor(envelopeFields) {
  const text = stableStringify(envelopeFields);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function envelopeFields(schemaVersion, sequence, savedAt, payload) {
  return { format: SAVE_FORMAT, schemaVersion, sequence, savedAt, payload };
}

export function buildEnvelope({
  schemaVersion = SAVE_SCHEMA_VERSION,
  sequence,
  savedAt,
  payload,
}) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new SaveIssue("invalid-envelope", "快照序号必须是正整数");
  }
  if (!isIsoDate(savedAt)) {
    throw new SaveIssue("invalid-envelope", "快照保存时间无效");
  }
  const fields = envelopeFields(schemaVersion, sequence, savedAt, payload);
  return { ...fields, checksum: checksumFor(fields) };
}

export function parseAndVerifyEnvelope(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new SaveIssue("syntax", "快照不是有效的 JSON");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new SaveIssue("format", "快照 envelope 必须是对象");
  }
  if (envelope.format !== SAVE_FORMAT) {
    throw new SaveIssue("format", "快照格式标识不匹配", {
      schemaVersion: envelope.schemaVersion,
    });
  }
  if (!Number.isInteger(envelope.sequence) || envelope.sequence < 1) {
    throw new SaveIssue("format", "快照序号无效");
  }
  if (!isIsoDate(envelope.savedAt)) {
    throw new SaveIssue("format", "快照保存时间无效");
  }
  if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) {
    throw new SaveIssue("format", "存档 schema 版本无效", {
      schemaVersion: envelope.schemaVersion,
    });
  }
  if (envelope.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SaveIssue(
      "future",
      `存档版本 v${envelope.schemaVersion} 高于当前支持的 v${SAVE_SCHEMA_VERSION}`,
      { schemaVersion: envelope.schemaVersion }
    );
  }
  if (!isPlainObject(envelope.payload)) {
    throw new SaveIssue("format", "快照 payload 必须是对象", {
      schemaVersion: envelope.schemaVersion,
    });
  }
  const expected = checksumFor(
    envelopeFields(
      envelope.schemaVersion,
      envelope.sequence,
      envelope.savedAt,
      envelope.payload
    )
  );
  if (envelope.checksum !== expected) {
    throw new SaveIssue("checksum", "快照校验和不匹配，数据可能已损坏", {
      schemaVersion: envelope.schemaVersion,
    });
  }
  return envelope;
}

export function migrateToCurrent(schemaVersion, payload) {
  const fromVersion = schemaVersion;
  let data = cloneJson(payload);
  const steps = [];
  const warnings = [];

  if (schemaVersion === 1) {
    data = migrateV1ToV2(data, warnings);
    steps.push("v1 → v2");
    schemaVersion = 2;
  }
  if (schemaVersion === 2) {
    data = migrateV2ToV3(data, warnings);
    steps.push("v2 → v3");
    schemaVersion = 3;
  }
  if (schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new SaveIssue("unsupported", `无法迁移存档版本 v${schemaVersion}`);
  }

  const dataErrors = validateCurrentPayload(data);
  if (dataErrors.length > 0) {
    throw new SaveIssue("invalid-data", dataErrors.join("；"));
  }
  return { data, fromVersion, steps, warnings };
}

export function validateCurrentPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) {
    return ["存档数据必须是对象"];
  }
  const progress = payload.progress;
  const settings = payload.settings;
  const replay = payload.replaySummary;

  if (!isPlainObject(progress)) {
    errors.push("progress 缺失");
  } else {
    if (typeof progress.playerName !== "string" || progress.playerName.trim().length === 0) {
      errors.push("playerName 不能为空");
    } else if (progress.playerName.trim().length > 24) {
      errors.push("playerName 不能超过 24 个字符");
    }
    checkInteger(errors, progress.level, "level", 1, 999);
    checkInteger(errors, progress.score, "score", 0, 99999999);
    checkInteger(errors, progress.playTimeSeconds, "playTimeSeconds", 0, 9999999);
  }

  if (!isPlainObject(settings)) {
    errors.push("settings 缺失");
  } else {
    checkInteger(errors, settings.musicVolume, "musicVolume", 0, 100);
    checkInteger(errors, settings.sfxVolume, "sfxVolume", 0, 100);
    if (!THEMES.includes(settings.theme)) {
      errors.push(`theme 必须是 ${THEMES.join("/")}`);
    }
    if (typeof settings.reducedMotion !== "boolean") {
      errors.push("reducedMotion 必须是布尔值");
    }
  }

  if (!isPlainObject(replay)) {
    errors.push("replaySummary 缺失");
  } else {
    if (typeof replay.id !== "string" || replay.id.trim().length === 0) {
      errors.push("replaySummary.id 不能为空");
    }
    if (!isIsoDate(replay.playedAt)) {
      errors.push("replaySummary.playedAt 必须是 ISO 时间");
    }
    checkInteger(errors, replay.durationSeconds, "replaySummary.durationSeconds", 0, 9999999);
    checkInteger(errors, replay.score, "replaySummary.score", 0, 99999999);
    checkInteger(errors, replay.events, "replaySummary.events", 0, 9999999);
    if (!REPLAY_OUTCOMES.includes(replay.outcome)) {
      errors.push(`replaySummary.outcome 必须是 ${REPLAY_OUTCOMES.join("/")}`);
    }
  }
  return errors;
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function migrateV1ToV2(legacy, warnings) {
  if (
    !isPlainObject(legacy.game) ||
    !isPlainObject(legacy.sound) ||
    !isPlainObject(legacy.replay)
  ) {
    throw new SaveIssue("invalid-data", "v1 存档缺少 game/sound/replay 结构");
  }
  const music = boundedInteger(legacy.sound.music, 70);
  const effects = boundedInteger(legacy.sound.effects, 70);
  if (music !== legacy.sound.music || effects !== legacy.sound.effects) {
    warnings.push("v1 音量超出范围，已收紧到 0–100");
  }
  if (!isIsoDate(legacy.replay.recordedAt)) {
    warnings.push("v1 回放时间缺失或无效，已使用当前时间");
  }
  return {
    progress: {
      playerName: legacy.game.playerName,
      level: legacy.game.level,
      score: legacy.game.score,
      playTimeSeconds: legacy.replay.durationSeconds,
    },
    settings: { musicVolume: music, sfxVolume: effects, theme: "system" },
    replaySummary: {
      id: `legacy-v1-${legacy.replay.durationSeconds}-${legacy.replay.score}`,
      playedAt: isIsoDate(legacy.replay.recordedAt)
        ? legacy.replay.recordedAt
        : new Date(0).toISOString(),
      durationSeconds: legacy.replay.durationSeconds,
      score: legacy.replay.score,
      outcome: "cleared",
    },
  };
}

function migrateV2ToV3(v2, warnings) {
  if (!isPlainObject(v2.settings) || !isPlainObject(v2.replaySummary)) {
    throw new SaveIssue("invalid-data", "v2 存档缺少 settings/replaySummary 结构");
  }
  if (typeof v2.settings.reducedMotion !== "boolean") {
    v2.settings.reducedMotion = false;
    warnings.push("v2 缺少 reducedMotion，已默认关闭");
  }
  if (!Number.isInteger(v2.replaySummary.events)) {
    v2.replaySummary.events = 0;
    warnings.push("v2 回放摘要缺少 event 数，已默认 0");
  }
  return v2;
}

function checkInteger(errors, value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${field} 必须是 ${min}–${max} 的整数`);
  }
}

function boundedInteger(value, fallback) {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
