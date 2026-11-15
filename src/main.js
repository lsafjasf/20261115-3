import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TerrainModel, sectionToSVG, TERRAIN_CONFIG } from "./terrain.js";

const model = new TerrainModel();
const state = {
  selected: 5 * model.n + 7,
  cutHeight: 2.1,
  showModel: true,
  dragging: false,
  dragStartY: 0,
  dragStartHeight: 0,
  hovered: null,
  revisionSeen: 0,
  cameraTween: null,
  toastTimer: null,
};

const ui = {
  canvas: document.querySelector("#viewport"),
  headerRevision: document.querySelector("#header-revision"),
  triangleCount: document.querySelector("#stat-triangles"),
  vertexCount: document.querySelector("#stat-vertices"),
  editedCount: document.querySelector("#stat-edited"),
  selectedCoord: document.querySelector("#selected-coord"),
  selectedId: document.querySelector("#selected-id"),
  selectedHeight: document.querySelector("#selected-height"),
  vertexCard: document.querySelector("#vertex-card"),
  heightRange: document.querySelector("#height-range"),
  heightOutput: document.querySelector("#height-output"),
  vertexMinus: document.querySelector("#vertex-minus"),
  vertexPlus: document.querySelector("#vertex-plus"),
  vertexReset: document.querySelector("#vertex-reset"),
  cutRange: document.querySelector("#cut-range"),
  cutValue: document.querySelector("#cut-value"),
  cutReadout: document.querySelector("#cut-readout"),
  sectionReadout: document.querySelector("#section-readout"),
  sectionPreview: document.querySelector("#section-preview"),
  sectionLoops: document.querySelector("#section-loops"),
  sectionLength: document.querySelector("#section-length"),
  sectionArea: document.querySelector("#section-area"),
  toggleModel: document.querySelector("#toggle-model"),
  toggleStatus: document.querySelector(".toggle-status"),
  interactionTip: document.querySelector("#interaction-tip"),
  exportSvg: document.querySelector("#export-svg"),
  exportObj: document.querySelector("#export-obj"),
  exportSvgRow: document.querySelector("#export-svg-row"),
  exportObjRow: document.querySelector("#export-obj-row"),
  lastExport: document.querySelector("#last-export"),
  resetScene: document.querySelector("#reset-scene"),
  toast: document.querySelector("#toast"),
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x08100d, 0.018);

const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 90);
camera.position.set(10.6, 8.6, 12.4);

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x000000, 0);

const controls = new OrbitControls(camera, ui.canvas);
controls.target.set(0, 1.15, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.enablePan = false;
controls.minDistance = 7.8;
controls.maxDistance = 24;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI * 0.475;
controls.rotateSpeed = 0.72;
controls.zoomSpeed = 0.82;
controls.update();

const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.22 };
const pointer = new THREE.Vector2();

const terrainRoot = new THREE.Group();
const modelRoot = new THREE.Group();
const sectionRoot = new THREE.Group();
const controlRoot = new THREE.Group();
terrainRoot.add(modelRoot, sectionRoot, controlRoot);
scene.add(terrainRoot);

const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), state.cutHeight);
const clippingPlanes = [clippingPlane];

const topMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.04,
  flatShading: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
  clippingPlanes,
  clipShadows: true,
});
const sideMaterial = new THREE.MeshStandardMaterial({
  color: 0x344a39,
  emissive: 0x07100a,
  emissiveIntensity: 0.45,
  roughness: 0.95,
  metalness: 0.02,
  flatShading: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
  clippingPlanes,
  clipShadows: true,
});
const baseMaterial = new THREE.MeshStandardMaterial({
  color: 0x101a14,
  roughness: 1,
  metalness: 0,
  side: THREE.DoubleSide,
  clippingPlanes,
  clipShadows: true,
});

const solidMesh = new THREE.Mesh(new THREE.BufferGeometry(), [
  topMaterial,
  sideMaterial,
  baseMaterial,
]);
solidMesh.castShadow = true;
solidMesh.receiveShadow = true;
solidMesh.renderOrder = 1;
modelRoot.add(solidMesh);

const wireMaterial = new THREE.LineBasicMaterial({
  color: 0xcbe8a0,
  transparent: true,
  opacity: 0.23,
  depthWrite: false,
  depthTest: true,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
  clippingPlanes,
});
const wireframe = new THREE.LineSegments(new THREE.BufferGeometry(), wireMaterial);
wireframe.renderOrder = 2;
modelRoot.add(wireframe);

const pointMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: true,
  uniforms: {
    uColor: { value: new THREE.Color(0xd7f875) },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uCutHeight: { value: state.cutHeight },
  },
  vertexShader: `
    uniform float uPixelRatio;
    uniform float uCutHeight;
    varying float vAboveCut;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      float worldY = (modelMatrix * vec4(position, 1.0)).y;
      vAboveCut = step(uCutHeight + 0.03, worldY);
      gl_PointSize = (6.2 - vAboveCut * 1.5) * uPixelRatio * (8.0 / -mvPosition.z);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    varying float vAboveCut;
    void main() {
      float d = distance(gl_PointCoord, vec2(0.5));
      if (d > 0.5) discard;
      float core = smoothstep(0.5, 0.14, d);
      float alpha = mix(0.38 + core * 0.62, 0.08 + core * 0.16, vAboveCut);
      gl_FragColor = vec4(uColor, alpha);
    }
  `,
});
const vertexPoints = new THREE.Points(new THREE.BufferGeometry(), pointMaterial);
vertexPoints.renderOrder = 5;
modelRoot.add(vertexPoints);

const stage = new THREE.Group();
const stageDisc = new THREE.Mesh(
  new THREE.CircleGeometry(8.2, 96),
  new THREE.MeshStandardMaterial({
    color: 0x0c1712,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.68,
  }),
);
stageDisc.rotation.x = -Math.PI / 2;
stageDisc.position.y = TERRAIN_CONFIG.baseY - 0.045;
stageDisc.receiveShadow = true;
stage.add(stageDisc);

const groundGrid = new THREE.GridHelper(16, 16, 0x51705c, 0x20332a);
groundGrid.position.y = TERRAIN_CONFIG.baseY - 0.035;
groundGrid.material.transparent = true;
groundGrid.material.opacity = 0.32;
groundGrid.material.depthWrite = false;
stage.add(groundGrid);

const stageRing = new THREE.Mesh(
  new THREE.RingGeometry(7.9, 7.94, 96),
  new THREE.MeshBasicMaterial({
    color: 0x57745f,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  }),
);
stageRing.rotation.x = -Math.PI / 2;
stageRing.position.y = TERRAIN_CONFIG.baseY - 0.032;
stage.add(stageRing);
scene.add(stage);

const ambient = new THREE.HemisphereLight(0xc5e5d3, 0x101a12, 1.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xf2ffd8, 3.3);
keyLight.position.set(7, 13, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 30;
keyLight.shadow.bias = -0.00045;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x74d8bd, 0.95);
fillLight.position.set(-8, 4, -5);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xd7f875, 18, 18, 2);
rimLight.position.set(0, 5.4, 0.5);
scene.add(rimLight);

const capMaterial = new THREE.MeshBasicMaterial({
  color: 0x3c5330,
  side: THREE.DoubleSide,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const contourMaterial = new THREE.MeshBasicMaterial({ color: 0xd7f875, toneMapped: false });
const contourGlowMaterial = new THREE.MeshBasicMaterial({
  color: 0x9fcf57,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  toneMapped: false,
});

const handle = new THREE.Group();
const handleCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.095, 16, 12),
  new THREE.MeshStandardMaterial({
    color: 0xe5ff98,
    emissive: 0x8aa934,
    emissiveIntensity: 1.8,
    roughness: 0.35,
  }),
);
handle.add(handleCore);

const handleHalo = new THREE.Mesh(
  new THREE.TorusGeometry(0.2, 0.014, 6, 32),
  new THREE.MeshBasicMaterial({
    color: 0xd7f875,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
  }),
);
handleHalo.rotation.x = Math.PI / 2;
handle.add(handleHalo);

const guideGeometry = new THREE.BufferGeometry();
const guideLine = new THREE.Line(
  guideGeometry,
  new THREE.LineDashedMaterial({
    color: 0xb5d98b,
    transparent: true,
    opacity: 0.42,
    dashSize: 0.12,
    gapSize: 0.08,
    depthWrite: false,
    depthTest: true,
  }),
);
handle.add(guideLine);
controlRoot.add(handle);

const colorLow = new THREE.Color(0x27392c);
const colorMid = new THREE.Color(0x53673d);
const colorHigh = new THREE.Color(0x9dae61);
const tempColor = new THREE.Color();

function terrainVertexColor(height) {
  const { max } = model.heightRange();
  const t = THREE.MathUtils.clamp(height / Math.max(0.001, max), 0, 1);
  if (t < 0.58) {
    return tempColor.copy(colorLow).lerp(colorMid, t / 0.58);
  }
  return tempColor.copy(colorMid).lerp(colorHigh, (t - 0.58) / 0.42);
}

function rebuildTerrain() {
  const solid = model.buildSolid();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(solid.positions, 3));

  const colors = new Float32Array(solid.positions.length);
  for (let index = 0; index < solid.positions.length / 3; index += 1) {
    const height = solid.positions[index * 3 + 1];
    const color =
      index < model.vertexCount ? terrainVertexColor(height) : tempColor.setHex(0x344638);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(solid.triangles);
  geometry.computeVertexNormals();

  const materialIndices = { TopSurface: 0, SideWalls: 1, Base: 2 };
  for (const part of solid.parts) {
    geometry.addGroup(part.start * 3, part.count * 3, materialIndices[part.name] ?? 0);
  }

  solidMesh.geometry.dispose();
  solidMesh.geometry = geometry;

  const topPositions = solid.positions.slice(0, model.vertexCount * 3);
  const topIndices = solid.triangles.slice(0, model.topTriangleCount * 3);
  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute("position", new THREE.Float32BufferAttribute(topPositions, 3));
  topGeometry.setIndex(topIndices);
  topGeometry.computeVertexNormals();

  wireframe.geometry.dispose();
  wireframe.geometry = new THREE.WireframeGeometry(topGeometry);

  vertexPoints.geometry.dispose();
  vertexPoints.geometry = topGeometry;

  updateHandle();
  updateInterface();
  updateSection();
}

function updateHandle() {
  const vertex = model.vertexPosition(state.selected);
  handle.position.set(vertex.x, vertex.y, vertex.z);
  guideGeometry.setFromPoints([
    new THREE.Vector3(0, TERRAIN_CONFIG.baseY - vertex.y, 0),
    new THREE.Vector3(0, -0.08, 0),
  ]);
  guideLine.computeLineDistances();
  handle.visible = state.showModel;
}

function updateRangeProgress(input, value, min, max) {
  const progress = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--range-progress", `${THREE.MathUtils.clamp(progress, 0, 100)}%`);
}

function updateInterface() {
  const vertex = model.vertexPosition(state.selected);
  const edited = model.editedVertexCount();
  ui.headerRevision.textContent = `REV ${String(model.revision % 100).padStart(2, "0")}`;
  ui.triangleCount.textContent = String(model.topTriangleCount + model.grid * 8 + 2);
  ui.vertexCount.textContent = String(model.vertexCount);
  ui.editedCount.textContent = String(edited).padStart(2, "0");
  ui.selectedCoord.textContent = `X ${vertex.x.toFixed(1)} / Z ${vertex.z.toFixed(1)}`;
  ui.selectedId.textContent = `V${String(state.selected).padStart(2, "0")}`;
  ui.selectedHeight.textContent = `${vertex.y.toFixed(2)} m`;
  ui.heightRange.value = vertex.y.toFixed(2);
  ui.heightOutput.value = vertex.y.toFixed(2);
  ui.vertexCard.classList.add("has-selection");
  ui.vertexMinus.disabled = false;
  ui.vertexPlus.disabled = false;
  ui.vertexReset.disabled = false;
  updateRangeProgress(
    ui.heightRange,
    vertex.y,
    Number(ui.heightRange.min),
    Number(ui.heightRange.max),
  );

  ui.cutValue.textContent = state.cutHeight.toFixed(2);
  ui.cutReadout.textContent = state.cutHeight.toFixed(2);
  updateRangeProgress(
    ui.cutRange,
    state.cutHeight,
    Number(ui.cutRange.min),
    Number(ui.cutRange.max),
  );
  ui.cutRange.value = state.cutHeight.toFixed(2);
}

function clearSectionGroup() {
  for (const child of [...sectionRoot.children]) {
    child.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
    });
    sectionRoot.remove(child);
  }
}

function updateSection() {
  const section = model.buildSection(state.cutHeight);
  clearSectionGroup();

  for (const polygon of section.polygons) {
    const shape = new THREE.Shape();
    polygon.outer.points.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, point.z);
      else shape.lineTo(point.x, point.z);
    });
    shape.closePath();

    for (const hole of polygon.holes) {
      const path = new THREE.Path();
      hole.points.forEach((point, index) => {
        if (index === 0) path.moveTo(point.x, point.z);
        else path.lineTo(point.x, point.z);
      });
      path.closePath();
      shape.holes.push(path);
    }

    const capGeometry = new THREE.ShapeGeometry(shape, 8);
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.rotation.x = Math.PI / 2;
    cap.position.y = state.cutHeight + 0.012;
    cap.renderOrder = 3;
    sectionRoot.add(cap);
  }

  for (const loop of section.loops) {
    if (loop.points.length < 3) continue;
    const closed = loop.closed && loop.points.length > 2;
    const controlPoints = loop.points.map(
      (point) => new THREE.Vector3(point.x, state.cutHeight + 0.042, point.z),
    );
    const curve = new THREE.CatmullRomCurve3(controlPoints, closed, "centripetal", 0.32);
    const segments = Math.max(24, loop.points.length * 3);

    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, 0.052, 5, closed),
      contourGlowMaterial,
    );
    glow.renderOrder = 4;
    sectionRoot.add(glow);

    const line = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, 0.024, 5, closed),
      contourMaterial,
    );
    line.renderOrder = 5;
    sectionRoot.add(line);
  }

  ui.sectionPreview.innerHTML = sectionToSVG(section, { width: 440, height: 490 });
  ui.sectionLoops.textContent = String(section.loops.length).padStart(2, "0");
  ui.sectionLength.textContent = section.length.toFixed(2);
  ui.sectionArea.textContent = section.area.toFixed(2);
  ui.sectionReadout.textContent = String(section.loops.length).padStart(2, "0");
  ui.sectionPreview.setAttribute(
    "aria-label",
    `高度 ${state.cutHeight.toFixed(2)} 米的截面，共 ${section.loops.length} 条轮廓`,
  );
}

let toastTimer = null;
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("is-visible"), 2600);
}

function setVertexHeight(index, height) {
  if (model.setHeight(index, height)) {
    rebuildTerrain();
    return true;
  }
  updateInterface();
  return false;
}

function selectVertex(index) {
  state.selected = index;
  ui.interactionTip.classList.add("is-hidden");
  updateHandle();
  updateInterface();
  const vertex = model.vertexPosition(index);
  showToast(`已选择 V${String(index).padStart(2, "0")} · 高度 ${vertex.y.toFixed(2)} m`);
}

function setCutHeight(height) {
  state.cutHeight = THREE.MathUtils.clamp(
    Number(height),
    Number(ui.cutRange.min),
    Number(ui.cutRange.max),
  );
  clippingPlane.constant = state.cutHeight;
  pointMaterial.uniforms.uCutHeight.value = state.cutHeight;
  updateInterface();
  updateSection();
  document.querySelectorAll(".cut-presets button").forEach((button) => {
    button.classList.toggle(
      "is-active",
      Math.abs(Number(button.dataset.cut) - state.cutHeight) < 0.011,
    );
  });
}

function downloadText(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getSectionSVG() {
  return sectionToSVG(model.buildSection(state.cutHeight), { width: 1600, height: 1200 });
}

function exportSectionSVG() {
  const svg = getSectionSVG();
  const filename = `terrain-section-y${state.cutHeight.toFixed(2)}-r${String(
    model.revision,
  ).padStart(2, "0")}.svg`;
  downloadText(svg, filename, "image/svg+xml;charset=utf-8");
  ui.lastExport.textContent = `SVG · REV ${String(model.revision).padStart(2, "0")}`;
  showToast(`已导出 ${filename}`);
}

function exportTerrainOBJ() {
  const obj = model.exportOBJ();
  const filename = `terrain-mesh-r${String(model.revision).padStart(2, "0")}.obj`;
  downloadText(obj, filename, "text/plain;charset=utf-8");
  ui.lastExport.textContent = `OBJ · REV ${String(model.revision).padStart(2, "0")}`;
  showToast(`已导出 ${filename} · ${model.topTriangleCount + model.grid * 8 + 2} 三角面`);
}

function toggleModelVisibility() {
  state.showModel = !state.showModel;
  modelRoot.visible = state.showModel;
  handle.visible = state.showModel;
  ui.toggleModel.classList.toggle("is-on", state.showModel);
  ui.toggleModel.classList.toggle("is-off", !state.showModel);
  ui.toggleModel.setAttribute("aria-pressed", String(state.showModel));
  ui.toggleStatus.textContent = state.showModel ? "ON" : "OFF";
  ui.toggleModel.querySelector("span").textContent = state.showModel ? "地形实体" : "实体已隐藏";
  showToast(state.showModel ? "地形实体已显示" : "地形已隐藏 · 切割线保持可见");
}

function flyTo(view) {
  const views = {
    iso: { position: new THREE.Vector3(10.6, 8.6, 12.4), target: new THREE.Vector3(0, 1.15, 0) },
    top: { position: new THREE.Vector3(0.01, 17.8, 0.01), target: new THREE.Vector3(0, 1, 0) },
    front: { position: new THREE.Vector3(0, 4.1, 17.5), target: new THREE.Vector3(0, 1.4, 0) },
  };
  const destination = views[view] ?? views.iso;
  state.cameraTween = {
    start: performance.now(),
    duration: 650,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: destination.position,
    toTarget: destination.target,
  };
  document.querySelectorAll(".view-tool").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
}

function updateCameraTween(now) {
  const tween = state.cameraTween;
  if (!tween) return;
  const raw = Math.min(1, (now - tween.start) / tween.duration);
  const eased = 1 - (1 - raw) ** 3;
  camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
  controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
  if (raw >= 1) state.cameraTween = null;
}

function updatePointer(event) {
  const rect = ui.canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickVertex(event) {
  if (!state.showModel) return null;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(vertexPoints, false);
  return hits.length > 0 ? hits[0].index : null;
}

function vertexScreenPosition(index) {
  const vertex = model.vertexPosition(index);
  const projected = new THREE.Vector3(vertex.x, vertex.y, vertex.z).project(camera);
  const rect = ui.canvas.getBoundingClientRect();
  return {
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projected.y) / 2) * rect.height,
    inView: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z < 1,
  };
}

function handlePointerDown(event) {
  if (event.button !== 0 || !state.showModel) {
    if (event.button === 0) ui.canvas.classList.add("is-dragging");
    return;
  }
  const index = pickVertex(event);
  if (index === null) {
    ui.canvas.classList.add("is-dragging");
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  selectVertex(index);
  state.dragging = true;
  state.dragStartY = event.clientY;
  state.dragStartHeight = model.heights[index];
  controls.enabled = false;
  ui.canvas.classList.add("is-dragging");
  ui.canvas.classList.remove("is-pointing");
  ui.canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (state.dragging) {
    const sensitivity = event.shiftKey ? 0.0038 : 0.014;
    const nextHeight =
      state.dragStartHeight + (state.dragStartY - event.clientY) * sensitivity;
    setVertexHeight(state.selected, nextHeight);
    return;
  }
  if (!state.showModel) return;
  const index = pickVertex(event);
  state.hovered = index;
  ui.canvas.classList.toggle("is-pointing", index !== null && !state.dragging);
}

function handlePointerUp(event) {
  if (state.dragging) {
    state.dragging = false;
    controls.enabled = true;
    if (ui.canvas.hasPointerCapture(event.pointerId)) {
      ui.canvas.releasePointerCapture(event.pointerId);
    }
    const vertex = model.vertexPosition(state.selected);
    showToast(`V${String(state.selected).padStart(2, "0")} → ${vertex.y.toFixed(2)} m`);
  }
  ui.canvas.classList.remove("is-dragging");
}

ui.canvas.addEventListener("pointerdown", handlePointerDown, { capture: true });
ui.canvas.addEventListener("pointermove", handlePointerMove);
ui.canvas.addEventListener("pointerup", handlePointerUp);
ui.canvas.addEventListener("pointercancel", handlePointerUp);
ui.canvas.addEventListener("pointerleave", () => {
  if (!state.dragging) {
    state.hovered = null;
    ui.canvas.classList.remove("is-pointing");
  }
});

ui.heightRange.addEventListener("input", (event) => {
  setVertexHeight(state.selected, Number(event.target.value));
});
ui.heightRange.addEventListener("pointerdown", (event) => event.stopPropagation());
ui.heightRange.addEventListener("click", (event) => event.stopPropagation());

ui.vertexMinus.addEventListener("click", () => {
  setVertexHeight(state.selected, model.heights[state.selected] - 0.1);
});
ui.vertexPlus.addEventListener("click", () => {
  setVertexHeight(state.selected, model.heights[state.selected] + 0.1);
});
ui.vertexReset.addEventListener("click", () => {
  if (model.resetVertex(state.selected)) {
    rebuildTerrain();
    showToast(`V${String(state.selected).padStart(2, "0")} 已还原`);
  }
});

ui.cutRange.addEventListener("input", (event) => setCutHeight(event.target.value));
document.querySelectorAll(".cut-presets button").forEach((button) => {
  button.addEventListener("click", () => setCutHeight(button.dataset.cut));
});

ui.toggleModel.addEventListener("click", toggleModelVisibility);
ui.exportSvg.addEventListener("click", exportSectionSVG);
ui.exportSvgRow.addEventListener("click", exportSectionSVG);
ui.exportObj.addEventListener("click", exportTerrainOBJ);
ui.exportObjRow.addEventListener("click", exportTerrainOBJ);

ui.resetScene.addEventListener("click", () => {
  model.reset();
  state.selected = 5 * model.n + 7;
  state.cutHeight = 2.1;
  rebuildTerrain();
  flyTo("iso");
  showToast("地形已恢复初始状态");
});

document.querySelectorAll(".view-tool").forEach((button) => {
  button.addEventListener("click", () => flyTo(button.dataset.view));
});

document.querySelector("#help-button").addEventListener("click", () => {
  showToast("点击并上下拖动发光顶点；拖动底部滑块可改变剖切高度");
});

window.addEventListener("keydown", (event) => {
  if (!state.selected || event.target instanceof HTMLInputElement) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    setVertexHeight(state.selected, model.heights[state.selected] + direction * 0.06);
  }
});

function resizeRenderer() {
  const container = ui.canvas.parentElement;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  pointMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
}

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(ui.canvas.parentElement);

let startedAt = performance.now();
renderer.setAnimationLoop((now) => {
  updateCameraTween(now);
  controls.update();
  const pulse = 1 + Math.sin((now - startedAt) * 0.0042) * 0.09;
  handleHalo.scale.setScalar(pulse);
  handleHalo.material.opacity = 0.62 + Math.sin((now - startedAt) * 0.0042) * 0.16;
  renderer.render(scene, camera);
});

rebuildTerrain();
resizeRenderer();
updateInterface();
window.setTimeout(() => ui.interactionTip.classList.add("is-hidden"), 9000);

window.terrainApp = {
  model,
  selectVertex,
  setVertexHeight,
  setCutHeight,
  vertexScreenPosition,
  toggleModelVisibility,
  getSection: () => model.buildSection(state.cutHeight),
  getSectionSVG,
  getOBJ: () => model.exportOBJ(),
  exportSectionSVG,
  exportTerrainOBJ,
  getState: () => ({
    selected: state.selected,
    cutHeight: state.cutHeight,
    revision: model.revision,
    editedVertices: model.editedVertexCount(),
    showModel: state.showModel,
    sectionLoops: model.buildSection(state.cutHeight).loops.length,
  }),
  getRenderInfo: () => ({
    doubleSided: [
      topMaterial,
      sideMaterial,
      baseMaterial,
      capMaterial,
    ].every((material) => material.side === THREE.DoubleSide),
    localClipping: renderer.localClippingEnabled,
    modelVisible: modelRoot.visible,
    sectionVisible: sectionRoot.visible,
    sectionObjects: sectionRoot.children.length,
    contourWidth: 0.024,
  }),
};

window.__TERRAIN_READY__ = true;
