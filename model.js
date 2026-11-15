export const PROJECT_VERSION = 1;

export const TRACKS = [
  { key: "x", label: "X", unit: "px", color: "#ff8b65", default: 0 },
  { key: "y", label: "Y", unit: "px", color: "#ff8b65", default: 0 },
  { key: "rotation", label: "旋转", unit: "°", color: "#83a7ff", default: 0 },
  { key: "scaleX", label: "缩放 X", unit: "×", color: "#83a7ff", default: 1 },
  { key: "scaleY", label: "缩放 Y", unit: "×", color: "#83a7ff", default: 1 },
  { key: "opacity", label: "不透明度", unit: "%", color: "#6ee7c7", default: 1 }
];

export const TRACK_MAP = Object.fromEntries(TRACKS.map((track) => [track.key, track]));
export const OBJECT_TYPES = ["group", "rect", "ellipse", "text"];

export const TYPE_DEFAULTS = {
  group: {},
  rect: { width: 160, height: 100, fill: "#ff6b7a", stroke: "transparent", strokeWidth: 0, radius: 14 },
  ellipse: { width: 120, height: 120, fill: "#6ee7c7", stroke: "transparent", strokeWidth: 0, radius: 60 },
  text: { width: 360, height: 90, fill: "#f5f2ed", stroke: "transparent", strokeWidth: 0, radius: 0, text: "New title", fontSize: 60, fontWeight: 800, align: "center" }
};

let idCounter = 0;
export function uid(prefix = "id") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function formatTime(seconds, milliseconds = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const secs = Math.floor(safe % 60).toString().padStart(2, "0");
  const fraction = milliseconds ? Math.floor((safe % 1) * 100).toString().padStart(2, "0") : "";
  return milliseconds ? `${minutes}:${secs}.${fraction}` : `${minutes}:${secs}`;
}

export function makeKeyframe(value, time, ease = "easeInOut") {
  return {
    id: uid("key"),
    time: round(time, 3),
    value,
    ease
  };
}

export function makeObject(type, options = {}) {
  const now = Number(options.time) || 0;
  const duration = Number(options.duration) || 10;
  const defaults = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.rect;
  const object = {
    id: uid("obj"),
    name: options.name || defaultName(type),
    type,
    parentId: options.parentId || null,
    start: 0,
    end: duration,
    visible: true,
    locked: false,
    style: clone(defaults),
    tracks: {}
  };
  const initialX = options.x ?? 0;
  const initialY = options.y ?? 0;
  for (const track of TRACKS) {
    const initial = track.key === "x" ? initialX : track.key === "y" ? initialY : track.default;
    object.tracks[track.key] = [makeKeyframe(initial, now, "easeInOut")];
  }
  return object;
}

export function defaultName(type) {
  return { group: "新建组", rect: "矩形", ellipse: "椭圆", text: "文字" }[type] || "对象";
}

export function getTrack(object, property) {
  return Array.isArray(object?.tracks?.[property]) ? object.tracks[property] : [];
}

export function sortTrack(track) {
  track.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return track;
}

export function findKeyframe(project, objectId, property, keyId) {
  const object = project.objects.find((item) => item.id === objectId);
  if (!object) return null;
  const key = getTrack(object, property).find((item) => item.id === keyId);
  return key ? { object, property, key } : null;
}

export function findKeyframeAt(object, property, time, epsilon = 0.0015) {
  return getTrack(object, property).find((key) => Math.abs(key.time - time) <= epsilon) || null;
}

export function setKeyframe(project, objectId, property, time, value, options = {}) {
  const object = project.objects.find((item) => item.id === objectId);
  if (!object || !TRACK_MAP[property]) return null;
  const safeTime = round(clamp(time, 0, project.duration), 3);
  const track = getTrack(object, property);
  const existing = findKeyframeAt(object, property, safeTime);
  if (existing) {
    existing.value = value;
    if (options.ease) existing.ease = options.ease;
    return existing;
  }
  const key = makeKeyframe(value, safeTime, options.ease || "easeInOut");
  track.push(key);
  sortTrack(track);
  return key;
}

export function removeKeyframe(project, objectId, property, keyId) {
  const object = project.objects.find((item) => item.id === objectId);
  if (!object) return false;
  const track = getTrack(object, property);
  const index = track.findIndex((key) => key.id === keyId);
  if (index < 0 || track.length <= 1) return false;
  track.splice(index, 1);
  return true;
}

export function moveKeyframe(project, objectId, property, keyId, time) {
  const object = project.objects.find((item) => item.id === objectId);
  if (!object) return null;
  const track = getTrack(object, property);
  const key = track.find((item) => item.id === keyId);
  if (!key) return null;
  const safeTime = round(clamp(time, 0, project.duration), 3);
  const collision = track.find((item) => item.id !== keyId && Math.abs(item.time - safeTime) < 0.002);
  if (collision) track.splice(track.indexOf(collision), 1);
  key.time = safeTime;
  sortTrack(track);
  return key;
}

function easeValue(t, ease) {
  if (ease === "linear") return t;
  if (ease === "hold") return 0;
  if (ease === "easeIn") return t * t * t;
  if (ease === "easeOut") return 1 - (1 - t) ** 3;
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function sampleTrack(track, time, fallback = 0) {
  if (!track?.length) return fallback;
  if (time <= track[0].time) return track[0].value;
  if (time >= track[track.length - 1].time) return track[track.length - 1].value;
  let left = track[0];
  let right = track[track.length - 1];
  for (let index = 0; index < track.length - 1; index += 1) {
    if (time >= track[index].time && time <= track[index + 1].time) {
      left = track[index];
      right = track[index + 1];
      break;
    }
  }
  if (left.ease === "hold" || right.time === left.time) return left.value;
  const progress = (time - left.time) / (right.time - left.time);
  const eased = easeValue(progress, left.ease);
  return left.value + (right.value - left.value) * eased;
}

export function getValues(object, time) {
  const values = {};
  for (const track of TRACKS) {
    values[track.key] = sampleTrack(getTrack(object, track.key), time, track.default);
  }
  values.opacity = clamp(values.opacity, 0, 1);
  values.scaleX = values.scaleX || 0.0001;
  values.scaleY = values.scaleY || 0.0001;
  return values;
}

export function getChildren(project, parentId) {
  return project.objects.filter((object) => object.parentId === parentId);
}

export function getDescendantIds(project, objectId) {
  const result = [];
  const visit = (id) => {
    for (const child of project.objects) {
      if (child.parentId === id) {
        result.push(child.id);
        visit(child.id);
      }
    }
  };
  visit(objectId);
  return result;
}

export function getAncestorIds(project, objectId) {
  const result = [];
  let current = project.objects.find((object) => object.id === objectId);
  const seen = new Set();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    result.push(current.parentId);
    current = project.objects.find((object) => object.id === current.parentId);
  }
  return result;
}

export function isDescendant(project, objectId, possibleAncestorId) {
  return getAncestorIds(project, objectId).includes(possibleAncestorId);
}

export function deleteObject(project, objectId) {
  const object = project.objects.find((item) => item.id === objectId);
  if (!object) return [];
  const removed = new Set([objectId, ...getDescendantIds(project, objectId)]);
  project.objects = project.objects.filter((item) => !removed.has(item.id));
  return [...removed];
}

export function setParent(project, objectId, parentId, duration = project.duration) {
  const object = project.objects.find((item) => item.id === objectId);
  const parent = project.objects.find((item) => item.id === parentId);
  if (!object) return false;
  if (!parentId) {
    object.parentId = null;
    return true;
  }
  if (!parent || parent.id === object.id || parent.type !== "group") return false;
  if (isDescendant(project, parent.id, object.id)) return false;
  object.parentId = parent.id;
  object.start = clamp(object.start, 0, duration);
  object.end = clamp(object.end, 0, duration);
  return true;
}

export function getObjectTree(project) {
  const byParent = new Map();
  for (const object of project.objects) {
    const list = byParent.get(object.parentId) || [];
    list.push(object);
    byParent.set(object.parentId, list);
  }
  for (const list of byParent.values()) list.reverse();
  return { byParent };
}

export function collectKeyframesInRange(project, start, end) {
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const result = [];
  for (const object of project.objects) {
    for (const track of TRACKS) {
      for (const key of getTrack(object, track.key)) {
        if (key.time >= rangeStart - 0.0001 && key.time <= rangeEnd + 0.0001) {
          result.push({
            objectId: object.id,
            property: track.key,
            relativeTime: round(key.time - rangeStart, 3),
            time: key.time,
            value: key.value,
            ease: key.ease
          });
        }
      }
    }
  }
  return result;
}

export function pasteKeyframes(project, clip, startTime) {
  if (!clip?.length) return 0;
  let count = 0;
  const ids = new Set(project.objects.map((object) => object.id));
  for (const entry of clip) {
    if (!ids.has(entry.objectId)) continue;
    const target = round(clamp(startTime + entry.relativeTime, 0, project.duration), 3);
    setKeyframe(project, entry.objectId, entry.property, target, entry.value, { ease: entry.ease });
    count += 1;
  }
  return count;
}

export function keyframeTimes(object) {
  const times = new Map();
  for (const track of TRACKS) {
    for (const key of getTrack(object, track.key)) {
      const bucket = times.get(key.time) || [];
      bucket.push(track.key);
      times.set(key.time, bucket);
    }
  }
  return [...times.entries()].sort((a, b) => a[0] - b[0]);
}

export function countKeyframes(project) {
  return project.objects.reduce(
    (total, object) => total + TRACKS.reduce((sum, track) => sum + getTrack(object, track.key).length, 0),
    0
  );
}

export function normalizeTrack(rawTrack, fallback, duration) {
  if (!Array.isArray(rawTrack)) return [];
  const seen = new Set();
  const keys = [];
  for (const raw of rawTrack) {
    if (!raw || typeof raw !== "object") continue;
    const time = Number(raw.time);
    const value = Number(raw.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    const safeTime = round(clamp(time, 0, duration), 3);
    if (seen.has(safeTime)) continue;
    seen.add(safeTime);
    keys.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : uid("key"),
      time: safeTime,
      value,
      ease: ["linear", "easeIn", "easeOut", "easeInOut", "hold"].includes(raw.ease) ? raw.ease : "easeInOut"
    });
  }
  sortTrack(keys);
  if (!keys.length && Number.isFinite(fallback)) keys.push(makeKeyframe(fallback, 0));
  return keys;
}

export function normalizeProject(raw) {
  if (!raw || typeof raw !== "object") throw new Error("工程文件格式无效");
  const duration = clamp(Number(raw.duration) || 10, 0.1, 600);
  const project = {
    version: PROJECT_VERSION,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "未命名工程",
    width: clamp(Math.round(Number(raw.width) || 1280), 64, 4096),
    height: clamp(Math.round(Number(raw.height) || 720), 64, 4096),
    fps: clamp(Math.round(Number(raw.fps) || 30), 1, 60),
    duration,
    background: typeof raw.background === "string" ? raw.background : "#0e111b",
    audio: {
      name: typeof raw.audio?.name === "string" ? raw.audio.name : "",
      dataUrl: typeof raw.audio?.dataUrl === "string" ? raw.audio.dataUrl : "",
      beatInterval: clamp(Number(raw.audio?.beatInterval) || 0.5, 0.1, 5),
      offset: clamp(Number(raw.audio?.offset) || 0, -10, 60),
      volume: clamp(Number(raw.audio?.volume) || 0.8, 0, 1)
    },
    objects: []
  };

  const usedIds = new Set();
  for (const rawObject of Array.isArray(raw.objects) ? raw.objects : []) {
    if (!rawObject || typeof rawObject !== "object") continue;
    let id = typeof rawObject.id === "string" && rawObject.id ? rawObject.id : uid("obj");
    if (usedIds.has(id)) id = uid("obj");
    usedIds.add(id);
    const type = OBJECT_TYPES.includes(rawObject.type) ? rawObject.type : "rect";
    const object = {
      id,
      name: typeof rawObject.name === "string" && rawObject.name.trim() ? rawObject.name.trim() : defaultName(type),
      type,
      parentId: typeof rawObject.parentId === "string" ? rawObject.parentId : null,
      start: clamp(Number(rawObject.start) || 0, 0, duration),
      end: clamp(Number.isFinite(Number(rawObject.end)) ? Number(rawObject.end) : duration, 0, duration),
      visible: rawObject.visible !== false,
      locked: rawObject.locked === true,
      style: { ...clone(TYPE_DEFAULTS[type]), ...(rawObject.style && typeof rawObject.style === "object" ? rawObject.style : {}) },
      tracks: {}
    };
    if (object.end < object.start) [object.start, object.end] = [object.end, object.start];
    for (const track of TRACKS) {
      object.tracks[track.key] = normalizeTrack(rawObject.tracks?.[track.key], track.default, duration);
    }
    for (const field of ["width", "height", "strokeWidth", "radius", "fontSize"]) {
      if (field in object.style) object.style[field] = clamp(Number(object.style[field]) || 0, 0, 100000);
    }
    project.objects.push(object);
  }

  const byId = new Map(project.objects.map((object) => [object.id, object]));
  const originalParents = new Map(project.objects.map((object) => [object.id, object.parentId]));
  for (const object of project.objects) {
    if (!object.parentId) continue;
    const seen = new Set([object.id]);
    let currentId = object.parentId;
    let valid = true;
    while (currentId) {
      if (seen.has(currentId)) {
        valid = false;
        break;
      }
      seen.add(currentId);
      const parent = byId.get(currentId);
      if (!parent || parent.type !== "group") {
        valid = false;
        break;
      }
      currentId = originalParents.get(currentId) || null;
    }
    if (!valid) object.parentId = null;
  }

  return project;
}

export function projectSummary(project) {
  return {
    objects: project.objects.length,
    keyframes: countKeyframes(project),
    groups: project.objects.filter((object) => object.type === "group").length,
    beats: Math.ceil((project.duration - project.audio.offset) / project.audio.beatInterval)
  };
}
