export class FanAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.nodes = null;
  }

  async toggle() {
    if (!this.context) this.create();
    if (!this.context) return false;
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = !this.enabled;
    this.setLevel();
    return this.enabled;
  }

  create() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const lowHum = context.createOscillator();
    const humGain = context.createGain();
    lowHum.type = "sine";
    lowHum.frequency.value = 62;
    humGain.gain.value = 0.018;
    lowHum.connect(humGain).connect(master);

    const motor = context.createOscillator();
    const motorGain = context.createGain();
    motor.type = "triangle";
    motor.frequency.value = 118;
    motorGain.gain.value = 0.012;
    motor.connect(motorGain).connect(master);

    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.82 + white * 0.18;
      channel[index] = previous;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const airFilter = context.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 460;
    airFilter.Q.value = 0.6;
    const airGain = context.createGain();
    airGain.gain.value = 0.04;
    noise.connect(airFilter).connect(airGain).connect(master);

    lowHum.start();
    motor.start();
    noise.start();
    this.context = context;
    this.nodes = { master, lowHum, motor, noise, airFilter, airGain, motorGain, humGain };
  }

  update(avgFan, coolant, chillerOnline) {
    this.fan = avgFan;
    this.coolant = coolant;
    this.chillerOnline = chillerOnline;
    this.setLevel();
  }

  setLevel() {
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const fan = this.fan ?? 65;
    const coolant = this.coolant ?? 64;
    const target = this.enabled ? 0.82 : 0;
    const hum = this.nodes;

    hum.master.gain.setTargetAtTime(target, now, 0.08);
    hum.lowHum.frequency.setTargetAtTime(42 + fan * 0.42, now, 0.16);
    hum.motor.frequency.setTargetAtTime(74 + fan * 1.55, now, 0.16);
    hum.motorGain.gain.setTargetAtTime(0.006 + fan * 0.00013, now, 0.16);
    hum.airFilter.frequency.setTargetAtTime(280 + fan * 7 + coolant * 1.8, now, 0.2);
    hum.airGain.gain.setTargetAtTime(0.014 + fan * 0.00038, now, 0.16);
    hum.humGain.gain.setTargetAtTime(this.chillerOnline ? 0.012 : 0.007, now, 0.25);
  }
}
