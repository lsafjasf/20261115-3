// Pure spatial engine: no DOM, no Web Audio.
// Given a LoopPath, sources and per-segment settings it produces per-frame
// telemetry (listener position, per-source pan/gain) and segment parameters.
// The same module drives the browser graph and the Node verification render.

import { LoopPath } from "./path.js";

export const DEFAULT_SEGMENTS = {
  // One entry per control point / spline span.
  ambient: "wind",
  attenuation: 0.5, // 0..1, higher = sounds die off faster with distance
  reverb: 0.25, // wet mix 0..1
};

const smoothstep = (x) => x * x * (3 - 2 * x);

// Exponential smoothing keeps a unit vector normalized; used for the listener
// heading so a sharp user-drawn corner never produces an abrupt pan jump.
function smoothHeading(prev, target, alpha) {
  let hx = prev.x + (target.x - prev.x) * alpha;
  let hy = prev.y + (target.y - prev.y) * alpha;
  const len = Math.hypot(hx, hy) || 1;
  hx /= len;
  hy /= len;
  return { x: hx, y: hy };
}

export class PlaybackEngine {
  constructor(path, sources, segments, options = {}) {
    if (!(path instanceof LoopPath)) path = new LoopPath(path);
    this.path = path;
    this.sources = sources.map((s) => ({ ...s }));
    this.segments = segments.map((s) => ({ ...DEFAULT_SEGMENTS, ...s }));
    this.speed = options.speed ?? 0.04; // fraction of the loop per second
    this.headingAlpha = options.headingAlpha ?? 0.12;
    this.radius = options.radius ?? 320; // distance where gain reaches ~0
    // Half-width of the crossfade around each segment boundary, in u units.
    // Wide enough to span many update frames at normal playback speed.
    this.segmentFade = options.segmentFade ?? 0.04;
    // Per-source unwrapped azimuth. atan2 wraps at +/-pi (directly behind
    // the listener); unwrapping makes the pan cross that point continuously
    // instead of jumping from one ear to the other at a corner.
    this._azimuth = this.sources.map(() => null);
    this._lastAngle = this.sources.map(() => 0);
    this.reset();
  }

  reset() {
    this.u = 0;
    this.playing = false;
    this.elapsed = 0;
    const h = this.path.headingAt(0);
    this.heading = { ...h };
    if (this._azimuth) {
      this._azimuth = this.sources.map(() => null);
      this._lastAngle = this.sources.map(() => 0);
    }
  }

  play() {
    this.playing = true;
  }

  pause() {
    // Freezing the flag is enough: update() no longer advances u, heading or
    // gains while paused, so pan and intensity stay exactly where they were.
    this.playing = false;
  }

  seek(u) {
    this.u = LoopPath.wrap(u);
    this.heading = this.path.headingAt(this.u);
    this._azimuth = this.sources.map(() => null);
  }

  // Distance attenuation shared by the browser graph and the offline render.
  // Smooth (linear-in-distance gain) so a source never clicks in/out.
  static reach(radius, attenuation) {
    return radius * (1.6 - attenuation); // strong attenuation -> short reach
  }

  // Gain from distance against an explicit reach, so the caller can smooth
  // reach across segment boundaries instead of hard-switching it.
  static attenuationGain(distance, radius, attenuationOrReach, isReach = false) {
    const reach = isReach
      ? attenuationOrReach
      : PlaybackEngine.reach(radius, attenuationOrReach);
    if (distance >= reach) return 0;
    const g = 1 - distance / reach;
    return g * g * (3 - 2 * g); // smoothstep
  }

  // Raw wrapped azimuth in [-pi, pi]. >0 means the source is on the left.
  static azimuth(listener, heading, source) {
    const vx = source.x - listener.x;
    const vy = source.y - listener.y;
    const dist = Math.hypot(vx, vy) || 1;
    const fx = vx / dist;
    const fy = vy / dist;
    const dot = Math.max(-1, Math.min(1, fx * heading.x + fy * heading.y));
    const cross = heading.x * fy - heading.y * fx; // >0: source on the left
    return { angle: Math.atan2(cross, dot), dist };
  }

  unwrappedAzimuth(index, wrapped) {
    const prev = this._azimuth[index];
    if (prev === null) {
      this._azimuth[index] = wrapped;
      this._lastAngle[index] = wrapped;
      return wrapped;
    }
    let delta = wrapped - this._lastAngle[index];
    if (delta > Math.PI) delta -= 2 * Math.PI;
    else if (delta < -Math.PI) delta += 2 * Math.PI;
    const next = prev + delta;
    this._azimuth[index] = next;
    this._lastAngle[index] = wrapped;
    return next;
  }

  static equalPower(pan) {
    const theta = ((pan + 1) / 2) * (Math.PI / 2);
    return { left: Math.cos(theta), right: Math.sin(theta) };
  }

  // Crossfaded parameters of the segment active at u.
  segmentAt(u) {
    const n = this.segments.length;
    const pos = LoopPath.wrap(u) * n;
    const i = Math.floor(pos) % n;
    const local = pos - Math.floor(pos);
    const cur = this.segments[i];
    const next = this.segments[(i + 1) % n];
    const fade = this.segmentFade * n;
    // We blend across each boundary: at the start of segment i we fade from
    // the previous segment, at the end we fade into the next segment.
    // Boundary weight is 0.5 from either side -> no step on an index flip.
    let neighbor;
    let edge;
    if (local <= 0.5) {
      neighbor = this.segments[(i - 1 + n) % n];
      edge = local; // 0 on the leading boundary, fade zone width `fade`
    } else {
      neighbor = next;
      edge = 1 - local; // 0 on the trailing boundary
    }
    const t = Math.max(0, Math.min(1, edge / fade));
    const w = 0.5 + 0.5 * smoothstep(t);
    const mix = (key) => cur[key] * w + neighbor[key] * (1 - w);
    return {
      index: i,
      neighborIndex: this.segments.indexOf(neighbor),
      blend: w,
      ambient: cur.ambient,
      ambientGain: w,
      nextAmbient: neighbor.ambient,
      attenuation: mix("attenuation"),
      reverb: mix("reverb"),
    };
  }

  // Advance the clock. When paused, telemetry is returned but nothing moves.
  update(dtSeconds) {
    if (this.playing && dtSeconds > 0) {
      this.u = LoopPath.wrap(this.u + this.speed * dtSeconds);
      this.elapsed += dtSeconds;
      const target = this.path.headingAt(this.u);
      this.heading = smoothHeading(this.heading, target, this.headingAlpha);
    }
    return this.frame();
  }

  frame() {
    const listener = this.path.pointAt(this.u);
    const segment = this.segmentAt(this.u);
    // Smooth the effective reach across the boundary: the blend weight is 0.5
    // exactly on the boundary, so gain cannot step when the index flips.
    const curSegment = this.segments[segment.index];
    const nextSegment = this.segments[segment.neighborIndex];
    // Weight the raw reaches with the exact same weights as segmentAt()
    // (0.5/0.5 on a boundary), so gain cannot step at a segment flip.
    const w = segment.blend;
    const reach =
      PlaybackEngine.reach(this.radius, curSegment.attenuation) * w +
      PlaybackEngine.reach(this.radius, nextSegment.attenuation) * (1 - w);
    const sources = this.sources.map((source, idx) => {
      const { angle: wrapped, dist } = PlaybackEngine.azimuth(
        listener,
        this.heading,
        source
      );
      const angle = this.unwrappedAzimuth(idx, wrapped);
      // Smooth saturation (instead of a hard clamp): the image reaches an
      // ear asymptotically behind the listener without freezing, and it
      // stays continuous because it is built from the unwrapped azimuth.
      const x = angle / Math.PI;
      const pan = x / (1 + Math.abs(x));
      const gain = PlaybackEngine.attenuationGain(dist, this.radius, reach, true);
      const stereo = PlaybackEngine.equalPower(pan);
      return {
        id: source.id,
        pan,
        angle,
        wrappedAngle: wrapped,
        distance: dist,
        gain,
        stereo,
      };
    });
    return {
      u: this.u,
      elapsed: this.elapsed,
      playing: this.playing,
      listener,
      heading: { ...this.heading },
      segment,
      sources,
    };
  }
}
