import { CANVAS } from "./model.js";

const NS = "http://www.w3.org/2000/svg";

function removeEditorArtifacts(root) {
  root.querySelectorAll("[data-ui='true'], .port, .selection-halo").forEach((element) => element.remove());
  root.querySelectorAll(".node.selected, .edge.selected").forEach((element) => {
    element.classList.remove("selected");
  });
}

function addTitle(root, title) {
  const group = document.createElementNS(NS, "g");
  group.setAttribute("class", "export-heading");
  const caption = document.createElementNS(NS, "text");
  caption.setAttribute("x", "54");
  caption.setAttribute("y", "64");
  caption.setAttribute("class", "export-subtitle");
  caption.textContent = "FLOWBOARD · FLOWCHART";
  const heading = document.createElementNS(NS, "text");
  heading.setAttribute("x", "54");
  heading.setAttribute("y", "92");
  heading.setAttribute("class", "export-title");
  heading.textContent = title;
  group.append(caption, heading);
  root.append(group);
}

export function buildSvgDocument(svg, title, extraCss = "") {
  const clone = svg.cloneNode(true);
  removeEditorArtifacts(clone);
  if (extraCss) {
    const style = document.createElementNS(NS, "style");
    style.setAttribute("data-export-font", "true");
    style.textContent = extraCss;
    clone.querySelector("defs")?.append(style);
  }
  clone.setAttribute("xmlns", NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", CANVAS.width);
  clone.setAttribute("height", CANVAS.height);
  clone.setAttribute("viewBox", `0 0 ${CANVAS.width} ${CANVAS.height}`);
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-label", `${title} SVG 流程图`);
  addTitle(clone, title);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(title) {
  return String(title || "flowchart")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");
}
