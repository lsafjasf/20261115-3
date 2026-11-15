// Taps the audio graph and streams rendered samples to the main thread,
// so the test harness can measure real onset times of every click.
// Each chunk is stamped with `currentTime` (the audio-clock time of its
// first frame) so onsets can be compared directly with scheduled times.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(4800); // 100 ms chunks
    this._idx = 0;
    this._chunkStart = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        if (this._idx === 0) this._chunkStart = currentTime + i / sampleRate;
        this._buf[this._idx++] = channel[i];
        if (this._idx === this._buf.length) {
          this.port.postMessage({ time: this._chunkStart, samples: this._buf.slice() });
          this._idx = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
