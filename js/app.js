/*
 * app.js — 界面与实时回放调度
 * 调度器：lookahead + 绝对时间网格（startTime + stepIndex × stepDur），
 * 不依赖 setInterval 的触发精度，因此长时间播放不会漂移。
 */
(function () {
  "use strict";
  var C = window.DrumCore;
  var STORAGE_KEY = "drum16.patch.v1";

  /* ---------------- 状态 ---------------- */
  var patch = loadInitialPatch();
  var selected = null; // { track, step }
  var cells = {};      // cells[track][step] -> button

  function loadInitialPatch() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return C.parsePatch(saved);
    } catch (e) { /* 损坏则回退默认 */ }
    return C.createDefaultPatch();
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, C.serializePatch(patch));
  }

  function setStatus(msg) {
    document.getElementById("status").textContent = msg;
  }

  /* ---------------- 网格 UI ---------------- */
  var TRACK_LABELS = { kick: "底鼓", snare: "军鼓", hihat: "踩镲", clap: "拍手" };

  function buildGrid() {
    var grid = document.getElementById("grid");
    grid.innerHTML = "";
    C.TRACKS.forEach(function (name, ti) {
      var row = document.createElement("div");
      row.className = "row";
      var label = document.createElement("div");
      label.className = "row-label";
      label.textContent = TRACK_LABELS[name];
      row.appendChild(label);
      cells[name] = [];
      for (var s = 0; s < C.STEPS; s++) {
        var btn = document.createElement("button");
        btn.className = "cell " + name + (s % 4 === 0 ? " beat" : "");
        btn.dataset.track = name;
        btn.dataset.step = s;
        btn.innerHTML = '<span class="prob-dot"></span>';
        btn.addEventListener("click", onCellClick);
        row.appendChild(btn);
        cells[name].push(btn);
      }
      grid.appendChild(row);
    });
    refreshGrid();
  }

  function refreshGrid() {
    C.TRACKS.forEach(function (name) {
      for (var s = 0; s < C.STEPS; s++) {
        var st = patch.tracks[name][s];
        var btn = cells[name][s];
        btn.classList.toggle("on", st.on);
        btn.classList.toggle("prob-lt-1", st.on && st.prob < 1);
        btn.classList.toggle(
          "selected",
          !!selected && selected.track === name && selected.step === s
        );
        btn.style.opacity = st.on ? 0.45 + 0.55 * st.vel : 1;
      }
    });
  }

  function onCellClick(e) {
    var name = e.currentTarget.dataset.track;
    var s = Number(e.currentTarget.dataset.step);
    if (selected && selected.track === name && selected.step === s) {
      // 已选中 → 本次点击切换开关
      patch.tracks[name][s].on = !patch.tracks[name][s].on;
    } else {
      var st = patch.tracks[name][s];
      if (!st.on) st.on = true; // 点击未触发的格子直接打开
      selected = { track: name, step: s };
    }
    persist();
    refreshGrid();
    refreshEditor();
  }

  /* ---------------- 步编辑器 ---------------- */
  var velSlider = document.getElementById("velSlider");
  var panSlider = document.getElementById("panSlider");
  var probSlider = document.getElementById("probSlider");

  function refreshEditor() {
    var title = document.getElementById("editorTitle");
    if (!selected) {
      title.textContent = "未选中步";
      return;
    }
    var st = patch.tracks[selected.track][selected.step];
    title.textContent = TRACK_LABELS[selected.track] + " · 第 " + (selected.step + 1) + " 步";
    velSlider.value = st.vel;
    panSlider.value = st.pan;
    probSlider.value = st.prob;
    updateEditorLabels();
  }

  function updateEditorLabels() {
    document.getElementById("velVal").textContent = Number(velSlider.value).toFixed(2);
    document.getElementById("panVal").textContent = Number(panSlider.value).toFixed(2);
    document.getElementById("probVal").textContent = Number(probSlider.value).toFixed(2);
  }

  function bindSlider(slider, key) {
    slider.addEventListener("input", function () {
      if (!selected) return;
      patch.tracks[selected.track][selected.step][key] = Number(slider.value);
      persist();
      refreshGrid();
      updateEditorLabels();
    });
  }
  bindSlider(velSlider, "vel");
  bindSlider(panSlider, "pan");
  bindSlider(probSlider, "prob");
  /* ---------------- 音频引擎（无漂移调度） ---------------- */
  var audioCtx = null;
  var master = null;
  var playing = false;
  var timerId = null;
  var startTime = 0;      // 本次播放的绝对起点（audioContext 时钟）
  var nextStep = 0;       // 全局步号（跨循环递增，永不归零取模累加）
  var LOOKAHEAD_MS = 25;
  var SCHEDULE_AHEAD = 0.12; // 秒

  function ensureAudio() {
    if (!audioCtxOk()) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = 0.9;
      master.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }
  function audioCtxOk() { return !!audioCtx; }

  function schedulerTick() {
    // 把未来 SCHEDULE_AHEAD 秒内的所有步一次性排入音频时钟
    while (C.stepTime(startTime, nextStep, patch.bpm) < audioCtx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(nextStep, C.stepTime(startTime, nextStep, patch.bpm));
      nextStep++;
    }
  }

  function scheduleStep(globalStep, when) {
    var col = globalStep % C.STEPS;
    var kit = patch.kits[patch.kitIndex];
    C.TRACKS.forEach(function (name) {
      var st = patch.tracks[name][col];
      if (!st.on) return;
      if (Math.random() >= st.prob) return;
      var samples = C.renderVoice(name, kit[name], st.vel, audioCtx.sampleRate, Math.random);
      var buf = audioCtx.createBuffer(1, samples.length, audioCtx.sampleRate);
      buf.getChannelData(0).set(samples);
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var panner = audioCtx.createStereoPanner();
      panner.pan.value = st.pan;
      src.connect(panner).connect(master);
      src.start(when); // 精确到采样级的音频时钟调度
    });
    // 播放头动画
    var delay = Math.max(0, (when - audioCtx.currentTime) * 1000);
    setTimeout(function () { flashColumn(col); }, delay);
  }

  var lastCol = -1;
  function flashColumn(col) {
    if (!playing) return;
    C.TRACKS.forEach(function (name) {
      if (lastCol >= 0) cells[name][lastCol].classList.remove("playing");
      cells[name][col].classList.add("playing");
    });
    lastCol = col;
  }

  var playBtn = document.getElementById("playBtn");
  function togglePlay() {
    if (playing) {
      playing = false;
      clearInterval(timerId);
      playBtn.textContent = "▶ 播放";
      if (lastCol >= 0) {
        C.TRACKS.forEach(function (name) { cells[name][lastCol].classList.remove("playing"); });
        lastCol = -1;
      }
      setStatus("已停止");
    } else {
      ensureAudio();
      playing = true;
      nextStep = 0;
      startTime = audioCtx.currentTime + 0.08; // 起点固定，之后全部由网格推算
      schedulerTick();
      timerId = setInterval(schedulerTick, LOOKAHEAD_MS);
      playBtn.textContent = "■ 停止";
      setStatus("播放中 · " + patch.bpm + " BPM · " + patch.kits[patch.kitIndex].name);
    }
  }
  playBtn.addEventListener("click", togglePlay);

  /* ---------------- 顶部控件 ---------------- */
  var bpmInput = document.getElementById("bpmInput");
  bpmInput.value = patch.bpm;
  bpmInput.addEventListener("change", function () {
    patch.bpm = Math.min(300, Math.max(40, Number(bpmInput.value) || 120));
    bpmInput.value = patch.bpm;
    persist();
  });

  var kitSelect = document.getElementById("kitSelect");
  patch.kits.forEach(function (kit, i) {
    var opt = document.createElement("option");
    opt.value = i;
    opt.textContent = (i + 1) + ". " + kit.name;
    kitSelect.appendChild(opt);
  });
  kitSelect.value = patch.kitIndex;
  kitSelect.addEventListener("change", function () {
    patch.kitIndex = Number(kitSelect.value);
    persist();
  });

  /* ---------------- 补丁保存 / 载入 ---------------- */
  document.getElementById("saveBtn").addEventListener("click", function () {
    var json = C.serializePatch(patch);
    persist();
    var blob = new Blob([json], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "drum16-patch.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("补丁已保存（下载 + localStorage）");
  });

  var fileInput = document.getElementById("fileInput");
  document.getElementById("loadBtn").addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        patch = C.parsePatch(reader.result);
        persist();
        bpmInput.value = patch.bpm;
        kitSelect.value = patch.kitIndex;
        refreshGrid();
        refreshEditor();
        setStatus("补丁已载入，步进数据完整");
      } catch (err) {
        setStatus("载入失败：" + err.message);
      }
    };
    reader.readAsText(file);
    fileInput.value = "";
  });

  /* ---------------- 导出 WAV ---------------- */
  document.getElementById("exportBtn").addEventListener("click", function () {
    setStatus("渲染中…");
    setTimeout(function () {
      var sr = 44100;
      var mix = C.renderMix(patch, 2, sr, 0xC0FFEE);
      var wav = C.encodeWav(mix.left, mix.right, sr);
      var blob = new Blob([wav], { type: "audio/wav" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "drum16-loop.wav";
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus("WAV 已导出（2 循环，" + (mix.left.length / sr).toFixed(3) + " 秒）");
    }, 30);
  });

  /* ---------------- 启动 ---------------- */
  buildGrid();
  refreshEditor();
})();
