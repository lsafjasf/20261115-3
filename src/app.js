import { createSong, flattenSyllables, midiToNoteName, noteNameToMidi, songDuration } from "./model.js";
import { Transport, formatClock, clamp, getPlaybackState } from "./timing.js";
import { describeHighlight } from "./highlight.js";
import { AudioEngine } from "./engine.js";
import { exportVtt, exportWav } from "./export.js";

const song = createSong(100);
const transport = new Transport();
const engine = new AudioEngine(song);

const els = {
  play: document.querySelector("#play-btn"),
  pause: document.querySelector("#pause-btn"),
  stop: document.querySelector("#stop-btn"),
  rate: document.querySelector("#rate-select"),
  clock: document.querySelector("#clock"),
  scrubber: document.querySelector("#scrubber"),
  lyrics: document.querySelector("#lyrics"),
  rows: document.querySelector("#editor-rows"),
  exportVtt: document.querySelector("#export-vtt"),
  exportWav: document.querySelector("#export-wav"),
};

const duration = () => songDuration(song);

// ---- 歌词视图 ----
const syllableNodes = new Map();
const lineNodes = new Map();

function buildLyrics() {
  els.lyrics.replaceChildren();
  syllableNodes.clear();
  lineNodes.clear();
  song.bars.forEach((bar, barIndex) => {
    const line = document.createElement("div");
    line.className = "lyric-line";
    line.dataset.barIndex = String(barIndex);
    lineNodes.set(barIndex, line);

    const label = document.createElement("span");
    label.className = "line-label";
    label.textContent = `第${barIndex + 1}小节`;
    line.append(label);

    const wrap = document.createElement("div");
    wrap.className = "syllables";
    for (const syllable of bar.syllables) {
      const span = document.createElement("span");
      span.className = "syllable";
      span.dataset.id = syllable.id;
      span.textContent = syllable.text;
      wrap.append(span);
      syllableNodes.set(syllable.id, span);
    }
    line.append(wrap);
    els.lyrics.append(line);
  });
}

function renderFrame() {
  const total = duration();
  const position = clamp(transport.position, 0, total);
  const state = getPlaybackState(song, position);
  const { syllableStates, lineStates } = describeHighlight(song, state);

  for (const item of syllableStates) {
    const node = syllableNodes.get(item.id);
    if (!node) continue;
    node.className = `syllable ${item.status}`;
    node.style.background = item.status === "active"
      ? `linear-gradient(90deg, var(--accent) ${item.progress * 100}%, transparent ${item.progress * 100}%)`
      : "";
  }

  for (const line of lineStates) {
    const node = lineNodes.get(line.barIndex);
    if (!node) continue;
    node.classList.toggle("active", line.active);
    node.style.transform = line.active ? `scale(${1 + line.pulse * 0.015})` : "";
  }

  els.scrubber.max = String(total);
  els.scrubber.value = String(position);
  els.clock.textContent = `${formatClock(position)} / ${formatClock(total)}`;

  if (transport.playing && position >= total - 0.01 && engine.songPosition() === null) {
    transport.pause();
    transport.seek(total);
  }
  requestAnimationFrame(renderFrame);
}

// ---- 编辑视图 ----
function buildEditor() {
  els.rows.replaceChildren();
  flattenSyllables(song).forEach((syllable, index) => {
    const row = document.createElement("div");
    row.className = "edit-row";
    row.dataset.id = syllable.id;
    row.innerHTML = `
      <span class="glyph">${syllable.text}</span>
      <span class="fields">
        <label>文字<input data-field="text" value="${syllable.text}" maxlength="2" /></label>
        <label>开始(s)<input data-field="start" type="number" step="0.01" min="0" value="${syllable.start.toFixed(2)}" /></label>
        <label>时长(s)<input data-field="duration" type="number" step="0.01" min="0.05" value="${syllable.duration.toFixed(2)}" /></label>
        <label>音高<input data-field="midi" value="${midiToNoteName(syllable.midi)}" /></label>
      </span>`;
    row.dataset.index = String(index);
    els.rows.append(row);
  });
}

els.rows.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-field]");
  if (!input) return;
  const row = input.closest(".edit-row");
  const syllable = flattenSyllables(song)[Number(row.dataset.index)];
  const { field } = input.dataset;

  if (field === "text") {
    syllable.text = input.value || syllable.text;
    syllableNodes.get(syllable.id).textContent = syllable.text;
    row.querySelector(".glyph").textContent = syllable.text;
  } else if (field === "start" || field === "duration") {
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0) syllable[field] = field === "duration" ? Math.max(0.05, value) : value;
    input.value = syllable[field].toFixed(2);
  } else if (field === "midi") {
    const midi = noteNameToMidi(input.value);
    if (midi !== null) syllable.midi = midi;
    input.value = midiToNoteName(syllable.midi);
  }
  els.scrubber.max = String(duration());
});

// ---- 传输控制 ----
els.play.addEventListener("click", async () => {
  if (transport.position >= duration() - 0.01) transport.seek(0);
  transport.play();
  await engine.play(transport.position);
});

els.pause.addEventListener("click", () => {
  transport.pause();
  engine.pause();
});

els.stop.addEventListener("click", () => {
  transport.stop();
  engine.pause();
});

els.rate.addEventListener("change", async () => {
  const rate = Number(els.rate.value);
  const position = transport.position;
  transport.setRate(rate);
  engine.setRate(rate, transport.position);
  if (!engine.source && transport.playing) {
    await engine.play(position);
  }
});

// 拖动播放头：先暂停音频跟踪，松手后在新位置重锚
els.scrubber.addEventListener("pointerdown", () => {
  if (transport.playing) engine.pause();
});
els.scrubber.addEventListener("input", () => {
  transport.seek(Number(els.scrubber.value));
});
els.scrubber.addEventListener("pointerup", async () => {
  if (transport.playing) await engine.play(transport.position);
});

engine.onEnded = () => {
  transport.pause();
  transport.seek(duration());
};

els.exportVtt.addEventListener("click", () => exportVtt(song));
els.exportWav.addEventListener("click", () => exportWav(song));

buildLyrics();
buildEditor();
els.scrubber.max = String(duration());
requestAnimationFrame(renderFrame);
