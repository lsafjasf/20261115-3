import { EventBus } from "./event-bus.js";
import { EditorNode } from "./node.js";

const BYTES_PER_FLOAT32 = 4;
const EDGE_COST_BYTES = 64;
const LISTENER_COST_BYTES = 48;

/**
 * Owns the live node set, the edges between them and the event bus.
 * Removal is symmetric: peer connection references, bus listeners and
 * per-node buffers are all released before the node leaves the map.
 */
export class NodeGraph {
  constructor() {
    this.bus = new EventBus();
    this.nodes = new Map();
    this.edges = new Set();
    this.tickCount = 0;
  }

  addNode(type = "mixer", bufferSize = 1024) {
    const node = new EditorNode(type, bufferSize);
    this.nodes.set(node.id, node);

    // Each live node holds exactly one graph-tick subscription.
    const handler = () => this._runNode(node);
    handler.__owner = node;
    node.track(this.bus.on("tick", handler));

    this._emitStructureChange();
    return node;
  }

  connect(sourceId, targetId) {
    const source = this.nodes.get(sourceId);
    const target = this.nodes.get(targetId);
    if (!source || !target || sourceId === targetId) {
      return false;
    }
    const key = `${sourceId}->${targetId}`;
    if (this.edges.has(key)) {
      return false;
    }
    this.edges.add(key);
    source.outputs.set(targetId, target);
    target.inputs.set(sourceId, source);
    this._emitStructureChange();
    return true;
  }

  disconnect(sourceId, targetId) {
    const key = `${sourceId}->${targetId}`;
    if (!this.edges.delete(key)) {
      return false;
    }
    this.nodes.get(sourceId)?.outputs.delete(targetId);
    this.nodes.get(targetId)?.inputs.delete(sourceId);
    this._emitStructureChange();
    return true;
  }

  /**
   * Full teardown for one node. After this returns the node receives no
   * further events, no peer references it, and its buffer is released.
   */
  removeNode(id) {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    // 1. Remove every edge and the matching peer-side references.
    for (const peerId of [...node.outputs.keys()]) {
      this.disconnect(id, peerId);
    }
    for (const peerId of [...node.inputs.keys()]) {
      this.disconnect(peerId, id);
    }

    // 2. Detach any bus listener still tagged to this owner.
    this.bus.offAllFor(node);

    // 3. Run the node's own disposers and release its buffer.
    node.dispose();

    // 4. Drop the graph's strong reference.
    this.nodes.delete(id);

    this._emitStructureChange();
    return true;
  }

  removeAll() {
    for (const id of [...this.nodes.keys()]) {
      this.removeNode(id);
    }
  }

  /** Push one processing frame through every live node. */
  tick() {
    this.tickCount += 1;
    this.bus.emit("tick", this.tickCount);
    return this.tickCount;
  }

  _runNode(node) {
    if (!this.nodes.has(node.id) || !node.alive) {
      // A stale subscription must never reach a removed node.
      return;
    }
    const incoming = [];
    for (const source of node.inputs.values()) {
      if (source.alive && source.buffer) {
        incoming.push(source.buffer);
      }
    }
    node.process(this.tickCount, incoming);
  }

  onStructureChange(handler) {
    return this.bus.on("structure-changed", handler);
  }

  /**
   * Resource view shown in the UI and compared by the soak test.
   * Cache size is an estimate: typed-array bytes plus bookkeeping.
   */
  metrics() {
    let bufferBytes = 0;
    for (const node of this.nodes.values()) {
      bufferBytes += node.bufferSize * BYTES_PER_FLOAT32;
    }
    const listenerCount = this.bus.totalListeners();
    const edgeOverhead = this.edges.size * EDGE_COST_BYTES;
    const listenerOverhead = listenerCount * LISTENER_COST_BYTES;
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      listenerCount,
      bufferBytes,
      estimatedCacheBytes:
        bufferBytes + edgeOverhead + listenerOverhead,
    };
  }

  snapshot() {
    return { ...this.metrics() };
  }

  _emitStructureChange() {
    this.bus.emit("structure-changed", this.metrics());
  }
}

export { BYTES_PER_FLOAT32, EDGE_COST_BYTES, LISTENER_COST_BYTES };
