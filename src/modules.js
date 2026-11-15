// 模块化音效链路：oscillator / noise / envelope / filter
// 所有创建的 AudioNode 都登记到 NodeRegistry，dispose 时逐一停止并断开，
// 保证切换音效后无残留声音、无节点占用处理器。

export class NodeRegistry {
  constructor() {
    this.nodes = new Set();
  }
  track(node) {
    this.nodes.add(node);
    return node;
  }
  release(node) {
    this.nodes.delete(node);
  }
  get count() {
    return this.nodes.size;
  }
}

let cachedNoiseBuffer = null;
let cachedNoiseCtx = null;

function getNoiseBuffer(ctx) {
  if (cachedNoiseCtx === ctx && cachedNoiseBuffer) return cachedNoiseBuffer;
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  cachedNoiseCtx = ctx;
  cachedNoiseBuffer = buffer;
  return buffer;
}

function applyEnvelope(param, env, t, hitLength) {
  const peak = env.peak ?? 1;
  const sustain = (env.sustain ?? 0) * peak;
  const attack = Math.max(env.attack ?? 0.005, 0.001);
  const decay = Math.max(env.decay ?? 0.05, 0.001);
  const release = Math.max(env.release ?? 0.05, 0.001);
  const holdEnd = t + Math.max(hitLength - release, attack + decay);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + attack);
  param.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + attack + decay);
  param.setValueAtTime(Math.max(sustain, 0.0001), holdEnd);
  param.exponentialRampToValueAtTime(0.0001, holdEnd + release);
}

// def = { duration, hits?: number[], hitLength?: number, modules: [...] }
// 返回链句柄：{ start, stop, dispose, nodes, output }
export function buildChain(ctx, def, registry) {
  const nodes = [];
  const sources = [];
  const envelopes = [];
  const track = (n) => {
    registry.track(n);
    nodes.push(n);
    return n;
  };

  const processors = [];
  for (const m of def.modules) {
    if (m.type === 'osc') {
      const osc = track(ctx.createOscillator());
      osc.type = m.wave || 'sine';
      osc.frequency.value = m.freq ?? 440;
      if (m.freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(m.freqEnd, 1),
          ctx.currentTime + (m.glide ?? def.duration)
        );
      }
      if (m.detune) osc.detune.value = m.detune;
      const gain = track(ctx.createGain());
      gain.gain.value = m.gain ?? 1;
      osc.connect(gain);
      sources.push({ node: osc, output: gain });
    } else if (m.type === 'noise') {
      const src = track(ctx.createBufferSource());
      src.buffer = getNoiseBuffer(ctx);
      src.loop = true;
      const gain = track(ctx.createGain());
      gain.gain.value = m.gain ?? 1;
      src.connect(gain);
      sources.push({ node: src, output: gain });
    } else if (m.type === 'filter') {
      const f = track(ctx.createBiquadFilter());
      f.type = m.mode || 'lowpass';
      f.frequency.value = m.freq ?? 1000;
      f.Q.value = m.q ?? 1;
      if (m.freqEnd) {
        f.frequency.exponentialRampToValueAtTime(
          Math.max(m.freqEnd, 1),
          ctx.currentTime + (m.glide ?? def.duration)
        );
      }
      processors.push(f);
    } else if (m.type === 'envelope') {
      const g = track(ctx.createGain());
      g.gain.value = 0;
      processors.push(g);
      envelopes.push({ gain: g, env: m });
    }
  }

  const out = track(ctx.createGain());
  out.gain.value = def.gain ?? 1;

  let head = null;
  for (const p of processors) {
    if (head) head.connect(p);
    else head = p;
  }
  const tail = processors.length ? processors[processors.length - 1] : null;
  for (const s of sources) {
    if (head) s.output.connect(head);
    else s.output.connect(out);
  }
  if (tail) tail.connect(out);

  const hits = def.hits && def.hits.length ? def.hits : [0];
  const hitLength = def.hitLength ?? def.duration;

  return {
    nodes,
    output: out,
    start(t0) {
      const t = t0 ?? ctx.currentTime;
      for (const { gain, env } of envelopes) {
        for (const h of hits) applyEnvelope(gain.gain, env, t + h, hitLength);
      }
      const stopAt = t + hits[hits.length - 1] + hitLength + 0.1;
      for (const s of sources) {
        s.node.start(t);
        s.node.stop(stopAt);
      }
    },
    stop() {
      for (const s of sources) {
        try { s.node.stop(); } catch (_) { /* 未启动则忽略 */ }
      }
    },
    dispose() {
      this.stop();
      for (const n of nodes) {
        try { n.disconnect(); } catch (_) { /* 已断开则忽略 */ }
        registry.release(n);
      }
      nodes.length = 0;
    },
  };
}
