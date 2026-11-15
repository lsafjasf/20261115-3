import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

export const MATERIALS = {
  obsidian: {
    label: "黑曜石",
    code: "OBSIDIAN",
    color: 0x24252a,
    metalness: 0.48,
    roughness: 0.18,
    envMapIntensity: 1.65,
  },
  bronze: {
    label: "古铜",
    code: "BRONZE",
    color: 0xa76637,
    metalness: 0.82,
    roughness: 0.3,
    envMapIntensity: 1.35,
  },
  jade: {
    label: "翡翠",
    code: "JADE",
    color: 0x4d8970,
    metalness: 0.18,
    roughness: 0.34,
    envMapIntensity: 1.15,
  },
};

function bladeGeometry() {
  const outline = [
    [0.8, 0.22],
    [1.43, 0.34],
    [2.36, 0.025],
    [1.43, -0.34],
    [0.8, -0.22],
    [1.08, 0],
  ];
  const points = [];

  for (const thickness of [-0.075, 0.075]) {
    for (const [x, z] of outline) {
      points.push(new THREE.Vector3(x, thickness, z));
    }
  }

  return new ConvexGeometry(points);
}

function createBodyMaterial(key) {
  const definition = MATERIALS[key];
  return new THREE.MeshStandardMaterial({
    color: definition.color,
    metalness: definition.metalness,
    roughness: definition.roughness,
    envMapIntensity: definition.envMapIntensity,
    flatShading: true,
  });
}

function createStoneMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x171814,
    roughness: 0.78,
    metalness: 0.08,
    flatShading: true,
  });
}

function markShadows(object) {
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function createPedestal(accentMaterial, stoneMaterial) {
  const group = new THREE.Group();

  const base = markShadows(
    new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.62, 0.18, 10), stoneMaterial),
  );
  base.position.y = 0.09;
  group.add(base);

  const column = markShadows(
    new THREE.Mesh(new THREE.CylinderGeometry(0.76, 1.04, 0.92, 10), stoneMaterial),
  );
  column.position.y = 0.63;
  group.add(column);

  const cap = markShadows(
    new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.1, 10), stoneMaterial),
  );
  cap.position.y = 1.14;
  group.add(cap);

  const band = markShadows(
    new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.028, 4, 40), accentMaterial),
  );
  band.position.y = 1.2;
  band.rotation.x = Math.PI / 2;
  group.add(band);

  const baseBand = markShadows(
    new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.025, 4, 48), accentMaterial),
  );
  baseBand.position.y = 0.185;
  baseBand.rotation.x = Math.PI / 2;
  group.add(baseBand);

  return group;
}

function createRelic(bodyMaterial, accentMaterial) {
  const relic = new THREE.Group();

  const coreGeometry = new THREE.IcosahedronGeometry(0.93, 1);
  coreGeometry.scale(1.14, 1.28, 0.94);
  coreGeometry.computeVertexNormals();

  const core = markShadows(new THREE.Mesh(coreGeometry, bodyMaterial));
  core.userData.convexSolid = true;
  core.rotation.set(0.17, 0.3, -0.08);
  relic.add(core);

  const coreEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(coreGeometry, 18),
    new THREE.LineBasicMaterial({
      color: 0xd6ad7b,
      transparent: true,
      opacity: 0.2,
    }),
  );
  coreEdges.scale.setScalar(1.001);
  coreEdges.rotation.copy(core.rotation);
  relic.add(coreEdges);

  const finGeometry = bladeGeometry();
  const finCount = 8;
  for (let index = 0; index < finCount; index += 1) {
    const fin = markShadows(new THREE.Mesh(finGeometry, bodyMaterial));
    fin.userData.convexSolid = true;
    fin.rotation.y = (index / finCount) * Math.PI * 2;
    relic.add(fin);
  }

  const orbitA = markShadows(
    new THREE.Mesh(new THREE.TorusGeometry(1.54, 0.066, 4, 56), accentMaterial),
  );
  orbitA.rotation.x = Math.PI / 2;
  relic.add(orbitA);

  const orbitB = markShadows(
    new THREE.Mesh(new THREE.TorusGeometry(1.79, 0.045, 4, 64), accentMaterial),
  );
  orbitB.rotation.set(Math.PI / 2 + 0.52, 0.16, -0.36);
  relic.add(orbitB);

  const studGeometry = new THREE.OctahedronGeometry(0.075, 0);
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
    const stud = markShadows(new THREE.Mesh(studGeometry, accentMaterial));
    stud.userData.convexSolid = true;
    stud.position.set(Math.cos(angle) * 1.54, 0, Math.sin(angle) * 1.54);
    stud.rotation.set(0.3, angle, 0.2);
    relic.add(stud);
  }

  const crown = markShadows(
    new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), accentMaterial),
  );
  crown.position.y = 1.32;
  crown.userData.convexSolid = true;
  crown.rotation.y = Math.PI / 4;
  relic.add(crown);

  const crownGlow = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.075, 0),
    new THREE.MeshBasicMaterial({
      color: 0xffc47b,
      transparent: true,
      opacity: 0.72,
    }),
  );
  crownGlow.position.y = 1.32;
  relic.add(crownGlow);

  const underlight = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 0.94, 32),
    new THREE.MeshBasicMaterial({
      color: 0xe4a66b,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  underlight.rotation.x = -Math.PI / 2;
  underlight.position.y = -1.46;
  relic.add(underlight);

  return { relic, crown, crownGlow };
}

export function createExhibit(initialMaterial = "bronze") {
  const root = new THREE.Group();
  const artifactPivot = new THREE.Group();
  const artifact = new THREE.Group();

  const bodyMaterial = createBodyMaterial(initialMaterial);
  const stoneMaterial = createStoneMaterial();
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xba8150,
    metalness: 0.9,
    roughness: 0.24,
    envMapIntensity: 1.5,
    flatShading: true,
  });

  root.add(createPedestal(accentMaterial, stoneMaterial));

  const relicParts = createRelic(bodyMaterial, accentMaterial);
  const { crown, crownGlow } = relicParts;
  artifact.position.y = 2.52;
  artifact.add(relicParts.relic);
  artifactPivot.add(artifact);
  root.add(artifactPivot);

  const target = {
    color: new THREE.Color(MATERIALS[initialMaterial].color),
    metalness: MATERIALS[initialMaterial].metalness,
    roughness: MATERIALS[initialMaterial].roughness,
    envMapIntensity: MATERIALS[initialMaterial].envMapIntensity,
  };

  let materialKey = initialMaterial;
  let angle = 0;
  let motionTime = 0;

  function setMaterial(key) {
    if (!MATERIALS[key]) return;
    materialKey = key;
    const definition = MATERIALS[key];
    target.color.setHex(definition.color);
    target.metalness = definition.metalness;
    target.roughness = definition.roughness;
    target.envMapIntensity = definition.envMapIntensity;
  }

  function update(delta, running) {
    const ease = 1 - Math.exp(-delta * 7);
    bodyMaterial.color.lerp(target.color, ease);
    bodyMaterial.metalness = THREE.MathUtils.lerp(bodyMaterial.metalness, target.metalness, ease);
    bodyMaterial.roughness = THREE.MathUtils.lerp(bodyMaterial.roughness, target.roughness, ease);
    bodyMaterial.envMapIntensity = THREE.MathUtils.lerp(
      bodyMaterial.envMapIntensity,
      target.envMapIntensity,
      ease,
    );

    if (running) {
      motionTime += delta;
      angle += delta * 0.34;
      artifactPivot.rotation.y = angle;
      artifact.position.y = 2.52 + Math.sin(motionTime * 1.15) * 0.035;
      artifact.rotation.z = Math.sin(motionTime * 0.64) * 0.018;
      crown.rotation.y += delta * 0.55;
      crownGlow.rotation.y -= delta * 0.8;
    }
  }

  function setAngle(value) {
    angle = value;
    artifactPivot.rotation.y = value;
  }

  return {
    root,
    artifact,
    artifactPivot,
    bodyMaterial,
    setMaterial,
    setAngle,
    update,
    get angle() {
      return angle;
    },
    get materialKey() {
      return materialKey;
    },
    get motionTime() {
      return motionTime;
    },
  };
}
