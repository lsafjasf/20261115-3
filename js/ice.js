import { ICE, WORLD, clamp } from "./config.js";
import { SeededRng } from "./rng.js";

const HOTSPOTS = [
  { x: 792, y: 572, strength: 43, radius: 168 },
  { x: 878, y: 438, strength: 38, radius: 152 },
  { x: 725, y: 405, strength: 18, radius: 130 },
  { x: 932, y: 638, strength: 14, radius: 120 },
  { x: 538, y: 612, strength: 18, radius: 126 },
  { x: 405, y: 361, strength: 14, radius: 108 },
  { x: 1112, y: 474, strength: 17, radius: 112 },
  { x: 1008, y: 198, strength: 13, radius: 104 },
  { x: 1250, y: 719, strength: 12, radius: 110 },
  { x: 1324, y: 356, strength: 10, radius: 96 }
];

const CRACK_SEEDS = [
  [790, 568, -1.0], [846, 520, -0.65], [894, 452, -1.2], [724, 590, 0.8],
  [812, 486, -1.35], [858, 585, 0.22],
  [758, 386, -0.2], [930, 628, 0.35], [540, 608, 0.7], [442, 398, -0.8],
  [1104, 462, 0.15], [1008, 232, -0.45], [1248, 710, -0.7], [1312, 382, 0.65],
  [270, 548, 0.25], [608, 748, -0.9], [1140, 772, 0.45], [360, 706, -0.2]
];

export class IceField {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = new SeededRng(this.seed ^ 0x7f4a7c15);
    this.cells = [];
    this.cracks = [];
    this.microCracks = [];
    this.initialCrackLength = 0;
    this._buildGrid();
    this._buildCracks();
    this.initialCrackLength = this.getCrackLength();
  }

  _buildGrid() {
    this.cells = [];
    for (let row = 0; row < ICE.rows; row += 1) {
      for (let col = 0; col < ICE.cols; col += 1) {
        const x = (col + 0.5) * ICE.cellW;
        const y = (row + 0.5) * ICE.cellH;
        let stress = 6 + this.rng.range(0, 7);
        for (const spot of HOTSPOTS) {
          const distance = Math.hypot(x - spot.x, y - spot.y);
          stress += spot.strength * Math.exp(-(distance * distance) / (2 * spot.radius * spot.radius));
        }
        const shoreFade = clamp((WORLD.shoreY - y) / 170, 0, 1);
        this.cells.push({
          col,
          row,
          x,
          y,
          stress: Math.min(66, stress) * shoreFade + 2,
          initialStress: Math.min(66, stress) * shoreFade + 2,
          microLevel: 0,
          broken: false
        });
      }
    }
  }

  _buildCracks() {
    this.cracks = CRACK_SEEDS.map(([x, y, angle], index) => {
      const cell = this.cellAt(x, y);
      const points = [{ x, y }];
      let px = x;
      let py = y;
      let heading = angle + this.rng.range(-0.32, 0.32);
      const segmentCount = this.rng.int(11, 16);
      for (let i = 0; i < segmentCount; i += 1) {
        heading += this.rng.range(-0.34, 0.34);
        const length = this.rng.range(13, 26) * (1 - i / (segmentCount + 5));
        px += Math.cos(heading) * length;
        py += Math.sin(heading) * length;
        points.push({ x: px, y: py });
      }
      const totalLength = points.slice(1).reduce((sum, point, pointIndex) => {
        const previous = points[pointIndex];
        return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
      }, 0);
      const branches = [];
      const branchCount = this.rng.int(1, 2);
      for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
        const startIndex = this.rng.int(3, points.length - 2);
        const origin = points[startIndex];
        const previous = points[startIndex - 1];
        let branchAngle = Math.atan2(origin.y - previous.y, origin.x - previous.x) + this.rng.range(0.65, 1.35);
        let bx = origin.x;
        let by = origin.y;
        const branchPoints = [{ x: bx, y: by }];
        const branchSegments = this.rng.int(3, 6);
        for (let i = 0; i < branchSegments; i += 1) {
          branchAngle += this.rng.range(-0.36, 0.36);
          const length = this.rng.range(7, 17);
          bx += Math.cos(branchAngle) * length;
          by += Math.sin(branchAngle) * length;
          branchPoints.push({ x: bx, y: by });
        }
        let branchLength = 0;
        for (let i = 1; i < branchPoints.length; i += 1) {
          branchLength += Math.hypot(branchPoints[i].x - branchPoints[i - 1].x, branchPoints[i].y - branchPoints[i - 1].y);
        }
        branches.push({ points: branchPoints, totalLength: branchLength });
      }
      const normalized = clamp((cell.stress - 8) / 76, 0, 1);
      const baseVisible = clamp(0.27 + normalized * 0.43, 0.27, 0.76);
      return {
        id: `crack-${index}`,
        x,
        y,
        cellCol: cell.col,
        cellRow: cell.row,
        points,
        totalLength,
        branches,
        visible: baseVisible,
        baseVisible,
        growth: 0,
        emphasis: this.rng.range(0.7, 1.25)
      };
    });
  }

  indexFor(col, row) {
    return row * ICE.cols + col;
  }

  cellAt(x, y) {
    const col = clamp(Math.floor(x / ICE.cellW), 0, ICE.cols - 1);
    const row = clamp(Math.floor(y / ICE.cellH), 0, ICE.rows - 1);
    return this.cells[this.indexFor(col, row)];
  }

  cellCenter(col, row) {
    return {
      x: (col + 0.5) * ICE.cellW,
      y: (row + 0.5) * ICE.cellH
    };
  }

  update(dt, vehicle, handling, onIce) {
    const result = {
      crackGrowth: 0,
      newCracks: 0,
      maxLocalStress: 0,
      localStress: 0,
      support: 100,
      danger: false,
      shock: 0
    };
    if (!onIce) {
      this._syncCracks();
      result.support = 100;
      return result;
    }

    const speedNormalized = clamp(Math.abs(vehicle.speed) / 160, 0, 1.25);
    const vibration = 0.5 + speedNormalized * 2.65;
    const creep = Math.abs(vehicle.speed) < 8 ? 0.12 * handling.massFactor : 0;
    let localStress = 0;
    let shock = 0;

    for (const cell of this.cells) {
      if (cell.row === ICE.rows - 1 && cell.y > WORLD.shoreY + 25) continue;
      const distance = Math.hypot(vehicle.x - cell.x, vehicle.y - cell.y);
      const proximity = clamp(1 - distance / 185, 0, 1);
      if (proximity <= 0) continue;
      const weight = proximity * proximity * (0.55 + proximity * 0.45);
      const sensitive = 1 + clamp((cell.initialStress - 38) / 24, 0, 1) * 1.45;
      const gain = dt * (vibration * handling.massFactor * weight * sensitive + creep * weight);
      cell.stress = Math.min(ICE.stressCap, cell.stress + gain);
      if (proximity > 0.62) {
        localStress = Math.max(localStress, cell.stress);
      }
      if (cell.stress > 76 && speedNormalized > 0.55) {
        shock += dt * (cell.stress - 76) * speedNormalized * 0.014;
      }
    }

    const current = this.cellAt(vehicle.x, vehicle.y);
    localStress = Math.max(localStress, current.stress);
    this._growCracks(dt, result);
    result.localStress = localStress;
    result.maxLocalStress = localStress;
    result.support = clamp(100 - Math.max(0, localStress - 46) * 1.65, 0, 100);
    result.danger = localStress >= ICE.failureStress;
    result.shock = shock;
    return result;
  }

  _growCracks(dt, result) {
    for (const crack of this.cracks) {
      const cell = this.cells[this.indexFor(crack.cellCol, crack.cellRow)];
      const remaining = Math.max(1, 101 - cell.initialStress);
      const target = clamp(
        crack.baseVisible + (cell.stress - cell.initialStress) / remaining * (1 - crack.baseVisible),
        crack.baseVisible,
        1
      );
      if (target > crack.visible) {
        const previous = crack.visible;
        crack.visible = Math.min(target, crack.visible + dt * (0.035 + cell.stress / 1300));
        crack.growth += crack.visible - previous;
        result.crackGrowth = Math.max(result.crackGrowth, crack.visible - previous);
      }
    }

    for (const cell of this.cells) {
      const levels = [69, 82, 94];
      for (let level = 0; level < levels.length; level += 1) {
        if (cell.stress >= levels[level] && cell.microLevel <= level) {
          this._spawnMicroCracks(cell, level);
          cell.microLevel = level + 1;
        }
      }
      if (cell.stress >= 101) cell.broken = true;
    }
  }

  _spawnMicroCracks(cell, level) {
    const count = level === 0 ? 2 : level === 1 ? 2 : 3;
    for (let i = 0; i < count; i += 1) {
      const originX = cell.x + this.rng.range(-42, 42);
      const originY = cell.y + this.rng.range(-34, 34);
      let angle = this.rng.range(0, Math.PI * 2);
      let x = originX;
      let y = originY;
      const points = [{ x, y }];
      const segments = this.rng.int(3, 6);
      for (let j = 0; j < segments; j += 1) {
        angle += this.rng.range(-0.62, 0.62);
        const length = this.rng.range(8, 18);
        x += Math.cos(angle) * length;
        y += Math.sin(angle) * length;
        points.push({ x, y });
      }
      this.microCracks.push({
        id: `micro-${cell.col}-${cell.row}-${this.microCracks.length}`,
        points,
        level,
        age: 0
      });
    }
  }

  _syncCracks() {
    for (const crack of this.cracks) {
      const cell = this.cells[this.indexFor(crack.cellCol, crack.cellRow)];
      const remaining = Math.max(1, 101 - cell.initialStress);
      crack.visible = clamp(
        crack.baseVisible + (cell.stress - cell.initialStress) / remaining * (1 - crack.baseVisible),
        crack.baseVisible,
        1
      );
    }
  }

  getCrackLength() {
    const main = this.cracks.reduce((sum, crack) => {
      const branchProgress = clamp((crack.visible - crack.baseVisible) / Math.max(0.01, 1 - crack.baseVisible), 0, 1);
      const branches = crack.branches.reduce((branchSum, branch) => branchSum + branch.totalLength * branchProgress, 0);
      return sum + crack.totalLength * crack.visible + branches;
    }, 0);
    const micro = this.microCracks.reduce((sum, crack) => {
      let length = 0;
      for (let i = 1; i < crack.points.length; i += 1) {
        length += Math.hypot(
          crack.points[i].x - crack.points[i - 1].x,
          crack.points[i].y - crack.points[i - 1].y
        );
      }
      return sum + length;
    }, 0);
    return main + micro;
  }

  getCrackCount() {
    return this.cracks.length + this.microCracks.length;
  }

  getStressedCells(threshold = 62) {
    return this.cells.filter((cell) => cell.stress >= threshold);
  }
}
