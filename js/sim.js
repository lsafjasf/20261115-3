/* 极地营地核心模拟：纯逻辑，无 DOM 依赖，可在 Node 中加载用于验证。 */
(function (root, factory) {
  const Sim = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  else root.CampSim = Sim;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TICK_MIN = 10;               // 每 tick 10 分钟
  const DT_H = TICK_MIN / 60;
  const TOTAL_TICKS = 2 * 24 * 6;    // 48 小时

  const HEATER_KW = 1.8;             // 每舱取暖器功率
  const BASE_LOAD_KW = 0.5;          // 照明/通讯基础负载
  const PUMP_KW = 1.0;               // 水泵负载
  const GEN_RATED_KW = 6.5;          // 发电机额定输出
  const GEN_FUEL_L_PER_KWH = 0.28;   // 油耗
  const GEN_IDLE_L_PER_H = 0.12;     // 空载怠速油耗
  const BAT_CAP_KWH = 45;
  const BAT_MAX_KW = 8;
  const PREHEAT_TICKS = 2;           // 冷机预热所需 tick
  const OVERLOAD_SURGE_KWH = 3.0;    // 过载冲击损耗的电池电量

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  class Sim {
    constructor(seed) {
      this.rng = makeRng(seed === undefined ? 12345 : seed);
      this.t = 0;                    // 当前 tick
      this.over = false;
      this.result = null;            // 'win' | 'lose'
      this.events = [];              // {t, type, msg}

      // 环境
      this.blizzard = 0.35;          // 暴风雪强度 0..1
      this.wind = 15;                // m/s
      this.outsideC = -34;
      this.snowCover = 0.2;          // 太阳能板积雪 0..1
      this.fuelDeliveryDone = false;

      // 三座取暖舱
      this.pods = [
        { name: '舱A', temp: 12, heater: true },
        { name: '舱B', temp: 11, heater: true },   // 电池舱：舱温与电池温度互相影响
        { name: '舱C', temp: 10, heater: false },
      ];

      // 电池（位于舱B）
      this.battery = { charge: 30, temp: 8 };

      // 供电母线
      this.pump = false;
      this.busFaultTicks = 0;
      this.lastBalance = { solar: 0, gen: 0, battery: 0, demand: 0, brownout: false };

      // 备用发电机
      this.gen = { state: 'OFF', preheatLeft: 0, loadConnected: false, fuelL: 60 };

      // 人员
      this.crew = [
        { name: '林', pod: 0, health: 100, patrolLeft: 0 },
        { name: '赵', pod: 1, health: 100, patrolLeft: 0 },
        { name: '王', pod: 2, health: 100, patrolLeft: 0 },
      ];

      this.log('ok', '模拟开始：48 小时内保持人员安全且燃料不耗尽。');
    }

    hourOfDay() { return (this.t * TICK_MIN / 60) % 24; }
    day() { return Math.floor(this.t * TICK_MIN / 60 / 24) + 1; }
    clock() {
      const m = this.t * TICK_MIN;
      const h = Math.floor(m / 60) % 24, mm = m % 60;
      return '第' + this.day() + '天 ' + String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }

    log(type, msg) {
      this.events.push({ t: this.t, type: type, msg: this.clock() + '  ' + msg });
    }

    /* ---------- 玩家操作 ---------- */
    setHeater(i, on) {
      this.pods[i].heater = !!on;
      this.log('ok', this.pods[i].name + ' 取暖器 ' + (on ? '开启' : '关闭'));
    }
    togglePump() {
      this.pump = !this.pump;
      this.log('ok', '水泵 ' + (this.pump ? '开启' : '关闭'));
    }
    genPreheat() {
      if (this.gen.state !== 'OFF') { this.log('warn', '发电机不在停机状态，无法预热'); return false; }
      if (this.gen.fuelL <= 0) { this.log('bad', '燃料耗尽，无法预热'); return false; }
      this.gen.state = 'PREHEAT';
      this.gen.preheatLeft = PREHEAT_TICKS;
      this.log('ok', '发电机预热中（需 ' + PREHEAT_TICKS + ' 个 tick）…');
      return true;
    }
    genCrank() {
      if (this.gen.state === 'READY') {
        this.gen.state = 'ONLINE';
        this.log('ok', '点火成功，发电机空载运转。');
        return true;
      }
      if (this.gen.state === 'PREHEAT') {
        this.log('warn', '预热未完成，点火失败！');
        this._crankFail();
        return false;
      }
      if (this.gen.state === 'OFF') {
        // 冷机直接点火：低温下失败并损伤电瓶
        this.log('bad', '冷机直接点火失败！启动电机过载，电池受损。');
        this.battery.charge = Math.max(0, this.battery.charge - 1.5);
        this._crankFail();
        return false;
      }
      return false;
    }
    _crankFail() {
      if (this.gen.state !== 'ONLINE') { this.gen.state = 'OFF'; this.gen.preheatLeft = 0; }
    }
    genConnectLoad() {
      if (this.gen.loadConnected) return true;
      if (this.gen.state !== 'ONLINE') {
        // —— 启动顺序错误：未空载运转即接载 → 母线过载 ——
        this._overload('顺序错误：发电机未空载运转即接入负载');
        return false;
      }
      this.gen.loadConnected = true;
      this.log('ok', '负载已接入发电机。');
      return true;
    }
    genShutdown() {
      if (this.gen.state === 'OFF') return;
      this.gen.state = 'OFF';
      this.gen.loadConnected = false;
      this.gen.preheatLeft = 0;
      this.log('warn', '发电机关机。');
    }
    _overload(reason) {
      this.log('bad', '⚠ 母线过载！' + reason + '。发电机跳闸，电池承受冲击。');
      this.events.push({ t: this.t, type: 'OVERLOAD', msg: reason });
      this.gen.state = 'OFF';
      this.gen.loadConnected = false;
      this.gen.preheatLeft = 0;
      this.busFaultTicks = 1;
      this.battery.charge = Math.max(0, this.battery.charge - OVERLOAD_SURGE_KWH);
    }
    sendPatrol(i) {
      const c = this.crew[i];
      if (c.patrolLeft > 0) return false;
      c.patrolLeft = 1;
      this.log('ok', c.name + ' 外出巡查（清理太阳能板积雪）…');
      return true;
    }

    /* ---------- 主循环 ---------- */
    tick() {
      if (this.over) return;
      this._environment();
      this._generator();
      this._power();
      this._thermal();
      this._crew();
      this.t++;
      this._checkEnd();
    }

    _environment() {
      // 暴风雪强度随机游走
      this.blizzard += (this.rng() - 0.48) * 0.12;
      this.blizzard = Math.max(0.05, Math.min(1, this.blizzard));
      this.wind = 8 + 42 * this.blizzard + this.rng() * 4;
      const diurnal = 4 * Math.sin((this.hourOfDay() - 14) / 24 * 2 * Math.PI);
      this.outsideC = -32 - 12 * this.blizzard + diurnal;
      // 积雪随风雪增长
      this.snowCover = Math.min(1, this.snowCover + this.blizzard * 0.06);
      // 燃料运输：第 30 小时窗口，暴风雪太强则封堵
      const hour = this.t * TICK_MIN / 60;
      if (!this.fuelDeliveryDone && hour >= 30) {
        this.fuelDeliveryDone = true;
        if (this.blizzard < 0.5) {
          this.gen.fuelL += 20;
          this.log('ok', '燃料运输抵达！+20L 燃料。');
        } else {
          this.log('bad', '暴风雪封堵道路，燃料运输被迫折返！');
        }
      }
    }

    _generator() {
      const g = this.gen;
      if (g.state === 'PREHEAT') {
        g.preheatLeft--;
        if (g.preheatLeft <= 0) {
          g.state = 'READY';
          this.log('ok', '预热完成，可以点火。');
        }
      }
    }

    solarKW() {
      const h = this.hourOfDay();
      const daylight = Math.max(0, Math.sin(Math.PI * (h - 6) / 12));
      return 8 * daylight * (1 - 0.85 * this.blizzard) * (1 - this.snowCover);
    }

    _power() {
      const bal = this.lastBalance;
      const fault = this.busFaultTicks > 0;
      if (fault) this.busFaultTicks--;

      let demand = BASE_LOAD_KW + (this.pump ? PUMP_KW : 0);
      for (const p of this.pods) if (p.heater) demand += HEATER_KW;

      const solar = fault ? 0 : this.solarKW();
      let gen = 0;
      if (this.gen.state === 'ONLINE' && this.gen.fuelL > 0) {
        let used = GEN_IDLE_L_PER_H * DT_H;   // 怠速油耗
        if (!fault && this.gen.loadConnected) {
          gen = GEN_RATED_KW;                  // 额定输出，盈余为电池充电
          used += gen * DT_H * GEN_FUEL_L_PER_KWH;
        }
        this.gen.fuelL = Math.max(0, this.gen.fuelL - used);
        if (this.gen.fuelL <= 0) this.log('bad', '燃料耗尽！发电机熄火。');
      }

      // 电池温度影响放电能力（寒冷降低输出）
      const derate = Math.max(0.15, Math.min(1, (this.battery.temp + 20) / 30));
      const batMax = BAT_MAX_KW * derate;
      let battery = 0, brownout = false;
      const deficit = demand - solar - gen;
      if (deficit > 0) {
        battery = Math.min(deficit, fault ? 0 : batMax);
        const need = deficit * DT_H;
        const got = battery * DT_H;
        this.battery.charge = Math.max(0, this.battery.charge - got);
        if (battery < deficit - 1e-6 || this.battery.charge <= 0) brownout = true;
      } else {
        // 盈余（太阳能/发电机）充电，充电也受温度限制
        const chargeKW = Math.min(-deficit, 5 * derate);
        this.battery.charge = Math.min(BAT_CAP_KWH, this.battery.charge + chargeKW * DT_H);
        battery = -chargeKW;
      }
      bal.solar = solar; bal.gen = gen; bal.battery = battery;
      bal.demand = demand; bal.brownout = brownout;
      this._brownout = brownout;
      if (brownout && !this._brownWarned) {
        this._brownWarned = true;
        this.log('warn', '供电不足！取暖器功率下降（母线欠压）。');
      } else if (!brownout) this._brownWarned = false;
    }

    _thermal() {
      const heatFactor = this._brownout ? 0.25 : 1;
      for (let i = 0; i < 3; i++) {
        const p = this.pods[i];
        const heatIn = p.heater ? 10 * heatFactor : 0;    // °C/h 等效
        const loss = 0.13 * (p.temp - this.outsideC);      // 围护结构散热
        let dT = (heatIn - loss) * DT_H;
        // 舱B 与电池互相影响：电池放电发热温暖舱B，舱温反过来决定电池温度
        if (i === 1) dT += Math.max(0, this.lastBalance.battery) * 0.35 * DT_H;
        p.temp += dT;
      }
      // 电池温度向舱B 温度靠拢
      this.battery.temp += (this.pods[1].temp - this.battery.temp) * 0.35 * DT_H;
    }

    _crew() {
      for (const c of this.crew) {
        if (c.patrolLeft > 0) {
          c.patrolLeft--;
          this.snowCover = Math.max(0, this.snowCover - 0.7);
          const exposure = this.blizzard > 0.55 ? 14 : this.blizzard > 0.3 ? 5 : 1;
          c.health -= exposure;
          this.log(exposure > 5 ? 'warn' : 'ok',
            c.name + ' 完成巡查，积雪已清除（暴露 -' + exposure + ' 生命）。');
          if (this.blizzard > 0.55) this.log('bad', c.name + ' 在强暴风雪中巡查，冻伤严重！');
        } else {
          const t = this.pods[c.pod].temp;
          if (t < -10) c.health -= 4;
          else if (t < 0) c.health -= 1.5;
          else if (t > 8 && c.health < 100) c.health = Math.min(100, c.health + 0.5);
        }
        if (c.health <= 0 && !c.lost) {
          c.lost = true;
          this.log('bad', '✝ ' + c.name + ' 失温倒下！');
        }
      }
    }

    _checkEnd() {
      const dead = this.crew.find(c => c.health <= 0);
      if (dead) { this.over = true; this.result = 'lose'; this.log('bad', '任务失败：' + dead.name + ' 失温。'); return; }
      if (this.gen.fuelL <= 0) { this.over = true; this.result = 'lose'; this.log('bad', '任务失败：燃料耗尽。'); return; }
      if (this.t >= TOTAL_TICKS) {
        this.over = true;
        this.result = 'win';
        this.log('ok', '★ 48 小时结束，全员安全，燃料有余 —— 任务成功！');
      }
    }
  }

  Sim.TICK_MIN = TICK_MIN;
  Sim.TOTAL_TICKS = TOTAL_TICKS;
  return Sim;
});
