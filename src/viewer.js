import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createExhibit, MATERIALS } from "./exhibit.js";

export const LIGHTING_PRESETS = {
  gallery: {
    label: "展厅光",
    background: 0x0b0c0a,
    fog: 0x10110d,
    floor: 0x12130f,
    hemiSky: 0xd6cdb9,
    hemiGround: 0x15130f,
    hemiIntensity: 1.2,
    keyColor: 0xffe5c2,
    keyIntensity: 3.8,
    rimColor: 0xff9b59,
    rimIntensity: 2.15,
    fillColor: 0x8fa9b7,
    fillIntensity: 0.9,
    exposure: 1.08,
  },
  solstice: {
    label: "落日",
    background: 0x150b06,
    fog: 0x1a0d07,
    floor: 0x18100b,
    hemiSky: 0xd19463,
    hemiGround: 0x180b06,
    hemiIntensity: 0.72,
    keyColor: 0xff8d48,
    keyIntensity: 4.6,
    rimColor: 0xffd09b,
    rimIntensity: 2.6,
    fillColor: 0xc2471e,
    fillIntensity: 0.7,
    exposure: 1.02,
  },
  lunar: {
    label: "月相",
    background: 0x060a0f,
    fog: 0x081018,
    floor: 0x0b1117,
    hemiSky: 0x9bb9db,
    hemiGround: 0x060b12,
    hemiIntensity: 0.78,
    keyColor: 0xbcdcff,
    keyIntensity: 3.55,
    rimColor: 0x7d75ff,
    rimIntensity: 2.5,
    fillColor: 0x68cddd,
    fillIntensity: 0.78,
    exposure: 1.06,
  },
};

const toColor = (value) => new THREE.Color(value);

function createStudioFloor() {
  const group = new THREE.Group();

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x12130f,
    roughness: 0.88,
    metalness: 0.04,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const daisMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1b16,
    roughness: 0.68,
    metalness: 0.12,
    flatShading: true,
  });
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.28, 3.42, 0.075, 64), daisMaterial);
  dais.position.y = 0.005;
  dais.receiveShadow = true;
  group.add(dais);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(2.5, 2.515, 96),
    new THREE.MeshBasicMaterial({
      color: 0xc39462,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.048;
  group.add(innerRing);

  const tickMaterial = new THREE.LineBasicMaterial({
    color: 0x9e927f,
    transparent: true,
    opacity: 0.11,
  });
  const tickVertices = [];
  for (let index = 0; index < 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    const start = index % 4 === 0 ? 2.96 : 3.05;
    tickVertices.push(
      Math.cos(angle) * start,
      0.052,
      Math.sin(angle) * start,
      Math.cos(angle) * 3.16,
      0.052,
      Math.sin(angle) * 3.16,
    );
  }
  const tickGeometry = new THREE.BufferGeometry();
  tickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(tickVertices, 3));
  group.add(new THREE.LineSegments(tickGeometry, tickMaterial));

  const backdropMaterial = new THREE.MeshStandardMaterial({
    color: 0x171712,
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide,
  });
  const backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(19, 19, 18, 64, 1, true),
    backdropMaterial,
  );
  backdrop.position.y = 7;
  dais.receiveShadow = true;
  group.add(backdrop);

  return { group, floorMaterial, backdropMaterial };
}

function configureShadow(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 28;
  light.shadow.camera.left = -7;
  light.shadow.camera.right = 7;
  light.shadow.camera.top = 7;
  light.shadow.camera.bottom = -7;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.025;
}

export class ExhibitViewer {
  constructor(container, { onStateChange = () => {} } = {}) {
    this.container = container;
    this.onStateChange = onStateChange;
    this.lightingKey = "gallery";
    this.turntableRunning = true;
    this.clock = new THREE.Clock();
    this.notifyAccumulator = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(LIGHTING_PRESETS.gallery.background);
    this.scene.fog = new THREE.FogExp2(LIGHTING_PRESETS.gallery.fog, 0.032);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(5.85, 3.45, 8.25);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHTING_PRESETS.gallery.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.9, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 5.6;
    this.controls.maxDistance = 16;
    this.controls.minPolarAngle = 0.52;
    this.controls.maxPolarAngle = 1.5;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.75;
    this.controls.update();

    const studio = createStudioFloor();
    this.floorMaterial = studio.floorMaterial;
    this.backdropMaterial = studio.backdropMaterial;
    this.scene.add(studio.group);

    this.hemisphere = new THREE.HemisphereLight(0xd6cdb9, 0x15130f, 1.2);
    this.scene.add(this.hemisphere);

    this.keyLight = new THREE.DirectionalLight(0xffe5c2, 3.8);
    this.keyLight.position.set(-4.5, 7.2, 4.8);
    this.keyLight.target.position.set(0, 1.7, 0);
    configureShadow(this.keyLight);
    this.scene.add(this.keyLight, this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0xff9b59, 2.15);
    this.rimLight.position.set(4.2, 4.8, -5.5);
    this.rimLight.target.position.set(0, 2.1, 0);
    this.scene.add(this.rimLight, this.rimLight.target);

    this.fillLight = new THREE.DirectionalLight(0x8fa9b7, 0.9);
    this.fillLight.position.set(5.4, 2.5, 3.6);
    this.fillLight.target.position.set(0, 1.8, 0);
    this.scene.add(this.fillLight, this.fillLight.target);

    this.exhibit = createExhibit("bronze");
    this.scene.add(this.exhibit.root);

    this.lightTargets = this.createLightingTargets("gallery");
    this.resize = this.resize.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.animate);
  }

  createLightingTargets(key) {
    const preset = LIGHTING_PRESETS[key];
    return {
      background: toColor(preset.background),
      fog: toColor(preset.fog),
      floor: toColor(preset.floor),
      hemiSky: toColor(preset.hemiSky),
      hemiGround: toColor(preset.hemiGround),
      hemiIntensity: preset.hemiIntensity,
      keyColor: toColor(preset.keyColor),
      keyIntensity: preset.keyIntensity,
      rimColor: toColor(preset.rimColor),
      rimIntensity: preset.rimIntensity,
      fillColor: toColor(preset.fillColor),
      fillIntensity: preset.fillIntensity,
      exposure: preset.exposure,
    };
  }

  setMaterial(key) {
    this.exhibit.setMaterial(key);
    this.notifyState();
  }

  setLighting(key) {
    if (!LIGHTING_PRESETS[key]) return;
    this.lightingKey = key;
    this.lightTargets = this.createLightingTargets(key);
    this.notifyState();
  }

  setTurntable(running) {
    this.turntableRunning = Boolean(running);
    this.notifyState();
  }

  toggleTurntable() {
    this.setTurntable(!this.turntableRunning);
    return this.turntableRunning;
  }

  setAngle(angle) {
    this.exhibit.setAngle(angle);
    this.notifyState();
  }

  notifyState() {
    const angleDegrees = ((THREE.MathUtils.radToDeg(this.exhibit.angle) % 360) + 360) % 360;
    this.onStateChange({
      angleDegrees,
      turntableRunning: this.turntableRunning,
      materialKey: this.exhibit.materialKey,
      lightingKey: this.lightingKey,
    });
  }

  updateLighting(delta) {
    const target = this.lightTargets;
    const ease = 1 - Math.exp(-delta * 3.6);

    this.scene.background.lerp(target.background, ease);
    this.scene.fog.color.lerp(target.fog, ease);
    this.floorMaterial.color.lerp(target.floor, ease);
    this.backdropMaterial.color.lerp(target.floor, ease);

    this.hemisphere.color.lerp(target.hemiSky, ease);
    this.hemisphere.groundColor.lerp(target.hemiGround, ease);
    this.hemisphere.intensity = THREE.MathUtils.lerp(
      this.hemisphere.intensity,
      target.hemiIntensity,
      ease,
    );

    this.keyLight.color.lerp(target.keyColor, ease);
    this.keyLight.intensity = THREE.MathUtils.lerp(
      this.keyLight.intensity,
      target.keyIntensity,
      ease,
    );
    this.rimLight.color.lerp(target.rimColor, ease);
    this.rimLight.intensity = THREE.MathUtils.lerp(
      this.rimLight.intensity,
      target.rimIntensity,
      ease,
    );
    this.fillLight.color.lerp(target.fillColor, ease);
    this.fillLight.intensity = THREE.MathUtils.lerp(
      this.fillLight.intensity,
      target.fillIntensity,
      ease,
    );
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(
      this.renderer.toneMappingExposure,
      target.exposure,
      ease,
    );
  }

  animate() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.exhibit.update(delta, this.turntableRunning);
    this.updateLighting(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.notifyAccumulator += delta;
    if (this.notifyAccumulator > 0.12) {
      this.notifyAccumulator = 0;
      this.notifyState();
    }
  }

  async captureImage() {
    const wasRunning = this.turntableRunning;
    if (wasRunning) this.setTurntable(false);

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    this.renderer.render(this.scene, this.camera);

    const source = this.renderer.domElement;
    const maxWidth = 2560;
    const scale = Math.min(1, maxWidth / source.width);
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;

    const context = output.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);

    const gradient = context.createLinearGradient(0, height * 0.68, 0, height);
    gradient.addColorStop(0, "rgba(5, 6, 5, 0)");
    gradient.addColorStop(1, "rgba(5, 6, 5, 0.58)");
    context.fillStyle = gradient;
    context.fillRect(0, height * 0.68, width, height * 0.32);

    const unit = Math.max(10, Math.round(width / 120));
    const margin = unit * 4;
    context.fillStyle = "rgba(232, 229, 218, 0.88)";
    context.font = `500 ${unit}px "DM Mono", monospace`;
    context.letterSpacing = `${Math.round(unit * 0.18)}px`;
    context.fillText("AURELIS / AR-07", margin, height - margin - unit * 2.7);
    context.fillStyle = "rgba(185, 154, 118, 0.9)";
    context.font = `400 ${Math.max(8, unit * 0.72)}px "DM Mono", monospace`;
    context.fillText(
      `${MATERIALS[this.exhibit.materialKey].code}  ·  ${LIGHTING_PRESETS[this.lightingKey].label}`,
      margin,
      height - margin - unit,
    );

    return {
      dataUrl: output.toDataURL("image/png"),
      paused: wasRunning,
      width,
      height,
    };
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
