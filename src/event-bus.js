/**
 * Minimal event bus whose registrations are fully reversible.
 * Every on()/once() call returns an unsubscribe function, and each node
 * owns a disposer list so removal can detach every listener at once.
 */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    const bucket = this._listeners.get(event);
    bucket.add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    if (handler.__owner !== undefined) {
      wrapper.__owner = handler.__owner;
    }
    return this.on(event, wrapper);
  }

  off(event, handler) {
    const bucket = this._listeners.get(event);
    if (bucket) {
      bucket.delete(handler);
      if (bucket.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  /** Drop every listener for an owner (a node), used during teardown. */
  offAllFor(owner) {
    for (const [event, bucket] of this._listeners) {
      for (const handler of bucket) {
        if (handler.__owner === owner) {
          bucket.delete(handler);
        }
      }
      if (bucket.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  emit(event, payload) {
    const bucket = this._listeners.get(event);
    if (!bucket) return;
    for (const handler of [...bucket]) {
      handler(payload);
    }
  }

  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }

  totalListeners() {
    let total = 0;
    for (const bucket of this._listeners.values()) {
      total += bucket.size;
    }
    return total;
  }

  clear() {
    this._listeners.clear();
  }
}
