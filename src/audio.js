export class PortAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.hum = null;
    this.servo = null;
    this.noise = null;
    this.warning = null;
    this.muted = false;
    this.lastLoad = -1;
    this.lastBlocked = null;
  }

  async start() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.master.connect(this.context.destination);

    const humFilter = this.context.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 340;
    humFilter.Q.value = 1.2;
    humFilter.connect(this.master);
    this.humFilter = humFilter;

    this.hum = this.context.createOscillator();
    this.hum.type = "sine";
    this.hum.frequency.value = 54;
    const humGain = this.context.createGain();
    humGain.gain.value = 0.032;
    this.hum.connect(humGain);
    humGain.connect(humFilter);
    this.humGain = humGain;

    const overtone = this.context.createOscillator();
    overtone.type = "triangle";
    overtone.frequency.value = 83;
    const overtoneGain = this.context.createGain();
    overtoneGain.gain.value = 0.012;
    overtone.connect(overtoneGain);
    overtoneGain.connect(humFilter);
    this.overtone = overtone;

    const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.96 + white * 0.04;
      data[index] = previous * 3;
    }
    this.noise = this.context.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;
    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 320;
    noiseFilter.Q.value = 0.7;
    const noiseGain = this.context.createGain();
    noiseGain.gain.value = 0.045;
    this.noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);
    this.noiseFilter = noiseFilter;
    this.noiseGain = noiseGain;

    this.servo = this.context.createOscillator();
    this.servo.type = "sawtooth";
    this.servo.frequency.value = 188;
    const servoFilter = this.context.createBiquadFilter();
    servoFilter.type = "lowpass";
    servoFilter.frequency.value = 440;
    const servoGain = this.context.createGain();
    servoGain.gain.value = 0;
    this.servo.connect(servoFilter);
    servoFilter.connect(servoGain);
    servoGain.connect(this.master);
    this.servoGain = servoGain;
    this.servoFilter = servoFilter;

    this.warning = this.context.createOscillator();
    this.warning.type = "square";
    this.warning.frequency.value = 430;
    const warningFilter = this.context.createBiquadFilter();
    warningFilter.type = "lowpass";
    warningFilter.frequency.value = 850;
    const warningGain = this.context.createGain();
    warningGain.gain.value = 0;
    this.warning.connect(warningFilter);
    warningFilter.connect(warningGain);
    warningGain.connect(this.master);
    this.warningGain = warningGain;
    this.warningFilter = warningFilter;

    const now = this.context.currentTime;
    this.hum.start(now);
    overtone.start(now);
    this.noise.start(now);
    this.servo.start(now);
    this.warning.start(now);
  }

  setLoad(load, blocked = false, busyCranes = 0) {
    if (!this.context) return;
    const safeLoad = Math.max(0, Math.min(1, load));
    if (Math.abs(safeLoad - this.lastLoad) < 0.025 && blocked === this.lastBlocked) return;
    this.lastLoad = safeLoad;
    this.lastBlocked = blocked;

    const now = this.context.currentTime;
    const ramp = 0.28;
    this.hum.frequency.setTargetAtTime(48 + safeLoad * 32, now, ramp);
    this.overtone.frequency.setTargetAtTime(76 + safeLoad * 24, now, ramp);
    this.humFilter.frequency.setTargetAtTime(280 + safeLoad * 980, now, ramp);
    this.humGain.gain.setTargetAtTime(0.022 + safeLoad * 0.024, now, ramp);
    this.noiseFilter.frequency.setTargetAtTime(280 + safeLoad * 820, now, ramp);
    this.noiseGain.gain.setTargetAtTime(0.026 + safeLoad * 0.052, now, ramp);
    this.servo.frequency.setTargetAtTime(155 + safeLoad * 130 + busyCranes * 13, now, 0.2);
    this.servoFilter.frequency.setTargetAtTime(360 + safeLoad * 720, now, ramp);
    this.servoGain.gain.setTargetAtTime(0.006 + safeLoad * 0.019, now, ramp);
    this.warning.frequency.setTargetAtTime(blocked ? 220 : 430, now, 0.08);
    this.warningGain.gain.setTargetAtTime(blocked ? 0.014 : 0, now, 0.08);
  }

  note(type) {
    if (!this.context || this.muted) return;
    const map = {
      dispatch: [392, 0.05],
      success: [587, 0.18],
      warning: [174, 0.16],
      failure: [110, 0.3],
    };
    const [frequency, duration] = map[type] || map.dispatch;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type === "failure" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    if (type === "success") oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + duration);
    if (type === "failure") oscillator.frequency.exponentialRampToValueAtTime(58, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.04);
  }
}
