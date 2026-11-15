import {
  CONFIG,
  DESTINATIONS,
  STACKS,
  approachForStack,
  canTargetStack,
  formatMinute,
  getStack,
  getTruck,
  previewUnload,
} from "./simulation.js";

const CELL_W = 78;
const CELL_H = 58;
const ORIGIN_X = 122;
const ORIGIN_Y = 102;
const TAU = Math.PI * 2;

const COLORS = {
  ink: "#eaf4f2",
  muted: "#7f9996",
  dim: "#46615e",
  cyan: "#45d7c7",
  amber: "#ffc562",
  red: "#ff6b68",
  green: "#77e3a3",
  yard: "#0a1c20",
};

function cellCenter(col, row) {
  return {
    x: ORIGIN_X + (col + 0.5) * CELL_W,
    y: ORIGIN_Y + (row + 0.5) * CELL_H,
  };
}

function alpha(hex, value) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${value})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawText(ctx, text, x, y, options = {}) {
  ctx.save();
  const font = options.font || '500 11px "Bahnschrift", "Microsoft YaHei", sans-serif';
  ctx.font = font.replace(/(sans-serif|serif)$/, '"Yard Sans", $1');
  ctx.fillStyle = options.color || COLORS.ink;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  if (options.letterSpacing && "letterSpacing" in ctx) {
    ctx.letterSpacing = options.letterSpacing;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function dashedLine(ctx, points, color, width = 1.5, offset = 0) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = -offset;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

export class YardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hits = [];
    this.visual = new Map();
  }

  draw(game, ui, now = performance.now()) {
    const ctx = this.ctx;
    this.hits = [];
    this.updateCraneVisuals(game);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground(ctx);
    this.drawRoutes(ctx, game, ui, now);
    this.drawStacks(ctx, game, ui, now);
    this.drawBuffer(ctx, game, now);
    this.drawTrucks(ctx, game, ui, now);
    this.drawCranes(ctx, game, ui, now);
    this.drawOverlayDetails(ctx, game, ui);
  }

  hitTest(x, y) {
    for (let index = this.hits.length - 1; index >= 0; index -= 1) {
      const hit = this.hits[index];
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
        return hit;
      }
    }
    return null;
  }

  updateCraneVisuals(game) {
    for (const crane of game.cranes) {
      const target = cellCenter(crane.col, crane.row);
      const previous = this.visual.get(crane.id);
      if (!previous) {
        this.visual.set(crane.id, { ...target });
      } else {
        previous.x += (target.x - previous.x) * 0.16;
        previous.y += (target.y - previous.y) * 0.16;
      }
    }
  }

  drawBackground(ctx) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#07171b");
    gradient.addColorStop(0.58, "#081b20");
    gradient.addColorStop(1, "#061317");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = "#2e7772";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < width; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    const yardWidth = CONFIG.cols * CELL_W;
    const yardHeight = CONFIG.rows * CELL_H;
    ctx.fillStyle = "#091b1f";
    ctx.fillRect(ORIGIN_X, ORIGIN_Y, yardWidth, yardHeight);

    ctx.save();
    ctx.strokeStyle = "rgba(108, 174, 166, 0.12)";
    ctx.lineWidth = 1;
    for (let col = 0; col <= CONFIG.cols; col += 1) {
      const x = ORIGIN_X + col * CELL_W;
      ctx.beginPath();
      ctx.moveTo(x, ORIGIN_Y);
      ctx.lineTo(x, ORIGIN_Y + yardHeight);
      ctx.stroke();
    }
    for (let row = 0; row <= CONFIG.rows; row += 1) {
      const y = ORIGIN_Y + row * CELL_H;
      ctx.beginPath();
      ctx.moveTo(ORIGIN_X, y);
      ctx.lineTo(ORIGIN_X + yardWidth, y);
      ctx.stroke();
    }
    ctx.restore();

    this.drawBlockZone(ctx, 0, 0, 2, "NORTH YARD");
    this.drawBlockZone(ctx, 5, 5, 3, "SOUTH YARD");
    this.drawChannel(ctx);
    this.drawDock(ctx);
  }

  drawBlockZone(ctx, startRow, endRow, group, label) {
    const x = ORIGIN_X + 1.35 * CELL_W;
    const y = ORIGIN_Y + startRow * CELL_H;
    const width = 8.3 * CELL_W;
    const height = (endRow - startRow + 1) * CELL_H;
    ctx.save();
    ctx.fillStyle = "rgba(30, 78, 74, 0.08)";
    ctx.strokeStyle = "rgba(69, 215, 199, 0.1)";
    roundedRect(ctx, x, y + 3, width, height - 6, 3);
    ctx.fill();
    ctx.stroke();
    drawText(ctx, label, x + 9, y + 14, {
      color: "rgba(140, 189, 183, 0.36)",
      font: '700 8px "Bahnschrift", sans-serif',
      letterSpacing: "2px",
    });
    ctx.restore();
  }

  drawChannel(ctx) {
    const y = ORIGIN_Y + 3 * CELL_H;
    const width = CONFIG.cols * CELL_W;
    ctx.save();
    ctx.fillStyle = "rgba(20, 49, 51, 0.58)";
    ctx.fillRect(ORIGIN_X, y, width, CELL_H * 2);

    ctx.strokeStyle = "rgba(255, 197, 98, 0.2)";
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(ORIGIN_X + 8, y + CELL_H);
    ctx.lineTo(ORIGIN_X + width - 8, y + CELL_H);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let lane = 0; lane < 2; lane += 1) {
      const centerY = y + (lane + 0.5) * CELL_H;
      drawText(ctx, lane === 0 ? "N-LANE" : "S-LANE", ORIGIN_X + 10, centerY - 12, {
        color: lane === 0 ? "rgba(69, 215, 199, 0.52)" : "rgba(255, 197, 98, 0.52)",
        font: '700 8px "Bahnschrift", sans-serif',
        letterSpacing: "1.5px",
      });
      ctx.strokeStyle = alpha(lane === 0 ? COLORS.cyan : COLORS.amber, 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ORIGIN_X + 72, centerY);
      ctx.lineTo(ORIGIN_X + width - 36, centerY);
      ctx.stroke();
      for (let col = 2; col < CONFIG.cols - 1; col += 2) {
        this.drawChevron(ctx, ORIGIN_X + col * CELL_W + CELL_W / 2, centerY, lane);
      }
    }
    ctx.restore();
  }

  drawChevron(ctx, x, y, lane) {
    const color = lane === 0 ? "rgba(69, 215, 199, 0.28)" : "rgba(255, 197, 98, 0.26)";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 4);
    ctx.lineTo(x, y);
    ctx.lineTo(x - 5, y + 4);
    ctx.stroke();
    ctx.restore();
  }

  drawDock(ctx) {
    const point = cellCenter(0.25, 4);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 197, 98, 0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(18, point.y - 34);
    ctx.lineTo(ORIGIN_X, point.y - 34);
    ctx.moveTo(18, point.y + 34);
    ctx.lineTo(ORIGIN_X, point.y + 34);
    ctx.stroke();
    ctx.restore();
    drawText(ctx, "WEST GATE", 22, ORIGIN_Y + 3 * CELL_H - 11, {
      color: "rgba(255, 197, 98, 0.52)",
      font: '700 8px "Bahnschrift", sans-serif',
      letterSpacing: "1.2px",
    });
  }

  drawRoutes(ctx, game, ui, now) {
    for (const crane of game.cranes) {
      const operation = crane.operation;
      if (!operation) continue;
      const color = crane.id === "A" ? COLORS.cyan : COLORS.amber;
      const start = cellCenter(crane.col, crane.row);
      const remaining = operation.path
        .slice(operation.pathIndex + 1)
        .map((cell) => cellCenter(cell.c, cell.r));
      dashedLine(ctx, [start, ...remaining], alpha(color, 0.78), 2, (now / 45) % 12);
      this.drawRouteNodes(ctx, operation.path, color, operation.pathIndex);
      if (remaining.length > 1) {
        const mid = remaining[Math.floor(remaining.length / 2)];
        drawText(ctx, `吊机 ${crane.id} · ${operation.type === "reorder" ? "翻箱" : "作业"}`, mid.x, mid.y - 10, {
          color: alpha(color, 0.8),
          font: '700 9px "Bahnschrift", "Microsoft YaHei", sans-serif',
          align: "center",
        });
      }
    }

    if (!ui.selectedTruckId || !ui.selectedStackId || !ui.selectedCraneId) return;
    const preview = previewUnload(game, {
      truckId: ui.selectedTruckId,
      stackId: ui.selectedStackId,
      craneId: ui.selectedCraneId,
      route: ui.route,
    });
    if (!preview.ok) return;
    const color = ui.selectedCraneId === "A" ? COLORS.cyan : COLORS.amber;
    const dockPoints = preview.dockPath.map((cell) => cellCenter(cell.c, cell.r));
    const stackPoints = preview.stackPath.map((cell) => cellCenter(cell.c, cell.r));
    dashedLine(ctx, dockPoints, alpha(color, 0.32), 1.2, (now / 70) % 12);
    dashedLine(ctx, stackPoints, alpha(color, 0.52), 1.6, (now / 52) % 12);
    this.drawRouteNodes(ctx, preview.stackPath, color, -1, true);
    const target = cellCenter(getStack(game, ui.selectedStackId).col, getStack(game, ui.selectedStackId).row);
    this.drawTargetReticle(ctx, target.x, target.y, color, now);
  }

  drawRouteNodes(ctx, path, color, activeIndex, subtle = false) {
    ctx.save();
    for (let index = 0; index < path.length; index += 1) {
      if (index === activeIndex) continue;
      const point = cellCenter(path[index].c, path[index].r);
      ctx.fillStyle = alpha(color, subtle ? 0.4 : 0.62);
      ctx.beginPath();
      ctx.arc(point.x, point.y, index % 4 === 0 ? 1.8 : 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTargetReticle(ctx, x, y, color, now) {
    const pulse = 21 + Math.sin(now / 220) * 2.5;
    ctx.save();
    ctx.strokeStyle = alpha(color, 0.6);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(x, y, pulse, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawStacks(ctx, game, ui, now) {
    for (const stack of game.stacks) {
      const center = cellCenter(stack.col, stack.row);
      const color = DESTINATIONS[stack.destination].color;
      const isSelected = ui.selectedStackId === stack.id;
      const truck = ui.selectedTruckId ? getTruck(game, ui.selectedTruckId) : null;
      const targetCheck = truck ? canTargetStack(game, truck, stack) : { ok: false };
      const isCandidate = Boolean(truck && truck.destination === stack.destination);
      const isReserved = Boolean(stack.reservedBy);
      const height = 78 + Math.max(0, stack.boxes.length - 2) * 14;
      const hitX = center.x - 38;
      const hitY = center.y - height + 32;
      this.hits.push({
        type: "stack",
        id: stack.id,
        x: hitX,
        y: hitY,
        w: 76,
        h: height,
      });

      ctx.save();
      if (isSelected || (isCandidate && targetCheck.ok)) {
        ctx.fillStyle = alpha(color, isSelected ? 0.16 : 0.075);
        roundedRect(ctx, hitX, hitY, 76, height, 4);
        ctx.fill();
        ctx.strokeStyle = alpha(color, isSelected ? 0.68 : 0.28);
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.stroke();
      }
      if (stack.unstable || stack.reorderRequired) {
        ctx.fillStyle = "rgba(255, 107, 104, 0.07)";
        roundedRect(ctx, hitX - 2, hitY - 2, 80, height + 4, 5);
        ctx.fill();
        ctx.strokeStyle = alpha(COLORS.red, 0.56 + Math.sin(now / 160) * 0.18);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(2, 11, 13, 0.72)";
      roundedRect(ctx, center.x - 33, center.y + 9, 66, 21, 3);
      ctx.fill();
      ctx.strokeStyle = isReserved ? alpha(COLORS.amber, 0.6) : "rgba(120, 184, 176, 0.17)";
      ctx.setLineDash(isReserved ? [4, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      stack.boxes.forEach((box, index) => {
        this.drawBox(ctx, center.x, center.y + 9 - index * 13.5, box, color, index);
      });

      if (stack.boxes.length === 0) {
        drawText(ctx, "EMPTY", center.x, center.y - 2, {
          color: "rgba(140, 189, 183, 0.28)",
          font: '700 8px "Bahnschrift", sans-serif',
          align: "center",
          letterSpacing: "1.2px",
        });
      }

      drawText(ctx, stack.label.replace(" · ", " "), center.x, center.y + 35, {
        color: isSelected ? "rgba(234, 244, 242, 0.86)" : "rgba(178, 203, 199, 0.5)",
        font: '600 9px "Microsoft YaHei", sans-serif',
        align: "center",
      });

      if (stack.reorderRequired) {
        const tagWidth = 57;
        ctx.fillStyle = "rgba(255, 107, 104, 0.2)";
        roundedRect(ctx, center.x - tagWidth / 2, hitY - 18, tagWidth, 16, 2);
        ctx.fill();
        drawText(ctx, "错叠 · 重排", center.x, hitY - 10, {
          color: "#ffaaa6",
          font: '700 8px "Microsoft YaHei", sans-serif',
          align: "center",
        });
      } else if (isReserved) {
        drawText(ctx, "LOCKED", center.x, hitY - 10, {
          color: alpha(COLORS.amber, 0.8),
          font: '700 8px "Bahnschrift", sans-serif',
          align: "center",
          letterSpacing: "1px",
        });
      }
      ctx.restore();
    }
  }

  drawBox(ctx, centerX, baseY, box, color, index) {
    const width = 56 - Math.min(index, 2) * 3;
    const height = 11;
    const x = centerX - width / 2;
    const y = baseY - height - index * 0.5;
    ctx.save();
    ctx.fillStyle = alpha(color, 0.24);
    ctx.strokeStyle = alpha(color, 0.72);
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, width, height, 1.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = alpha(color, 0.82);
    ctx.fillRect(x + 1, y + 1, 3, height - 2);
    drawText(ctx, `${box.weight}t`, centerX, y + height / 2 + 0.5, {
      color: "#e8f4f1",
      font: '700 8px "Bahnschrift", sans-serif',
      align: "center",
    });
    ctx.restore();
  }

  drawBuffer(ctx, game, now) {
    const center = cellCenter(11, 1);
    const color = COLORS.amber;
    ctx.save();
    ctx.fillStyle = "rgba(255, 197, 98, 0.05)";
    roundedRect(ctx, center.x - 35, center.y - 53, 70, 99, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 197, 98, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(2, 11, 13, 0.72)";
    roundedRect(ctx, center.x - 31, center.y + 8, 62, 22, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 197, 98, 0.26)";
    ctx.stroke();

    const occupied = game.buffers.find((buffer) => buffer.reservedBy);
    if (occupied) {
      ctx.strokeStyle = alpha(COLORS.red, 0.54 + Math.sin(now / 150) * 0.16);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      roundedRect(ctx, center.x - 35, center.y - 53, 70, 99, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      occupied.boxes.forEach((box, index) => {
        this.drawBox(ctx, center.x, center.y + 8 - index * 13.5, box, COLORS.red, index);
      });
      drawText(ctx, "TEMPORARY", center.x, center.y - 63, {
        color: alpha(COLORS.red, 0.72),
        font: '700 8px "Bahnschrift", sans-serif',
        align: "center",
        letterSpacing: "1px",
      });
    } else {
      drawText(ctx, "BUFFER", center.x, center.y - 2, {
        color: "rgba(255, 197, 98, 0.34)",
        font: '700 8px "Bahnschrift", sans-serif',
        align: "center",
        letterSpacing: "1.2px",
      });
    }
    drawText(ctx, "翻箱缓冲区", center.x, center.y + 38, {
      color: "rgba(255, 197, 98, 0.48)",
      font: '600 9px "Microsoft YaHei", sans-serif',
      align: "center",
    });
    ctx.restore();
  }

  drawTrucks(ctx, game, ui, now) {
    const waiting = game.queue
      .map((id) => getTruck(game, id))
      .filter(Boolean);
    waiting.forEach((truck, index) => {
      const x = 16;
      const y = 160 + index * 109;
      const width = 94;
      const height = 88;
      const destination = DESTINATIONS[truck.destination];
      const selected = ui.selectedTruckId === truck.id;
      const urgent = truck.deadline - game.time <= 5;
      this.hits.push({ type: "truck", id: truck.id, x, y, w: width, h: height });

      ctx.save();
      if (selected) {
        ctx.fillStyle = alpha(COLORS.cyan, 0.12);
        ctx.strokeStyle = alpha(COLORS.cyan, 0.5);
      } else {
        ctx.fillStyle = "rgba(8, 27, 30, 0.76)";
        ctx.strokeStyle = "rgba(112, 171, 164, 0.18)";
      }
      roundedRect(ctx, x, y, width, height, 4);
      ctx.fill();
      ctx.lineWidth = selected ? 1.4 : 1;
      ctx.stroke();
      ctx.fillStyle = alpha(destination.color, 0.66);
      ctx.fillRect(x, y + 1, 2, height - 2);

      drawText(ctx, `QUEUE ${index + 1}`, x + 10, y + 12, {
        color: urgent ? alpha(COLORS.red, 0.85) : "rgba(151, 185, 179, 0.56)",
        font: '700 7px "Bahnschrift", sans-serif',
        letterSpacing: "1.1px",
      });
      this.drawTruckIcon(ctx, x + 47, y + 34, destination.color, selected);
      drawText(ctx, truck.plate, x + 47, y + 52, {
        color: selected ? COLORS.ink : "#c8d8d5",
        font: '700 10px "Bahnschrift", "Microsoft YaHei", sans-serif',
        align: "center",
      });
      drawText(ctx, `${destination.code} · ${truck.weight}t`, x + 10, y + 66, {
        color: alpha(destination.color, 0.9),
        font: '600 8px "Bahnschrift", sans-serif',
      });
      drawText(ctx, `截止 ${formatMinute(truck.deadline)}`, x + 84, y + 66, {
        color: urgent ? alpha(COLORS.red, 0.9) : "rgba(151, 185, 179, 0.56)",
        font: '500 7px "Microsoft YaHei", sans-serif',
        align: "right",
      });
      if (index === 0) {
        ctx.fillStyle = alpha(COLORS.amber, 0.18);
        roundedRect(ctx, x + 10, y + 75, 43, 9, 2);
        ctx.fill();
        drawText(ctx, "首位可派", x + 31.5, y + 80, {
          color: alpha(COLORS.amber, 0.9),
          font: '600 6px "Microsoft YaHei", sans-serif',
          align: "center",
        });
      }
      ctx.restore();
    });

    const activeTruck = game.trucks.find((truck) => truck.status === "loading");
    if (activeTruck) {
      const point = cellCenter(0.45, 3.2);
      ctx.save();
      ctx.globalAlpha = 0.9;
      this.drawTruckIcon(ctx, point.x, point.y, DESTINATIONS[activeTruck.destination].color, false);
      drawText(ctx, "卡口交接", point.x, point.y + 22, {
        color: "rgba(255, 197, 98, 0.72)",
        font: '600 7px "Microsoft YaHei", sans-serif',
        align: "center",
      });
      ctx.restore();
    }
  }

  drawTruckIcon(ctx, x, y, color, selected) {
    ctx.save();
    ctx.fillStyle = selected ? alpha(color, 0.28) : alpha(color, 0.12);
    ctx.strokeStyle = alpha(color, 0.74);
    ctx.lineWidth = 1;
    roundedRect(ctx, x - 21, y - 11, 30, 19, 2);
    ctx.fill();
    ctx.stroke();
    roundedRect(ctx, x + 9, y - 8, 11, 16, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = alpha(color, 0.9);
    ctx.beginPath();
    ctx.arc(x - 15, y + 9, 3, 0, TAU);
    ctx.arc(x + 13, y + 9, 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawCranes(ctx, game, ui, now) {
    for (const crane of game.cranes) {
      const visual = this.visual.get(crane.id) || cellCenter(crane.col, crane.row);
      const color = crane.id === "A" ? COLORS.cyan : COLORS.amber;
      const selected = ui.selectedCraneId === crane.id;
      ctx.save();
      ctx.globalAlpha = crane.operation ? 1 : 0.78;

      ctx.fillStyle = "rgba(0, 0, 0, 0.36)";
      ctx.beginPath();
      ctx.ellipse(visual.x, visual.y + 23, 27, 7, 0, 0, TAU);
      ctx.fill();

      if (selected) {
        ctx.strokeStyle = alpha(color, 0.32 + Math.sin(now / 230) * 0.12);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(visual.x, visual.y, 31, 0, TAU);
        ctx.stroke();
      }
      if (crane.operation) {
        const pulse = 17 + ((now / 12) % 7);
        ctx.strokeStyle = alpha(color, 0.28);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(visual.x, visual.y, pulse, 0, TAU);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(155, 198, 191, 0.44)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(visual.x - 18, visual.y + 18);
      ctx.lineTo(visual.x - 18, visual.y - 10);
      ctx.moveTo(visual.x + 18, visual.y + 18);
      ctx.lineTo(visual.x + 18, visual.y - 10);
      ctx.moveTo(visual.x - 25, visual.y - 11);
      ctx.lineTo(visual.x + 25, visual.y - 11);
      ctx.stroke();

      ctx.fillStyle = alpha(color, 0.23);
      ctx.strokeStyle = alpha(color, 0.84);
      ctx.lineWidth = 1;
      roundedRect(ctx, visual.x - 12, visual.y - 7, 24, 15, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = alpha(color, 0.88);
      ctx.fillRect(visual.x - 24, visual.y - 14, 48, 2);
      ctx.fillRect(visual.x - 4, visual.y - 8, 2, 8);
      drawText(ctx, crane.id, visual.x, visual.y + 1, {
        color: COLORS.ink,
        font: '700 9px "Bahnschrift", sans-serif',
        align: "center",
      });

      const truck = crane.operation?.type === "unload" ? getTruck(game, crane.operation.truckId) : null;
      if (truck && truck.status === "carried") {
        const boxColor = DESTINATIONS[truck.destination].color;
        ctx.fillStyle = alpha(boxColor, 0.26);
        ctx.strokeStyle = alpha(boxColor, 0.68);
        roundedRect(ctx, visual.x - 16, visual.y + 15, 32, 8, 1);
        ctx.fill();
        ctx.stroke();
      }

      if (crane.blockedReported) {
        ctx.fillStyle = alpha(COLORS.red, 0.16);
        ctx.strokeStyle = alpha(COLORS.red, 0.8);
        roundedRect(ctx, visual.x - 17, visual.y - 33, 34, 14, 2);
        ctx.fill();
        ctx.stroke();
        drawText(ctx, "WAIT", visual.x, visual.y - 26, {
          color: COLORS.red,
          font: '700 7px "Bahnschrift", sans-serif',
          align: "center",
          letterSpacing: "1px",
        });
      }
      ctx.restore();
    }
  }

  drawOverlayDetails(ctx, game, ui) {
    const yardWidth = CONFIG.cols * CELL_W;
    const yardHeight = CONFIG.rows * CELL_H;
    if (game.channelBlocked) {
      for (const col of game.blockedColumns) {
        const x = ORIGIN_X + col * CELL_W;
        const y = ORIGIN_Y + 3 * CELL_H;
        ctx.save();
        ctx.fillStyle = "rgba(255, 107, 104, 0.16)";
        ctx.fillRect(x, y, CELL_W, CELL_H * 2);
        ctx.strokeStyle = "rgba(255, 107, 104, 0.72)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H * 2 - 4);
        ctx.restore();
      }
      drawText(ctx, "CHANNEL BLOCKED", ORIGIN_X + yardWidth / 2, ORIGIN_Y + 4 * CELL_H + 16, {
        color: COLORS.red,
        font: '700 9px "Bahnschrift", sans-serif',
        align: "center",
        letterSpacing: "1.5px",
      });
    }

    ctx.save();
    ctx.strokeStyle = "rgba(118, 173, 166, 0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ORIGIN_X - 1, ORIGIN_Y - 1, yardWidth + 2, yardHeight + 2);
    ctx.restore();

    drawText(ctx, "13 × 9 堆场网格", ORIGIN_X, 70, {
      color: "rgba(133, 176, 170, 0.5)",
      font: '700 8px "Bahnschrift", "Microsoft YaHei", sans-serif',
      letterSpacing: "1.4px",
    });
    drawText(ctx, `LIVE LOAD  ${Math.round(ui.load * 100)}%`, ORIGIN_X + yardWidth, 70, {
      color: ui.channelBlocked ? COLORS.red : "rgba(255, 197, 98, 0.56)",
      font: '700 8px "Bahnschrift", sans-serif',
      align: "right",
      letterSpacing: "1px",
    });

    drawText(ctx, "西侧卡口 / 车辆队列", 20, 134, {
      color: "rgba(133, 176, 170, 0.5)",
      font: '700 8px "Microsoft YaHei", sans-serif',
      letterSpacing: "1px",
    });

    if (!ui.selectedTruckId) {
      drawText(ctx, "点击左侧集卡或箱位开始调度", ORIGIN_X + yardWidth / 2, yardHeight + ORIGIN_Y + 37, {
        color: "rgba(133, 176, 170, 0.52)",
        font: '500 10px "Microsoft YaHei", sans-serif',
        align: "center",
      });
    }
  }
}
