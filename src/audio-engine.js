(function () {
  "use strict";

  const Model = window.MixerModel;
  const LIMITER_CEILING_DB = -1.2;
  const MASTER_CEILING = Model.dbToGain(LIMITER_CEILING_DB) / Model.softLimit(1);

  function makeSoftClipCurve(size) {
    const curve = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      const input = (index / (size - 1)) * 2 - 1;
      curve[index] = Model.softLimit(input);
    }
    return curve;
  }

  function createMasterChain(context) {
    const input = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const guard = context.createWaveShaper();
    const ceiling = context.createGain();

    input.gain.value = 1;
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    guard.curve = makeSoftClipCurve(8192);
    guard.oversample = "none";
    ceiling.gain.value = MASTER_CEILING;

    input.connect(compressor);
    compressor.connect(guard);
    guard.connect(ceiling);

    return { input, compressor, guard, ceiling };
  }

  function scheduleAutomation(param, settings, audioStart, sourceOffset) {
    const points = settings.automation;
    const pointA = points[0];
    const pointB = points[1];
    param.cancelScheduledValues(audioStart);

    if (!pointA || !pointB) {
      param.setValueAtTime(1, audioStart);
      return;
    }

    const startGain = Model.automationGainAt(settings, sourceOffset);
    param.setValueAtTime(startGain, audioStart);

    if (sourceOffset < pointA.time) {
      param.setValueAtTime(
        Model.dbToGain(pointA.gainDb),
        audioStart + (pointA.time - sourceOffset)
      );
    }

    if (sourceOffset < pointB.time) {
      param.linearRampToValueAtTime(
        Model.dbToGain(pointB.gainDb),
        audioStart + (pointB.time - sourceOffset)
      );
    } else {
      param.setValueAtTime(Model.dbToGain(pointB.gainDb), audioStart);
    }
  }

  function createTrackChain(context, settings, trackId) {
    const input = context.createGain();
    const volume = context.createGain();
    const automation = context.createGain();
    const panner = context.createStereoPanner();
    const lowpass = context.createBiquadFilter();
    const mute = context.createGain();

    volume.gain.value = Model.dbToGain(settings.volumeDb);
    automation.gain.value = Model.automationGainAt(settings, 0);
    panner.pan.value = settings.pan;
    lowpass.type = "lowpass";
    lowpass.frequency.value = settings.cutoff;
    lowpass.Q.value = 0.72;
    mute.gain.value = settings.mute ? 0 : 1;

    input.connect(volume);
    volume.connect(automation);
    automation.connect(panner);
    panner.connect(lowpass);
    lowpass.connect(mute);

    return { input, volume, automation, panner, lowpass, mute, trackId };
  }

  function buildAudioBuffer(context, pcm) {
    const buffer = context.createBuffer(1, pcm.length, context.sampleRate);
    buffer.copyToChannel(pcm, 0);
    return buffer;
  }

  class MixerEngine {
    constructor() {
      this.settings = Model.cloneSettings();
      this.playhead = 0;
      this.isPlaying = false;
      this.context = null;
      this.contextPromise = null;
      this.sources = [];
      this.trackChains = new Map();
      this.liveBuffers = new Map();
      this.pcmCache = new Map();
      this.audioStart = 0;
      this.sourceOffset = 0;
      this.master = null;
      this.meter = null;
      this.lastMeter = { left: 0, right: 0, peak: 0 };
      this.onStateChange = null;
    }

    notify() {
      if (typeof this.onStateChange === "function") {
        this.onStateChange(this.getState());
      }
    }

    getState() {
      return {
        playing: this.isPlaying,
        playhead: this.getPosition(),
        duration: Model.DURATION,
        contextState: this.context ? this.context.state : "idle"
      };
    }

    getPcmStems(sampleRate) {
      if (!this.pcmCache.has(sampleRate)) {
        this.pcmCache.set(sampleRate, Model.createStems(sampleRate));
      }
      return this.pcmCache.get(sampleRate);
    }

    async ensureContext() {
      if (this.context) return this.context;
      if (this.contextPromise) return this.contextPromise;

      this.contextPromise = (async () => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("当前浏览器不支持 Web Audio API");
        }

        try {
          this.context = new AudioContextClass({
            sampleRate: Model.PREFERRED_SAMPLE_RATE,
            latencyHint: "interactive"
          });
        } catch (error) {
          this.context = new AudioContextClass({ latencyHint: "interactive" });
        }

        const context = this.context;
        const master = createMasterChain(context);
        master.ceiling.connect(context.destination);

        const splitter = context.createChannelSplitter(2);
        const analyserLeft = context.createAnalyser();
        const analyserRight = context.createAnalyser();
        analyserLeft.fftSize = 1024;
        analyserRight.fftSize = 1024;
        master.ceiling.connect(splitter);
        splitter.connect(analyserLeft, 0);
        splitter.connect(analyserRight, 1);

        this.master = master;
        this.meter = {
          splitter,
          left: analyserLeft,
          right: analyserRight,
          leftBuffer: new Float32Array(analyserLeft.fftSize),
          rightBuffer: new Float32Array(analyserRight.fftSize)
        };

        const stems = this.getPcmStems(context.sampleRate);
        for (const track of Model.TRACKS) {
          const chain = createTrackChain(context, this.settings[track.id], track.id);
          chain.mute.connect(master.input);
          this.trackChains.set(track.id, chain);
          this.liveBuffers.set(track.id, buildAudioBuffer(context, stems[track.id]));
        }

        context.onstatechange = () => this.notify();
        return context;
      })();

      return this.contextPromise;
    }

    async play() {
      if (this.isPlaying) return;
      if (this.playhead >= Model.DURATION - 0.001) {
        this.playhead = 0;
      }

      const context = await this.ensureContext();
      if (context.state === "suspended") {
        await context.resume();
      }

      this.stopSources();
      this.applyAllSettings(false);

      const now = context.currentTime;
      this.audioStart = now + 0.025;
      this.sourceOffset = this.playhead;
      this.isPlaying = true;

      for (const track of Model.TRACKS) {
        const chain = this.trackChains.get(track.id);
        const source = context.createBufferSource();
        source.buffer = this.liveBuffers.get(track.id);
        source.connect(chain.input);
        source.start(this.audioStart, this.sourceOffset, Model.DURATION - this.sourceOffset);
        source.onended = () => {
          if (this.isPlaying && this.getPosition() >= Model.DURATION - 0.02) {
            this.finishPlayback();
          }
        };
        this.sources.push(source);
        scheduleAutomation(
          chain.automation.gain,
          this.settings[track.id],
          this.audioStart,
          this.sourceOffset
        );
      }

      this.notify();
    }

    finishPlayback() {
      if (!this.isPlaying) return;
      this.playhead = Model.DURATION;
      this.stopSources();
      this.isPlaying = false;
      this.lastMeter = { left: 0, right: 0, peak: 0 };
      this.notify();
    }

    stopSources() {
      for (const source of this.sources) {
        source.onended = null;
        try {
          source.stop();
        } catch (error) {
          // A source may already have ended; stopping it again is harmless.
        }
        try {
          source.disconnect();
        } catch (error) {
          // The node may already be disconnected.
        }
      }
      this.sources = [];
    }

    getPosition() {
      if (!this.isPlaying || !this.context) return this.playhead;
      const elapsed = this.context.currentTime - this.audioStart;
      return Model.clamp(this.sourceOffset + Math.max(0, elapsed), 0, Model.DURATION);
    }

    pause() {
      if (!this.isPlaying) return this.playhead;
      this.playhead = this.getPosition();
      this.isPlaying = false;
      this.stopSources();

      for (const track of Model.TRACKS) {
        const chain = this.trackChains.get(track.id);
        if (!chain) continue;
        const now = this.context.currentTime;
        chain.automation.gain.cancelScheduledValues(now);
        chain.automation.gain.setValueAtTime(
          Model.automationGainAt(this.settings[track.id], this.playhead),
          now
        );
      }

      this.lastMeter = { left: 0, right: 0, peak: 0 };
      this.notify();
      return this.playhead;
    }

    async toggle() {
      if (this.isPlaying) {
        this.pause();
      } else {
        await this.play();
      }
    }

    async seek(time) {
      const target = Model.clamp(time, 0, Model.DURATION);
      const wasPlaying = this.isPlaying;
      if (wasPlaying) this.pause();
      this.playhead = target;
      this.applyAutomationPreview();
      this.notify();
      if (wasPlaying) await this.play();
    }

    applyAutomationPreview() {
      if (this.isPlaying || !this.context) return;
      const now = this.context.currentTime;
      for (const track of Model.TRACKS) {
        const chain = this.trackChains.get(track.id);
        if (!chain) continue;
        chain.automation.gain.cancelScheduledValues(now);
        chain.automation.gain.setValueAtTime(
          Model.automationGainAt(this.settings[track.id], this.playhead),
          now
        );
      }
    }

    applyAllSettings(scheduleFromPlayhead) {
      if (!this.context) return;
      const now = this.context.currentTime;
      for (const track of Model.TRACKS) {
        const chain = this.trackChains.get(track.id);
        const settings = this.settings[track.id];
        if (!chain) continue;
        chain.volume.gain.cancelScheduledValues(now);
        chain.volume.gain.setValueAtTime(Model.dbToGain(settings.volumeDb), now);
        chain.panner.pan.cancelScheduledValues(now);
        chain.panner.pan.setValueAtTime(settings.pan, now);
        chain.lowpass.frequency.cancelScheduledValues(now);
        chain.lowpass.frequency.setValueAtTime(settings.cutoff, now);
        chain.mute.gain.cancelScheduledValues(now);
        chain.mute.gain.setValueAtTime(settings.mute ? 0 : 1, now);

        if (scheduleFromPlayhead) {
          scheduleAutomation(chain.automation.gain, settings, now, this.playhead);
        } else {
          chain.automation.gain.cancelScheduledValues(now);
          chain.automation.gain.setValueAtTime(
            Model.automationGainAt(settings, this.playhead),
            now
          );
        }
      }
    }

    setTrackSetting(trackId, key, value) {
      const settings = this.settings[trackId];
      if (!settings || !(key in settings) || key === "automation") return;
      settings[key] = value;
      const chain = this.trackChains.get(trackId);
      if (!chain || !this.context) return;
      const now = this.context.currentTime;

      if (key === "volumeDb") {
        chain.volume.gain.cancelScheduledValues(now);
        chain.volume.gain.setTargetAtTime(Model.dbToGain(value), now, 0.012);
      } else if (key === "pan") {
        chain.panner.pan.cancelScheduledValues(now);
        chain.panner.pan.setTargetAtTime(value, now, 0.012);
      } else if (key === "cutoff") {
        chain.lowpass.frequency.cancelScheduledValues(now);
        chain.lowpass.frequency.setTargetAtTime(value, now, 0.012);
      } else if (key === "mute") {
        chain.mute.gain.cancelScheduledValues(now);
        chain.mute.gain.setTargetAtTime(value ? 0 : 1, now, 0.012);
      }
    }

    setAutomationPoint(trackId, pointIndex, time, gainDb) {
      const settings = this.settings[trackId];
      if (!settings || !settings.automation[pointIndex]) return;
      settings.automation[pointIndex] = {
        time: Model.clamp(time, 0, Model.DURATION),
        gainDb: Model.clamp(gainDb, Model.MIN_AUTOMATION_DB, Model.MAX_AUTOMATION_DB)
      };

      const chain = this.trackChains.get(trackId);
      if (!chain || !this.context) return;
      const now = this.context.currentTime;
      chain.automation.gain.cancelScheduledValues(now);
      chain.automation.gain.setValueAtTime(chain.automation.gain.value, now);
      if (this.isPlaying) {
        scheduleAutomation(chain.automation.gain, settings, now, this.getPosition());
      } else {
        chain.automation.gain.setValueAtTime(
          Model.automationGainAt(settings, this.playhead),
          now
        );
      }
    }

    getMeterData() {
      if (!this.meter || !this.isPlaying) {
        return { leftDb: -Infinity, rightDb: -Infinity, peakDb: -Infinity, reduction: 0 };
      }

      const leftData = this.meter.leftBuffer;
      const rightData = this.meter.rightBuffer;
      this.meter.left.getFloatTimeDomainData(leftData);
      this.meter.right.getFloatTimeDomainData(rightData);

      let leftPeak = 0;
      let rightPeak = 0;
      for (let index = 0; index < leftData.length; index += 1) {
        leftPeak = Math.max(leftPeak, Math.abs(leftData[index]));
        rightPeak = Math.max(rightPeak, Math.abs(rightData[index]));
      }
      this.lastMeter = { left: leftPeak, right: rightPeak, peak: Math.max(leftPeak, rightPeak) };

      return {
        leftDb: leftPeak > 0 ? 20 * Math.log10(leftPeak) : -Infinity,
        rightDb: rightPeak > 0 ? 20 * Math.log10(rightPeak) : -Infinity,
        peakDb: this.lastMeter.peak > 0 ? 20 * Math.log10(this.lastMeter.peak) : -Infinity,
        reduction: this.master ? this.master.compressor.reduction : 0
      };
    }

    async renderMix(options) {
      const settings = options || {};
      const bitDepth = settings.bitDepth || 16;
      const sampleRate = settings.sampleRate || Model.PREFERRED_SAMPLE_RATE;
      const frameCount = Math.round(Model.DURATION * sampleRate);
      const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineContextClass) {
        throw new Error("当前浏览器不支持离线音频渲染");
      }

      const snapshot = JSON.parse(JSON.stringify(this.settings));
      const offline = new OfflineContextClass(2, frameCount, sampleRate);
      const master = createMasterChain(offline);
      master.ceiling.connect(offline.destination);
      const stems = this.getPcmStems(sampleRate);

      for (const track of Model.TRACKS) {
        const trackSettings = snapshot[track.id];
        const chain = createTrackChain(offline, trackSettings, track.id);
        chain.mute.connect(master.input);
        const source = offline.createBufferSource();
        source.buffer = buildAudioBuffer(offline, stems[track.id]);
        source.connect(chain.input);
        scheduleAutomation(chain.automation.gain, trackSettings, 0, 0);
        source.start(0);
      }

      const rendered = await offline.startRendering();
      const stats = window.WavEncoder.analyzeAudioBuffer(rendered);
      const wav = window.WavEncoder.encodeAudioBuffer(rendered, bitDepth);
      return {
        audioBuffer: rendered,
        wav,
        blob: new Blob([wav], { type: "audio/wav" }),
        stats: {
          ...stats,
          bitDepth,
          duration: rendered.length / rendered.sampleRate,
          byteLength: wav.byteLength,
          automationPoints: snapshot,
          limiterCeilingDb: LIMITER_CEILING_DB
        }
      };
    }

    getDebugState() {
      return {
        ...this.getState(),
        activeSources: this.sources.length,
        trackChains: this.trackChains.size,
        settings: JSON.parse(JSON.stringify(this.settings)),
        meter: this.lastMeter
      };
    }
  }

  window.MixerEngine = MixerEngine;
  window.MixerConstants = {
    LIMITER_CEILING_DB,
    MASTER_CEILING
  };
})();
