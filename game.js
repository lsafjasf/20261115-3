(function () {
  "use strict";

  const simApi = window.StationSim;
  const NODES = simApi.NODES;
  const EDGES = simApi.EDGES;
  const MAP = simApi.MAP;
  const DOM = {};
  const canvas = document.getElementById("stationCanvas");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(id) {
    return document.getElementById(id);
  }

  function cacheDom() {
    const ids = [
      "missionClock", "missionStatus", "audioToggle", "audioGlyph", "barrierAState",
      "barrierBState", "transformerDoorState", "pump1Rate", "pump2Rate", "pump1HeatBar",
      "pump2HeatBar", "pump1Heat", "pump2Heat", "rainLoad", "insideCount", "toast",
      "presetButton", "startButton", "riskCard", "riskBadge", "riskFill", "riskValue",
      "riskZone", "evacuatedCount", "evacuatedTotal", "waterLevel", "transformerLevel",
      "transformerTag", "pumpTotal", "pumpStateLabel", "logCount", "eventLog",
      "resultBanner", "resultMark", "resultEyebrow", "resultTitle", "resultCopy",
      "restartButton", "canvasWrap"
    ];
    for (const id of ids) DOM[id] = $(id);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setText(id, text) {
    const element = DOM[id] || $(id);
    if (element && element.textContent !== text) element.textContent = text;
  }

  function formatNumber(value, digits) {
    return Number(value).toFixed(digits == null ? 0 : digits);
  }

  class AudioEngine {
    constructor() {
      this.context = null;
      this.enabled = false;
      this.rainGain = null;
      this.humGain = null;
      this.alarmTimer = null;
      this.latestRisk = 0;
      this.latestStatus = "ready";
    }

    unlock() {
      if (!this.context) this.createGraph();
      if (this.context && this.context.state === "suspended") this.context.resume();
      return Boolean(this.context);
    }

    createGraph() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      this.context = context;
      const master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      this.master = master;

      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        samples[index] = last;
      }
      const rain = context.createBufferSource();
      const rainFilter = context.createBiquadFilter();
      const rainGain = context.createGain();
      rain.buffer = buffer;
      rain.loop = true;
      rainFilter.type = "lowpass";
      rainFilter.frequency.value = 1550;
      rainFilter.Q.value = 0.45;
      rainGain.gain.value = 0.42;
      rain.connect(rainFilter).connect(rainGain).connect(master);
      rain.start();
      this.rainGain = rainGain;

      const hum = context.createOscillator();
      const humGain = context.createGain();
      hum.type = "sine";
      hum.frequency.value = 58;
      humGain.gain.value = 0;
      hum.connect(humGain).connect(master);
      hum.start();
      this.hum = hum;
      this.humGain = humGain;
    }

    setEnabled(enabled, state) {
      this.enabled = enabled;
      if (enabled) {
        this.unlock();
        this.latestStatus = state.status;
        this.latestRisk = state.risk;
        this.master.gain.setTargetAtTime(0.8, this.context.currentTime, 0.25);
        this.startAlarmLoop();
      } else if (this.context) {
        this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.15);
        this.stopAlarmLoop();
      }
    }

    click(kind) {
      if (!this.enabled || !this.context) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = kind === "good" ? 520 : 190;
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + 0.08);
    }

    beep(frequency, delay, duration) {
      if (!this.context) return;
      const now = this.context.currentTime + delay;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    playAlarm(urgent) {
      if (!this.enabled) return;
      this.beep(urgent ? 760 : 610, 0, 0.14);
      this.beep(urgent ? 520 : 410, 0.19, urgent ? 0.24 : 0.13);
      if (urgent) this.beep(760, 0.48, 0.14);
    }

    startAlarmLoop() {
      this.stopAlarmLoop();
      const tick = () => {
        if (!this.enabled) return;
        const urgent = this.latestStatus === "failed" || this.latestRisk >= 70;
        if (this.latestStatus !== "ready") this.playAlarm(urgent);
        this.alarmTimer = window.setTimeout(tick, urgent ? 1250 : 4300);
      };
      this.alarmTimer = window.setTimeout(tick, 900);
    }

    stopAlarmLoop() {
      if (this.alarmTimer) window.clearTimeout(this.alarmTimer);
      this.alarmTimer = null;
    }

    update(state) {
      this.latestRisk = state.risk;
      this.latestStatus = state.status;
      if (!this.enabled || !this.context) return;
      const running = state.status === "running" ? 1 : 0;
      const pumping = (state.pumps["1"].flow + state.pumps["2"].flow) / 36;
      const rainTarget = 0.28 + running * 0.2;
      this.rainGain.gain.setTargetAtTime(rainTarget, this.context.currentTime, 0.8);
      this.humGain.gain.setTargetAtTime(clamp(pumping, 0, 1) * 0.025, this.context.currentTime, 0.4);
    }
  }

  class Renderer {
    constructor(canvasElement, context) {
      this.canvas = canvasElement;
      this.ctx = context;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.rainSeed = [];
      for (let index = 0; index < 68; index += 1) {
        this.rainSeed.push({
          x: ((index * 97 + 31) % 1000) / 1000,
          y: ((index * 61 + 13) % 1000) / 1000,
          speed: 0.55 + ((index * 7) % 9) / 10,
          length: 12 + (index % 6) * 4,
          alpha: 0.08 + (index % 5) * 0.025
        });
      }
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.width = Math.max(1, Math.round(rect.width));
      this.height = Math.max(1, Math.round(rect.height));
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.scale = Math.min(this.width / MAP.width, this.height / MAP.height);
      this.offsetX = (this.width - MAP.width * this.scale) / 2;
      this.offsetY = (this.height - MAP.height * this.scale) / 2;
    }

    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.offsetX) / this.scale,
        y: (clientY - rect.top - this.offsetY) / this.scale
      };
    }

    draw(sim, snapshot, elapsed) {
      const context = this.ctx;
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      this.drawBackdrop(elapsed, snapshot);
      context.save();
      context.translate(this.offsetX, this.offsetY);
      context.scale(this.scale, this.scale);
      this.drawFloor(snapshot, elapsed);
      this.drawWater(snapshot, elapsed);
      this.drawTransitLines(snapshot);
      this.drawBarriers(snapshot, elapsed);
      this.drawGates(snapshot, elapsed);
      this.drawPumps(snapshot, elapsed);
      this.drawTransformer(snapshot, elapsed);
      this.drawPassengers(sim, snapshot, elapsed);
      this.drawRiskHalo(snapshot, elapsed);
      this.drawLabels(snapshot, elapsed);
      context.restore();
      this.drawVignette();
    }

    drawBackdrop(elapsed, snapshot) {
      const context = this.ctx;
      const gradient = context.createLinearGradient(0, 0, 0, this.height);
      gradient.addColorStop(0, "#08161b");
      gradient.addColorStop(0.55, "#061015");
      gradient.addColorStop(1, "#040b0f");
      context.fillStyle = gradient;
      context.fillRect(0, 0, this.width, this.height);

      context.save();
      for (const drop of this.rainSeed) {
        const travel = (elapsed * drop.speed * 0.12 + drop.y) % 1;
        const x = drop.x * this.width;
        const y = travel * this.height;
        context.strokeStyle = "rgba(113, 175, 181, " + drop.alpha + ")";
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x - drop.length * 0.23, y + drop.length);
        context.stroke();
      }
      context.restore();
    }

    drawFloor(snapshot, elapsed) {
      const context = this.ctx;
      context.save();
      const floor = context.createLinearGradient(0, 80, 0, 700);
      floor.addColorStop(0, "#10272a");
      floor.addColorStop(0.45, "#0e2226");
      floor.addColorStop(1, "#0b1a1f");
      context.fillStyle = floor;
      this.roundRect(62, 92, 1078, 610, 4);
      context.fill();
      context.strokeStyle = "rgba(139, 184, 179, 0.22)";
      context.lineWidth = 1.5;
      context.stroke();

      context.fillStyle = "rgba(91, 154, 143, 0.032)";
      this.roundRect(68, 410, 916, 286, 2);
      context.fill();

      context.strokeStyle = "rgba(152, 205, 191, 0.055)";
      context.lineWidth = 0.7;
      for (let x = 90; x < 1130; x += 43) {
        context.beginPath();
        context.moveTo(x, 96);
        context.lineTo(x, 696);
        context.stroke();
      }
      for (let y = 128; y < 700; y += 43) {
        context.beginPath();
        context.moveTo(66, y);
        context.lineTo(1136, y);
        context.stroke();
      }

      context.strokeStyle = "rgba(185,221,114,.13)";
      context.lineWidth = 2;
      context.setLineDash([5, 8]);
      context.beginPath();
      context.moveTo(345, 680);
      context.lineTo(345, 590);
      context.lineTo(620, 555);
      context.lineTo(835, 590);
      context.lineTo(855, 680);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = "rgba(137, 238, 210, 0.22)";
      context.font = "8px " + getComputedStyle(document.body).fontFamily;
      context.textAlign = "left";
      context.fillText("PAID AREA / 付费区", 92, 438);
      context.fillText("UNPAID AREA / 非付费区", 92, 138);

      context.strokeStyle = "rgba(241,181,95,.25)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(296, 96);
      context.lineTo(296, 124);
      context.moveTo(394, 96);
      context.lineTo(394, 124);
      context.moveTo(830, 96);
      context.lineTo(830, 124);
      context.moveTo(920, 96);
      context.lineTo(920, 124);
      context.stroke();

      const lampPulse = 0.45 + Math.sin(elapsed * 2.1) * 0.08;
      for (const lamp of [[215, 151], [640, 151], [1040, 151], [215, 550], [640, 610], [955, 610]]) {
        const glow = context.createRadialGradient(lamp[0], lamp[1], 0, lamp[0], lamp[1], 48);
        glow.addColorStop(0, "rgba(159, 230, 194, " + lampPulse * 0.16 + ")");
        glow.addColorStop(1, "rgba(159, 230, 194, 0)");
        context.fillStyle = glow;
        context.fillRect(lamp[0] - 48, lamp[1] - 48, 96, 96);
        context.fillStyle = "rgba(203, 239, 212, .5)";
        context.fillRect(lamp[0] - 6, lamp[1] - 1, 12, 2);
      }
      context.restore();
    }

    roundRect(x, y, width, height, radius) {
      const context = this.ctx;
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
    }

    drawWater(snapshot, elapsed) {
      const context = this.ctx;
      const depth = snapshot.depths;
      context.save();
      this.drawPool(70, 394, 1068, depth.north, "north", elapsed);
      this.drawPool(70, 692, 916, depth.paid, "paid", elapsed);
      if (depth.transformer > 0.00001) {
        this.drawPool(996, 690, 138, depth.transformer, "transformer", elapsed);
      }

      const barrierA = snapshot.controls.barriers.a;
      const barrierB = snapshot.controls.barriers.b;
      context.lineCap = "round";
      for (const item of [
        { input: barrierA, x: 326, width: 38, alpha: barrierA === "closed" ? 0.06 : 0.35 },
        { input: barrierB, x: 848, width: 54, alpha: barrierB === "closed" ? 0.06 : 0.3 }
      ]) {
        if (item.input === "closed") continue;
        context.strokeStyle = "rgba(89, 206, 200, " + item.alpha + ")";
        context.lineWidth = 1.1;
        for (let index = 0; index < 4; index += 1) {
          const x = item.x + index * (item.width / 4);
          const wiggle = Math.sin(elapsed * 2.3 + index) * 3;
          context.beginPath();
          context.moveTo(x, 132);
          context.lineTo(x + wiggle, 205 + index * 6);
          context.lineTo(x + wiggle * 0.4, 292);
          context.stroke();
        }
      }
      context.restore();
    }

    drawPool(x, bottom, width, depthMeters, type, elapsed) {
      const centimeters = depthMeters * 100;
      if (centimeters <= 0.08) return;
      const context = this.ctx;
      const height = Math.min(type === "transformer" ? 34 : 74, 2 + centimeters * 3.2);
      const top = bottom - height;
      context.save();
      context.beginPath();
      context.moveTo(x, top + 2);
      for (let px = x; px <= x + width; px += 22) {
        const wave = Math.sin(px * 0.055 + elapsed * 2.2) * 2.2;
        context.lineTo(px, top + wave);
      }
      context.lineTo(x + width, bottom);
      context.lineTo(x, bottom);
      context.closePath();
      const water = context.createLinearGradient(0, top, 0, bottom);
      water.addColorStop(0, type === "transformer" ? "rgba(238,113,95,.11)" : "rgba(60,190,188,.12)");
      water.addColorStop(0.55, type === "transformer" ? "rgba(238,113,95,.22)" : "rgba(56,177,184,.22)");
      water.addColorStop(1, type === "transformer" ? "rgba(238,113,95,.3)" : "rgba(31,126,139,.31)");
      context.fillStyle = water;
      context.fill();
      context.strokeStyle = type === "transformer" ? "rgba(238,113,95,.45)" : "rgba(111,225,217,.32)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, top + 2);
      for (let px = x; px <= x + width; px += 22) {
        context.lineTo(px, top + Math.sin(px * 0.055 + elapsed * 2.2) * 2.2);
      }
      context.stroke();
      context.restore();
    }

    drawTransitLines(snapshot) {
      const context = this.ctx;
      context.save();
      context.strokeStyle = "rgba(185,221,114,.13)";
      context.lineWidth = 1;
      context.setLineDash([3, 7]);
      context.beginPath();
      context.moveTo(345, 306);
      context.lineTo(345, 176);
      context.moveTo(855, 306);
      context.lineTo(875, 176);
      context.moveTo(178, 500);
      context.lineTo(78, 403);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "rgba(185,221,114,.3)";
      for (const point of [[345, 242], [865, 242], [124, 454]]) {
        context.beginPath();
        context.arc(point[0], point[1], 1.5, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    drawBarriers(snapshot, elapsed) {
      const context = this.ctx;
      const states = snapshot.controls.barriers;
      this.drawBarrier(300, 134, 92, states.a, "A", elapsed);
      this.drawBarrier(830, 134, 92, states.b, "B", elapsed);
    }

    drawBarrier(x, y, width, state, code, elapsed) {
      const context = this.ctx;
      context.save();
      context.strokeStyle = "rgba(159,190,185,.3)";
      context.lineWidth = 1;
      context.strokeRect(x, y, width, 48);
      context.fillStyle = "rgba(5,14,17,.66)";
      context.fillRect(x + 3, y + 3, width - 6, 42);

      const levels = { open: 8, half: 25, closed: 44 };
      const panelHeight = levels[state];
      const panelTop = y + 46 - panelHeight;
      const color = state === "closed" ? "rgba(241,181,95,.82)" : state === "half" ? "rgba(214,166,96,.68)" : "rgba(109,154,146,.7)";
      context.fillStyle = color;
      context.fillRect(x + 5, panelTop, width - 10, panelHeight);
      context.fillStyle = "rgba(8,16,18,.48)";
      for (let slat = 5; slat < panelHeight; slat += 7) {
        context.fillRect(x + 5, panelTop + slat, width - 10, 1.6);
      }
      context.strokeStyle = "rgba(245,224,176,.45)";
      context.strokeRect(x + 5, panelTop, width - 10, panelHeight);

      const pulse = state === "closed" ? 0.42 + Math.sin(elapsed * 3.2) * 0.22 : 0.5;
      context.fillStyle = "rgba(241,181,95," + pulse + ")";
      context.fillRect(x + 6, y - 6, width - 12, 2);
      context.fillStyle = "rgba(218,237,224,.64)";
      context.font = "600 9px " + getComputedStyle(document.body).fontFamily;
      context.textAlign = "center";
      context.fillText("ENTRANCE " + code, x + width / 2, y - 11);
      context.restore();
    }

    drawGates(snapshot, elapsed) {
      const context = this.ctx;
      const direction1 = snapshot.controls.gates["1"];
      const direction2 = snapshot.controls.gates["2"];
      this.drawGateBank(258, 588, direction1, "G1", elapsed);
      this.drawGateBank(682, 1005, direction2, "G2", elapsed);
    }

    drawGateBank(startX, endX, direction, label, elapsed) {
      const context = this.ctx;
      context.save();
      context.fillStyle = "rgba(6,16,19,.7)";
      context.fillRect(startX, 397, endX - startX, 18);
      context.strokeStyle = "rgba(160,195,188,.28)";
      context.lineWidth = 1;
      context.strokeRect(startX, 397, endX - startX, 18);
      const exit = direction === "exit";
      const color = exit ? "rgba(185,221,114,.7)" : "rgba(241,181,95,.72)";
      const laneCount = 7;
      const step = (endX - startX - 20) / laneCount;
      const pulse = 0.65 + Math.sin(elapsed * 3) * 0.15;
      for (let lane = 0; lane < laneCount; lane += 1) {
        const x = startX + 12 + lane * step;
        context.fillStyle = "rgba(144,176,170,.4)";
        context.fillRect(x, 392, 3, 26);
        context.fillStyle = color;
        const arrowY = exit ? 387 : 426;
        context.beginPath();
        context.moveTo(x + 1.5, arrowY);
        context.lineTo(x + (exit ? -5 : 5), arrowY + (exit ? 8 : -8));
        context.lineTo(x + (exit ? 8 : -8), arrowY + (exit ? 8 : -8));
        context.closePath();
        context.globalAlpha = pulse;
        context.fill();
        context.globalAlpha = 1;
      }
      context.fillStyle = "rgba(215,236,221,.65)";
      context.font = "600 8px " + getComputedStyle(document.body).fontFamily;
      context.textAlign = "center";
      context.fillText(label + " · " + (exit ? "出站" : "进站") + " · " + (exit ? "4.5" : "0.8") + " 人/s", (startX + endX) / 2, 434);
      context.fillStyle = color;
      context.fillRect(startX, 398, endX - startX, 1.4);
      context.restore();
    }

    drawPumps(snapshot, elapsed) {
      this.drawPump(190, 333, "1", snapshot.pumps["1"], elapsed);
      this.drawPump(955, 542, "2", snapshot.pumps["2"], elapsed);
    }

    drawPump(x, y, id, pump, elapsed) {
      const context = this.ctx;
      context.save();
      const heat = clamp(pump.heat, 0, 100);
      const active = pump.flow > 0.1 && !pump.tripped;
      const color = pump.tripped ? "#ee715f" : heat > 76 ? "#f1b55f" : "#65cfc3";
      const glow = context.createRadialGradient(x, y, 2, x, y, 21);
      glow.addColorStop(0, "rgba(83,191,181,.12)");
      glow.addColorStop(1, "rgba(83,191,181,0)");
      context.fillStyle = glow;
      context.fillRect(x - 22, y - 22, 44, 44);
      context.strokeStyle = "rgba(152,196,187,.32)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, y, 12, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + (heat / 100) * Math.PI * 2);
      context.stroke();
      context.translate(x, y);
      context.rotate(active ? elapsed * 4.5 : 0);
      context.strokeStyle = active ? "rgba(118,225,211,.85)" : "rgba(118,140,137,.38)";
      context.lineWidth = 1.4;
      for (let blade = 0; blade < 3; blade += 1) {
        context.rotate((Math.PI * 2) / 3);
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(5.5, -3);
        context.lineTo(7, 2);
        context.closePath();
        context.stroke();
      }
      context.rotate(-(active ? elapsed * 4.5 : 0));
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const screenX = this.offsetX + x * this.scale;
      const screenY = this.offsetY + y * this.scale;
      context.fillStyle = "rgba(206,230,218,.6)";
      context.font = "8px " + getComputedStyle(document.body).fontFamily;
      context.textAlign = "center";
      context.fillText("P" + id + (pump.tripped ? " / TRIP" : ""), screenX, screenY + 26 * this.scale);
      context.restore();
    }

    drawTransformer(snapshot, elapsed) {
      const context = this.ctx;
      const x = 988;
      const y = 502;
      const width = 150;
      const height = 192;
      const wet = snapshot.depths.transformer > 0.00001;
      const pulse = wet ? 0.75 + Math.sin(elapsed * 5) * 0.2 : 0.35 + Math.sin(elapsed * 1.5) * 0.06;
      context.save();
      context.fillStyle = "rgba(24,22,21,.9)";
      context.fillRect(x, y, width, height);
      context.strokeStyle = wet ? "rgba(238,113,95," + pulse + ")" : "rgba(241,181,95,.36)";
      context.lineWidth = 1.5;
      context.strokeRect(x, y, width, height);
      context.strokeStyle = "rgba(238,113,95,.18)";
      context.lineWidth = 2;
      for (let stripe = -height; stripe < width + height; stripe += 18) {
        context.beginPath();
        context.moveTo(x + stripe, y + height);
        context.lineTo(x + stripe + height, y);
        context.stroke();
      }
      context.fillStyle = "rgba(6,13,15,.84)";
      context.fillRect(x + 8, y + 12, width - 16, 31);
      context.fillStyle = "rgba(238,183,115,.7)";
      context.font = "700 8px " + getComputedStyle(document.body).fontFamily;
      context.textAlign = "left";
      context.fillText("TRANSFORMER", x + 15, y + 25);
      context.fillStyle = "rgba(210,221,210,.5)";
      context.font = "7px " + getComputedStyle(document.body).fontFamily;
      context.fillText("高压设备间 / 禁止积水", x + 15, y + 36);
      const doorX = x + 4;
      const doorY = y + 66;
      context.strokeStyle = snapshot.controls.transformerDoor === "sealed" ? "rgba(101,207,195,.7)" : "rgba(238,113,95,.65)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(doorX, doorY);
      context.lineTo(doorX, doorY + 76);
      context.stroke();
      context.fillStyle = "rgba(7,14,16,.75)";
      context.fillRect(x + 20, y + height - 39, width - 34, 18);
      context.strokeStyle = wet ? "rgba(238,113,95,.6)" : "rgba(101,207,195,.38)";
      context.lineWidth = 1;
      context.strokeRect(x + 20, y + height - 39, width - 34, 18);
      context.fillStyle = wet ? "rgba(238,113,95,.9)" : "rgba(101,207,195,.8)";
      context.font = "700 7px " + getComputedStyle(document.body).fontFamily;
      context.textAlign = "center";
      context.fillText(wet ? "渗水警报" : "防水门密封", x + width / 2, y + height - 27);
      context.restore();
    }

    drawPassengers(sim, snapshot, elapsed) {
      const context = this.ctx;
      if (snapshot.status === "ready") {
        this.drawAmbientCrowd(elapsed);
        return;
      }
      const groups = {
        A: { color: "rgba(202,226,130,.86)", passengers: [] },
        B: { color: "rgba(119,215,202,.86)", passengers: [] },
        W: { color: "rgba(224,179,107,.9)", passengers: [] }
      };
      for (const passenger of snapshot.active) {
        const group = groups[passenger.target] || groups.W;
        group.passengers.push(passenger);
      }
      for (const key of ["A", "B", "W"]) {
        const group = groups[key];
        if (!group.passengers.length) continue;
        context.fillStyle = group.color;
        context.beginPath();
        for (const passenger of group.passengers) {
          const spread = passenger.state === "queued" ? 0.55 : 2.4;
          const drawX = passenger.x + (((passenger.id * 17) % 9) - 4) * spread * 0.42;
          const drawY = passenger.y + (((passenger.id * 29) % 11) - 5) * spread * 0.33;
          const radius = passenger.state === "queued" ? 1.55 : 2;
          context.moveTo(drawX + radius, drawY);
          context.arc(drawX, drawY, radius, 0, Math.PI * 2);
        }
        context.fill();
        context.strokeStyle = group.color;
        context.globalAlpha = 0.26;
        context.lineWidth = 0.8;
        context.beginPath();
        for (const passenger of group.passengers) {
          if (passenger.state !== "moving") continue;
          const next = passenger.route && passenger.route[passenger.routeIndex + 1];
          if (!next) continue;
          const node = NODES[next];
          const dx = node.x - passenger.x;
          const dy = node.y - passenger.y;
          const length = Math.hypot(dx, dy) || 1;
          const drawX = passenger.x + (((passenger.id * 17) % 9) - 4) * 1;
          const drawY = passenger.y + (((passenger.id * 29) % 11) - 5) * 0.8;
          context.moveTo(drawX, drawY);
          context.lineTo(drawX - (dx / length) * 4.5, drawY - (dy / length) * 4.5);
        }
        context.stroke();
        context.globalAlpha = 1;
      }
    }

    drawAmbientCrowd(elapsed) {
      const context = this.ctx;
      context.save();
      context.fillStyle = "rgba(193,220,149,.4)";
      context.beginPath();
      for (let index = 0; index < 94; index += 1) {
        const paid = index < 65;
        const x = 130 + ((index * 83 + 47) % (paid ? 800 : 900));
        const y = paid ? 470 + ((index * 47) % 180) : 200 + ((index * 31) % 150);
        const bob = Math.sin(elapsed * 1.2 + index) * 0.8;
        context.moveTo(x + 1.5, y + bob);
        context.arc(x, y + bob, 1.5, 0, Math.PI * 2);
      }
      context.fill();
      context.restore();
    }

    drawRiskHalo(snapshot, elapsed) {
      const context = this.ctx;
      let edge = null;
      let size = 0;
      for (const candidate of EDGES) {
        if (!candidate.critical) continue;
        const queue = snapshot.queues[candidate.id] || 0;
        if (queue > size) {
          size = queue;
          edge = candidate;
        }
      }
      if (!edge || size < 36) return;
      const node = NODES[edge.from];
      const radius = Math.min(74, 12 + Math.sqrt(size) * 4.6);
      const glow = context.createRadialGradient(node.x, node.y, 3, node.x, node.y, radius);
      const alpha = snapshot.riskTier === "danger" ? 0.25 : 0.12;
      glow.addColorStop(0, "rgba(238,113,95," + alpha + ")");
      glow.addColorStop(0.7, "rgba(241,181,95," + alpha * 0.55 + ")");
      glow.addColorStop(1, "rgba(241,181,95,0)");
      context.fillStyle = glow;
      context.fillRect(node.x - radius, node.y - radius, radius * 2, radius * 2);
      context.strokeStyle = snapshot.riskTier === "danger"
        ? "rgba(238,113,95,.72)"
        : "rgba(241,181,95,.45)";
      context.lineWidth = 1.2;
      context.setLineDash([3, 5]);
      context.beginPath();
      context.arc(node.x, node.y, radius * (0.7 + Math.sin(elapsed * 3) * 0.04), 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }

    drawLabels(snapshot, elapsed) {
      const context = this.ctx;
      const font = getComputedStyle(document.body).fontFamily;
      context.save();
      context.textAlign = "center";
      context.font = "600 9px " + font;
      context.fillStyle = "rgba(205,230,216,.7)";
      context.fillText("A · 北侧主入口", 346, 64);
      context.fillText("B · 东侧备用入口", 876, 64);
      context.fillStyle = "rgba(185,221,114,.75)";
      context.beginPath();
      context.moveTo(346, 77);
      context.lineTo(341, 86);
      context.lineTo(351, 86);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(876, 77);
      context.lineTo(871, 86);
      context.lineTo(881, 86);
      context.closePath();
      context.fill();

      context.textAlign = "right";
      context.fillStyle = "rgba(224,179,107,.78)";
      context.font = "600 8px " + font;
      context.fillText("W · 西侧窄出口", 122, 395);
      context.beginPath();
      context.moveTo(106, 405);
      context.lineTo(116, 400);
      context.lineTo(116, 410);
      context.closePath();
      context.fill();

      context.textAlign = "center";
      context.fillStyle = "rgba(151,183,176,.55)";
      context.font = "7px " + font;
      context.fillText("STAIR 01 · 5.2 人/s", 345, 706);
      context.fillText("STAIR 02 · 5.2 人/s", 855, 706);
      context.strokeStyle = "rgba(151,183,176,.22)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(300, 694);
      context.lineTo(390, 694);
      context.moveTo(810, 694);
      context.lineTo(900, 694);
      context.stroke();

      if (snapshot.status === "ready") {
        const pulse = 0.45 + Math.sin(elapsed * 2.2) * 0.12;
        context.fillStyle = "rgba(185,221,114," + pulse + ")";
        context.font = "600 11px " + font;
        context.fillText("READY / 等待疏散指令", 600, 478);
      }
      context.restore();
    }

    drawVignette() {
      const context = this.ctx;
      context.save();
      const vignette = context.createRadialGradient(
        this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.3,
        this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.72
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(2,7,9,.5)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, this.width, this.height);
      context.restore();
    }
  }

  class Game {
    constructor() {
      cacheDom();
      this.renderer = new Renderer(canvas, ctx);
      this.audio = new AudioEngine();
      this.audioTouched = false;
      this.sim = new simApi.Simulation();
      this.speed = 1;
      this.lastSpeed = 1;
      this.accumulator = 0;
      this.lastFrame = performance.now();
      this.animationTime = 0;
      this.lastUiUpdate = 0;
      this.lastLogSerial = -1;
      this.resultStatus = "";
      this.toastTimer = null;
      this.snapshot = this.sim.getSnapshot();
      this.bindEvents();
      this.renderer.resize();
      this.syncControls();
      this.updateUI(this.snapshot, true);
      this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
      this.resizeObserver.observe(DOM.canvasWrap);
      window.addEventListener("resize", () => this.renderer.resize());
      requestAnimationFrame((timestamp) => this.loop(timestamp));
    }

    bindEvents() {
      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const action = button.dataset.action;
        const id = button.dataset.id;
        const value = button.dataset.value;
        let changed = false;
        if (action === "barrier") changed = this.sim.setBarrier(id, value);
        if (action === "transformer") changed = this.sim.setTransformerDoor(value);
        if (action === "pump") changed = this.sim.setPump(id, value);
        if (action === "gate") changed = this.sim.setGate(id, value);
        if (!changed) {
          if (["success", "failed"].includes(this.sim.status)) this.showToast("演练已结束，请重新开始。");
          return;
        }
        this.syncControls();
        this.audio.click(value === "exit" || value === "sealed" ? "good" : "normal");
        const messages = {
          barrier: "入口 " + String(id).toUpperCase() + " 挡水板：" + simApi.BARRIER_LABEL[value],
          transformer: value === "sealed" ? "变电室防水门已密封" : "变电室防水门已开启",
          pump: "P" + id + " 排水泵：" + simApi.PUMP_LABEL[value],
          gate: (id === "1" ? "西" : "东") + "闸机组：" + simApi.GATE_LABEL[value] + "方向"
        };
        this.showToast(messages[action]);
        this.updateUI(this.sim.getSnapshot(), true);
      });

      DOM.startButton.addEventListener("click", () => this.toggleSimulation());
      DOM.presetButton.addEventListener("click", () => this.loadPreset());
      DOM.restartButton.addEventListener("click", () => this.resetSimulation());
      DOM.audioToggle.addEventListener("click", () => {
        this.audioTouched = true;
        const enable = !this.audio.enabled;
        this.audio.setEnabled(enable, this.sim.getSnapshot());
        DOM.audioToggle.classList.toggle("on", enable);
        DOM.audioGlyph.textContent = enable ? "◉" : "◖";
        if (enable) this.showToast("雨声与环境警报已开启");
      });

      document.querySelectorAll("[data-speed]").forEach((button) => {
        button.addEventListener("click", () => this.setSpeed(Number(button.dataset.speed)));
      });

      window.addEventListener("keydown", (event) => {
        if (event.target.matches("button, input, textarea")) return;
        if (event.code === "Space") {
          event.preventDefault();
          this.toggleSimulation();
        }
        if (event.key === "1") this.setSpeed(1);
        if (event.key === "2") this.setSpeed(2);
        if (event.key === "4") this.setSpeed(4);
        if (event.key === "0") this.setSpeed(0);
      });

      canvas.addEventListener("click", (event) => {
        const point = this.renderer.toWorld(event.clientX, event.clientY);
        const hit = this.hitTest(point.x, point.y);
        if (!hit) return;
        if (hit.type === "barrier") {
          const order = ["open", "half", "closed"];
          const next = order[(order.indexOf(this.sim.controls.barriers[hit.id]) + 1) % order.length];
          this.sim.setBarrier(hit.id, next);
          this.showToast("入口 " + hit.id.toUpperCase() + " 挡水板：" + simApi.BARRIER_LABEL[next]);
        }
        if (hit.type === "pump") {
          const order = ["off", "low", "high"];
          const next = order[(order.indexOf(this.sim.controls.pumps[hit.id].setting) + 1) % order.length];
          this.sim.setPump(hit.id, next);
          this.showToast("P" + hit.id + " 排水泵：" + simApi.PUMP_LABEL[next]);
        }
        if (hit.type === "gate") {
          const next = this.sim.controls.gates[hit.id] === "entry" ? "exit" : "entry";
          this.sim.setGate(hit.id, next);
          this.showToast((hit.id === "1" ? "西" : "东") + "闸机组：" + simApi.GATE_LABEL[next] + "方向");
        }
        this.audio.click("normal");
        this.syncControls();
        this.updateUI(this.sim.getSnapshot(), true);
      });
    }

    hitTest(x, y) {
      if (x >= 292 && x <= 400 && y >= 126 && y <= 194) return { type: "barrier", id: "a" };
      if (x >= 822 && x <= 930 && y >= 126 && y <= 194) return { type: "barrier", id: "b" };
      if (Math.hypot(x - 190, y - 333) < 25) return { type: "pump", id: "1" };
      if (Math.hypot(x - 955, y - 542) < 25) return { type: "pump", id: "2" };
      if (x >= 258 && x <= 588 && y >= 388 && y <= 436) return { type: "gate", id: "1" };
      if (x >= 682 && x <= 1005 && y >= 388 && y <= 436) return { type: "gate", id: "2" };
      return null;
    }

    toggleSimulation() {
      if (this.sim.status === "success" || this.sim.status === "failed") return;
      if (this.sim.status === "ready") {
        if (!this.audioTouched) {
          this.audio.setEnabled(true, this.sim.getSnapshot());
          DOM.audioToggle.classList.add("on");
          DOM.audioGlyph.textContent = "◉";
        }
        this.sim.start();
        this.setSpeed(this.lastSpeed || 1, true);
        this.showToast("应急疏散计时开始");
        this.audio.click("good");
      } else if (this.speed === 0) {
        this.setSpeed(this.lastSpeed || 1);
      } else {
        this.setSpeed(0);
      }
      this.updateUI(this.sim.getSnapshot(), true);
    }

    setSpeed(speed, silent) {
      if (this.sim.status === "ready" && speed > 0) {
        this.lastSpeed = speed;
        this.speed = speed;
        this.syncSpeedButtons();
        if (!silent) this.showToast("模拟速度 " + speed + "×，开始后生效");
        return;
      }
      this.speed = speed;
      if (speed > 0) this.lastSpeed = speed;
      this.syncSpeedButtons();
      if (this.sim.status === "running") {
        this.sim.addLog(speed === 0 ? "演练暂停，设备状态已冻结。" : "演练继续，模拟速度 " + speed + "×。", "info");
      }
      this.updateUI(this.sim.getSnapshot(), true);
      if (!silent) this.audio.click("normal");
    }

    syncSpeedButtons() {
      document.querySelectorAll("[data-speed]").forEach((button) => {
        button.classList.toggle("selected", Number(button.dataset.speed) === this.speed);
      });
    }

    loadPreset() {
      if (this.sim.status === "success" || this.sim.status === "failed") {
        this.showToast("请先重新演练，再载入方案。");
        return;
      }
      this.sim.setBarrier("a", "closed");
      this.sim.setBarrier("b", "open");
      this.sim.setTransformerDoor("sealed");
      this.sim.setGate("1", "exit");
      this.sim.setGate("2", "exit");
      this.sim.setPump("1", "high");
      this.sim.setPump("2", "low");
      this.syncControls();
      this.showToast("参考方案：A 全封、B 开启、双闸出站、P1 高档");
      this.audio.click("good");
      this.updateUI(this.sim.getSnapshot(), true);
    }

    resetSimulation() {
      this.sim = new simApi.Simulation();
      this.speed = 1;
      this.lastSpeed = 1;
      this.accumulator = 0;
      this.lastLogSerial = -1;
      this.resultStatus = "";
      DOM.resultBanner.classList.remove("show", "failed");
      DOM.resultBanner.classList.remove("warning");
      this.syncControls();
      this.syncSpeedButtons();
      this.updateUI(this.sim.getSnapshot(), true);
    }

    syncControls() {
      document.querySelectorAll("[data-action]").forEach((button) => {
        const action = button.dataset.action;
        const id = button.dataset.id;
        const value = button.dataset.value;
        let selected = false;
        if (action === "barrier") selected = this.sim.controls.barriers[id] === value;
        if (action === "transformer") selected = this.sim.controls.transformerDoor === value;
        if (action === "pump") selected = this.sim.controls.pumps[id].setting === value;
        if (action === "gate") selected = this.sim.controls.gates[id] === value;
        button.classList.toggle("selected", selected);
      });
    }

    updateUI(snapshot, force) {
      setText("missionClock", snapshot.clock);
      const statusCopy = {
        ready: "待命",
        running: this.speed === 0 ? "已暂停" : "应急疏散中",
        success: "疏散成功",
        failed: "任务失败"
      };
      setText(
        "missionStatus",
        snapshot.status === "success" && snapshot.peakRisk >= 70
          ? "带风险完成"
          : statusCopy[snapshot.status] || snapshot.status
      );
      DOM.missionClock.style.color = snapshot.remainingTime <= 180 && snapshot.status === "running" ? "#f1b55f" : "";
      const liveDot = document.querySelector(".live-dot");
      liveDot.classList.toggle("active", snapshot.status === "running" && this.speed > 0);
      if (snapshot.status === "failed") liveDot.style.background = "var(--red)";
      else liveDot.style.background = "";

      const barrierA = simApi.BARRIER_LABEL[snapshot.controls.barriers.a];
      const barrierB = simApi.BARRIER_LABEL[snapshot.controls.barriers.b];
      setText("barrierAState", barrierA);
      setText("barrierBState", barrierB);
      DOM.barrierAState.classList.toggle("good", snapshot.controls.barriers.a === "open");
      DOM.barrierBState.classList.toggle("good", snapshot.controls.barriers.b === "open");
      const doorSealed = snapshot.controls.transformerDoor === "sealed";
      setText("transformerDoorState", doorSealed ? "密封" : "开启");
      DOM.transformerDoorState.classList.toggle("good", doorSealed);

      for (const id of ["1", "2"]) {
        const pump = snapshot.pumps[id];
        const rateText = pump.tripped ? "过热停机" : formatNumber(pump.flow, 1) + " L/s";
        setText("pump" + id + "Rate", rateText);
        setText("pump" + id + "Heat", Math.round(pump.heat) + "°C");
        const bar = DOM["pump" + id + "HeatBar"];
        bar.style.width = clamp(pump.heat, 0, 100) + "%";
        bar.style.background = pump.tripped ? "#ee715f" : pump.heat > 76 ? "#f1b55f" : "#65cfc3";
      }

      setText("rainLoad", Math.round(snapshot.rainScale * 100) + "%");
      setText("insideCount", snapshot.inside + " 人滞留");
      setText("evacuatedCount", String(snapshot.evacuated));
      setText("evacuatedTotal", "/ " + snapshot.totalPassengers + " 人");
      DOM.waterLevel.innerHTML = formatNumber(snapshot.water.concourseCm, 1) + "<small> cm</small>";
      DOM.transformerLevel.innerHTML = formatNumber(snapshot.water.transformerCm, 2) + "<small> cm</small>";
      const transformerWet = snapshot.water.transformerLiters > 0.05;
      DOM.transformerTag.classList.toggle("danger", transformerWet);
      setText("transformerTag", transformerWet ? "进水" : "安全");
      const totalFlow = snapshot.pumps["1"].flow + snapshot.pumps["2"].flow;
      DOM.pumpTotal.innerHTML = formatNumber(totalFlow, 1) + "<small> L/s</small>";
      setText(
        "pumpStateLabel",
        snapshot.pumps["1"].tripped || snapshot.pumps["2"].tripped
          ? "过热保护"
          : totalFlow > 0.1 ? "排水作业中" : "待机"
      );

      const risk = Math.round(snapshot.risk);
      DOM.riskFill.style.width = risk + "%";
      DOM.riskFill.style.background = snapshot.riskTier === "danger"
        ? "#ee715f"
        : snapshot.riskTier === "warn" ? "#f1b55f" : "#b9dd72";
      DOM.riskBadge.className = snapshot.riskTier === "danger" ? "danger" : snapshot.riskTier === "warn" ? "warn" : "";
      setText("riskBadge", snapshot.riskTier === "danger" ? "危险" : snapshot.riskTier === "warn" ? "升高" : "低");
      setText("riskValue", String(risk).padStart(2, "0"));
      setText(
        "riskZone",
        snapshot.status !== "running" && snapshot.peakRisk >= 70
          ? "峰值 " + Math.round(snapshot.peakRisk) + " · 踩踏风险"
          : snapshot.riskZone
      );

      const startTitle = DOM.startButton.querySelector("b");
      const startSmall = DOM.startButton.querySelector("small");
      DOM.startButton.classList.toggle("running", snapshot.status === "running");
      if (snapshot.status === "ready") {
        startTitle.textContent = "开始应急疏散";
        startSmall.textContent = "按下计时，15:00 内完成撤离";
      } else if (snapshot.status === "running" && this.speed > 0) {
        startTitle.textContent = "暂停演练";
        startSmall.textContent = "计时中 · 可继续调整设备";
      } else if (snapshot.status === "running") {
        startTitle.textContent = "继续应急疏散";
        startSmall.textContent = "演练已暂停 · 状态冻结";
      } else {
        startTitle.textContent = snapshot.status === "success" ? "疏散任务完成" : "演练已终止";
        startSmall.textContent = "可重新开始或复盘记录";
      }

      setText("logCount", String(this.sim.logSerial).padStart(2, "0"));
      if (force || this.lastLogSerial !== this.sim.logSerial) {
        this.renderLogs(snapshot.logs);
        this.lastLogSerial = this.sim.logSerial;
      }
      if (snapshot.status === "success" || snapshot.status === "failed") {
        this.showResult(snapshot);
      }
      this.audio.update(snapshot);
    }

    renderLogs(logs) {
      DOM.eventLog.replaceChildren();
      for (const item of logs.slice(0, 9)) {
        const row = document.createElement("div");
        row.className = "log-item" + (item.level === "danger" ? " danger" : "");
        const time = document.createElement("span");
        time.textContent = item.clock;
        const copy = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = item.level === "danger" ? "警报 · " : item.level === "good" ? "完成 · " : "";
        copy.append(strong, document.createTextNode(item.message));
        row.append(time, copy);
        DOM.eventLog.appendChild(row);
      }
    }

    showResult(snapshot) {
      if (this.resultStatus === snapshot.status) return;
      this.resultStatus = snapshot.status;
      const success = snapshot.status === "success";
      const risky = success && snapshot.peakRisk >= 70;
      DOM.resultBanner.classList.add("show");
      DOM.resultBanner.classList.toggle("failed", !success);
      DOM.resultBanner.classList.toggle("warning", risky);
      DOM.resultMark.textContent = success && !risky ? "✓" : "!";
      setText(
        "resultEyebrow",
        risky ? "EVACUATION COMPLETE / SAFETY ALERT" : success ? "EVACUATION COMPLETE" : "MISSION ABORTED"
      );
      setText(
        "resultTitle",
        risky ? "疏散完成，但发生踩踏风险" : success ? "站厅已清空，变电室干燥" : "疏散未达标"
      );
      if (success) {
        setText(
          "resultCopy",
          "用时 " + simApi.formatTime(snapshot.time) + "，690 人全部离站；峰值踩踏风险 " +
          Math.round(snapshot.peakRisk) + "/100，泵组过热停机 " + snapshot.stats.pumpTrips + " 次。"
        );
      } else {
        setText(
          "resultCopy",
          snapshot.endReason + " 已撤离 " + snapshot.evacuated + " / " + snapshot.totalPassengers +
          " 人；峰值踩踏风险 " + Math.round(snapshot.peakRisk) + "/100。"
        );
      }
      this.speed = 0;
      this.syncSpeedButtons();
      this.audio.update(snapshot);
    }

    showToast(message) {
      DOM.toast.textContent = message;
      DOM.toast.classList.add("show");
      if (this.toastTimer) window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => DOM.toast.classList.remove("show"), 2200);
    }

    loop(timestamp) {
      const delta = Math.min(0.1, Math.max(0, (timestamp - this.lastFrame) / 1000));
      this.lastFrame = timestamp;
      this.animationTime += delta;
      if (this.sim.status === "running" && this.speed > 0) {
        this.accumulator += delta * this.speed;
        let iterations = 0;
        while (this.accumulator >= 0.05 && iterations < 160) {
          this.sim.update(0.05);
          this.accumulator -= 0.05;
          iterations += 1;
        }
        if (iterations >= 160) this.accumulator = 0;
      }
      this.snapshot = this.sim.getSnapshot();
      this.renderer.draw(this.sim, this.snapshot, this.animationTime);
      if (timestamp - this.lastUiUpdate > 95 || this.sim.status === "success" || this.sim.status === "failed") {
        this.updateUI(this.snapshot);
        this.lastUiUpdate = timestamp;
      }
      requestAnimationFrame((next) => this.loop(next));
    }
  }

  window.__metroGame = new Game();
})();






