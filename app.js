(function () {
  "use strict";

  const state = {
    mapping: Object.assign({}, ChartData.defaultMapping),
    types: Object.assign({}, ChartData.defaultTypes),
    sort: "x",
    labels: true,
    search: "",
    model: null,
    results: { a: null, b: null },
    verification: null,
    feedback: null,
    draggedField: null
  };

  const refs = {
    fieldList: document.getElementById("fieldList"),
    fieldCount: document.getElementById("fieldCount"),
    fieldSearch: document.getElementById("fieldSearch"),
    slotX: document.getElementById("slotX"),
    slotY: document.getElementById("slotY"),
    slotSeries: document.getElementById("slotSeries"),
    xType: document.getElementById("xType"),
    yType: document.getElementById("yType"),
    mappingMessage: document.getElementById("mappingMessage"),
    sortSelect: document.getElementById("sortSelect"),
    labelsToggle: document.getElementById("labelsToggle"),
    chartStageA: document.getElementById("chartStageA"),
    chartStageB: document.getElementById("chartStageB"),
    chartATitle: document.getElementById("chartATitle"),
    chartBTitle: document.getElementById("chartBTitle"),
    chartASubtitle: document.getElementById("chartASubtitle"),
    chartBSubtitle: document.getElementById("chartBSubtitle"),
    legendA: document.getElementById("legendA"),
    legendB: document.getElementById("legendB"),
    missingA: document.getElementById("missingA"),
    missingB: document.getElementById("missingB"),
    verifyCard: document.getElementById("verifyCard"),
    verifyIcon: document.getElementById("verifyIcon"),
    verifyPill: document.getElementById("verifyPill"),
    verifyCopy: document.getElementById("verifyCopy"),
    labelCount: document.getElementById("labelCount"),
    totalA: document.getElementById("totalA"),
    totalB: document.getElementById("totalB"),
    toastRegion: document.getElementById("toastRegion")
  };

  const kindLabels = { quantitative: "数值轴", temporal: "时间轴", nominal: "分类轴" };

  function iconUse(name, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (className) svg.setAttribute("class", className);
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function fieldTypeLabel(field) {
    if (field.type === "number") return "数值";
    if (field.type === "date") return "日期";
    return "文本";
  }

  function completenessText(field) {
    const info = ChartData.completeness(field.id);
    if (!info.missing) return "完整";
    return `缺失 ${info.missing}`;
  }

  function renderFields() {
    refs.fieldList.replaceChildren();
    const search = state.search.trim().toLowerCase();
    const visible = ChartData.fields.filter((field) => field.label.toLowerCase().includes(search));
    refs.fieldCount.textContent = ChartData.fields.length;
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "field-empty";
      empty.textContent = "没有匹配的字段";
      refs.fieldList.appendChild(empty);
      return;
    }
    visible.forEach((field) => {
      const card = document.createElement("div");
      const mapped = Object.values(state.mapping).includes(field.id);
      card.className = `field-card${mapped ? " mapped" : ""}`;
      card.dataset.type = field.type;
      card.dataset.field = field.id;
      card.draggable = true;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `拖拽字段 ${field.label}`);

      const icon = document.createElement("span");
      icon.className = "field-icon";
      icon.appendChild(iconUse(field.icon));
      const name = document.createElement("span");
      name.className = "field-name";
      name.textContent = field.label;
      const meta = document.createElement("span");
      meta.className = "field-meta";
      const type = document.createElement("span");
      type.className = "field-type";
      type.textContent = fieldTypeLabel(field);
      meta.appendChild(type);
      const missing = ChartData.completeness(field.id).missing;
      if (missing) {
        const dot = document.createElement("span");
        dot.className = "missing-dot";
        dot.title = completenessText(field);
        meta.appendChild(dot);
      }
      card.append(icon, name, meta);
      card.addEventListener("dragstart", (event) => {
        state.draggedField = field.id;
        event.dataTransfer.setData("text/plain", field.id);
        event.dataTransfer.effectAllowed = "copy";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        state.draggedField = null;
        card.classList.remove("dragging");
      });
      card.addEventListener("click", () => {
        showToast(`将「${field.label}」拖到 X、Y 或系列槽位。`, "info", "拖拽提示");
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showToast(`将「${field.label}」拖到 X、Y 或系列槽位。`, "info", "拖拽提示");
        }
      });
      refs.fieldList.appendChild(card);
    });
  }

  function renderSlotContent(container, fieldId) {
    container.replaceChildren();
    if (!fieldId) {
      const empty = document.createElement("span");
      empty.className = "empty-slot";
      const plus = document.createElement("span");
      plus.textContent = "+";
      const text = document.createElement("span");
      text.textContent = "拖拽字段到这里";
      empty.append(plus, text);
      container.appendChild(empty);
      return;
    }
    const field = ChartData.getField(fieldId);
    const wrap = document.createElement("div");
    wrap.className = "slot-field";
    const icon = document.createElement("span");
    icon.className = "field-icon";
    icon.appendChild(iconUse(field.icon));
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = field.label;
    const small = document.createElement("small");
    const info = ChartData.completeness(field.id);
    small.textContent = `${fieldTypeLabel(field)} · ${info.missing ? completenessText(field) : "数据完整"}`;
    copy.append(strong, small);
    wrap.append(icon, copy);
    container.appendChild(wrap);
  }

  function renderMapping() {
    const mapping = state.mapping;
    renderSlotContent(refs.slotX, mapping.x);
    renderSlotContent(refs.slotY, mapping.y);
    renderSlotContent(refs.slotSeries, mapping.series);
    document.querySelectorAll(".mapping-slot").forEach((slot) => {
      const name = slot.dataset.slot;
      slot.classList.toggle("has-field", Boolean(mapping[name]));
      const field = ChartData.getField(mapping[name]);
      const invalid = field && (
        (name === "y" && field.type !== "number") ||
        (name === "series" && field.type === "number")
      );
      slot.classList.toggle("invalid", Boolean(invalid));
    });
    refs.xType.textContent = mapping.x ? kindLabels[ChartData.inferFieldKind(mapping.x)] : "未映射";
    refs.yType.textContent = mapping.y ? kindLabels[ChartData.inferFieldKind(mapping.y)] : "未映射";
    const seriesLabel = refs.slotSeries.parentElement.querySelector(".slot-label em");
    seriesLabel.textContent = mapping.series
      ? (ChartData.inferFieldKind(mapping.series) === "quantitative" ? "数值（无效）" : "分类")
      : "可选";
    renderFeedback();
  }

  function renderFeedback() {
    const message = state.feedback;
    refs.mappingMessage.className = "mapping-message";
    refs.mappingMessage.replaceChildren();
    if (!message) return;
    refs.mappingMessage.classList.add("visible", message.type);
    refs.mappingMessage.appendChild(iconUse(message.type === "error" ? "alert" : "spark"));
    const text = document.createElement("span");
    text.textContent = message.text;
    refs.mappingMessage.appendChild(text);
  }

  function setFeedback(text, type, duration) {
    state.feedback = text ? { text, type: type || "info" } : null;
    renderFeedback();
    if (duration && text) {
      clearTimeout(setFeedback.timer);
      setFeedback.timer = setTimeout(() => {
        state.feedback = null;
        renderFeedback();
      }, duration);
    }
  }

  function chartTitle(type) {
    const xField = ChartData.getField(state.mapping.x);
    const yField = ChartData.getField(state.mapping.y);
    const seriesField = ChartData.getField(state.mapping.series);
    const suffix = type === "line" ? "趋势" : type === "bar" ? "对比" : "分布";
    if (seriesField) return `${seriesField.label}${yField ? yField.label : "数值"}${suffix}`;
    if (xField && yField) return `${yField.label}按${xField.label}${suffix}`;
    return ChartRenderer.typeNames[type];
  }

  function chartSubtitle(type) {
    const xField = ChartData.getField(state.mapping.x);
    const yField = ChartData.getField(state.mapping.y);
    if (!xField || !yField) return "等待字段映射";
    const unit = yField.unit ? ` · 单位：${yField.unit}` : "";
    if (type === "scatter") return `${xField.label} × ${yField.label}${unit}`;
    const aggregation = yField.aggregate === "average" ? "平均值" : (state.mapping.series ? "分组汇总" : "汇总");
    const dimension = xField.type === "date" ? "按月" : `按${xField.label}`;
    return `${dimension}${aggregation}${unit}`;
  }

  function missingText(model) {
    const ignored = model.missing.x + model.missing.y + model.missing.invalid;
    const parts = [];
    if (ignored) parts.push(`忽略 ${ignored} 个缺失值`);
    if (model.missing.series) parts.push(`${model.missing.series} 条系列缺失记为未分组`);
    return parts.length ? parts.join(" · ") : "无缺失值";
  }

  function renderLegend(container, model, type) {
    container.replaceChildren();
    if (!model.points.length) return;
    const items = model.seriesField
      ? model.seriesList
      : [{ seriesRaw: "__all__", seriesLabel: "全量数据" }];
    items.forEach((series) => {
      const item = document.createElement("span");
      item.className = "legend-item";
      const mark = document.createElement("span");
      mark.className = `legend-mark${type === "line" ? " line" : ""}`;
      mark.style.background = ChartRenderer.colorForSeries(model, series.seriesRaw);
      const label = document.createElement("span");
      label.textContent = series.seriesLabel;
      item.append(mark, label);
      container.appendChild(item);
    });
  }

  function renderChartCard(key) {
    const stage = key === "a" ? refs.chartStageA : refs.chartStageB;
    const card = document.querySelector(`[data-chart-card="${key}"]`);
    const type = state.types[key];
    const result = ChartRenderer.renderChart(stage, state.model, type, {
      labels: state.labels,
      title: chartTitle(type)
    });
    let finalResult = result;
    if (!result.ok) {
      ChartRenderer.emptyState(stage, state.model, type);
      card.classList.add("has-error");
    } else {
      card.classList.remove("has-error");
    }
    finalResult = Object.assign({}, result, { title: chartTitle(type) });
    state.results[key] = finalResult;
    const titleNode = key === "a" ? refs.chartATitle : refs.chartBTitle;
    const subtitleNode = key === "a" ? refs.chartASubtitle : refs.chartBSubtitle;
    const legendNode = key === "a" ? refs.legendA : refs.legendB;
    const missingNode = key === "a" ? refs.missingA : refs.missingB;
    titleNode.textContent = chartTitle(type);
    subtitleNode.textContent = chartSubtitle(type);
    renderLegend(legendNode, state.model, type);
    missingNode.textContent = missingText(state.model);
    missingNode.classList.toggle("warn", state.model.missingCount > 0);
    card.querySelectorAll(".type-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.type === type);
    });
  }

  function renderedLabels(result) {
    if (!result || !result.ok || !result.svg) return null;
    return Array.from(result.svg.querySelectorAll(".value-labels text")).map((node) =>
      node.firstChild ? node.firstChild.nodeValue : ""
    );
  }

  function numericLabelTotal(labels) {
    if (!labels) return null;
    return labels.reduce((sum, label) => {
      const parsed = Number(String(label).replace(/,/g, ""));
      return Number.isFinite(parsed) ? sum + parsed : sum;
    }, 0);
  }

  function updateVerification() {
    const model = state.model;
    const labelsA = renderedLabels(state.results.a);
    const labelsB = renderedLabels(state.results.b);
    const bothAvailable = Boolean(labelsA && labelsB);
    const totalA = numericLabelTotal(labelsA);
    const totalB = numericLabelTotal(labelsB);
    let matches = bothAvailable && labelsA.length === labelsB.length;
    if (matches) {
      matches = labelsA.every((label, index) => label === labelsB[index]);
    }
    const totalMatches = bothAvailable && Math.abs(totalA - totalB) < 0.000001;
    const ok = bothAvailable && matches && totalMatches;
    const rows = (labelsA || []).map((labelA, index) => ({
      dimension: model.points[index]
        ? `${model.points[index].xLabel} · ${model.points[index].seriesLabel}`
        : `标签 ${index + 1}`,
      a: labelA,
      b: labelsB ? labelsB[index] : "—",
      match: Boolean(labelsB && labelA === labelsB[index])
    }));

    refs.verifyIcon.classList.toggle("error", !ok);
    refs.verifyPill.className = "status-pill";
    if (ok) {
      refs.verifyPill.classList.add("ok");
      refs.verifyPill.textContent = "已通过";
      refs.verifyCopy.textContent = `${ChartRenderer.typeNames[state.types.a]}与${ChartRenderer.typeNames[state.types.b]}使用同一次数据聚合，${labelsA.length} 个数值标签逐一匹配，标签合计也一致。`;
    } else {
      refs.verifyPill.classList.add(bothAvailable ? "error" : "neutral");
      refs.verifyPill.textContent = bothAvailable ? "不一致" : "待修复";
      const invalid = [
        !state.results.a?.ok ? "图表 A" : "",
        !state.results.b?.ok ? "图表 B" : ""
      ].filter(Boolean);
      refs.verifyCopy.textContent = invalid.length
        ? `${invalid.join("、")}存在无效映射，修复后即可比较数值标签。`
        : "两张图表的数值标签或合计不一致，请检查数据处理流程。";
    }
    refs.labelCount.textContent = bothAvailable ? String(labelsA.length) : "—";
    refs.totalA.textContent = state.results.a?.ok ? ChartData.formatMetric(state.mapping.y, totalA, false) : "—";
    refs.totalB.textContent = state.results.b?.ok ? ChartData.formatMetric(state.mapping.y, totalB, false) : "—";
    state.verification = { ok, labelsA, labelsB, totalA, totalB, rows };
  }

  function renderAll() {
    state.model = ChartData.buildModel(state.mapping, { sort: state.sort });
    if (state.model.errors.length && !state.feedback) {
      state.feedback = { type: "error", text: state.model.errors[0].message };
    }
    renderFields();
    renderMapping();
    renderChartCard("a");
    renderChartCard("b");
    updateVerification();
  }

  function showToast(message, type, title) {
    const toast = document.createElement("div");
    toast.className = `toast ${type || "info"}`;
    toast.appendChild(iconUse(type === "error" ? "alert" : type === "success" ? "check" : "spark"));
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title || "提示";
    const body = document.createElement("span");
    body.textContent = message;
    copy.append(heading, body);
    toast.appendChild(copy);
    refs.toastRegion.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(6px)";
      toast.style.transition = "opacity .18s, transform .18s";
      setTimeout(() => toast.remove(), 200);
    }, 3600);
  }

  function setupDropZone(slot) {
    const name = slot.dataset.slot;
    slot.addEventListener("dragenter", (event) => {
      event.preventDefault();
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragleave", (event) => {
      if (!slot.contains(event.relatedTarget)) slot.classList.remove("drag-over");
    });
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("drag-over");
      const fieldId = event.dataTransfer.getData("text/plain") || state.draggedField;
      if (!fieldId) return;
      const validation = ChartData.validateDrop(name, fieldId, state.mapping, state.types);
      if (!validation.ok) {
        setFeedback(validation.message, "error");
        showToast(validation.message, "error", "无法完成映射");
        return;
      }
      state.mapping = validation.mapping;
      const field = ChartData.getField(fieldId);
      const slotNames = { x: "X 轴", y: "Y 轴", series: "系列" };
      setFeedback(`已将「${field.label}」映射到${slotNames[name]}，图表与图例已同步。`, "info", 4200);
      renderAll();
      showToast(`「${field.label}」已映射到${slotNames[name]}。`, "success", "映射已更新");
    });
  }

  function openSourceData() {
    const dialog = document.getElementById("dataDialog");
    const summary = document.getElementById("dataSummary");
    const table = document.getElementById("sourceTable");
    summary.replaceChildren();
    const totalMissing = ChartData.fields.reduce((sum, field) => sum + ChartData.completeness(field.id).missing, 0);
    const summaryItems = [
      ["记录", `${ChartData.rows.length} 行`],
      ["字段", `${ChartData.fields.length} 个`],
      ["缺失值", `${totalMissing} 处`],
      ["数据源", "示例 CSV"]
    ];
    summaryItems.forEach(([name, value]) => {
      const item = document.createElement("span");
      item.append(`${name} `);
      const strong = document.createElement("strong");
      strong.textContent = value;
      item.appendChild(strong);
      summary.appendChild(item);
    });

    table.replaceChildren();
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ChartData.fields.forEach((field) => {
      const th = document.createElement("th");
      th.textContent = `${field.label} · ${fieldTypeLabel(field)}`;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    ChartData.rows.forEach((row) => {
      const tr = document.createElement("tr");
      ChartData.fields.forEach((field) => {
        const td = document.createElement("td");
        const value = row[field.id];
        const missing = ChartData.isMissing(value);
        td.textContent = missing ? "缺失" : ChartData.formatMetric(field.id, value, true);
        td.classList.toggle("missing-value", missing);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    if (!dialog.open) dialog.showModal();
  }

  function openVerification() {
    const dialog = document.getElementById("verifyDialog");
    const table = document.getElementById("verifyTable");
    const copy = document.getElementById("verifyDialogCopy");
    const verification = state.verification;
    table.replaceChildren();
    if (!verification || !verification.labelsA) {
      copy.textContent = "当前图表存在无效映射，暂无数值标签可供比较。请先修复映射。";
    } else {
      copy.textContent = verification.ok
        ? `逐项比较 ${verification.rows.length} 个标签：完全一致。比较基于两张图表实际渲染的 SVG 文本。`
        : "发现标签差异，请检查渲染数据。";
    }
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["维度 · 系列", "图表 A", "图表 B", "结果"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    const rows = verification && verification.rows ? verification.rows : [];
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      [row.dimension, row.a, row.b].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      const resultCell = document.createElement("td");
      const result = document.createElement("span");
      result.className = row.match ? "match" : "mismatch";
      result.textContent = row.match ? "✓ 一致" : "× 不一致";
      resultCell.appendChild(result);
      tr.appendChild(resultCell);
      body.appendChild(tr);
    });
    table.appendChild(body);
    if (!dialog.open) dialog.showModal();
  }

  function closeExportMenus(except) {
    document.querySelectorAll(".export-popover.open").forEach((menu) => {
      if (menu !== except) menu.classList.remove("open");
    });
    document.querySelectorAll(".export-trigger").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  async function handleExport(key, format) {
    const result = state.results[key];
    if (!result || !result.ok || !result.svg) {
      showToast("当前图表映射无效，无法导出。", "error", "导出失败");
      return;
    }
    const filename = `fieldnote-chart-${key}-${state.types[key]}`;
    try {
      if (format === "svg") {
        ChartRenderer.exportSvg(result.svg, filename);
        showToast("SVG 矢量文件已开始下载。", "success", "导出完成");
      } else {
        await ChartRenderer.exportPng(result.svg, filename, 2);
        showToast("PNG 文件已按 2× 分辨率导出。", "success", "导出完成");
      }
    } catch (error) {
      showToast(error.message || "文件生成失败，请重试。", "error", "导出失败");
    }
  }

  function resetWorkspace() {
    state.mapping = Object.assign({}, ChartData.defaultMapping);
    state.types = Object.assign({}, ChartData.defaultTypes);
    state.sort = "x";
    state.labels = true;
    state.search = "";
    state.feedback = null;
    refs.sortSelect.value = "x";
    refs.labelsToggle.checked = true;
    refs.fieldSearch.value = "";
    renderAll();
    showToast("字段映射、图表类型和排序已恢复默认。", "success", "工作区已重置");
  }

  function bindEvents() {
    document.querySelectorAll(".mapping-slot").forEach(setupDropZone);
    refs.fieldSearch.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderFields();
    });
    refs.sortSelect.addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderAll();
      showToast(`已切换为「${event.target.options[event.target.selectedIndex].text}」，图例顺序同步更新。`, "info", "排序已更新");
    });
    refs.labelsToggle.addEventListener("change", (event) => {
      state.labels = event.target.checked;
      renderChartCard("a");
      renderChartCard("b");
      updateVerification();
    });
    document.querySelectorAll("[data-clear]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const slot = button.dataset.clear;
        const field = ChartData.getField(state.mapping[slot]);
        state.mapping[slot] = null;
        state.feedback = null;
        renderAll();
        showToast(`已从映射中移除「${field ? field.label : "字段"}」。`, "info", "映射已更新");
      });
    });
    document.querySelectorAll(".type-button").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.chart;
        state.types[key] = button.dataset.type;
        state.feedback = null;
        renderAll();
        const result = state.results[key];
        if (result && !result.ok) {
          showToast(result.validation.errors[0].message, "error", "图表组合无效");
        } else {
          showToast(`图表 ${key.toUpperCase()} 已切换为${ChartRenderer.typeNames[button.dataset.type]}。`, "info", "图表已更新");
        }
      });
    });
    document.querySelectorAll(".export-trigger").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const menu = trigger.parentElement.querySelector(".export-popover");
        const shouldOpen = !menu.classList.contains("open");
        closeExportMenus(menu);
        menu.classList.toggle("open", shouldOpen);
        trigger.setAttribute("aria-expanded", String(shouldOpen));
      });
    });
    document.querySelectorAll("[data-export]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        closeExportMenus();
        handleExport(button.dataset.chart, button.dataset.export);
      });
    });
    document.addEventListener("click", () => closeExportMenus());
    document.getElementById("resetBtn").addEventListener("click", resetWorkspace);
    document.getElementById("previewDataBtn").addEventListener("click", openSourceData);
    document.getElementById("datasetCard").addEventListener("click", openSourceData);
    document.getElementById("verifyDetailsBtn").addEventListener("click", openVerification);
    document.getElementById("closeDataBtn").addEventListener("click", () => document.getElementById("dataDialog").close());
    document.getElementById("closeVerifyBtn").addEventListener("click", () => document.getElementById("verifyDialog").close());
    [document.getElementById("dataDialog"), document.getElementById("verifyDialog")].forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement !== refs.fieldSearch &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        refs.fieldSearch.focus();
      }
      if (event.key === "Escape") closeExportMenus();
    });
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderChartCard("a");
        renderChartCard("b");
        updateVerification();
      }, 140);
    });
  }

  bindEvents();
  renderAll();
})();
