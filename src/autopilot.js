// 自动玩家：按断路紧急度动态派车，到达节点即依据当前水位重算安全路线。
import { findSafeRoute } from './engine.js';
import { edgeKey, BUS_CAPACITY } from './world.js';

const HOME_PLAN = [22, 7, 16, 20, 17, 8]; // 首批目标（含最早断路的 22）

export function createAutoPilot(world, engine) {
  const deadHomes = new Set();
  const claimed = new Map(); // busId -> homeId

  // 动态标记避难所开放走廊为优先道路
  const priorityEdges = new Set();
  for (const home of world.homeIds) {
    const path = findSafeRoute(world, home, world.shelterId, 0, 0);
    if (!path) continue;
    for (let i = 0; i < path.length - 1; i++) {
      const e = world.edgeIndex.get(edgeKey(path[i], path[i + 1]));
      if (e && !e.blocked) priorityEdges.add(e.id);
    }
  }
  for (const edgeId of priorityEdges) engine.setPriority(edgeId, 1, 'player');

  // 仍有居民且本 tick 仍可达的居民区，按断路时刻（紧急度）排序
  function viableHomes(fromNode, passengers) {
    return world.homeIds
      .filter((id) => !deadHomes.has(id) && world.nodes[id].residents > 0)
      .filter((id) => findSafeRoute(world, fromNode, id, engine.tick, passengers))
      // 必须能在该节点被淹前完成“去程 + 满载回程”，否则不派车
      .filter((id) => findSafeRoute(world, id, world.shelterId, engine.tick, 0, true))
      .map((id) => ({ id, cut: world.nodes[id].cutTick, pop: world.nodes[id].residents }))
      .sort((a, b) => a.cut - b.cut || b.pop - a.pop);
  }

  function goTo(bus, target, reason) {
    const conservative = target === world.shelterId;
    const path = findSafeRoute(
      world, bus.node, target, engine.tick, bus.passengers, conservative,
    );
    if (!path) return false;
    return engine.reroute(bus.id, path, 'player', reason);
  }

  for (const bus of engine.buses) {
    claimed.set(bus.id, HOME_PLAN[bus.id - 1]);
    goTo(bus, HOME_PLAN[bus.id - 1], 'initial-dispatch');
  }

  function tick() {
    for (const bus of engine.buses) {
      if (bus.state === 'trapped' || bus.state === 'moving') continue;

      // 驻留中：满员或节点清空就立刻按当前水位回避难所
      if (bus.state === 'dwelling') {
        const node = world.nodes[bus.node];
        if (bus.passengers >= BUS_CAPACITY || node.residents === 0) {
          if (goTo(bus, world.shelterId, 'flood-adapt-early-depart')) {
            claimed.delete(bus.id);
          }
        }
        continue;
      }

      if (bus.state !== 'idle') continue;

      if (bus.passengers > 0) {
        if (!goTo(bus, world.shelterId, 'reroute-to-shelter')) {
          deadHomes.add(bus.node); // 退路已断，留在高地节点等待
        }
        continue;
      }

      // 空车：抢最紧急的可达居民区；被其他车认领的节点降权
      const homes = viableHomes(bus.node, 0);
      const taken = new Set([...claimed.values()]);
      const target = homes.find((h) => !taken.has(h.id)) ?? homes[0];
      if (!target) { goTo(bus, world.shelterId, 'fallback-shelter'); continue; }
      claimed.set(bus.id, target.id);
      if (!goTo(bus, target.id, 'reroute-to-pickup')) {
        deadHomes.add(target.id);
        claimed.delete(bus.id);
      }
    }

    for (const home of world.homeIds) {
      if (world.nodes[home].cutTick <= engine.tick + 1) deadHomes.add(home);
    }
  }

  return { tick, stats: () => ({ deadHomes: [...deadHomes] }) };
}
