"use strict";

const els = {
  threshold: document.getElementById("threshold"),
  thresholdValue: document.getElementById("thresholdValue"),
  noiseSize: document.getElementById("noiseSize"),
  noiseValue: document.getElementById("noiseValue"),
  skeletonize: document.getElementById("skeletonize"),
  minLength: document.getElementById("minLength"),
  lengthValue: document.getElementById("lengthValue"),
  sampleBtn: document.getElementById("sampleBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  fileInput: document.getElementById("fileInput"),
  exportBtn: document.getElementById("exportBtn"),
  canvas: document.getElementById("previewCanvas"),
  svgHost: document.getElementById("svgHost"),
  statNodes: document.getElementById("statNodes"),
  statEdges: document.getElementById("statEdges"),
  statVertices: document.getElementById("statVertices"),
  statNoise: document.getElementById("statNoise"),
};

let currentImage = null;
let latestSvg = null;
let requestSeq = 0;

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageToDataUrl(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function drawPreview(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const ctx = els.canvas.getContext("2d");
    els.canvas.width = img.naturalWidth;
    els.canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
}

async function processImage() {
  if (!currentImage) return;
  const seq = ++requestSeq;
  const body = {
    image: currentImage,
    threshold: Number(els.threshold.value),
    noise_size: Number(els.noiseSize.value),
    skeletonize: Number(els.skeletonize.value),
    min_length: Number(els.minLength.value),
  };
  const response = await fetch("/api/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (seq !== requestSeq) return; // stale response
  if (data.error) {
    alert("处理失败: " + data.error);
    return;
  }
  latestSvg = data.svg;
  drawPreview(data.preview);
  els.svgHost.innerHTML = data.svg;
  els.statNodes.textContent = data.stats.nodes;
  els.statEdges.textContent = data.stats.edges;
  els.statVertices.textContent = data.stats.vertices;
  els.statNoise.textContent = data.stats.removedNoise;
  els.exportBtn.disabled = false;
}

let debounceTimer = null;
function scheduleProcess() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(processImage, 150);
}

function syncLabels() {
  els.thresholdValue.textContent = els.threshold.value;
  els.noiseValue.textContent = els.noiseSize.value;
  els.lengthValue.textContent = els.minLength.value;
}

async function loadSample() {
  const response = await fetch("/api/sample");
  const data = await response.json();
  currentImage = data.image;
  await processImage();
}

els.sampleBtn.addEventListener("click", loadSample);
els.uploadBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  const img = await readImageFile(file);
  currentImage = imageToDataUrl(img);
  await processImage();
});
for (const input of [els.threshold, els.noiseSize, els.skeletonize, els.minLength]) {
  input.addEventListener("input", () => {
    syncLabels();
    scheduleProcess();
  });
}
els.exportBtn.addEventListener("click", () => {
  if (!latestSvg) return;
  const blob = new Blob([latestSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "line-art.svg";
  a.click();
  URL.revokeObjectURL(url);
});

syncLabels();
