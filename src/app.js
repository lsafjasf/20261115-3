import {
  SAVE_SCHEMA_VERSION,
  validateCurrentPayload,
} from "./save-schema.js";
import { LocalSaveStore } from "./save-store.js";
import {
  corruptLatestSnapshot,
  ensureSnapshotHistory,
  makeLegacyV2Payload,
  simulateInterruptedWrite,
} from "./save-simulation.js";

const $ = (selector) => document.querySelector(selector);
const nodes = {
  form: $("#save-form"),
  alert: $("#alert"),
  alertTitle: $("#alert-title"),
  alertText: $("#alert-text"),
  migrateButton: $("#migrate-button"),
  storagePill: $("#storage-pill"),
  timeline: $("#timeline"),
  eventLog: $("#event-log"),
  saveButton: $("#save-button"),
  music: $("#music"),
  sfx: $("#sfx"),
  musicOutput: $("#music-output"),
  sfxOutput: $("#sfx-output"),
};

let store;
let lastLoad = null;
let replayPlayedAt = new Date().toISOString();
let logEntries = [];

function defaultData() {
  const now = new Date();
  replayPlayedAt = now.toISOString();
  return {
    progress: {
      playerName: "LIN",
      level: 7,
      score: 3200,
      playTimeSeconds: 1280,
    },
    settings: {
      musicVolume: 62,
      sfxVolume: 84,
      theme: "midnight",
      reducedMotion: false,
    },
    replaySummary: {
      id: `replay-${now.toISOString().slice(0, 10).replaceAll("-", "")}-001`,
      playedAt: replayPlayedAt,
      durationSeconds: 346,
      score: 3200,
      events: 512,
      outcome: "cleared",
    },
  };
}

function applyData(data) {
  $("#player-name").value = data.progress.playerName;
  $("#level").value = data.progress.level;
  $("#score").value = data.progress.score;
  $("#play-time").value = data.progress.playTimeSeconds;
  nodes.music.value = data.settings.musicVolume;
  nodes.sfx.value = data.settings.sfxVolume;
  $("#theme").value = data.settings.theme;
  $("#reduced-motion").checked = data.settings.reducedMotion;
  $("#replay-id").value = data.replaySummary.id;
  $("#replay-duration").value = data.replaySummary.durationSeconds;
  $("#replay-events").value = data.replaySummary.events;
  $("#replay-outcome").value = data.replaySummary.outcome;
  $("#replay-score").value = data.replaySummary.score;
  replayPlayedAt = data.replaySummary.playedAt;
  updateRangeOutputs();
}

function readFormData() {
  const data = {
    progress: {
      playerName: $("#player-name").value.trim(),
      level: Number($("#level").value),
      score: Number($("#score").value),
      playTimeSeconds: Number($("#play-time").value),
    },
    settings: {
      musicVolume: Number(nodes.music.value),
      sfxVolume: Number(nodes.sfx.value),
      theme: $("#theme").value,
      reducedMotion: $("#reduced-motion").checked,
    },
    replaySummary: {
      id: $("#replay-id").value.trim(),
      playedAt: replayPlayedAt,
      durationSeconds: Number($("#replay-duration").value),
      score: Number($("#replay-score").value),
      events: Number($("#replay-events").value),
      outcome: $("#replay-outcome").value,
    },
  };
  const errors = validateCurrentPayload(data);
  setFormError(errors.join("；"));
  return errors.length === 0 ? data : null;
}

function setFormError(message) {
  let errorNode = $("#form-error");
  if (!errorNode) {
    errorNode = document.createElement("p");
    errorNode.id = "form-error";
    errorNode.className = "form-error";
    nodes.saveButton.before(errorNode);
  }
  errorNode.hidden = !message;
  errorNode.textContent = message;
}

function updateRangeOutputs() {
  for (const [input, output] of [
    [nodes.music, nodes.musicOutput],
    [nodes.sfx, nodes.sfxOutput],
  ]) {
    const value = Number(input.value);
    output.textContent = String(value);
    input.style.setProperty("--range-fill", `${value}%`);
  }
}

function setBanner(tone, title, text, { showMigrate = false } = {}) {
  nodes.alert.className = `alert ${tone}`;
  nodes.alertTitle.textContent = title;
  nodes.alertText.textContent = text;
  nodes.migrateButton.hidden = !showMigrate;
}

function setStoragePill(tone, text) {
  nodes.storagePill.className = `status-pill ${tone}`;
  nodes.storagePill.textContent = text;
}

function formatTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function addLog(kind, text, tone = "info") {
  logEntries.unshift({
    at: new Date(),
    kind,
    text,
    tone,
  });
  logEntries = logEntries.slice(0, 40);
  renderLog();
}

function renderLog() {
  nodes.eventLog.replaceChildren();
  if (logEntries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "event-log-empty";
    empty.textContent = "暂无操作。";
    nodes.eventLog.append(empty);
    return;
  }
  for (const entry of logEntries) {
    const item = document.createElement("li");
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = entry.at.toLocaleTimeString("zh-CN", { hour12: false });
    const kind = document.createElement("span");
    kind.className = `log-kind ${entry.tone}`;
    kind.textContent = entry.kind;
    const text = document.createElement("span");
    text.textContent = entry.text;
    item.append(time, kind, text);
    nodes.eventLog.append(item);
  }
}

function renderTimeline(loadResult = lastLoad) {
  const inspection = store.inspect();
  const snapshotBySlot = new Map(
    inspection.snapshots.map((snapshot) => [snapshot.slot, snapshot])
  );
  const issueBySlot = new Map(inspection.issues.map((issue) => [issue.slot, issue]));
  const skippedBySlot = new Map(
    (loadResult?.skipped ?? []).map((item) => [item.slot, item])
  );
  const stateBySlot = new Map(
    inspection.slotStates.map((state) => [state.slot, state.state])
  );
  const latest = inspection.snapshots[0] ?? null;
  const sourceSlot = loadResult?.source?.slot ?? null;
  const fragment = document.createDocumentFragment();

  for (const slot of store.slotIds) {
    const snapshot = snapshotBySlot.get(slot);
    const issue = issueBySlot.get(slot);
    const skipped = skippedBySlot.get(slot);
    const state = stateBySlot.get(slot) ?? "empty";
    const article = document.createElement("article");
    article.className = `slot ${skipped ? "invalid" : state}`;
    if (slot === sourceSlot) {
      article.classList.add("active");
    }

    const index = document.createElement("div");
    index.className = "slot-index";
    index.textContent = slot.toUpperCase();

    const body = document.createElement("div");
    body.className = "slot-body";
    const topline = document.createElement("div");
    topline.className = "slot-topline";
    const title = document.createElement("span");
    title.className = "slot-title";
    title.textContent = snapshot
      ? `快照 #${snapshot.sequence}`
      : state === "invalid"
        ? "不可用副本"
        : "空槽位";
    topline.append(title);

    if (snapshot && snapshot.slot === latest?.slot && !skipped) {
      topline.append(tag("最新完整", "latest"));
    }
    if (snapshot && snapshot.slot === sourceSlot) {
      topline.append(tag("本次读取", "source"));
    }
    if (issue) {
      topline.append(tag(issueCodeLabel(issue.code), "bad"));
    } else if (skipped) {
      topline.append(tag("迁移校验失败", "bad"));
    }

    const meta = document.createElement("p");
    meta.className = "slot-meta";
    if (snapshot) {
      const base = `SCHEMA v${snapshot.schemaVersion} · ${formatTime(
        snapshot.savedAt
      )} · ${snapshot.bytes} B`;
      meta.textContent = skipped ? `${base} · ${skipped.message}` : base;
    } else if (issue) {
      meta.textContent = issue.message;
    } else if (skipped) {
      meta.textContent = skipped.message;
    } else {
      meta.textContent = "等待下一次写入";
    }

    const dataLine = document.createElement("p");
    dataLine.className = "slot-data";
    if (snapshot && skipped) {
      dataLine.textContent = "读取时已跳过，业务字段不合法";
    } else if (snapshot) {
      const progress = snapshot.payload.progress ?? snapshot.payload.game;
      const replay =
        snapshot.payload.replaySummary ?? snapshot.payload.replay ?? {};
      const level = progress?.level ?? "?";
      const score = progress?.score ?? replay.score ?? "?";
      dataLine.append(
        document.createTextNode(`Lv.${level}  `),
        strong(String(score)),
        document.createTextNode(` 分 · 回放 ${replay.durationSeconds ?? "?"}s`)
      );
    } else {
      dataLine.textContent = state === "invalid" ? "读取时已安全隔离" : "—";
    }

    body.append(topline, meta, dataLine);
    const stateLabel = document.createElement("span");
    stateLabel.className = "slot-state";
    stateLabel.textContent =
      skipped || state === "invalid" ? "INVALID" : state === "complete" ? "VALID" : "EMPTY";
    article.append(index, body, stateLabel);
    fragment.append(article);
  }
  nodes.timeline.replaceChildren(fragment);
}

function tag(text, variant) {
  const element = document.createElement("span");
  element.className = `slot-tag ${variant}`;
  element.textContent = text;
  return element;
}

function strong(text) {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
}

function issueCodeLabel(code) {
  return (
    {
      syntax: "JSON 破损",
      checksum: "校验失败",
      invalid: "结构非法",
      future: "版本过高",
      format: "格式错误",
      read: "读取失败",
    }[code] ?? "不可用"
  );
}

function renderLoad(result) {
  lastLoad = result;
  if (!result.ok) {
    setBanner("error", "没有可安全恢复的存档", result.message);
    setStoragePill("error", "存档不可读");
    renderTimeline(result);
    return;
  }

  applyData(result.data);
  const sourceText = `快照 #${result.source.sequence} · SCHEMA v${result.source.schemaVersion}`;
  if (result.migration) {
    const warnings = result.migration.warnings;
    const warningText = warnings.length
      ? ` 迁移说明：${warnings.join("；")}。`
      : "";
    setBanner(
      "warn",
      `检测到旧版 v${result.migration.fromVersion} 存档`,
      `${sourceText}，迁移链 ${result.migration.steps.join(
        "，"
      )}。${warningText} 原快照仍保留，确认后再写入 v${SAVE_SCHEMA_VERSION}。`,
      { showMigrate: true }
    );
    setStoragePill("warn", `待迁移 · v${result.migration.fromVersion} → v${SAVE_SCHEMA_VERSION}`);
  } else if (result.recovered) {
    setBanner(
      "warn",
      "检测到损坏副本，已自动回退",
      `${result.message} 当前使用 ${sourceText}，游戏数据未丢失。`,
      { showMigrate: false }
    );
    setStoragePill("warn", `已回退 · #${result.source.sequence}`);
  } else {
    setBanner(
      "ok",
      "完整快照读取成功",
      `${result.message} 当前使用 ${sourceText}。`,
      { showMigrate: false }
    );
    setStoragePill("ok", `正常 · #${result.source.sequence}`);
  }
  renderTimeline(result);
}

function handleSave(event) {
  event.preventDefault();
  const data = readFormData();
  if (!data) {
    addLog("VALIDATE", "表单校验失败，未执行任何写入", "error");
    return;
  }
  try {
    const written = store.save(data);
    const loaded = store.load();
    renderLoad(loaded);
    if (loaded.ok && !loaded.recovered && !loaded.migration) {
      setBanner(
        "ok",
        "快照写入并校验成功",
        `新快照 #${written.sequence} 已写入 ${written.slot.toUpperCase()} 槽；读取验证通过，上一份完整副本仍保留。`
      );
      setStoragePill("ok", `正常 · #${loaded.source.sequence}`);
    }
    addLog(
      "WRITE",
      `#${written.sequence} → ${written.slot.toUpperCase()} 槽，回读校验通过`,
      "info"
    );
  } catch (error) {
    setBanner(
      "error",
      "写入失败，旧存档未受影响",
      `${error.message} 可以重新扫描并恢复最近完整快照。`
    );
    setStoragePill("error", "写入失败");
    renderTimeline();
    addLog("WRITE", error.message, "error");
  }
}

function handleNormalRecovery() {
  const result = store.load();
  renderLoad(result);
  if (result.ok) {
    setBanner(
      "ok",
      "正常恢复完成",
      `${result.message} 已载入快照 #${result.source.sequence}，没有跳过快照。`
    );
    addLog("LOAD", `正常读取 #${result.source.sequence}，状态 VALID`, "info");
  } else {
    addLog("LOAD", result.message, "error");
  }
}

function handleCorruption() {
  const data = readFormData();
  if (!data) {
    return;
  }
  try {
    ensureSnapshotHistory(store, data, 2);
    const damaged = corruptLatestSnapshot(store);
    const result = store.load();
    renderLoad(result);
    if (result.ok) {
      setBanner(
        "warn",
        "损坏演练：已回退，未丢失进度",
        `故意破坏了快照 #${damaged.sequence}（${damaged.slot.toUpperCase()} 槽）的 payload。校验和检测成功，现回退到 #${result.source.sequence}。`
      );
      setStoragePill("warn", `已回退 · #${result.source.sequence}`);
      addLog(
        "CORRUPT",
        `#${damaged.sequence} 校验失败 → 回退 #${result.source.sequence}`,
        "warn"
      );
    } else {
      addLog("CORRUPT", "损坏后没有可恢复快照", "error");
    }
  } catch (error) {
    setBanner("error", "损坏演练未执行", error.message);
    addLog("CORRUPT", error.message, "error");
  }
}

function handleInterruptedWrite() {
  const data = readFormData();
  if (!data) {
    return;
  }
  try {
    const interrupted = simulateInterruptedWrite(store, data);
    const result = store.load();
    renderLoad(result);
    if (!interrupted.interrupted) {
      throw new Error("故障注入未触发");
    }
    if (result.ok) {
      setBanner(
        "warn",
        "中断演练：只留下残缺副本",
        `快照 #${interrupted.sequence} 在写入 ${interrupted.slot?.toUpperCase()} 槽时被截断。读取已跳过该副本，回退到 #${result.source.sequence}。`
      );
      setStoragePill("warn", `已回退 · #${result.source.sequence}`);
      addLog(
        "INTERRUPT",
        `#${interrupted.sequence} 截断 → 回退 #${result.source.sequence}`,
        "warn"
      );
    }
  } catch (error) {
    setBanner("error", "中断演练失败", error.message);
    addLog("INTERRUPT", error.message, "error");
  }
}

function handleVersionUpgrade() {
  const data = readFormData();
  if (!data) {
    return;
  }
  try {
    const written = store.saveLegacySnapshot(2, makeLegacyV2Payload(data));
    const result = store.load();
    renderLoad(result);
    addLog(
      "UPGRADE",
      `写入有效 v2 快照 #${written.sequence}，等待迁移确认`,
      "warn"
    );
  } catch (error) {
    setBanner("error", "版本升级演练失败", error.message);
    addLog("UPGRADE", error.message, "error");
  }
}

function handleMigrationWrite() {
  if (!lastLoad?.migration) {
    return;
  }
  const fromVersion = lastLoad.migration.fromVersion;
  try {
    const written = store.save(lastLoad.data);
    const result = store.load();
    renderLoad(result);
    if (result.ok && !result.migration) {
      setBanner(
        "ok",
        "迁移完成，旧版本仍保留",
        `v${fromVersion} 数据已迁移并写入 v${SAVE_SCHEMA_VERSION} 快照 #${written.sequence}；旧快照没有被删除，可按槽位轮换回收。`
      );
      setStoragePill("ok", `已迁移 · v${SAVE_SCHEMA_VERSION}`);
      addLog(
        "MIGRATE",
        `v${fromVersion} → v${SAVE_SCHEMA_VERSION}，写入 #${written.sequence}`,
        "info"
      );
    }
  } catch (error) {
    setBanner("error", "迁移写入失败", `${error.message} 旧版本快照仍在本地。`);
    addLog("MIGRATE", error.message, "error");
  }
}

function handleRefresh() {
  renderTimeline(lastLoad);
  const inspection = store.inspect();
  addLog(
    "SCAN",
    `扫描到 ${inspection.snapshots.length} 份完整快照、${inspection.issues.length} 个异常槽`,
    inspection.issues.length ? "warn" : "info"
  );
}

function init() {
  applyData(defaultData());
  nodes.form.addEventListener("submit", handleSave);
  for (const input of [nodes.music, nodes.sfx]) {
    input.addEventListener("input", updateRangeOutputs);
  }
  $("#normal-button").addEventListener("click", handleNormalRecovery);
  $("#corrupt-button").addEventListener("click", handleCorruption);
  $("#interrupt-button").addEventListener("click", handleInterruptedWrite);
  $("#upgrade-button").addEventListener("click", handleVersionUpgrade);
  nodes.migrateButton.addEventListener("click", handleMigrationWrite);
  $("#refresh-button").addEventListener("click", handleRefresh);
  $("#clear-log-button").addEventListener("click", () => {
    logEntries = [];
    renderLog();
  });

  try {
    const probeKey = "arcade-archive-v1:__probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    store = new LocalSaveStore(window.localStorage, { now: () => new Date() });
    renderLog();
    const result = store.load();
    if (result.ok) {
      renderLoad(result);
      addLog(
        "BOOT",
        result.migration
          ? `检测到 v${result.migration.fromVersion} 存档，等待迁移`
          : `启动读取 #${result.source.sequence}`,
        result.migration ? "warn" : "info"
      );
    } else if (result.status === "error") {
      renderLoad(result);
      addLog("BOOT", result.message, "error");
    } else {
      setBanner(
        "neutral",
        "本地暂无存档",
        "当前表单是可编辑的初始数据。点击“写入新快照”创建第一份带校验和的存档。"
      );
      setStoragePill("neutral", "空存档");
      renderTimeline(null);
      addLog("BOOT", "未发现现有快照", "info");
    }
  } catch (error) {
    setBanner(
      "error",
      "本地存储不可用",
      `${error.message} 请确认浏览器允许 localStorage，且不是受限的隐私模式。`
    );
    setStoragePill("error", "存储不可用");
    nodes.saveButton.disabled = true;
    for (const button of document.querySelectorAll(".drill-card")) {
      button.disabled = true;
    }
    renderLog();
  }
}

init();
