import { PROJECT_VERSION, TRACKS, makeKeyframe, makeObject, setKeyframe } from "./model.js";

function key(object, property, time, value, ease = "easeInOut") {
  const track = object.tracks[property];
  const existing = track.find((item) => Math.abs(item.time - time) < 0.001);
  if (existing) {
    existing.value = value;
    existing.ease = ease;
    track.sort((a, b) => a.time - b.time);
    return;
  }
  track.push(makeKeyframe(value, time, ease));
  track.sort((a, b) => a.time - b.time);
}

function setStyle(object, style) {
  Object.assign(object.style, style);
  return object;
}

function styleTrackValues(object, values) {
  for (const track of TRACKS) {
    if (track.key in values) key(object, track.key, 0, values[track.key], "easeInOut");
  }
}

export function createDemoProject() {
  const project = {
    version: PROJECT_VERSION,
    name: "Beat Bloom · 10s",
    width: 1280,
    height: 720,
    fps: 30,
    duration: 10,
    background: "#0a0f1d",
    audio: {
      name: "",
      dataUrl: "",
      beatInterval: 0.5,
      offset: 0,
      volume: 0.8
    },
    objects: []
  };
  const add = (object) => {
    project.objects.push(object);
    return object;
  };

  const backdrop = add(makeObject("group", { name: "Backdrop", duration: 10 }));
  add(setStyle(makeObject("rect", { name: "Night Sky", parentId: backdrop.id, x: 640, y: 360, duration: 10 }), {
    width: 1280, height: 720, radius: 0, fill: "#0a0f1d", stroke: "transparent", strokeWidth: 0
  }));
  add(setStyle(makeObject("ellipse", { name: "Blue Aurora", parentId: backdrop.id, x: 640, y: 380, duration: 10 }), {
    width: 900, height: 900, radius: 450, fill: "#15294d", stroke: "transparent", opacity: 0.22
  }));
  add(setStyle(makeObject("ellipse", { name: "Rose Glow", parentId: backdrop.id, x: 280, y: 650, duration: 10 }), {
    width: 780, height: 300, radius: 150, fill: "#ff5b7d", stroke: "transparent", opacity: 0.08
  }));
  add(setStyle(makeObject("rect", { name: "Horizon", parentId: backdrop.id, x: 640, y: 616, duration: 10 }), {
    width: 1280, height: 1, radius: 0, fill: "#446087", stroke: "transparent", strokeWidth: 0, opacity: 0.3
  }));

  const stars = add(makeObject("group", { name: "Star Field", parentId: backdrop.id, x: 640, y: 360, duration: 10 }));
  const starLayout = [
    [-510, -260, 3], [-420, -145, 2], [-335, -305, 4], [-230, -80, 2], [-120, -260, 3],
    [70, -310, 2], [185, -160, 4], [300, -280, 3], [440, -110, 2], [520, -250, 3],
    [-470, 160, 2], [-300, 250, 3], [-80, 170, 2], [120, 255, 3], [350, 180, 2], [500, 235, 3]
  ];
  starLayout.forEach(([x, y, size], index) => {
    const star = add(setStyle(makeObject("ellipse", {
      name: `Star ${String(index + 1).padStart(2, "0")}`,
      parentId: stars.id,
      x,
      y,
      duration: 10
    }), {
      width: size, height: size, radius: size / 2, fill: "#cfe7ff", stroke: "transparent", opacity: 0.35 + (index % 3) * 0.15
    }));
    key(star, "opacity", 0, 0.18 + (index % 4) * 0.08);
    key(star, "opacity", 2 + (index % 5) * 0.6, 0.55);
    key(star, "opacity", 5 + (index % 4) * 0.8, 0.28);
    key(star, "opacity", 10, 0.45);
  });

  const title = add(setStyle(makeObject("text", { name: "Title / PULSE", x: 640, y: 104, duration: 10 }), {
    width: 900, height: 90, text: "PULSE", fontSize: 70, fontWeight: 800, fill: "#f7f2ea", stroke: "transparent", align: "center"
  }));
  key(title, "opacity", 0, 0.92);
  key(title, "opacity", 0.55, 1);
  key(title, "y", 0, 88);
  key(title, "y", 0.8, 104);
  key(title, "opacity", 8.8, 1);
  key(title, "opacity", 10, 0.18);

  const subtitle = add(setStyle(makeObject("text", { name: "Subtitle", x: 640, y: 166, duration: 10 }), {
    width: 800, height: 34, text: "A TEN-SECOND MOTION STUDY", fontSize: 12, fontWeight: 600, fill: "#8fa4c7", stroke: "transparent", align: "center"
  }));
  key(subtitle, "opacity", 0, 0.76);
  key(subtitle, "opacity", 0.9, 0.85);
  key(subtitle, "opacity", 9.3, 0.85);
  key(subtitle, "opacity", 10, 0);

  const rig = add(makeObject("group", { name: "Planet Rig", x: 300, y: 390, duration: 10 }));
  key(rig, "x", 0, 250);
  key(rig, "x", 2.5, 610);
  key(rig, "x", 5, 1000);
  key(rig, "x", 7.5, 675);
  key(rig, "x", 10, 300);
  key(rig, "y", 0, 402);
  key(rig, "y", 2.5, 352);
  key(rig, "y", 5, 400);
  key(rig, "y", 7.5, 338);
  key(rig, "y", 10, 402);
  key(rig, "rotation", 0, -4);
  key(rig, "rotation", 5, 7);
  key(rig, "rotation", 10, -4);

  const halo = add(makeObject("group", { name: "Outer Halo", parentId: rig.id, x: 0, y: 0, duration: 10 }));
  key(halo, "rotation", 0, -25, "linear");
  key(halo, "rotation", 10, 335, "linear");
  add(setStyle(makeObject("ellipse", { name: "Halo Ring", parentId: halo.id, x: 0, y: 0, duration: 10 }), {
    width: 340, height: 340, radius: 170, fill: "transparent", stroke: "#678bb5", strokeWidth: 1, opacity: 0.55
  }));
  add(setStyle(makeObject("ellipse", { name: "Outer Tick", parentId: halo.id, x: 0, y: -170, duration: 10 }), {
    width: 7, height: 18, radius: 3, fill: "#83a7ff", stroke: "transparent", opacity: 0.9
  }));
  add(setStyle(makeObject("ellipse", { name: "Halo Spark", parentId: halo.id, x: 170, y: 0, duration: 10 }), {
    width: 9, height: 9, radius: 5, fill: "#6ee7c7", stroke: "transparent"
  }));

  const orbit = add(makeObject("group", { name: "Counter Orbit", parentId: rig.id, x: 0, y: 0, duration: 10 }));
  key(orbit, "rotation", 0, 0, "linear");
  key(orbit, "rotation", 10, -540, "linear");
  add(setStyle(makeObject("ellipse", { name: "Orbit Path", parentId: orbit.id, x: 0, y: 0, duration: 10 }), {
    width: 520, height: 210, radius: 105, fill: "transparent", stroke: "#ff6b7a", strokeWidth: 1, opacity: 0.26
  }));
  add(setStyle(makeObject("ellipse", { name: "Moon", parentId: orbit.id, x: 260, y: 0, duration: 10 }), {
    width: 52, height: 52, radius: 26, fill: "#ff6b7a", stroke: "#ffd1d6", strokeWidth: 1, fillType: "moon"
  }));
  add(setStyle(makeObject("ellipse", { name: "Moon Shadow", parentId: orbit.id, x: 273, y: -3, duration: 10 }), {
    width: 52, height: 52, radius: 26, fill: "#0a0f1d", stroke: "transparent", strokeWidth: 0
  }));
  add(setStyle(makeObject("rect", { name: "Counterweight", parentId: orbit.id, x: -260, y: 0, duration: 10 }), {
    width: 24, height: 24, radius: 6, fill: "#ffc46b", stroke: "transparent", strokeWidth: 0
  }));

  const core = add(makeObject("group", { name: "Beat Core", parentId: rig.id, x: 0, y: 0, duration: 10 }));
  add(setStyle(makeObject("ellipse", { name: "Core Glow", parentId: core.id, x: 0, y: 0, duration: 10 }), {
    width: 185, height: 185, radius: 93, fill: "#ff6b7a", stroke: "transparent", opacity: 0.13
  }));
  const coreBody = add(setStyle(makeObject("ellipse", { name: "Core Body", parentId: core.id, x: 0, y: 0, duration: 10 }), {
    width: 104, height: 104, radius: 52, fill: "#ff5f73", stroke: "#ffc4ca", strokeWidth: 1
  }));
  for (let beat = 0; beat <= 20; beat += 1) {
    const time = beat * 0.5;
    const downTime = Math.min(10, time + 0.23);
    key(coreBody, "scaleX", time, beat === 20 ? 1 : 1.18, "easeOut");
    key(coreBody, "scaleY", time, beat === 20 ? 1 : 1.18, "easeOut");
    if (downTime < 10) {
      key(coreBody, "scaleX", downTime, 0.94, "easeInOut");
      key(coreBody, "scaleY", downTime, 0.94, "easeInOut");
    }
  }
  const coreRing = add(setStyle(makeObject("ellipse", { name: "Beat Ring", parentId: core.id, x: 0, y: 0, duration: 10 }), {
    width: 130, height: 130, radius: 65, fill: "transparent", stroke: "#ffe2a7", strokeWidth: 1
  }));
  for (let beat = 0; beat <= 19; beat += 1) {
    const time = beat * 0.5;
    key(coreRing, "scaleX", time, 1, "easeOut");
    key(coreRing, "scaleY", time, 1, "easeOut");
    key(coreRing, "opacity", time, 0.7, "easeOut");
    key(coreRing, "scaleX", Math.min(10, time + 0.48), 1.9, "easeOut");
    key(coreRing, "scaleY", Math.min(10, time + 0.48), 1.9, "easeOut");
    key(coreRing, "opacity", Math.min(10, time + 0.48), 0, "easeOut");
  }
  add(setStyle(makeObject("text", { name: "Core Caption", parentId: core.id, x: 0, y: 106, duration: 10 }), {
    width: 180, height: 24, text: "SYNCED / 120 BPM", fontSize: 9, fontWeight: 700, fill: "#ffc9cf", stroke: "transparent", align: "center"
  }));

  const counterRig = add(makeObject("group", { name: "Echo Rig", x: 1000, y: 566, duration: 10 }));
  key(counterRig, "x", 0, 1190);
  key(counterRig, "x", 2.5, 1020);
  key(counterRig, "x", 5, 720);
  key(counterRig, "x", 7.5, 980);
  key(counterRig, "x", 10, 1190);
  key(counterRig, "opacity", 0, 0);
  key(counterRig, "opacity", 1.6, 1);
  key(counterRig, "opacity", 8.7, 1);
  key(counterRig, "opacity", 10, 0);
  const echoOrbit = add(makeObject("group", { name: "Echo Orbit", parentId: counterRig.id, x: 0, y: 0, duration: 10 }));
  key(echoOrbit, "rotation", 0, 0, "linear");
  key(echoOrbit, "rotation", 10, 900, "linear");
  add(setStyle(makeObject("ellipse", { name: "Echo Ring", parentId: echoOrbit.id, x: 0, y: 0, duration: 10 }), {
    width: 170, height: 170, radius: 85, fill: "transparent", stroke: "#6ee7c7", strokeWidth: 1, opacity: 0.5
  }));
  add(setStyle(makeObject("ellipse", { name: "Echo Dot", parentId: echoOrbit.id, x: 85, y: 0, duration: 10 }), {
    width: 12, height: 12, radius: 6, fill: "#6ee7c7", stroke: "transparent"
  }));
  const echoLabel = add(setStyle(makeObject("text", { name: "Echo Label", parentId: counterRig.id, x: 0, y: 104, duration: 10 }), {
    width: 230, height: 28, text: "CHILD OF ECHO RIG", fontSize: 9, fontWeight: 700, fill: "#8fcfc2", stroke: "transparent", align: "center"
  }));
  key(echoLabel, "opacity", 0, 0.65);

  const footer = add(setStyle(makeObject("text", { name: "Footer", x: 640, y: 684, duration: 10 }), {
    width: 700, height: 24, text: "PARENT → CHILD  /  KEYFRAME TIME IS SHARED", fontSize: 9, fontWeight: 600, fill: "#617394", stroke: "transparent", align: "center"
  }));
  key(footer, "opacity", 0, 0.35);
  key(footer, "opacity", 5, 0.65);
  key(footer, "opacity", 10, 0.35);

  return project;
}
