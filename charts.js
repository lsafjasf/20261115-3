(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const palette = ["#1e5b47", "#cf704f", "#4e72bd", "#a47a35", "#8065ad", "#5a9389", "#d2a23e", "#b85f75"];
  const typeNames = { line: "折线图", bar: "柱状图", scatter: "散点图" };
  let chartSerial = 0;

  function createEl(tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    });
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function colorForSeries(model, seriesRaw) {
    if (!model.seriesField) return palette[0];
    const index = model.seriesList.findIndex((series) => series.seriesRaw === seriesRaw);
    return palette[Math.max(0, index) % palette.length];
  }

  function niceStep(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    const fraction = value / power;
    let nice = 1;
    if (fraction > 5) nice = 10;
    else if (fraction > 2.5) nice = 5;
    else if (fraction > 2) nice = 2.5;
    else if (fraction > 1) nice = 2;
    return nice * power;
  }

  function yDomain(model) {
    const upper = Math.max(model.maxY || 0, 0);
    const step = niceStep(Math.max(upper, 1) / 4);
    const max = Math.max(step, Math.ceil((upper * 1.08) / step) * step);
    const ticks = [];
    for (let value = 0; value <= max + step * .001; value += step) ticks.push(value);
    return { min: 0, max, ticks };
  }

  function numericXDomain(points) {
    const values = points.map((point) => Number(point.xRaw)).filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 1, ticks: [0, 1] };
    const low = Math.min(...values);
    const high = Math.max(...values);
    const spread = high - low || Math.abs(high) * .1 || 1;
    const step = niceStep(spread / 4);
    const min = Math.floor((low - spread * .08) / step) * step;
    const max = Math.ceil((high + spread * .08) / step) * step;
    const ticks = [];
    for (let value = min; value <= max + step * .001; value += step) ticks.push(value);
    return { min, max, ticks };
  }

  function makeScales(model, width, height, margins, type) {
    const plotWidth = Math.max(1, width - margins.left - margins.right);
    const plotHeight = Math.max(1, height - margins.top - margins.bottom);
    const domain = yDomain(model);
    const y = (value) => margins.top + plotHeight - ((value - domain.min) / (domain.max - domain.min)) * plotHeight;
    if (type === "scatter") {
      const xDomain = numericXDomain(model.points);
      const x = (value) => margins.left + ((Number(value) - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
      return { x, y, plotWidth, plotHeight, yDomain: domain, xDomain };
    }
    const bandWidth = plotWidth / Math.max(1, model.xValues.length);
    const x = (xRaw) => {
      const index = model.xValues.findIndex((item) => item.xRaw === xRaw);
      return margins.left + bandWidth * index + bandWidth / 2;
    };
    return { x, y, bandWidth, plotWidth, plotHeight, yDomain: domain, xDomain: null };
  }

  function addGridAndAxes(svg, model, scales, margins, width, height, type) {
    const axisGroup = createEl("g", { class: "axes" });
    scales.yDomain.ticks.forEach((tick) => {
      const tickY = scales.y(tick);
      axisGroup.appendChild(createEl("line", {
        x1: margins.left, y1: tickY, x2: width - margins.right, y2: tickY,
        stroke: tick === 0 ? "#cbd4cd" : "#edf0eb", "stroke-width": 1,
        "stroke-dasharray": tick === 0 ? null : "2 4"
      }));
      axisGroup.appendChild(createEl("text", {
        x: margins.left - 10, y: tickY + 3, "text-anchor": "end",
        fill: "#8b9790", "font-size": 8.5, "font-family": "Fieldnote Sans, Inter, PingFang SC, sans-serif",
        "font-variant-numeric": "tabular-nums"
      }, ChartData.formatAxisTick(model.yField.id, tick)));
    });

    const xLabels = type === "scatter"
      ? scales.xDomain.ticks.map((tick) => ({ raw: tick, label: ChartData.formatAxisTick(model.xField.id, tick) }))
      : model.xValues.map((item) => ({ raw: item.xRaw, label: item.xLabel }));
    const maxLabels = Math.max(4, Math.floor(scales.plotWidth / 65));
    const skip = Math.ceil(xLabels.length / maxLabels);
    xLabels.forEach((item, index) => {
      if (index % skip !== 0 && index !== xLabels.length - 1) return;
      const tickX = type === "scatter"
        ? scales.x(item.raw)
        : scales.x(item.raw);
      axisGroup.appendChild(createEl("line", {
        x1: tickX, y1: height - margins.bottom, x2: tickX, y2: height - margins.bottom + 4,
        stroke: "#bec8c0", "stroke-width": 1
      }));
      axisGroup.appendChild(createEl("text", {
        x: tickX, y: height - margins.bottom + 17, "text-anchor": "middle",
        fill: "#76837c", "font-size": 8.5, "font-family": "Fieldnote Sans, Inter, PingFang SC, sans-serif"
      }, item.label));
    });
    axisGroup.appendChild(createEl("line", {
      x1: margins.left, y1: height - margins.bottom, x2: width - margins.right, y2: height - margins.bottom,
      stroke: "#c7d0c9", "stroke-width": 1
    }));
    svg.appendChild(axisGroup);
  }

  function addSeriesLabels(svg, model, scales, type, visible) {
    const labelGroup = createEl("g", {
      class: "value-labels",
      style: visible ? null : "display:none"
    });
    model.points.forEach((point) => {
      const x = scales.x(point.xRaw);
      const pointY = scales.y(point.value);
      let labelY = pointY - 8;
      if (type === "bar") labelY = pointY - 5;
      if (type === "scatter") labelY = pointY - 8;
      const label = createEl("text", {
        x, y: labelY, "text-anchor": "middle",
        fill: "#34433b", "font-size": type === "bar" ? 7.8 : 8.2,
        "font-weight": 600, "font-family": "Fieldnote Sans, Inter, PingFang SC, sans-serif",
        "font-variant-numeric": "tabular-nums",
        stroke: "#ffffff", "stroke-width": type === "bar" ? 2.6 : 2.2,
        "paint-order": "stroke", "stroke-linejoin": "round"
      }, point.label);
      label.appendChild(createEl("title", {}, `${point.xLabel} · ${point.seriesLabel}：${ChartData.formatMetric(model.yField.id, point.value, true)}`));
      labelGroup.appendChild(label);
    });
    svg.appendChild(labelGroup);
  }

  function emptyState(container, model, type) {
    const result = ChartData.validateChart(model, type);
    const node = document.createElement("div");
    node.className = `chart-empty${result.ok ? "" : " error"}`;
    const message = result.ok ? "当前数据为空" : result.errors[0].message;
    node.textContent = `${typeNames[type]} · ${message}`;
    container.appendChild(node);
    return result;
  }

  function renderChart(container, model, type, options) {
    const opts = Object.assign({ labels: true, title: "" }, options || {});
    container.replaceChildren();
    const validation = ChartData.validateChart(model, type);
    if (!validation.ok) return { ok: false, validation, model, type };

    const width = Math.max(340, Math.round(container.clientWidth || 580));
    const height = Math.max(240, Math.round(container.clientHeight || 310));
    const margins = { top: 22, right: 22, bottom: 44, left: 51 };
    const scales = makeScales(model, width, height, margins, type);
    const id = `chart-${++chartSerial}`;
    const svg = createEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: "100%",
      role: "img",
      "aria-label": `${opts.title || typeNames[type]}，${model.points.length} 个数值标签`,
      xmlns: NS
    });
    svg.appendChild(createEl("title", {}, `${opts.title || typeNames[type]} · ${model.xField.label} × ${model.yField.label}`));
    svg.appendChild(createEl("rect", { width, height, fill: "#ffffff" }));

    const defs = createEl("defs");
    const clip = createEl("clipPath", { id: `${id}-clip` });
    clip.appendChild(createEl("rect", {
      x: margins.left - 2, y: margins.top - 8,
      width: scales.plotWidth + 4, height: scales.plotHeight + 10
    }));
    defs.appendChild(clip);
    svg.appendChild(defs);
    addGridAndAxes(svg, model, scales, margins, width, height, type);

    const plot = createEl("g", { "clip-path": `url(#${id}-clip)` });
    if (type === "line") drawLine(plot, model, scales);
    if (type === "bar") drawBar(plot, model, scales);
    if (type === "scatter") drawScatter(plot, model, scales);
    svg.appendChild(plot);
    addSeriesLabels(svg, model, scales, type, opts.labels);

    svg.appendChild(createEl("text", {
      x: margins.left, y: 11, fill: "#98a29c", "font-size": 7.5,
      "font-family": "Fieldnote Sans, Inter, PingFang SC, sans-serif", "letter-spacing": ".04em"
    }, model.yField.unit ? `单位：${model.yField.unit}` : ""));
    container.appendChild(svg);
    return { ok: true, svg, model, type, validation, scales };
  }

  function drawLine(parent, model, scales) {
    model.seriesList.forEach((series) => {
      const color = colorForSeries(model, series.seriesRaw);
      const seriesPoints = model.points.filter((point) => point.seriesRaw === series.seriesRaw);
      const pointByX = new Map(seriesPoints.map((point) => [point.xRaw, point]));
      const segments = [];
      let current = [];
      model.xValues.forEach((xValue) => {
        const point = pointByX.get(xValue.xRaw);
        if (point) current.push(point);
        if (!point && current.length) {
          segments.push(current);
          current = [];
        }
      });
      if (current.length) segments.push(current);

      if (model.seriesList.length === 1) {
        const baseline = scales.y(0);
        segments.forEach((segment) => {
          let area = `M ${scales.x(segment[0].xRaw)} ${baseline}`;
          segment.forEach((point) => { area += ` L ${scales.x(point.xRaw)} ${scales.y(point.value)}`; });
          area += ` L ${scales.x(segment[segment.length - 1].xRaw)} ${baseline} Z`;
          parent.appendChild(createEl("path", { d: area, fill: color, opacity: .08, stroke: "none" }));
        });
      }

      segments.forEach((segment) => {
        const path = segment.map((point, index) =>
          `${index === 0 ? "M" : "L"} ${scales.x(point.xRaw)} ${scales.y(point.value)}`
        ).join(" ");
        parent.appendChild(createEl("path", {
          d: path, fill: "none", stroke: color, "stroke-width": 2.15,
          "stroke-linecap": "round", "stroke-linejoin": "round"
        }));
      });

      seriesPoints.forEach((point) => {
        const marker = createEl("circle", {
          cx: scales.x(point.xRaw), cy: scales.y(point.value), r: 3.7,
          fill: "#ffffff", stroke: color, "stroke-width": 2
        });
        marker.appendChild(createEl("title", {}, `${point.xLabel} · ${point.seriesLabel}：${ChartData.formatMetric(model.yField.id, point.value, true)}`));
        parent.appendChild(marker);
      });
    });
  }

  function drawBar(parent, model, scales) {
    const seriesCount = Math.max(1, model.seriesList.length);
    const categoryWidth = scales.bandWidth * .72;
    const slotWidth = categoryWidth / seriesCount;
    const barWidth = Math.max(3, Math.min(26, slotWidth - 3));
    const baseline = scales.y(0);
    const groupLeft = (point) => scales.x(point.xRaw) - categoryWidth / 2;

    model.xValues.forEach((xValue) => {
      model.seriesList.forEach((series, seriesIndex) => {
        const point = model.points.find((item) =>
          item.xRaw === xValue.xRaw && item.seriesRaw === series.seriesRaw
        );
        if (!point) return;
        const top = scales.y(point.value);
        const height = Math.max(1, baseline - top);
        const x = groupLeft(point) + slotWidth * seriesIndex + (slotWidth - barWidth) / 2;
        const radius = Math.min(3.5, barWidth / 2, height);
        const path = [
          `M ${x} ${baseline}`,
          `L ${x} ${top + radius}`,
          `Q ${x} ${top} ${x + radius} ${top}`,
          `L ${x + barWidth - radius} ${top}`,
          `Q ${x + barWidth} ${top} ${x + barWidth} ${top + radius}`,
          `L ${x + barWidth} ${baseline}`,
          "Z"
        ].join(" ");
        const bar = createEl("path", {
          d: path, fill: colorForSeries(model, point.seriesRaw),
          opacity: .9, stroke: "none"
        });
        bar.appendChild(createEl("title", {}, `${point.xLabel} · ${point.seriesLabel}：${ChartData.formatMetric(model.yField.id, point.value, true)}`));
        parent.appendChild(bar);
      });
    });
  }

  function drawScatter(parent, model, scales) {
    model.points.forEach((point) => {
      const node = createEl("g", { class: "scatter-point" });
      const circle = createEl("circle", {
        cx: scales.x(point.xRaw), cy: scales.y(point.value), r: 4.2,
        fill: colorForSeries(model, point.seriesRaw),
        stroke: "#ffffff", "stroke-width": 1.5, opacity: .92
      });
      circle.appendChild(createEl("title", {},
        `${ChartData.formatMetric(model.xField.id, Number(point.xRaw), true)} · ${point.seriesLabel}：${ChartData.formatMetric(model.yField.id, point.value, true)}`
      ));
      node.appendChild(circle);
      parent.appendChild(node);
    });
  }

  function serializableSvg(svg) {
    const clone = svg.cloneNode(true);
    const viewBox = (clone.getAttribute("viewBox") || "0 0 800 400").split(/\s+/).map(Number);
    clone.setAttribute("xmlns", NS);
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", viewBox[2] || 800);
    clone.setAttribute("height", viewBox[3] || 400);
    if (global.FIELDNOTE_FONT_DATA) {
      const style = createEl("style", {},
        `@font-face{font-family:'Fieldnote Sans';src:url('${global.FIELDNOTE_FONT_DATA}') format('woff2');font-style:normal;font-weight:400 700}`
      );
      clone.insertBefore(style, clone.firstChild);
    }
    const serialized = new XMLSerializer().serializeToString(clone);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportSvg(svg, filename) {
    const markup = serializableSvg(svg);
    downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
    return markup;
  }

  function exportPng(svg, filename, scale) {
    return new Promise((resolve, reject) => {
      const markup = serializableSvg(svg);
      const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      const viewBox = (svg.getAttribute("viewBox") || "0 0 800 400").split(/\s+/).map(Number);
      const ratio = scale || 2;
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round((viewBox[2] || 800) * ratio);
          canvas.height = Math.round((viewBox[3] || 400) * ratio);
          const context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(url);
            if (!pngBlob) {
              reject(new Error("PNG 编码失败"));
              return;
            }
            downloadBlob(pngBlob, `${filename}.png`);
            resolve(pngBlob);
          }, "image/png");
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图表渲染失败"));
      };
      image.src = url;
    });
  }

  global.ChartRenderer = {
    palette,
    typeNames,
    colorForSeries,
    renderChart,
    emptyState,
    exportSvg,
    exportPng
  };
})(window);
