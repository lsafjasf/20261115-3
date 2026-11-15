/*
 * Mine ventilation simulation core (no DOM dependencies).
 * Node/edge pressure network + upwind gas/dust transport.
 * Works in both browser (global MineSim) and Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MineSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GAS_LIMIT = 0.8;      // % CH4 safe threshold at sensor nodes
  var DUST_LIMIT = 3.0;     // mg/m3 safe threshold at sensor nodes
  var SHIFT_MINUTES = 240;  // one work shift
  var CLOSED_DOOR_FACTOR = 0.03;
  var MAIN_FAN_PRESSURE = 55;
  var LOCAL_FAN_PRESSURE = 28;
  var DUST_SETTLING = 0.008;

  function buildNetwork() {
    var N = function (id, x, y, vol, sensor) {
      return { id: id, x: x, y: y, vol: vol, sensor: !!sensor,
               fixed: false, p: 0, gas: 0, dust: 0 };
    };
    var nodes = [
      N('IN', 46, 300, 600, false),
      N('M0', 150, 300, 100, false),
      N('M1', 300, 300, 100, true),
      N('M2', 470, 300, 100, true),
      N('M3', 640, 300, 100, true),
      N('FACE', 806, 300, 160, true),
      N('T0', 150, 120, 100, false),
      N('T1', 300, 120, 100, false),
      N('T2', 470, 120, 100, false),
      N('T3', 640, 120, 100, true),
      N('OUT', 46, 120, 600, false),
      N('B1', 300, 480, 100, false),
      N('B2', 470, 480, 100, false),
      N('B3', 640, 480, 100, true)
    ];

    var E = function (id, u, v, c, doorId, fanId) {
      return { id: id, u: u, v: v, c: c, baseC: c,
               doorId: doorId || null, fanId: fanId || null,
               flow: 0, fanPressure: 0 };
    };
    var edges = [
      E('e_in',    'IN', 'M0', 1.0),
      E('e_m01',   'M0', 'M1', 1.0),
      E('e_m12',   'M1', 'M2', 1.0),
      E('e_m23',   'M2', 'M3', 1.0),
      E('e_duct',  'M3', 'FACE', 1.3, null, 'local'),
      E('e_faceR', 'FACE', 'T3', 0.95, 'D4'),
      E('e_t32',   'T3', 'T2', 1.0),
      E('e_t21',   'T2', 'T1', 1.0),
      E('e_t10',   'T1', 'T0', 1.0),
      E('e_out',   'T0', 'OUT', 1.0),
      E('e_d1',    'M1', 'B1', 0.9, 'D1'),
      E('e_b12',   'B1', 'B2', 0.9),
      E('e_b23',   'B2', 'B3', 0.9),
      E('e_d3',    'B3', 'T3', 0.9, 'D3'),
      E('e_d2',    'M0', 'T0', 4.0, 'D2')
    ];
    return { nodes: nodes, edges: edges };
  }

  function createSimulation() {
    var net = buildNetwork();
    var sim = {
      t: 0,
      shiftLength: SHIFT_MINUTES,
      gasLimit: GAS_LIMIT,
      dustLimit: DUST_LIMIT,
      nodes: net.nodes,
      edges: net.edges,
      nodeById: {},
      edgeById: {},
      doors: {
        D1: { edgeId: 'e_d1', open: false, label: '下部联络巷风门' },
        D2: { edgeId: 'e_d2', open: false, label: '进回风短路风门' },
        D3: { edgeId: 'e_d3', open: true,  label: '下部回风风门' },
        D4: { edgeId: 'e_faceR', open: true, label: '工作面回风风门' }
      },
      fans: {
        main: { on: true, reverse: false, pressure: MAIN_FAN_PRESSURE },
        local: { mode: 'off', pressure: LOCAL_FAN_PRESSURE } // off | force | exhaust
      },
      progress: 0,
      status: 'running',
      alarms: { active: {}, shortCircuit: false, list: [] },
      log: [],
      stats: { faceFlow: 0, intakeFlow: 0, shortRatio: 0 }
    };
    net.nodes.forEach(function (n) { sim.nodeById[n.id] = n; });
    net.edges.forEach(function (e) { sim.edgeById[e.id] = e; });

    // Post-blast contamination: gas and dust pooled at the face and return.
    sim.nodeById.FACE.gas = 1.8;
    sim.nodeById.FACE.dust = 14;
    sim.nodeById.T3.gas = 1.0;
    sim.nodeById.T3.dust = 8;
    sim.nodeById.M3.gas = 0.55;
    sim.nodeById.M3.dust = 4;
    sim.nodeById.B3.gas = 0.4;
    sim.nodeById.B3.dust = 3.5;
    solvePressures(sim);
    updateAlarms(sim);
    sim.workers = workerNodes(sim);
    return sim;
  }

  function edgeConductance(sim, edge) {
    if (!edge.doorId) return edge.baseC;
    var door = sim.doors[edge.doorId];
    return door.open ? edge.baseC : edge.baseC * CLOSED_DOOR_FACTOR;
  }

  function solvePressures(sim) {
    var nodes = sim.nodes, edges = sim.edges;
    var mainOn = sim.fans.main.on;
    var sign = sim.fans.main.reverse ? -1 : 1;
    nodes.forEach(function (n) { n.fixed = false; });
    sim.nodeById.IN.fixed = true;
    sim.nodeById.IN.p = 0;
    sim.nodeById.OUT.fixed = true;
    sim.nodeById.OUT.p = mainOn ? -sign * sim.fans.main.pressure : 0;

    edges.forEach(function (e) {
      e.fanPressure = 0;
      if (e.fanId === 'local') {
        var mode = sim.fans.local.mode;
        if (mode === 'force') e.fanPressure = sim.fans.local.pressure;   // pushes u->v
        else if (mode === 'exhaust') e.fanPressure = -sim.fans.local.pressure;
      }
    });

    // Gauss-Seidel: sum_k c_k(p_k + f_k) / sum_k c_k, f positive u->v.
    for (var iter = 0; iter < 80; iter++) {
      nodes.forEach(function (n) {
        if (n.fixed) return;
        var num = 0, den = 0;
        edges.forEach(function (e) {
          var other = null, fanTerm = 0;
          if (e.u === n.id) {
            other = sim.nodeById[e.v];
            fanTerm = -e.fanPressure; // pressure drop n->other includes +f
          } else if (e.v === n.id) {
            other = sim.nodeById[e.u];
            fanTerm = e.fanPressure;
          }
          if (!other) return;
          var c = edgeConductance(sim, e);
          num += c * (other.p + fanTerm);
          den += c;
        });
        if (den > 0) n.p = num / den;
      });
    }

    edges.forEach(function (e) {
      var u = sim.nodeById[e.u], v = sim.nodeById[e.v];
      var c = edgeConductance(sim, e);
      e.flow = c * ((u.p - v.p) + e.fanPressure); // positive: u -> v
    });
  }

  function transport(sim) {
    var gasIn = {}, dustIn = {};
    sim.nodes.forEach(function (n) {
      gasIn[n.id] = n.gas;
      dustIn[n.id] = n.dust;
    });
    var dGas = {}, dDust = {};
    sim.nodes.forEach(function (n) { dGas[n.id] = 0; dDust[n.id] = 0; });

    sim.edges.forEach(function (e) {
      var f = e.flow;
      if (Math.abs(f) < 1e-9) return;
      var fromId = f > 0 ? e.u : e.v;
      var toId = f > 0 ? e.v : e.u;
      var q = Math.abs(f);
      dGas[toId] += q * gasIn[fromId];
      dDust[toId] += q * dustIn[fromId];
      dGas[fromId] -= q * gasIn[fromId];
      dDust[fromId] -= q * dustIn[fromId];
    });

    sim.nodes.forEach(function (n) {
      if (n.id === 'IN' || n.id === 'OUT') return; // boundaries
      n.gas = Math.max(0, n.gas + dGas[n.id] / n.vol);
      n.dust = Math.max(0, n.dust + dDust[n.id] / n.vol);
      n.dust = Math.max(0, n.dust * (1 - DUST_SETTLING));
    });
    // Fresh-air intake and return outlet boundaries.
    sim.nodeById.IN.gas = 0;
    sim.nodeById.IN.dust = 0;
    sim.nodeById.OUT.gas = 0;
    sim.nodeById.OUT.dust = 0;

    var face = sim.nodeById.FACE;
    face.gas += 0.035;          // continuing methane seepage
    face.dust += 0.14;          // residual dust after blast
  }

  function updateAlarms(sim) {
    var list = [];
    sim.nodes.forEach(function (n) {
      if (!n.sensor) return;
      if (n.gas > GAS_LIMIT) list.push({ type: 'gas', node: n.id, value: n.gas });
      if (n.dust > DUST_LIMIT) list.push({ type: 'dust', node: n.id, value: n.dust });
    });
    var active = {};
    list.forEach(function (a) { active[a.node + ':' + a.type] = true; });

    var duct = sim.edgeById.e_duct;
    var d2 = sim.edgeById.e_d2;
    var reference = sim.fans.main.pressure * 0.22; // design face flow benchmark
    var faceFlow = Math.abs(duct.flow);
    var shortRatio = Math.max(0, d2.flow) / reference;
    var shortCircuit = sim.fans.main.on &&
      (shortRatio > 0.45 || (sim.doors.D2.open && faceFlow < 0.5 * reference));

    sim.alarms.active = active;
    sim.alarms.list = list;
    sim.alarms.shortCircuit = shortCircuit;
    sim.stats.faceFlow = faceFlow;
    sim.stats.intakeFlow = Math.max(0, sim.edgeById.e_in.flow);
    sim.stats.shortRatio = shortRatio;
    return list;
  }

  function anyAlarm(sim) {
    return sim.alarms.list.length > 0 || sim.alarms.shortCircuit;
  }

  function addLog(sim, text, level) {
    sim.log.unshift({ t: sim.t, text: text, level: level || 'info' });
    if (sim.log.length > 80) sim.log.length = 80;
  }

  function command(sim, name, value) {
    if (sim.status !== 'running') return false;
    switch (name) {
      case 'door':
        var door = sim.doors[value.id];
        if (!door) return false;
        door.open = !!value.open;
        addLog(sim, door.label + (door.open ? ' 打开' : '关闭'), door.open ? 'warn' : 'info');
        return true;
      case 'mainFan':
        sim.fans.main.on = !!value.on;
        addLog(sim, '主风机' + (sim.fans.main.on ? '开启' : '停机'), sim.fans.main.on ? 'info' : 'danger');
        return true;
      case 'reverse':
        sim.fans.main.reverse = !!value.reverse;
        addLog(sim, sim.fans.main.reverse ? '执行反风' : '恢复正常风向', 'warn');
        return true;
      case 'localFan':
        sim.fans.local.mode = value.mode;
        var label = { off: '局部风机停机', force: '局部压入式通风', exhaust: '局部抽出式排风' };
        addLog(sim, label[value.mode], value.mode === 'off' ? 'warn' : 'info');
        return true;
      default:
        return false;
    }
  }

  function workerNodes(sim) {
    // Crew advances from intake toward the face as task progress grows;
    // they retreat to M0 while any alarm is active.
    var retreat = anyAlarm(sim);
    var chain = ['M0', 'M1', 'M2', 'M3', 'FACE'];
    var idx = retreat ? 0 : Math.min(chain.length - 1,
      Math.floor(sim.progress / (100 / (chain.length - 1))));
    return { chain: chain, index: idx, nodeId: chain[idx], retreat: retreat };
  }

  function allSensorsSafe(sim) {
    return sim.nodes.filter(function (n) { return n.sensor; }).every(function (n) {
      return n.gas <= GAS_LIMIT && n.dust <= DUST_LIMIT;
    });
  }

  function step(sim) {
    if (sim.status !== 'running') return sim;
    sim.t += 1;
    solvePressures(sim);
    transport(sim);
    solvePressures(sim); // recompute flows after concentration update for rendering/audio
    updateAlarms(sim);

    var safe = allSensorsSafe(sim) && !sim.alarms.shortCircuit && sim.fans.main.on;
    if (safe) {
      sim.progress = Math.min(100, sim.progress + 100 / 120);
    }

    if (sim.alarms.shortCircuit) {
      addLog(sim, '风流短路：新鲜风未到工作面即被短路，报警！', 'danger');
    }
    var face = sim.nodeById.FACE;
    if (face.gas > 1.5) addLog(sim, '工作面瓦斯急剧积聚 ' + face.gas.toFixed(2) + '%', 'danger');

    if (sim.progress >= 100 && allSensorsSafe(sim) && !sim.alarms.shortCircuit) {
      sim.status = 'won';
      addLog(sim, '任务完成，所有传感器均低于安全阈值', 'ok');
    } else if (sim.t >= SHIFT_MINUTES) {
      sim.status = 'lost';
      addLog(sim, '工班结束，仍有传感器超标，任务失败', 'danger');
    }
    sim.workers = workerNodes(sim);
    return sim;
  }

  function run(sim, minutes) {
    for (var i = 0; i < minutes && sim.status === 'running'; i++) step(sim);
    return sim;
  }

  return {
    createSimulation: createSimulation,
    solvePressures: solvePressures,
    transport: transport,
    updateAlarms: updateAlarms,
    anyAlarm: anyAlarm,
    edgeConductance: edgeConductance,
    command: command,
    step: step,
    run: run,
    workerNodes: workerNodes,
    allSensorsSafe: allSensorsSafe,
    addLog: addLog,
    GAS_LIMIT: GAS_LIMIT,
    DUST_LIMIT: DUST_LIMIT,
    SHIFT_MINUTES: SHIFT_MINUTES
  };
});
