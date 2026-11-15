export const SAMPLE_RATE = 48000;
export const SPEED_OF_SOUND = 343;
export const OPENING_HEIGHT = 2.15;
export const HEAD_RADIUS = 0.0875;

export const WALL_INFO = Object.freeze({
  north: { id: "north", axis: "y", side: "north", label: "北墙", short: "N" },
  east: { id: "east", axis: "x", side: "east", label: "东墙", short: "E" },
  south: { id: "south", axis: "y", side: "south", label: "南墙", short: "S" },
  west: { id: "west", axis: "x", side: "west", label: "西墙", short: "W" },
});

export const WALL_ORDER = Object.freeze(["north", "east", "south", "west"]);
export const SOURCE_KINDS = Object.freeze(["clap", "pluck", "noise"]);

export const DEFAULT_PARAMS = Object.freeze({
  width: 6.4,
  depth: 4.8,
  height: 2.9,
  absorption: 0.28,
  openingEnabled: true,
  openingWall: "east",
  openingWidth: 1.9,
  openingOffset: 0.7,
  sourceX: 4.75,
  sourceY: 3.15,
  sourceZ: 1.45,
  listenerX: 1.9,
  listenerY: 1.7,
  listenerZ: 1.2,
  headAngle: 35,
  sourceKind: "clap",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function wallLength(params, wallId) {
  const wall = WALL_INFO[wallId] || WALL_INFO.east;
  return wall.axis === "x" ? params.depth : params.width;
}

export function wallPlane(params, wallId) {
  const wall = WALL_INFO[wallId] || WALL_INFO.east;
  if (wall.axis === "x") {
    return wall.side === "east" ? params.width : 0;
  }
  return wall.side === "south" ? params.depth : 0;
}

export function normalizeParams(input = {}) {
  const merged = { ...DEFAULT_PARAMS, ...input };
  const width = clamp(numberOr(merged.width, DEFAULT_PARAMS.width), 3, 10);
  const depth = clamp(numberOr(merged.depth, DEFAULT_PARAMS.depth), 3, 8);
  const height = clamp(numberOr(merged.height, DEFAULT_PARAMS.height), 2.3, 4.2);
  const openingWall = WALL_INFO[merged.openingWall] ? merged.openingWall : "east";
  const length = openingWall === "east" || openingWall === "west" ? depth : width;
  const openingWidth = clamp(
    numberOr(merged.openingWidth, DEFAULT_PARAMS.openingWidth),
    0.6,
    Math.max(0.6, length * 0.92),
  );
  const maxOffset = Math.max(0, (length - openingWidth) / 2);
  const openingOffset = clamp(
    numberOr(merged.openingOffset, DEFAULT_PARAMS.openingOffset),
    -maxOffset,
    maxOffset,
  );
  const margin = 0.12;

  return {
    width,
    depth,
    height,
    absorption: clamp(numberOr(merged.absorption, DEFAULT_PARAMS.absorption), 0.05, 0.75),
    openingEnabled: Boolean(merged.openingEnabled),
    openingWall,
    openingWidth,
    openingOffset,
    sourceX: clamp(numberOr(merged.sourceX, DEFAULT_PARAMS.sourceX), margin, width - margin),
    sourceY: clamp(numberOr(merged.sourceY, DEFAULT_PARAMS.sourceY), margin, depth - margin),
    sourceZ: clamp(numberOr(merged.sourceZ, DEFAULT_PARAMS.sourceZ), 0.25, height - 0.1),
    listenerX: clamp(numberOr(merged.listenerX, DEFAULT_PARAMS.listenerX), margin, width - margin),
    listenerY: clamp(numberOr(merged.listenerY, DEFAULT_PARAMS.listenerY), margin, depth - margin),
    listenerZ: clamp(numberOr(merged.listenerZ, DEFAULT_PARAMS.listenerZ), 0.25, height - 0.1),
    headAngle: ((numberOr(merged.headAngle, DEFAULT_PARAMS.headAngle) % 360) + 360) % 360,
    sourceKind: SOURCE_KINDS.includes(merged.sourceKind) ? merged.sourceKind : "clap",
  };
}

export function withMode(params, openingEnabled) {
  return normalizeParams({ ...normalizeParams(params), openingEnabled: Boolean(openingEnabled) });
}

export function getOpening(paramsInput) {
  const params = normalizeParams(paramsInput);
  const $ = wallLength(params, params.openingWall);
  const center = $ / 2 + params.openingOffset;
  const start = clamp(center - params.openingWidth / 2, 0, $);
  const end = clamp(center + params.openingWidth / 2, 0, $);
  return {
    wall: params.openingWall,
    axis: WALL_INFO[params.openingWall].axis,
    center,
    start,
    end,
    width: end - start,
    height: Math.min(OPENING_HEIGHT, params.height),
    centerOffset: params.openingOffset,
  };
}

export function getWallSegments(paramsInput, wallId) {
  const params = normalizeParams(paramsInput);
  const opening = getOpening(params);
  const length = wallLength(params, wallId);
  if (wallId !== opening.wall || !params.openingEnabled) {
    return [{ start: 0, end: length }];
  }
  const segments = [];
  if (opening.start > 0.001) segments.push({ start: 0, end: opening.start });
  if (opening.end < length - 0.001) segments.push({ start: opening.end, end: length });
  return segments;
}

export function calculateRoomMetrics(paramsInput, reflectionCount = 0) {
  const params = normalizeParams(paramsInput);
  const { width, depth, height, absorption } = params;
  const volume = width * depth * height;
  const surface = 2 * (width * depth + width * height + depth * height);
  const opening = getOpening(params);
  const openingArea = params.openingEnabled ? opening.width * opening.height : 0;
  const absorptionArea = surface * absorption + openingArea * 0.95;
  const rt60 = (0.161 * volume) / Math.max(absorptionArea, 0.25);
  const meanFreePath = (4 * volume) / surface;
  const schroederFrequency = 2000 * Math.sqrt(rt60 / Math.max(volume, 1));
  const dx = params.sourceX - params.listenerX;
  const dy = params.sourceY - params.listenerY;
  const dz = params.sourceZ - params.listenerZ;
  const directDistance = Math.hypot(dx, dy, dz);

  return {
    volume,
    surface,
    absorptionArea,
    openingArea,
    openingFraction: openingArea / surface,
    rt60,
    meanFreePath,
    schroederFrequency,
    directDistance,
    reflectionCount,
    mode: params.openingEnabled ? "open" : "closed",
  };
}

function hashFNV1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function roomSignature(paramsInput) {
  const p = normalizeParams(paramsInput);
  const relevant = {
    width: round(p.width),
    depth: round(p.depth),
    height: round(p.height),
    absorption: round(p.absorption, 3),
    openingEnabled: p.openingEnabled,
    openingWall: p.openingWall,
    openingWidth: round(p.openingWidth),
    openingOffset: round(p.openingOffset),
    sourceX: round(p.sourceX),
    sourceY: round(p.sourceY),
    sourceZ: round(p.sourceZ),
    listenerX: round(p.listenerX),
    listenerY: round(p.listenerY),
    listenerZ: round(p.listenerZ),
    headAngle: round(p.headAngle, 1),
  };
  return hashFNV1a(JSON.stringify(relevant));
}

export function audioSignature(paramsInput) {
  const p = normalizeParams(paramsInput);
  return hashFNV1a(`${roomSignature(p)}|${p.sourceKind}|${SAMPLE_RATE}`);
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function sourcePoint(params) {
  return { x: params.sourceX, y: params.sourceY, z: params.sourceZ };
}

export function listenerPoint(params) {
  return { x: params.listenerX, y: params.listenerY, z: params.listenerZ };
}

export function wallLabel(wallId) {
  return WALL_INFO[wallId]?.label || wallId;
}

function reflectPoint(point, params, wallId) {
  const axis = WALL_INFO[wallId].axis;
  const plane = wallPlane(params, wallId);
  const reflected = { ...point };
  reflected[axis] = 2 * plane - point[axis];
  return reflected;
}

function intersectWall(image, endpoint, params, wallId) {
  const axis = WALL_INFO[wallId].axis;
  const plane = wallPlane(params, wallId);
  const denominator = endpoint[axis] - image[axis];
  if (Math.abs(denominator) < 1e-9) return null;
  const t = (plane - image[axis]) / denominator;
  if (t < -1e-7 || t > 1 + 1e-7) return null;
  const point = {
    x: image.x + (endpoint.x - image.x) * t,
    y: image.y + (endpoint.y - image.y) * t,
    z: image.z + (endpoint.z - image.z) * t,
  };
  const along = axis === "x" ? point.y : point.x;
  const limit = axis === "x" ? params.depth : params.width;
  if (along < -1e-6 || along > limit + 1e-6) return null;
  if (point.z < -1e-6 || point.z > params.height + 1e-6) return null;
  point[axis] = plane;
  return point;
}

function pointInOpening(params, wallId, point) {
  if (!params.openingEnabled || wallId !== params.openingWall) return false;
  const opening = getOpening(params);
  const along = WALL_INFO[wallId].axis === "x" ? point.y : point.x;
  return (
    along >= opening.start - 1e-6 &&
    along <= opening.end + 1e-6 &&
    point.z >= 0 &&
    point.z <= opening.height + 1e-6
  );
}

function reconstructPath(params, sequence, imagePoint, source, listener) {
  let currentImage = imagePoint;
  let endpoint = listener;
  const reversed = [];

  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    const wallId = sequence[index];
    const hit = intersectWall(currentImage, endpoint, params, wallId);
    if (!hit || pointInOpening(params, wallId, hit)) return null;
    reversed.push(hit);
    currentImage = reflectPoint(currentImage, params, wallId);
    endpoint = hit;
  }

  const gap = Math.hypot(
    currentImage.x - source.x,
    currentImage.y - source.y,
    currentImage.z - source.z,
  );
  if (gap > 1e-5) return null;
  return [source, ...reversed.reverse(), listener];
}

function enumerateImagePaths(params, maxOrder) {
  const source = sourcePoint(params);
  const listener = listenerPoint(params);
  const reflectivity = Math.sqrt(clamp(1 - params.absorption, 0.02, 1));
  const results = [];

  function visit(sequence, imagePoint) {
    if (sequence.length >= maxOrder) return;
    const last = sequence[sequence.length - 1];
    for (const wallId of WALL_ORDER) {
      if (wallId === last) continue;
      const nextSequence = [...sequence, wallId];
      const nextImage = reflectPoint(imagePoint, params, wallId);
      const points = reconstructPath(params, nextSequence, nextImage, source, listener);
      if (points) {
        const distance = Math.hypot(
          nextImage.x - listener.x,
          nextImage.y - listener.y,
          nextImage.z - listener.z,
        );
        const amplitude =
          (reflectivity ** nextSequence.length) / Math.max(distance, 0.45);
        results.push({
          order: nextSequence.length,
          sequence: nextSequence,
          points,
          imagePoint: nextImage,
          distance,
          amplitude,
          reflectivity,
        });
      }
      visit(nextSequence, nextImage);
    }
  }

  visit([], source);
  return results;
}

export function getEarlyReflectionPaths(paramsInput, maxOrder = 2) {
  const params = normalizeParams(paramsInput);
  const source = sourcePoint(params);
  const listener = listenerPoint(params);
  return enumerateImagePaths(params, Math.max(1, Math.min(4, maxOrder)))
    .map((path) => ({
      ...path,
      points: path.points.map((point) => ({ ...point })),
      source,
      listener,
    }))
    .sort((a, b) => a.distance - b.distance);
}

export function buildImageSources(paramsInput, maxOrder = 4) {
  return enumerateImagePaths(normalizeParams(paramsInput), clamp(maxOrder, 1, 5));
}

export function binauralCues(paramsInput, direction) {
  const params = normalizeParams(paramsInput);
  const radians = (params.headAngle * Math.PI) / 180;
  const forward = { x: Math.sin(radians), y: -Math.cos(radians) };
  const right = { x: Math.cos(radians), y: Math.sin(radians) };
  const length = Math.hypot(direction.x, direction.y);
  if (length < 1e-9) {
    return { leftGain: Math.SQRT1_2, rightGain: Math.SQRT1_2, itdSeconds: 0, azimuth: 0 };
  }
  const nx = direction.x / length;
  const ny = direction.y / length;
  const lateral = clamp(nx * right.x + ny * right.y, -1, 1);
  const forwardAmount = nx * forward.x + ny * forward.y;
  const azimuth = Math.atan2(lateral, forwardAmount);
  const pan = clamp(lateral * 0.92, -0.98, 0.98);
  const leftGain = Math.sqrt((1 - pan) / 2);
  const rightGain = Math.sqrt((1 + pan) / 2);
  const itdMagnitude =
    (HEAD_RADIUS / SPEED_OF_SOUND) * (Math.abs(azimuth) + Math.sin(Math.abs(azimuth)));
  const itdSeconds = Math.sign(lateral) * itdMagnitude;
  return {
    leftGain,
    rightGain,
    itdSeconds,
    azimuth: (azimuth * 180) / Math.PI,
    lateral,
  };
}

function deposit(channel, position, value) {
  if (!Number.isFinite(position) || position < 0) return;
  const index = Math.floor(position);
  const fraction = position - index;
  if (index < channel.length) channel[index] += value * (1 - fraction);
  if (index + 1 < channel.length) channel[index + 1] += value * fraction;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromSignature(signature, mode) {
  const text = `${signature}:${mode}:tail`;
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function smoothChannel(channel) {
  let previous = channel[0] || 0;
  for (let index = 1; index < channel.length - 1; index += 1) {
    const current = channel[index];
    channel[index] = previous * 0.16 + current * 0.68 + channel[index + 1] * 0.16;
    previous = current;
  }
}

function writeBinauralEvent(left, right, time, amplitude, cues) {
  const center = time * SAMPLE_RATE;
  const offset = (cues.itdSeconds * SAMPLE_RATE) / 2;
  deposit(left, center + offset, amplitude * cues.leftGain);
  deposit(right, center - offset, amplitude * cues.rightGain);
}

function addDiffuseTail(left, right, params, rt60, duration, signature) {
  const random = mulberry32(seedFromSignature(signature, params.openingEnabled ? "open" : "closed"));
  const startSample = Math.floor(0.018 * SAMPLE_RATE);
  const endSample = Math.min(left.length, Math.floor(duration * SAMPLE_RATE));
  const gain = params.openingEnabled ? 0.072 : 0.082;
  let lowLeft = 0;
  let lowRight = 0;
  let previousLeft = 0;
  let previousRight = 0;

  for (let index = startSample; index < endSample; index += 1) {
    const time = index / SAMPLE_RATE;
    const buildup = 1 - Math.exp(-time / 0.014);
    const decay = Math.exp((-6.907755 * time) / Math.max(rt60, 0.08));
    const envelope = gain * buildup * decay;
    const randomLeft = random() * 2 - 1;
    const randomRight = random() * 2 - 1;
    const common = (randomLeft + randomRight) * 0.5;
    const noiseLeft = common * 0.58 + randomLeft * 0.42;
    const noiseRight = common * 0.58 + randomRight * 0.42;
    lowLeft += 0.23 * (noiseLeft - lowLeft);
    lowRight += 0.23 * (noiseRight - lowRight);
    const highLeft = 0.9 * (lowLeft + noiseLeft - previousLeft);
    const highRight = 0.9 * (lowRight + noiseRight - previousRight);
    previousLeft = noiseLeft;
    previousRight = noiseRight;
    left[index] += (lowLeft * 0.54 + highLeft * 0.46) * envelope;
    right[index] += (lowRight * 0.54 + highRight * 0.46) * envelope;
  }
}

function normalizePeak(left, right, ceiling = 0.96) {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  if (peak <= ceiling || peak === 0) return 1;
  const scale = ceiling / peak;
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= scale;
    right[index] *= scale;
  }
  return scale;
}

export function measureBinaural(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) {
    return {
      leftRms: 0,
      rightRms: 0,
      leftDb: -Infinity,
      rightDb: -Infinity,
      correlation: 0,
      differenceDb: -Infinity,
      maxDifference: 0,
      identical: true,
      passed: false,
    };
  }
  let sumLeft = 0;
  let sumRight = 0;
  let sumProduct = 0;
  let sumDifference = 0;
  let maxDifference = 0;
  let identical = true;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    const difference = l - r;
    sumLeft += l * l;
    sumRight += r * r;
    sumProduct += l * r;
    sumDifference += difference * difference;
    maxDifference = Math.max(maxDifference, Math.abs(difference));
    if (Math.abs(difference) > 1e-10) identical = false;
  }
  const leftRms = Math.sqrt(sumLeft / left.length);
  const rightRms = Math.sqrt(sumRight / right.length);
  const referenceRms = Math.sqrt((sumLeft + sumRight) / (2 * left.length));
  const differenceRms = Math.sqrt(sumDifference / left.length);
  const correlation =
    sumLeft > 0 && sumRight > 0 ? sumProduct / Math.sqrt(sumLeft * sumRight) : 0;
  const differenceDb =
    referenceRms > 0 ? 20 * Math.log10(Math.max(differenceRms, 1e-12) / referenceRms) : -Infinity;
  return {
    leftRms,
    rightRms,
    leftDb: 20 * Math.log10(Math.max(leftRms, 1e-12)),
    rightDb: 20 * Math.log10(Math.max(rightRms, 1e-12)),
    correlation,
    differenceDb,
    maxDifference,
    identical,
    passed: !identical && differenceDb > -30 && correlation < 0.9995,
  };
}

function analyzeEvents(events) {
  let directEnergy = 0;
  let reflectionEnergy = 0;
  let firstOrder = 0;
  let early = 0;
  for (const event of events) {
    const energy = event.amplitude ** 2;
    if (event.order === 0) {
      directEnergy += energy;
    } else {
      reflectionEnergy += energy;
      if (event.order === 1) firstOrder += 1;
      if (event.time <= 0.08) early += 1;
    }
  }
  return {
    directEnergy,
    reflectionEnergy,
    directToReflectedDb:
      10 * Math.log10(Math.max(directEnergy, 1e-12) / Math.max(reflectionEnergy, 1e-12)),
    firstOrder,
    earlyReflections: early,
  };
}

export function generateRoomImpulseResponse(paramsInput, options = {}) {
  const params = normalizeParams(paramsInput);
  const maxOrder = clamp(options.maxOrder ?? 4, 1, 5);
  const paths = enumerateImagePaths(params, maxOrder);
  const metrics = calculateRoomMetrics(params, paths.length);
  const source = sourcePoint(params);
  const listener = listenerPoint(params);
  const signature = roomSignature(params);
  const duration = clamp(Math.max(0.72, metrics.rt60 * 1.85), 0.72, 2.8);
  const sampleCount = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const events = [];

  const directDirection = {
    x: source.x - listener.x,
    y: source.y - listener.y,
  };
  const directCues = binauralCues(params, directDirection);
  const directTime = metrics.directDistance / SPEED_OF_SOUND;
  const directAmplitude = Math.min(1.35, 1 / Math.max(metrics.directDistance, 0.45));
  writeBinauralEvent(left, right, directTime, directAmplitude, directCues);
  events.push({
    order: 0,
    time: directTime,
    distance: metrics.directDistance,
    amplitude: directAmplitude,
    sequence: [],
    cues: directCues,
  });

  for (const path of paths) {
    if (path.distance / SPEED_OF_SOUND >= duration) continue;
    const lastPoint = path.points[path.points.length - 2] || source;
    const cues = binauralCues(params, {
      x: lastPoint.x - listener.x,
      y: lastPoint.y - listener.y,
    });
    const time = path.distance / SPEED_OF_SOUND;
    writeBinauralEvent(left, right, time, path.amplitude, cues);
    events.push({
      order: path.order,
      time,
      distance: path.distance,
      amplitude: path.amplitude,
      sequence: path.sequence,
      cues,
    });
  }

  addDiffuseTail(left, right, params, metrics.rt60, duration, signature);
  smoothChannel(left);
  smoothChannel(right);
  normalizePeak(left, right);

  const analysis = analyzeEvents(events);
  const channelCheck = measureBinaural(left, right);
  const itdMicroseconds = directCues.itdSeconds * 1e6;

  return {
    params,
    left,
    right,
    sampleRate: SAMPLE_RATE,
    duration,
    signature,
    audioSignature: audioSignature(params),
    mode: params.openingEnabled ? "open" : "closed",
    metrics: {
      ...metrics,
      ...analysis,
      itdMicroseconds,
      channelCheck,
    },
    events,
    paths,
  };
}

function fadeEdges(samples, fadeSamples = 180) {
  const count = Math.min(fadeSamples, Math.floor(samples.length / 2));
  for (let index = 0; index < count; index += 1) {
    const amount = index / count;
    samples[index] *= amount;
    samples[samples.length - 1 - index] *= amount;
  }
}

function normalizeMono(samples, peak = 0.68) {
  let maximum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(samples[index]));
  }
  if (maximum === 0) return samples;
  const scale = peak / maximum;
  for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  return samples;
}

function clapSignal(random) {
  const samples = new Float32Array(Math.floor(0.68 * SAMPLE_RATE));
  const bursts = [
    { start: 0.006, gain: 1, decay: 0.023 },
    { start: 0.112, gain: 0.7, decay: 0.021 },
    { start: 0.214, gain: 0.82, decay: 0.026 },
  ];

  for (const burst of bursts) {
    let highpass = 0;
    let lowpass = 0;
    let previous = 0;
    const startSample = Math.floor(burst.start * SAMPLE_RATE);
    const length = Math.floor(0.15 * SAMPLE_RATE);
    for (let offset = 0; offset < length && startSample + offset < samples.length; offset += 1) {
      const time = offset / SAMPLE_RATE;
      const noise = random() * 2 - 1;
      highpass = 0.96 * (highpass + noise - previous);
      lowpass += 0.34 * (highpass - lowpass);
      previous = noise;
      const attack = 1 - Math.exp(-time / 0.0015);
      const envelope = attack * Math.exp(-time / burst.decay);
      const ring =
        0.045 * Math.exp(-time / 0.11) * Math.sin(2 * Math.PI * 2100 * time + burst.start * 5);
      samples[startSample + offset] += (lowpass + ring) * envelope * burst.gain;
    }
  }
  return samples;
}

function pluckSignal(random) {
  const frequency = 220;
  const length = Math.floor(1.5 * SAMPLE_RATE);
  const period = Math.max(8, Math.round(SAMPLE_RATE / frequency));
  const ring = new Float32Array(period);
  for (let index = 0; index < period; index += 1) ring[index] = random() * 2 - 1;
  const samples = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    const current = ring[index % period];
    const next = ring[(index + 1) % period];
    ring[index % period] = 0.497 * (current + next) * 0.9985;
    const body =
      0.1 * Math.sin(2 * Math.PI * frequency * 0.5 * (index / SAMPLE_RATE)) * Math.exp(-(5 * index) / SAMPLE_RATE);
    samples[index] = current * 0.82 + body;
  }
  return samples;
}

function noisePulseSignal(random) {
  const length = Math.floor(0.52 * SAMPLE_RATE);
  const samples = new Float32Array(length);
  let highpass = 0;
  let lowpass = 0;
  let previous = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    highpass = 0.91 * (highpass + noise - previous);
    lowpass += 0.22 * (highpass - lowpass);
    previous = noise;
    const envelope = (1 - Math.exp(-time / 0.002)) * Math.exp(-time / 0.045);
    samples[index] = lowpass * envelope;
  }
  return samples;
}

export function makeDrySignal(kind = "clap", sampleRate = SAMPLE_RATE) {
  const random = mulberry32(0x51f15e);
  let base;
  if (kind === "pluck") base = pluckSignal(random);
  else if (kind === "noise") base = noisePulseSignal(random);
  else base = clapSignal(random);

  let samples = base;
  if (sampleRate !== SAMPLE_RATE) {
    const ratio = sampleRate / SAMPLE_RATE;
    const resampled = new Float32Array(Math.max(1, Math.floor(base.length * ratio)));
    for (let index = 0; index < resampled.length; index += 1) {
      const sourceIndex = index / ratio;
      const lower = Math.floor(sourceIndex);
      const upper = Math.min(base.length - 1, lower + 1);
      const fraction = sourceIndex - lower;
      resampled[index] = base[lower] * (1 - fraction) + base[upper] * fraction;
    }
    samples = resampled;
  }
  normalizeMono(samples, 0.66);
  fadeEdges(samples, 280);
  return {
    samples,
    sampleRate,
    kind: SOURCE_KINDS.includes(kind) ? kind : "clap",
    duration: samples.length / sampleRate,
  };
}

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function fft(real, imaginary, inverse = false) {
  const size = real.length;
  if (size <= 1) return;
  if ((size & (size - 1)) !== 0) throw new Error("FFT size must be a power of two");

  for (let index = 1, reverse = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reverse & bit; bit >>= 1) reverse ^= bit;
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imaginary[index], imaginary[reverse]] = [imaginary[reverse], imaginary[index]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / length;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wr = 1;
      let wi = 0;
      const half = length >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const oddReal = real[oddIndex] * wr - imaginary[oddIndex] * wi;
        const oddImaginary = real[oddIndex] * wi + imaginary[oddIndex] * wr;
        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;
        const nextWr = wr * cosine - wi * sine;
        wi = wr * sine + wi * cosine;
        wr = nextWr;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}

export function convolveStereo(dryInput, leftResponse, rightResponse) {
  const dry = dryInput.samples || dryInput;
  const responsePair =
    leftResponse && leftResponse.left && leftResponse.right ? leftResponse : null;
  const left = responsePair ? responsePair.left : leftResponse.left || leftResponse;
  const right = responsePair ? responsePair.right : (rightResponse?.right || rightResponse || left);
  if (!dry.length || !left.length || !right.length) {
    return { left: new Float32Array(), right: new Float32Array(), sampleRate: SAMPLE_RATE };
  }
  const sampleRate = dryInput.sampleRate || leftResponse.sampleRate || SAMPLE_RATE;
  const outputLength = dry.length + Math.max(left.length, right.length) - 1;
  const fftSize = nextPowerOfTwo(outputLength);
  const dryReal = new Float64Array(fftSize);
  const dryImaginary = new Float64Array(fftSize);
  dryReal.set(dry);
  fft(dryReal, dryImaginary, false);

  const transformAndMultiply = (response) => {
    const real = new Float64Array(fftSize);
    const imaginary = new Float64Array(fftSize);
    real.set(response);
    fft(real, imaginary, false);
    for (let index = 0; index < fftSize; index += 1) {
      const productReal = dryReal[index] * real[index] - dryImaginary[index] * imaginary[index];
      const productImaginary = dryReal[index] * imaginary[index] + dryImaginary[index] * real[index];
      real[index] = productReal;
      imaginary[index] = productImaginary;
    }
    fft(real, imaginary, true);
    return new Float32Array(real.subarray(0, outputLength));
  };

  const stereo = {
    left: transformAndMultiply(left),
    right: transformAndMultiply(right),
    sampleRate,
    duration: outputLength / sampleRate,
  };

  let peak = 0;
  for (let index = 0; index < outputLength; index += 1) {
    peak = Math.max(peak, Math.abs(stereo.left[index]), Math.abs(stereo.right[index]));
  }
  if (peak > 0) {
    const scale = Math.min(1, 0.82 / peak);
    for (let index = 0; index < outputLength; index += 1) {
      stereo.left[index] *= scale;
      stereo.right[index] *= scale;
    }
  }
  return stereo;
}

export function encodeStereoWav(channels, sampleRate = SAMPLE_RATE) {
  if (!channels || channels.length !== 2) throw new Error("WAV export requires two channels");
  const left = channels[0];
  const right = channels[1];
  if (left.length !== right.length) throw new Error("Stereo channels must have equal length");
  const frames = left.length;
  const dataBytes = frames * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const leftSample = Math.max(-1, Math.min(1, left[frame]));
    const rightSample = Math.max(-1, Math.min(1, right[frame]));
    view.setInt16(offset, leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7fff, true);
    view.setInt16(offset + 2, rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7fff, true);
    offset += 4;
  }
  return new Uint8Array(buffer);
}

export function buildComparison(paramsInput) {
  const base = normalizeParams(paramsInput);
  const closed = generateRoomImpulseResponse(withMode(base, false));
  const open = generateRoomImpulseResponse(withMode(base, true));
  const current = base.openingEnabled ? open : closed;
  return { closed, open, current, mode: base.openingEnabled ? "open" : "closed" };
}

