(function () {
  "use strict";

  const scene = window.PanoScene;
  const engine = window.PanoStitch;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const refs = {
    sourceList: $("#sourceList"),
    transformStack: $("#transformStack"),
    panorama: $("#panoramaCanvas"),
    overlay: $("#overlayCanvas"),
    wrap: $("#canvasWrap"),
    emptyState: $("#emptyState"),
    stageMeta: $("#stageMeta"),
    maxSeam: $("#maxSeamInline"),
    continuity: $("#continuityInline"),
    alignment: $("#alignmentInline"),
    tagA: $("#overlapTagA"),
    tagB: $("#overlapTagB"),
    blend: $("#blendRange"),
    blendOutput: $("#blendOutput"),
    threshold: $("#thresholdRange"),
    thresholdValue: $("#thresholdValue"),
    thresholdCard: $("#thresholdCard"),
    gateStatus: $("#gateStatus"),
    gateText: $("#gateText"),
    exportButton: $("#exportButton"),
    exportNote: $("#exportNote"),
    zoomA: $("#zoomCanvasA"),
    zoomB: $("#zoomCanvasB"),
    cardA: $("#zoomCardA"),
    cardB: $("#zoomCardB"),
    badgeA: $("#qualityBadgeA"),
    badgeB: $("#qualityBadgeB"),
    continuityA: $("#continuityA"),
    continuityB: $("#continuityB"),
    deltaA: $("#deltaA"),
    deltaB: $("#deltaB"),
    gradientA: $("#gradientA"),
    gradientB: $("#gradientB"),
    healthA: $("#healthA"),
    healthB: $("#healthB"),
    healthTextA: $("#healthTextA"),
    healthTextB: $("#healthTextB"),
    stripThreshold: $("#stripThreshold"),
    toast: $("#toast"),
    helpModal: $("#helpModal")
  };

  const state = {
    frames: [],
    transforms: [],
    defaults: [],
    blend: 72,
    threshold: 1.5,
    showOverlay: true,
    showSeamLine: true,
    view: "stitch",
    result: null,
    renderQueued: false,
    lastExport: null
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatSigned(value, digits) {
    const fixed = Number(value).toFixed(digits);
    return `${Number(fixed) >= 0 ? "+" : ""}${fixed}`;
  }

  function showToast(message, isError) {
    refs.toast.textContent = message;
    refs.toast.classList.toggle("is-error", Boolean(isError));
    refs.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => refs.toast.classList.remove("is-visible"), 3000);
  }

  function seedDefaults() {
    state.defaults = state.frames.map((frame) => ({
      x: frame.defaultX,
      y: 0,
      rotation: 0,
      exposure: frame.defaultExposure
    }));
    state.transforms = state.defaults.map((transform) => ({ ...transform }));
  }

  function buildSourceCards() {
    refs.sourceList.innerHTML = "";
    state.frames.forEach((frame, index) => {
      const card = document.createElement("article");
      card.className = "source-card";
      card.innerHTML = `
        <div class="source-thumb">
          <span class="source-badge"><i></i>程序生成</span>
          <span class="source-index">0${index + 1}</span>
        </div>
        <div class="source-info">
          <div>
            <strong>${frame.name}</strong>
            <small>720 × 720 · X ${frame.defaultX}</small>
          </div>
          <span class="source-ev">${formatSigned(frame.defaultExposure, 2)} EV</span>
        </div>
      `;
      const thumb = $(".source-thumb", card);
      frame.canvas.style.width = "100%";
      frame.canvas.style.height = "100%";
      frame.canvas.style.objectFit = "cover";
      thumb.appendChild(frame.canvas);
      refs.sourceList.appendChild(card);
    });
  }

  function sliderFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = ((value - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${percent}%`);
  }

  function buildTransformControls() {
    refs.transformStack.innerHTML = "";
    state.frames.forEach((frame, index) => {
      const transform = state.transforms[index];
      const card = document.createElement("article");
      card.className = "transform-card";
      card.innerHTML = `
        <div class="transform-head">
          <span class="transform-number">0${index + 1}</span>
          <span class="transform-name">
            <strong>${frame.name}</strong>
            <small>锚点 X ${frame.defaultX} · Y 0</small>
          </span>
          <button class="transform-reset" type="button" aria-label="重置第 ${index + 1} 帧" data-reset="${index}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v5h5M20 20v-5h-5M5.5 9a7.5 7.5 0 0 1 12.8-1M18.5 15a7.5 7.5 0 0 1-12.8 1"/></svg>
          </button>
        </div>
        <div class="mini-control">
          <label for="rotation-${index}">旋转</label>
          <input id="rotation-${index}" type="range" min="-2.5" max="2.5" step="0.05" value="${transform.rotation}" data-transform="${index}" data-property="rotation" />
          <output id="rotation-output-${index}">${formatSigned(transform.rotation, 2)}°</output>
        </div>
        <div class="mini-control">
          <label for="exposure-${index}">曝光</label>
          <input id="exposure-${index}" type="range" min="-1" max="1" step="0.01" value="${transform.exposure}" data-transform="${index}" data-property="exposure" />
          <output id="exposure-output-${index}">${formatSigned(transform.exposure, 2)} EV</output>
        </div>
      `;
      refs.transformStack.appendChild(card);
    });

    $$("input[data-transform]", refs.transformStack).forEach((input) => {
      sliderFill(input);
      input.addEventListener("input", handleTransformInput);
    });
    $$("[data-reset]", refs.transformStack).forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.reset);
        state.transforms[index] = { ...state.defaults[index] };
        buildTransformControls();
        scheduleRender();
        showToast(`第 0${index + 1} 帧的变换已重置`);
      });
    });
  }

  function handleTransformInput(event) {
    const input = event.currentTarget;
    const index = Number(input.dataset.transform);
    const property = input.dataset.property;
    const value = Number(input.value);
    state.transforms[index][property] = value;
    const output = $(`#${property}-output-${index}`);
    output.textContent = property === "rotation"
      ? `${formatSigned(value, 2)}°`
      : `${formatSigned(value, 2)} EV`;
    sliderFill(input);
    scheduleRender();
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      renderStitch();
    });
  }

  function setTextNumber(element, value, suffix) {
    element.innerHTML = `${value}<small>${suffix}</small>`;
  }

  function renderStitch() {
    if (!state.frames.length) return;
    const startedAt = performance.now();
    const result = engine.stitch(state.frames, state.transforms, {
      blend: state.blend,
      includeDifference: state.view === "difference"
    });
    state.result = result;

    const panoContext = refs.panorama.getContext("2d");
    panoContext.clearRect(0, 0, engine.WORLD_WIDTH, engine.WORLD_HEIGHT);
    panoContext.drawImage(
      state.view === "difference" && result.differenceMap ? result.differenceMap : result.composite,
      0, 0
    );
    panoContext.imageSmoothingEnabled = true;

    drawOverlay(result);
    updateMetrics(result);
    drawZoomPanels(result);
    refs.emptyState.hidden = true;
    refs.stageMeta.textContent = `1720 × 720 PX · ${Math.max(1, Math.round(performance.now() - startedAt))} MS`;
  }

  function makeHatchPattern(ctx) {
    if (!makeHatchPattern.pattern) {
      const tile = document.createElement("canvas");
      tile.width = 12;
      tile.height = 12;
      const tileContext = tile.getContext("2d");
      tileContext.strokeStyle = "rgba(255, 181, 88, 0.18)";
      tileContext.lineWidth = 1;
      tileContext.beginPath();
      tileContext.moveTo(0, 12);
      tileContext.lineTo(12, 0);
      tileContext.stroke();
      makeHatchPattern.pattern = ctx.createPattern(tile, "repeat");
    }
    return makeHatchPattern.pattern;
  }

  function drawOverlay(result) {
    const ctx = refs.overlay.getContext("2d");
    ctx.clearRect(0, 0, engine.WORLD_WIDTH, engine.WORLD_HEIGHT);
    const visible = state.showOverlay && state.view === "stitch";
    refs.tagA.style.opacity = visible ? "1" : "0";
    refs.tagB.style.opacity = visible ? "1" : "0";
    if (!visible) return;

    const hatch = makeHatchPattern(ctx);
    result.seams.forEach((seam) => {
      const [start, end] = seam.range;
      ctx.fillStyle = "rgba(255, 181, 88, 0.11)";
      ctx.fillRect(start, 1, end - start, engine.WORLD_HEIGHT - 2);
      ctx.fillStyle = hatch;
      ctx.fillRect(start, 1, end - start, engine.WORLD_HEIGHT - 2);

      ctx.strokeStyle = "rgba(255, 181, 88, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(start + 0.5, 0);
      ctx.lineTo(start + 0.5, engine.WORLD_HEIGHT);
      ctx.moveTo(end - 0.5, 0);
      ctx.lineTo(end - 0.5, engine.WORLD_HEIGHT);
      ctx.stroke();

      ctx.strokeStyle = "rgba(213, 244, 92, 0.68)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(seam.centerX + 0.5, 0);
      ctx.lineTo(seam.centerX + 0.5, engine.WORLD_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(213, 244, 92, 0.9)";
      ctx.beginPath();
      ctx.moveTo(seam.centerX - 4, 0);
      ctx.lineTo(seam.centerX + 4, 0);
      ctx.lineTo(seam.centerX, 7);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(seam.centerX - 4, engine.WORLD_HEIGHT);
      ctx.lineTo(seam.centerX + 4, engine.WORLD_HEIGHT);
      ctx.lineTo(seam.centerX, engine.WORLD_HEIGHT - 7);
      ctx.closePath();
      ctx.fill();
    });
  }

  function setWarning(element, warning) {
    element.classList.toggle("is-warning", warning);
  }

  function updateMetrics(result) {
    const seamA = result.seams[0];
    const seamB = result.seams[1];
    const gatePassed = result.maxError <= state.threshold;
    const rotations = state.transforms.map((transform) => Math.abs(transform.rotation));
    const rotationDeviation = rotations.reduce((sum, value) => sum + value, 0) / rotations.length;

    setTextNumber(refs.maxSeam, result.maxError.toFixed(2), "%");
    setTextNumber(refs.continuity, result.minContinuity.toFixed(1), "%");
    refs.maxSeam.style.color = gatePassed ? "var(--paper)" : "var(--danger)";
    refs.continuity.style.color = result.minContinuity < 92 ? "var(--amber)" : "var(--paper)";
    refs.alignment.textContent = rotationDeviation < 0.025
      ? "三帧旋转已对齐"
      : `平均旋转补偿 ${rotationDeviation.toFixed(2)}°`;
    refs.alignment.classList.toggle("is-good", rotationDeviation < 0.025);
    refs.alignment.classList.toggle("is-bad", rotationDeviation > 1.2);

    [seamA, seamB].forEach((seam, index) => {
      const tag = index === 0 ? refs.tagA : refs.tagB;
      const errorElement = $("em", tag);
      errorElement.textContent = `${seam.error.toFixed(2)}%`;
      errorElement.classList.toggle("is-bad", seam.error > state.threshold);
      tag.style.left = `${(seam.centerX / engine.WORLD_WIDTH) * 100}%`;
    });

    refs.thresholdValue.textContent = `${state.threshold.toFixed(2)}%`;
    refs.stripThreshold.textContent = `${state.threshold.toFixed(2)}%`;
    refs.gateStatus.classList.toggle("is-pass", gatePassed);
    refs.gateStatus.classList.toggle("is-blocked", !gatePassed);
    refs.gateText.textContent = gatePassed
      ? "误差低于阈值，可以导出"
      : `导出已阻止：最高 ${result.maxError.toFixed(2)}%`;
    refs.exportButton.classList.toggle("is-locked", !gatePassed);
    refs.exportButton.setAttribute("aria-disabled", String(!gatePassed));
    refs.exportNote.textContent = gatePassed
      ? "导出将同时保存全分辨率 PNG 与全部变换参数。"
      : `请调整变换或融合参数，使误差降至 ${state.threshold.toFixed(2)}% 以下。`;

    const cards = [
      [seamA, refs.cardA, refs.badgeA, refs.continuityA, refs.deltaA, refs.gradientA],
      [seamB, refs.cardB, refs.badgeB, refs.continuityB, refs.deltaB, refs.gradientB]
    ];
    cards.forEach(([seam, card, badge, continuity, delta, gradient]) => {
      const warning = seam.error > state.threshold;
      setWarning(card, warning);
      setWarning(badge, warning);
      badge.textContent = warning ? "超阈值" : "连接平滑";
      continuity.textContent = `${seam.continuity.toFixed(1)}%`;
      continuity.classList.toggle("is-warning", seam.continuity < 90);
      delta.textContent = seam.delta.toFixed(1);
      gradient.textContent = `${seam.ratio.toFixed(2)}×`;
    });

    [
      [seamA, refs.healthA, refs.healthTextA],
      [seamB, refs.healthB, refs.healthTextB]
    ].forEach(([seam, bar, text]) => {
      const warning = seam.error > state.threshold;
      bar.style.width = `${clamp((seam.error / state.threshold) * 100, 2, 100)}%`;
      bar.classList.toggle("is-bad", warning);
      text.textContent = `${seam.error.toFixed(2)}%`;
      text.classList.toggle("is-bad", warning);
    });
  }

  function drawZoomFrame(ctx, result, seam, sourceY, label) {
    const sourceWidth = 360;
    const sourceHeight = 120;
    const sourceX = seam.centerX - sourceWidth / 2;
    ctx.clearRect(0, 0, 900, 300);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      result.composite,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, 900, 300
    );

    const seamCanvasX = (seam.centerX - sourceX) * 2.5;
    if (state.showSeamLine) {
      ctx.fillStyle = "rgba(255, 181, 88, 0.14)";
      ctx.fillRect(seamCanvasX - 16, 0, 32, 300);
      ctx.strokeStyle = "rgba(255, 209, 141, 0.92)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(seamCanvasX + 0.5, 0);
      ctx.lineTo(seamCanvasX + 0.5, 300);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "rgba(7, 14, 13, 0.78)";
    ctx.fillRect(0, 0, 76, 19);
    ctx.fillStyle = "#d5f45c";
    ctx.font = "600 10px 'IBM Plex Mono', monospace";
    ctx.fillText(label, 9, 13);
    ctx.fillStyle = "rgba(7, 14, 13, 0.78)";
    ctx.fillRect(0, 281, 196, 19);
    ctx.fillStyle = "rgba(233, 232, 220, 0.78)";
    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.fillText(`${sourceWidth * 2.5} × ${sourceHeight * 2.5} PX`, 9, 294);

    ctx.strokeStyle = "rgba(233, 232, 220, 0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 899, 299);
  }

  function drawZoomPanels(result) {
    const ctxA = refs.zoomA.getContext("2d", { willReadFrequently: true });
    const ctxB = refs.zoomB.getContext("2d", { willReadFrequently: true });
    drawZoomFrame(ctxA, result, result.seams[0], 325, `${result.seams[0].id} / SEAM 01–02`);
    drawZoomFrame(ctxB, result, result.seams[1], 273, `${result.seams[1].id} / SEAM 02–03`);
  }

  function buildTransformParams(result) {
    const passed = result.maxError <= state.threshold;
    return {
      schemaVersion: 1,
      project: "海湾黄昏 · 三帧",
      generatedAt: new Date().toISOString(),
      canvas: {
        width: engine.WORLD_WIDTH,
        height: engine.WORLD_HEIGHT,
        output: "panorama.png",
        colorSpace: "sRGB"
      },
      sources: state.frames.map((frame, index) => ({
        id: frame.id,
        file: frame.name,
        size: [scene.FRAME_WIDTH, scene.FRAME_HEIGHT],
        cropX: frame.cropX,
        capturedExposure: frame.capturedExposure,
        transform: {
          x: Number(state.transforms[index].x.toFixed(2)),
          y: Number(state.transforms[index].y.toFixed(2)),
          rotationDeg: Number(state.transforms[index].rotation.toFixed(3)),
          exposureEV: Number(state.transforms[index].exposure.toFixed(3))
        }
      })),
      stitching: {
        blendMode: "weighted-linear-feather",
        blendAmount: state.blend / 100,
        overlapPx: engine.OVERLAP
      },
      validation: {
        passed,
        thresholdPct: state.threshold,
        maxErrorPct: Number(result.maxError.toFixed(4)),
        minContinuityPct: Number(result.minContinuity.toFixed(3)),
        seams: result.seams.map((seam) => ({
          id: seam.id,
          pair: seam.pair,
          centerX: seam.centerX,
          overlapRange: seam.range,
          errorPct: Number(seam.error.toFixed(4)),
          meanChannelDelta: Number(seam.delta.toFixed(4)),
          continuityPct: Number(seam.continuity.toFixed(3)),
          gradientRatio: Number(seam.ratio.toFixed(4))
        }))
      }
    };
  }

  function downloadUrl(url, filename) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function createExportBundle() {
    projectCurrentState();
    const result = state.result;
    const params = buildTransformParams(result);
    return {
      pngDataUrl: result.composite.toDataURL("image/png"),
      jsonText: JSON.stringify(params, null, 2),
      zoomADataUrl: refs.zoomA.toDataURL("image/png"),
      zoomBDataUrl: refs.zoomB.toDataURL("image/png"),
      params,
      result
    };
  }

  function projectCurrentState() {
    if (state.renderQueued || !state.result) {
      state.renderQueued = false;
      renderStitch();
    }
  }

  function handleExport() {
    projectCurrentState();
    const result = state.result;
    if (result.maxError > state.threshold) {
      const worst = result.seams.reduce((current, seam) => (
        seam.error > current.error ? seam : current
      ), result.seams[0]);
      showToast(
        `导出已阻止：接缝 ${worst.id} 误差 ${worst.error.toFixed(2)}% 超过阈值 ${state.threshold.toFixed(2)}%`,
        true
      );
      refs.thresholdCard.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-4px)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(0)" }
        ],
        { duration: 220, easing: "ease-out" }
      );
      return;
    }

    const bundle = createExportBundle();
    downloadUrl(bundle.pngDataUrl, "panorama.png");
    const jsonUrl = URL.createObjectURL(new Blob([bundle.jsonText], { type: "application/json" }));
    downloadUrl(jsonUrl, "transform-params.json");
    setTimeout(() => URL.revokeObjectURL(jsonUrl), 3000);
    state.lastExport = {
      filenames: ["panorama.png", "transform-params.json"],
      params: bundle.params
    };
    showToast(`导出成功：panorama.png + transform-params.json · 最高误差 ${result.maxError.toFixed(2)}%`);
    refs.exportNote.textContent = "已导出 PNG 与变换参数。调整参数后可再次导出。";
  }

  function syncAutoAlignControls() {
    state.blend = 72;
    state.threshold = 1.5;
    refs.blend.value = "72";
    refs.blendOutput.textContent = "72%";
    refs.threshold.value = "1.5";
    refs.thresholdValue.textContent = "1.50%";
    sliderFill(refs.blend);
    sliderFill(refs.threshold);
    buildTransformControls();
  }

  function handleAutoAlign() {
    state.transforms = state.defaults.map((transform) => ({ ...transform }));
    syncAutoAlignControls();
    renderStitch();
    showToast("已恢复三帧锚点与曝光补偿，并重新计算接缝");
  }

  function bindEvents() {
    refs.blend.addEventListener("input", () => {
      state.blend = Number(refs.blend.value);
      refs.blendOutput.textContent = `${state.blend}%`;
      sliderFill(refs.blend);
      scheduleRender();
    });

    refs.threshold.addEventListener("input", () => {
      state.threshold = Number(refs.threshold.value);
      refs.thresholdValue.textContent = `${state.threshold.toFixed(2)}%`;
      sliderFill(refs.threshold);
      if (state.result) updateMetrics(state.result);
    });

    $("#overlayToggle").addEventListener("click", (event) => {
      state.showOverlay = !state.showOverlay;
      event.currentTarget.setAttribute("aria-pressed", String(state.showOverlay));
      drawOverlay(state.result);
    });

    $("#seamLineToggle").addEventListener("click", (event) => {
      state.showSeamLine = !state.showSeamLine;
      event.currentTarget.setAttribute("aria-pressed", String(state.showSeamLine));
      drawZoomPanels(state.result);
    });

    $$(".view-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".view-tab").forEach((button) => button.classList.remove("active"));
        tab.classList.add("active");
        state.view = tab.dataset.view;
        scheduleRender();
      });
    });

    $("#autoAlignButton").addEventListener("click", handleAutoAlign);
    $("#resetViewButton").addEventListener("click", handleAutoAlign);
    refs.exportButton.addEventListener("click", handleExport);

    $("#helpButton").addEventListener("click", () => {
      refs.helpModal.hidden = false;
      $("#closeHelp").focus();
    });
    const closeHelp = () => {
      refs.helpModal.hidden = true;
      $("#helpButton").focus();
    };
    $("#closeHelp").addEventListener("click", closeHelp);
    $("#modalStart").addEventListener("click", closeHelp);
    refs.helpModal.addEventListener("click", (event) => {
      if (event.target === refs.helpModal) closeHelp();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !refs.helpModal.hidden) closeHelp();
    });
  }

  function init() {
    const frames = scene.generateFrames();
    state.frames = frames.frames;
    seedDefaults();
    buildSourceCards();
    buildTransformControls();
    bindEvents();
    sliderFill(refs.blend);
    sliderFill(refs.threshold);
    refs.emptyState.hidden = false;

    requestAnimationFrame(() => {
      renderStitch();
    });
  }

  window.panoLab = {
    getState() {
      projectCurrentState();
      return {
        transforms: state.transforms.map((transform) => ({ ...transform })),
        blend: state.blend,
        threshold: state.threshold,
        maxError: state.result.maxError,
        minContinuity: state.result.minContinuity,
        seams: state.result.seams.map((seam) => ({
          id: seam.id,
          error: seam.error,
          continuity: seam.continuity,
          delta: seam.delta,
          ratio: seam.ratio
        }))
      };
    },
    createExportBundle,
    exportFiles() {
      handleExport();
      return state.lastExport;
    },
    setTransform(index, property, value) {
      state.transforms[index][property] = Number(value);
      const input = $(`#${property}-${index}`);
      const output = $(`#${property}-output-${index}`);
      if (input) {
        input.value = String(value);
        sliderFill(input);
      }
      if (output) {
        output.textContent = property === "rotation"
          ? `${formatSigned(value, 2)}°`
          : `${formatSigned(value, 2)} EV`;
      }
      renderStitch();
    },
    setBlend(value) {
      state.blend = Number(value);
      refs.blend.value = String(value);
      refs.blendOutput.textContent = `${state.blend}%`;
      sliderFill(refs.blend);
      renderStitch();
    },
    render: () => renderStitch()
  };

  init();
})();
