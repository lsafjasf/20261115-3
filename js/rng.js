export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.random = mulberry32(this.seed);
  }

  range(min, max) {
    return min + this.random() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  pick(items) {
    return items[Math.floor(this.random() * items.length)];
  }

  chance(probability) {
    return this.random() < probability;
  }
}
