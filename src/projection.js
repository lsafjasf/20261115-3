export const DEFAULT_CAMERA = Object.freeze({ yaw: 0.61, pitch: 0.55, zoom: 1 });

export function clampCamera(camera) {
  return {
    yaw: camera.yaw,
    pitch: Math.min(1.22, Math.max(0.22, camera.pitch)),
    zoom: Math.min(2.2, Math.max(0.62, camera.zoom)),
  };
}

export function projectPoint3D(point, camera, sceneHeight, viewport, zoom = 1) {
  const dx = point.x - viewport.worldCenterX;
  const dz = point.z - viewport.worldCenterZ;
  const dy = point.y - sceneHeight / 2;
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const xView = dx * cosYaw - dz * sinYaw;
  const radial = dx * sinYaw + dz * cosYaw;

  return {
    x: viewport.centerX + xView * viewport.scale * zoom,
    y: viewport.centerY - (dy * cosPitch + radial * sinPitch) * viewport.scale * zoom,
    depth: radial - dy * sinPitch * 0.8,
  };
}

export function fitProjector(width, height, camera, sceneHeight, world) {
  const viewport = {
    centerX: 0,
    centerY: 0,
    scale: 1,
    worldCenterX: world.width / 2,
    worldCenterZ: world.depth / 2,
  };
  const probe = projectPoint3D;
  const cornerPoints = [
    { x: 0, y: 0, z: 0 },
    { x: world.width, y: 0, z: 0 },
    { x: 0, y: 0, z: world.depth },
    { x: world.width, y: 0, z: world.depth },
    { x: 0, y: sceneHeight, z: 0 },
    { x: world.width, y: sceneHeight, z: 0 },
    { x: 0, y: sceneHeight, z: world.depth },
    { x: world.width, y: sceneHeight, z: world.depth },
  ];
  const projected = cornerPoints.map((point) => probe(point, camera, sceneHeight, viewport, 1));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const scale = Math.min(width * 0.8 / (maxX - minX), height * 0.7 / (maxY - minY));

  viewport.scale = Number.isFinite(scale) ? scale : 50;
  viewport.centerX = width / 2 - (minX + maxX) * viewport.scale / 2;
  viewport.centerY = height / 2 - (minY + maxY) * viewport.scale / 2;
  return viewport;
}

export function shade(hex, amount) {
  const value = hex.replace("#", "");
  const number = parseInt(value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  const mix = (channel) => Math.round(Math.min(255, Math.max(0, channel + amount)));
  return `rgb(${mix(red)}, ${mix(green)}, ${mix(blue)})`;
}
