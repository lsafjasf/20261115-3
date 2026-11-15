// app.js — interactive isometric city viewer/editor (browser).
(function () {
  "use strict";
  const C = window.IsoCity;
  const canvas = document.getElementById("view");
  const ctx = canvas.getContext("2d");
  const ui = {
    seed: document.getElementById("seed"),
    size: document.getElementById("size"),
    regen: document.getElementById("regen"),
    selInfo: document.getElementById("selInfo"),
    height: document.getElementById("height"),
    roof: document.getElementById("roof"),
    exportPng: document.getElementById("exportPng"),
    exportJson: document.getElementById("exportJson"),
    importJson: document.getElementById("importJson"),
  };

  const state = {
    params: { seed: 20261115, size: 8, overrides: {} },
    theta: Math.PI / 4 + 0.4,
    selected: null, // "x,y"
    scale: 44,
    faces: [],
  };

  function city() {
    return C.resolveCity(state.params);
  }

  function hsl(c) {
    return `hsl(${c.h} ${c.s}% ${c.l}%)`;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
  }

  function projectGround(x, y, theta, s) {
    const [rx, ry] = C.rotate(x, y, theta);
    return [(rx - ry) * Math.cos(Math.PI / 6) * s, (rx + ry) * Math.sin(Math.PI / 6) * s];
  }

  function render() {
    const c = city();
    state.faces = C.projectCity(c, state.theta, state.scale);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = "#14181f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / devicePixelRatio / 2;
    const cy = canvas.height / devicePixelRatio / 2;
    ctx.save();
    ctx.translate(cx, cy);
    // ground grid
    ctx.strokeStyle = "#232b38";
    const n = state.params.size;
    const half = n / 2;
    for (let i = 0; i <= n; i++) {
      const a = projectGround(i - half, -half, state.theta, state.scale);
      const b = projectGround(i - half, half, state.theta, state.scale);
      const d = projectGround(-half, i - half, state.theta, state.scale);
      const e = projectGround(half, i - half, state.theta, state.scale);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.moveTo(d[0], d[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.stroke();
    }
    // faces back-to-front
    for (const f of state.faces) {
      ctx.beginPath();
      f.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = hsl(f.color);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.25)";
      ctx.stroke();
    }
    // selection outline
    if (state.selected) {
      const [sx, sy] = state.selected.split(",").map(Number);
      for (const f of state.faces) {
        if (f.building.x !== sx || f.building.y !== sy) continue;
        ctx.beginPath();
        f.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.strokeStyle = "#4da3ff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    ctx.restore();
  }

  // --- interaction -------------------------------------------------------
  let drag = null;
  canvas.addEventListener("pointerdown", (ev) => {
    drag = { x: ev.clientX, theta: state.theta, moved: false };
    canvas.classList.add("dragging");
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    state.theta = drag.theta + dx * 0.008; // occlusion order re-sorts every frame
    render();
  });
  canvas.addEventListener("pointerup", (ev) => {
    canvas.classList.remove("dragging");
    if (drag && !drag.moved) pick(ev);
    drag = null;
  });

  function pointInPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left - r.width / 2;
    const py = ev.clientY - r.top - r.height / 2;
    for (let i = state.faces.length - 1; i >= 0; i--) {
      const f = state.faces[i];
      if (pointInPoly(px, py, f.pts)) {
        select(f.building);
        return;
      }
    }
    select(null);
  }

  function select(b) {
    state.selected = b ? b.x + "," + b.y : null;
    ui.height.disabled = ui.roof.disabled = !b;
    if (b) {
      ui.selInfo.textContent = `(${b.x}, ${b.y}) · ${b.height} 层 · ${b.roof}`;
      ui.height.value = b.height;
      ui.roof.value = b.roof;
    } else {
      ui.selInfo.textContent = "未选中";
    }
    render();
  }

  function selectedBuilding() {
    if (!state.selected) return null;
    const [sx, sy] = state.selected.split(",").map(Number);
    return city().buildings.find((b) => b.x === sx && b.y === sy) || null;
  }

  ui.height.addEventListener("input", () => {
    if (!state.selected) return;
    (state.params.overrides[state.selected] ||= {}).height = Number(ui.height.value);
    select(selectedBuilding());
  });
  ui.roof.addEventListener("change", () => {
    if (!state.selected) return;
    (state.params.overrides[state.selected] ||= {}).roof = ui.roof.value;
    select(selectedBuilding());
  });

  ui.regen.addEventListener("click", () => {
    state.params = {
      seed: Number(ui.seed.value) >>> 0,
      size: Math.max(3, Math.min(16, Number(ui.size.value) | 0)),
      overrides: {},
    };
    select(null);
  });

  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  ui.exportPng.addEventListener("click", () => {
    canvas.toBlob((blob) => download(`city-${state.params.seed}.png`, blob));
  });
  ui.exportJson.addEventListener("click", () => {
    const payload = { ...state.params, buildings: city().buildings };
    download(`city-${state.params.seed}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  });
  ui.importJson.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    state.params = { seed: data.seed >>> 0, size: data.size | 0, overrides: data.overrides || {} };
    ui.seed.value = state.params.seed;
    ui.size.value = state.params.size;
    select(null);
  });

  window.addEventListener("resize", () => { resize(); render(); });
  resize();
  render();
})();
