(function startPlayerApp() {
  "use strict";

  const S = globalThis.FrameSync;
  const R = globalThis.FrameRender;
  const audio = new globalThis.FrameAudio.SyntheticAudioEngine();
  const frameSource = S.createSyntheticFrameSource({
    minDelay: 28,
    maxDelay: 145,
    latencyScale: 1
  });

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $("videoCanvas"),
    scope: $("audioScope"),
    transportState: $("transportState"),
    statusText: $("statusText"),
    subtitleLayer: $("subtitleLayer"),
    subtitleCue: $("subtitleCue"),
    subtitleText: $("subtitleText"),
    play: $("btnPlay"),
    pause: $("btnPause"),
    stepBack: $("btnStepBack"),
    stepForward: $("btnStepForward"),
    rapid: $("btnRapid"),
    playhead: $("playhead"),
    liveTimecode: $("liveTimecode"),
    timelineReadout: $("timelineReadout"),
    frameValue: $("frameValue"),
    audioValue: $("audioValue"),
    cueValue: $("cueValue"),
    audioStateText: $("audioStateText"),
    pendingBadge: $("pendingBadge"),
    diagSeq: $("diagSeq"),
    diagTarget: $("diagTarget"),
    diagAborted: $("diagAborted"),
    diagStale: $("diagStale"),
    diagCommitted: $("diagCommitted"),
    cueRail: $("cueRail"),
    muteToggle: $("muteToggle"),
    verifyBadge: $("verifyBadge"),
    verifyEmpty: $("verifyEmpty"),
    verifyResult: $("verifyResult"),
    verifyFrame: $("verifyFrame"),
    verifyAudio: $("verifyAudio"),
    verifyCue: $("verifyCue"),
    passLine: $("passLine"),
    dragEvents: $("dragEvents"),
    verifyChecks: $("verifyChecks")
  };

  const player = new S.VideoCore({
    frameSource,
    audio,
    onState: renderState,
    onFrame: () => {
      renderState(player.getState());
    }
  });

  function padFrame(frame) {
    return `#${String(Math.max(0, frame)).padStart(4, "0")}`;
  }

  function statusLabel(state) {
    if (state.dragging) return "拖动中 · 音频待恢复";
    if (state.pending) return "取消旧请求 · 等待最新帧";
    if (state.playing && !state.paused) return "播放中";
    if (state.paused) return "已暂停 · 时钟冻结";
    return "已就绪";
  }

  function statusClass(state) {
    if (state.dragging) return "is-dragging";
    if (state.pending) return "is-loading";
    if (state.playing && !state.paused) return "is-playing";
    return "";
  }

  function buildCueRail() {
    els.cueRail.textContent = "";
    S.CUES.forEach((cue, index) => {
      const segment = document.createElement("div");
      segment.className = "cue-segment";
      segment.dataset.cue = cue.id;
      segment.style.width = `${((cue.end - cue.start) / S.DURATION) * 100}%`;
      segment.style.background = index % 2 === 0
        ? "rgba(52, 125, 148, 0.72)"
        : "rgba(111, 72, 30, 0.68)";
      segment.title = `${cue.id} ${S.formatTimecode(cue.start)}–${S.formatTimecode(cue.end)}`;
      els.cueRail.appendChild(segment);
    });
  }

  function renderState(state) {
    const rendered = state.renderedFrame;
    const shownFrame = rendered >= 0 ? rendered : state.targetFrame;
    const progress = shownFrame / (S.TOTAL_FRAMES - 1);
    const status = statusLabel(state);

    els.statusText.textContent = status;
    els.transportState.className = `transport-state ${statusClass(state)}`.trim();
    els.play.disabled = state.playing && !state.paused;
    els.pause.disabled = state.paused && !state.playing;
    els.play.setAttribute("aria-pressed", String(state.playing && !state.paused));

    els.frameValue.textContent = padFrame(shownFrame);
    els.audioValue.textContent = S.formatTimecode(state.audioTime);
    els.cueValue.textContent = state.cue.id;
    els.subtitleCue.textContent = state.cue.id;
    els.subtitleText.textContent = state.cue.text;
    els.subtitleLayer.classList.toggle("is-stale", state.pending || state.dragging);

    els.liveTimecode.textContent = S.formatTimecode(state.audioTime);
    els.timelineReadout.textContent = `${padFrame(shownFrame)} · ${state.targetTime.toFixed(3)}s`;
    els.audioStateText.textContent = state.paused
      ? `暂停 · ${state.audioTime.toFixed(3)}s`
      : `同步 · ${state.audioTime.toFixed(3)}s`;

    els.pendingBadge.textContent = state.pending ? "LATEST" : state.paused ? "PAUSED" : "READY";
    els.diagSeq.textContent = `#${state.requestSeq}`;
    els.diagTarget.textContent = padFrame(state.targetFrame);
    els.diagAborted.textContent = String(state.abortedRequests);
    els.diagStale.textContent = String(state.staleDrops);
    els.diagCommitted.textContent = String(state.committedFrames);

    if (!state.dragging) els.playhead.value = String(state.targetFrame);
    els.playhead.style.setProperty("--played", `${progress * 100}%`);
    Array.from(els.cueRail.children).forEach((segment) => {
      segment.classList.toggle("active", segment.dataset.cue === state.cue.id);
    });

    R.drawVideoFrame(els.canvas, state);
    R.drawAudioScope(els.scope, state);
  }

  function showVerification(report) {
    els.verifyEmpty.hidden = true;
    els.verifyResult.hidden = false;
    els.verifyBadge.className = `verify-badge ${report.passed ? "is-pass" : "is-fail"}`;
    els.verifyBadge.textContent = report.passed ? "通过" : "未通过";
    els.verifyFrame.textContent = `${padFrame(report.finalFrame)} · ${report.finalTimecode}`
      + ` · 第 ${report.requestSeq} 次请求`;
    els.verifyAudio.textContent = `${report.audioTimecode} · Δ `
      + `${Math.abs(report.audioTime - report.finalTime).toFixed(3)}s`;
    els.verifyCue.textContent = `${report.subtitle.id} · ${report.subtitle.text}`;
    els.passLine.className = `pass-line ${report.passed ? "" : "fail"}`.trim();
    els.passLine.textContent = report.passed
      ? `PASS · 帧、音频、字幕一致；${report.abortedRequests} 个旧请求已取消，暂停后时钟冻结`
      : "FAIL · 最终同步检查未通过";

    els.dragEvents.textContent = "";
    report.events.forEach((event) => {
      const item = document.createElement("li");
      item.innerHTML = `<b>#${event.sequence}</b><span>拖动 ${event.drag} · ${event.seconds.toFixed(1)}s</span>`
        + `<span>帧 ${event.targetFrame}</span>`;
      els.dragEvents.appendChild(item);
    });

    const labels = {
      frameMatchesLatestTarget: "最终帧",
      audioMatchesFrame: "音频",
      subtitleMatchesFrame: "字幕",
      latestSequenceWon: "最新序号",
      oldRequestsCancelled: "旧请求取消",
      noPendingRequest: "无悬挂请求",
      pausedDoesNotAdvance: "暂停冻结"
    };
    els.verifyChecks.textContent = "";
    Object.entries(report.checks).forEach(([key, passed]) => {
      const chip = document.createElement("span");
      chip.className = passed ? "" : "fail";
      chip.textContent = `${passed ? "✓" : "✗"} ${labels[key] || key}`;
      els.verifyChecks.appendChild(chip);
    });
  }

  let rangePointerActive = false;
  let scrubEndTimer = null;

  function beginScrub() {
    if (!player.state.dragging) player.beginScrub();
  }

  function endScrub() {
    rangePointerActive = false;
    if (scrubEndTimer) clearTimeout(scrubEndTimer);
    scrubEndTimer = null;
    if (player.state.dragging) player.endScrub();
  }

  function scheduleProgrammaticScrubEnd() {
    if (rangePointerActive) return;
    if (scrubEndTimer) clearTimeout(scrubEndTimer);
    scrubEndTimer = setTimeout(endScrub, 160);
  }

  els.play.addEventListener("click", async () => {
    await audio.unlock();
    player.play();
  });

  els.pause.addEventListener("click", () => {
    player.pause();
  });

  els.stepBack.addEventListener("click", () => {
    player.stepFrames(-1);
  });

  els.stepForward.addEventListener("click", () => {
    player.stepFrames(1);
  });

  els.playhead.addEventListener("pointerdown", () => {
    rangePointerActive = true;
    if (scrubEndTimer) clearTimeout(scrubEndTimer);
    scrubEndTimer = null;
    beginScrub();
  });
  els.playhead.addEventListener("input", () => {
    beginScrub();
    player.seekFrame(Number(els.playhead.value), { eventName: "playhead-drag" });
    scheduleProgrammaticScrubEnd();
  });
  els.playhead.addEventListener("change", endScrub);
  els.playhead.addEventListener("keydown", (event) => {
    if (/^(Arrow|Page|Home|End)/.test(event.key)) beginScrub();
  });
  els.playhead.addEventListener("keyup", endScrub);
  els.playhead.addEventListener("blur", endScrub);
  window.addEventListener("pointerup", endScrub);
  window.addEventListener("pointercancel", endScrub);

  els.muteToggle.addEventListener("change", () => {
    audio.setMuted(els.muteToggle.checked);
  });

  async function runRapidScrubCheck(options) {
    els.rapid.disabled = true;
    els.verifyBadge.className = "verify-badge is-running";
    els.verifyBadge.textContent = "运行中";
    els.verifyEmpty.hidden = false;
    els.verifyEmpty.textContent = "正在取消旧请求并等待第 5 个目标帧……";
    try {
      const report = await S.runFiveScrubCheck(player, Object.assign({ gapMs: 35 }, options));
      showVerification(report);
      globalThis.__lastScrubCheck = report;
      return report;
    } catch (error) {
      els.verifyBadge.className = "verify-badge is-fail";
      els.verifyBadge.textContent = "错误";
      els.verifyEmpty.textContent = error.message;
      throw error;
    } finally {
      els.rapid.disabled = false;
    }
  }

  els.rapid.addEventListener("click", () => {
    runRapidScrubCheck().catch((error) => console.error(error));
  });

  let lastTimestamp = performance.now();
  function animationLoop(timestamp) {
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    player.tick(delta);
    requestAnimationFrame(animationLoop);
  }

  buildCueRail();
  player.seekFrame(0, { eventName: "boot" });
  renderState(player.getState());
  requestAnimationFrame(animationLoop);

  globalThis.__FRAME_SYNC__ = {
    player,
    audio,
    runRapidScrubCheck,
    snapshot: () => player.getState()
  };

  const params = new URLSearchParams(globalThis.location.search);
  if (params.get("autotest") === "1") {
    setTimeout(() => runRapidScrubCheck().catch((error) => console.error(error)), 350);
  }
})();
