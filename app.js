(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const VIEW_SIZE = 128;
  const CENTER = VIEW_SIZE / 2;
  const OUTER_RADIUS = 39;
  const INNER_RADIUS = 28;
  const NODE_RADIUS = 10.5;
  const NODE_OFFSET = 4;
  const EPSILON = 0.001;

  const POINT_ANGLES = [-90, -30, 30, 90, 150, 210];
  const OUTER_NODE_INDEXES = [0, 2, 4];
  const NODE_NAMES = ["节点 A", "节点 B", "节点 C"];

  const defaults = Object.freeze({
    axis: 90,
    radius: 68,
    stroke: 12,
    invert: false,
    showGrid: true,
    zoom: 1,
  });

  const state = {
    ...defaults,
    selectedPaths: new Set(),
    hiddenPaths: new Set(),
    hiddenCircles: new Set(),
    merged: null,
    rasterToken: 0,
    toastTimer: null,
  };

  const elements = {
    mainSvg: document.querySelector("#mainSvg"),
    artboard: document.querySelector("#artboard"),
    canvasWrap: document.querySelector("#canvasWrap"),
    axisRange: document.querySelector("#axisRange"),
    radiusRange: document.querySelector("#radiusRange"),
    strokeRange: document.querySelector("#strokeRange"),
    axisValue: document.querySelector("#axisValue"),
    radiusValue: document.querySelector("#radiusValue"),
    strokeValue: document.querySelector("#strokeValue"),
    axisLabel: document.querySelector("#axisLabel"),
    zoomLabel: document.querySelector("#zoomLabel"),
    selectionStatus: document.querySelector("#selectionStatus"),
    layerCount: document.querySelector("#layerCount"),
    circleLayerList: document.querySelector("#circleLayerList"),
    pathLayerList: document.querySelector("#pathLayerList"),
    mergeButton: document.querySelector("#mergeButton"),
    unmergeButton: document.querySelector("#unmergeButton"),
    exportButton: document.querySelector("#exportButton"),
    selectAllButton: document.querySelector("#selectAllButton"),
    resetButton: document.querySelector("#resetButton"),
    gridToggle: document.querySelector("#gridToggle"),
    zoomIn: document.querySelector("#zoomIn"),
    zoomOut: document.querySelector("#zoomOut"),
    previewPositive: document.querySelector("#previewPositive"),
    previewNegative: document.querySelector("#previewNegative"),
    actual24: document.querySelector("#actual24"),
    previewSmallActual: document.querySelector("#previewSmallActual"),
    previewSmallEnlarged: document.querySelector("#previewSmallEnlarged"),
    snapState: document.querySelector("#snapState"),
    toast: document.querySelector("#toast"),
  };

  function polarPoint(angle, radius) {
    const radians = (angle * Math.PI) / 180;
    return {
      x: CENTER + Math.cos(radians) * radius,
      y: CENTER + Math.sin(radians) * radius,
    };
  }

  function fmt(value) {
    return Number(value.toFixed(3)).toString();
  }

  function pointKey(point) {
    return `${Math.round(point.x / EPSILON)}:${Math.round(point.y / EPSILON)}`;
  }

  function lerpPoint(from, to, amount) {
    return {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    };
  }

  function buildGeometry() {
    const points = POINT_ANGLES.map((angle, index) =>
      polarPoint(
        angle,
        OUTER_NODE_INDEXES.includes(index) ? OUTER_RADIUS : INNER_RADIUS,
      ),
    );
    const roundness = state.radius / 100;

    const paths = points.map((start, index) => {
      const end = points[(index + 1) % points.length];
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 2) % points.length];
      const smoothStart = {
        x: start.x + (end.x - previous.x) / 6,
        y: start.y + (end.y - previous.y) / 6,
      };
      const smoothEnd = {
        x: end.x - (next.x - start.x) / 6,
        y: end.y - (next.y - start.y) / 6,
      };
      const control1 = lerpPoint(start, smoothStart, roundness);
      const control2 = lerpPoint(end, smoothEnd, roundness);

      return {
        id: `path-${String(index + 1).padStart(2, "0")}`,
        number: index + 1,
        name: `路径 ${String(index + 1).padStart(2, "0")}`,
        startAnchor: `A${index + 1}`,
        endAnchor: `A${((index + 1) % points.length) + 1}`,
        start,
        end,
        control1,
        control2,
        d: [
          `M ${fmt(start.x)} ${fmt(start.y)}`,
          `C ${fmt(control1.x)} ${fmt(control1.y)}`,
          `${fmt(control2.x)} ${fmt(control2.y)}`,
          `${fmt(end.x)} ${fmt(end.y)}`,
        ].join(" "),
      };
    });

    const circles = OUTER_NODE_INDEXES.map((pointIndex, index) => {
      const point = polarPoint(
        POINT_ANGLES[pointIndex],
        OUTER_RADIUS + NODE_OFFSET,
      );
      return {
        id: `node-${String.fromCharCode(97 + index)}`,
        name: NODE_NAMES[index],
        x: point.x,
        y: point.y,
        r: NODE_RADIUS,
      };
    });

    return { points, paths, circles };
  }

  function pathFromChain(chain) {
    if (!chain.length) {
      return { d: "", anchors: [], subpaths: 0 };
    }

    const uniqueAnchors = [];
    const seen = new Set();
    for (const segment of chain) {
      const segmentPoints = [segment.start, segment.end];
      for (const point of segmentPoints) {
        const key = pointKey(point);
        if (!seen.has(key)) {
          seen.add(key);
          uniqueAnchors.push(point);
        }
      }
    }

    let d = `M ${fmt(chain[0].start.x)} ${fmt(chain[0].start.y)}`;
    for (const segment of chain) {
      d += ` C ${fmt(segment.control1.x)} ${fmt(segment.control1.y)}`;
      d += ` ${fmt(segment.control2.x)} ${fmt(segment.control2.y)}`;
      d += ` ${fmt(segment.end.x)} ${fmt(segment.end.y)}`;
    }
    if (pointKey(chain[0].start) === pointKey(chain.at(-1).end)) {
      d += " Z";
    }

    return {
      d,
      anchors: uniqueAnchors,
      subpaths: 1,
    };
  }

  function mergePathGeometry(paths) {
    if (paths.length < 2) {
      return {
        d: paths[0]?.d || "",
        anchors: paths.flatMap((path) => [path.start, path.end]),
        subpaths: paths.length,
        sourceIds: paths.map((path) => path.id),
        originalAnchorCount: paths.length * 2,
      };
    }

    const unused = new Set(paths.map((path) => path.id));
    const byStart = new Map();
    const byEnd = new Map();
    for (const path of paths) {
      if (!byStart.has(path.startAnchor)) byStart.set(path.startAnchor, []);
      if (!byEnd.has(path.endAnchor)) byEnd.set(path.endAnchor, []);
      byStart.get(path.startAnchor).push(path);
      byEnd.get(path.endAnchor).push(path);
    }

    const chains = [];
    while (unused.size) {
      const seedId = unused.values().next().value;
      const seed = paths.find((path) => path.id === seedId);
      unused.delete(seed.id);
      const chain = [seed];

      let extended = true;
      while (extended) {
        extended = false;
        const tip = chain.at(-1);
        const nextPath = (byStart.get(tip.endAnchor) || []).find((path) =>
          unused.has(path.id),
        );
        if (nextPath) {
          chain.push(nextPath);
          unused.delete(nextPath.id);
          extended = true;
          continue;
        }

        const head = chain[0];
        const previousPath = (byEnd.get(head.startAnchor) || []).find((path) =>
          unused.has(path.id),
        );
        if (previousPath) {
          chain.unshift(previousPath);
          unused.delete(previousPath.id);
          extended = true;
        }
      }
      chains.push(chain);
    }

    const results = chains.map(pathFromChain);
    return {
      d: results.map((result) => result.d).join(" "),
      anchors: results.flatMap((result) => result.anchors),
      subpaths: results.reduce((sum, result) => sum + result.subpaths, 0),
      sourceIds: paths.map((path) => path.id),
      originalAnchorCount: paths.length * 2,
    };
  }

  function selectedGeometry(geometry = buildGeometry()) {
    return geometry.paths.filter((path) => state.selectedPaths.has(path.id));
  }

  function formatAnchors(anchors) {
    return anchors.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ");
  }

  function shapeMarkup(options = {}) {
    const {
      geometry = buildGeometry(),
      invert = false,
      interactive = false,
      showSelection = true,
      idPrefix = "",
    } = options;
    const ink = invert ? "#f7f6f0" : "#171816";
    const mergedSource = state.merged;
    const mergedGeometry = mergedSource
      ? mergePathGeometry(
          geometry.paths.filter((path) => mergedSource.ids.includes(path.id)),
        )
      : null;
    const mergedIds = new Set(mergedSource?.ids || []);
    const selected = state.selectedPaths;
    let pathsMarkup = "";

    if (mergedSource && mergedGeometry) {
      pathsMarkup += `<g id="${idPrefix}source-paths" data-source-of="${idPrefix}path-merged" data-editable="true"`;
      pathsMarkup += ` visibility="hidden">`;
      for (const path of geometry.paths.filter((item) => mergedIds.has(item.id))) {
        pathsMarkup += `<path id="${idPrefix}${path.id}" class="logo-path" data-name="${path.name}"`;
        pathsMarkup += ` data-editable="true" data-anchor-count="2"`;
        pathsMarkup += ` data-anchors="${formatAnchors([path.start, path.end])}"`;
        pathsMarkup += ` d="${path.d}" fill="none" stroke="${ink}" stroke-width="${state.stroke}"/>`;
      }
      pathsMarkup += `</g>`;
      pathsMarkup += `<path id="${idPrefix}path-merged" class="logo-path merged-path"`;
      pathsMarkup += ` data-name="复合路径 01–${String(mergedSource.ids.length).padStart(2, "0")}"`;
      pathsMarkup += ` data-editable="true" data-merged="true"`;
      pathsMarkup += ` data-source-ids="${mergedSource.ids.join(" ")}"`;
      pathsMarkup += ` data-subpaths="${mergedGeometry.subpaths}"`;
      pathsMarkup += ` data-anchor-count="${mergedGeometry.anchors.length}"`;
      pathsMarkup += ` data-anchors="${formatAnchors(mergedGeometry.anchors)}"`;
      pathsMarkup += ` d="${mergedGeometry.d}" fill="none" stroke="${ink}" stroke-width="${state.stroke}"/>`;
    }

    for (const path of geometry.paths) {
      if (mergedIds.has(path.id) || state.hiddenPaths.has(path.id)) continue;
      const classes = ["logo-path"];
      if (showSelection && selected.has(path.id)) classes.push("shape-selected");
      pathsMarkup += `<path id="${idPrefix}${path.id}" class="${classes.join(" ")}"`;
      pathsMarkup += ` data-name="${path.name}" data-editable="true"`;
      pathsMarkup += ` data-anchor-count="2"`;
      pathsMarkup += ` data-anchors="${formatAnchors([path.start, path.end])}"`;
      pathsMarkup += ` d="${path.d}" fill="none" stroke="${ink}" stroke-width="${state.stroke}"/>`;
    }

    let circlesMarkup = "";
    for (const circle of geometry.circles) {
      if (state.hiddenCircles.has(circle.id)) continue;
      const classes = ["logo-circle"];
      circlesMarkup += `<circle id="${idPrefix}${circle.id}" class="${classes.join(" ")}"`;
      circlesMarkup += ` data-name="${circle.name}" data-editable="true"`;
      circlesMarkup += ` data-anchor-count="1"`;
      circlesMarkup += ` data-anchors="${fmt(circle.x)},${fmt(circle.y)}"`;
      circlesMarkup += ` cx="${fmt(circle.x)}" cy="${fmt(circle.y)}" r="${fmt(circle.r)}"`;
      circlesMarkup += ` fill="${ink}"/>`;
    }

    let hitMarkup = "";
    let anchorMarkup = "";
    if (interactive) {
      for (const path of geometry.paths) {
        if (state.hiddenPaths.has(path.id)) continue;
        hitMarkup += `<path class="path-hit" data-path-id="${path.id}" d="${path.d}"/>`;
        if (showSelection && selected.has(path.id)) {
          const points = pathFromChain([path]).anchors;
          for (const point of points) {
            anchorMarkup += `<circle class="anchor-mark" cx="${fmt(point.x)}"`;
            anchorMarkup += ` cy="${fmt(point.y)}" r="1.5"/>`;
          }
        }
      }
    }

    return {
      markup: `
        <g id="${idPrefix}paths" data-role="paths" data-count="${geometry.paths.length}">
          ${pathsMarkup}
        </g>
        <g id="${idPrefix}nodes" data-role="nodes" data-count="${geometry.circles.length}">
          ${circlesMarkup}
        </g>
          ${hitMarkup ? `<g id="${idPrefix}hit-targets" aria-hidden="true">${hitMarkup}</g>` : ""}
          ${anchorMarkup ? `<g id="${idPrefix}anchor-handles" aria-hidden="true">${anchorMarkup}</g>` : ""}
      `,
      mergedGeometry,
    };
  }

  function gridMarkup(invert) {
    if (!state.showGrid) return "";
    const minor = invert ? "#2c2e29" : "#e8e7e1";
    const major = invert ? "#3b3d37" : "#d4d3cc";
    const minorLines = [];
    const majorLines = [];
    for (let value = 8; value < VIEW_SIZE; value += 8) {
      const target = value % 32 === 0 ? majorLines : minorLines;
      target.push(`M ${value} 0 V ${VIEW_SIZE}`);
      target.push(`M 0 ${value} H ${VIEW_SIZE}`);
    }
    return `
      <g id="grid" aria-hidden="true">
        <path d="${minorLines.join(" ")}" fill="none" stroke="${minor}" stroke-width="0.35"/>
        <path d="${majorLines.join(" ")}" fill="none" stroke="${major}" stroke-width="0.45"/>
      </g>
    `;
  }

  function artworkInnerMarkup(options = {}) {
    const {
      geometry = buildGeometry(),
      invert = false,
      interactive = false,
      includeBackground = false,
      includeGuides = false,
      idPrefix = "",
    } = options;
    const ink = invert ? "#f7f6f0" : "#171816";
    const background = invert ? "#171816" : "#fffefa";
    const axisColor = invert ? "#8c8f85" : "#a4a69d";
    const shapes = shapeMarkup({
      geometry,
      invert,
      interactive,
      idPrefix,
    });
    return `
      ${
        includeBackground
          ? `<rect class="artboard-bg" width="${VIEW_SIZE}" height="${VIEW_SIZE}" fill="${background}"/>`
          : ""
      }
      ${includeGuides ? gridMarkup(invert) : ""}
      ${
        includeGuides
          ? `<g id="${idPrefix}axis-guide" aria-hidden="true" transform="rotate(${state.axis - 90} ${CENTER} ${CENTER})">
              <line class="axis-line" x1="${CENTER}" y1="7" x2="${CENTER}" y2="${
                VIEW_SIZE - 7
              }" stroke="${axisColor}"/>
              <circle class="axis-center" cx="${CENTER}" cy="7" r="1.7" fill="#d7ff54" stroke="${ink}" stroke-width="0.65"/>
            </g>`
          : ""
      }
      <g id="${idPrefix}logo-mark" data-role="logo" transform="rotate(${state.axis - 90} ${CENTER} ${CENTER})">
        ${shapes.markup}
      </g>
    `;
  }

  function buildPreviewSvg(options = {}) {
    const {
      invert = false,
      label = "Trinode mark",
      className = "",
      idPrefix = "preview-",
    } = options;
    const geometry = options.geometry || buildGeometry();
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${VIEW_SIZE} ${VIEW_SIZE}" class="${className}" role="img" aria-label="${label}">
      ${artworkInnerMarkup({ geometry, invert, idPrefix })}
    </svg>`;
  }

  function renderMainSvg() {
    const geometry = buildGeometry();
    const invert = state.invert;
    const background = invert ? "#171816" : "#fffefa";
    elements.mainSvg.innerHTML = `
      <rect width="${VIEW_SIZE}" height="${VIEW_SIZE}" fill="${background}"/>
      ${artworkInnerMarkup({
        geometry,
        invert,
        interactive: true,
        includeGuides: true,
      })}
    `;
    elements.artboard.classList.toggle("inverted", invert);
  }

  function eyeIcon(hidden) {
    return `<svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8Z"/>
      <circle cx="8" cy="8" r="2.1"/>
      ${hidden ? '<path d="m2 2 12 12"/>' : ""}
    </svg>`;
  }

  function circleThumb() {
    return `<svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.1"/>
    </svg>`;
  }

  function pathThumb() {
    return `<svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.3 11.5c1-4.9 3.4-7 5.6-7 2.4 0 4.3 2.1 5.8 7-2.3-1.2-3.8-2.8-5.8-2.8-1.8 0-3.3 1.5-5.6 2.8Z"/>
    </svg>`;
  }

  function layerRowMarkup(item, type) {
    const isCircle = type === "circle";
    const hidden = isCircle
      ? state.hiddenCircles.has(item.id)
      : state.hiddenPaths.has(item.id);
    const selected = !isCircle && state.selectedPaths.has(item.id);
    const inMerge = !isCircle && state.merged?.ids.includes(item.id);
    const classes = ["layer-row"];
    if (selected) classes.push("selected");
    if (inMerge) classes.push("merged-source");
    return `<li class="${classes.join(" ")}" data-${type}-id="${item.id}"${
      isCircle ? "" : ' tabindex="0"'
    }>
      <span class="layer-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      <span class="layer-thumb" aria-hidden="true">${
        isCircle ? circleThumb() : pathThumb()
      }</span>
      <span class="layer-copy">
        <span class="layer-name">${item.name}</span>
        <span class="layer-type">${
          isCircle ? "CIRCLE / NODE" : inMerge ? "MERGED SOURCE" : "CUBIC / 2 ANCHORS"
        }</span>
      </span>
      <span class="layer-anchor-count">${
        isCircle ? `R ${fmt(NODE_RADIUS)}` : "02"
      }</span>
      <button class="visibility-button ${hidden ? "hidden" : ""}"
        data-toggle-${type}="${item.id}"
        aria-label="${hidden ? "显示" : "隐藏"}${item.name}"
        title="${hidden ? "显示" : "隐藏"}${item.name}">
        ${eyeIcon(hidden)}
      </button>
    </li>`;
  }

  function mergedLayerMarkup() {
    const geometry = buildGeometry();
    const sources = geometry.paths.filter((path) =>
      state.merged.ids.includes(path.id),
    );
    const result = mergePathGeometry(sources);
    return `<li class="layer-row merged-result" data-merged-row="true" tabindex="0"
      title="复合路径，点击可拆回源路径">
      <span class="layer-check" aria-hidden="true">C</span>
      <span class="layer-thumb" aria-hidden="true">${pathThumb()}</span>
      <span class="layer-copy">
        <span class="layer-name">复合路径 ${String(sources.length).padStart(2, "0")}</span>
        <span class="layer-type">${result.subpaths} SUBPATH${
          result.subpaths === 1 ? "" : "S"
        } / ${result.anchors.length} ANCHORS</span>
      </span>
      <span class="layer-anchor-count">${String(result.anchors.length).padStart(2, "0")}</span>
      <span class="visibility-button" aria-hidden="true">${eyeIcon(false)}</span>
    </li>`;
  }

  function renderLayers() {
    const geometry = buildGeometry();
    elements.circleLayerList.innerHTML = geometry.circles
      .map((circle) => layerRowMarkup(circle, "circle"))
      .join("");
    elements.pathLayerList.innerHTML =
      (state.merged ? mergedLayerMarkup() : "") +
      geometry.paths.map((path) => layerRowMarkup(path, "path")).join("");

    elements.layerCount.textContent = String(
      geometry.paths.length + geometry.circles.length,
    ).padStart(2, "0");
    elements.mergeButton.disabled =
      state.selectedPaths.size < 2 || Boolean(state.merged);
    elements.unmergeButton.hidden = !state.merged;
    elements.selectionStatus.textContent = state.merged
      ? `${state.merged.ids.length} 条路径已合并为复合路径`
      : state.selectedPaths.size
        ? `已选择 ${state.selectedPaths.size} 条路径`
        : "未选择路径";
  }

  function setRangeProgress(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty(
      "--range-progress",
      `${((value - min) / (max - min)) * 100}%`,
    );
  }

  function renderControls() {
    elements.axisRange.value = state.axis;
    elements.radiusRange.value = state.radius;
    elements.strokeRange.value = state.stroke;
    elements.axisValue.textContent = `${state.axis}°`;
    elements.radiusValue.textContent = `${state.radius}%`;
    elements.strokeValue.textContent = `${state.stroke} px`;
    elements.axisLabel.textContent = `AXIS ${String(state.axis).padStart(3, "0")}°`;
    elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    elements.snapState.textContent = state.showGrid ? "ON" : "OFF";
    elements.gridToggle.classList.toggle("active", state.showGrid);
    elements.gridToggle.setAttribute("aria-pressed", String(state.showGrid));
    document.querySelectorAll("[data-invert]").forEach((button) => {
      button.classList.toggle(
        "active",
        String(state.invert) === button.dataset.invert,
      );
    });
    [elements.axisRange, elements.radiusRange, elements.strokeRange].forEach(
      setRangeProgress,
    );
    elements.artboard.style.transform = `scale(${state.zoom})`;
  }

  function renderLargePreviews() {
    const geometry = buildGeometry();
    elements.previewPositive.innerHTML = buildPreviewSvg({
      geometry,
      invert: false,
      label: "黑白标志预览",
      idPrefix: "positive-",
    });
    elements.previewNegative.innerHTML = buildPreviewSvg({
      geometry,
      invert: true,
      label: "反白标志预览",
      idPrefix: "negative-",
    });
  }

  function createRasterCanvas(size, invert) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.setAttribute("aria-label", `${size} 像素标志预览`);
    return canvas;
  }

  function rasterizeInto(container, size, invert, token) {
    const canvas = createRasterCanvas(size, invert);
    const context = canvas.getContext("2d");
    if (!context) return;
    const svgText = buildPreviewSvg({
      invert,
      label: "24 像素测试",
      idPrefix: "raster-",
    });
    const image = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    image.onload = () => {
      if (token !== state.rasterToken) return;
      context.clearRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      container.replaceChildren(canvas);
    };
    image.src = url;
  }

  function renderPixelPreviews() {
    const token = ++state.rasterToken;
    rasterizeInto(elements.actual24, 24, false, token);
    rasterizeInto(elements.previewSmallActual, 24, false, token);
    rasterizeInto(elements.previewSmallEnlarged, 24, false, token);
  }

  function renderAll() {
    renderMainSvg();
    renderLayers();
    renderControls();
    renderLargePreviews();
    renderPixelPreviews();
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 2600);
  }

  function escapeXml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function buildExportSvg(options = {}) {
    const invert = options.invert ?? state.invert;
    const geometry = buildGeometry();
    const shapes = shapeMarkup({
      geometry,
      invert,
      showSelection: false,
    });
    const mergedInfo = state.merged
      ? {
          ids: state.merged.ids,
          ...mergePathGeometry(
            geometry.paths.filter((path) =>
              state.merged.ids.includes(path.id),
            ),
          ),
        }
      : null;
    const metadata = {
      schema: "sixfold-editable-mark/v1",
      name: "Trinode / 三节点",
      variant: invert ? "negative" : "positive",
      grid: 8,
      viewBox: [0, 0, VIEW_SIZE, VIEW_SIZE],
      symmetryAxis: state.axis,
      cornerRadius: state.radius,
      strokeWidth: state.stroke,
      pathCount: geometry.paths.length,
      circleCount: geometry.circles.length,
      hiddenPaths: [...state.hiddenPaths],
      hiddenCircles: [...state.hiddenCircles],
      merged: mergedInfo
        ? {
            sourceIds: mergedInfo.sourceIds,
            subpaths: mergedInfo.subpaths,
            anchorCount: mergedInfo.anchors.length,
            originalAnchorCount: mergedInfo.originalAnchorCount,
          }
        : null,
    };

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" width="${VIEW_SIZE}" height="${VIEW_SIZE}" viewBox="0 0 ${VIEW_SIZE} ${VIEW_SIZE}" data-design-schema="sixfold-editable-mark-v1" data-variant="${
      invert ? "negative" : "positive"
    }">
  <title>Trinode / 三节点标志</title>
  <desc>六条三次贝塞尔路径与三个圆形节点组成的可编辑标志。</desc>
  <metadata id="sixfold-mark-metadata">${escapeXml(JSON.stringify(metadata))}</metadata>
  <g id="trinode-mark" data-role="logo" data-editable="true"
     data-symmetry-axis="${state.axis}" data-corner-radius="${state.radius}"
     transform="rotate(${state.axis - 90} ${CENTER} ${CENTER})">
    ${shapes.markup}
  </g>
</svg>`;
  }

  function downloadSvg() {
    const invert = state.invert;
    const svg = buildExportSvg({ invert });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sixfold-trinode-${invert ? "negative" : "positive"}.svg`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    showToast(
      `已导出 ${invert ? "反白" : "黑白"} SVG · 结构图层已保留`,
    );
  }

  function mergeSelectedPaths() {
    if (state.selectedPaths.size < 2) return;
    const geometry = buildGeometry();
    const sources = selectedGeometry(geometry);
    const merged = mergePathGeometry(sources);
    state.merged = { ids: sources.map((path) => path.id) };
    for (const path of sources) state.hiddenPaths.delete(path.id);
    state.selectedPaths.clear();
    renderAll();
    showToast(
      `已合并 ${sources.length} 条路径 · ${merged.originalAnchorCount} → ${merged.anchors.length} 个锚点`,
    );
  }

  function unmergePaths(selectSources = true) {
    if (!state.merged) return;
    const ids = state.merged.ids;
    state.merged = null;
    state.selectedPaths = selectSources ? new Set(ids) : new Set();
    renderAll();
    showToast("已拆回源路径 · 编辑结构完整");
  }

  function togglePathSelection(pathId) {
    if (state.merged?.ids.includes(pathId)) {
      state.merged = null;
    }
    if (state.selectedPaths.has(pathId)) {
      state.selectedPaths.delete(pathId);
    } else {
      state.selectedPaths.add(pathId);
    }
    renderAll();
  }

  function togglePathVisibility(pathId) {
    if (state.merged?.ids.includes(pathId)) {
      state.merged = null;
      state.selectedPaths.clear();
    }
    if (state.hiddenPaths.has(pathId)) {
      state.hiddenPaths.delete(pathId);
    } else {
      state.hiddenPaths.add(pathId);
    }
    renderAll();
  }

  function toggleCircleVisibility(circleId) {
    if (state.hiddenCircles.has(circleId)) {
      state.hiddenCircles.delete(circleId);
    } else {
      state.hiddenCircles.add(circleId);
    }
    renderAll();
  }

  function toggleAllPaths() {
    if (state.merged) {
      unmergePaths();
      return;
    }
    const geometry = buildGeometry();
    const allSelected = geometry.paths.every((path) =>
      state.selectedPaths.has(path.id),
    );
    state.selectedPaths = allSelected ? new Set() : new Set(
      geometry.paths.map((path) => path.id),
    );
    renderAll();
  }

  function resetDesign() {
    state.axis = defaults.axis;
    state.radius = defaults.radius;
    state.stroke = defaults.stroke;
    state.invert = defaults.invert;
    state.showGrid = defaults.showGrid;
    state.zoom = defaults.zoom;
    state.selectedPaths.clear();
    state.hiddenPaths.clear();
    state.hiddenCircles.clear();
    state.merged = null;
    renderAll();
    showToast("已恢复 Trinode 默认造型");
  }

  function bindEvents() {
    elements.axisRange.addEventListener("input", (event) => {
      state.axis = Number(event.target.value);
      renderAll();
    });
    elements.radiusRange.addEventListener("input", (event) => {
      state.radius = Number(event.target.value);
      renderAll();
    });
    elements.strokeRange.addEventListener("input", (event) => {
      state.stroke = Number(event.target.value);
      renderAll();
    });

    document.querySelectorAll("[data-invert]").forEach((button) => {
      button.addEventListener("click", () => {
        state.invert = button.dataset.invert === "true";
        renderAll();
      });
    });

    elements.gridToggle.addEventListener("click", () => {
      state.showGrid = !state.showGrid;
      renderAll();
    });

    elements.zoomIn.addEventListener("click", () => {
      state.zoom = Math.min(1.4, Number((state.zoom + 0.1).toFixed(1)));
      renderControls();
    });
    elements.zoomOut.addEventListener("click", () => {
      state.zoom = Math.max(0.7, Number((state.zoom - 0.1).toFixed(1)));
      renderControls();
    });

    elements.pathLayerList.addEventListener("click", (event) => {
      const visibility = event.target.closest("[data-toggle-path]");
      if (visibility) {
        event.stopPropagation();
        togglePathVisibility(visibility.dataset.togglePath);
        return;
      }
      const mergedRow = event.target.closest("[data-merged-row]");
      if (mergedRow) {
        unmergePaths();
        return;
      }
      const row = event.target.closest("[data-path-id]");
      if (row) togglePathSelection(row.dataset.pathId);
    });

    elements.circleLayerList.addEventListener("click", (event) => {
      const visibility = event.target.closest("[data-toggle-circle]");
      if (visibility) {
        toggleCircleVisibility(visibility.dataset.toggleCircle);
      }
    });

    elements.pathLayerList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest(".visibility-button")) return;
      const row = event.target.closest("[data-path-id], [data-merged-row]");
      if (!row) return;
      event.preventDefault();
      if (row.dataset.mergedRow) unmergePaths();
      else togglePathSelection(row.dataset.pathId);
    });

    elements.mergeButton.addEventListener("click", mergeSelectedPaths);
    elements.unmergeButton.addEventListener("click", () => unmergePaths());
    elements.selectAllButton.addEventListener("click", toggleAllPaths);
    elements.resetButton.addEventListener("click", resetDesign);
    elements.exportButton.addEventListener("click", downloadSvg);

    elements.mainSvg.addEventListener("click", (event) => {
      const hit = event.target.closest("[data-path-id]");
      if (!hit || state.merged) return;
      togglePathSelection(hit.dataset.pathId);
    });
  }

  bindEvents();
  renderAll();
})();
