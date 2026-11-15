import { clamp } from "./ducking.js";

const COLORS = {
  ink: "#f1f3e9",
  muted: "#969c8e",
  dim: "#646a60",
  grid: "rgba(241,243,233,0.09)",
  lime: "#d7ff57",
  coral: "#ff7b64",
  cyan: "#65e6cb",
  amber: "#f7b45b"
};

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function formatClock(seconds) {
  return `00:${String(Math.round(seconds)).padStart(2, "0")}`;
}

export class TimelineView {
  constructor({ musicCanvas, broadcastCanvas, ruler, playhead, timelineWrap, tracks, onSeek }) {
    this.musicCanvas = musicCanvas;
    this.broadcastCanvas = broadcastCanvas;
    this.ruler = ruler;
    this.playhead = playhead;
    this.timelineWrap = timelineWrap;
    this.tracks = tracks;
    this.onSeek = onSeek;
    this.time = 0;
    this.skippedIds = new Set();
    this.dragPointer = null;
    this.buildRuler();
    this.bindSeek();
    new ResizeObserver(() => this.draw(this.time, this.skippedIds)).observe(timelineWrap);
  }

  buildRuler() {
    const marks = [];
    for (let second = 0; second <= this.tracks.duration; second += 4) {
      marks.push(`<span style="left:${(second / this.tracks.duration) * 100}%">${formatClock(second)}</span>`);
    }
    this.ruler.innerHTML = marks.join("");
  }

  bindSeek() {
    const seekFromEvent = (event) => {
      const rect = this.musicCanvas.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      this.onSeek(ratio * this.tracks.duration);
    };
    this.timelineWrap.addEventListener("pointerdown", (event) => {
      this.dragPointer = event.pointerId;
      seekFromEvent(event);
      this.timelineWrap.setPointerCapture?.(event.pointerId);
    });
    this.timelineWrap.addEventListener("pointermove", (event) => {
      if (this.dragPointer === event.pointerId) seekFromEvent(event);
    });
    const endDrag = (event) => {
      if (this.dragPointer === event.pointerId) this.dragPointer = null;
    };
    this.timelineWrap.addEventListener("pointerup", endDrag);
    this.timelineWrap.addEventListener("pointercancel", endDrag);
  }

  draw(time, skippedIds) {
    this.time = time;
    this.skippedIds = skippedIds;
    this.drawMusic();
    this.drawBroadcast();
    this.playhead.style.left = `${clamp(time / this.tracks.duration, 0, 1) * 100}%`;
  }

  drawMusic() {
    const { context, width, height } = prepareCanvas(this.musicCanvas);
    const { left, right } = this.tracks.music;
    const middle = height / 2;
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(101,230,203,0.82)");
    gradient.addColorStop(0.5, "rgba(101,230,203,0.24)");
    gradient.addColorStop(1, "rgba(101,230,203,0.82)");
    context.fillStyle = gradient;

    for (let x = 0; x < width; x += 1) {
      const start = Math.floor(x / width * left.length);
      const end = Math.max(start + 1, Math.floor((x + 1) / width * left.length));
      let low = 0;
      let high = 0;
      for (let i = start; i < end; i += 5) {
        const value = (left[i] + right[i]) * 0.5;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      const top = middle - high * height * 1.5;
      const bottom = middle - low * height * 1.5;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    context.strokeStyle = "rgba(241,243,233,0.09)";
    context.beginPath();
    context.moveTo(0, middle + 0.5);
    context.lineTo(width, middle + 0.5);
    context.stroke();
  }

  drawBroadcast() {
    const { context, width, height } = prepareCanvas(this.broadcastCanvas);
    const { broadcast } = this.tracks;
    const middle = height / 2;

    for (const segment of this.tracks.segments) {
      const skipped = this.skippedIds.has(segment.id);
      const startX = segment.start / this.tracks.duration * width;
      const endX = segment.end / this.tracks.duration * width;
      context.fillStyle = skipped
        ? "rgba(255,123,100,0.075)"
        : "rgba(215,255,87,0.055)";
      context.fillRect(startX, 0, endX - startX, height);
      context.strokeStyle = skipped
        ? "rgba(255,123,100,0.36)"
        : "rgba(215,255,87,0.24)";
      context.beginPath();
      context.moveTo(startX + 0.5, 0);
      context.lineTo(startX + 0.5, height);
      context.moveTo(endX - 0.5, 0);
      context.lineTo(endX - 0.5, height);
      context.stroke();
      context.fillStyle = skipped ? "rgba(255,123,100,0.68)" : "rgba(215,255,87,0.7)";
      context.font = "8px SFMono-Regular, monospace";
      context.fillText(skipped ? `${segment.id.toUpperCase()} / SKIPPED` : segment.id.toUpperCase(), startX + 6, 12);
    }

    context.fillStyle = "rgba(215,255,87,0.78)";
    for (let x = 0; x < width; x += 1) {
      const start = Math.floor(x / width * broadcast.length);
      const end = Math.max(start + 1, Math.floor((x + 1) / width * broadcast.length));
      let peak = 0;
      for (let i = start; i < end; i += 3) peak = Math.max(peak, Math.abs(broadcast[i]));
      const amplitude = peak * height * 1.6;
      if (amplitude > 0.5) context.fillRect(x, middle - amplitude, 1, amplitude * 2);
    }

    for (const [start, end] of this.tracks.segments
      .filter((segment) => this.skippedIds.has(segment.id))
      .map((segment) => [segment.start, segment.end])) {
      const startX = start / this.tracks.duration * width;
      const endX = end / this.tracks.duration * width;
      context.fillStyle = "rgba(255,123,100,0.22)";
      context.fillRect(startX, 0, endX - startX, height);
      context.strokeStyle = "rgba(255,123,100,0.7)";
      context.beginPath();
      context.moveTo(startX, middle);
      context.lineTo(endX, middle);
      context.stroke();
    }
  }
}

export class EnvelopeView {
  constructor(canvas, type) {
    this.canvas = canvas;
    this.type = type;
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(canvas);
    this.state = null;
  }

  update(state) {
    this.state = state;
    this.render();
  }

  render() {
    if (!this.state) return;
    if (this.type === "detector") this.renderDetector();
    else this.renderGain();
  }

  drawFrame(context, width, height, yLabels, yMap) {
    const padding = { left: 39, right: 11, top: 13, bottom: 20 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    context.font = "8px SFMono-Regular, monospace";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (const label of yLabels) {
      const y = yMap(label);
      context.strokeStyle = COLORS.grid;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, y + 0.5);
      context.lineTo(width - padding.right, y + 0.5);
      context.stroke();
      context.fillStyle = COLORS.dim;
      context.fillText(label, padding.left - 8, y);
    }
    context.textAlign = "center";
    context.textBaseline = "top";
    for (let second = 0; second <= 32; second += 8) {
      const x = padding.left + second / 32 * plotWidth;
      context.fillStyle = COLORS.dim;
      context.fillText(formatClock(second), x, height - padding.bottom + 7);
    }
    return { padding, plotWidth, plotHeight };
  }

  renderDetector() {
    const { context, width, height } = prepareCanvas(this.canvas);
    const { envelope, time } = this.state;
    const floor = -60;
    const yMap = (db) => 13 + (clamp(-db, 0, -floor) / -floor) * (height - 33);
    const frame = this.drawFrame(context, width, height, [0, -20, -40, -60], yMap);
    const { padding, plotWidth } = frame;
    const values = envelope.detectionDb;
    const points = Math.max(2, Math.floor(plotWidth));
    const xFor = (index) => padding.left + index / (values.length - 1) * plotWidth;
    const yFor = (index) => yMap(clamp(values[index], floor, 0));

    const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, "rgba(101,230,203,0.26)");
    gradient.addColorStop(1, "rgba(101,230,203,0.015)");
    context.beginPath();
    context.moveTo(padding.left, height - padding.bottom);
    for (let point = 0; point < points; point += 1) {
      const index = Math.round(point / (points - 1) * (values.length - 1));
      context.lineTo(padding.left + point, yFor(index));
    }
    context.lineTo(padding.left + plotWidth, height - padding.bottom);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    for (let point = 0; point < points; point += 1) {
      const index = Math.round(point / (points - 1) * (values.length - 1));
      const x = padding.left + point;
      const y = yFor(index);
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = COLORS.cyan;
    context.lineWidth = 1.2;
    context.stroke();

    const thresholdY = yMap(envelope.thresholdDb);
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgba(255,123,100,0.8)";
    context.beginPath();
    context.moveTo(padding.left, thresholdY);
    context.lineTo(width - padding.right, thresholdY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = COLORS.coral;
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(`THR ${envelope.thresholdDb.toFixed(0)}`, width - padding.right - 4, thresholdY - 3);

    this.drawPlayhead(context, width, height, time, frame);
  }

  renderGain() {
    const { context, width, height } = prepareCanvas(this.canvas);
    const { envelope, time, compareEnvelope } = this.state;
    const bottomDb = -(envelope.maxAttenuationDb + 4);
    const yMap = (db) => 13 + (-db / -bottomDb) * (height - 33);
    const frame = this.drawFrame(
      context,
      width,
      height,
      [0, Math.round(bottomDb / 2), Math.round(bottomDb)],
      yMap
    );
    const { padding, plotWidth } = frame;
    const values = envelope.gainDb;
    const yZero = yMap(0);
    const points = Math.max(2, Math.floor(plotWidth));
    const indexAt = (point) => Math.round(point / (points - 1) * (values.length - 1));
    const yAt = (index) => yMap(clamp(values[index], bottomDb, 0));

    const gradient = context.createLinearGradient(0, yZero, 0, height - padding.bottom);
    gradient.addColorStop(0, "rgba(247,180,91,0.24)");
    gradient.addColorStop(1, "rgba(247,180,91,0.02)");
    context.beginPath();
    context.moveTo(padding.left, yZero);
    for (let point = 0; point < points; point += 1) {
      context.lineTo(padding.left + point, yAt(indexAt(point)));
    }
    context.lineTo(padding.left + plotWidth, yZero);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    if (compareEnvelope) {
      context.beginPath();
      for (let point = 0; point < points; point += 1) {
        const index = Math.round(point / (points - 1) * (compareEnvelope.gainDb.length - 1));
        const y = yMap(clamp(compareEnvelope.gainDb[index], bottomDb, 0));
        if (point === 0) context.moveTo(padding.left + point, y);
        else context.lineTo(padding.left + point, y);
      }
      context.strokeStyle = "rgba(101,230,203,0.55)";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.stroke();
      context.setLineDash([]);
    }

    context.beginPath();
    for (let point = 0; point < points; point += 1) {
      const x = padding.left + point;
      const y = yAt(indexAt(point));
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = COLORS.amber;
    context.lineWidth = 1.35;
    context.stroke();

    context.strokeStyle = COLORS.grid;
    context.beginPath();
    context.moveTo(padding.left, yZero + 0.5);
    context.lineTo(width - padding.right, yZero + 0.5);
    context.stroke();

    this.drawPlayhead(context, width, height, time, frame);
  }

  drawPlayhead(context, width, height, time, frame) {
    const x = frame.padding.left + time / 32 * frame.plotWidth;
    context.strokeStyle = "rgba(255,123,100,0.82)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 0.5, frame.padding.top);
    context.lineTo(x + 0.5, height - frame.padding.bottom);
    context.stroke();
    context.fillStyle = COLORS.coral;
    context.beginPath();
    context.arc(x, frame.padding.top, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

export function currentDetectionDb(envelope, time) {
  const index = Math.min(
    envelope.detectionDb.length - 1,
    Math.max(0, Math.floor(time * envelope.sampleRate / envelope.step))
  );
  return envelope.detectionDb[index];
}

