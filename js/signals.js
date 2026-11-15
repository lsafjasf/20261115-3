import { ALL_RED } from './config.js';

// 三相位信号机：主干绿灯 → 全红 → 支路绿灯 → 全红 → 行人相位 → 全红，循环
export function signalState(cfg, t) {
  const gMain = cfg.gMain;
  const gSide = cfg.gSide;
  const gPed = cfg.gPed;
  const cycle = gMain + gSide + gPed + 3 * ALL_RED;
  const x = ((t % cycle) + cycle) % cycle;

  let phase = 'RED';
  let eb = false, wb = false, nb = false, sb = false, ped = false;

  if (x < gMain) {
    phase = 'MAIN';
    eb = wb = true;
    ped = !!cfg.riskPed; // 错误放行：机动车绿灯同时放人
  } else if (x < gMain + ALL_RED) {
    phase = 'RED';
  } else if (x < gMain + ALL_RED + gSide) {
    phase = 'SIDE';
    nb = sb = true;
  } else if (x < gMain + ALL_RED + gSide + ALL_RED) {
    phase = 'RED';
  } else if (x < gMain + ALL_RED + gSide + ALL_RED + gPed) {
    phase = 'PED';
    ped = true;
  } else {
    phase = 'RED';
  }

  return { phase, eb, wb, nb, sb, ped, cycle, x };
}
