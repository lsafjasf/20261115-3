export class AirspaceAudio {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.context = null;
    this.enabled = false;
    this.nodes = null;
    this.nextPulseAt = 0;
    this.nextAlarmAt = 0;
    this.lastConflict = false;
  }

  async ensure() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.nodes = this.createNodes();
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.onStatus({ enabled: true, detail: "AUDIO LIVE" });
    return true;
  }

  createNodes() {
    const ctx = this.context;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const densityGain = ctx.createGain();
    densityGain.gain.value = 0.08;
    densityGain.connect(master);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.32;
    droneGain.connect(densityGain);

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 180;
    droneFilter.Q.value = 0.7;
    droneFilter.connect(droneGain);

    const low = ctx.createOscillator();
    low.type = "sine";
    low.frequency.value = 48;
    low.connect(droneFilter);
    low.start();

    const high = ctx.createOscillator();
    high.type = "triangle";
    high.frequency.value = 96;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.13;
    high.connect(highGain);
    highGain.connect(droneFilter);
    high.start();

    const airGain = ctx.createGain();
    airGain.gain.value = 0.028;
    airGain.connect(densityGain);
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 760;
    airFilter.Q.value = 0.55;
    airFilter.connect(airGain);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    let seed = 47;
    for (let i = 0; i < samples.length; i += 1) {
      seed = (seed * 16807) % 2147483647;
      samples[i] = (seed / 2147483647) * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noise.connect(airFilter);
    noise.start();

    return {
      master,
      densityGain,
      droneFilter,
      airFilter,
      low,
      high
    };
  }

  async setEnabled(enabled) {
    if (enabled) return this.ensure();
    this.enabled = false;
    if (this.context) await this.context.suspend();
    this.onStatus({ enabled: false, detail: "AUDIO STANDBY" });
    return false;
  }

  async toggle() {
    return this.setEnabled(!this.enabled);
  }

  update({ density = 0, holding = 0, airborne = 0, conflict = false, active = false }) {
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const normalized = Math.max(0, Math.min(1, density));
    const hasSignal = this.enabled && active;
    const targetMaster = hasSignal ? 0.12 + normalized * 0.11 : 0.0001;
    this.nodes.master.gain.setTargetAtTime(targetMaster, now, 0.22);
    this.nodes.droneFilter.frequency.setTargetAtTime(
      130 + normalized * 230 + holding * 13,
      now,
      0.3
    );
    this.nodes.airFilter.frequency.setTargetAtTime(
      620 + normalized * 720,
      now,
      0.35
    );
    this.nodes.densityGain.gain.setTargetAtTime(
      0.045 + normalized * 0.09,
      now,
      0.3
    );

    if (!hasSignal) {
      this.lastConflict = false;
      return;
    }

    if (conflict) {
      if (!this.lastConflict) this.nextAlarmAt = now;
      if (now >= this.nextAlarmAt) {
        this.playAlarm(now);
        this.nextAlarmAt = now + 0.32;
      }
    } else if (now >= this.nextPulseAt) {
      this.playPulse(now, 0.2 + normalized * 0.32);
      this.nextPulseAt = now + 2.1 - normalized * 1.35 - holding * 0.08;
    }
    this.lastConflict = conflict;
    this.onStatus({
      enabled: true,
      detail: conflict
        ? "CONFLICT ALERT"
        : `DENSITY ${normalized.toFixed(2)} · ${Math.round(airborne)} ACFT`
    });
  }

  playPulse(time, strength) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(430 + strength * 360, time);
    oscillator.frequency.exponentialRampToValueAtTime(210, time + 0.14);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.045 * strength, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    oscillator.connect(gain);
    gain.connect(this.nodes.master);
    oscillator.start(time);
    oscillator.stop(time + 0.22);
  }

  playAlarm(time) {
    const ctx = this.context;
    for (let i = 0; i < 2; i += 1) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = i === 0 ? 690 : 530;
      gain.gain.setValueAtTime(0.0001, time + i * 0.075);
      gain.gain.exponentialRampToValueAtTime(0.028, time + i * 0.075 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + i * 0.075 + 0.06);
      oscillator.connect(gain);
      gain.connect(this.nodes.master);
      oscillator.start(time + i * 0.075);
      oscillator.stop(time + i * 0.075 + 0.07);
    }
  }

  playEvent(tone) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    if (tone === "safe") {
      this.playPulse(now, 0.6);
    } else if (tone === "danger") {
      this.playAlarm(now);
    }
  }
}
