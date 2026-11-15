// 医院夜班物流模拟 —— 核心逻辑（浏览器与 Node 通用，无 DOM 依赖）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HospitalCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONFIG = {
    floors: 6,               // 1F 药房/冷库，2F 库房，3-5F 手术室，6F 病区
    simMinutes: 180,         // 三小时模拟
    coldLimit: 14,           // 冷链药品离库超过该分钟数即报废
    spoilThreshold: 0.2,     // 报废率阈值（低于即成功）
    elevatorSpeed: 0.22,     // 分钟/层
    elevatorDwell: 0.4,      // 停靠开关门时间（分钟）
    elevatorCapacity: 5,     // 人+件合计
    pickTime: 0.8,           // 药房拣货
    deliverTime: 0.5,        // 送达交接
    stairsPerFloor: 0.7,     // 配送员步行返程
    fridgeSlots: 4,          // 每楼层临时冷藏库存位
    surgeryGrace: 15,        // 手术需求超时宽限（分钟）
    statEventEvery: [25, 45] // STAT 紧急事件间隔范围
  };

  function makeRNG(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 三台手术的需求计划：item 名称、是否冷链、需求时刻（分钟）
  var SURGERY_PLANS = [
    {
      id: 'OR-1', floor: 3, name: '肝移植',
      needs: [
        { item: '手术器械包A', cold: false, needAt: 18 },
        { item: '冰冻血浆(冷)', cold: true, needAt: 46 },
        { item: '免疫抑制剂(冷)', cold: true, needAt: 88 }
      ]
    },
    {
      id: 'OR-2', floor: 4, name: '冠脉搭桥',
      needs: [
        { item: '体外循环耗材', cold: false, needAt: 12 },
        { item: '心肌保护液(冷)', cold: true, needAt: 40 },
        { item: '凝血因子(冷)', cold: true, needAt: 105 },
        { item: '止血纱布', cold: false, needAt: 130 }
      ]
    },
    {
      id: 'OR-3', floor: 5, name: '颅脑肿瘤切除',
      needs: [
        { item: '显微器械包', cold: false, needAt: 26 },
        { item: '甘露醇', cold: false, needAt: 70 },
        { item: '冷敷生物胶(冷)', cold: true, needAt: 118 },
        { item: '抗生素(冷)', cold: true, needAt: 152 }
      ]
    }
  ];

  function HospitalGame(options) {
    options = options || {};
    this.cfg = CONFIG;
    this.rng = makeRNG(options.seed == null ? 12345 : options.seed);
    this.t = 0;
    this.over = false;
    this.log = [];
    this.nextOrderSeq = 1;
    this.nextStatAt = 20 + this.rng() * 15;

    this.orders = [];
    this.outboundQueue = []; // 已安排出库、等待拣货的订单 id

    this.couriers = [
      { id: 'P1', floor: 1, state: 'idle', orderId: null, timer: 0, carrying: null },
      { id: 'P2', floor: 1, state: 'idle', orderId: null, timer: 0, carrying: null }
    ];

    this.elevators = [
      { id: 'A', floor: 1, state: 'idle', stops: [], load: [], timer: 0, coldRisk: false },
      { id: 'B', floor: 1, state: 'idle', stops: [], load: [], timer: 0, coldRisk: false }
    ];

    // 每层楼的临时库存：fridge（冷藏，停止报废计时）与 rack（常温架，冷链继续计时）
    this.storage = {};
    for (var f = 1; f <= CONFIG.floors; f++) this.storage[f] = { fridge: [], rack: [] };

    this.surgeries = SURGERY_PLANS.map(function (p) {
      return {
        id: p.id, floor: p.floor, name: p.name, priority: 1,
        needs: p.needs.map(function (n, i) {
          return { key: p.id + '-' + i, item: n.item, cold: n.cold, needAt: n.needAt, fulfilled: false, failed: false, lateMin: 0 }
        })
      };
    });

    // 为每个手术需求生成药房待出库订单
    var self = this;
    this.surgeries.forEach(function (s) {
      s.needs.forEach(function (n) {
        self.orders.push({
          id: 'ORD-' + self.nextOrderSeq++,
          kind: 'surgery', surgeryId: s.id, needKey: n.key,
          destFloor: s.floor, item: n.item, cold: n.cold,
          createdAt: 0, deadline: n.needAt, priority: 1,
          status: 'pending', outOfColdMin: 0, spoiled: false
        });
      });
    });

    this.stats = { delivered: 0, spoiled: 0, failed: 0, coldTotal: this.orders.filter(function (o) { return o.cold; }).length };
    this.emit('init', '夜班开始：三台手术待命，冷链药品已入库。');
  }

  HospitalGame.prototype.emit = function (type, msg, data) {
    var entry = { t: this.t, type: type, msg: msg };
    if (data) entry.data = data;
    this.log.push(entry);
    if (this.log.length > 300) this.log.shift();
    if (this.onEvent) this.onEvent(entry);
  };

  HospitalGame.prototype.findOrder = function (id) {
    for (var i = 0; i < this.orders.length; i++) if (this.orders[i].id === id) return this.orders[i];
    return null;
  };

  HospitalGame.prototype.findNeed = function (key) {
    for (var i = 0; i < this.surgeries.length; i++) {
      var ns = this.surgeries[i].needs;
      for (var j = 0; j < ns.length; j++) if (ns[j].key === key) return ns[j];
    }
    return null;
  };

  // ---------------- 玩家操作 ----------------

  // 安排出库：把待出库订单加入出库队列
  HospitalGame.prototype.enqueueOrder = function (orderId) {
    var o = this.findOrder(orderId);
    if (!o || o.status !== 'pending') return { ok: false, reason: 'not-pending' };
    o.status = 'queued';
    this.outboundQueue.push(orderId);
    this.emit('dispatch', '出库安排：' + o.item + ' → ' + o.destFloor + 'F');
    return { ok: true };
  };

  // 给货梯追加一个停靠楼层（队尾）
  HospitalGame.prototype.addStop = function (elevId, floor) {
    var e = this.elevator(elevId);
    if (!e || floor < 1 || floor > this.cfg.floors) return { ok: false, reason: 'bad-args' };
    if (e.stops[e.stops.length - 1] === floor) return { ok: false, reason: 'duplicate' };
    e.stops.push(floor);
    if (e.state === 'idle') e.state = 'moving';
    this.emit('elevator', '货梯' + elevId + ' 增加停靠 ' + floor + 'F，队列[' + e.stops.join(',') + ']');
    return { ok: true };
  };

  // 抢占：把楼层插到停靠队列最前。若货梯正在运行且载有冷链货物，
  // 非强制抢占会被拒绝（冲突）；强制抢占成功但标记冷链风险并记录冲突事件。
  HospitalGame.prototype.preempt = function (elevId, floor, opts) {
    opts = opts || {};
    var e = this.elevator(elevId);
    if (!e || floor < 1 || floor > this.cfg.floors) return { ok: false, reason: 'bad-args' };
    var coldAboard = e.load.some(function (it) { return it.cold; });
    if (e.state === 'moving' && coldAboard && !opts.force) {
      this.emit('preempt-conflict', '抢占冲突：货梯' + elevId + ' 载有冷链货物，拒绝让行去 ' + floor + 'F（可强制）');
      return { ok: false, reason: 'cold-aboard' };
    }
    var displaced = e.stops.slice();
    e.stops.unshift(floor);
    if (e.state === 'idle') e.state = 'moving';
    if (coldAboard && opts.force) {
      e.coldRisk = true;
      this.emit('preempt-forced', '强制抢占：货梯' + elevId + ' 改道 ' + floor + 'F，冷链货物延误风险上升！', { displaced: displaced });
    } else {
      this.emit('preempt', '抢占：货梯' + elevId + ' 优先停靠 ' + floor + 'F', { displaced: displaced });
    }
    return { ok: true, displaced: displaced, coldRisk: coldAboard };
  };

  // 把常温架上的物品移入本层冷藏柜（临时库存整理）
  HospitalGame.prototype.moveToFridge = function (floor, orderId) {
    var st = this.storage[floor];
    if (!st) return { ok: false, reason: 'bad-floor' };
    var idx = st.rack.findIndex(function (r) { return r.orderId === orderId; });
    if (idx < 0) return { ok: false, reason: 'not-on-rack' };
    if (st.fridge.length >= this.cfg.fridgeSlots) return { ok: false, reason: 'fridge-full' };
    var rec = st.rack.splice(idx, 1)[0];
    st.fridge.push(rec);
    var o = this.findOrder(orderId);
    if (o) o.status = 'stored-cold';
    this.emit('storage', rec.item + ' 已放入 ' + floor + 'F 冷藏柜');
    return { ok: true };
  };

  HospitalGame.prototype.elevator = function (id) {
    for (var i = 0; i < this.elevators.length; i++) if (this.elevators[i].id === id) return this.elevators[i];
    return null;
  };

  // ---------------- 模拟主循环 ----------------

  HospitalGame.prototype.step = function (dt) {
    if (this.over) return;
    dt = dt || 0.1;
    this.t += dt;

    this.updateCouriers(dt);
    this.updateElevators(dt);
    this.updateColdChain(dt);
    this.updateSurgeries(dt);
    this.updateStatDeadlines();
    this.updateEvents();

    if (this.t >= this.cfg.simMinutes || this.allResolved()) this.over = true;
  };

  HospitalGame.prototype.updateCouriers = function (dt) {
    var self = this;
    this.couriers.forEach(function (c) {
      if (c.state === 'idle') {
        if (self.outboundQueue.length && c.floor === 1) {
          var o = self.findOrder(self.outboundQueue.shift());
          c.orderId = o.id; c.carrying = o; c.state = 'picking'; c.timer = self.cfg.pickTime;
          o.status = 'picking';
        }
      } else if (c.state === 'picking') {
        c.timer -= dt;
        if (c.timer <= 0) { c.state = 'waiting'; c.carrying.status = 'in-transit'; }
      } else if (c.state === 'delivering') {
        c.timer -= dt;
        if (c.timer <= 0) self.finishDelivery(c);
      } else if (c.state === 'returning') {
        c.timer -= dt;
        if (c.timer <= 0) { c.floor = 1; c.state = 'idle'; }
      }
    });
  };

  HospitalGame.prototype.finishDelivery = function (c) {
    var o = c.carrying;
    var st = this.storage[c.floor];
    var rec = { orderId: o.id, item: o.item, cold: o.cold };
    if (o.cold && st.fridge.length < this.cfg.fridgeSlots) {
      st.fridge.push(rec); o.status = 'stored-cold';
    } else {
      st.rack.push(rec); o.status = 'stored';
      if (o.cold) this.emit('warn', o.item + ' 暂存于 ' + c.floor + 'F 常温架，冷链计时继续！');
    }
    this.stats.delivered++;
    this.emit('deliver', c.id + ' 送达 ' + o.item + ' → ' + c.floor + 'F');
    c.carrying = null; c.orderId = null;
    c.state = 'returning';
    c.timer = this.cfg.stairsPerFloor * (c.floor - 1);
  };

  HospitalGame.prototype.updateElevators = function (dt) {
    var self = this;
    this.elevators.forEach(function (e) {
      if (e.state === 'idle') return;
      if (e.state === 'moving') {
        var target = e.stops[0];
        if (target === e.floor) { e.state = 'dwell'; e.timer = self.cfg.elevatorDwell; return; }
        var dir = target > e.floor ? 1 : -1;
        e.floor += dir * (dt / self.cfg.elevatorSpeed);
        if ((dir > 0 && e.floor >= target) || (dir < 0 && e.floor <= target)) {
          e.floor = target; e.state = 'dwell'; e.timer = self.cfg.elevatorDwell;
        }
      } else if (e.state === 'dwell') {
        e.timer -= dt;
        if (e.timer <= 0) self.serveStop(e);
      }
    });
  };

  HospitalGame.prototype.serveStop = function (e) {
    var floor = Math.round(e.floor);
    e.floor = floor;
    // 卸货：到达目的楼层的配送员下梯
    for (var i = e.load.length - 1; i >= 0; i--) {
      var it = e.load[i];
      if (it.destFloor === floor) {
        e.load.splice(i, 1);
        var c = this.couriers[it.courierIdx];
        c.floor = floor; c.state = 'delivering'; c.timer = this.cfg.deliverTime;
      }
    }
    // 装货：1F 等待中的配送员，若其目的楼层在停靠队列内则上梯
    if (floor === 1) {
      var self = this;
      this.couriers.forEach(function (c, idx) {
        if (c.state === 'waiting' && e.load.length < self.cfg.elevatorCapacity &&
            e.stops.indexOf(c.carrying.destFloor) >= 0) {
          c.state = 'onboard';
          e.load.push({ courierIdx: idx, orderId: c.carrying.id, item: c.carrying.item, cold: c.carrying.cold, destFloor: c.carrying.destFloor });
          self.emit('elevator', '货梯' + e.id + ' 搭载 ' + c.id + '（' + c.carrying.item + '）');
        }
      });
    }
    e.stops.shift();
    if (e.stops.length === 0) { e.state = 'idle'; e.coldRisk = false; }
    else e.state = 'moving';
  };

  HospitalGame.prototype.updateColdChain = function (dt) {
    var self = this;
    this.orders.forEach(function (o) {
      if (!o.cold || o.spoiled) return;
      var exposed = o.status === 'in-transit' || o.status === 'stored' || o.status === 'picking';
      if (!exposed) return;
      var rate = 1;
      // 强制抢占过的电梯内，冷链货物升温加倍
      self.elevators.forEach(function (e) {
        if (e.coldRisk && e.load.some(function (it) { return it.orderId === o.id; })) rate = 2;
      });
      o.outOfColdMin += dt * rate;
      if (!o.warned && o.outOfColdMin > self.cfg.coldLimit * 0.7) {
        o.warned = true;
        self.emit('alarm', '警告：' + o.item + ' 离库 ' + o.outOfColdMin.toFixed(1) + ' 分钟，临近报废！');
      }
      if (o.outOfColdMin > self.cfg.coldLimit) self.spoil(o);
    });
  };

  HospitalGame.prototype.spoil = function (o) {
    o.spoiled = true; o.status = 'spoiled';
    this.stats.spoiled++;
    this.emit('spoil', '报废：' + o.item + ' 离库过久，冷链失效！');
    // 从所在位置移除
    this.couriers.forEach(function (c) {
      if (c.carrying && c.carrying.id === o.id) { c.carrying = null; c.orderId = null; c.state = 'returning'; c.timer = 1; }
    });
    this.elevators.forEach(function (e) {
      e.load = e.load.filter(function (it) { return it.orderId !== o.id; });
    });
    for (var f = 1; f <= this.cfg.floors; f++) {
      var st = this.storage[f];
      st.rack = st.rack.filter(function (r) { return r.orderId !== o.id; });
      st.fridge = st.fridge.filter(function (r) { return r.orderId !== o.id; });
    }
    if (o.needKey) this.failNeed(o.needKey, '冷链报废');
  };

  HospitalGame.prototype.failNeed = function (needKey, why) {
    var n = this.findNeed(needKey);
    if (!n || n.fulfilled || n.failed) return;
    n.failed = true;
    this.stats.failed++;
    this.emit('fail', '手术需求失败（' + why + '）：' + n.item);
  };

  HospitalGame.prototype.updateSurgeries = function (dt) {
    var self = this;
    this.surgeries.forEach(function (s) {
      var nextIn = Infinity;
      s.needs.forEach(function (n) {
        if (n.fulfilled || n.failed) return;
        nextIn = Math.min(nextIn, n.needAt - self.t);
        if (self.t >= n.needAt) {
          // 到点消耗：优先冷藏柜，其次常温架
          var st = self.storage[s.floor];
          var take = function (arr) {
            for (var i = 0; i < arr.length; i++) {
              var o = self.findOrder(arr[i].orderId);
              if (o && o.needKey === n.key && !o.spoiled) { arr.splice(i, 1); return o; }
            }
            return null;
          };
          var o = take(st.fridge) || take(st.rack);
          if (o) {
            n.fulfilled = true; o.status = 'consumed';
            self.emit('surgery', s.id + ' 取用 ' + n.item + '（' + s.name + '）');
          } else {
            n.lateMin += dt;
            if (n.lateMin > self.cfg.surgeryGrace) self.failNeed(n.key, '手术等待超时');
          }
        }
      });
      // 动态优先级：最近需求越紧迫，优先级越高
      s.priority = nextIn < 10 ? 3 : nextIn < 25 ? 2 : 1;
    });
  };

  HospitalGame.prototype.updateStatDeadlines = function () {
    var self = this;
    this.orders.forEach(function (o) {
      if (o.kind !== 'stat' || o.deadline == null) return;
      var undelivered = ['pending', 'queued', 'picking', 'in-transit'].indexOf(o.status) >= 0;
      if (undelivered && self.t > o.deadline) {
        o.status = 'failed';
        self.stats.failed++;
        self.emit('fail', 'STAT 超时未送达：' + o.item + '（' + o.destFloor + 'F）');
      }
    });
  };

  HospitalGame.prototype.updateEvents = function () {
    if (this.t < this.nextStatAt) return;
    this.nextStatAt = this.t + this.cfg.statEventEvery[0] + this.rng() * (this.cfg.statEventEvery[1] - this.cfg.statEventEvery[0]);
    var roll = this.rng();
    if (roll < 0.55) {
      // STAT 紧急订单：病区/手术室临时呼叫
      var floor = 2 + Math.floor(this.rng() * (this.cfg.floors - 1));
      var cold = this.rng() < 0.6;
      var item = cold ? 'STAT急救药(冷)' : 'STAT急救耗材';
      this.orders.push({
        id: 'ORD-' + this.nextOrderSeq++, kind: 'stat', surgeryId: null, needKey: null,
        destFloor: floor, item: item, cold: cold,
        createdAt: this.t, deadline: this.t + 18, priority: 3,
        status: 'pending', outOfColdMin: 0, spoiled: false
      });
      if (cold) this.stats.coldTotal++;
      this.emit('stat', 'STAT 呼叫：' + floor + 'F 急需 ' + item + '，限时 18 分钟！');
    } else {
      // 术中变化：某台手术的下一需求提前，优先级动态上升
      var candidates = [];
      this.surgeries.forEach(function (s) {
        s.needs.forEach(function (n) {
          if (!n.fulfilled && !n.failed && n.needAt > this.t + 8) candidates.push({ s: s, n: n });
        }, this);
      }, this);
      if (candidates.length) {
        var pick = candidates[Math.floor(this.rng() * candidates.length)];
        var earlier = Math.max(this.t + 6, pick.n.needAt - (6 + this.rng() * 8));
        this.emit('stat', '术中变化：' + pick.s.id + '（' + pick.s.name + '）提前需要 ' + pick.n.item + '！');
        pick.n.needAt = earlier;
        var ord = this.orders.find(function (o) { return o.needKey === pick.n.key; });
        if (ord) { ord.deadline = earlier; ord.priority = 3; }
      }
    }
  };

  HospitalGame.prototype.allResolved = function () {
    return this.surgeries.every(function (s) {
      return s.needs.every(function (n) { return n.fulfilled || n.failed; });
    });
  };

  HospitalGame.prototype.spoilRate = function () {
    return this.stats.coldTotal ? this.stats.spoiled / this.stats.coldTotal : 0;
  };

  HospitalGame.prototype.result = function () {
    var failed = this.stats.failed;
    var spoilRate = this.spoilRate();
    var win = failed === 0 && spoilRate < this.cfg.spoilThreshold && this.allResolved();
    return {
      win: win,
      timeMin: Math.round(this.t * 10) / 10,
      delivered: this.stats.delivered,
      spoiled: this.stats.spoiled,
      coldTotal: this.stats.coldTotal,
      spoilRate: Math.round(spoilRate * 1000) / 1000,
      failedNeeds: failed
    };
  };

  return { HospitalGame: HospitalGame, CONFIG: CONFIG };
});
