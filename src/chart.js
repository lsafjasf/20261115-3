let nextId = 1;

function genId(type) {
  nextId += 1;
  return `${type}-${nextId}`;
}

/** Owns annotation definitions. Every anchor is stored in data coordinates. */
export class AnnotationStore {
  constructor() {
    this.items = [];
  }

  add(annotation) {
    if (!annotation || !annotation.type) {
      throw new Error('annotation.type is required');
    }
    if (!Array.isArray(annotation.anchor) || annotation.anchor.length !== 2) {
      throw new Error('annotation.anchor must be a [x, y] data coordinate');
    }
    if (annotation.type === 'region' && !annotation.rect) {
      throw new Error('region annotation requires a data-space rect');
    }
    const stored = {
      id: annotation.id ?? genId(annotation.type),
      type: annotation.type, // 'text' | 'arrow' | 'region'
      anchor: [...annotation.anchor],
      text: annotation.text ?? '',
      priority: annotation.priority ?? 0,
      color: annotation.color ?? '#1f6feb',
      labelWidth: annotation.labelWidth,
      labelHeight: annotation.labelHeight,
    };
    if (annotation.type === 'region') {
      stored.rect = { ...annotation.rect };
    }
    this.items.push(stored);
    return stored;
  }

  remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index >= 0) this.items.splice(index, 1);
  }

  setPriority(id, priority) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (item) item.priority = Number(priority);
    return item;
  }

  clear() {
    this.items.length = 0;
  }
}

/** Deterministic sample series so tests and UI render identical points. */
export const sampleSeries = [
  [0, 10], [1, 12], [2, 9], [3, 15], [4, 18],
  [5, 14], [6, 21], [7, 25], [8, 22], [9, 30],
  [10, 28], [11, 34], [12, 31], [13, 38], [14, 42],
];

export const initialAnnotations = [
  {
    type: 'arrow',
    anchor: [7, 25],
    text: '峰值突破 25',
    priority: 2,
    color: '#d1242f',
  },
  {
    type: 'text',
    anchor: [3, 15],
    text: '季节性回升',
    priority: 1,
    color: '#1f6feb',
  },
  {
    type: 'region',
    anchor: [12.5, 36],
    rect: { x: 11.5, y: 30, w: 3, h: 13 },
    text: '高位震荡区',
    priority: 0,
    color: '#2da44e',
  },
];
