export const WORLD = Object.freeze({
  width: 1600,
  height: 1000,
  shoreY: 870,
  seed: 20261115
});

export const SURVIVORS = Object.freeze([
  { id: "lin", name: "林岚", role: "气象员", x: 432, y: 474, color: "#ffb454" },
  { id: "zhao", name: "赵海", role: "钻机手", x: 918, y: 246, color: "#ffd08a" },
  { id: "cheng", name: "程野", role: "机械师", x: 1217, y: 628, color: "#f49b58" }
]);

export const VEHICLE = Object.freeze({
  length: 58,
  width: 35,
  startX: 800,
  startY: 831,
  startHeading: -Math.PI / 2,
  baseSpeed: 186,
  reverseSpeed: 74,
  baseAccel: 118,
  baseBrake: 174,
  turnRate: 1.62,
  pickupRadius: 45,
  pickupSpeed: 46,
  shoreDropSpeed: 52
});

export const ICE = Object.freeze({
  cols: 12,
  rows: 9,
  cellW: WORLD.width / 12,
  cellH: WORLD.height / 9,
  stressCap: 108,
  failureStress: 96,
  sinkDelay: 1.05
});

export function handlingForAboard(count) {
  return {
    massFactor: 1 + count * 0.27,
    maxSpeed: VEHICLE.baseSpeed - count * 7.5,
    accel: VEHICLE.baseAccel / (1 + count * 0.24),
    brake: VEHICLE.baseBrake / (1 + count * 0.38),
    turnRate: VEHICLE.turnRate / (1 + count * 0.11)
  };
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function angleDelta(target, current) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
