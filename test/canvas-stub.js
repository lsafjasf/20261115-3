// Minimal Canvas2D stub for headless tests. Drawing calls are recorded so
// tests can assert what was rendered without a browser.
export class StubContext {
  constructor() {
    this.calls = [];
    this.savedTransforms = [];
    const noop = (name) => (...args) => {
      this.calls.push([name, ...args]);
    };
    [
      'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo',
      'arc', 'arcTo', 'closePath', 'fill', 'stroke', 'fillText', 'drawImage',
      'setLineDash', 'save', 'restore', 'translate', 'rotate', 'scale',
      'setTransform', 'rect',
    ].forEach((name) => {
      this[name] = noop(name);
    });
    this.measureText = (text) => ({ width: text.length * 13 });
  }
}

export class StubCanvas {
  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.context = new StubContext();
    this.dataUrl = null;
  }

  getContext() {
    return this.context;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }

  addEventListener() {}

  toDataURL() {
    this.dataUrl = 'data:image/png;base64,STUB';
    return this.dataUrl;
  }
}
