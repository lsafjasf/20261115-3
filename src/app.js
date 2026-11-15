(function () {
  "use strict";

  const Model = window.MixerModel;
  const TRACKS = Model.TRACKS;
  const engine = new window.MixerEngine();

  const refs = {
    ruler: document.getElementById("ruler"),
    tracksZone: document.getElementById("tracksZone"),
    trackRows: document.getElementById("trackRows"),
    playhead: document.getElementById("playhead"),
    playButton: document.getElementById("playButton"),
    restartButton: document.getElementById("restartButton"),
    timeNow: document.getElementById("timeNow"),
    audioState: document.getElementById("audioState"),
    snapReadout: document.getElementById("snapReadout"),
    channelStrips: document.getElementById("channelStrips"),
    exportButton: document.getElementById("exportButton"),
    masterExportButton: document.getElementById("masterExportButton"),
    statusMessage: document.getElementById("statusMessage"),
    meterL: document.getElementById("meterL"),
    meterR: document.getElementById("meterR"),
    peakReadout: document.getElementById("peakReadout"),
    guardBadge: document.getElementById("guardBadge"),
    toast: document.getElementById("toast"),
    toastIcon: document.getElementById("toastIcon"),
    toastTitle: document.getElementById("toastTitle"),
    toastText: document.getElementById("toastText")
  };

  const ui = {
    rows: new Map(),
    strips: new Map(),
    canvases: [],
    geometry: { left: 160, width: 1 },
    automationDrag: null,
    scrub: null,
    exporting: false,
    toastTimer: 0
  };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function formatTime(seconds, milliseconds) {
    const clamped = clamp(seconds, 0, Model.DURATION);
    const minutes = Math.floor(clamped / 60);
    const wholeSeconds = Math.floor(clamped % 60);
    const prefix = `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
    if (!milliseconds) return prefix;
    const millis = Math.floor((clamped % 1) * 1000);
    return `${prefix}.${String(millis).padStart(3, "0")}`;
  }

  function formatDb(value, digits) {
    if (!Number.isFinite(value)) return "-∞";
    return `${value.toFixed(digits == null ? 1 : digits)} dB`;
  }

  function formatPan(value) {
    if (Math.abs(value) < 0.005) return "C";
    const amount = Math.round(Math.abs(value) * 100);
    return `${value < 0 ? "L" : "R"} ${amount}`;
  }

  function formatFrequency(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
    return `${Math.round(value)} Hz`;
  }

  function cutoffFromSlider(position) {
    return 80 * Math.pow(18000 / 80, position / 100);
  }

  function sliderFromCutoff(cutoff) {
    return (Math.log(cutoff / 80) / Math.log(18000 / 80)) * 100;
  }

  function automationYPercent(gainDb) {
    const normalized =
      (gainDb - Model.MIN_AUTOMATION_DB) /
      (Model.MAX_AUTOMATION_DB - Model.MIN_AUTOMATION_DB);
    return 10 + (1 - normalized) * 80;
  }

  function gainFromYPercent(percent) {
    const normalized = 1 - (percent - 10) / 80;
    return Model.MIN_AUTOMATION_DB +
      normalized * (Model.MAX_AUTOMATION_DB - Model.MIN_AUTOMATION_DB);
  }

  function updateRangeFill(input) {
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const value = Number(input.value);
    const percent = ((value - minimum) / (maximum - minimum)) * 100;
    input.style.setProperty("--range-fill", `${clamp(percent, 0, 100)}%`);
  }

  function createRuler() {
    const fragment = document.createDocumentFragment();
    for (let second = 0; second <= Model.DURATION; second += 1) {
      const tick = document.createElement("div");
      tick.className = `ruler-tick ${second % 2 === 0 ? "major" : "minor"}`;
      tick.style.left = `${(second / Model.DURATION) * 100}%`;
      if (second % 2 === 0) {
        const label = document.createElement("span");
        label.textContent = `${second}s`;
        tick.appendChild(label);
      }
      fragment.appendChild(tick);
    }
    refs.ruler.replaceChildren(fragment);
  }

  function createTrackRows() {
    const fragment = document.createDocumentFragment();
    for (const track of TRACKS) {
      const row = document.createElement("div");
      row.className = "track-row";
      row.dataset.track = track.id;
      row.style.setProperty("--track", track.color);
      row.innerHTML = `
        <div class="track-meta">
          <span class="track-color" aria-hidden="true"></span>
          <div class="track-title">
            <span class="track-num">${track.number} · ${track.role}</span>
            <h3>${track.name}</h3>
            <p>${track.caption}</p>
          </div>
          <span class="track-status" aria-hidden="true"></span>
        </div>
        <div class="track-lane" data-lane="${track.id}" aria-label="${track.name} 编排区域">
          <canvas aria-hidden="true"></canvas>
          <svg class="automation-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <path class="auto-fill"></path>
            <path class="auto-zero"></path>
            <path class="auto-line"></path>
          </svg>
          <button class="auto-point" type="button" data-point="0" data-point-label="A"></button>
          <button class="auto-point" type="button" data-point="1" data-point-label="B"></button>
          <span class="track-muted-label">MUTED</span>
        </div>
      `;
      fragment.appendChild(row);

      const rowRecord = {
        element: row,
        lane: row.querySelector(".track-lane"),
        canvas: row.querySelector("canvas"),
        points: Array.from(row.querySelectorAll(".auto-point")),
        line: row.querySelector(".auto-line"),
        fill: row.querySelector(".auto-fill"),
        zero: row.querySelector(".auto-zero"),
        status: row.querySelector(".track-status")
      };
      ui.rows.set(track.id, rowRecord);
      rowRecord.points.forEach((point) => {
        point.addEventListener("pointerdown", (event) => beginAutomationDrag(event, track, point));
        point.addEventListener("pointerenter", () => showAutomationReadout(track.id, Number(point.dataset.point)));
      });
      rowRecord.lane.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".auto-point")) return;
        beginScrub(event, rowRecord.lane);
      });
    }
    refs.trackRows.replaceChildren(fragment);
  }

  function createChannelStrips() {
    const fragment = document.createDocumentFragment();
    for (const track of TRACKS) {
      const settings = engine.settings[track.id];
      const strip = document.createElement("article");
      strip.className = "channel";
      strip.dataset.track = track.id;
      strip.style.setProperty("--track", track.color);
      strip.innerHTML = `
        <header class="strip-head">
          <div>
            <p class="strip-index">${track.number} / ${track.role}</p>
            <h3>${track.name}</h3>
          </div>
          <button class="mute-button" type="button" data-control="mute" aria-pressed="false" aria-label="静音 ${track.name}">M</button>
        </header>
        <label class="control">
          <span class="control-head"><span>VOLUME</span><output data-output="volume"></output></span>
          <input type="range" data-control="volume" min="-60" max="6" step="0.5" value="${settings.volumeDb}" aria-label="${track.name} 音量">
        </label>
        <label class="control pan-control">
          <span class="control-head"><span>PAN</span><output data-output="pan"></output></span>
          <input type="range" data-control="pan" min="-100" max="100" step="1" value="${Math.round(settings.pan * 100)}" aria-label="${track.name} 声像">
        </label>
        <label class="control">
          <span class="control-head"><span>LOW PASS</span><output data-output="cutoff"></output></span>
          <input type="range" data-control="cutoff" min="0" max="100" step="0.25" value="${sliderFromCutoff(settings.cutoff)}" aria-label="${track.name} 低通频率">
        </label>
        <div class="channel-foot">
          <span class="channel-source"><i></i>LIVE STEM</span>
          <span class="channel-dot"></span>
        </div>
      `;
      fragment.appendChild(strip);

      const record = {
        element: strip,
        mute: strip.querySelector('[data-control="mute"]'),
        volume: strip.querySelector('[data-control="volume"]'),
        pan: strip.querySelector('[data-control="pan"]'),
        cutoff: strip.querySelector('[data-control="cutoff"]'),
        volumeOutput: strip.querySelector('[data-output="volume"]'),
        panOutput: strip.querySelector('[data-output="pan"]'),
        cutoffOutput: strip.querySelector('[data-output="cutoff"]')
      };
      ui.strips.set(track.id, record);

      record.volume.addEventListener("input", () => {
        const value = Number(record.volume.value);
        engine.setTrackSetting(track.id, "volumeDb", value);
        record.volumeOutput.textContent = formatDb(value);
        updateRangeFill(record.volume);
      });

      record.pan.addEventListener("input", () => {
        const value = Number(record.pan.value) / 100;
        engine.setTrackSetting(track.id, "pan", value);
        record.panOutput.textContent = formatPan(value);
        updateRangeFill(record.pan);
      });

      record.cutoff.addEventListener("input", () => {
        const cutoff = cutoffFromSlider(Number(record.cutoff.value));
        engine.setTrackSetting(track.id, "cutoff", cutoff);
        record.cutoffOutput.textContent = formatFrequency(cutoff);
        updateRangeFill(record.cutoff);
      });

      record.mute.addEventListener("click", () => {
        const nextMuted = !engine.settings[track.id].mute;
        engine.setTrackSetting(track.id, "mute", nextMuted);
        syncTrackControls(track.id);
      });
    }
    refs.channelStrips.replaceChildren(fragment);
  }

  function syncTrackControls(trackId) {
    const settings = engine.settings[trackId];
    const row = ui.rows.get(trackId);
    const strip = ui.strips.get(trackId);
    if (!row || !strip) return;
    row.element.classList.toggle("is-muted", settings.mute);
    strip.element.classList.toggle("is-muted", settings.mute);
    strip.mute.setAttribute("aria-pressed", String(settings.mute));
    strip.mute.setAttribute("aria-label", `${settings.mute ? "取消静音" : "静音"} ${TRACKS.find((track) => track.id === trackId).name}`);
  }

  function updateAutomation(trackId) {
    const row = ui.rows.get(trackId);
    if (!row) return;
    const points = engine.settings[trackId].automation;
    const pointA = points[0];
    const pointB = points[1];
    const xA = (pointA.time / Model.DURATION) * 1000;
    const xB = (pointB.time / Model.DURATION) * 1000;
    const yA = automationYPercent(pointA.gainDb);
    const yB = automationYPercent(pointB.gainDb);
    const yZero = automationYPercent(0);

    row.line.setAttribute("d", `M 0 ${yA} L ${xA} ${yA} L ${xB} ${yB} L 1000 ${yB}`);
    row.fill.setAttribute(
      "d",
      `M 0 ${yA} L ${xA} ${yA} L ${xB} ${yB} L 1000 ${yB} L 1000 100 L 0 100 Z`
    );
    row.zero.setAttribute("d", `M 0 ${yZero} L 1000 ${yZero}`);

    row.points.forEach((point, index) => {
      const data = points[index];
      point.style.left = `${(data.time / Model.DURATION) * 100}%`;
      point.style.top = `${automationYPercent(data.gainDb)}%`;
      point.title = `${index === 0 ? "A" : "B"} · ${formatTime(data.time, true)} · ${formatDb(data.gainDb)}`;
      point.setAttribute("aria-label", `${index === 0 ? "自动化点 A" : "自动化点 B"}，${formatTime(data.time, true)}，${formatDb(data.gainDb)}`);
    });
  }

  function showAutomationReadout(trackId, pointIndex) {
    const points = engine.settings[trackId].automation;
    const point = points[pointIndex];
    if (!point) return;
    const label = pointIndex === 0 ? "A" : "B";
    refs.snapReadout.textContent =
      `自动化点 ${label} ${formatTime(point.time, true)} · ${formatDb(point.gainDb)}`;
  }

  function drawWaveforms() {
    const stems = engine.getPcmStems(Model.PREFERRED_SAMPLE_RATE);
    for (const track of TRACKS) {
      const row = ui.rows.get(track.id);
      if (!row) continue;
      const canvas = row.canvas;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(bounds.width * dpr);
      canvas.height = Math.round(bounds.height * dpr);
      const context = canvas.getContext("2d");
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);

      const samples = stems[track.id];
      const columns = Math.max(1, Math.round(bounds.width));
      const center = bounds.height / 2;
      const amplitude = bounds.height * 0.42;
      const step = samples.length / columns;

      context.beginPath();
      for (let column = 0; column < columns; column += 1) {
        const start = Math.floor(column * step);
        const end = Math.min(samples.length, Math.floor((column + 1) * step));
        let maximum = -1;
        for (let index = start; index < end; index += 1) {
          const value = samples[index];
          maximum = Math.max(maximum, value);
        }
        const x = column + 0.5;
        context.lineTo(x, center - maximum * amplitude);
      }
      for (let column = columns - 1; column >= 0; column -= 1) {
        const start = Math.floor(column * step);
        const end = Math.min(samples.length, Math.floor((column + 1) * step));
        let minimum = 1;
        for (let index = start; index < end; index += 1) {
          minimum = Math.min(minimum, samples[index]);
        }
        context.lineTo(column + 0.5, center - minimum * amplitude);
      }
      context.closePath();
      context.fillStyle = track.color;
      context.globalAlpha = 0.26;
      context.fill();
      context.globalAlpha = 1;

      context.strokeStyle = track.color;
      context.globalAlpha = 0.22;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, center + 0.5);
      context.lineTo(bounds.width, center + 0.5);
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  function updateTimelineGeometry() {
    const zoneBounds = refs.tracksZone.getBoundingClientRect();
    const firstRow = TRACKS.length ? ui.rows.get(TRACKS[0].id) : null;
    if (!firstRow || !zoneBounds.width) return;
    const laneBounds = firstRow.lane.getBoundingClientRect();
    ui.geometry = {
      left: laneBounds.left - zoneBounds.left,
      width: laneBounds.width
    };
    updatePlayheadVisual(engine.getPosition());
  }

  function updatePlayheadVisual(time) {
    const normalized = clamp(time / Model.DURATION, 0, 1);
    const left = ui.geometry.left + normalized * ui.geometry.width;
    refs.playhead.style.left = `${left}px`;
    refs.timeNow.textContent = formatTime(time, true);
  }

  function timeFromPointer(event, element) {
    const bounds = element.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    return ratio * Model.DURATION;
  }

  function beginScrub(event, element) {
    if (event.button !== 0) return;
    event.preventDefault();
    const wasPlaying = engine.isPlaying;
    if (wasPlaying) engine.pause();
    ui.scrub = {
      pointerId: event.pointerId,
      element,
      wasPlaying,
      lastTime: 0
    };
    element.classList.add("is-scrubbing");
    const move = (moveEvent) => {
      if (!ui.scrub || moveEvent.pointerId !== ui.scrub.pointerId) return;
      moveEvent.preventDefault();
      const time = timeFromPointer(moveEvent, ui.scrub.element);
      ui.scrub.lastTime = time;
      engine.seek(time);
      updatePlayheadVisual(time);
    };
    const finish = (finishEvent) => {
      if (!ui.scrub || finishEvent.pointerId !== ui.scrub.pointerId) return;
      const shouldResume = ui.scrub.wasPlaying && ui.scrub.lastTime < Model.DURATION - 0.001;
      ui.scrub.element.classList.remove("is-scrubbing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      ui.scrub = null;
      if (shouldResume) {
        engine.play().catch(handleAudioError);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    const time = timeFromPointer(event, element);
    ui.scrub.lastTime = time;
    engine.seek(time);
    updatePlayheadVisual(time);
  }

  function beginAutomationDrag(event, track, point) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const row = ui.rows.get(track.id);
    const laneBounds = row.lane.getBoundingClientRect();
    const pointIndex = Number(point.dataset.point);
    ui.automationDrag = {
      pointerId: event.pointerId,
      trackId: track.id,
      pointIndex,
      point,
      laneBounds
    };
    point.classList.add("is-dragging");
    showAutomationReadout(track.id, pointIndex);

    const move = (moveEvent) => {
      const drag = ui.automationDrag;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      moveEvent.preventDefault();
      const points = engine.settings[drag.trackId].automation;
      const otherPoint = points[1 - drag.pointIndex];
      let time = clamp(
        (moveEvent.clientX - drag.laneBounds.left) / Math.max(1, drag.laneBounds.width),
        0,
        1
      ) * Model.DURATION;
      if (drag.pointIndex === 0) {
        time = Math.min(time, Math.max(0, otherPoint.time - 0.12));
      } else {
        time = Math.max(time, Math.min(Model.DURATION, otherPoint.time + 0.12));
      }
      const yPercent = clamp(
        ((moveEvent.clientY - drag.laneBounds.top) / Math.max(1, drag.laneBounds.height)) * 100,
        10,
        90
      );
      const gainDb = Math.round(gainFromYPercent(yPercent) * 10) / 10;
      engine.setAutomationPoint(drag.trackId, drag.pointIndex, time, gainDb);
      updateAutomation(drag.trackId);
      showAutomationReadout(drag.trackId, drag.pointIndex);
    };

    const finish = (finishEvent) => {
      const drag = ui.automationDrag;
      if (!drag || finishEvent.pointerId !== drag.pointerId) return;
      drag.point.classList.remove("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      ui.automationDrag = null;
      showAutomationReadout(drag.trackId, drag.pointIndex);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function handleStateChange(state) {
    const playing = state.playing;
    refs.playButton.classList.toggle("is-playing", playing);
    refs.playButton.setAttribute("aria-label", playing ? "暂停" : "播放");
    refs.audioState.textContent = playing ? "实时播放" : "音频待命";
    refs.audioState.classList.toggle("is-live", playing);
    for (const track of TRACKS) {
      const row = ui.rows.get(track.id);
      if (!row) continue;
      row.element.classList.toggle("is-playing", playing && !engine.settings[track.id].mute);
    }

    if (!ui.exporting) {
      if (playing) {
        refs.statusMessage.textContent = "正在试听：四轨、自动化与主总线处理实时运行。";
      } else if (state.playhead >= Model.DURATION - 0.001) {
        refs.statusMessage.textContent = "播放完毕。所有声源与自动化已停止。";
      } else if (state.contextState === "idle") {
        refs.statusMessage.textContent = "四轨素材已生成，等待播放。";
      } else {
        refs.statusMessage.textContent = "已暂停：所有 BufferSource 与自动化调度均已停止。";
      }
    }
    updatePlayheadVisual(state.playhead);
  }

  function updateMeters() {
    const data = engine.getMeterData();
    if (!engine.isPlaying) {
      refs.meterL.style.transform = "scaleX(0)";
      refs.meterR.style.transform = "scaleX(0)";
      refs.peakReadout.textContent = "-∞ dBFS";
      refs.guardBadge.classList.remove("is-tripped");
      return;
    }

    const levelLeft = clamp((data.leftDb + 48) / 48, 0, 1);
    const levelRight = clamp((data.rightDb + 48) / 48, 0, 1);
    refs.meterL.style.transform = `scaleX(${levelLeft})`;
    refs.meterR.style.transform = `scaleX(${levelRight})`;
    refs.peakReadout.textContent = Number.isFinite(data.peakDb)
      ? `${formatDb(data.peakDb)}FS`
      : "-∞ dBFS";
    const guardActive = data.peakDb > -2.4 || data.reduction < -2;
    refs.guardBadge.classList.toggle("is-tripped", guardActive);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 12000);
  }

  function showToast(title, text, isError) {
    window.clearTimeout(ui.toastTimer);
    refs.toast.classList.toggle("is-error", Boolean(isError));
    refs.toastIcon.textContent = isError ? "!" : "✓";
    refs.toastTitle.textContent = title;
    refs.toastText.textContent = text;
    refs.toast.classList.add("is-visible");
    ui.toastTimer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 6200);
  }

  function handleAudioError(error) {
    console.error(error);
    ui.exporting = false;
    document.body.classList.remove("is-rendering");
    refs.exportButton.disabled = false;
    refs.masterExportButton.disabled = false;
    refs.statusMessage.textContent = `音频错误：${error.message || error}`;
    showToast("音频操作失败", error.message || String(error), true);
  }

  function setExporting(isExporting) {
    ui.exporting = isExporting;
    document.body.classList.toggle("is-rendering", isExporting);
    refs.exportButton.disabled = isExporting;
    refs.masterExportButton.disabled = isExporting;
  }

  function validateExport(stats) {
    const checks = {
      duration: Math.abs(stats.duration - Model.DURATION) <= 0.001,
      stereo: stats.channels === 2,
      sampleRate: stats.sampleRate === Model.PREFERRED_SAMPLE_RATE,
      signal: stats.peak > 0.05 && stats.rms > 0.01,
      bothChannels: stats.channelPeaks.every((channelPeak) => channelPeak > 0.01),
      waveform: stats.waveformRms.filter((level) => level > 0.005).length === 16,
      peakGuard: stats.peakDb <= -1.1 && stats.peak <= 0.9,
      clipping: stats.clippedSamples === 0
    };
    return {
      ...checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  async function exportWav(options) {
    const exportOptions = options || {};
    if (ui.exporting) return null;
    setExporting(true);
    refs.statusMessage.textContent = "正在离线渲染 16 秒立体声母带，并逐样本写入 WAV…";
    showToast("正在渲染 WAV", "使用与试听相同的轨道、自动化与主总线参数。");

    try {
      const result = await engine.renderMix({
        sampleRate: Model.PREFERRED_SAMPLE_RATE,
        bitDepth: 16
      });
      const validation = validateExport(result.stats);
      result.stats.validation = validation;
      window.lastExportStats = result.stats;
      window.lastExport = result;
      if (exportOptions.download !== false) {
        triggerDownload(result.blob, "FOUR16_16s_mix.wav");
      }

      refs.statusMessage.textContent =
        `导出完成：${result.stats.duration.toFixed(3)} 秒 · ${result.stats.channels} 声道 · ` +
        `${(result.stats.sampleRate / 1000).toFixed(0)} kHz · 峰值 ${formatDb(result.stats.peakDb)}FS · 0 削波`;
      refs.peakReadout.textContent = `${formatDb(-1.2)}FS`;
      showToast(
        validation.passed ? "WAV 已导出并通过自检" : "WAV 已导出，自检有异常",
        `${result.stats.duration.toFixed(3)} s · ${result.stats.channels} ch · ${result.stats.sampleRate} Hz · ` +
        `峰值 ${formatDb(result.stats.peakDb, 2)}FS · RMS ${formatDb(result.stats.rmsDb, 2)} · ` +
        `${(result.stats.byteLength / 1024 / 1024).toFixed(2)} MB`,
        !validation.passed
      );
      return result;
    } catch (error) {
      handleAudioError(error);
      throw error;
    } finally {
      setExporting(false);
    }
  }

  function animationLoop() {
    if (engine.isPlaying && !ui.scrub) {
      const position = engine.getPosition();
      updatePlayheadVisual(position);
      if (position >= Model.DURATION) {
        engine.finishPlayback();
      }
    }
    updateMeters();
    window.requestAnimationFrame(animationLoop);
  }

  function syncAllStripReadouts() {
    for (const track of TRACKS) {
      const record = ui.strips.get(track.id);
      if (!record) continue;
      const settings = engine.settings[track.id];
      record.volumeOutput.textContent = formatDb(settings.volumeDb);
      record.panOutput.textContent = formatPan(settings.pan);
      record.cutoffOutput.textContent = formatFrequency(settings.cutoff);
      updateRangeFill(record.volume);
      updateRangeFill(record.pan);
      updateRangeFill(record.cutoff);
      syncTrackControls(track.id);
    }
  }

  function init() {
    createRuler();
    createTrackRows();
    createChannelStrips();
    TRACKS.forEach((track) => updateAutomation(track.id));
    syncAllStripReadouts();
    showAutomationReadout(TRACKS[0].id, 0);

    refs.ruler.addEventListener("pointerdown", (event) => beginScrub(event, refs.ruler));
    refs.playButton.addEventListener("click", () => {
      engine.toggle().catch(handleAudioError);
    });
    refs.restartButton.addEventListener("click", async () => {
      const wasPlaying = engine.isPlaying;
      if (wasPlaying) engine.pause();
      await engine.seek(0);
      if (wasPlaying) await engine.play();
    });
    refs.exportButton.addEventListener("click", () => exportWav({ download: true }).catch(() => {}));
    refs.masterExportButton.addEventListener("click", () => exportWav({ download: true }).catch(() => {}));

    engine.onStateChange = handleStateChange;
    engine.onStateChange(engine.getState());

    let redrawFrame = 0;
    const redraw = () => {
      window.cancelAnimationFrame(redrawFrame);
      redrawFrame = window.requestAnimationFrame(() => {
        updateTimelineGeometry();
        drawWaveforms();
      });
    };
    const observer = new ResizeObserver(redraw);
    observer.observe(refs.tracksZone);
    TRACKS.forEach((track) => observer.observe(ui.rows.get(track.id).lane));
    window.addEventListener("resize", redraw);
    redraw();
    window.requestAnimationFrame(animationLoop);

    window.mixerApp = {
      engine,
      getState: () => engine.getDebugState(),
      play: () => engine.play(),
      pause: () => engine.pause(),
      seek: (time) => engine.seek(time),
      setTrackSetting: (trackId, key, value) => engine.setTrackSetting(trackId, key, value),
      setAutomationPoint: (trackId, index, time, gainDb) => {
        engine.setAutomationPoint(trackId, index, time, gainDb);
        updateAutomation(trackId);
      },
      exportWav,
      getLastExportStats: () => window.lastExportStats || null
    };
  }

  init();
})();
