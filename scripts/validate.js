"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Simulation, formatTime } = require("../sim.js");

function execute(plan) {
  const sim = new Simulation();
  plan(sim);
  sim.start();
  let maxWestQueue = 0;
  let ticks = 0;
  while (sim.status === "running" && ticks < 22000) {
    sim.update(0.05);
    maxWestQueue = Math.max(maxWestQueue, sim.queues.westExit.length);
    ticks += 1;
  }
  const snapshot = sim.getSnapshot();
  return {
    status: snapshot.status,
    evacuationTimeSeconds: Number(snapshot.time.toFixed(2)),
    evacuationClock: formatTime(snapshot.time),
    evacuated: snapshot.evacuated,
    totalPassengers: snapshot.totalPassengers,
    transformerLiters: Number(snapshot.water.transformerLiters.toFixed(3)),
    peakCrushRisk: Number(snapshot.peakRisk.toFixed(2)),
    riskEvents: snapshot.stats.riskEvents,
    pumpTrips: snapshot.stats.pumpTrips,
    maxWestExitQueue: maxWestQueue,
    dangerLogs: snapshot.logs.filter((item) => item.level === "danger").map((item) => item.message),
    endReason: snapshot.endReason
  };
}

const successRun = execute((sim) => {
  sim.setBarrier("a", "closed");
  sim.setBarrier("b", "open");
  sim.setTransformerDoor("sealed");
  sim.setGate("1", "exit");
  sim.setGate("2", "exit");
  sim.setPump("1", "high");
  sim.setPump("2", "low");
});

const wrongSealingRun = execute((sim) => {
  sim.setBarrier("a", "closed");
  sim.setBarrier("b", "closed");
  sim.setTransformerDoor("sealed");
  sim.setGate("1", "exit");
  sim.setGate("2", "exit");
  sim.setPump("1", "low");
  sim.setPump("2", "off");
});

const report = {
  generatedAt: new Date().toISOString(),
  missionWindowSeconds: 15 * 60,
  successCriteria: [
    "全部乘客在 15:00 模拟时间内离站",
    "变电室积水量不超过 2 L（保持干燥）"
  ],
  referencePlan: {
    description: "A 入口全封、B 入口开启、双闸机切为出站、P1 高档排水、P2 低档排水、变电室防水门密封"
  },
  successRun,
  wrongSealingPlan: {
    description: "错误地把 A、B 两个入口同时全封，仅保留 1.8 人/秒的西侧窄出口"
  },
  wrongSealingRun,
  checks: {
    evacuationCompletedInTime:
      successRun.status === "success" && successRun.evacuationTimeSeconds <= 15 * 60,
    transformerStayedDry: successRun.transformerLiters <= 2,
    wrongSealingStampedeRiskDetected:
      wrongSealingRun.peakCrushRisk >= 82 &&
      wrongSealingRun.riskEvents >= 1 &&
      wrongSealingRun.maxWestExitQueue >= 120,
    wrongSealingDangerLogged: wrongSealingRun.dangerLogs.length > 0
  }
};

const outputDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "validation-report.json");
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log("Validation report written to " + outputPath);
console.log(
  "Reference run: " +
    successRun.status +
    " in " +
    successRun.evacuationClock +
    ", transformer " +
    successRun.transformerLiters +
    " L, peak risk " +
    successRun.peakCrushRisk
);
console.log(
  "Wrong sealing run: peak risk " +
    wrongSealingRun.peakCrushRisk +
    ", max west-exit queue " +
    wrongSealingRun.maxWestExitQueue +
    ", danger events " +
    wrongSealingRun.riskEvents
);

const failedChecks = Object.entries(report.checks).filter((entry) => !entry[1]);
if (failedChecks.length) {
  console.error("Failed checks:", failedChecks.map((entry) => entry[0]).join(", "));
  process.exitCode = 1;
}
