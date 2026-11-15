import { WORLD, clamp } from "./config.js";
import { RescueSimulation } from "./simulation.js";
import { SceneRenderer } from "./render.js";
import { IceAudio } from "./audio.js";
import { runFixedSeedMission, validateWrongDetour } from "./validation.js";

const canvas = document.querySelector("#game");
const sim = new RescueSimulation(WORLD.seed);
const renderer = new SceneRenderer(canvas, sim);
const audio = new IceAudio();

const ui = {
  rescueCount: document.querySelector("#rescue-count"),
  pips: [...document.querySelectorAll(".pip")],
  localStress: document.querySelector("#stress-value"),
  stressFill: document.querySelector("#stress-fill"),
  iceReadout: document.querySelector("#ice-readout"),
  mass: document.querySelector("#mass-value"),
  brake: document.querySelector("#brake-value"),
  cracks: document.querySelector("#crack-value"),
  order: document.querySelector("#order-value"),
  support: document.querySelector("#support-value"),
  supportFill: document.querySelector("#support-fill"),
  speed: document.querySelector("#speed-value"),
  speedRing: document.querySelector("#speed-ring-fill"),
  driveState: document.querySelector("#drive-state"),
  gear: document.querySelector("#gear-value"),
  routeHint: document.querySelector("#route-hint"),
  toast: document.querySelector("#toast"),
  intro: document.querySelector("#intro"),
  result: document.querySelector("#result"),
  resultCard: document.querySelector(".result-card"),
  resultEyebrow: document.querySelector("#result-eyebrow"),
  resultTitle: document.querySelector("#result-title"),
  resultCopy: document.querySelector("#result-copy"),
  resultTime: document.querySelector("#result-time"),
  resultOrder: document.querySelector("#result-order"),
  resultCracks: document.querySelector("#result-cracks"),
  mute: document.querySelector("#mute")
};

const keys = { forward: false, reverse: false, left: false, right: false, brake: false };
const touch = { forward: false, reverse: false, left: false, right: false };
let started = false;
let ended = false;
let endTimer = null;
let toastTimer = null;
let lastFrame = performance.now();
let muted = false;

function startGame() {
  if (started) return;
  started = true;
  ui.intro.classList.add("hidden");
  audio.start();
  showToast("救援开始 · 控制车速，避免持续振动");
}

function restartGame() {
  clearTimeout(endTimer);
  endTimer = null;
  ended = false;
  started = true;
  sim.reset();
  renderer.waypoint = null;
  ui.result.classList.add("hidden");
  ui.intro.classList.add("hidden");
  audio.start();
  updateUI();
  showToast("同一种子 · 新一局冰情");
}

function showToast(message, type = "normal", duration = 2.3) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.className = `toast show ${type === "danger" ? "danger" : ""}`;
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove("show");
  }, duration * 1000);
}

function controlInput() {
  let drive = 0;
  if (keys.forward || touch.forward) drive = 1;
  if (keys.reverse || touch.reverse) drive = -1;
  let steer = 0;
  if (keys.left || touch.left) steer = -1;
  if (keys.right || touch.right) steer = 1;
  if (steer !== 0 && renderer.waypoint) {
    renderer.waypoint = null;
  }
  if (steer === 0 && renderer.waypoint) {
    steer = sim.setWaypointSteering(renderer.waypoint);
  }
  return {
    drive,
    steer,
    brake: Boolean(keys.brake)
  };
}

function handleEvents(events) {
  for (const event of events) {
    if (event.type === "crack") {
      audio.crack(event.intensity || 0.4);
      renderer.shake = Math.max(renderer.shake, 0.28 + (event.intensity || 0.4) * 0.7);
    } else if (event.type === "pickup") {
      audio.chime("pickup");
      showToast(`${event.message} · 刹车距离增加`);
    } else if (event.type === "safe") {
      audio.chime("safe");
      showToast(event.message);
    } else if (event.type === "warning") {
      audio.alarm();
      showToast(event.message, "danger", 2.8);
    } else if (event.type === "danger") {
      audio.alarm();
      renderer.shake = Math.max(renderer.shake, 0.8);
      showToast(event.message, "danger", 2.2);
    } else if (event.type === "sink") {
      audio.sink();
      showResult("lost");
    } else if (event.type === "win") {
      audio.chime("win");
      showResult("won");
    }
  }
}

function showResult(outcome) {
  if (ended) return;
  ended = true;
  clearTimeout(endTimer);
  const failed = outcome === "lost";
  endTimer = setTimeout(() => {
    const snapshot = sim.snapshot();
    ui.resultCard.classList.toggle("failed", failed);
    ui.resultEyebrow.textContent = failed ? "任务中断 · 车辆失联" : "救援完成 · 全员生还";
    ui.resultTitle.textContent = failed ? "车辆落水" : "白障退散";
    ui.resultCopy.textContent = failed
      ? `冰层在车下塌陷。已安全移交 ${snapshot.safeCount} 人；下一次请避开中央裂隙，并在弱冰区保持低速。`
      : `三名被困人员全部返岸，车辆与冰层均未失稳。固定种子下的每一次选择都已被冰纹记录。`;
    ui.resultTime.textContent = snapshot.elapsedLabel;
    ui.resultOrder.textContent = snapshot.orderNames.join(" → ") || "—";
    ui.resultCracks.textContent = `${Math.round(snapshot.crackGrowth * 0.4)} m`;
    ui.result.classList.remove("hidden");
  }, failed ? 850 : 1050);
}

function updateUI() {
  const snapshot = sim.snapshot();
  const speed = Math.abs(snapshot.vehicle.speed);
  const handling = sim.handling();
  const stress = snapshot.localStress;
  const support = snapshot.support;
  ui.rescueCount.textContent = String(snapshot.safeCount);
  for (const pip of ui.pips) {
    const person = sim.survivors.find((item) => item.id === pip.dataset.person);
    pip.classList.toggle("on", person.status === "aboard");
    pip.classList.toggle("secure", person.status === "safe");
  }
  ui.localStress.textContent = `${Math.round(stress)}%`;
  ui.stressFill.style.width = `${clamp(stress, 0, 100)}%`;
  ui.support.textContent = `${Math.round(support)}%`;
  ui.supportFill.style.width = `${clamp(support, 0, 100)}%`;
  ui.supportFill.classList.toggle("warn", support < 62);
  ui.supportFill.classList.toggle("danger", support < 34);
  ui.mass.textContent = `${sim.getDisplayMass()} t`;
  ui.brake.textContent = `${Math.round(snapshot.brakeDistance * 0.4)} m`;
  ui.cracks.textContent = String(snapshot.crackCount);
  ui.order.textContent = snapshot.orderNames.join(" → ") || "—";
  ui.speed.textContent = String(Math.round(speed * 0.58));
  ui.speedRing.style.strokeDashoffset = String(264 - clamp(speed / handling.maxSpeed, 0, 1) * 264);
  ui.driveState.textContent = sim.getStatusLabel();
  ui.gear.textContent = speed < 1.2 ? "N" : snapshot.vehicle.speed > 0 ? "F" : "R";
  const readout = stress >= 96 ? ["临界", "danger"] : stress >= 82 ? ["危险", "danger"] : stress >= 62 ? ["开裂", "warn"] : ["稳定", ""];
  ui.iceReadout.textContent = readout[0];
  ui.iceReadout.className = `readout ${readout[1]}`;
  if (snapshot.mode === "won") ui.iceReadout.textContent = "返岸";
  ui.routeHint.style.opacity = started && snapshot.mode === "running" && !renderer.waypoint ? "1" : "0";
}

function update(dt) {
  if (started && !ended && sim.mode === "running") {
    const beforeLength = sim.ice.getCrackLength();
    sim.update(dt, controlInput());
    handleEvents(sim.events);
    if (renderer.waypoint && Math.hypot(
      renderer.waypoint.x - sim.vehicle.x,
      renderer.waypoint.y - sim.vehicle.y
    ) < 18) {
      renderer.waypoint = null;
    }
    if (sim.ice.getCrackLength() > beforeLength && audio.started) {
      renderer.shake = Math.max(renderer.shake, 0.1);
    }
    audio.update(sim.snapshot(), sim.vehicle.y < WORLD.shoreY + 4);
  }
  renderer.update(dt);
  renderer.draw();
  updateUI();
}

function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
  lastFrame = now;
  update(dt);
  requestAnimationFrame(frame);
}

function setKey(event, down) {
  const code = event.code;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
    event.preventDefault();
  }
  if (code === "KeyW" || code === "ArrowUp") keys.forward = down;
  if (code === "KeyS" || code === "ArrowDown") keys.reverse = down;
  if (code === "KeyA" || code === "ArrowLeft") keys.left = down;
  if (code === "KeyD" || code === "ArrowRight") keys.right = down;
  if (code === "Space") keys.brake = down;
  if (down && code === "Enter" && !started) startGame();
  if (down && code === "KeyR" && started) restartGame();
  if (down && code === "KeyM") toggleMute();
  if (down && code === "KeyV") {
    const mission = runFixedSeedMission();
    const detour = validateWrongDetour();
    console.info("WHITEOUT seed validation", { mission, detour });
    showToast(`验证完成 · 通关 ${mission.success ? "PASS" : "FAIL"} · 裂纹扩散 ${detour.passed ? "PASS" : "FAIL"}`, "normal", 4);
  }
}

function toggleMute() {
  muted = !muted;
  audio.setMuted(muted);
  ui.mute.textContent = muted ? "音频 关" : "音频 开";
}

document.querySelector("#start-button").addEventListener("click", startGame);
document.querySelector("#restart").addEventListener("click", () => {
  if (!started) {
    startGame();
    return;
  }
  restartGame();
});
ui.mute.addEventListener("click", toggleMute);
document.querySelector("#result-button").addEventListener("click", restartGame);

window.addEventListener("keydown", (event) => setKey(event, true));
window.addEventListener("keyup", (event) => setKey(event, false));
window.addEventListener("blur", () => {
  keys.forward = false;
  keys.reverse = false;
  keys.left = false;
  keys.right = false;
  keys.brake = false;
});
window.addEventListener("resize", () => {
  renderer.resize();
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  renderer.waypoint = null;
});
canvas.addEventListener("pointerdown", (event) => {
  if (!started || sim.mode !== "running" || event.button !== 0) return;
  if (event.pointerType === "touch" && event.clientY > window.innerHeight - 150) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const closest = sim.survivors
    .filter((person) => person.status === "waiting")
    .map((person) => ({ person, distance: Math.hypot(person.x - point.x, person.y - point.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (closest && closest.distance < 70) {
    renderer.waypoint = { x: closest.person.x, y: closest.person.y };
    showToast(`航点锁定 · ${closest.person.name}`);
  } else {
    renderer.waypoint = point;
    showToast("自动转向航点已设定 · 仍需控制油门");
  }
});

for (const button of document.querySelectorAll("[data-control]")) {
  const control = button.dataset.control;
  const set = (down) => {
    if (control === "throttle") touch.forward = down;
    if (control === "brake") touch.reverse = down;
    if (control === "left") touch.left = down;
    if (control === "right") touch.right = down;
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    set(true);
  });
  button.addEventListener("pointerup", () => set(false));
  button.addEventListener("pointercancel", () => set(false));
  button.addEventListener("pointerleave", () => set(false));
}

updateUI();
requestAnimationFrame(frame);

window.__WHITEOUT__ = {
  seed: WORLD.seed,
  sim,
  audio,
  renderer,
  snapshot: () => sim.snapshot(),
  start: startGame,
  restart: restartGame,
  runFixedSeedMission,
  validateWrongDetour,
  setWaypoint: (x, y) => {
    renderer.waypoint = { x, y };
  },
  step: (steps = 1, input = {}) => {
    for (let i = 0; i < steps; i += 1) sim.update(1 / 60, input);
    renderer.draw();
    updateUI();
    return sim.snapshot();
  }
};

console.info(`WHITEOUT // fixed seed ${WORLD.seed} // V runs deterministic validation`);
