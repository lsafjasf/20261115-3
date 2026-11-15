/*
 * 编辑器主控：Canvas 拖拽、关键帧时间轴、播放循环、JSON 保存/重新载入、
 * localStorage 持久化与 Web Audio 开关。
 */
(function () {
  "use strict";

  const { Skeleton } = window.SKELETON_NS;
  const { KeyframeTrack } = window.ANIM_NS;
  const renderer = window.RENDER_NS;
  const { AudioFX } = window.AUDIO_NS;
  const defs = window.DEFAULTS_NS;

  const STORE_KEY = "skeleton-wave-editor-v1";
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");

  const state = {
    skeleton: null,
    track: null,
    playing: false,
    loop: true,
    speed: 1,
    playTime: 0,
    lastTs: 0,
    drag: null,
    selectedBone: null,
    audio: new AudioFX(),
  };

  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function buildDefault() {
    const skeleton = new Skeleton(defs.BONE_DEFS, defs.ROOT.x, defs.ROOT.y);
    const track = new KeyframeTrack(skeleton.order);
    track.duration = defs.DURATION;
    for (const f of defs.WAVE_KEYFRAMES) track.addFrame(f.time, f.pose);
    return { skeleton, track };
  }

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          skeleton: state.skeleton.toJSON(),
          animation: state.track.toJSON(),
        })
      );
    } catch (e) {
      setStatus("本地存储失败：" + e.message);
    }
  }

  function loadDefaultOrStored() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.skeleton = Skeleton.fromJSON(data.skeleton);
        state.track = KeyframeTrack.fromJSON(data.animation, state.skeleton.order);
        setStatus("已从浏览器本地存储重新载入上次会话");
        return;
      }
    } catch (e) {
      setStatus("本地数据损坏，回退到内置挥手示例");
    }
    const d = buildDefault();
    state.skeleton = d.skeleton;
    state.track = d.track;
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const solved = renderer.render(ctx, state.skeleton, {
      selected: state.drag && state.drag.handle,
    });
    updateRotationPanel();
    updateTimeline();
    return solved;
  }

  function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * canvas.width,
      y: ((evt.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onPointerDown(evt) {
    const p = canvasPos(evt);
    const solved = state.skeleton.solve();
    const handle = state.skeleton.hitTest(p.x, p.y, solved, 14);
    if (!handle) {
      state.selectedBone = null;
      render();
      return;
    }
    canvas.setPointerCapture(evt.pointerId);
    canvas.classList.add("dragging");
    state.drag = { handle, pointerId: evt.pointerId };
    state.selectedBone = handle.boneId;
    state.skeleton.dragTo(handle, p.x, p.y);
    state.audio.playTick();
    render();
  }

  function onPointerMove(evt) {
    if (!state.drag || evt.pointerId !== state.drag.pointerId) return;
    const p = canvasPos(evt);
    state.skeleton.dragTo(state.drag.handle, p.x, p.y);
    render();
  }

  function onPointerUp(evt) {
    if (!state.drag || evt.pointerId !== state.drag.pointerId) return;
    state.drag = null;
    canvas.classList.remove("dragging");
    persist();
    setStatus("姿态已更新并自动保存（骨长保持不变）");
  }

  function frame(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;
    if (state.playing) {
      state.playTime += dt * state.speed;
      const dur = state.track.duration || 1;
      if (state.playTime >= dur) {
        if (state.loop) {
          state.playTime = state.playTime % dur;
          state.audio.playLoop();
        } else {
          state.playTime = dur;
          stopPlayback();
        }
      }
      state.skeleton.applyPose(state.track.sample(state.playTime, state.loop));
    }
    render();
    requestAnimationFrame(frame);
  }

  function startPlayback() {
    state.playing = true;
    state.lastTs = 0;
    $("btnPlay").textContent = "⏸ 暂停";
    setStatus("播放挥手动画" + (state.loop ? "（循环）" : ""));
  }

  function stopPlayback() {
    state.playing = false;
    state.playTime = 0;
    state.lastTs = 0;
    state.skeleton.applyPose(state.track.sample(0, true));
    $("btnPlay").textContent = "▶ 播放";
    render();
  }

  function addKeyframe() {
    state.track.addFrame(
      Math.min(state.playTime, state.track.duration),
      state.skeleton.pose()
    );
    state.audio.playKeyframe();
    persist();
    refreshGapLabel();
    setStatus("已在 t=" + state.playTime.toFixed(2) + "s 记录关键帧");
  }

  function updateTimeline() {
    const tl = $("timeline");
    tl.querySelectorAll(".key-marker").forEach((n) => n.remove());
    const dur = state.track.duration || 1;
    for (const f of state.track.frames) {
      const m = document.createElement("div");
      m.className = "key-marker";
      m.style.left = (f.time / dur) * 100 + "%";
      m.title = "t=" + f.time.toFixed(2) + "s";
      tl.appendChild(m);
    }
    $("playhead").style.left = (state.playTime / dur) * 100 + "%";
    $("timeLabel").textContent = "t = " + state.playTime.toFixed(2) + " s";
  }

  function refreshGapLabel() {
    const gap = state.track.maxLoopGap();
    const el = $("gapLabel");
    if (gap < 1e-6) {
      el.textContent = "✓ 首尾连续";
      el.className = "ok";
    } else {
      el.textContent = "⚠ 首尾跳变 " + gap.toFixed(3) + " rad";
      el.className = "warn";
    }
  }

  function updateRotationPanel() {
    const id = state.selectedBone;
    if (!id) {
      $("boneName").textContent = "未选择";
      return;
    }
    const bone = state.skeleton.getBone(id);
    $("boneName").textContent = bone.name;
    const rot = state.skeleton.getRotation(id);
    $("rotSlider").value = rot;
    $("rotVal").textContent = rot.toFixed(2) + " rad";
  }

  function renderHierarchy() {
    const ol = $("hierarchy");
    ol.innerHTML = "";
    const childMap = new Map();
    for (const id of state.skeleton.order) {
      const b = state.skeleton.getBone(id);
      if (!childMap.has(b.parent)) childMap.set(b.parent, []);
      childMap.get(b.parent).push(id);
    }
    const build = (parent, level) => {
      const items = [];
      for (const id of childMap.get(parent) || []) {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = state.skeleton.getBone(id).name;
        span.style.paddingLeft = level * 8 + "px";
        span.addEventListener("click", () => {
          state.selectedBone = id;
          render();
        });
        li.appendChild(span);
        const children = build(id, level + 1);
        if (children.length) {
          const sub = document.createElement("ol");
          children.forEach((c) => sub.appendChild(c));
          li.appendChild(sub);
        }
        items.push(li);
      }
      return items;
    };
    build(null, 0).forEach((li) => ol.appendChild(li));
  }

  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readJSONFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function bindUI() {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    $("btnPlay").addEventListener("click", () => {
      if (state.playing) {
        state.playing = false;
        $("btnPlay").textContent = "▶ 播放";
      } else {
        startPlayback();
      }
    });
    $("btnStop").addEventListener("click", stopPlayback);
    $("chkLoop").addEventListener("change", (e) => {
      state.loop = e.target.checked;
    });
    $("speed").addEventListener("input", (e) => {
      state.speed = parseFloat(e.target.value);
      $("speedVal").textContent = state.speed.toFixed(2) + "×";
    });

    $("btnAddKey").addEventListener("click", addKeyframe);
    $("btnDelKey").addEventListener("click", () => {
      if (!state.track.frames.length) return;
      const nearest = state.track.frames.reduce((best, f) =>
        Math.abs(f.time - state.playTime) < Math.abs(best.time - state.playTime) ? f : best
      );
      state.track.removeFrameAt(nearest.time);
      persist();
      refreshGapLabel();
      render();
      setStatus("已删除 t=" + nearest.time.toFixed(2) + "s 关键帧");
    });
    $("btnResetPose").addEventListener("click", () => {
      state.skeleton.applyPose({});
      state.skeleton.localRot.forEach((_, id) => state.skeleton.setRotation(id, 0));
      persist();
      render();
      setStatus("姿态已复位为静止姿势");
    });
    $("btnLoadWave").addEventListener("click", () => {
      const d = buildDefault();
      state.skeleton = d.skeleton;
      state.track = d.track;
      state.playTime = 0;
      persist();
      refreshGapLabel();
      renderHierarchy();
      render();
      setStatus("已载入内置七段骨骼挥手循环");
    });

    $("rotSlider").addEventListener("input", (e) => {
      if (!state.selectedBone) return;
      state.skeleton.setRotation(state.selectedBone, parseFloat(e.target.value));
      persist();
      render();
    });

    $("btnSave").addEventListener("click", () => {
      persist();
      download("skeleton.json", state.skeleton.toJSON());
      download("animation.json", state.track.toJSON());
      setStatus("已导出 skeleton.json 与 animation.json，并写入本地存储");
    });
    $("dlSkel").addEventListener("click", (e) => {
      e.preventDefault();
      download("skeleton.json", state.skeleton.toJSON());
    });
    $("dlAnim").addEventListener("click", (e) => {
      e.preventDefault();
      download("animation.json", state.track.toJSON());
    });

    $("btnReload").addEventListener("click", () => {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) throw new Error("本地没有已保存的会话");
        const data = JSON.parse(raw);
        state.skeleton = Skeleton.fromJSON(data.skeleton);
        state.track = KeyframeTrack.fromJSON(data.animation, state.skeleton.order);
        state.playTime = 0;
        state.skeleton.applyPose(state.track.sample(0, true));
        refreshGapLabel();
        renderHierarchy();
        render();
        setStatus("♻ 重新载入成功：骨骼 " + state.skeleton.order.length +
          " 段，关键帧 " + state.track.frames.length + " 个");
      } catch (e) {
        setStatus("重新载入失败：" + e.message);
      }
    });

    $("fileSkel").addEventListener("change", async (e) => {
      try {
        const json = await readJSONFile(e.target.files[0]);
        state.skeleton = Skeleton.fromJSON(json);
        persist();
        renderHierarchy();
        render();
        setStatus("已导入骨骼 JSON：" + state.skeleton.order.length + " 段");
      } catch (err) {
        setStatus("骨骼导入失败：" + err.message);
      }
    });
    $("fileAnim").addEventListener("change", async (e) => {
      try {
        const json = await readJSONFile(e.target.files[0]);
        state.track = KeyframeTrack.fromJSON(json, state.skeleton.order);
        state.playTime = 0;
        persist();
        refreshGapLabel();
        render();
        setStatus("已导入动画 JSON：" + state.track.frames.length + " 个关键帧");
      } catch (err) {
        setStatus("动画导入失败：" + err.message);
      }
    });

    $("chkAudio").addEventListener("change", (e) => {
      state.audio.setEnabled(e.target.checked);
      setStatus(e.target.checked ? "Web Audio 已开启" : "Web Audio 已关闭（静音）");
    });

    $("timeline").addEventListener("pointerdown", (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      state.playTime = ratio * (state.track.duration || 1);
      state.skeleton.applyPose(state.track.sample(state.playTime, state.loop));
      render();
    });
  }

  window.__EDITOR__ = { state, buildDefault, persist, setStatus };
  window.__EDITOR__.init = function init() {
    loadDefaultOrStored();
    state.skeleton.applyPose(state.track.sample(0, true));
    renderHierarchy();
    refreshGapLabel();
    bindUI();
    render();
    requestAnimationFrame(frame);
  };

  window.__EDITOR__.init();
})();
