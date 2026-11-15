// Audio scene engine: manages AudioNode lifecycles to prevent leaks.
const nodeRegistry = new Set();

export function activeNodeCount() {
  return nodeRegistry.size;
}

function track(node) {
  nodeRegistry.add(node);
  return node;
}

function untrack(node) {
  nodeRegistry.delete(node);
}

class Scene {
  constructor(context, name, destination) {
    this.context = context;
    this.name = name;
    this.destination = destination;
    this.nodes = [];
    this.sources = [];
    this.timers = [];
    this.abort = new AbortController();
    this.disposed = false;
    this.output = this.addNode(context.createGain());
    this.output.gain.value = 0.5;
    this.output.connect(destination);
  }

  addNode(node) {
    this.nodes.push(node);
    return track(node);
  }

  addSource(node) {
    this.addNode(node);
    this.sources.push(node);
    return node;
  }

  addTimer(id) {
    this.timers.push(id);
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, {
      ...options,
      signal: this.abort.signal,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const id of this.timers) clearInterval(id);
    this.timers.length = 0;
    for (const src of this.sources) {
      try {
        src.onended = null;
        src.stop();
      } catch (_) {}
    }
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch (_) {}
      untrack(node);
    }
    this.nodes.length = 0;
    this.sources.length = 0;
  }
}

function buildRainScene(scene) {
  const ctx = scene.context;
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noise = scene.addSource(ctx.createBufferSource());
  noise.buffer = buffer;
  noise.loop = true;

  const lowpass = scene.addNode(ctx.createBiquadFilter());
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 900;

  const delay = scene.addNode(ctx.createDelay(1));
  delay.delayTime.value = 0.27;
  const feedback = scene.addNode(ctx.createGain());
  feedback.gain.value = 0.35;

  noise.connect(lowpass).connect(scene.output);
  lowpass.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(scene.output);
  noise.start();
}

function buildForestScene(scene) {
  const ctx = scene.context;
  const baseFreqs = [220, 277, 330];
  for (const freq of baseFreqs) {
    const osc = scene.addSource(ctx.createOscillator());
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = scene.addNode(ctx.createGain());
    gain.gain.value = 0.08;
    const panner = scene.addNode(ctx.createStereoPanner());
    panner.pan.value = Math.random() * 2 - 1;
    osc.connect(gain).connect(panner).connect(scene.output);
    osc.start();
  }
  const lfo = scene.addSource(ctx.createOscillator());
  lfo.frequency.value = 0.2;
  const lfoGain = scene.addNode(ctx.createGain());
  lfoGain.gain.value = 0.5;
  lfo.connect(lfoGain);
  for (const node of scene.nodes) {
    if (node instanceof StereoPannerNode) lfoGain.connect(node.pan);
  }
  lfo.start();
}

function buildCityScene(scene) {
  const ctx = scene.context;
  const osc = scene.addSource(ctx.createOscillator());
  osc.type = 'sawtooth';
  osc.frequency.value = 55;
  const filter = scene.addNode(ctx.createBiquadFilter());
  filter.type = 'bandpass';
  filter.frequency.value = 300;
  const delay = scene.addNode(ctx.createDelay(1));
  delay.delayTime.value = 0.18;
  const feedback = scene.addNode(ctx.createGain());
  feedback.gain.value = 0.45;
  osc.connect(filter).connect(scene.output);
  filter.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(scene.output);
  osc.start();

  const timer = setInterval(() => {
    filter.frequency.setTargetAtTime(200 + Math.random() * 600, ctx.currentTime, 0.1);
  }, 2000);
  scene.addTimer(timer);
}

const SCENES = {
  rain: buildRainScene,
  forest: buildForestScene,
  city: buildCityScene,
};

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.scene = null;
    this.rebuildCount = 0;
    this.abort = new AbortController();
  }

  ensureContext() {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.context.destination);
    track(this.master);
    this.context.addEventListener(
      'statechange',
      () => this.onStateChange?.(this.context.state),
      { signal: this.abort.signal }
    );
  }

  start(sceneName) {
    this.ensureContext();
    this.stopScene();
    this.scene = new Scene(this.context, sceneName, this.master);
    SCENES[sceneName](this.scene);
    if (this.context.state === 'suspended') this.context.resume();
    return this.scene;
  }

  stopScene() {
    if (!this.scene) return;
    this.scene.dispose();
    this.scene = null;
  }

  switchTo(sceneName) {
    return this.start(sceneName);
  }

  async pause() {
    if (this.context && this.context.state === 'running') {
      await this.context.suspend();
    }
  }

  async resume() {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  rebuild() {
    const name = this.scene ? this.scene.name : 'rain';
    this.rebuildCount++;
    return this.start(name);
  }

  destroy() {
    this.stopScene();
    this.abort.abort();
    if (this.master) {
      this.master.disconnect();
      untrack(this.master);
      this.master = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }
}
