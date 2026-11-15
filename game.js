(function () {
  "use strict";

  const DEFAULT_INPUTS = {
    speeds: [105, 115, 95],
    priorities: [58, 47],
    picker: 2
  };

  const $ = (selector) => document.querySelector(selector);
  const dom = {
    app: $(".app-shell"),
    canvas: $("#systemCanvas"),
    startScreen: $("#startScreen"),
    startButton: $("#startButton"),
    resultScreen: $("#resultScreen"),
    resultCard: $(".result-card"),
    resultStamp: $("#resultStamp"),
    resultTitle: $("#result-title"),
    resultCopy: $("#resultCopy"),
    resultCorrect: $("#resultCorrect"),
    resultRate: $("#resultRate"),
    resultOverflow: $("#resultOverflow"),
    resultRecovery: $("#resultRecovery"),
    restartButton: $("#restartButton"),
    audioButton: $("#audioButton"),
    pauseButton: $("#pauseButton"),
    phaseLabel: $("#phaseLabel"),
    simClock: $("#simClock"),
    simCountdown: $("#simCountdown"),
    goalState: $("#goalState"),
    correctCount: $("#correctCount"),
    correctPercent: $("#correctPercent"),
    correctProgress: $("#correctProgress"),
    overflowSummary: $("#overflowSummary"),
    loadMeter: $("#loadMeter"),
    loadValue: $("#loadValue"),
    pickerTelemetry: $("#pickerTelemetry"),
    fixedCount: $("#fixedCount"),
    occupancyValue: $("#occupancyValue"),
    feedStatus: $("#feedStatus"),
    throughputReadout: $("#throughputReadout"),
    eventList: $("#eventList"),
    jamBadge: $("#jamBadge"),
    jamBadgeText: $("#jamBadgeText"),
    recoveryBanner: $("#recoveryBanner"),
    recoveryPercent: $("#recoveryPercent"),
    recoveryStage: $("#recoveryStage"),
    recoveryProgress: $("#recoveryProgress"),
    recoverButton: $("#recoverButton"),
    recoverHint: $("#recoverHint"),
    demoButton: $("#demoButton"),
    toastRegion: $("#toastRegion"),
    beltSliders: [1, 2, 3].map((lane) => $(`#belt${lane}Speed`)),
    beltOutputs: [1, 2, 3].map((lane) => $(`#belt${lane}Value`)),
    prioritySliders: [$("#d1Priority"), $("#d2Priority")],
    priorityOutputs: [$("#d1Value"), $("#d2Value")],
    pickerButtons: Array.from(document.querySelectorAll(".picker-choice")),
    speedButtons: Array.from(document.querySelectorAll(".speed-option"))
  };

  const renderer = new BaggageRenderer.SystemRenderer(dom.canvas);
  const audio = new ControlAudio();
  let simulation = BaggageSimulation.createSimulation();
  let snapshot = simulation.snapshot();
  let displaySpeed = 4;
  let started = false;
  let demoMode = false;
  let selectedJam = false;
  let resultVisible = false;
  let lastFrame = performance.now();
  let logRows = [];
  let toastTimer = null;

  const EVENT_TAGS = {
    system: "SYS",
    picker: "PICK",
    jam: "JAM",
    recovery: "REC",
    wrong: "TAG",
    overflow: "FULL",
    result: "END"
  };

  function setRangeFill(input) {
    if (!input) return;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value);
    input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
  }

  function setControlValues(values) {
    values.speeds.forEach((value, index) => {
      dom.beltSliders[index].value = value;
      dom.beltOutputs[index].textContent = `${(value / 100).toFixed(2)}×`;
      setRangeFill(dom.beltSliders[index]);
    });
    values.priorities.forEach((value, index) => {
      dom.prioritySliders[index].value = value;
      dom.priorityOutputs[index].textContent = `${value} : ${100 - value}`;
      setRangeFill(dom.prioritySliders[index]);
    });
    dom.pickerButtons.forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.picker) === values.picker);
    });
  }

  function applyControlsToSimulation() {
    simulation.setSpeeds(dom.beltSliders.map((input) => Number(input.value) / 100));
    simulation.setPriority(0, Number(dom.prioritySliders[0].value));
    simulation.setPriority(1, Number(dom.prioritySliders[1].value));
    const activePicker = dom.pickerButtons.find((button) => button.classList.contains("is-active"));
    simulation.setPickerLane(Number(activePicker ? activePicker.dataset.picker : DEFAULT_INPUTS.picker));
  }

  function setInteractiveControlsDisabled(disabled) {
    dom.beltSliders.forEach((input) => { input.disabled = disabled; });
    dom.prioritySliders.forEach((input) => { input.disabled = disabled; });
    dom.pickerButtons.forEach((button) => { button.disabled = disabled; });
    dom.demoButton.disabled = disabled;
    dom.demoButton.classList.toggle("is-armed", disabled);
  }

  function addLogEvent(event) {
    logRows.unshift(event);
    logRows = logRows.slice(0, 8);
    if (!dom.eventList) return;
    dom.eventList.replaceChildren();
    logRows.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = `event-row ${entry.level === "danger" ? "danger" : entry.level === "warning" ? "warn" : ""}`;
      if (index === 0) row.style.animation = "event-in 220ms ease-out";
      const time = document.createElement("time");
      time.textContent = entry.clock;
      const text = document.createElement("span");
      text.textContent = entry.detail ? `${entry.title} · ${entry.detail}` : entry.title;
      const tag = document.createElement("small");
      tag.textContent = EVENT_TAGS[entry.type] || "OPS";
      row.append(time, text, tag);
      dom.eventList.append(row);
    });
  }

  function showToast(title, copy, level) {
    if (!dom.toastRegion) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      dom.toastRegion.replaceChildren();
    }
    const toast = document.createElement("div");
    toast.className = `toast ${level === "danger" ? "is-danger" : level === "warning" ? "is-warning" : ""}`;
    const content = document.createElement("div");
    const heading = document.createElement("b");
    heading.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = copy;
    content.append(heading, detail);
    toast.append(content);
    dom.toastRegion.append(toast);
    toastTimer = setTimeout(() => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 220);
      toastTimer = null;
    }, 3400);
  }

  function processEvents(events) {
    for (const event of events) {
      addLogEvent(event);
      audio.event(event.type, event.level);
      if (event.type === "jam") {
        selectedJam = true;
        showToast("D1 / Y1 滑槽堵塞", "仅 Y1 分支受阻；可执行局部恢复，其余线路继续。", "danger");
      } else if (event.type === "recovery" && event.title.includes("完成")) {
        selectedJam = false;
        showToast("局部恢复完成", "积压行李已限速放行，其他出口未停机。", "warning");
      } else if (event.type === "overflow") {
        showToast("航班出口溢出", event.detail, "danger");
      } else if (event.type === "wrong" && snapshot.time < 80) {
        showToast("发现错标行李", event.detail, "warning");
      }
    }
  }

  function formatCountdown(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function updateUI(state) {
    const stats = state.stats;
    const percent = Math.round((stats.correct / stats.total) * 100);
    const isRecovering = state.recovery.active;
    const isJammed = state.jam.active || state.jam.clearing;
    const throughput = state.time > 20 ? stats.delivered / (state.time / 60) : 0;

    let phase = "班次待命";
    if (state.ended) phase = state.outcome && state.outcome.success ? "班次完成" : "班次异常";
    else if (isRecovering) phase = "D1 局部恢复";
    else if (state.paused) phase = "模拟暂停";
    else if (isJammed) phase = "D1 堵塞";
    else if (state.running) phase = "早高峰运行";

    dom.phaseLabel.textContent = phase;
    dom.simClock.textContent = BaggageSimulation.timeLabel(state.time);
    dom.simCountdown.textContent = `剩余 ${formatCountdown(state.remaining)}`;
    dom.app.classList.toggle("is-running", state.running && !state.paused && !state.ended);

    dom.correctCount.textContent = String(stats.correct);
    dom.correctPercent.textContent = `${percent}%`;
    dom.correctPercent.style.color = percent >= 80 ? "var(--cyan)" : "var(--amber)";
    dom.correctProgress.style.width = `${Math.min(100, percent)}%`;
    dom.goalState.textContent = state.ended ? (state.outcome.success ? "已达成" : "未达成") : isJammed ? "恢复窗口" : "进行中";
    dom.goalState.classList.toggle("is-warning", isJammed || percent < Math.floor(state.progress * 100) - 8);
    dom.overflowSummary.textContent = `出口溢出 ${stats.overflowCount} 次`;
    dom.overflowSummary.style.color = stats.overflowCount ? "var(--danger)" : "";

    const loadPercent = Math.round(state.load * 100);
    dom.loadMeter.style.width = `${loadPercent}%`;
    dom.loadMeter.style.background = isJammed ? "var(--danger)" : loadPercent > 72 ? "var(--amber)" : "var(--cyan)";
    dom.loadValue.textContent = `${loadPercent}%`;
    dom.pickerTelemetry.textContent = `B${state.picker.lane} · ${state.picker.busy ? "复核中" : "待命"}`;
    dom.fixedCount.textContent = String(stats.fixed);
    dom.occupancyValue.textContent = `${stats.occupancy.toFixed(1)} m`;
    dom.feedStatus.textContent = state.running && !state.paused ? "进件运行" : isJammed ? "局部阻塞" : "进件待命";
    dom.throughputReadout.textContent = `${throughput.toFixed(1)} 件/分`;

    dom.jamBadge.hidden = !(state.jam.active && !state.recovery.active);
    dom.jamBadgeText.textContent = `${state.jam.queueLength} 件积压 · 点击定位`;
    dom.recoveryBanner.hidden = !state.recovery.active;
    if (state.recovery.active) {
      const recoveryPercent = Math.round(state.recovery.ratio * 100);
      dom.recoveryPercent.textContent = `${recoveryPercent}%`;
      dom.recoveryProgress.style.width = `${recoveryPercent}%`;
      const stageLabels = {
        isolate: "隔离受影响路段",
        clear: "逆退并限速放行",
        restart: "重启 Y1 分支"
      };
      dom.recoveryStage.textContent = stageLabels[state.recovery.stage] || "局部恢复中";
    }

    const recoveryAvailable = state.jam.active && !state.recovery.active && state.running && !state.ended;
    dom.recoverButton.disabled = !recoveryAvailable;
    dom.recoverButton.classList.toggle("is-ready", recoveryAvailable);
    dom.recoverHint.textContent = recoveryAvailable
      ? `Y1 积压 ${state.jam.queueLength} 件 · 不影响 D2`
      : state.recovery.completed
        ? `已恢复 ${state.jam.recoveredBags} 件，分支在线`
        : "等待堵塞发生";

    if (state.ended && !resultVisible) showResult(state);
  }

  function showResult(state) {
    resultVisible = true;
    const outcome = state.outcome || {
      success: false,
      correct: state.stats.correct,
      rate: state.stats.correct / state.stats.total,
      overflowCount: state.stats.overflowCount,
      recoveredBags: state.stats.recoveredBags,
      reason: "target"
    };
    const success = outcome.success;
    dom.resultCard.classList.toggle("is-failure", !success);
    dom.resultStamp.textContent = success ? "SHIFT COMPLETE · 063" : "SHIFT INCIDENT · 063";
    dom.resultTitle.textContent = success ? "高峰已平稳度过" : "班次未达目标";
    if (success) {
      dom.resultCopy.textContent = `20:00 内正确送出 ${state.stats.correct} 件行李，四个出口均未越过容量线，局部堵包也已恢复。`;
    } else if (outcome.reason === "overflow") {
      dom.resultCopy.textContent = "至少一个航班出口越过容量线。需要重新平衡分流优先权，避免高峰批次在同一出口堆积。";
    } else {
      dom.resultCopy.textContent = "正确送出率低于 80%。延误的行李主要集中在 D1 恢复之后，需更早处理堵包并关注人工复核位。";
    }
    dom.resultCorrect.textContent = `${outcome.correct} / ${state.stats.total}`;
    dom.resultRate.textContent = `${Math.round(outcome.rate * 100)}%`;
    dom.resultOverflow.textContent = String(outcome.overflowCount);
    dom.resultRecovery.textContent = outcome.recoveredBags ? `${outcome.recoveredBags} 件` : "未发生";
    const glyphPath = dom.resultCard.querySelector(".result-glyph path");
    if (glyphPath) glyphPath.setAttribute("d", success ? "M10 25 20 35 38 13" : "M14 14 34 34 M34 14 14 34");
    dom.resultScreen.hidden = false;
    setInteractiveControlsDisabled(false);
    dom.demoButton.disabled = false;
    dom.pauseButton.disabled = true;
    audio.setLoad(0.12, snapshot);
  }

  function updateAudioButton(enabled) {
    dom.audioButton.setAttribute("aria-pressed", String(enabled));
    const label = dom.audioButton.querySelector(".button-label");
    if (label) label.textContent = enabled ? "音景 开" : "音景 关";
    dom.audioButton.title = enabled ? "关闭调度音景" : "开启调度音景";
  }

  function setDisplaySpeed(value) {
    displaySpeed = value;
    dom.speedButtons.forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.speed) === value);
    });
  }

  function resetRun(inputs) {
    simulation = BaggageSimulation.createSimulation({ seed: 630 });
    snapshot = simulation.snapshot();
    started = false;
    demoMode = false;
    selectedJam = false;
    resultVisible = false;
    logRows = [];
    dom.resultScreen.hidden = true;
    dom.startScreen.hidden = true;
    dom.eventList.replaceChildren();
    dom.pauseButton.disabled = true;
    dom.pauseButton.classList.remove("is-paused");
    dom.recoverButton.disabled = true;
    setInteractiveControlsDisabled(false);
    setControlValues(inputs || DEFAULT_INPUTS);
    applyControlsToSimulation();
    setDisplaySpeed(4);
    updateUI(simulation.snapshot());
  }

  async function beginRun(isDemo) {
    resetRun(DEFAULT_INPUTS);
    demoMode = Boolean(isDemo);
    started = true;
    lastFrame = performance.now();
    setInteractiveControlsDisabled(demoMode);
    if (demoMode) {
      setDisplaySpeed(12);
      dom.demoButton.querySelector("b").textContent = "演示运行中";
      dom.demoButton.querySelector("small").textContent = "自动恢复 D1 堵包";
    } else {
      dom.demoButton.querySelector("b").textContent = "固定输入演示";
      dom.demoButton.querySelector("small").textContent = "自动完成一局";
    }
    simulation.start();
    processEvents(simulation.tick(0.001));
    dom.pauseButton.disabled = false;
    dom.pauseButton.querySelector(".button-label").textContent = "暂停";
    showToast(
      isDemo ? "固定输入演示开始" : "固定班次开始",
      isDemo ? "使用锁定配置运行 20:00，并在 D1 积压后自动局部恢复。" : "行李序列、错标点与 06:05 堵包均已锁定。",
      "success"
    );
    try {
      const enabled = await audio.enable();
      updateAudioButton(enabled);
    } catch (error) {
      updateAudioButton(false);
    }
  }

  function triggerRecovery() {
    if (!started || simulation.state.ended) return;
    if (simulation.beginRecovery()) {
      selectedJam = true;
      processEvents(simulation.tick(0.001));
      snapshot = simulation.snapshot();
      updateUI(snapshot);
    } else if (!simulation.state.jam.active) {
      showToast("当前无需恢复", "D1 / Y1 分支在线，未检测到活动堵塞。", "warning");
    }
  }

  function togglePause() {
    if (!started || simulation.state.ended) return;
    simulation.pause();
    const paused = simulation.state.paused;
    dom.pauseButton.classList.toggle("is-paused", paused);
    dom.pauseButton.querySelector(".button-label").textContent = paused ? "继续" : "暂停";
    processEvents(simulation.tick(0.001));
    snapshot = simulation.snapshot();
    updateUI(snapshot);
  }

  function advanceSimulation(seconds) {
    let remaining = seconds;
    while (remaining > 0.0001) {
      const step = Math.min(0.2, remaining);
      processEvents(simulation.tick(step));
      remaining -= step;
    }
  }

  function frame(now) {
    const realDelta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (started && !simulation.state.paused && !simulation.state.ended) {
      advanceSimulation(realDelta * displaySpeed);
      if (
        demoMode &&
        simulation.state.jam.active &&
        !simulation.state.recovery.active &&
        simulation.state.time - simulation.state.jam.triggeredAt >= 9
      ) {
        triggerRecovery();
      }
    }
    snapshot = simulation.snapshot();
    updateUI(snapshot);
    renderer.draw(snapshot, now, selectedJam);
    audio.setLoad(snapshot.load, snapshot);
    requestAnimationFrame(frame);
  }

  function bindEvents() {
    dom.startButton.addEventListener("click", () => beginRun(false));
    dom.restartButton.addEventListener("click", () => beginRun(false));
    dom.demoButton.addEventListener("click", () => beginRun(true));
    dom.recoverButton.addEventListener("click", triggerRecovery);
    dom.pauseButton.addEventListener("click", togglePause);
    dom.audioButton.addEventListener("click", async () => {
      try {
        const enabled = await audio.toggle();
        updateAudioButton(enabled);
      } catch (error) {
        updateAudioButton(false);
        showToast("音景不可用", "当前浏览器未允许初始化 Web Audio。", "warning");
      }
    });

    dom.speedButtons.forEach((button) => {
      button.addEventListener("click", () => setDisplaySpeed(Number(button.dataset.speed)));
    });

    dom.beltSliders.forEach((input, index) => {
      input.addEventListener("input", () => {
        dom.beltOutputs[index].textContent = `${(Number(input.value) / 100).toFixed(2)}×`;
        setRangeFill(input);
        applyControlsToSimulation();
      });
    });

    dom.prioritySliders.forEach((input, index) => {
      input.addEventListener("input", () => {
        dom.priorityOutputs[index].textContent = `${input.value} : ${100 - Number(input.value)}`;
        setRangeFill(input);
        applyControlsToSimulation();
      });
    });

    dom.pickerButtons.forEach((button) => {
      button.addEventListener("click", () => {
        dom.pickerButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        applyControlsToSimulation();
        showToast("人工位已移动", `复核员前往 B${button.dataset.picker}，错标行李将在此被拦截。`, "info");
      });
    });

    dom.jamBadge.addEventListener("click", () => {
      selectedJam = true;
      showToast("已定位 D1 / Y1", "选择“局部恢复”隔离故障段；D2 和其他出口不受影响。", "danger");
    });

    dom.canvas.addEventListener("click", (event) => {
      if (!renderer.hitJam(event.clientX, event.clientY, snapshot)) return;
      selectedJam = true;
      if (snapshot.jam.active && !snapshot.recovery.active) {
        showToast("堵塞点已选中", "按 R 或点击右侧“局部恢复”执行隔离、逆退与重启。", "danger");
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && event.target.tagName !== "INPUT" && event.target.tagName !== "BUTTON") {
        event.preventDefault();
        togglePause();
      } else if (event.key.toLowerCase() === "r" && event.target.tagName !== "INPUT") {
        triggerRecovery();
      }
    });
  }

  dom.beltSliders.forEach(setRangeFill);
  dom.prioritySliders.forEach(setRangeFill);
  setControlValues(DEFAULT_INPUTS);
  applyControlsToSimulation();
  bindEvents();
  updateUI(snapshot);
  updateAudioButton(false);
  requestAnimationFrame(frame);

  window.__baggageDebug = {
    getSnapshot: () => simulation.snapshot(),
    getState: () => simulation.state,
    startDemo: () => beginRun(true),
    recover: triggerRecovery,
    advance: (seconds) => advanceSimulation(seconds)
  };
})();
