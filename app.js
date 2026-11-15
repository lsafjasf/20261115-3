(() => {
  "use strict";

  const SAMPLE_RATE = 44100;
  const CLIP_DURATION = 3.2;
  const GROUP_COLORS = ["#d8ff57", "#ff8364", "#82c9ff"];
  const GROUP_NAMES = ["G01", "G02", "G03"];

  const SOURCES = {
    pulse: {
      code: "PULSAR-7",
      name: "脉冲星",
      description: "低频三谐脉冲序列",
    },
    sweep: {
      code: "TIDAL-2",
      name: "潮汐哨音",
      description: "上行滑音与二次谐波",
    },
    relay: {
      code: "RELAY-9",
      name: "继电脉冲",
      description: "不规则金属共振簇",
    },
  };

  const CLIPS = [
    {
      id: "S-01",
      source: "sweep",
      highpass: 0,
      lowpass: 2350,
      q: 1.05,
      delayMs: 68,
      feedback: 0.2,
      noiseDb: -33,
      gain: 0.92,
      seed: 101,
    },
    {
      id: "S-02",
      source: "pulse",
      highpass: 0,
      lowpass: 1850,
      q: 1.7,
      delayMs: 154,
      feedback: 0.31,
      noiseDb: -24,
      gain: 0.94,
      seed: 202,
    },
    {
      id: "S-03",
      source: "relay",
      highpass: 160,
      lowpass: 2100,
      q: 1.2,
      delayMs: 31,
      feedback: 0.18,
      noiseDb: -34,
      gain: 0.9,
      seed: 303,
    },
    {
      id: "S-04",
      source: "pulse",
      highpass: 0,
      lowpass: 780,
      q: 2.15,
      delayMs: 42,
      feedback: 0.14,
      noiseDb: -38,
      gain: 0.96,
      seed: 404,
    },
    {
      id: "S-05",
      source: "sweep",
      highpass: 340,
      lowpass: 1780,
      q: 0.82,
      delayMs: 205,
      feedback: 0.35,
      noiseDb: -23,
      gain: 0.88,
      seed: 505,
    },
    {
      id: "S-06",
      source: "relay",
      highpass: 240,
      lowpass: 2250,
      q: 1.5,
      delayMs: 122,
      feedback: 0.26,
      noiseDb: -26,
      gain: 0.9,
      seed: 606,
    },
  ].map((clip, index) => ({ ...clip, index, el: null, buffer: null, analysis: null }));

  const state = {
    clipsById: new Map(CLIPS.map((clip) => [clip.id, clip])),
    groups: [null, null, null],
    selected: null,
    submitted: false,
    results: null,
    playingId: null,
    audioContext: null,
    playbackSource: null,
    playbackGain: null,
    ready: false,
    startedAt: Date.now(),
  };

  const refs = {
    signalGrid: document.querySelector("#signalGrid"),
    groupList: document.querySelector("#groupList"),
    matchCounter: document.querySelector("#matchCounter"),
    queueText: document.querySelector("#queueText"),
    selectionQueue: document.querySelector("#selectionQueue"),
    submitButton: document.querySelector("#submitButton"),
    resetButton: document.querySelector("#resetButton"),
    resultPanel: document.querySelector("#resultPanel"),
    resultScore: document.querySelector("#resultScore"),
    resultLabel: document.querySelector("#resultLabel"),
    resultTitle: document.querySelector("#resultTitle"),
    resultDescription: document.querySelector("#resultDescription"),
    resultGroups: document.querySelector("#resultGroups"),
    resultRetry: document.querySelector("#resultRetry"),
    protocolState: document.querySelector("#protocolState"),
    sessionClock: document.querySelector("#sessionClock"),
    toast: document.querySelector("#toast"),
    connectionCanvas: document.querySelector("#connectionCanvas"),
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const dbToGain = (db) => Math.pow(10, db / 20);
  const lerp = (a, b, t) => a + (b - a) * t;
  const formatId = (id) => id.replace("-", "·");
  const formatHz = (hz) =>
    hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
  const formatMs = (ms) => `${Math.round(ms)} ms`;

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function createNoiseBuffer(ctx, seed, seconds = CLIP_DURATION) {
    const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const random = seededRandom(seed);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last;
    }
    return buffer;
  }

  function addOscillator(ctx, destination, frequency, gainValue, type = "sine") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = gainValue;
    osc.connect(gain).connect(destination);
    osc.start(0);
    osc.stop(CLIP_DURATION);
    return { osc, gain };
  }

  function schedulePulseEnvelope(ctx, gain, rhythm = 0.31, seed = 1) {
    const random = seededRandom(seed);
    const pattern = [0.9, 0.55, 0.72, 0.38, 0.84, 0.48, 0.66, 0.42, 0.78, 0.56];
    gain.gain.setValueAtTime(0.0001, 0);
    let time = 0.08;
    let step = 0;
    while (time < CLIP_DURATION - 0.12) {
      const level = pattern[step % pattern.length] * (0.9 + random() * 0.16);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(level, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(level * 0.27, time + 0.055);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + rhythm * 0.82);
      time += rhythm;
      step += 1;
    }
  }

  function buildSource(ctx, destination, source) {
    if (source === "pulse") {
      const pulseGain = ctx.createGain();
      const oscillators = [];
      pulseGain.gain.value = 0.0001;
      pulseGain.connect(destination);
      schedulePulseEnvelope(ctx, pulseGain, 0.315, 71);
      [116, 232, 348, 464].forEach((frequency, index) => {
        oscillators.push(addOscillator(ctx, pulseGain, frequency, 0.24 / (index + 1)));
      });
      const drift = ctx.createOscillator();
      const driftGain = ctx.createGain();
      drift.frequency.value = 0.38;
      driftGain.gain.value = 2.8;
      drift.connect(driftGain);
      oscillators.forEach(({ osc }) => driftGain.connect(osc.frequency));
      drift.start(0);
      drift.stop(CLIP_DURATION);
      return;
    }

    if (source === "sweep") {
      const voice = ctx.createGain();
      const carrier = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const carrierGain = ctx.createGain();
      const harmonicGain = ctx.createGain();
      voice.gain.value = 0.0001;
      voice.connect(destination);
      carrier.type = "sine";
      harmonic.type = "sine";
      carrierGain.gain.value = 0.33;
      harmonicGain.gain.value = 0.12;
      carrier.connect(carrierGain).connect(voice);
      harmonic.connect(harmonicGain).connect(voice);
      carrier.frequency.setValueAtTime(548, 0);
      carrier.frequency.exponentialRampToValueAtTime(1110, 0.92);
      carrier.frequency.exponentialRampToValueAtTime(690, 1.65);
      carrier.frequency.exponentialRampToValueAtTime(1260, 2.38);
      carrier.frequency.exponentialRampToValueAtTime(760, CLIP_DURATION);
      harmonic.frequency.setValueAtTime(1096, 0);
      harmonic.frequency.exponentialRampToValueAtTime(2220, 0.92);
      harmonic.frequency.exponentialRampToValueAtTime(1380, 1.65);
      harmonic.frequency.exponentialRampToValueAtTime(2520, 2.38);
      harmonic.frequency.exponentialRampToValueAtTime(1520, CLIP_DURATION);
      voice.gain.setValueAtTime(0.0001, 0);
      voice.gain.exponentialRampToValueAtTime(0.58, 0.16);
      voice.gain.setValueAtTime(0.46, 0.86);
      voice.gain.exponentialRampToValueAtTime(0.18, 1.42);
      voice.gain.exponentialRampToValueAtTime(0.61, 1.72);
      voice.gain.setValueAtTime(0.5, 2.36);
      voice.gain.exponentialRampToValueAtTime(0.0001, CLIP_DURATION);
      carrier.start(0);
      harmonic.start(0);
      carrier.stop(CLIP_DURATION);
      harmonic.stop(CLIP_DURATION);
      return;
    }

    const relayGain = ctx.createGain();
    relayGain.gain.value = 0.0001;
    relayGain.connect(destination);
    const times = [0.1, 0.32, 0.66, 0.91, 1.26, 1.49, 1.78, 2.08, 2.4, 2.72];
    const levels = [0.72, 0.32, 0.78, 0.24, 0.62, 0.38, 0.88, 0.28, 0.7, 0.45];
    times.forEach((time, index) => {
      relayGain.gain.setValueAtTime(0.0001, time);
      relayGain.gain.exponentialRampToValueAtTime(levels[index], time + 0.006);
      relayGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.095 + index * 0.006);
    });
    [436, 908, 1582, 2145].forEach((frequency, index) => {
      addOscillator(ctx, relayGain, frequency, 0.18 / Math.sqrt(index + 1));
    });
    const click = ctx.createBufferSource();
    const clickGain = ctx.createGain();
    click.buffer = createNoiseBuffer(ctx, 909);
    click.loop = true;
    clickGain.gain.value = 0.035;
    click.connect(clickGain).connect(relayGain);
    click.start(0);
    click.stop(CLIP_DURATION);
  }

  async function synthesizeClip(clip) {
    const ctx = new OfflineAudioContext(1, Math.ceil(CLIP_DURATION * SAMPLE_RATE), SAMPLE_RATE);
    const sourceBus = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const dry = ctx.createGain();
    const delay = ctx.createDelay(1);
    const wet = ctx.createGain();
    const feedback = ctx.createGain();
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const master = ctx.createGain();

    sourceBus.gain.value = 0.72;
    highpass.type = "highpass";
    highpass.frequency.value = clip.highpass || 18;
    highpass.Q.value = 0.65;
    lowpass.type = "lowpass";
    lowpass.frequency.value = clip.lowpass;
    lowpass.Q.value = clip.q;
    dry.gain.value = 0.82;
    delay.delayTime.value = clip.delayMs / 1000;
    wet.gain.value = 0.42;
    feedback.gain.value = clip.feedback;
    noise.buffer = createNoiseBuffer(ctx, clip.seed);
    noise.loop = true;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 840 + clip.index * 95;
    noiseFilter.Q.value = 0.55;
    noiseGain.gain.value = dbToGain(clip.noiseDb);
    master.gain.value = clip.gain * 0.58;

    buildSource(ctx, sourceBus, clip.source);
    sourceBus.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(dry).connect(master);
    lowpass.connect(delay);
    delay.connect(wet).connect(master);
    delay.connect(feedback).connect(delay);
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    master.connect(ctx.destination);
    noise.start(0);

    const buffer = await ctx.startRendering();
    normalizeBuffer(buffer, 0.84);
    return buffer;
  }

  function normalizeBuffer(buffer, targetPeak) {
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak === 0) return;
    const scale = targetPeak / peak;
    for (let i = 0; i < data.length; i += 1) {
      data[i] *= scale;
    }
  }

  function inverseBits(value, bits) {
    let result = 0;
    for (let i = 0; i < bits; i += 1) {
      result = (result << 1) | (value & 1);
      value >>>= 1;
    }
    return result;
  }

  function fft(re, im) {
    const size = re.length;
    const bits = Math.round(Math.log2(size));
    for (let i = 0; i < size; i += 1) {
      const j = inverseBits(i, bits);
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let length = 2; length <= size; length <<= 1) {
      const angle = (-2 * Math.PI) / length;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      for (let start = 0; start < size; start += length) {
        let curReal = 1;
        let curImag = 0;
        for (let k = 0; k < length / 2; k += 1) {
          const even = start + k;
          const odd = even + length / 2;
          const oddReal = re[odd] * curReal - im[odd] * curImag;
          const oddImag = re[odd] * curImag + im[odd] * curReal;
          re[odd] = re[even] - oddReal;
          im[odd] = im[even] - oddImag;
          re[even] += oddReal;
          im[even] += oddImag;
          const nextReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = nextReal;
        }
      }
    }
  }

  function analyzeBuffer(buffer) {
    const data = buffer.getChannelData(0);
    const size = 4096;
    const starts = [0.12, 0.82, 1.52, 2.22].map((seconds) =>
      Math.floor(seconds * buffer.sampleRate),
    );
    const magnitudes = new Float32Array(size / 2);
    const window = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }

    starts.forEach((start) => {
      const re = new Float32Array(size);
      const im = new Float32Array(size);
      for (let i = 0; i < size; i += 1) {
        re[i] = (data[start + i] || 0) * window[i];
      }
      fft(re, im);
      for (let bin = 0; bin < size / 2; bin += 1) {
        magnitudes[bin] += Math.hypot(re[bin], im[bin]) / starts.length;
      }
    });

    const frequencies = new Float32Array(magnitudes.length);
    const db = new Float32Array(magnitudes.length);
    let maximum = 0;
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      frequencies[bin] = (bin * buffer.sampleRate) / size;
      maximum = Math.max(maximum, magnitudes[bin]);
    }
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      db[bin] = 20 * Math.log10(magnitudes[bin] / maximum + 0.000001);
    }

    return {
      frequencies,
      db,
      maxFrequency: 4200,
      maxDb: 0,
      minDb: -55,
    };
  }

  function spectralSimilarity(a, b) {
    const start = Math.round(45 / (SAMPLE_RATE / 4096));
    const end = Math.round(3800 / (SAMPLE_RATE / 4096));
    let meanA = 0;
    let meanB = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      meanA += a.db[i];
      meanB += b.db[i];
      count += 1;
    }
    meanA /= count;
    meanB /= count;
    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;
    for (let i = start; i <= end; i += 1) {
      const da = a.db[i] - meanA;
      const db = b.db[i] - meanB;
      covariance += da * db;
      varianceA += da * da;
      varianceB += db * db;
    }
    if (varianceA === 0 || varianceB === 0) return 0;
    return clamp(covariance / Math.sqrt(varianceA * varianceB), 0, 1);
  }

  function envelopeSignature(buffer, blockMs = 20) {
    const data = buffer.getChannelData(0);
    const block = Math.floor((buffer.sampleRate * blockMs) / 1000);
    const envelope = [];
    for (let start = 0; start < data.length; start += block) {
      let sum = 0;
      let count = 0;
      const end = Math.min(start + block, data.length);
      for (let index = start; index < end; index += 1) {
        sum += data[index] * data[index];
        count += 1;
      }
      envelope.push(Math.sqrt(sum / count));
    }
    return envelope;
  }

  function envelopeCorrelation(first, second, maxLagBlocks = 12) {
    let best = -1;
    for (let lag = -maxLagBlocks; lag <= maxLagBlocks; lag += 1) {
      const a = [];
      const b = [];
      const from = Math.max(0, -lag);
      const to = Math.min(first.length, second.length - lag);
      for (let index = from; index < to; index += 1) {
        a.push(first[index]);
        b.push(second[index + lag]);
      }
      let meanA = 0;
      let meanB = 0;
      for (let index = 0; index < a.length; index += 1) {
        meanA += a[index];
        meanB += b[index];
      }
      meanA /= a.length;
      meanB /= b.length;
      let covariance = 0;
      let varianceA = 0;
      let varianceB = 0;
      for (let index = 0; index < a.length; index += 1) {
        const da = a[index] - meanA;
        const db = b[index] - meanB;
        covariance += da * db;
        varianceA += da * da;
        varianceB += db * db;
      }
      if (varianceA > 0 && varianceB > 0) {
        best = Math.max(best, covariance / Math.sqrt(varianceA * varianceB));
      }
    }
    return clamp(best, 0, 1);
  }

  function pairSimilarity(first, second) {
    const spectrum = spectralSimilarity(first.analysis, second.analysis);
    const envelope = envelopeCorrelation(first.envelope, second.envelope);
    return Math.round((envelope * 0.6 + spectrum * 0.4) * 100);
  }

  function nearestPeaks(analysis, limit = 3) {
    const step = SAMPLE_RATE / 4096;
    const peaks = [];
    const start = Math.max(2, Math.round(70 / step));
    const end = Math.round(3900 / step);
    for (let i = start; i < end - 1; i += 1) {
      const value = analysis.db[i];
      if (value > analysis.db[i - 1] && value >= analysis.db[i + 1] && value > -38) {
        peaks.push({ frequency: analysis.frequencies[i], db: value });
      }
    }
    return peaks.sort((a, b) => b.db - a.db).slice(0, limit);
  }

  function playlistMarkup(clip) {
    return `
      <article class="signal-card" data-clip-id="${clip.id}" tabindex="0" role="button"
        aria-label="信号 ${formatId(clip.id)}，点击选择">
        <div class="card-top">
          <span class="signal-id">${formatId(clip.id)}</span>
          <span class="signal-state">UNASSIGNED</span>
        </div>
        <div class="spectrum-shell">
          <span class="card-hint">FREQUENCY DOMAIN</span>
          <canvas class="spectrum-canvas" aria-label="信号 ${clip.id} 频谱"></canvas>
          <span class="spectrum-scanner"></span>
          <div class="spectrum-axis">
            <span>0 Hz</span><span>1k</span><span>2k</span><span>3k</span><span>4.2k</span>
          </div>
          <span class="group-flag"></span>
        </div>
        <div class="card-controls">
          <button class="play-button" type="button" data-play="${clip.id}"
            aria-label="试听信号 ${clip.id}">
            <span class="play-icon">
              <svg viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg>
            </span>
            <span class="play-label">试听信号</span>
          </button>
          <span class="duration">03.20 SEC</span>
        </div>
        <div class="param-drawer" hidden></div>
      </article>
    `;
  }

  function createCards() {
    refs.signalGrid.innerHTML = CLIPS.map(playlistMarkup).join("");
    CLIPS.forEach((clip) => {
      clip.el = refs.signalGrid.querySelector(`[data-clip-id="${clip.id}"]`);
      const canvas = clip.el.querySelector(".spectrum-canvas");
      drawSpectrumPlaceholder(clip, canvas);
      const observer = new ResizeObserver(() => {
        if (clip.analysis) drawSpectrum(clip);
      });
      observer.observe(canvas);
    });
  }

  function canvasMetrics(canvas) {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function drawSpectrumPlaceholder(clip, canvas) {
    const { ctx, width, height } = canvasMetrics(canvas);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(236,235,220,0.07)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, height * 0.58);
    for (let x = 0; x <= width; x += 8) {
      ctx.lineTo(x, height * 0.58 + Math.sin(x * 0.09 + clip.index) * 10);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(236,235,220,0.22)";
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.fillText("SYNTHESIZING…", 4, 12);
  }

  function spectrumColor(clip) {
    const groupIndex = groupIndexForClip(clip.id);
    if (groupIndex >= 0) return GROUP_COLORS[groupIndex];
    if (state.selected === clip.id) return GROUP_COLORS[0];
    return "#c7c9b8";
  }

  function drawSpectrum(clip) {
    if (!clip.analysis || !clip.el) return;
    const canvas = clip.el.querySelector(".spectrum-canvas");
    if (!canvas) return;
    const { ctx, width, height } = canvasMetrics(canvas);
    const analysis = clip.analysis;
    const top = 10;
    const bottom = height - 4;
    const plotHeight = bottom - top;
    const maxFrequency = analysis.maxFrequency;
    const color = spectrumColor(clip);
    const points = [];
    const bins = Math.round(maxFrequency / (SAMPLE_RATE / 4096));
    const smoothing = 4;

    for (let i = 0; i < bins; i += 2) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - smoothing); j < Math.min(bins, i + smoothing); j += 1) {
        sum += analysis.db[j];
        count += 1;
      }
      const dbValue = sum / count;
      const normalized = clamp((dbValue - analysis.minDb) / (analysis.maxDb - analysis.minDb), 0, 1);
      points.push({
        x: (analysis.frequencies[i] / maxFrequency) * width,
        y: top + (1 - normalized) * plotHeight,
      });
    }

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.strokeStyle = "rgba(236,235,220,0.075)";
    ctx.fillStyle = "rgba(236,235,220,0.22)";
    ctx.font = '6px "SFMono-Regular", monospace';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(`${24 - i * 12} dB`, 2, y + (i === 0 ? 8 : -2));
    }
    [500, 1000, 2000, 3000, 4000].forEach((frequency) => {
      const x = (frequency / maxFrequency) * width;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, `${color}33`);
    fill.addColorStop(0.52, `${color}16`);
    fill.addColorStop(1, `${color}00`);
    ctx.beginPath();
    ctx.moveTo(points[0].x, bottom);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = color;
    ctx.shadowBlur = spectrumColor(clip) === "#c7c9b8" ? 3 : 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    nearestPeaks(analysis, 3).forEach((peak) => {
      const x = (peak.frequency / maxFrequency) * width;
      const normalized = clamp((peak.db - analysis.minDb) / (analysis.maxDb - analysis.minDb), 0, 1);
      const y = top + (1 - normalized) * plotHeight;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
    ctx.restore();
  }

  function drawAllSpectra() {
    CLIPS.forEach((clip) => {
      if (clip.analysis) drawSpectrum(clip);
      else if (clip.el) drawSpectrumPlaceholder(clip, clip.el.querySelector(".spectrum-canvas"));
    });
  }

  function groupIndexForClip(id) {
    return state.groups.findIndex((group) => group && group.members.includes(id));
  }

  function filledGroupCount() {
    return state.groups.filter(Boolean).length;
  }

  function groupSlotMarkup(group, index) {
    const color = GROUP_COLORS[index];
    const members = group?.members || [];
    const makeSlot = (clipId, orderLabel) => {
      const clip = clipId ? state.clipsById.get(clipId) : null;
      return `
        <div class="pair-slot ${clip ? "filled" : "empty"}">
          <span class="slot-order">${orderLabel}</span>
          <span class="slot-signal">
            ${clip ? formatId(clip.id) : "等待信号"}
            ${clip ? '<span class="slot-name">UNKNOWN SOURCE</span>' : ""}
          </span>
        </div>
      `;
    };
    return `
      <div class="group-slot ${members.length ? "has-pair" : ""}" data-group-index="${index}"
        style="--group-color: ${color}">
        <div class="group-label">
          <span>GROUP ${String(index + 1).padStart(2, "0")} · 延迟短 → 长</span>
          <b>${members.length ? "SEALED" : "OPEN"}</b>
        </div>
        <div class="pair-rail">
          ${makeSlot(members[0], "早")}
          <span class="order-arrow" aria-hidden="true"></span>
          ${makeSlot(members[1], "晚")}
        </div>
        <div class="group-tools">
          <button class="group-tool" type="button" data-group-action="swap"
            data-group-index="${index}" ${members.length ? "" : "disabled"}>⇄ 交换顺序</button>
          <button class="group-tool" type="button" data-group-action="remove"
            data-group-index="${index}" ${members.length ? "" : "disabled"}>移出本组</button>
        </div>
      </div>
    `;
  }

  function renderGroups() {
    refs.groupList.innerHTML = state.groups.map(groupSlotMarkup).join("");
    refs.matchCounter.textContent = `${filledGroupCount()} / 3`;
    refs.submitButton.disabled = !state.ready || filledGroupCount() < 3 || state.submitted;
    refs.submitButton.querySelector("span").textContent = state.submitted
      ? "已提交归档"
      : "提交归档";
    updateCardStates();
  }

  function updateCardStates() {
    CLIPS.forEach((clip) => {
      if (!clip.el) return;
      const groupIndex = groupIndexForClip(clip.id);
      clip.el.classList.toggle("is-assigned", groupIndex >= 0);
      clip.el.classList.toggle("is-selected", state.selected === clip.id);
      clip.el.classList.toggle("is-playing", state.playingId === clip.id);
      if (groupIndex >= 0) {
        clip.el.style.setProperty("--group-color", GROUP_COLORS[groupIndex]);
        const memberIndex = state.groups[groupIndex].members.indexOf(clip.id);
        const flag = clip.el.querySelector(".group-flag");
        flag.textContent = `G0${groupIndex + 1} · ${memberIndex === 0 ? "早" : "晚"}`;
        clip.el.querySelector(".signal-state").textContent = `FILED · G0${groupIndex + 1}`;
        clip.el.setAttribute(
          "aria-label",
          `信号 ${formatId(clip.id)}，已归入第 ${groupIndex + 1} 组，点击试听`,
        );
      } else {
        clip.el.style.setProperty("--group-color", GROUP_COLORS[0]);
        clip.el.querySelector(".group-flag").textContent = "";
        clip.el.querySelector(".signal-state").textContent = "UNASSIGNED";
        clip.el.setAttribute(
          "aria-label",
          `信号 ${formatId(clip.id)}，点击${state.selected === clip.id ? "取消选择" : "选择"}`,
        );
      }
      drawSpectrum(clip);
    });
  }

  function updateQueue() {
    if (!state.selected) {
      refs.queueText.textContent = "尚未选择信号";
      refs.selectionQueue.classList.remove("active");
      return;
    }
    refs.queueText.textContent = `已选 ${formatId(state.selected)} · 再选一张组成新组`;
    refs.selectionQueue.classList.add("active");
  }

  function selectClip(id) {
    if (state.submitted) {
      showToast("归档已提交。选择“重新挑战”后可再次配对。");
      return;
    }
    if (groupIndexForClip(id) >= 0) {
      showToast("该信号已在组内。如需调整，请使用配对台的“移出本组”。");
      return;
    }
    if (!state.selected) {
      state.selected = id;
      updateQueue();
      updateCardStates();
      return;
    }
    if (state.selected === id) {
      state.selected = null;
      updateQueue();
      updateCardStates();
      return;
    }
    const emptyIndex = state.groups.findIndex((group) => group === null);
    if (emptyIndex < 0) {
      showToast("三组已经排满。请先移出一组，再继续配对。");
      return;
    }
    state.groups[emptyIndex] = { members: [state.selected, id] };
    state.selected = null;
    updateQueue();
    renderGroups();
    const early = state.clipsById.get(state.groups[emptyIndex].members[0]);
    const late = state.clipsById.get(state.groups[emptyIndex].members[1]);
    showToast(
      `第 ${emptyIndex + 1} 组已建立：${formatId(early.id)} → ${formatId(late.id)}。如需调整延迟顺序，请点“交换顺序”。`,
    );
  }

  function removeGroup(index) {
    if (state.submitted || !state.groups[index]) return;
    state.groups[index] = null;
    state.selected = null;
    updateQueue();
    renderGroups();
    showToast(`第 ${index + 1} 组已移出。`);
  }

  function swapGroup(index) {
    const group = state.groups[index];
    if (state.submitted || !group) return;
    group.members.reverse();
    renderGroups();
    showToast(`第 ${index + 1} 组顺序已交换。`);
  }

  function ensureAudioContext() {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      state.audioContext = new AudioContextClass();
    }
    if (state.audioContext.state === "suspended") {
      state.audioContext.resume();
    }
    return state.audioContext;
  }

  function stopPlayback(announce = false) {
    if (state.playbackSource) {
      try {
        state.playbackSource.stop();
      } catch {
        // A source can only be stopped once.
      }
      state.playbackSource.disconnect();
      state.playbackSource = null;
    }
    if (state.playbackGain) {
      state.playbackGain.disconnect();
      state.playbackGain = null;
    }
    state.playingId = null;
    updatePlaybackButtons();
    updateCardStates();
    if (announce) showToast("播放已停止。");
  }

  function updatePlaybackButtons() {
    CLIPS.forEach((clip) => {
      if (!clip.el) return;
      const button = clip.el.querySelector(".play-button");
      const label = button.querySelector(".play-label");
      const icon = button.querySelector(".play-icon svg");
      const playing = state.playingId === clip.id;
      label.textContent = playing ? "停止播放" : state.ready ? "试听信号" : "合成中";
      button.disabled = !state.ready;
      button.setAttribute(
        "aria-label",
        playing ? `停止信号 ${clip.id}` : `试听信号 ${clip.id}`,
      );
      icon.innerHTML = playing
        ? '<rect x="1" y="1" width="8" height="10" rx="1"/>'
        : '<path d="M0 0l10 6-10 6z"/>';
    });
  }

  async function togglePlayback(id) {
    if (!state.ready) {
      showToast("频谱仍在合成，请稍候。");
      return;
    }
    if (state.playingId === id) {
      stopPlayback();
      return;
    }
    stopPlayback();
    const clip = state.clipsById.get(id);
    if (!clip?.buffer) return;
    try {
      const ctx = ensureAudioContext();
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = clip.buffer;
      gain.gain.value = 0.9;
      source.connect(gain).connect(ctx.destination);
      source.onended = () => {
        if (state.playbackSource !== source) return;
        source.disconnect();
        gain.disconnect();
        state.playbackSource = null;
        state.playbackGain = null;
        state.playingId = null;
        updatePlaybackButtons();
        updateCardStates();
      };
      state.playbackSource = source;
      state.playbackGain = gain;
      state.playingId = id;
      source.start();
      updatePlaybackButtons();
      updateCardStates();
    } catch (error) {
      console.error("Playback failed", error);
      showToast("浏览器未能启动音频播放，请再次点击试听。");
    }
  }

  function filterParameterText(clip) {
    const highpass = clip.highpass ? `高通 ${formatHz(clip.highpass)} · ` : "";
    return `${highpass}低通 ${formatHz(clip.lowpass)} · Q ${clip.q.toFixed(2)}`;
  }

  function truePairFor(clip) {
    return CLIPS.find((candidate) => candidate.source === clip.source && candidate.id !== clip.id);
  }

  function evaluateArchive() {
    const groupResults = state.groups.map((group, index) => {
      const first = state.clipsById.get(group.members[0]);
      const second = state.clipsById.get(group.members[1]);
      const sameSource = first.source === second.source;
      const delayOrderCorrect = sameSource && first.delayMs < second.delayMs;
      const similarity = pairSimilarity(first, second);
      return {
        index,
        first,
        second,
        sameSource,
        delayOrderCorrect,
        similarity,
        truePair: truePairFor(first),
      };
    });
    const pairCorrect = groupResults.filter((result) => result.sameSource).length;
    const orderCorrect = groupResults.filter((result) => result.delayOrderCorrect).length;
    const score = Math.round(pairCorrect * 20 + orderCorrect * 13.34);
    return { groupResults, pairCorrect, orderCorrect, score };
  }

  function revealCardParameters() {
    CLIPS.forEach((clip) => {
      const drawer = clip.el.querySelector(".param-drawer");
      const source = SOURCES[clip.source];
      drawer.hidden = false;
      drawer.innerHTML = `
        <div class="source-param">
          <span>SOURCE IDENTIFIED</span>
          <b>${source.code} · ${source.name}</b>
        </div>
        <div>
          <span>FILTER</span>
          <b>${filterParameterText(clip)}</b>
        </div>
        <div>
          <span>DELAY</span>
          <b>${formatMs(clip.delayMs)} · 反馈 ${Math.round(clip.feedback * 100)}%</b>
        </div>
        <div>
          <span>NOISE FLOOR</span>
          <b>${clip.noiseDb} dBFS</b>
        </div>
        <div>
          <span>ANALYSIS MATCH</span>
          <b>PAIR ${truePairFor(clip).id.replace("-", "·")}</b>
        </div>
      `;
      clip.el.classList.add("is-revealed");
      clip.el.setAttribute("aria-label", `信号 ${formatId(clip.id)}，真实参数已揭晓`);
    });
  }

  function verdictFor(result) {
    if (!result.sameSource) {
      return { text: "非同一来源", className: "" };
    }
    if (result.delayOrderCorrect) {
      return { text: "同源 · 顺序正确", className: "good" };
    }
    return { text: "同源 · 顺序反了", className: "" };
  }

  function parameterSummary(clip) {
    return `${filterParameterText(clip)} / ${formatMs(clip.delayMs)} / ${clip.noiseDb} dBFS`;
  }

  function resultGroupMarkup(result) {
    const color = GROUP_COLORS[result.index];
    const verdict = verdictFor(result);
    const orderText = result.sameSource
      ? result.delayOrderCorrect
        ? "正确"
        : "反序"
      : "不适用";
    return `
      <div class="result-group" style="--group-color: ${color}">
        <div class="result-group-head">
          <span>GROUP ${String(result.index + 1).padStart(2, "0")} / VERIFIED</span>
          <span class="verdict ${verdict.className}">${verdict.text}</span>
        </div>
        <div class="result-pair">
          <div class="result-signal">
            <b>${formatId(result.first.id)}</b>
            <small>${formatMs(result.first.delayMs)} DELAY</small>
          </div>
          <span class="pair-arrow">→</span>
          <div class="result-signal">
            <b>${formatId(result.second.id)}</b>
            <small>${formatMs(result.second.delayMs)} DELAY</small>
          </div>
        </div>
        <div class="result-metrics">
          <div>
            <span>VOICEPRINT SIMILARITY</span>
            <b>${result.similarity}%</b>
          </div>
          <div>
            <span>DELAY ORDER</span>
            <b>${orderText}</b>
          </div>
        </div>
        <div class="result-truth">
          ${
            result.sameSource
              ? `真实来源：<strong>${SOURCES[result.first.source].code} · ${SOURCES[result.first.source].name}</strong>`
              : `真实配对：<em>${formatId(result.first.id)} ↔ ${formatId(result.truePair.id)}</em> · 所选两段并非同源`
          }<br />
          ${formatId(result.first.id)}：${parameterSummary(result.first)}<br />
          ${formatId(result.second.id)}：${parameterSummary(result.second)}
        </div>
      </div>
    `;
  }

  function showResults() {
    const result = evaluateArchive();
    state.results = result;
    state.submitted = true;
    stopPlayback();
    revealCardParameters();
    refs.resultScore.textContent = result.score;
    refs.resultGroups.innerHTML = result.groupResults.map(resultGroupMarkup).join("");
    refs.resultPanel.hidden = false;
    refs.submitButton.disabled = true;
    refs.submitButton.querySelector("span").textContent = "已提交归档";
    refs.resetButton.disabled = true;
    refs.protocolState.textContent = "ARCHIVE VERIFIED";
    refs.matchCounter.textContent = "3 / 3";

    if (result.score === 100) {
      refs.resultLabel.textContent = "PERFECT ARCHIVE";
      refs.resultTitle.textContent = "三组同源，全部命中";
      refs.resultDescription.textContent =
        "三组同源判断与三组延迟顺序全部正确。真实声源、滤波、延迟与噪声参数已经展开在每张信号卡片下方。";
    } else if (result.pairCorrect > 0) {
      refs.resultLabel.textContent = "PARTIAL MATCH";
      refs.resultTitle.textContent = "部分线索吻合";
      refs.resultDescription.textContent =
        `${result.pairCorrect}/3 组同源判断正确，${result.orderCorrect}/3 组延迟顺序正确。` +
        "对照下方真实配对与展开参数，可以重新检查频谱包络和回声间隔。";
    } else {
      refs.resultLabel.textContent = "NO ARCHIVE MATCH";
      refs.resultTitle.textContent = "没有找到同源关系";
      refs.resultDescription.textContent =
        "三组都未命中同一声源。真实配对、频谱相似度与全部处理参数已揭晓，可重新挑战。";
    }

    refs.submitButton.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      refs.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    showToast("归档已提交：相似度与真实处理参数现已揭晓。");
  }

  function resetArchive() {
    if (state.submitted) return;
    stopPlayback();
    state.groups = [null, null, null];
    state.selected = null;
    updateQueue();
    renderGroups();
    refs.protocolState.textContent = "AWAITING INPUT";
    showToast("配对台已清空，可以重新开始。");
  }

  function retryArchive() {
    stopPlayback();
    state.groups = [null, null, null];
    state.selected = null;
    state.submitted = false;
    state.results = null;
    refs.resultPanel.hidden = true;
    refs.resultGroups.innerHTML = "";
    refs.resetButton.disabled = false;
    refs.protocolState.textContent = "AWAITING INPUT";
    CLIPS.forEach((clip) => {
      clip.el.classList.remove("is-revealed");
      clip.el.querySelector(".param-drawer").hidden = true;
      clip.el.querySelector(".param-drawer").innerHTML = "";
    });
    updateQueue();
    renderGroups();
    refs.signalGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("新档案已就绪。请重新配对三组信号。");
  }

  function anchorFor(rect, targetRect) {
    const dx = targetRect.left + targetRect.width / 2 - (rect.left + rect.width / 2);
    const dy = targetRect.top + targetRect.height / 2 - (rect.top + rect.height / 2);
    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        x: dx > 0 ? rect.right - 3 : rect.left + 3,
        y: rect.top + Math.min(48, rect.height * 0.33),
        side: dx > 0 ? 1 : -1,
      };
    }
    return {
      x: rect.left + Math.min(rect.width * 0.25, 70),
      y: dy > 0 ? rect.bottom - 3 : rect.top + 3,
      side: dy > 0 ? 1 : -1,
    };
  }

  function drawConnectionCanvas(time) {
    const canvas = refs.connectionCanvas;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    state.groups.forEach((group, index) => {
      if (!group) return;
      const firstEl = state.clipsById.get(group.members[0]).el;
      const secondEl = state.clipsById.get(group.members[1]).el;
      if (!firstEl || !secondEl) return;
      const firstRect = firstEl.getBoundingClientRect();
      const secondRect = secondEl.getBoundingClientRect();
      if (
        firstRect.bottom < -40 ||
        secondRect.bottom < -40 ||
        firstRect.top > height + 40 ||
        secondRect.top > height + 40
      ) {
        return;
      }
      const start = anchorFor(firstRect, secondRect);
      const end = anchorFor(secondRect, firstRect);
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const bend = Math.min(74, distance * 0.2);
      const isHorizontal = Math.abs(end.x - start.x) > Math.abs(end.y - start.y);
      const c1 = isHorizontal
        ? { x: start.x + (end.x - start.x) * 0.35, y: start.y + bend * start.side }
        : { x: start.x + bend * start.side, y: start.y + (end.y - start.y) * 0.35 };
      const c2 = isHorizontal
        ? { x: start.x + (end.x - start.x) * 0.65, y: end.y + bend * end.side }
        : { x: end.x + bend * end.side, y: start.y + (end.y - start.y) * 0.65 };
      const color = GROUP_COLORS[index];

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
      ctx.strokeStyle = `${color}18`;
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = `${color}b8`;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -(time / 38) % 13;
      ctx.stroke();
      ctx.setLineDash([]);

      [start, end].forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}55`;
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      ctx.font = '7px "SFMono-Regular", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = `${color}cc`;
      ctx.fillText(`G0${index + 1}`, midX, midY - 6);
      ctx.restore();
    });
  }

  let toastTimer = 0;
  function showToast(message) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => refs.toast.classList.remove("visible"), 2800);
  }

  function startClock() {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const seconds = String(elapsed % 60).padStart(2, "0");
      refs.sessionClock.textContent = `${minutes}:${seconds}`;
    };
    tick();
    window.setInterval(tick, 1000);
  }

  function bindEvents() {
    refs.signalGrid.addEventListener("click", (event) => {
      const playButton = event.target.closest("[data-play]");
      if (playButton) {
        event.stopPropagation();
        togglePlayback(playButton.dataset.play);
        return;
      }
      const card = event.target.closest("[data-clip-id]");
      if (card) selectClip(card.dataset.clipId);
    });

    refs.signalGrid.addEventListener("keydown", (event) => {
      if (event.target.closest("button")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-clip-id]");
      if (!card) return;
      event.preventDefault();
      selectClip(card.dataset.clipId);
    });

    refs.groupList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-group-action]");
      if (!button || button.disabled) return;
      const index = Number(button.dataset.groupIndex);
      if (button.dataset.groupAction === "swap") swapGroup(index);
      if (button.dataset.groupAction === "remove") removeGroup(index);
    });

    refs.submitButton.addEventListener("click", () => {
      if (filledGroupCount() < 3) {
        showToast("请先将六个信号完整归入三组。");
        return;
      }
      showResults();
    });
    refs.resetButton.addEventListener("click", resetArchive);
    refs.resultRetry.addEventListener("click", retryArchive);
    window.addEventListener("resize", drawAllSpectra);
  }

  async function synthesizeAllClips() {
    for (const clip of CLIPS) {
      clip.buffer = await synthesizeClip(clip);
      clip.analysis = analyzeBuffer(clip.buffer);
      clip.envelope = envelopeSignature(clip.buffer);
      drawSpectrum(clip);
    }
    state.ready = true;
    refs.protocolState.textContent = "SIGNALS READY";
    updatePlaybackButtons();
    renderGroups();
    showToast("六段信号合成完毕。点击卡片开始配对。");
  }

  async function init() {
    createCards();
    renderGroups();
    updateQueue();
    updatePlaybackButtons();
    bindEvents();
    startClock();
    const connectionLoop = (time) => {
      drawConnectionCanvas(time);
      requestAnimationFrame(connectionLoop);
    };
    requestAnimationFrame(connectionLoop);
    try {
      await synthesizeAllClips();
    } catch (error) {
      console.error("Audio synthesis failed", error);
      refs.protocolState.textContent = "SYNTHESIS ERROR";
      showToast("音频合成失败，请使用支持 Web Audio 的现代浏览器。");
    }
  }

  init();
})();
