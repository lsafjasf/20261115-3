// 渲染 / 交互 / 音频
(function () {
  const S = window.GreenSim;
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const msgEl = document.getElementById("msg");
  const cvWrap = document.getElementById("cvWrap");
  const srEl = document.getElementById("srStatus");
  let state = S.createState();
  let running = false;
  let speed = 1;
  let acc = 0;
  let lastTs = 0;
  let gameOver = false;

  // ---------- 键盘交互状态(与鼠标共享同一份 state) ----------
  let selectedZone = 0;   // 当前画布焦点选中的温室 0..2
  let activeSlider = null; // 当前用方向键调节的滑杆:"heat" | "valve" | "shade" | null

  function announce(text) {
    if (!srEl) return;
    srEl.textContent = "";
    // 强制屏幕阅读器重新朗读同内容
    setTimeout(function () { srEl.textContent = text; }, 30);
  }

  function zoneSummary(i) {
    const z = state.zones[i];
    const lamp = state.devices.lights[i];
    return (i + 1) + "号棚 " + z.crop.name +
      ",温度" + z.temp.toFixed(1) + "度" +
      ",光照" + (z.light * 100).toFixed(0) + "% " +
      ",水分" + (z.moisture * 100).toFixed(0) + "% " +
      ",健康" + z.health.toFixed(0) + "% " +
      ",补光灯" + (lamp.broken ? "已损坏" : lamp.on ? "开" : "关") +
      ",热量分配" + (state.ctrl.heatAlloc[i] * 100).toFixed(0) + "%" +
      ",水阀" + (state.ctrl.valve[i] * 100).toFixed(0) + "%" +
      ",遮阳" + (state.ctrl.shade[i] * 100).toFixed(0) + "%";
  }

  function globalSummary() {
    return "时间" + fmtTime(state.timeMin) +
      ",室外" + state.outdoor.toFixed(1) + "度" +
      ",电量" + state.battery.toFixed(0) + "%" +
      ",燃料" + state.fuel.toFixed(0) + "%" +
      ",锅炉" + (state.devices.boiler.broken ? "损坏" : state.ctrl.boilerOn ? "开" : "关") +
      ",水泵" + (state.devices.pump.broken ? "损坏" : state.ctrl.pumpOn ? "开" : "关") +
      (state.blackout ? ",警告:电量枯竭设备断电" : "");
  }

  // ---------- 控制面板 ----------
  const panel = document.getElementById("panel");
  const zoneCards = [];
  function buildPanel() {
    panel.innerHTML = "";
    zoneCards.length = 0;
    state.zones.forEach(function (z, i) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        "<h3>" + (i + 1) + " 号棚 · " + z.crop.name + "</h3>" +
        '<label>热量分配 <input type="range" min="0" max="100" value="33" data-k="heat"' +
        ' aria-label="' + (i + 1) + '号棚热量分配百分比"></label>' +
        '<label>水阀开度 <input type="range" min="0" max="100" value="50" data-k="valve"' +
        ' aria-label="' + (i + 1) + '号棚水阀开度百分比"></label>' +
        '<label>遮阳 <input type="range" min="0" max="100" value="0" data-k="shade"' +
        ' aria-label="' + (i + 1) + '号棚遮阳百分比"></label>' +
        '<label>补光 <button data-k="light" type="button"' +
        ' aria-pressed="false" aria-label="' + (i + 1) + '号棚补光灯开关">关</button> <span data-k="wear"></span></label>';
      panel.appendChild(card);
      const refs = { card: card, sliders: {}, lightBtn: null };
      card.querySelectorAll("input[type=range]").forEach(function (inp) {
        refs.sliders[inp.dataset.k] = inp;
        inp.addEventListener("input", function () {
          const v = inp.value / 100;
          if (inp.dataset.k === "heat") state.ctrl.heatAlloc[i] = v;
          if (inp.dataset.k === "valve") state.ctrl.valve[i] = v;
          if (inp.dataset.k === "shade") state.ctrl.shade[i] = v;
          ensureAudio();
        });
      });
      const btn = card.querySelector("button[data-k=light]");
      refs.lightBtn = btn;
      btn.addEventListener("click", function () {
        toggleLight(i);
        ensureAudio();
      });
      zoneCards.push(refs);
    });
  }

  // 唯一的补光灯切换入口:鼠标点击与键盘操作调用同一函数,保证状态一致
  function toggleLight(i) {
    const lamp = state.devices.lights[i];
    if (lamp.broken) {
      announce((i + 1) + "号棚补光灯已损坏,无法切换");
      return;
    }
    state.ctrl.lightOn[i] = !state.ctrl.lightOn[i];
    const btn = zoneCards[i] && zoneCards[i].lightBtn;
    if (btn) {
      btn.textContent = state.ctrl.lightOn[i] ? "开" : "关";
      btn.classList.toggle("on", state.ctrl.lightOn[i]);
      btn.setAttribute("aria-pressed", state.ctrl.lightOn[i] ? "true" : "false");
    }
    announce((i + 1) + "号棚补光灯" + (state.ctrl.lightOn[i] ? "已打开" : "已关闭"));
  }

  // 键盘调节滑杆后,把状态写回对应 HTML 控件,鼠标/键盘两条路径完全等价
  function syncSliderToDOM(i, key) {
    const refs = zoneCards[i];
    if (!refs || !refs.sliders[key]) return;
    const inp = refs.sliders[key];
    if (key === "heat") inp.value = Math.round(state.ctrl.heatAlloc[i] * 100);
    if (key === "valve") inp.value = Math.round(state.ctrl.valve[i] * 100);
    if (key === "shade") inp.value = Math.round(state.ctrl.shade[i] * 100);
  }

  const SLIDER_STEP = 0.05;
  function nudgeSlider(delta) {
    if (!activeSlider) return;
    const key = activeSlider;
    const arr = state.ctrl[key === "heat" ? "heatAlloc" : key === "valve" ? "valve" : "shade"];
    const cur = arr[selectedZone];
    arr[selectedZone] = Math.max(0, Math.min(1, cur + delta * SLIDER_STEP));
    syncSliderToDOM(selectedZone, key);
    ensureAudio();
    const name = key === "heat" ? "热量分配" : key === "valve" ? "水阀开度" : "遮阳";
    announce((selectedZone + 1) + "号棚" + name + " " + (arr[selectedZone] * 100).toFixed(0) + "%");
  }

  const btnBoiler = document.getElementById("btnBoiler");
  const btnPump = document.getElementById("btnPump");
  const btnStart = document.getElementById("btnStart");
  const btnSpeed = document.getElementById("btnSpeed");
  const btnReset = document.getElementById("btnReset");

  // 以下 toggle* 函数是鼠标与键盘的共同入口,两条输入路径产生完全相同的状态变更
  function toggleBoiler() {
    if (state.devices.boiler.broken) { announce("锅炉已损坏,无法开关"); return; }
    state.ctrl.boilerOn = !state.ctrl.boilerOn;
    ensureAudio();
    syncUI();
    announce("锅炉" + (state.ctrl.boilerOn ? "已开启" : "已关闭"));
  }
  function togglePump() {
    if (state.devices.pump.broken) { announce("水泵已损坏,无法开关"); return; }
    state.ctrl.pumpOn = !state.ctrl.pumpOn;
    ensureAudio();
    syncUI();
    announce("水泵" + (state.ctrl.pumpOn ? "已开启" : "已关闭"));
  }
  function toggleRunning() {
    if (gameOver) { announce("本局已结束,请按 R 重置后再开始"); return; }
    running = !running;
    btnStart.textContent = running ? "暂停" : "开始";
    ensureAudio();
    syncUI();
    announce(running ? "模拟开始" : "模拟已暂停");
  }
  function cycleSpeed() {
    speed = speed >= 8 ? 1 : speed * 2;
    btnSpeed.textContent = "速度 ×" + speed;
    announce("播放速度 ×" + speed);
  }

  btnBoiler.addEventListener("click", toggleBoiler);
  btnPump.addEventListener("click", togglePump);
  btnStart.addEventListener("click", toggleRunning);
  btnSpeed.addEventListener("click", cycleSpeed);
  btnReset.addEventListener("click", reset);

  function reset() {
    state = S.createState();
    running = false;
    gameOver = false;
    speed = 1;
    selectedZone = 0;
    activeSlider = null;
    btnStart.textContent = "开始";
    btnSpeed.textContent = "速度 ×1";
    msgEl.textContent = "";
    buildPanel();
    announce("已重置,回到初始状态。" + zoneSummary(0));
  }

  // ---------- Web Audio:泵机/锅炉/补光/警报 ----------
  let AC = null;
  const audio = {};
  function ensureAudio() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return; }
    const ACtor = window.AudioContext || window.webkitAudioContext;
    if (!ACtor) return;
    AC = new ACtor();
    const master = AC.createGain();
    master.gain.value = 0.15;
    master.connect(AC.destination);
    audio.master = master;
    // 水泵:锯齿低频 + 颤动
    audio.pumpOsc = AC.createOscillator();
    audio.pumpOsc.type = "sawtooth";
    audio.pumpOsc.frequency.value = 82;
    audio.pumpGain = AC.createGain();
    audio.pumpGain.gain.value = 0;
    const lfo = AC.createOscillator();
    lfo.frequency.value = 7;
    const lfoG = AC.createGain();
    lfoG.gain.value = 6;
    lfo.connect(lfoG).connect(audio.pumpOsc.frequency);
    audio.pumpOsc.connect(audio.pumpGain).connect(master);
    audio.pumpOsc.start(); lfo.start();
    // 锅炉:低鸣
    audio.boilerOsc = AC.createOscillator();
    audio.boilerOsc.type = "triangle";
    audio.boilerOsc.frequency.value = 52;
    audio.boilerGain = AC.createGain();
    audio.boilerGain.gain.value = 0;
    audio.boilerOsc.connect(audio.boilerGain).connect(master);
    audio.boilerOsc.start();
    // 补光灯:轻微高频电流声
    audio.lightOsc = AC.createOscillator();
    audio.lightOsc.type = "sine";
    audio.lightOsc.frequency.value = 240;
    audio.lightGain = AC.createGain();
    audio.lightGain.gain.value = 0;
    audio.lightOsc.connect(audio.lightGain).connect(master);
    audio.lightOsc.start();
    // 警报
    audio.alarmOsc = AC.createOscillator();
    audio.alarmOsc.type = "square";
    audio.alarmOsc.frequency.value = 660;
    audio.alarmGain = AC.createGain();
    audio.alarmGain.gain.value = 0;
    audio.alarmOsc.connect(audio.alarmGain).connect(master);
    audio.alarmOsc.start();
  }

  function updateAudio(tSec) {
    if (!AC) return;
    const d = state.devices;
    const flow = state.ctrl.valve[0] + state.ctrl.valve[1] + state.ctrl.valve[2];
    const pumpOn = d.pump.on && flow > 0.05;
    audio.pumpGain.gain.setTargetAtTime(pumpOn ? 0.5 + 0.12 * flow : 0, AC.currentTime, 0.1);
    audio.pumpOsc.frequency.setTargetAtTime(70 + 25 * flow, AC.currentTime, 0.2);
    audio.boilerGain.gain.setTargetAtTime(d.boiler.on ? 0.6 : 0, AC.currentTime, 0.15);
    const lights = d.lights.filter(function (l) { return l.on; }).length;
    audio.lightGain.gain.setTargetAtTime(lights ? 0.05 * lights : 0, AC.currentTime, 0.1);
    const danger = state.battery < 15 || state.blackout;
    audio.alarmGain.gain.setTargetAtTime(danger && running && (tSec % 1 < 0.5) ? 0.12 : 0, AC.currentTime, 0.05);
  }

  // ---------- Canvas 渲染 ----------
  function fmtTime(t) {
    const h = Math.floor(t / 60) % 24, m = Math.floor(t % 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function tempColor(t) {
    // 冷蓝 -> 舒适绿 -> 热红
    const v = Math.max(-10, Math.min(40, t));
    const r = Math.round(v > 20 ? 60 + (v - 20) * 9 : 60);
    const b = Math.round(v < 15 ? 120 + (15 - v) * 5 : 80);
    const g = Math.round(140 - Math.abs(v - 20) * 3);
    return "rgba(" + r + "," + Math.max(60, g) + "," + b + ",0.55)";
  }

  function flowLine(x1, y1, x2, y2, color, active, tSec, width) {
    ctx.save();
    ctx.strokeStyle = active ? color : "rgba(90,105,125,0.35)";
    ctx.lineWidth = width || 3;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = active ? -tSec * 40 : 0;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function bar(x, y, w, h, frac, color, label) {
    ctx.fillStyle = "#0d1219";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.strokeStyle = "#41546e";
    ctx.strokeRect(x, y, w, h);
    if (label) {
      ctx.fillStyle = "#dfe7ef";
      ctx.font = "10px sans-serif";
      ctx.fillText(label, x + 3, y + h - 3);
    }
  }

  function drawEnergy(tSec) {
    const nat = S.naturalLight(state.timeMin);
    // 太阳
    ctx.fillStyle = nat > 0 ? "#ffd75e" : "#3a4356";
    ctx.beginPath();
    ctx.arc(80, 110, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8fa1b3";
    ctx.font = "11px sans-serif";
    ctx.fillText("日照 " + (nat * 100).toFixed(0) + "%", 45, 145);
    // 太阳能板
    ctx.fillStyle = "#2456a8";
    ctx.fillRect(40, 160, 80, 40);
    ctx.strokeStyle = "#6ea8ff";
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(40 + i * 20, 160); ctx.lineTo(40 + i * 20, 200); ctx.stroke();
    }
    ctx.fillStyle = "#8fa1b3";
    ctx.fillText("发电 " + state.lastSolar.toFixed(1) + "/h", 45, 215);
    // 电池
    ctx.fillStyle = "#8fa1b3";
    ctx.fillText("电池 " + state.battery.toFixed(0) + "%", 45, 245);
    bar(40, 250, 90, 16, state.battery / 100, state.battery >= 20 ? "#46a06b" : "#c0392b", "");
    ctx.fillStyle = "#8fa1b3";
    ctx.fillText("负载 " + state.lastLoad.toFixed(1) + "/h", 45, 285);
    // 锅炉
    ctx.fillStyle = state.devices.boiler.on ? "#b3541e" : "#2c3a4d";
    ctx.fillRect(40, 300, 80, 44);
    ctx.fillStyle = "#dfe7ef";
    ctx.fillText("锅炉" + (state.devices.boiler.broken ? "(损坏)" : state.devices.boiler.on ? "·运行" : ""), 55, 325);
    ctx.fillStyle = "#8fa1b3";
    ctx.fillText("燃料 " + state.fuel.toFixed(0) + "%", 45, 360);
    bar(40, 365, 90, 10, state.fuel / 60, "#b3541e", "");
    ctx.fillText("锅炉寿命 " + Math.max(0, 100 - state.devices.boiler.wear) + "%", 40, 392);
    ctx.fillText("水泵寿命 " + Math.max(0, 100 - state.devices.pump.wear) + "%", 40, 408);
    // 能量流动画
    flowLine(80, 200, 85, 250, "#ffd75e", state.lastSolar > 0.1, tSec);
    flowLine(130, 258, 300, 258, "#ff9f5e", state.lastLoad > 0.1, tSec);
    flowLine(120, 322, 300, 322, "#ff6b4a", state.devices.boiler.on, tSec, 4);
  }

  function drawZone(i, x, tSec) {
    const z = state.zones[i];
    const y = 80, w = 215, h = 440;
    // 棚体
    ctx.fillStyle = tempColor(z.temp);
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w / 2, y - 28);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#6ea8ff";
    ctx.strokeRect(x, y, w, h);
    // 光照覆盖
    ctx.fillStyle = "rgba(255,230,120," + (z.light * 0.25).toFixed(3) + ")";
    ctx.fillRect(x, y, w, h);
    // 遮阳帘
    const sh = state.ctrl.shade[i];
    if (sh > 0.02) {
      ctx.fillStyle = "rgba(40,46,56,0.85)";
      ctx.fillRect(x, y, w, h * sh * 0.6);
      ctx.strokeStyle = "#222";
      for (let k = 1; k < 5; k++) {
        ctx.beginPath();
        ctx.moveTo(x, y + (h * sh * 0.6 * k) / 5);
        ctx.lineTo(x + w, y + (h * sh * 0.6 * k) / 5);
        ctx.stroke();
      }
    }
    // 补光灯
    const lamp = state.devices.lights[i];
    ctx.fillStyle = lamp.broken ? "#5a2020" : lamp.on ? "#fff3a0" : "#3a4356";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 18, 9, 0, Math.PI * 2);
    ctx.fill();
    if (lamp.on) {
      ctx.strokeStyle = "rgba(255,240,150,0.6)";
      for (let a = -1; a <= 1; a++) {
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y + 27);
        ctx.lineTo(x + w / 2 + a * 55, y + 130);
        ctx.stroke();
      }
    }
    // 土壤与作物
    ctx.fillStyle = "#4a3423";
    ctx.fillRect(x, y + h - 60, w, 60);
    const cx = x + w / 2, base = y + h - 60;
    const stageH = 40 + z.stage * 35 + z.stageProg * 30;
    const healthy = z.health / 100;
    ctx.strokeStyle = "rgb(" + Math.round(180 - 120 * healthy) + "," + Math.round(90 + 110 * healthy) + ",60)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, base - stageH);
    ctx.stroke();
    for (let l = 0; l <= z.stage; l++) {
      const ly = base - stageH * (0.4 + 0.3 * l);
      ctx.beginPath();
      ctx.ellipse(cx - 14, ly, 13, 6, -0.5, 0, Math.PI * 2);
      ctx.ellipse(cx + 14, ly, 13, 6, 0.5, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
    if (z.stage === 2) {
      ctx.fillStyle = z.crop.name === "生菜" ? "#7ed07e" : "#e0453a";
      ctx.beginPath();
      ctx.arc(cx, base - stageH - 8, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    // 数据
    ctx.fillStyle = "#eaf2fa";
    ctx.font = "12px sans-serif";
    ctx.fillText((i + 1) + "号 " + z.crop.name + " · " + z.crop.stages[z.stage], x + 8, y + 20);
    ctx.fillText(z.temp.toFixed(1) + "℃  光 " + (z.light * 100).toFixed(0) + "%", x + 8, y + 38);
    bar(x + 8, y + h - 52, 60, 8, z.moisture, "#4aa3df", "");
    ctx.fillStyle = "#cfe3f5";
    ctx.fillText("水", x + 72, y + h - 45);
    bar(x + 100, y + h - 52, 70, 8, z.health / 100, z.health >= 50 ? "#46a06b" : "#c0392b", "");
    ctx.fillStyle = "#cfe3f5";
    ctx.fillText("健康", x + 174, y + h - 45);
    ctx.fillStyle = "#8fa1b3";
    ctx.font = "10px sans-serif";
    ctx.fillText("灯寿命 " + Math.max(0, 100 - lamp.wear) + "%" + (lamp.broken ? " 已损坏" : ""), x + 8, y + h - 8);
    // 键盘选中焦点框:仅包裹当前选中的温室,与 DOM 焦点环联动
    if (i === selectedZone) {
      ctx.save();
      ctx.strokeStyle = "#7fd4ff";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -tSec * 30;
      ctx.strokeRect(x - 4, y - 34, w + 8, h + 38);
      ctx.setLineDash([]);
      ctx.fillStyle = "#7fd4ff";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("▶ 键盘焦点 (" + (i + 1) + "号棚)", x + 8, y - 40);
      if (activeSlider) {
        const sName = activeSlider === "heat" ? "热量" : activeSlider === "valve" ? "水阀" : "遮阳";
        ctx.fillText("调节中:" + sName + " ←/→", x + 150, y - 40);
      }
      ctx.restore();
    }
    // 与锅炉/电池的热流与电流
    flowLine(300, 322, x, y + 240, "#ff6b4a", state.devices.boiler.on && state.ctrl.heatAlloc[i] > 0.03, tSec, 2);
    flowLine(300, 258, x, y + 60, "#ff9f5e", lamp.on, tSec, 2);
  }

  function drawTop(tSec) {
    ctx.fillStyle = "#0d1219";
    ctx.fillRect(0, 0, cv.width, 46);
    ctx.fillStyle = "#eaf2fa";
    ctx.font = "15px sans-serif";
    ctx.fillText("时间 " + fmtTime(state.timeMin), 20, 29);
    ctx.fillText("室外 " + state.outdoor.toFixed(1) + "℃", 130, 29);
    ctx.fillText("电量 " + state.battery.toFixed(0) + "%", 250, 29);
    ctx.fillText("燃料 " + state.fuel.toFixed(0) + "%", 350, 29);
    if (S.coldSnapDrop(state, state.timeMin) > 0) {
      ctx.fillStyle = (tSec % 1 < 0.5) ? "#ff5e4a" : "#ffb04a";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("❄ 寒潮来袭!热负荷上升", 470, 29);
    } else if (state.blackout) {
      ctx.fillStyle = "#ff5e4a";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("⚠ 电量枯竭,设备断电!", 470, 29);
    }
  }

  // ---------- 主循环 ----------
  function syncUI() {
    btnBoiler.textContent = "锅炉:" + (state.ctrl.boilerOn ? "开" : "关") + (state.devices.boiler.broken ? "(坏)" : "");
    btnBoiler.classList.toggle("on", state.ctrl.boilerOn);
    btnBoiler.setAttribute("aria-pressed", state.ctrl.boilerOn ? "true" : "false");
    btnPump.textContent = "水泵:" + (state.ctrl.pumpOn ? "开" : "关") + (state.devices.pump.broken ? "(坏)" : "");
    btnPump.classList.toggle("on", state.ctrl.pumpOn);
    btnPump.setAttribute("aria-pressed", state.ctrl.pumpOn ? "true" : "false");
  }

  // ---------- 可见焦点 ----------
  cv.addEventListener("focus", function () {
    cvWrap.classList.add("focus-visible");
    announce(globalSummary() + "。当前选中:" + zoneSummary(selectedZone));
  });
  cv.addEventListener("blur", function () {
    cvWrap.classList.remove("focus-visible");
    activeSlider = null;
  });

  function selectZone(i) {
    selectedZone = Math.max(0, Math.min(state.zones.length - 1, i));
    activeSlider = null;
    announce("已选中" + zoneSummary(selectedZone));
  }

  // ---------- 画布键盘操作:与鼠标控件共用同一批状态变更函数 ----------
  cv.addEventListener("keydown", function (e) {
    const k = e.key;
    let handled = true;
    if (k === "ArrowRight") {
      if (activeSlider) nudgeSlider(1);
      else selectZone(selectedZone + 1);
    } else if (k === "ArrowLeft") {
      if (activeSlider) nudgeSlider(-1);
      else selectZone(selectedZone - 1);
    } else if (k === "ArrowUp") {
      if (activeSlider) nudgeSlider(1);
      else { activeSlider = "heat"; announce("已选中热量分配滑杆,用左右方向键微调。" + zoneSummary(selectedZone)); }
    } else if (k === "ArrowDown") {
      if (activeSlider) nudgeSlider(-1);
      else { activeSlider = "heat"; announce("已选中热量分配滑杆,用左右方向键微调。" + zoneSummary(selectedZone)); }
    } else if (k === "1" || k === "2" || k === "3") {
      selectZone(Number(k) - 1);
    } else if (k === "h" || k === "H") {
      activeSlider = "heat";
      announce("已选中" + (selectedZone + 1) + "号棚热量分配,左右方向键每次调整5%");
    } else if (k === "v" || k === "V") {
      activeSlider = "valve";
      announce("已选中" + (selectedZone + 1) + "号棚水阀,左右方向键每次调整5%");
    } else if (k === "s" || k === "S") {
      activeSlider = "shade";
      announce("已选中" + (selectedZone + 1) + "号棚遮阳,左右方向键每次调整5%");
    } else if (k === "Enter") {
      toggleLight(selectedZone);
    } else if (k === " " || k === "Spacebar") {
      toggleRunning();
    } else if (k === "b" || k === "B") {
      toggleBoiler();
    } else if (k === "p" || k === "P") {
      togglePump();
    } else if (k === "+" || k === "=") {
      cycleSpeed();
    } else if (k === "-" || k === "_") {
      speed = speed <= 1 ? 1 : speed / 2;
      btnSpeed.textContent = "速度 ×" + speed;
      announce("播放速度 ×" + speed);
    } else if (k === "r" || k === "R") {
      reset();
    } else if (k === "Home") {
      selectZone(0);
    } else if (k === "End") {
      selectZone(state.zones.length - 1);
    } else if (k === "Escape") {
      if (activeSlider) {
        activeSlider = null;
        announce("已退出滑杆调节模式。" + zoneSummary(selectedZone));
      }
    } else if (k === "Tab") {
      handled = false; // 保留 Tab 自然焦点顺序
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  });

  function checkEnd() {
    if (gameOver) return;
    if (state.failed) {
      gameOver = true;
      running = false;
      msgEl.textContent = "✘ 失败:" + state.failReason + "(" + fmtTime(state.timeMin) + ")——点击重置再来";
      msgEl.style.color = "#ff7b6b";
      announce("游戏失败:" + state.failReason + "。按 R 键重置再来");
    } else if (state.timeMin >= S.DAY_MIN) {
      gameOver = true;
      running = false;
      if (S.isWin(state)) {
        msgEl.textContent = "✔ 成功!24 小时完成,作物健康,剩余电量 " + state.battery.toFixed(0) + "%";
        msgEl.style.color = "#6be08a";
        announce("任务成功!24小时完成,作物健康,剩余电量" + state.battery.toFixed(0) + "%");
      } else {
        const bad = state.zones.filter(function (z) { return z.health < 50; }).map(function (z) { return z.crop.name; });
        msgEl.textContent = "✘ 未达标:" + (state.battery < 20 ? "电量不足两成(" + state.battery.toFixed(0) + "%)" : "") +
          (bad.length ? " 作物不健康:" + bad.join("、") : "");
        msgEl.style.color = "#ffb04a";
        announce("任务未达标,按 R 键重置后再试一次");
      }
      document.getElementById("btnStart").textContent = "开始";
    }
  }

  function frame(ts) {
    const tSec = ts / 1000;
    const dtReal = Math.min(0.1, tSec - lastTs || 0);
    lastTs = tSec;
    if (running && !gameOver) {
      acc += dtReal * speed;
      const tickSec = 0.25; // 每 0.25s(×1)推进 5 分钟
      while (acc >= tickSec) {
        acc -= tickSec;
        S.step(state);
        if (state.failed || state.timeMin >= S.DAY_MIN) { acc = 0; break; }
      }
      checkEnd();
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawTop(tSec);
    drawEnergy(tSec);
    for (let i = 0; i < 3; i++) drawZone(i, 300 + i * 230, tSec);
    updateAudio(tSec);
    syncUI();
    requestAnimationFrame(frame);
  }

  buildPanel();
  requestAnimationFrame(frame);
})();
