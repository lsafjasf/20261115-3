// 温室群能源管理模拟核心(纯逻辑,浏览器与 Node 通用)
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else root.GreenSim = mod;
})(typeof self !== "undefined" ? self : this, function () {
  const TICK_MIN = 5; // 每 tick 模拟 5 分钟
  const DAY_MIN = 1440;

  const CROPS = [
    { name: "番茄", tMin: 15, tMax: 30, lightNeed: 0.55, waterNeed: 0.5, stages: ["幼苗", "开花", "结果"] },
    { name: "生菜", tMin: 10, tMax: 26, lightNeed: 0.4, waterNeed: 0.65, stages: ["幼苗", "展叶", "采收"] },
    { name: "草莓", tMin: 12, tMax: 28, lightNeed: 0.5, waterNeed: 0.55, stages: ["幼苗", "开花", "挂果"] },
  ];

  function createState(options) {
    options = options || {};
    return {
      timeMin: 0,
      battery: 70, // 0..100
      fuel: 60, // 锅炉燃料
      outdoor: 10,
      cloud: 0.2,
      coldSnaps: options.coldSnaps || [{ start: 17 * 60, end: 21 * 60, drop: 14 }],
      zones: CROPS.map(function (c) {
        return {
          crop: c,
          temp: 18,
          light: 0,
          moisture: 0.6,
          health: 100,
          stage: 0,
          stageProg: 0,
          lightHours: 0,
        };
      }),
      devices: {
        boiler: { on: false, wear: 0, broken: false },
        pump: { on: false, wear: 0, broken: false },
        lights: [0, 1, 2].map(function () { return { on: false, wear: 0, broken: false }; }),
      },
      ctrl: {
        boilerOn: false,
        heatAlloc: [1 / 3, 1 / 3, 1 / 3],
        pumpOn: false,
        valve: [0.5, 0.5, 0.5],
        lightOn: [false, false, false],
        shade: [0, 0, 0],
      },
      log: [],
      failed: false,
      failReason: "",
      blackout: false,
      lastSolar: 0,
      lastLoad: 0,
    };
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function coldSnapDrop(state, t) {
    let d = 0;
    for (const s of state.coldSnaps) {
      if (t >= s.start && t < s.end) d = Math.max(d, s.drop);
    }
    return d;
  }

  function outdoorTemp(state, t) {
    const base = 18 + 6 * Math.sin(((t - 240) / DAY_MIN) * 2 * Math.PI - Math.PI / 2);
    return base - coldSnapDrop(state, t);
  }

  function naturalLight(t) {
    const h = t / 60;
    if (h < 6 || h > 19) return 0;
    return clamp(Math.sin(((h - 6) / 13) * Math.PI), 0, 1);
  }

  function solarPower(state, t) {
    return naturalLight(t) * 9 * (1 - state.cloud * 0.75);
  }

  function toggleDevice(dev, wantOn, state, name) {
    if (wantOn && dev.broken) return;
    if (dev.on !== wantOn) {
      dev.on = wantOn;
      dev.wear += 6; // 频繁切换损耗寿命
      if (dev.wear >= 100) {
        dev.broken = true;
        dev.on = false;
        state.log.push(state.timeMin + " " + name + " 因频繁切换损坏!");
      }
    }
  }

  function step(state) {
    const dt = TICK_MIN / 60; // 小时
    const t = state.timeMin;
    const c = state.ctrl;
    state.outdoor = outdoorTemp(state, t);
    const nat = naturalLight(t);

    // ---- 设备开关与磨损 ----
    toggleDevice(state.devices.boiler, c.boilerOn && state.fuel > 0, state, "锅炉");
    toggleDevice(state.devices.pump, c.pumpOn, state, "水泵");
    for (let i = 0; i < 3; i++) toggleDevice(state.devices.lights[i], c.lightOn[i], state, "补光灯" + (i + 1));

    // ---- 能量流 ----
    const solar = solarPower(state, t);
    let load = 0;
    const lightsOn = state.devices.lights.filter(function (d) { return d.on; }).length;
    load += lightsOn * 2.0;
    if (state.devices.pump.on) {
      const flow = c.valve[0] + c.valve[1] + c.valve[2];
      if (flow > 0.05) load += 0.8 + 0.6 * flow;
    }
    if (state.devices.boiler.on) load += 0.4;
    state.battery = clamp(state.battery + (solar - load) * dt, 0, 100);
    state.lastSolar = solar;
    state.lastLoad = load;

    // 电量枯竭:全部设备强制断电
    if (state.battery <= 0.01) {
      state.devices.pump.on = false;
      state.devices.boiler.on = false;
      state.devices.lights.forEach(function (d) { d.on = false; });
      state.blackout = true;
    } else state.blackout = false;

    // 锅炉燃料与供热
    let heatTotal = 0;
    if (state.devices.boiler.on && state.fuel > 0) {
      heatTotal = 26;
      state.fuel = Math.max(0, state.fuel - 2.2 * dt);
      if (state.fuel <= 0) state.devices.boiler.on = false;
    }

    // ---- 每个温区 ----
    for (let i = 0; i < 3; i++) {
      const z = state.zones[i];
      const shade = clamp(c.shade[i], 0, 1);
      const exchange = (state.outdoor - z.temp) * 0.30 * dt;
      const solarGain = nat * 3 * (1 - shade * 0.8) * dt;
      const heatGain = heatTotal * clamp(c.heatAlloc[i], 0, 1) * 0.35 * dt;
      z.temp += exchange + solarGain + heatGain;
      z.light = clamp(nat * (1 - shade * 0.85) * (1 - state.cloud * 0.5) + (state.devices.lights[i].on ? 0.55 : 0), 0, 1);
      const transp = (0.02 + 0.05 * z.light + 0.02 * Math.max(0, z.temp - 20) / 10) * dt;
      let irrig = 0;
      if (state.devices.pump.on) irrig = clamp(c.valve[i], 0, 1) * 0.25 * dt;
      z.moisture = clamp(z.moisture - transp + irrig, 0, 1);
      const crop = z.crop;
      let stress = 0;
      if (z.temp < crop.tMin) stress += (crop.tMin - z.temp) * 0.9;
      if (z.temp > crop.tMax) stress += (z.temp - crop.tMax) * 0.9;
      if (z.moisture < crop.waterNeed - 0.2) stress += 10 * (crop.waterNeed - 0.2 - z.moisture);
      if (z.moisture > 0.95) stress += 4;
      const lightOk = z.light >= crop.lightNeed * 0.6;
      if (lightOk) z.lightHours += dt;
      if (stress > 0) z.health = clamp(z.health - stress * dt * 2.2, 0, 100);
      else z.health = clamp(z.health + 1.5 * dt, 0, 100);
      const comfy = z.temp >= crop.tMin && z.temp <= crop.tMax && z.moisture > crop.waterNeed - 0.15;
      if (comfy && lightOk) {
        z.stageProg += dt / 6;
        if (z.stageProg >= 1 && z.stage < crop.stages.length - 1) {
          z.stageProg = 0;
          z.stage++;
          state.log.push(t + " " + crop.name + " 进入 " + crop.stages[z.stage] + " 期");
        }
      }
      if (z.health <= 0) {
        state.failed = true;
        state.failReason = crop.name + " 枯死";
      }
    }

    state.timeMin += TICK_MIN;
    return state;
  }

  function isWin(state) {
    if (state.failed) return false;
    if (state.timeMin < DAY_MIN) return false;
    const healthy = state.zones.every(function (z) { return z.health >= 50; });
    return healthy && state.battery >= 20;
  }

  return {
    createState: createState,
    step: step,
    isWin: isWin,
    TICK_MIN: TICK_MIN,
    DAY_MIN: DAY_MIN,
    CROPS: CROPS,
    outdoorTemp: outdoorTemp,
    coldSnapDrop: coldSnapDrop,
    naturalLight: naturalLight,
  };
});
