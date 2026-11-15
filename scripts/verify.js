import { CoolingSim, HOTSPOT_LIMIT_C } from "../simulation.js";

function hotspotScenario() {
  const sim = new CoolingSim({ seed: 11 });
  sim.setFan(0, 52);
  sim.setFan(1, 52);
  sim.setFan(2, 52);
  sim.setCoolant(48);
  const source = sim.racks.find((rack) => rack.tasks.length === 0);
  sim.addTask(source.id, 8, 240, false);

  let migration = null;
  for (let minute = 0; minute < 90 && !migration; minute += 1) {
    sim.step();
    migration = sim.events.find(
      (event) => event.type === "auto-migration" && event.rackId === source.id
    );
  }

  if (!migration) throw new Error("热点迁移验证失败");
  return {
    status: "PASS",
    source: migration.rackId,
    target: migration.targetRackId,
    task: migration.taskId,
    temperature: migration.sourceTemp,
    threshold: HOTSPOT_LIMIT_C,
    minute: migration.at
  };
}

function chillerScenario() {
  const sim = new CoolingSim({ seed: 47 });
  const baseline = sim.stats().supplyTemp;
  sim.triggerChillerFailure(90, false);
  sim.step(30);
  const during = sim.stats();
  sim.step(65);
  const after = sim.stats();
  const recovered = sim.events.some((event) => event.type === "recovery");
  if (!recovered || after.chillerOnline !== true || during.supplyTemp <= baseline + 4) {
    throw new Error("冷却机故障验证失败");
  }
  return {
    status: "PASS",
    baselineSupply: baseline,
    faultSupply: during.supplyTemp,
    maxTemperature: during.maxTemp,
    recoveredAtMinute: sim.elapsedMin,
    failureCount: sim.chiller.failureCount
  };
}

console.log("AISLE//ZERO scenario verification");
console.log("hotspot migration:", hotspotScenario());
console.log("chiller failure:", chillerScenario());
