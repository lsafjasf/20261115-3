export const GRAPH_STYLE = `
.canvas-bg { fill: #f8f7f2; }
.grid-line { stroke: #e9e5dc; stroke-width: 1; }
.node { cursor: grab; }
.node:active { cursor: grabbing; }
.node-shape { stroke-width: 1.6; filter: url(#soft-shadow); }
.process-shape { fill: #fffdf9; stroke: #d3d7df; }
.start-shape { fill: #e8f8ef; stroke: #2d9c6b; }
.end-shape { fill: #eef1f6; stroke: #596780; }
.decision-shape { fill: #fff8e7; stroke: #d88f2d; }
.merge-shape { fill: #eef0ff; stroke: #5f6dd6; }
.comment-shape { fill: #fff4cb; stroke: #c79a35; stroke-dasharray: 6 4; }
.comment-fold { fill: none; stroke: #c79a35; stroke-width: 1.2; }
.node-accent { fill: #e56d49; }
.endpoint-dot { fill: #2d9c6b; stroke: #fffdf9; stroke-width: 2; }
.node-end .endpoint-dot { fill: #596780; }
.node-kicker {
  fill: #8490a4; font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
  text-transform: uppercase; font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
.node-label {
  fill: #202b41; font-size: 15px; font-weight: 650;
  font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
.node-label.compact { font-size: 14px; }
.decision-label {
  fill: #44331b; font-size: 14px; font-weight: 700;
  font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
.endpoint-label { font-size: 15px; font-weight: 700; }
.comment-label {
  fill: #5b4820; font-size: 12.5px; font-weight: 500; line-height: 1.5;
  font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
.selection-halo {
  fill: rgba(231, 101, 66, 0.05); stroke: #e76542; stroke-width: 2;
  stroke-dasharray: 5 5; pointer-events: none;
}
.port {
  fill: #fffdf9; stroke: #e76542; stroke-width: 2; opacity: 0;
  cursor: crosshair; transition: opacity 120ms ease, r 120ms ease;
}
.node:hover .port, .node.selected .port { opacity: 1; }
.edge-hit { fill: none; stroke: transparent; stroke-width: 16; pointer-events: stroke; cursor: pointer; }
.edge-line { fill: none; stroke: #78859b; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.edge.selected .edge-line { stroke: #e76542; stroke-width: 2.6; }
.edge-label-bg { fill: #fffdf9; stroke: #e2ded4; stroke-width: 1; }
.edge-label text {
  fill: #59657a; font-size: 11px; font-weight: 700;
  font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
.export-title {
  fill: #1f2a40; font-size: 21px; font-weight: 750;
  font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
.export-subtitle {
  fill: #8892a3; font-size: 11px; font-weight: 600; letter-spacing: 1.2px;
  font-family: "Flowboard Sans", "DM Sans", "Noto Sans SC", sans-serif;
}
`;

export function installGraphStyles(svg) {
  const defs = svg.querySelector("defs");
  if (!defs || defs.querySelector("style[data-graph-style]")) return;
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.setAttribute("data-graph-style", "true");
  style.textContent = GRAPH_STYLE;
  defs.prepend(style);
}
