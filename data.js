(function (global) {
  "use strict";

  const fields = [
    { id: "month", label: "月份", type: "date", icon: "calendar", aggregate: "first" },
    { id: "region", label: "区域", type: "string", icon: "tag", aggregate: "first" },
    { id: "channel", label: "渠道", type: "string", icon: "tag", aggregate: "first" },
    { id: "sales", label: "销售额", type: "number", icon: "hash", unit: "万元", decimals: 1, aggregate: "sum" },
    { id: "profit", label: "利润", type: "number", icon: "hash", unit: "万元", decimals: 1, aggregate: "sum" },
    { id: "orders", label: "订单数", type: "number", icon: "hash", unit: "单", decimals: 0, aggregate: "sum" },
    { id: "price", label: "客单价", type: "number", icon: "hash", unit: "元", decimals: 0, aggregate: "average" },
    { id: "returns", label: "退货率", type: "number", icon: "hash", unit: "%", decimals: 1, aggregate: "average" }
  ];

  const rows = [
    { id: 1, month: "2026-01", region: "华东", channel: "线上", sales: 138.2, profit: 24.8, orders: 412, price: 335, returns: 2.1 },
    { id: 2, month: "2026-01", region: "华南", channel: "线下", sales: 112.6, profit: 18.5, orders: 356, price: 316, returns: 2.8 },
    { id: 3, month: "2026-01", region: "华北", channel: "线上", sales: 96.4, profit: null, orders: 301, price: 320, returns: 3.4 },
    { id: 4, month: "2026-01", region: "西南", channel: "线下", sales: 84.1, profit: 13.2, orders: 276, price: 305, returns: null },
    { id: 5, month: "2026-02", region: "华东", channel: "线上", sales: 145.8, profit: 25.9, orders: 438, price: 333, returns: 2.0 },
    { id: 6, month: "2026-02", region: "华南", channel: "线下", sales: 119.3, profit: 19.6, orders: 372, price: 321, returns: 2.7 },
    { id: 7, month: "2026-02", region: "华北", channel: "线上", sales: 101.7, profit: 16.1, orders: 315, price: 323, returns: 3.1 },
    { id: 8, month: "2026-02", region: "西南", channel: "线下", sales: 88.6, profit: 13.8, orders: 289, price: 307, returns: 3.9 },
    { id: 9, month: "2026-03", region: "华东", channel: "线上", sales: 156.4, profit: 28.7, orders: 467, price: 335, returns: 1.9 },
    { id: 10, month: "2026-03", region: "华南", channel: "线下", sales: 127.2, profit: 21.4, orders: 389, price: 327, returns: 2.5 },
    { id: 11, month: "2026-03", region: "华北", channel: "线上", sales: 108.9, profit: 17.4, orders: 334, price: 326, returns: 3.0 },
    { id: 12, month: "2026-03", region: "西南", channel: "线下", sales: 92.3, profit: null, orders: 301, price: 307, returns: 3.7 },
    { id: 13, month: "2026-04", region: "华东", channel: "线上", sales: null, profit: 30.1, orders: 493, price: 342, returns: 1.7 },
    { id: 14, month: "2026-04", region: "华南", channel: "线下", sales: 134.8, profit: 22.9, orders: 406, price: 332, returns: 2.3 },
    { id: 15, month: "2026-04", region: "华北", channel: "线上", sales: 114.6, profit: 18.6, orders: 349, price: 328, returns: 2.8 },
    { id: 16, month: "2026-04", region: "西南", channel: "线下", sales: 98.7, profit: 15.2, orders: 318, price: 310, returns: 3.5 },
    { id: 17, month: "2026-05", region: "华东", channel: "线上", sales: 171.5, profit: 32.3, orders: 528, price: 346, returns: 1.6 },
    { id: 18, month: "2026-05", region: "华南", channel: "线下", sales: 142.1, profit: 24.8, orders: 425, price: 334, returns: null },
    { id: 19, month: "2026-05", region: "华北", channel: "线上", sales: 121.3, profit: 19.7, orders: 367, price: 331, returns: 2.6 },
    { id: 20, month: "2026-05", region: "西南", channel: "线下", sales: 105.4, profit: 16.4, orders: 332, price: 317, returns: 3.2 },
    { id: 21, month: "2026-06", region: "华东", channel: "线上", sales: 183.2, profit: 35.1, orders: 561, price: 352, returns: 1.5 },
    { id: 22, month: "2026-06", region: "华南", channel: "线下", sales: 150.7, profit: 26.3, orders: 449, price: 336, returns: 2.1 },
    { id: 23, month: "2026-06", region: "华北", channel: "线上", sales: 129.8, profit: 21.2, orders: 388, price: 335, returns: 2.4 },
    { id: 24, month: "2026-06", region: "西南", channel: "线下", sales: 111.6, profit: null, orders: 349, price: 320, returns: 3.0 }
  ];

  const defaultMapping = { x: "month", y: "sales", series: "region" };
  const defaultTypes = { a: "line", b: "bar" };
  const fieldMap = new Map(fields.map((field) => [field.id, field]));

  function getField(id) {
    return fieldMap.get(id) || null;
  }

  function isMissing(value) {
    return value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
  }

  function inferFieldKind(fieldOrId) {
    const field = typeof fieldOrId === "string" ? getField(fieldOrId) : fieldOrId;
    if (!field) return "nominal";
    if (field.type === "number") return "quantitative";
    if (field.type === "date") return "temporal";
    return "nominal";
  }

  function completeness(fieldId) {
    const present = rows.filter((row) => !isMissing(row[fieldId])).length;
    return { present, total: rows.length, missing: rows.length - present };
  }

  function formatNumber(value, decimals = 0) {
    if (isMissing(value)) return "—";
    return new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  function formatMetric(fieldId, value, includeUnit) {
    const field = getField(fieldId);
    if (!field || isMissing(value)) return "—";
    const number = formatNumber(value, field.decimals || 0);
    if (!includeUnit) return number;
    return `${number}${field.unit || ""}`;
  }

  function formatAxisTick(fieldId, value) {
    const field = getField(fieldId);
    if (!field || isMissing(value)) return "—";
    if (Math.abs(value) >= 1000 || Math.abs(value) < 1) return formatNumber(value, field.decimals || 0);
    return formatNumber(value, field.decimals || 0);
  }

  function formatDateValue(value) {
    const date = new Date(`${value}-01T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.getMonth() + 1}月`;
  }

  function formatDimension(fieldId, value) {
    const field = getField(fieldId);
    if (!field || isMissing(value)) return "（缺失）";
    if (field.type === "date") return formatDateValue(value);
    return String(value);
  }

  function rawDimension(fieldId, value) {
    const field = getField(fieldId);
    if (!field) return String(value);
    if (field.type === "date") {
      const time = new Date(`${value}-01T00:00:00`).getTime();
      return Number.isNaN(time) ? String(value) : time;
    }
    if (field.type === "number") return Number(value);
    return String(value);
  }

  function compareDimensions(fieldId, a, b) {
    const field = getField(fieldId);
    if (!field) return String(a).localeCompare(String(b), "zh-CN");
    const left = rawDimension(fieldId, a);
    const right = rawDimension(fieldId, b);
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right), "zh-CN");
  }

  function aggregateValues(values, method) {
    if (!values.length) return null;
    if (method === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + value, 0);
  }

  function structuralErrors(mapping) {
    const errors = [];
    if (!mapping.x) errors.push({ code: "missing-x", message: "请将字段拖入 X 轴，图表需要水平维度。" });
    if (!mapping.y) errors.push({ code: "missing-y", message: "请将字段拖入 Y 轴，图表需要数值度量。" });
    if (mapping.x && mapping.y && mapping.x === mapping.y) {
      errors.push({ code: "same-axis", message: "X 轴与 Y 轴不能使用同一个字段。" });
    }
    if (mapping.y && getField(mapping.y) && inferFieldKind(mapping.y) !== "quantitative") {
      errors.push({ code: "y-type", message: `「${getField(mapping.y).label}」不是数值字段，不能作为 Y 轴。` });
    }
    if (mapping.series && mapping.series === mapping.x) {
      errors.push({ code: "series-x", message: "系列字段不能与 X 轴字段相同。" });
    }
    if (mapping.series && mapping.series === mapping.y) {
      errors.push({ code: "series-y", message: "系列字段不能与 Y 轴字段相同。" });
    }
    if (mapping.series && getField(mapping.series) && inferFieldKind(mapping.series) === "quantitative") {
      errors.push({ code: "series-type", message: `「${getField(mapping.series).label}」是数值字段，系列需要分类或日期字段。` });
    }
    return errors;
  }

  function buildModel(mapping, options) {
    const settings = Object.assign({ sort: "x" }, options || {});
    const errors = structuralErrors(mapping);
    const missing = { x: 0, y: 0, series: 0, invalid: 0 };
    const groups = new Map();
    const xFirstSeen = new Map();
    const seriesFirstSeen = new Map();
    let sourceIndex = 0;

    if (!errors.length) {
      rows.forEach((row) => {
        const xValue = row[mapping.x];
        const yValue = row[mapping.y];
        const seriesValue = mapping.series ? row[mapping.series] : "__all__";
        if (isMissing(xValue)) { missing.x += 1; return; }
        if (isMissing(yValue)) { missing.y += 1; return; }
        const numericY = Number(yValue);
        if (!Number.isFinite(numericY)) { missing.invalid += 1; return; }
        if (mapping.series && isMissing(seriesValue)) missing.series += 1;

        const xRaw = String(xValue);
        const seriesRaw = mapping.series && !isMissing(seriesValue) ? String(seriesValue) : "__none__";
        const key = `${xRaw}\u0000${seriesRaw}`;
        if (!xFirstSeen.has(xRaw)) xFirstSeen.set(xRaw, sourceIndex);
        if (!seriesFirstSeen.has(seriesRaw)) seriesFirstSeen.set(seriesRaw, sourceIndex);
        sourceIndex += 1;
        if (!groups.has(key)) {
          groups.set(key, {
            xRaw,
            xLabel: formatDimension(mapping.x, xValue),
            seriesRaw,
            seriesLabel: mapping.series
              ? (seriesRaw === "__none__" ? "未分组" : formatDimension(mapping.series, seriesValue))
              : "全量数据",
            values: [],
            sourceIndex: xFirstSeen.get(xRaw)
          });
        }
        groups.get(key).values.push(numericY);
      });
    }

    const yField = getField(mapping.y);
    const xField = getField(mapping.x);
    const seriesField = getField(mapping.series);
    const points = Array.from(groups.values()).map((group) => {
      const value = aggregateValues(group.values, yField ? yField.aggregate : "sum");
      return {
        xRaw: group.xRaw,
        xLabel: group.xLabel,
        seriesRaw: group.seriesRaw,
        seriesLabel: group.seriesLabel,
        value,
        label: formatNumber(value, yField ? yField.decimals : 0),
        count: group.values.length,
        sourceIndex: group.sourceIndex
      };
    });

    const xTotals = new Map();
    points.forEach((point) => xTotals.set(point.xRaw, (xTotals.get(point.xRaw) || 0) + point.value));
    if (settings.sort === "y-desc") {
      const order = new Map(Array.from(xTotals.entries()).map(([key, value]) => [key, value]));
      points.sort((a, b) => (order.get(b.xRaw) - order.get(a.xRaw)) ||
        compareDimensions(mapping.x, a.xRaw, b.xRaw) ||
        a.seriesLabel.localeCompare(b.seriesLabel, "zh-CN"));
    } else if (settings.sort === "source") {
      points.sort((a, b) => a.sourceIndex - b.sourceIndex ||
        seriesFirstSeen.get(a.seriesRaw) - seriesFirstSeen.get(b.seriesRaw));
    } else {
      points.sort((a, b) => compareDimensions(mapping.x, a.xRaw, b.xRaw) ||
        seriesFirstSeen.get(a.seriesRaw) - seriesFirstSeen.get(b.seriesRaw));
    }

    const xValues = Array.from(new Map(points.map((point) => [point.xRaw, point])).values());
    const seriesTotals = new Map();
    points.forEach((point) => seriesTotals.set(point.seriesRaw, (seriesTotals.get(point.seriesRaw) || 0) + point.value));
    const seriesList = Array.from(new Map(points.map((point) => [point.seriesRaw, point])).values());
    seriesList.sort((a, b) => {
      if (settings.sort === "y-desc") return seriesTotals.get(b.seriesRaw) - seriesTotals.get(a.seriesRaw);
      if (settings.sort === "source") return seriesFirstSeen.get(a.seriesRaw) - seriesFirstSeen.get(b.seriesRaw);
      return a.seriesLabel.localeCompare(b.seriesLabel, "zh-CN");
    });

    const values = points.map((point) => point.value);
    const signature = points.map((point) =>
      `${point.xRaw}\u0001${point.seriesRaw}\u0001${point.value.toFixed(6)}`
    ).join("\u0002");

    return {
      points,
      xValues,
      seriesList,
      errors,
      missing,
      missingCount: missing.x + missing.y + missing.series + missing.invalid,
      xScale: inferFieldKind(mapping.x),
      yScale: inferFieldKind(mapping.y),
      xField,
      yField,
      seriesField,
      minY: values.length ? Math.min(...values) : 0,
      maxY: values.length ? Math.max(...values) : 0,
      totalLabels: values.reduce((sum, value) => sum + value, 0),
      signature,
      rowCount: points.reduce((sum, point) => sum + point.count, 0)
    };
  }

  function validateChart(model, chartType) {
    const errors = model.errors.slice();
    if (!errors.length && chartType === "scatter" && model.xScale !== "quantitative") {
      const xLabel = model.xField ? model.xField.label : "当前 X 字段";
      errors.push({ code: "scatter-x", message: `散点图要求 X、Y 均为数值字段；「${xLabel}」是${model.xScale === "temporal" ? "日期" : "分类"}字段。` });
    }
    if (!errors.length && !model.points.length) {
      errors.push({ code: "empty", message: "当前映射没有可用于绘制的完整数据，请检查缺失值或更换字段。" });
    }
    return { ok: errors.length === 0, errors };
  }

  function validateDrop(slot, fieldId, mapping, chartTypes) {
    const field = getField(fieldId);
    if (!field) return { ok: false, message: "未知字段，无法完成映射。" };
    const kind = inferFieldKind(field);
    const next = Object.assign({}, mapping, { [slot]: fieldId });
    if (slot === "x" && mapping.y === fieldId) return { ok: false, message: "X 轴不能与 Y 轴使用同一字段。" };
    if (slot === "y" && mapping.x === fieldId) return { ok: false, message: "Y 轴不能与 X 轴使用同一字段。" };
    if (slot === "series" && (mapping.x === fieldId || mapping.y === fieldId)) return { ok: false, message: "系列字段需要与 X、Y 轴不同。" };
    if (slot === "y" && kind !== "quantitative") {
      return { ok: false, message: `「${field.label}」是${kind === "temporal" ? "日期" : "分类"}字段，不能映射到 Y 轴；请选择数值字段。` };
    }
    if (slot === "series" && kind === "quantitative") {
      return { ok: false, message: `「${field.label}」是数值字段，系列需要分类或日期字段。` };
    }
    if (slot === "x" && chartTypes && (chartTypes.a === "scatter" || chartTypes.b === "scatter") && kind !== "quantitative") {
      return { ok: false, message: `当前包含散点图，X 轴必须是数值字段；「${field.label}」不适用。` };
    }
    const ignores = Object.keys(next).map((key) => key !== slot && next[key] === fieldId).filter(Boolean);
    if (ignores.length) return { ok: false, message: "该字段已用于其他映射，请先清除原槽位。" };
    return { ok: true, mapping: next };
  }

  global.ChartData = {
    fields,
    rows,
    defaultMapping,
    defaultTypes,
    getField,
    isMissing,
    inferFieldKind,
    completeness,
    formatNumber,
    formatMetric,
    formatAxisTick,
    formatDimension,
    compareDimensions,
    aggregateValues,
    buildModel,
    validateChart,
    validateDrop
  };
})(window);
