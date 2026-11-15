let nextId = 1;

/**
 * One audio/graphics processing node.
 * It allocates an intermediate working buffer (e.g. an audio frame or a
 * pixel row), subscribes to graph events, and knows how to tear all of
 * that down so nothing keeps it alive after removal.
 */
export class EditorNode {
  constructor(type = "mixer", bufferSize = 1024) {
    this.id = nextId++;
    this.type = type;
    this.bufferSize = bufferSize;

    // Intermediate processing buffer: the main per-node memory cost.
    this.buffer = new Float32Array(bufferSize);

    // Connection references, keyed by remote node id.
    this.inputs = new Map();
    this.outputs = new Map();

    // Unsubscribe handles for every event this node registered.
    this._disposers = [];

    this.alive = true;
    this.updateCount = 0;
    this.lastTick = -1;
  }

  /** Track a subscription so it can be detached on disposal. */
  track(unsubscribe) {
    this._disposers.push(unsubscribe);
    return unsubscribe;
  }

  process(tick, incoming = []) {
    if (!this.alive) {
      // Defensive guard: a removed node must never do work again.
      return;
    }
    const frame = this.buffer;
    frame.fill(0);
    for (const chunk of incoming) {
      const limit = Math.min(chunk.length, frame.length);
      for (let i = 0; i < limit; i++) {
        frame[i] += chunk[i];
      }
    }
    this.updateCount += 1;
    this.lastTick = tick;
  }

  /**
   * Release everything the node holds:
   * event listeners, connection references and the working buffer.
   */
  dispose() {
    while (this._disposers.length > 0) {
      const unsubscribe = this._disposers.pop();
      unsubscribe();
    }
    this.inputs.clear();
    this.outputs.clear();

    // Drop the typed-array backing memory reference.
    this.buffer = null;
    this.alive = false;
  }
}
