(function attachFrameSync(global) {
  "use strict";

  const FPS = 30;
  const DURATION = 48;
  const TOTAL_FRAMES = FPS * DURATION;

  const CUES = [
    { id: "CUE-01", start: 0, end: 4.5, text: "测试场尚未启动，所有轨道停在零点" },
    { id: "CUE-02", start: 4.5, end: 9.0, text: "画面、音频、字幕读取同一个时间基准" },
    { id: "CUE-03", start: 9.0, end: 14.0, text: "拖动播放头时，旧请求会被立即中止" },
    { id: "CUE-04", start: 14.0, end: 19.0, text: "最新请求序号指向目标，迟到旧帧不得覆盖" },
    { id: "CUE-05", start: 19.0, end: 25.0, text: "音频时钟在落点重新定位，不再停在之前位置" },
    { id: "CUE-06", start: 25.0, end: 32.0, text: "字幕跟随最终提交帧，而不是迟到的旧响应" },
    { id: "CUE-07", start: 32.0, end: 40.0, text: "播放停止后，帧号、音频和字幕全部冻结" },
    { id: "CUE-08", start: 40.0, end: 48.0, text: "最后一帧保持稳定，等待下一次拖动" }
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function frameToTime(frame) {
    return clamp(frame, 0, TOTAL_FRAMES - 1) / FPS;
  }

  function timeToFrame(seconds) {
    return clamp(Math.floor(seconds * FPS + 1e-7), 0, TOTAL_FRAMES - 1);
  }

  function resolveCue(frame) {
    const time = frameToTime(frame);
    const found = CUES.find((cue) => time >= cue.start && time < cue.end);
    return found || CUES[CUES.length - 1];
  }

  function formatTimecode(seconds) {
    const totalMillis = Math.round(Math.max(0, seconds) * 1000);
    const minutes = Math.floor(totalMillis / 60000);
    const secs = Math.floor(totalMillis / 1000) % 60;
    const millis = totalMillis % 1000;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  function createAbortError() {
    const error = new Error("Frame request aborted");
    error.name = "AbortError";
    return error;
  }

  function createSyntheticFrameSource(options) {
    const settings = Object.assign({
      minDelay: 28,
      maxDelay: 145,
      latencyScale: 1
    }, options);

    function delayFor(frame, sequence) {
      const span = Math.max(1, settings.maxDelay - settings.minDelay);
      const jitter = ((frame * 37 + sequence * 53 + (frame % 13) * 11) % span);
      return (settings.minDelay + jitter) * settings.latencyScale;
    }

    return {
      request(frame, context) {
        const meta = context || {};
        const sequence = meta.sequence || 0;
        const signal = meta.signal;
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve({ frame, time: frameToTime(frame), sequence });
          }, delayFor(frame, sequence));

          function onAbort() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(createAbortError());
          }

          if (signal) {
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      }
    };
  }

  class VideoCore {
    constructor(options) {
      const config = options || {};
      this.fps = config.fps || FPS;
      this.totalFrames = config.totalFrames || TOTAL_FRAMES;
      this.duration = this.totalFrames / this.fps;
      this.frameSource = config.frameSource || createSyntheticFrameSource();
      this.audio = config.audio || null;
      this.onState = typeof config.onState === "function" ? config.onState : function noop() {};
      this.onFrame = typeof config.onFrame === "function" ? config.onFrame : function noop() {};
      this.sleep = config.sleep || function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      };

      this.state = {
        requestSeq: 0,
        targetFrame: 0,
        renderedFrame: -1,
        targetTime: 0,
        audioTime: 0,
        cue: resolveCue(0),
        pending: false,
        status: "boot",
        playing: false,
        paused: true,
        dragging: false,
        abortedRequests: 0,
        staleDrops: 0,
        committedFrames: 0,
        clockSeconds: 0,
        lastEvent: "init"
      };

      this._pendingRequest = null;
      this._wasPlayingBeforeScrub = false;
      this._destroyed = false;
    }

    getState() {
      return Object.assign({}, this.state, {
        cue: Object.assign({}, this.state.cue)
      });
    }

    _emit(eventName) {
      if (eventName) this.state.lastEvent = eventName;
      this.onState(this.getState());
    }

    _audioPlaying() {
      return this.state.playing && !this.state.paused && !this.state.dragging;
    }

    _syncAudio(seconds) {
      if (!this.audio || typeof this.audio.sync !== "function") return;
      this.audio.sync(seconds, {
        playing: this._audioPlaying(),
        scrubbing: this.state.dragging,
        paused: this.state.paused
      });
    }

    _cancelPending() {
      if (!this._pendingRequest) return false;
      const pending = this._pendingRequest;
      this._pendingRequest = null;
      this.state.abortedRequests += 1;
      if (pending.controller) pending.controller.abort();
      return true;
    }

    seekFrame(frame, options) {
      const opts = options || {};
      const target = clamp(Math.round(Number(frame) || 0), 0, this.totalFrames - 1);
      const sequence = this.state.requestSeq + 1;
      this._cancelPending();
      this.state.requestSeq = sequence;
      this.state.targetFrame = target;
      this.state.targetTime = frameToTime(target);
      this.state.audioTime = this.state.targetTime;
      this.state.cue = resolveCue(target);
      this.state.pending = true;
      this.state.status = "loading";
      if (opts.syncAudio !== false) this._syncAudio(this.state.targetTime);
      this._loadFrame(sequence, target);
      this._emit(opts.eventName || "seek");
      return sequence;
    }

    seekSeconds(seconds, options) {
      return this.seekFrame(timeToFrame(seconds), options);
    }

    _loadFrame(sequence, frame) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      this._pendingRequest = { sequence, frame, controller };
      const ticket = this._pendingRequest;
      let request;
      try {
        request = this.frameSource.request(frame, {
          sequence,
          signal: controller ? controller.signal : undefined
        });
      } catch (error) {
        request = Promise.reject(error);
      }

      Promise.resolve(request).then((payload) => {
        if (this._pendingRequest !== ticket || sequence !== this.state.requestSeq) {
          this.state.staleDrops += 1;
          this._emit("stale-drop");
          return;
        }
        this._pendingRequest = null;
        this._commitFrame(payload);
      }).catch((error) => {
        if (this._pendingRequest !== ticket || sequence !== this.state.requestSeq) {
          this.state.staleDrops += 1;
          this._emit("stale-drop");
          return;
        }
        this._pendingRequest = null;
        if (error && error.name === "AbortError") {
          this.state.staleDrops += 1;
          this._emit("stale-drop");
          return;
        }
        this.state.pending = false;
        this.state.status = "error";
        this.state.lastEvent = "frame-error";
        this._emit();
      });
    }

    _commitFrame(payload) {
      const frame = clamp(payload.frame, 0, this.totalFrames - 1);
      this.state.renderedFrame = frame;
      this.state.targetFrame = frame;
      this.state.targetTime = frameToTime(frame);
      this.state.audioTime = frameToTime(frame);
      this.state.cue = resolveCue(frame);
      this.state.pending = false;
      this.state.committedFrames += 1;
      this.state.status = this.state.playing && !this.state.paused ? "playing" : "ready";
      if (!this.state.playing || this.state.paused) {
        this.state.clockSeconds = frameToTime(frame);
      }
      this._syncAudio(this.state.audioTime);
      this.onFrame(payload, this.getState());
      this._emit("frame-commit");
    }

    beginScrub() {
      if (this.state.dragging) return;
      this._wasPlayingBeforeScrub = this.state.playing && !this.state.paused;
      this.state.dragging = true;
      this.state.clockSeconds = this.state.audioTime;
      this._syncAudio(this.state.targetTime);
      this._emit("scrub-begin");
    }

    endScrub() {
      if (!this.state.dragging) return;
      this.state.dragging = false;
      this.state.clockSeconds = frameToTime(this.state.targetFrame);
      this.state.audioTime = this.state.clockSeconds;
      this._syncAudio(this.state.clockSeconds);
      this._emit("scrub-end");
    }

    play() {
      if (this.state.playing && !this.state.paused) return;
      if (this.state.audioTime >= this.duration - 1 / this.fps) {
        this.seekFrame(0);
      }
      this.state.playing = true;
      this.state.paused = false;
      this.state.status = "playing";
      this._syncAudio(this.state.audioTime);
      this._emit("play");
    }

    pause() {
      if (this.state.paused && !this.state.playing && !this._pendingRequest) {
        this._syncAudio(this.state.audioTime);
        this._emit("pause");
        return;
      }
      this._cancelPending();
      const frozenFrame = this.state.renderedFrame >= 0
        ? this.state.renderedFrame
        : this.state.targetFrame;
      const frozenTime = frameToTime(frozenFrame);
      this.state.playing = false;
      this.state.paused = true;
      this.state.dragging = false;
      this.state.clockSeconds = frozenTime;
      this.state.audioTime = frozenTime;
      this.state.targetFrame = frozenFrame;
      this.state.targetTime = frozenTime;
      this.state.cue = resolveCue(frozenFrame);
      this.state.pending = false;
      this.state.status = "paused";
      this._syncAudio(frozenTime);
      this._emit("pause");
    }

    togglePlay() {
      if (this.state.playing && !this.state.paused) this.pause();
      else this.play();
    }

    tick(deltaMs) {
      if (!this.state.playing || this.state.paused || this.state.dragging) return false;
      const delta = clamp(Number(deltaMs) || 0, 0, 250) / 1000;
      if (delta === 0) return false;

      const nextSeconds = Math.min(this.duration, this.state.clockSeconds + delta);
      this.state.clockSeconds = nextSeconds;
      if (nextSeconds >= this.duration) {
        this.pause();
        this.seekFrame(this.totalFrames - 1);
        return true;
      }

      const nextFrame = timeToFrame(nextSeconds);
      if (nextFrame !== this.state.targetFrame) {
        this.seekFrame(nextFrame, { syncAudio: false, eventName: "play-tick" });
      } else if (this.state.renderedFrame === nextFrame) {
        this.state.audioTime = frameToTime(nextFrame);
      }
      return true;
    }

    stepFrames(delta) {
      this.pause();
      return this.seekFrame(this.state.targetFrame + delta);
    }

    async waitForSettled(timeoutMs) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 3000;
      const started = Date.now();
      while (this._pendingRequest || this.state.pending) {
        if (Date.now() - started >= timeout) {
          throw new Error("Timed out waiting for the latest frame");
        }
        await this.sleep(8);
      }
      return this.getState();
    }

    destroy() {
      this._destroyed = true;
      this._cancelPending();
    }
  }

  async function runFiveScrubCheck(core, options) {
    const config = Object.assign({
      targets: [4.4, 23.6, 11.2, 31.4, 18.6],
      gapMs: 45,
      settleTimeoutMs: 3000
    }, options);
    const sleep = config.sleep || core.sleep;
    const events = [];

    core.pause();
    const baseline = core.getState();
    core.beginScrub();
    for (let index = 0; index < config.targets.length; index += 1) {
      const seconds = config.targets[index];
      const frame = timeToFrame(seconds);
      const sequence = core.seekSeconds(seconds, { eventName: "rapid-scrub" });
      events.push({
        drag: index + 1,
        seconds,
        targetFrame: frame,
        sequence
      });
      await sleep(config.gapMs);
    }
    core.endScrub();

    const settled = await core.waitForSettled(config.settleTimeoutMs);
    const abortedDuringRun = settled.abortedRequests - baseline.abortedRequests;
    const staleDropsDuringRun = settled.staleDrops - baseline.staleDrops;
    const finalFrame = settled.renderedFrame;
    const finalTime = frameToTime(finalFrame);
    const expectedCue = resolveCue(finalFrame);

    core.pause();
    const frozen = core.getState();
    const ticked = core.tick(5000);
    const afterTick = core.getState();
    const pauseChecks = {
      tickRejected: ticked === false,
      frameFrozen: frozen.renderedFrame === afterTick.renderedFrame,
      audioFrozen: frozen.audioTime === afterTick.audioTime,
      cueFrozen: frozen.cue.id === afterTick.cue.id
    };

    const checks = {
      frameMatchesLatestTarget: finalFrame === settled.targetFrame,
      audioMatchesFrame: Math.abs(settled.audioTime - finalTime) < 1e-9,
      subtitleMatchesFrame: settled.cue.id === expectedCue.id
        && finalTime >= expectedCue.start
        && finalTime < expectedCue.end,
      latestSequenceWon: events[events.length - 1].sequence === settled.requestSeq,
      oldRequestsCancelled: abortedDuringRun >= events.length - 1,
      noPendingRequest: settled.pending === false,
      pausedDoesNotAdvance: Object.values(pauseChecks).every(Boolean)
    };

    return {
      title: "五次快速拖动同步检查",
      events,
      finalFrame,
      finalTime,
      finalTimecode: formatTimecode(finalTime),
      audioTime: settled.audioTime,
      audioTimecode: formatTimecode(settled.audioTime),
      subtitle: {
        id: settled.cue.id,
        text: settled.cue.text,
        start: settled.cue.start,
        end: settled.cue.end
      },
      requestSeq: settled.requestSeq,
      abortedRequests: abortedDuringRun,
      staleDrops: staleDropsDuringRun,
      pauseChecks,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  const api = {
    FPS,
    DURATION,
    TOTAL_FRAMES,
    CUES,
    clamp,
    frameToTime,
    timeToFrame,
    resolveCue,
    formatTimecode
  };

  api.createAbortError = createAbortError;
  api.createSyntheticFrameSource = createSyntheticFrameSource;
  api.VideoCore = VideoCore;
  api.runFiveScrubCheck = runFiveScrubCheck;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.FrameSync = Object.assign(global.FrameSync || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : window);
