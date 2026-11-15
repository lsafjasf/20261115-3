import {
  clamp,
  mat4LookAt,
  mat4Perspective,
  vec3Normalize,
} from "./math.js";

const DEFAULT_VIEW = Object.freeze({
  yaw: 0.58,
  pitch: 0.34,
  distance: 12.6,
  target: Object.freeze([0, 1.32, 0]),
});

export class OrbitCamera {
  constructor() {
    this.fov = (42 * Math.PI) / 180;
    this.near = 0.1;
    this.far = 70;
    this.restore(DEFAULT_VIEW);
  }

  restore(view) {
    this.yaw = view.yaw;
    this.pitch = view.pitch;
    this.distance = view.distance;
    this.target = [...(view.target || DEFAULT_VIEW.target)];
  }

  rotate(deltaX, deltaY) {
    this.yaw -= deltaX * 0.0062;
    this.pitch = clamp(this.pitch + deltaY * 0.0052, 0.02, 1.24);
  }

  zoom(delta) {
    this.distance = clamp(this.distance * Math.exp(delta * 0.001), 5.4, 25);
  }

  snapshot() {
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      target: [...this.target],
    };
  }

  eye() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    return [
      this.target[0] + Math.sin(this.yaw) * horizontal,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * horizontal,
    ];
  }

  matrices(aspect) {
    const eye = this.eye();
    const view = mat4LookAt(eye, this.target);
    const projection = mat4Perspective(this.fov, aspect, this.near, this.far);
    return {
      eye,
      view,
      projection,
      direction: vec3Normalize([this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]]),
    };
  }
}
