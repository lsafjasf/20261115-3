import { createRng, randInt } from './rng.js';

export const SIM_DURATION = 60; // 模拟总时长（分钟）
export const BASE_SPEED = 30; // 标称车速 km/h
export const LOAD_TIME_PER_VICTIM = 2; // 每名伤员上车耗时（分钟）
export const UNLOAD_TIME_PER_VICTIM = 1; // 每名伤员送院耗时（分钟）
export const REFUEL_TIME = 3; // 回站补能耗时（分钟）
export const MEDIC_POOL = 10; // 全局担架员总数

// 装备 -> 可处置的事故类型
export const INCIDENT_TYPES = {
  fire: { label: '火灾', equipment: 'fire', color: '#ff5c5c' },
  collision: { label: '坍塌碰撞', equipment: 'rescue', color: '#f0a330' },
  hazmat: { label: '化学品泄漏', equipment: 'hazmat', color: '#b06cff' },
};

// 五辆救援车：容量、车速、续航、专用装备各不相同
export const VEHICLE_DEFS = [
  { id: 'V1', name: '急救一号', type: 'ambulance', capacity: 3, speed: 32, range: 90, equipment: 'medical', defaultMedics: 3 },
  { id: 'V2', name: '急救二号', type: 'ambulance', capacity: 3, speed: 30, range: 75, equipment: 'medical', defaultMedics: 3 },
  { id: 'T1', name: '抢险救援车', type: 'rescue', capacity: 2, speed: 28, range: 80, equipment: 'rescue', defaultMedics: 2 },
  { id: 'T2', name: '水罐消防车', type: 'fire', capacity: 1, speed: 28, range: 85, equipment: 'fire', defaultMedics: 1 },
  { id: 'T3', name: '化洗处置车', type: 'hazmat', capacity: 1, speed: 26, range: 70, equipment: 'hazmat', defaultMedics: 1 },
];

// 固定 seed 的三类事故请求（两个城区同时发生）
export function generateIncidents(seed) {
  const rng = createRng(seed ^ 0x51ed270b);
  const specs = [
    { id: 'I1', nodeId: 'B1', type: 'fire', victimCount: 3 },
    { id: 'I2', nodeId: 'A2', type: 'collision', victimCount: 3 },
    { id: 'I3', nodeId: 'A1', type: 'hazmat', victimCount: 2 },
  ];
  const incidents = [];
  const victims = [];
  for (const spec of specs) {
    const incident = {
      ...spec,
      controlled: false,
      controlledAt: null,
      controlledBy: null,
      remaining: spec.victimCount,
    };
    incidents.push(incident);
    for (let i = 0; i < spec.victimCount; i += 1) {
      victims.push({
        id: `${spec.id}-P${i + 1}`,
        incidentId: spec.id,
        status: 100,
        declineRate: randInt(rng, 16, 22) / 10, // 现场每分钟恶化 1.6~2.2
        alive: true,
        state: 'onsite', // onsite | onboard | delivered | dead
        vehicleId: null,
        deliveredAt: null,
      });
    }
  }
  return { incidents, victims };
}
