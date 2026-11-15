import { EDGES, EDGE_MAP, NODES, isEdgeBlocked } from './map.js';
import { INCIDENT_TYPES } from './config.js';

const NODE_RADIUS = 13;
const VEHICLE_COLORS = {
  ambulance: '#36c5f0',
  rescue: '#ffb020',
  fire: '#ff5c5c',
  hazmat: '#b06cff',
};

export function vehiclePosition(vehicle) {
  if (!vehicle.path || vehicle.pathIndex >= vehicle.path.length) {
    const node = NODES[vehicle.nodeId];
    return { x: node.x, y: node.y };
  }
  const edge = EDGE_MAP.get(vehicle.path[vehicle.pathIndex]);
  const from = NODES[edge.a];
  const to = NODES[edge.b];
  const ratio = Math.min(1, vehicle.edgeProgress / edge.dist);
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

function edgeEndpoints(edge) {
  return { from: NODES[edge.a], to: NODES[edge.b] };
}

export function render(ctx, state, selectedId, canvasWidth = 880, canvasHeight = 560) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawBackground(ctx, canvasWidth, canvasHeight);
  drawRoads(ctx, state);
  drawBlockages(ctx, state);
  drawNodes(ctx, state);
  drawIncidents(ctx, state);
  drawVehicles(ctx, state, selectedId);
  drawLabels(ctx, state);
}

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#101826');
  gradient.addColorStop(1, '#0a101b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawRoads(ctx, state) {
  for (const edge of EDGES) {
    const { from, to } = edgeEndpoints(edge);
    const occupied = (state.vehicleEdgeCounts.get(edge.id) || 0) > 0;
    const blocked = isEdgeBlocked(state.blockages, edge.id, state.time);
    ctx.lineCap = 'round';
    ctx.lineWidth = blocked ? 7 : occupied ? 8 : 5;
    if (blocked) ctx.strokeStyle = '#ff3b3b';
    else if (occupied) ctx.strokeStyle = '#f6c453';
    else ctx.strokeStyle = 'rgba(160,180,210,0.55)';
    ctx.setLineDash(blocked ? [10, 8] : []);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (occupied) {
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      ctx.fillStyle = '#fff4cf';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${edge.dist}km`, midX, midY - 8);
    }
  }
}

function drawBlockages(ctx, state) {
  for (const block of state.blockages) {
    if (state.time < block.start || state.time >= block.end) continue;
    const edge = EDGE_MAP.get(block.edgeId);
    const { from, to } = edgeEndpoints(edge);
    const x = (from.x + to.x) / 2;
    const y = (from.y + to.y) / 2;
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('封', x, y + 0.5);
  }
}

function drawNodes(ctx, state) {
  for (const node of Object.values(NODES)) {
    const colors = {
      depot: '#4ade80',
      hospital: '#f87171',
      junction: '#94a3b8',
      site: '#f59e0b',
    };
    ctx.fillStyle = colors[node.kind];
    ctx.beginPath();
    ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (node.kind === 'hospital') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', node.x, node.y + 0.5);
    } else if (node.kind === 'depot') {
      ctx.fillStyle = '#062814';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('站', node.x, node.y + 0.5);
    }
  }
}

function drawIncidents(ctx, state) {
  for (const incident of state.incidents) {
    const node = NODES[incident.nodeId];
    const type = INCIDENT_TYPES[incident.type];
    const pulse = incident.controlled ? 1 : 1 + Math.sin(state.time * 2.2) * 0.12;
    ctx.strokeStyle = incident.controlled ? 'rgba(74,222,128,0.9)' : type.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(node.x, node.y, NODE_RADIUS + 7 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    const worst = state.victims
      .filter((victim) => victim.incidentId === incident.id && victim.state === 'onsite')
      .reduce((min, victim) => Math.min(min, victim.status), 100);
    ctx.fillStyle = worst < 35 ? '#ff6b6b' : '#ffe7a8';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${incident.remaining}人待运`, node.x, node.y - NODE_RADIUS - 12);
  }
}

function drawVehicles(ctx, state, selectedId) {
  for (const vehicle of state.vehicles) {
    const pos = vehiclePosition(vehicle);
    const color = VEHICLE_COLORS[vehicle.type];
    const selected = vehicle.id === selectedId;
    ctx.fillStyle = vehicle.status === 'stranded' ? '#6b7280' : color;
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y + 16, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(vehicle.id, pos.x, pos.y + 16.5);
    if (vehicle.carrying.length > 0) {
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(pos.x + 9, pos.y + 9, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(String(vehicle.carrying.length), pos.x + 9, pos.y + 9.5);
    }
  }
}

function drawLabels(ctx, state) {
  ctx.textBaseline = 'alphabetic';
  for (const node of Object.values(NODES)) {
    ctx.fillStyle = 'rgba(226,232,240,0.92)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const offset = node.kind === 'site' ? 26 : 24;
    ctx.fillText(node.name, node.x, node.y + offset);
  }
}

export function drawVictimStatusBars(ctx, state, x, y) {
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  state.victims.forEach((victim, index) => {
    const row = Math.floor(index / 4);
    const col = index % 4;
    const px = x + col * 92;
    const py = y + row * 26;
    const color = !victim.alive
      ? '#6b7280'
      : victim.state === 'delivered'
        ? '#4ade80'
        : victim.status < 35
          ? '#ff5c5c'
          : '#fbbf24';
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(px, py, 82, 8);
    ctx.fillStyle = color;
    ctx.fillRect(px, py, Math.max(0, victim.status) * 0.82, 8);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${victim.id} ${victim.state === 'delivered' ? '已送院' : victim.state === 'dead' ? '死亡' : `${Math.round(victim.status)}%`}`, px, py - 2);
  });
}
