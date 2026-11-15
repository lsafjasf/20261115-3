export class AudioEngine {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.master = null;
    this.rainGain = null;
    this.rainFilter = null;
    this.busGain = null;
    this.busOscillator = null;
    this.pumps = new Map();
  }

  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    }
    await this.enable();
    return this.enabled;
  }

  async enable() {
    try {
      if (!this.context) this.build();
      await this.context.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(0.5, this.context.currentTime, 0.12);
    } catch {
      this.enabled = false;
    }
  }

  disable() {
    this.enabled = false;
    if (this.context) {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
    }
  }

  build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const rainBuffer = this.context.createBuffer(
      1,
      Math.floor(this.context.sampleRate * 2.5),
      this.context.sampleRate
    );
    const samples = rainBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.965 + white * 0.035;
      samples[index] = last * 3.2;
    }
    const rainSource = this.context.createBufferSource();
    rainSource.buffer = rainBuffer;
    rainSource.loop = true;
    this.rainFilter = this.context.createBiquadFilter();
    this.rainFilter.type = 'lowpass';
    this.rainFilter.frequency.value = 700;
    this.rainGain = this.context.createGain();
    this.rainGain.gain.value = 0.04;
    rainSource.connect(this.rainFilter);
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.master);
    rainSource.start();

    this.busGain = this.context.createGain();
    this.busGain.gain.value = 0.006;
    this.busOscillator = this.context.createOscillator();
    this.busOscillator.type = 'sine';
    this.busOscillator.frequency.value = 50;
    const busFilter = this.context.createBiquadFilter();
    busFilter.type = 'lowpass';
    busFilter.frequency.value = 150;
    this.busOscillator.connect(busFilter);
    busFilter.connect(this.busGain);
    this.busGain.connect(this.master);
    this.busOscillator.start();

    ['A', 'B', 'C'].forEach((id, index) => {
      const group = this.context.createGain();
      group.gain.value = 0;
      const panner = this.context.createStereoPanner();
      panner.pan.value = [-0.45, 0, 0.45][index];
      const fundamental = this.context.createOscillator();
      fundamental.type = 'triangle';
      fundamental.frequency.value = 52 + index * 7;
      const harmonic = this.context.createOscillator();
      harmonic.type = 'sine';
      harmonic.frequency.value = 96 + index * 12;
      const overtoneGain = this.context.createGain();
      overtoneGain.gain.value = 0.24;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      fundamental.connect(filter);
      harmonic.connect(overtoneGain);
      overtoneGain.connect(filter);
      filter.connect(group);
      group.connect(panner);
      panner.connect(this.master);
      fundamental.start();
      harmonic.start();
      this.pumps.set(id, {
        group,
        fundamental,
        harmonic,
        filter,
        panner
      });
    });
  }

  update(state) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const rain = 0.035 + Math.min(1, state.storm.rain / 120) * 0.14;
    this.rainGain.gain.setTargetAtTime(rain, now, 0.35);
    this.rainFilter.frequency.setTargetAtTime(
      620 + Math.min(1, state.storm.rain / 120) * 450,
      now,
      0.3
    );

    const loadRatio = Math.min(1.25, state.bus.loadPct / 100);
    this.busGain.gain.setTargetAtTime(
      state.bus.tripped ? 0 : 0.004 + loadRatio * 0.018,
      now,
      0.25
    );
    this.busOscillator.frequency.setTargetAtTime(
      46 + loadRatio * 15,
      now,
      0.2
    );

    for (const [id, nodes] of this.pumps) {
      const pump = state.pumps[id];
      const flowRatio = Math.min(1, pump.flow / pump.maxFlow);
      const active = pump.running && !state.bus.tripped;
      const target = active ? 0.012 + flowRatio * 0.07 : 0;
      nodes.group.gain.setTargetAtTime(target, now, 0.18);
      nodes.fundamental.frequency.setTargetAtTime(
        31 + pump.speed * 0.52 + flowRatio * 7,
        now,
        0.18
      );
      nodes.harmonic.frequency.setTargetAtTime(
        62 + pump.speed * 1.08 + flowRatio * 9,
        now,
        0.18
      );
      nodes.filter.frequency.setTargetAtTime(
        135 + flowRatio * 105,
        now,
        0.2
      );
      nodes.panner.pan.setTargetAtTime(
        [-0.45, 0, 0.45][['A', 'B', 'C'].indexOf(id)],
        now,
        0.3
      );
    }
  }
}
