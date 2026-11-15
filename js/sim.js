/* 海上风场 + 岸上电池微电网 12 小时仿真引擎（纯逻辑，无 DOM 依赖） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MicrogridSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    HORIZON_MIN: 720,
    TURBINES: 3,
    RATED_MW: 2,          // 单台风机额定功率
    CUT_IN: 3,            // 切入风速 m/s
    RATED_WIND: 12,       // 额定风速
    CUT_OUT: 22,          // 切出风速，超过且未顺桨则脱网
    FEATHER_PITCH: 45,    // 大风保命的最小桨距角
    TRIP_MINUTES: 5,
    HOSPITAL_MW: 2.0,
    LINE_MW: [1.3, 0.9, 0.7],   // 工厂三条可中断负荷
    BATT_CAP_MWH: 6,
    BATT_MAX_MW: 3.5,
    ETA: 0.95,            // 单变换效率
    SOC_MIN: 0.05,
    SOC_MAX: 0.98,
    T_AMBIENT: 25,
    T_DERATE: 55,         // 开始降功率
    T_CRIT: 65,           // 安全红线（成功条件之一）
    T_FAIL: 70,           // 触发热保护即失败
    THERMAL_R: 1.1,       // 发热系数 °C/min per MW
    THERMAL_K: 0.12,      // 散热系数 /min
    CYCLE_WEAR_PCT: 100 / 6000,  // 每等效循环寿命损耗
    SWITCH_WEAR_PCT: 0.005
  };

  // 阵风场景：时间-风速增量折线（事件之外增量为 0）
  const GUST_EVENTS = [
    { label: '阵风锋面 #1', points: [[55, 0], [58, 12], [66, 12], [70, -7], [95, -7], [100, 0]] },
    { label: '阵风锋面 #2', points: [[330, 0], [333, 10], [342, 10], [346, -6], [372, -6], [380, 0]] }
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function interp(points, t) {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [t0, v0] = points[i], [t1, v1] = points[i + 1];
      if (t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
    return points[points.length - 1][1];
  }

  class MicrogridSim {
    constructor(seed = 20261115) {
      this.rng = mulberry32(seed);
      this.reset();
      this.controls = { pitch: 0, batteryMode: 'auto', batteryMw: 2, shedCount: 0, shedOrder: [0, 1, 2] };
    }

    reset() {
      this.t = 0;
      this.soc = 0.55;
      this.temp = 30;
      this.maxTemp = 30;
      this.tripLeft = 0;
      this.tripMinutes = 0;
      this.blackoutMinutes = 0;
      this.switches = 0;
      this.wearPct = 0;
      this.throughputMWh = 0;
      this.windMWh = 0;
      this.servedMWh = 0;
      this.curtailedMWh = 0;
      this.lineShedMinutes = [0, 0, 0];
      this.lastDir = 0;
      this.status = 'ready';   // ready | running | failed | done
      this.failureReasons = [];
      this.events = [];
      this.history = [];
      this._noise = 0;
    }

    setControls(patch) { Object.assign(this.controls, patch); }

    logEvent(label, level) {
      this.events.push({ t: this.t, label, level: level || 'info' });
    }

    // 背景风：半日周期，基线约 10 m/s
    baseWind() {
      return 11.8 + 2.0 * Math.sin(this.t / 95) + 1.0 * Math.sin(this.t / 31 + 1.7);
    }

    gustDelta() {
      let d = 0;
      for (const ev of GUST_EVENTS) d += interp(ev.points, this.t);
      return d;
    }

    windSpeed() {
      // OU 式抖动，模拟阵风间的湍流
      this._noise += (0 - this._noise) * 0.15 + (this.rng() - 0.5) * 0.9;
      return Math.max(0, this.baseWind() + this.gustDelta() + this._noise);
    }

    // 单台风机出力：桨距越大出力越低；未顺桨且超过切出风速则脱网
    turbinePower(v, pitch) {
      if (this.tripLeft > 0) return 0;
      if (v >= C.CUT_OUT && pitch < C.FEATHER_PITCH) return 0;
      if (v < C.CUT_IN) return 0;
      let p;
      if (v < C.RATED_WIND) {
        p = C.RATED_MW * Math.pow((v - C.CUT_IN) / (C.RATED_WIND - C.CUT_IN), 2);
      } else {
        p = C.RATED_MW;
      }
      if (v >= C.CUT_OUT) p = C.RATED_MW * 0.08; // 顺桨待机功率
      return p * Math.max(0, 1 - pitch / 70);
    }

    thermalDerate() {
      if (this.temp <= C.T_DERATE) return 1;
      if (this.temp >= C.T_FAIL) return 0;
      return Math.max(0, (C.T_FAIL - this.temp) / (C.T_FAIL - C.T_DERATE));
    }

    batteryLimits() {
      const d = this.thermalDerate();
      const maxOut = Math.min(C.BATT_MAX_MW * d,
        this.soc > C.SOC_MIN ? (this.soc - C.SOC_MIN) * C.BATT_CAP_MWH * 60 * C.ETA : 0);
      const maxIn = Math.min(C.BATT_MAX_MW * d,
        this.soc < C.SOC_MAX ? (C.SOC_MAX - this.soc) * C.BATT_CAP_MWH * 60 / C.ETA : 0);
      return { maxOut, maxIn, derate: d };
    }

    step() {
      if (this.status === 'done' || this.status === 'failed') return null;
      this.status = 'running';
      const v = this.windSpeed();
      const pitch = this.controls.pitch;

      if (this.tripLeft > 0) this.tripLeft -= 1;
      if (v >= C.CUT_OUT && pitch < C.FEATHER_PITCH && this.tripLeft === 0) {
        this.tripLeft = C.TRIP_MINUTES;
        this.tripMinutes += C.TRIP_MINUTES;
        this.logEvent('风速 ' + v.toFixed(1) + ' m/s 超过切出值，风机未顺桨脱网 5 分钟', 'danger');
      }
      const oneMw = this.turbinePower(v, pitch);
      const windMw = oneMw * C.TURBINES;

      // 玩家预先切除的工厂线（按 shedOrder 顺序）
      const order = this.controls.shedOrder;
      let shedCount = Math.min(this.controls.shedCount || 0, C.LINE_MW.length);
      let demand = C.HOSPITAL_MW + C.LINE_MW[0] + C.LINE_MW[1] + C.LINE_MW[2];
      for (let k = 0; k < shedCount; k++) {
        demand -= C.LINE_MW[order[k]];
        this.lineShedMinutes[order[k]]++;
      }
      const limits = this.batteryLimits();

      let batt = 0;   // 正=放电，负=充电
      if (this.controls.batteryMode === 'hold') batt = 0;
      else if (this.controls.batteryMode === 'discharge') batt = Math.min(this.controls.batteryMw, limits.maxOut);
      else if (this.controls.batteryMode === 'charge') batt = -Math.min(this.controls.batteryMw, limits.maxIn);
      else { // auto
        const gap = demand - windMw;
        if (gap > 0) batt = Math.min(gap, limits.maxOut);
        else batt = -Math.min(-gap, limits.maxIn);
      }

      let supply = windMw + Math.max(0, batt);
      // 自动模式下供电不足：按顺序切工厂线，仍不足则医院断电
      if (supply + 0.001 < demand) {
        for (const idx of order) {
          if (supply + 0.001 >= demand) break;
          if (shedCount > 0 && order.indexOf(idx) < shedCount) continue;
          demand -= C.LINE_MW[idx];
          shedCount++;
          this.lineShedMinutes[idx]++;
        }
      }
      let blackoutMw = Math.max(0, demand - supply);
      const wasOut = this.history.length > 0 && this.history[this.history.length - 1].blackoutMw > 0.001;
      if (blackoutMw > 0.001 && !wasOut) {
        this.logEvent('供电缺口 ' + blackoutMw.toFixed(2) + ' MW，医院/在网负荷断电', 'danger');
      }
      if (blackoutMw > 0.001) this.blackoutMinutes++;
      const servedMw = Math.min(demand, supply);

      // 余电充电（auto 已含；手动模式下无法吸收的余电弃风）
      let charge = 0;
      if (batt < 0) charge = -batt;
      const surplus = Math.max(0, windMw - demand - charge);

      // 电池积分：放电减少 SOC，充电增加 SOC
      const beforeSoc = this.soc;
      if (batt > 0) this.soc -= (batt / C.ETA) / (C.BATT_CAP_MWH * 60);
      else if (batt < 0) this.soc += (-batt * C.ETA) / (C.BATT_CAP_MWH * 60);
      this.soc = Math.min(C.SOC_MAX, Math.max(0, this.soc));

      // 热模型：充放都发热，向环境散热
      const heat = Math.abs(batt) * C.THERMAL_R;
      this.temp += heat - C.THERMAL_K * (this.temp - C.T_AMBIENT);
      this.maxTemp = Math.max(this.maxTemp, this.temp);

      // 寿命：等效循环 + 充放方向频繁切换
      const throughput = Math.abs(this.soc - beforeSoc) * C.BATT_CAP_MWH / 2;
      this.throughputMWh += throughput;
      this.wearPct = (this.throughputMWh / C.BATT_CAP_MWH) * C.CYCLE_WEAR_PCT +
        this.switches * C.SWITCH_WEAR_PCT;
      const dir = batt > 0.02 ? 1 : batt < -0.02 ? -1 : 0;
      if (dir !== 0 && this.lastDir !== 0 && dir !== this.lastDir) this.switches++;
      if (dir !== 0) this.lastDir = dir;

      this.windMWh += windMw / 60;
      this.servedMWh += servedMw / 60;
      this.curtailedMWh += surplus / 60;

      if (this.temp >= C.T_FAIL) {
        this.status = 'failed';
        this.failureReasons.push('电池温度达到 ' + C.T_FAIL + '°C 热保护阈值');
      }

      const snap = {
        t: this.t, v, pitch, windMw, demand, servedMw, blackoutMw,
        batt, soc: this.soc, temp: this.temp, derate: limits.derate,
        shedCount, surplus, trip: this.tripLeft
      };
      this.history.push(snap);
      this.t += 1;
      if (this.t >= C.HORIZON_MIN) {
        const tempSafe = this.maxTemp <= C.T_CRIT;
        if (this.blackoutMinutes > 0) this.failureReasons.push('12 小时内出现断电（共 ' + this.blackoutMinutes + ' 分钟）');
        if (!tempSafe) this.failureReasons.push('电池最高温度 ' + this.maxTemp.toFixed(1) + '°C 超过安全线 ' + C.T_CRIT + '°C');
        this.status = (this.blackoutMinutes === 0 && tempSafe) ? 'done' : 'failed';
      }
      return snap;
    }

    success() {
      return this.status === 'done' && this.blackoutMinutes === 0 && this.maxTemp <= C.T_CRIT;
    }

    summary() {
      const servedRate = this.windMWh > 0 ? this.servedMWh / (this.windMWh + 1e-9) : 0;
      return {
        status: this.status,
        success: this.success(),
        elapsedMin: this.t,
        blackoutMinutes: this.blackoutMinutes,
        maxTempC: Number(this.maxTemp.toFixed(2)),
        finalSoc: Number(this.soc.toFixed(4)),
        windMWh: Number(this.windMWh.toFixed(3)),
        servedMWh: Number(this.servedMWh.toFixed(3)),
        curtailedMWh: Number(this.curtailedMWh.toFixed(3)),
        renewableServedRate: Number(Math.min(1, servedRate).toFixed(3)),
        tripMinutes: this.tripMinutes,
        lineShedMinutes: this.lineShedMinutes.slice(),
        switches: this.switches,
        wearPct: Number(this.wearPct.toFixed(4)),
        failureReasons: this.failureReasons.slice(),
        events: this.events.slice()
      };
    }

    toCsv() {
      const head = 'minute,windSpeed_mps,pitch_deg,windMW,demandMW,servedMW,blackoutMW,batteryMW,soc,tempC,derate,shedLines,curtailMW,tripLeft';
      const rows = this.history.map(h => [
        h.t, h.v.toFixed(2), h.pitch, h.windMw.toFixed(3), h.demand.toFixed(3),
        h.servedMw.toFixed(3), h.blackoutMw.toFixed(3), h.batt.toFixed(3),
        h.soc.toFixed(4), h.temp.toFixed(2), h.derate.toFixed(2), h.shedCount,
        h.surplus.toFixed(3), h.trip
      ].join(','));
      return [head].concat(rows).join('\n');
    }
  }

  return { MicrogridSim, C, GUST_EVENTS, mulberry32 };
});
