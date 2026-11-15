import { importProjectText } from "./src/project-importer.js";
import { stringifyProjectDocument } from "./src/project-export.js";
import { LIMITS, SCHEMA_VERSION } from "./src/schema.js";

const MAX_ISSUES_SHOWN = 80;
const MAX_ROWS_SHOWN = 200;
const MAX_UNKNOWN_SHOWN = 50;

const elements = {
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  chooseButton: document.querySelector("#chooseButton"),
  demoButton: document.querySelector("#demoButton"),
  fixtureStrip: document.querySelector(".fixture-strip"),
  outcomePanel: document.querySelector("#outcomePanel"),
  outcomeIcon: document.querySelector("#outcomeIcon"),
  outcomeKicker: document.querySelector("#outcomeKicker"),
  outcomeTitle: document.querySelector("#outcomeTitle"),
  outcomeDetail: document.querySelector("#outcomeDetail"),
  issueLists: document.querySelector("#issueLists"),
  clearButton: document.querySelector("#clearButton"),
  projectPanel: document.querySelector("#projectPanel"),
  projectKicker: document.querySelector("#projectKicker"),
  projectTitle: document.querySelector("#projectTitle"),
  projectDescription: document.querySelector("#projectDescription"),
  exportButton: document.querySelector("#exportButton"),
  summaryGrid: document.querySelector("#summaryGrid"),
  projectMeta: document.querySelector("#projectMeta"),
  nodesHeading: document.querySelector("#nodesHeading"),
  nodesCount: document.querySelector("#nodesCount"),
  nodesTable: document.querySelector("#nodesTable"),
  edgesCount: document.querySelector("#edgesCount"),
  edgesTable: document.querySelector("#edgesTable"),
  assetsCount: document.querySelector("#assetsCount"),
  assetsTable: document.querySelector("#assetsTable"),
  unknownSection: document.querySelector("#unknownSection"),
  unknownCount: document.querySelector("#unknownCount"),
  unknownList: document.querySelector("#unknownList")
};

const state = {
  project: null,
  unknownFields: [],
  sourceName: "",
  lastSuccessfulAt: null
};

function makeElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "未知大小";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function safePreview(value, maximumLength = 140) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return String(value);
    }
    return serialized.length > maximumLength
      ? `${serialized.slice(0, maximumLength - 3)}...`
      : serialized;
  } catch {
    return "[无法序列化的值]";
  }
}

function makeIssueList(issues, isWarning) {
  const list = makeElement("ul", "issue-list");
  for (const issue of issues.slice(0, MAX_ISSUES_SHOWN)) {
    const item = makeElement(
      "li",
      `issue${isWarning ? " warning" : ""}`
    );
    item.append(
      makeElement("code", "issue-code", issue.code),
      makeElement("code", "issue-path", issue.path ?? "$"),
      makeElement("span", "issue-message", issue.message)
    );

    const supplementary = [];
    if (issue.line !== undefined) {
      supplementary.push(`line ${issue.line}, column ${issue.column}`);
    }
    if (issue.expected !== undefined) {
      supplementary.push(`expected: ${issue.expected}`);
    }
    if (issue.actual !== undefined) {
      supplementary.push(`actual: ${issue.actual}`);
    }
    if (issue.hint) {
      supplementary.push(`hint: ${issue.hint}`);
    }
    if (issue.snippet) {
      supplementary.push(issue.snippet);
    }
    if (supplementary.length > 0) {
      item.append(
        makeElement("pre", "issue-extra", supplementary.join("\n"))
      );
    }
    list.append(item);
  }
  return list;
}

function makeIssueGroup(title, issues, isWarning) {
  const group = makeElement(
    "section",
    `issue-group${isWarning ? " warning-group" : ""}`
  );
  const heading = makeElement("div", "issue-group-heading");
  heading.append(
    makeElement("strong", "", title),
    makeElement("b", "", `${issues.length} 条`)
  );
  group.append(heading, makeIssueList(issues, isWarning));
  if (issues.length > MAX_ISSUES_SHOWN) {
    group.append(
      makeElement(
        "p",
        "more-note",
        `另有 ${issues.length - MAX_ISSUES_SHOWN} 条未在页面展开。`
      )
    );
  }
  return group;
}

function showOutcome({ result, fileName, bytes }) {
  const isSuccess = result.ok;
  elements.outcomePanel.hidden = false;
  elements.outcomePanel.classList.toggle("is-success", isSuccess);
  elements.outcomePanel.classList.toggle("is-error", !isSuccess);
  elements.outcomeIcon.textContent = isSuccess ? "✓" : "!";
  elements.outcomeKicker.textContent = `${fileName} · ${formatBytes(bytes)}`;
  elements.outcomeTitle.textContent = isSuccess
    ? "导入成功，工程已完整恢复"
    : "导入被拒绝，当前工程未改变";

  const counts = result.stats?.counts;
  elements.outcomeDetail.textContent = isSuccess
    ? `${counts.nodes} 个节点、${counts.edges} 条连线、${counts.assets} 个资源；${
        result.unknownFields.length
      } 个未知字段已保留。`
    : `发现 ${result.errors.length} 个错误、${result.warnings.length} 个警告。请按路径修正后重新导入。`;

  elements.issueLists.replaceChildren();
  if (result.errors.length > 0) {
    elements.issueLists.append(
      makeIssueGroup("错误", result.errors, false)
    );
  }
  if (result.warnings.length > 0) {
    elements.issueLists.append(
      makeIssueGroup("警告与保留字段", result.warnings, true)
    );
  }
}

function makeTable(columns, rows, emptyMessage) {
  const fragment = document.createDocumentFragment();
  if (rows.length === 0) {
    fragment.append(makeElement("p", "empty-state", emptyMessage));
    return fragment;
  }

  const table = makeElement("table", "data-table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    headRow.append(makeElement("th", "", column.label));
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const row of rows.slice(0, MAX_ROWS_SHOWN)) {
    const tableRow = document.createElement("tr");
    columns.forEach((column, index) => {
      const cell = makeElement("td");
      const value = row[index];
      if (column.code) {
        cell.append(makeElement("code", "", String(value ?? "")));
      } else {
        cell.textContent = String(value ?? "");
      }
      tableRow.append(cell);
    });
    body.append(tableRow);
  }
  table.append(head, body);
  fragment.append(table);
  if (rows.length > MAX_ROWS_SHOWN) {
    fragment.append(
      makeElement(
        "p",
        "more-note",
        `仅展示前 ${MAX_ROWS_SHOWN} 条，共 ${rows.length} 条；导出文件包含全部数据。`
      )
    );
  }
  return fragment;
}

function makeMetaChip(label, value) {
  const chip = makeElement("span", "meta-chip");
  chip.append(document.createTextNode(`${label} `));
  chip.append(makeElement("strong", "", String(value)));
  return chip;
}

function makeSummaryCard(label, value) {
  const card = makeElement("div", "summary-card");
  card.append(
    makeElement("dt", "", label),
    makeElement("dd", "", String(value))
  );
  return card;
}

function renderProject({ preserved = false } = {}) {
  if (state.project === null) {
    elements.projectPanel.hidden = true;
    elements.exportButton.disabled = true;
    return;
  }

  const project = state.project;
  elements.projectPanel.hidden = false;
  elements.exportButton.disabled = false;
  elements.projectKicker.textContent = preserved
    ? "LAST SUCCESSFUL IMPORT"
    : "CURRENT PROJECT";
  elements.projectTitle.textContent = project.name;
  elements.projectDescription.textContent =
    project.description || "该工程没有描述。";

  elements.summaryGrid.replaceChildren(
    makeSummaryCard("Nodes", project.nodes.length),
    makeSummaryCard("Edges", project.edges.length),
    makeSummaryCard("Assets", project.assets.length),
    makeSummaryCard("Unknown fields", state.unknownFields.length)
  );

  elements.projectMeta.replaceChildren(
    makeMetaChip("ID", project.id),
    makeMetaChip("Schema", `v${SCHEMA_VERSION}`),
    makeMetaChip("Updated", project.updatedAt ?? "未记录"),
    makeMetaChip("Theme", project.settings.theme),
    makeMetaChip("Autosave", project.settings.autosave ? "on" : "off"),
    makeMetaChip("Grid", project.settings.gridSize),
    makeMetaChip("Snap", project.settings.snapToGrid ? "on" : "off"),
    makeMetaChip("Locale", project.settings.locale)
  );

  elements.nodesCount.textContent = String(project.nodes.length);
  elements.nodesTable.replaceChildren(
    makeTable(
      [
        { label: "ID", code: true },
        { label: "类型" },
        { label: "标题" },
        { label: "位置" },
        { label: "尺寸" },
        { label: "标签" },
        { label: "Data" }
      ],
      project.nodes.map((node) => [
        node.id,
        node.type,
        node.title,
        `${node.x}, ${node.y}`,
        `${node.width} × ${node.height}`,
        node.tags.join(", "),
        safePreview(node.data, 70)
      ]),
      "没有节点。"
    )
  );

  elements.edgesCount.textContent = String(project.edges.length);
  elements.edgesTable.replaceChildren(
    makeTable(
      [
        { label: "ID", code: true },
        { label: "From" },
        { label: "To" },
        { label: "Label" },
        { label: "Data" }
      ],
      project.edges.map((edge) => [
        edge.id,
        edge.from,
        edge.to,
        edge.label,
        safePreview(edge.data, 70)
      ]),
      "没有连线。"
    )
  );

  elements.assetsCount.textContent = String(project.assets.length);
  elements.assetsTable.replaceChildren(
    makeTable(
      [
        { label: "ID", code: true },
        { label: "名称" },
        { label: "类型" },
        { label: "路径" },
        { label: "大小" },
        { label: "Metadata" }
      ],
      project.assets.map((asset) => [
        asset.id,
        asset.name,
        asset.kind,
        asset.path,
        formatBytes(asset.sizeBytes),
        safePreview(asset.metadata, 70)
      ]),
      "没有资源。"
    )
  );

  renderUnknownFields();
}

function renderUnknownFields() {
  const fields = state.unknownFields;
  elements.unknownSection.hidden = fields.length === 0;
  elements.unknownCount.textContent = String(fields.length);
  elements.unknownList.replaceChildren();

  for (const field of fields.slice(0, MAX_UNKNOWN_SHOWN)) {
    const entry = makeElement("div", "unknown-entry");
    entry.append(
      makeElement("code", "", field.path),
      makeElement("pre", "", safePreview(field.value, 240))
    );
    elements.unknownList.append(entry);
  }
  if (fields.length > MAX_UNKNOWN_SHOWN) {
    elements.unknownList.append(
      makeElement(
        "p",
        "more-note",
        `另有 ${fields.length - MAX_UNKNOWN_SHOWN} 个未知字段未展开。`
      )
    );
  }
}

function clientFailure({ code, message, fileName, bytes = 0, hint }) {
  return {
    ok: false,
    project: null,
    errors: [
      {
        severity: "error",
        layer: "input",
        code,
        path: "$",
        message,
        ...(hint ? { hint } : {})
      }
    ],
    warnings: [],
    unknownFields: [],
    stats: { bytes, counts: null }
  };
}

function handleImportResult(result, fileName, bytes) {
  if (result.ok) {
    state.project = result.project;
    state.unknownFields = result.unknownFields;
    state.sourceName = fileName;
    state.lastSuccessfulAt = new Date();
    renderProject();
  } else if (state.project !== null) {
    renderProject({ preserved: true });
  }
  showOutcome({ result, fileName, bytes });
}

function importText(text, fileName, knownBytes) {
  let result;
  try {
    result = importProjectText(text);
  } catch {
    result = clientFailure({
      code: "IMPORT_FAILED",
      message: "导入器遇到未预期错误，页面和当前工程均未受影响。",
      fileName,
      bytes: knownBytes
    });
  }
  handleImportResult(result, fileName, result.stats?.bytes ?? knownBytes);
}

async function importFile(file) {
  if (!(file instanceof File)) {
    return;
  }
  if (file.size > LIMITS.sourceBytes) {
    const result = clientFailure({
      code: "SOURCE_TOO_LARGE",
      message: `文件为 ${formatBytes(file.size)}，超过 ${
        LIMITS.sourceBytes / 1024 / 1024
      } MB 上限，已在读取前阻止。`,
      fileName: file.name,
      bytes: file.size,
      hint: "请拆分工程或移除不必要的内嵌数据。"
    });
    if (state.project !== null) {
      renderProject({ preserved: true });
    }
    showOutcome({ result, fileName: file.name, bytes: file.size });
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch {
    const result = clientFailure({
      code: "FILE_READ_FAILED",
      message: "无法读取该文件，请检查文件权限后重试。",
      fileName: file.name,
      bytes: file.size
    });
    showOutcome({ result, fileName: file.name, bytes: file.size });
    return;
  }
  importText(text, file.name, file.size);
}

async function loadFixture(fileName) {
  const buttons = [elements.demoButton, ...document.querySelectorAll(".fixture-chip")];
  for (const button of buttons) {
    button.disabled = true;
  }
  try {
    const response = await fetch(`./fixtures/${fileName}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    importText(text, fileName, new Blob([text]).size);
  } catch {
    const result = clientFailure({
      code: "FIXTURE_LOAD_FAILED",
      message: "无法加载样例，请通过 npm start 启动本地服务后重试。",
      fileName,
      bytes: 0,
      hint: "直接双击 index.html 时浏览器可能阻止读取 fixtures。"
    });
    showOutcome({ result, fileName, bytes: 0 });
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
  }
}

function downloadCurrentProject() {
  if (state.project === null) {
    return;
  }
  try {
    const text = stringifyProjectDocument(
      state.project,
      state.unknownFields
    );
    const blob = new Blob([text], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const safeId = state.project.id.replace(/[^\w.-]+/g, "-") || "project";
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `${safeId}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  } catch {
    const result = clientFailure({
      code: "EXPORT_FAILED",
      message: "导出失败，当前工程仍保留在页面中。",
      fileName: `${state.project.id}.json`,
      bytes: 0
    });
    showOutcome({
      result,
      fileName: `${state.project.id}.json`,
      bytes: 0
    });
    elements.outcomeTitle.textContent = "导出失败，当前工程未改变";
  }
}

function clearWorkspace() {
  state.project = null;
  state.unknownFields = [];
  state.sourceName = "";
  state.lastSuccessfulAt = null;
  elements.projectPanel.hidden = true;
  elements.outcomePanel.hidden = true;
  elements.exportButton.disabled = true;
  elements.fileInput.value = "";
}

elements.chooseButton.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.fileInput.click();
});

elements.demoButton.addEventListener("click", (event) => {
  event.stopPropagation();
  loadFixture("valid-project.json");
});

elements.dropZone.addEventListener("click", (event) => {
  if (!event.target.closest("button")) {
    elements.fileInput.click();
  }
});

elements.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});

elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) {
    importFile(file);
  }
  elements.fileInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    elements.dropZone.classList.add("is-dragging");
  });
}

elements.dropZone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  if (!elements.dropZone.contains(event.relatedTarget)) {
    elements.dropZone.classList.remove("is-dragging");
  }
});

elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  elements.dropZone.classList.remove("is-dragging");
  const [file] = event.dataTransfer.files;
  if (file) {
    importFile(file);
  }
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

elements.fixtureStrip.addEventListener("click", (event) => {
  const button = event.target.closest("[data-fixture]");
  if (button) {
    loadFixture(button.dataset.fixture);
  }
});

elements.clearButton.addEventListener("click", clearWorkspace);
elements.exportButton.addEventListener("click", downloadCurrentProject);

document.documentElement.dataset.ready = "true";
