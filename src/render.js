import { CANVAS, portPoint } from "./model.js";
import { routeToPath } from "./router.js";

const NS = "http://www.w3.org/2000/svg";

function element(tag, attrs = {}, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function wrapText(text, maxChars, maxLines = 3) {
  const source = String(text ?? "").trim();
  if (!source) return [""];
  const lines = [];
  let current = "";
  for (const word of source.split(/(\s+)/)) {
    if (!word) continue;
    if ([...current, ...word].length <= maxChars) {
      current += word;
      continue;
    }
    if (current.trim()) lines.push(current.trim());
    current = "";
    if (word.length > maxChars) {
      const chars = [...word];
      while (chars.length) {
        lines.push(chars.splice(0, maxChars).join(""));
        if (lines.length >= maxLines) break;
      }
    } else {
      current = word.trimStart();
    }
    if (lines.length >= maxLines) break;
  }
  if (current.trim() && lines.length < maxLines) lines.push(current.trim());
  if (!lines.length) lines.push(source.slice(0, maxChars));
  if (lines.length === maxLines && source.length > lines.join("").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines;
}

function appendText(parent, lines, options) {
  const {
    x,
    y,
    lineHeight = 19,
    anchor = "middle",
    className = "node-label",
  } = options;
  const text = element("text", {
    x,
    y,
    "text-anchor": anchor,
    class: className,
  });
  lines.forEach((line, index) => {
    text.append(element("tspan", { x, dy: index === 0 ? 0 : lineHeight }, line));
  });
  parent.append(text);
}

function shapeFor(node) {
  const { width: w, height: h, type } = node;
  if (type === "decision") {
    return element("polygon", {
      points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
      class: "node-shape decision-shape",
    });
  }
  if (type === "merge") {
    return element("polygon", {
      points: `24,0 ${w - 24},0 ${w},${h / 2} ${w - 24},${h} 24,${h} 0,${h / 2}`,
      class: "node-shape merge-shape",
    });
  }
  if (type === "comment") {
    return element("path", {
      d: `M 0 12 Q 0 0 12 0 H ${w - 24} L ${w} 24 V ${h - 12} Q ${w} ${h} ${w - 12} ${h} H 12 Q 0 ${h} 0 ${h - 12} Z`,
      class: "node-shape comment-shape",
    });
  }
  return element("rect", {
    width: w,
    height: h,
    rx: type === "start" || type === "end" ? h / 2 : 14,
    class: `node-shape ${type}-shape`,
  });
}

function renderNode(node, selected) {
  const group = element("g", {
    class: `node node-${node.type}${selected ? " selected" : ""}`,
    transform: `translate(${node.x} ${node.y})`,
    "data-node-id": node.id,
  });
  const { width: w, height: h, type } = node;

  if (selected) {
    group.append(element("rect", {
      x: -7,
      y: -7,
      width: w + 14,
      height: h + 14,
      rx: type === "comment" ? 16 : 18,
      class: "selection-halo",
      "data-ui": "true",
    }));
  }

  group.append(shapeFor(node));

  if (type === "process") {
    group.append(element("rect", { width: 5, height: h - 28, x: 0, y: 14, rx: 3, class: "node-accent" }));
  }
  if (type === "comment") {
    group.append(element("path", {
      d: `M ${w - 24} 0 V 24 H ${w}`,
      class: "comment-fold",
    }));
    group.append(element("text", { x: 16, y: 26, class: "node-kicker" }, "注释"));
    const lines = wrapText(node.text, Math.max(9, Math.floor((w - 32) / 13)), 3);
    appendText(group, lines, { x: 16, y: 52, lineHeight: 20, anchor: "start", className: "comment-label" });
  } else if (type === "decision") {
    const lines = wrapText(node.text, 8, 2);
    appendText(group, lines, { x: w / 2, y: h / 2 - (lines.length - 1) * 9 + 4, lineHeight: 20, className: "decision-label" });
  } else if (type === "merge") {
    group.append(element("text", { x: w / 2, y: 25, class: "node-kicker" }, "汇合"));
    appendText(group, [node.text], { x: w / 2, y: 49, className: "node-label compact" });
  } else if (type === "start" || type === "end") {
    group.append(element("circle", { cx: 23, cy: h / 2, r: 5, class: "endpoint-dot" }));
    appendText(group, [node.text], { x: w / 2 + 9, y: h / 2 + 5, className: "node-label endpoint-label" });
  } else {
    group.append(element("text", { x: 22, y: 25, class: "node-kicker" }, "步骤"));
    const lines = wrapText(node.text, Math.max(7, Math.floor((w - 44) / 15)), 2);
    appendText(group, lines, { x: 22, y: 48, lineHeight: 19, anchor: "start", className: "node-label" });
  }

  for (const port of ["north", "east", "south", "west"]) {
    const point = portPoint({ ...node, x: 0, y: 0 }, port);
    group.append(element("circle", {
      cx: point.x,
      cy: point.y,
      r: 5.5,
      class: "port",
      "data-port": port,
      "data-node-id": node.id,
      "data-ui": "true",
    }));
  }
  return group;
}

function renderEdge(edge, route, selected) {
  if (!route) return null;
  const group = element("g", { class: `edge${selected ? " selected" : ""}`, "data-edge-id": edge.id });
  const d = routeToPath(route.points);
  group.append(element("path", {
    d,
    class: "edge-hit",
    "data-edge-id": edge.id,
    "data-ui": "true",
  }));
  group.append(element("path", { d, class: "edge-line", "marker-end": "url(#arrow)" }));

  if (edge.label) {
    const labelWidth = Math.max(34, [...edge.label].length * 14 + 20);
    const label = element("g", {
      class: "edge-label",
      transform: `translate(${route.labelPoint.x} ${route.labelPoint.y})`,
    });
    label.append(element("rect", {
      x: -labelWidth / 2,
      y: -12,
      width: labelWidth,
      height: 24,
      rx: 12,
      class: "edge-label-bg",
    }));
    label.append(element("text", { x: 0, y: 4, "text-anchor": "middle" }, edge.label));
    group.append(label);
  }
  return group;
}

export function renderGraph(svg, graph, routes, selection) {
  const edgeLayer = svg.querySelector("[data-layer='edges']");
  const nodeLayer = svg.querySelector("[data-layer='nodes']");
  edgeLayer.replaceChildren();
  nodeLayer.replaceChildren();

  for (const edge of graph.edges) {
    const rendered = renderEdge(edge, routes.get(edge.id), selection?.kind === "edge" && selection.id === edge.id);
    if (rendered) edgeLayer.append(rendered);
  }
  for (const node of graph.nodes) {
    nodeLayer.append(renderNode(node, selection?.kind === "node" && selection.id === node.id));
  }
}

export function screenToCanvas(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

export function clampToCanvas(x, y, width, height) {
  return {
    x: Math.max(18, Math.min(CANVAS.width - width - 18, x)),
    y: Math.max(18, Math.min(CANVAS.height - height - 18, y)),
  };
}
