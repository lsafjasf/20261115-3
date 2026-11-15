import { regularPolygon, roundedRectPolygon } from "./geometry.js";

const triangleLocal = [
  [-52, 40],
  [0, -54],
  [58, 33],
];

const capsuleLocal = roundedRectPolygon(0, 0, 96, 54, 26, 5);

const objectDefinitions = [
  {
    id: "prism",
    label: "A",
    name: "Prism",
    kind: "Triangle",
    shape: "triangle",
    x: 438,
    y: 344,
    rotation: -7,
    scale: 1,
    height: 1.15,
    color: "#ff6947",
    localPolygon: triangleLocal,
  },
  {
    id: "orb",
    label: "B",
    name: "Orb",
    kind: "Disc",
    shape: "disc",
    x: 526,
    y: 389,
    rotation: 0,
    scale: 1,
    height: 0.82,
    color: "#5b8ff8",
    localPolygon: regularPolygon(0, 0, 52, 48, 0.2),
  },
  {
    id: "capsule",
    label: "C",
    name: "Capsule",
    kind: "Rounded bar",
    shape: "capsule",
    x: 534,
    y: 252,
    rotation: -24,
    scale: 0.92,
    height: 1.38,
    color: "#d8c938",
    localPolygon: capsuleLocal,
  },
];

const lightDefinitions = [
  {
    id: "key",
    label: "A",
    name: "Key light",
    shortName: "Key",
    x: 150,
    y: 316,
    angle: 4,
    spread: 45,
    range: 650,
    height: 3.5,
    intensity: 72,
    enabled: true,
    color: "#ffb43f",
  },
  {
    id: "fill",
    label: "B",
    name: "Fill light",
    shortName: "Fill",
    x: 218,
    y: 606,
    angle: -54,
    spread: 43,
    range: 610,
    height: 3.3,
    intensity: 56,
    enabled: true,
    color: "#4eb8e8",
  },
  {
    id: "rim",
    label: "C",
    name: "Rim light",
    shortName: "Rim",
    x: 842,
    y: 122,
    angle: 139,
    spread: 38,
    range: 520,
    height: 3.1,
    intensity: 48,
    enabled: false,
    color: "#ed779d",
  },
];

export function createInitialState() {
  return {
    lights: lightDefinitions.map((light) => ({ ...light })),
    objects: objectDefinitions.map((object) => ({
      ...object,
      localPolygon: object.localPolygon.map(([x, y]) => [x, y]),
    })),
    selectedLightId: "key",
    selectedObjectId: "prism",
  };
}

export function cloneState(state) {
  return {
    ...state,
    lights: state.lights.map((light) => ({ ...light })),
    objects: state.objects.map((object) => ({
      ...object,
      localPolygon: object.localPolygon.map(([x, y]) => [x, y]),
    })),
  };
}

export function findLight(state, id) {
  return state.lights.find((light) => light.id === id);
}

export function findObject(state, id) {
  return state.objects.find((object) => object.id === id);
}

export function shapeGlyph(object) {
  if (object.shape === "triangle") {
    return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 18 17H2z"/></svg>';
  }
  if (object.shape === "disc") {
    return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/></svg>';
  }
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="6" width="15" height="8" rx="4"/></svg>';
}
