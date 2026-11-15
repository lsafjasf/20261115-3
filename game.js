// 渲染 / 交互 / 音频
(function () {
  const S = window.GreenSim;
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const msgEl = document.getElementById("msg");
  let state = S.createState();
  let running = false;
  let speed = 1;
  let acc = 0;
  let lastTs = 0;
  let gameOver = false;

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
        '<label>热量分配 <input type="range" min="0" max="100" value="33" data-k="heat"></label>' +
        '<label>水阀开度 <input type="range" min="0" max="100" value="50" data-k="valve"></label>' +
        '<label>遮阳 <input type="range" min="0" max="100" value="0" data-k="shade"></label>' +
        '<label>补光 <button data-k="light">关</button> <span data-k="wear"></span></label>';
      panel.appendChild(card);
      const refs = { card: card };
      card.querySelectorAll("input[type=range]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          const v = inp.value / 100;
          if (inp.dataset.k === "heat") state.ctrl.heatAlloc[i] = v;
          if (inp.dataset.k === "valve") state.ctrl.valve[i] = v;
          if (inp.dataset.k === "shade") state.ctrl.shade[i] = v;
          ensureAudio();
        });
      });
      const btn = card.querySelector("button[data-k=light]");
      btn.addEventListener("click", function () {
        state.ctrl.lightOn[i] = !state.ctrl.lightOn[i];
        btn.textContent = state.ctrl.lightOn[i] ? "开" : "关";
        btn.classList.toggle("on", state.ctrl.lightOn[i]);
        ensureAudio();
      });
      zoneCards.push(refs);
    });
  }

  const btnBoiler = document.getElementById("btnBoiler");
  const btnPump = document.getElementById("btnPump");
  btnBoiler.addEventListener("click", function () {
    state.ctrl.boilerOn = !state.ctrl.boilerOn;
    ensureAudio();
  });
  btnPump.addEventListener("click", function () {
    state.ctrl.pumpOn = !state.ctrl.pumpOn;
    ensureAudio();
  });
  document.getElementById("btnStart").addEventListener("click", function () {
    running = !running;
    this.textContent = running ? "暂停" : "开始";
    ensureAudio();
  });
  document.getElementById("btnSpeed").addEventListener("click", function () {
    speed = speed >= 8 ? 1 : speed * 2;
    this.textContent = "速度 ×" + speed;
  });
  document.getElementById("btnReset").addEventListener("click", reset);

  function reset() {
    state = S.createState();
    running = false;
    gameOver = false;
    document.getElementById("btnStart").textContent = "开始";
    msgEl.textContent = "";
    buildPanel();
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
    btnPump.textContent = "水泵:" + (state.ctrl.pumpOn ? "开" : "关") + (state.devices.pump.broken ? "(坏)" : "");
    btnPump.classList.toggle("on", state.ctrl.pumpOn);
  }

  function checkEnd() {
    if (gameOver) return;
    if (state.failed) {
      gameOver = true;
      running = false;
      msgEl.textContent = "✘ 失败:" + state.failReason + "(" + fmtTime(state.timeMin) + ")——点击重置再来";
      msgEl.style.color = "#ff7b6b";
    } else if (state.timeMin >= S.DAY_MIN) {
      gameOver = true;
      running = false;
      if (S.isWin(state)) {
        msgEl.textContent = "✔ 成功!24 小时完成,作物健康,剩余电量 " + state.battery.toFixed(0) + "%";
        msgEl.style.color = "#6be08a";
      } else {
        const bad = state.zones.filter(function (z) { return z.health < 50; }).map(function (z) { return z.crop.name; });
        msgEl.textContent = "✘ 未达标:" + (state.battery < 20 ? "电量不足两成(" + state.battery.toFixed(0) + "%)" : "") +
          (bad.length ? " 作物不健康:" + bad.join("、") : "");
        msgEl.style.color = "#ffb04a";
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
