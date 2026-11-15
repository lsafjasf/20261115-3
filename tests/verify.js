"use strict";

const fs = require("node:fs");
const path = require("node:path");
const S = require("../src/core.js");

async function main() {
  const player = new S.VideoCore({
    frameSource: S.createSyntheticFrameSource()
  });
  const report = await S.runFiveScrubCheck(player);
  const output = {
    generatedAt: new Date().toISOString(),
    ...report
  };
  const artifacts = path.join(__dirname, "..", "artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, "verification.json"), JSON.stringify(output, null, 2));

  console.log(`five-drag check: ${report.passed ? "PASS" : "FAIL"}`);
  console.log(`final frame: #${String(report.finalFrame).padStart(4, "0")}`);
  console.log(`audio time:  ${report.audioTimecode}`);
  console.log(`subtitle:    ${report.subtitle.id} (${report.subtitle.start}s-${report.subtitle.end}s)`);
  console.log(`cancelled:   ${report.abortedRequests} old requests`);
  console.log(`pause freeze: ${report.checks.pausedDoesNotAdvance ? "PASS" : "FAIL"}`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
