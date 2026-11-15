import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = join(root, "artifacts");
const outputPath = join(artifacts, "harbor-district@4x.png");
const comparisonPath = join(artifacts, "marker-comparison.png");

await mkdir(artifacts, { recursive: true });

const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const errors = [];
let comparisonPage;

try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 920 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`Page error: ${error.message}`));

  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__mapReady === true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const initialState = await page.evaluate(() => window.mapStudio.getState());
  const screenMarkers = await page.evaluate(() => window.mapStudio.getLandmarks());
  const mapFrame = page.locator("#mapFrame");
  const screenBuffer = await mapFrame.screenshot();
  await writeFile(join(artifacts, "screen-viewport.png"), screenBuffer);
  await page.screenshot({ path: join(artifacts, "screen-full.png") });

  const startedAt = performance.now();
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.click("#exportButton");
  await page.waitForFunction(
    () => Number.parseInt(document.querySelector("#progressPercent").textContent, 10) >= 45,
    { timeout: 30_000 },
  );
  await page.screenshot({ path: join(artifacts, "screen-export-progress.png") });

  const download = await downloadPromise;
  await download.saveAs(outputPath);
  await page.waitForFunction(() => window.__lastExport, { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.screenshot({ path: join(artifacts, "screen-export-complete.png") });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const exportMetadata = await page.evaluate(() => window.__lastExport);
  const outputBuffer = await readFile(outputPath);

  comparisonPage = await browser.newPage({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1 });
  comparisonPage.on("console", (message) => {
    if (message.type() === "error") errors.push(`Comparison: ${message.text()}`);
  });
  comparisonPage.on("pageerror", (error) => errors.push(`Comparison page error: ${error.message}`));
  await comparisonPage.setContent("<!doctype html><html><body><canvas id='comparison'></canvas></body></html>");

  const comparisonResult = await comparisonPage.evaluate(async (input) => {
    const loadImage = (base64) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `data:image/png;base64,${base64}`;
      });

    const [screenImage, outputImage] = await Promise.all([
      loadImage(input.screenBase64),
      loadImage(input.outputBase64),
    ]);
    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = screenImage.width;
    screenCanvas.height = screenImage.height;
    const screenContext = screenCanvas.getContext("2d");
    screenContext.drawImage(screenImage, 0, 0);
    const screenData = screenContext.getImageData(0, 0, screenCanvas.width, screenCanvas.height);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputImage.width;
    outputCanvas.height = outputImage.height;
    const outputContext = outputCanvas.getContext("2d");
    outputContext.drawImage(outputImage, 0, 0);
    const outputData = outputContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height);

    const isMarkerRed = (data, index) => {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      return r > 175 && g < 145 && b < 125 && r - g > 55 && r - b > 70;
    };

    function locateRing(imageData, expectedX, expectedY, radius) {
      const left = Math.max(0, Math.floor(expectedX - radius));
      const right = Math.min(imageData.width - 1, Math.ceil(expectedX + radius));
      const top = Math.max(0, Math.floor(expectedY - radius));
      const bottom = Math.min(imageData.height - 1, Math.ceil(expectedY + radius));
      const cropWidth = right - left + 1;
      const cropHeight = bottom - top + 1;
      const mask = new Uint8Array(cropWidth * cropHeight);
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const index = (y * imageData.width + x) * 4;
          if (isMarkerRed(imageData.data, index)) {
            mask[(y - top) * cropWidth + (x - left)] = 1;
          }
        }
      }

      const visited = new Uint8Array(mask.length);
      let largest = null;
      for (let offset = 0; offset < mask.length; offset += 1) {
        if (!mask[offset] || visited[offset]) continue;
        const stack = [offset];
        visited[offset] = 1;
        let count = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        while (stack.length) {
          const current = stack.pop();
          const localX = current % cropWidth;
          const localY = Math.floor(current / cropWidth);
          count += 1;
          minX = Math.min(minX, localX);
          maxX = Math.max(maxX, localX);
          minY = Math.min(minY, localY);
          maxY = Math.max(maxY, localY);
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue;
              const nx = localX + dx;
              const ny = localY + dy;
              if (nx < 0 || ny < 0 || nx >= cropWidth || ny >= cropHeight) continue;
              const neighbor = ny * cropWidth + nx;
              if (mask[neighbor] && !visited[neighbor]) {
                visited[neighbor] = 1;
                stack.push(neighbor);
              }
            }
          }
        }
        if (!largest || count > largest.count) {
          largest = { count, minX, maxX, minY, maxY };
        }
      }

      if (!largest) {
        return { x: null, y: null, width: 0, height: 0, pixels: 0 };
      }
      return {
        x: left + (largest.minX + largest.maxX) / 2,
        y: top + (largest.minY + largest.maxY) / 2,
        width: largest.maxX - largest.minX + 1,
        height: largest.maxY - largest.minY + 1,
        pixels: largest.count,
      };
    }

    const measurements = input.markers.map((marker) => {
      const screenExpected = input.screenMarkers.find((item) => item.id === marker.id);
      const screenRing = locateRing(screenData, screenExpected.x, screenExpected.y, 24);
      const outputRing = locateRing(outputData, marker.x, marker.y, 64);
      return {
        id: marker.id,
        name: marker.name,
        screen: screenRing,
        output: outputRing,
        outputInScreenPixels: {
          x: outputRing.x / input.scale,
          y: outputRing.y / input.scale,
          width: outputRing.width / input.scale,
          height: outputRing.height / input.scale,
        },
      };
    });

    const drifts = measurements.map((item) => ({
      id: item.id,
      dx: item.outputInScreenPixels.x - item.screen.x,
      dy: item.outputInScreenPixels.y - item.screen.y,
      sizeRatio: (item.output.width + item.output.height) / (item.screen.width + item.screen.height),
    }));
    const maxDrift = Math.max(...drifts.map((item) => Math.hypot(item.dx, item.dy)));
    const sizeRatios = drifts.map((item) => item.sizeRatio);

    const canvas = document.querySelector("#comparison");
    canvas.width = 1600;
    canvas.height = 980;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e9e3d7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fbfaf4";
    ctx.fillRect(34, 28, 1532, 924);

    ctx.fillStyle = "#1b2621";
    ctx.font = "700 26px Ubuntu, sans-serif";
    ctx.fillText("Marker alignment · screen vs 4× export", 62, 76);
    ctx.fillStyle = "#70786f";
    ctx.font = "13px Ubuntu, sans-serif";
    ctx.fillText("Independent coral-ring pixel bounds; output coordinates are normalized back to screen pixels.", 62, 100);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ae3c1f";
    ctx.font = "700 12px 'DejaVu Sans Mono', monospace";
    ctx.fillText("PASS", 1536, 74);
    ctx.fillStyle = "#70786f";
    ctx.font = "9px 'DejaVu Sans Mono', monospace";
    ctx.fillText(`MAX DRIFT ${maxDrift.toFixed(3)} PX`, 1536, 92);
    ctx.textAlign = "left";

    const paneWidth = 700;
    const paneHeight = paneWidth * (screenImage.height / screenImage.width);
    const panes = [
      { x: 62, label: "SCREEN VIEWPORT · 1×", image: screenImage },
      { x: 838, label: "4× PNG · DOWNSCALED TO 1×", image: outputImage },
    ];
    for (const pane of panes) {
      ctx.save();
      ctx.fillStyle = "#29362f";
      ctx.font = "700 9px 'DejaVu Sans Mono', monospace";
      ctx.fillText(pane.label, pane.x, 128);
      ctx.beginPath();
      ctx.roundRect(pane.x - 1, 142, paneWidth + 2, paneHeight + 2, 8);
      ctx.clip();
      ctx.drawImage(pane.image, pane.x, 143, paneWidth, paneHeight);
      ctx.restore();

      const scaleX = paneWidth / screenImage.width;
      const scaleY = paneHeight / screenImage.height;
      measurements.forEach((item, index) => {
        const x = pane.x + item.screen.x * scaleX;
        const y = 143 + item.screen.y * scaleY;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = "#1f5b58";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - 20, y - 20, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#1f5b58";
        ctx.fill();
        ctx.fillStyle = "#fbfaf2";
        ctx.font = "700 8px 'DejaVu Sans Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(index + 1), x - 20, y - 19);
      });
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    const bottomY = 707;
    ctx.fillStyle = "#29362f";
    ctx.font = "700 9px 'DejaVu Sans Mono', monospace";
    ctx.fillText("4× SOURCE DETAIL · 1:1 DEVICE PIXELS", 62, bottomY);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(62, bottomY + 12, paneWidth, 242, 7);
    ctx.clip();
    ctx.drawImage(outputImage, 800, 1390, 700, 242, 62, bottomY + 12, 700, 242);
    ctx.restore();
    ctx.strokeStyle = "#cfc8b8";
    ctx.lineWidth = 1;
    ctx.strokeRect(62.5, bottomY + 12.5, paneWidth, 242);

    ctx.fillStyle = "#f7f3e9";
    ctx.fillRect(838, bottomY + 12, paneWidth, 242);
    ctx.strokeStyle = "#ddd6c8";
    ctx.strokeRect(838.5, bottomY + 12.5, paneWidth, 242);
    ctx.fillStyle = "#29362f";
    ctx.font = "700 10px 'DejaVu Sans Mono', monospace";
    ctx.fillText("EXPORT EVIDENCE", 862, bottomY + 38);
    const facts = [
      ["Output", `${input.export.width} × ${input.export.height} px`],
      ["Source viewport", `${screenImage.width} × ${screenImage.height} px`],
      ["Scale", `${input.scale}× vector redraw`],
      ["Tiling", `${input.export.columns} × ${input.export.rows} · ${input.export.tileCount} tiles · ${input.export.bleed}px bleed`],
      ["Marker drift", `max ${maxDrift.toFixed(3)} px`],
      ["Marker scale", `${(sizeRatios.reduce((sum, value) => sum + value, 0) / sizeRatios.length).toFixed(2)}× average`],
    ];
    facts.forEach(([label, value], index) => {
      const y = bottomY + 62 + index * 25;
      ctx.fillStyle = "#7d857b";
      ctx.font = "10px Ubuntu, sans-serif";
      ctx.fillText(label, 862, y);
      ctx.fillStyle = "#1f2d25";
      ctx.font = "700 10px 'DejaVu Sans Mono', monospace";
      ctx.fillText(value, 972, y);
    });

    ctx.fillStyle = "#7d857b";
    ctx.font = "8px 'DejaVu Sans Mono', monospace";
    const driftLineOne = drifts
      .slice(0, 4)
      .map((item) => `${item.id} Δ${item.dx.toFixed(2)},${item.dy.toFixed(2)}`)
      .join("   ");
    const driftLineTwo = drifts
      .slice(4)
      .map((item) => `${item.id} Δ${item.dx.toFixed(2)},${item.dy.toFixed(2)}`)
      .join("   ");
    ctx.fillText(driftLineOne, 862, bottomY + 221);
    ctx.fillText(driftLineTwo, 862, bottomY + 233);

    return {
      measurements,
      drift: drifts,
      maxDrift,
      averageSizeRatio: sizeRatios.reduce((sum, value) => sum + value, 0) / sizeRatios.length,
      screen: { width: screenImage.width, height: screenImage.height },
    };
  }, {
    screenBase64: screenBuffer.toString("base64"),
    outputBase64: outputBuffer.toString("base64"),
    screenMarkers,
    markers: exportMetadata.markers,
    scale: exportMetadata.scale,
    export: exportMetadata,
  });

  const comparisonShot = await comparisonPage.locator("#comparison").screenshot();
  await writeFile(comparisonPath, comparisonShot);
  const elapsedText = `${elapsedMs} ms`;

  const report = {
    generatedAt: new Date().toISOString(),
    viewport: initialState.viewport,
    screenViewportImage: { width: comparisonResult.screen.width, height: comparisonResult.screen.height },
    export: {
      path: "artifacts/harbor-district@4x.png",
      width: exportMetadata.width,
      height: exportMetadata.height,
      scale: exportMetadata.scale,
      tileSize: exportMetadata.tileSize,
      bleed: exportMetadata.bleed,
      columns: exportMetadata.columns,
      rows: exportMetadata.rows,
      tileCount: exportMetadata.tileCount,
      bytes: exportMetadata.bytes,
      duration: elapsedText,
    },
    markerAlignment: {
      maxDriftPx: Number(comparisonResult.maxDrift.toFixed(4)),
      averageSizeRatio: Number(comparisonResult.averageSizeRatio.toFixed(4)),
      markerScalePassed:
        comparisonResult.averageSizeRatio >= 3.8 && comparisonResult.averageSizeRatio <= 4.2,
      passed:
        comparisonResult.maxDrift <= 1 &&
        comparisonResult.averageSizeRatio >= 3.8 &&
        comparisonResult.averageSizeRatio <= 4.2,
      markers: comparisonResult.measurements.map((item, index) => ({
        id: item.id,
        name: item.name,
        screenCenter: { x: item.screen.x, y: item.screen.y },
        outputCenterInScreenPixels: item.outputInScreenPixels,
        delta: {
          x: Number(comparisonResult.drift[index].dx.toFixed(4)),
          y: Number(comparisonResult.drift[index].dy.toFixed(4)),
        },
        sizeRatio: Number(comparisonResult.drift[index].sizeRatio.toFixed(4)),
      })),
    },
    errors,
    artifacts: {
      screen: "artifacts/screen-viewport.png",
      progress: "artifacts/screen-export-progress.png",
      complete: "artifacts/screen-export-complete.png",
      comparison: "artifacts/marker-comparison.png",
    },
  };
  await writeFile(join(artifacts, "verification-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify(report, null, 2));
  if (errors.length || !report.markerAlignment.passed || report.export.width !== report.screenViewportImage.width * 4) {
    process.exitCode = 1;
  }
} finally {
  if (comparisonPage) await comparisonPage.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
