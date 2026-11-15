(function () {
  "use strict";

  const { WORLD_WIDTH, WORLD_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT, FRAME_X, OVERLAP, makeCanvas } = window.PanoScene;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function luma(data, index) {
    return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  }

  function renderLayer(frame, transform) {
    const canvas = makeCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const centerX = transform.x + FRAME_WIDTH / 2;
    const centerY = transform.y + FRAME_HEIGHT / 2;
    const exposureFactor = Math.pow(2, transform.exposure);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.filter = `brightness(${exposureFactor.toFixed(4)}) saturate(0.985)`;
    ctx.drawImage(frame.canvas, -FRAME_WIDTH / 2, -FRAME_HEIGHT / 2);
    ctx.filter = "none";
    ctx.restore();

    return {
      canvas,
      imageData: ctx.getImageData(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    };
  }

  function buildWeights(blend) {
    const feather = Math.max(1.2, OVERLAP * clamp(blend / 100, 0, 1));
    const weights = [new Float32Array(WORLD_WIDTH), new Float32Array(WORLD_WIDTH), new Float32Array(WORLD_WIDTH)];

    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      for (let i = 0; i < 3; i += 1) {
        const leftEdge = FRAME_X[i] + FRAME_WIDTH - OVERLAP;
        const rightEdge = FRAME_X[i] + OVERLAP;
        let left = 1;
        let right = 1;
        if (i > 0) {
          left = smoothstep((x - FRAME_X[i]) / feather);
        }
        if (i < 2) {
          right = 1 - smoothstep((x - (FRAME_X[i] + FRAME_WIDTH - feather)) / feather);
        }
        const outerCoverage = x >= FRAME_X[i] && x <= FRAME_X[i] + FRAME_WIDTH;
        weights[i][x] = outerCoverage ? Math.min(left, right) : 0;
      }

      const total = weights[0][x] + weights[1][x] + weights[2][x];
      if (total > 0) {
        weights[0][x] /= total;
        weights[1][x] /= total;
        weights[2][x] /= total;
      }
    }
    return weights;
  }

  function compositeLayers(layers, blend) {
    const canvas = makeCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const output = ctx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
    const destination = output.data;
    const weights = buildWeights(blend);
    const pixels = layers.map((layer) => layer.imageData.data);

    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      const row = y * WORLD_WIDTH;
      for (let x = 0; x < WORLD_WIDTH; x += 1) {
        const pixelIndex = (row + x) * 4;
        let totalWeight = 0;
        let red = 0;
        let green = 0;
        let blue = 0;

        for (let i = 0; i < 3; i += 1) {
          const source = pixels[i];
          const alpha = source[pixelIndex + 3];
          if (alpha === 0) continue;
          const weight = weights[i][x] * (alpha / 255);
          if (weight <= 0) continue;
          totalWeight += weight;
          red += source[pixelIndex] * weight;
          green += source[pixelIndex + 1] * weight;
          blue += source[pixelIndex + 2] * weight;
        }

        if (totalWeight > 0.0001) {
          destination[pixelIndex] = clamp(red / totalWeight, 0, 255);
          destination[pixelIndex + 1] = clamp(green / totalWeight, 0, 255);
          destination[pixelIndex + 2] = clamp(blue / totalWeight, 0, 255);
          destination[pixelIndex + 3] = 255;
        }
      }
    }

    ctx.putImageData(output, 0, 0);
    return canvas;
  }

  function seamError(layerA, layerB, startX, endX) {
    const dataA = layerA.imageData.data;
    const dataB = layerB.imageData.data;
    let colorDifference = 0;
    let samples = 0;

    for (let y = 4; y < WORLD_HEIGHT - 4; y += 3) {
      const row = y * WORLD_WIDTH;
      for (let x = startX + 4; x < endX - 4; x += 3) {
        const index = (row + x) * 4;
        if (dataA[index + 3] < 235 || dataB[index + 3] < 235) continue;
        colorDifference += (
          Math.abs(dataA[index] - dataB[index]) +
          Math.abs(dataA[index + 1] - dataB[index + 1]) +
          Math.abs(dataA[index + 2] - dataB[index + 2])
        ) / 3;
        samples += 1;
      }
    }

    const meanDifference = samples ? colorDifference / samples : 0;
    return {
      error: clamp((meanDifference / 255) * 100, 0, 100),
      delta: meanDifference,
      samples
    };
  }

  function continuityAtSeam(canvas, seamX) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const data = image.data;
    let seamEnergy = 0;
    let localEnergy = 0;
    let samples = 0;
    const top = 92;
    const bottom = WORLD_HEIGHT - 46;

    for (let y = top; y < bottom; y += 2) {
      const row = y * WORLD_WIDTH;
      const before = luma(data, (row + seamX - 1) * 4);
      const after = luma(data, (row + seamX + 2) * 4);
      const leftBase = luma(data, (row + seamX - 11) * 4);
      const rightBase = luma(data, (row + seamX + 12) * 4);
      seamEnergy += Math.abs(after - before);
      localEnergy += (Math.abs(before - leftBase) + Math.abs(rightBase - after)) / 2;
      samples += 1;
    }

    const seamAverage = seamEnergy / Math.max(1, samples);
    const localAverage = localEnergy / Math.max(1, samples);
    const ratio = seamAverage / Math.max(0.4, localAverage);
    const stepPercent = (seamAverage / 255) * 100;
    const ratioPenalty = Math.max(0, ratio - 1.35) * 3.2;
    const stepPenalty = Math.max(0, stepPercent - 0.8) * 8;
    const continuity = clamp(100 - ratioPenalty - stepPenalty, 0, 100);

    return {
      continuity,
      ratio,
      seamAverage,
      localAverage
    };
  }

  function buildDifferenceMap(composite, layers, blend) {
    const canvas = makeCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const out = ctx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
    const outData = out.data;
    const base = composite.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, WORLD_WIDTH, WORLD_HEIGHT).data;
    const sourceA = layers[0].imageData.data;
    const sourceB = layers[1].imageData.data;
    const sourceC = layers[2].imageData.data;
    const pairA = [500, 720];
    const pairB = [1000, 1220];

    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      for (let x = 0; x < WORLD_WIDTH; x += 1) {
        const index = (y * WORLD_WIDTH + x) * 4;
        const gray = luma(base, index) * 0.27;
        outData[index] = gray;
        outData[index + 1] = gray * 1.02;
        outData[index + 2] = gray * 0.95;
        outData[index + 3] = 255;

        let first = -1;
        let second = -1;
        if (x >= pairA[0] && x < pairA[1]) {
          first = 0;
          second = 1;
        } else if (x >= pairB[0] && x < pairB[1]) {
          first = 1;
          second = 2;
        }
        if (first < 0) continue;

        const pixelsA = [sourceA, sourceB, sourceC][first];
        const pixelsB = [sourceA, sourceB, sourceC][second];
        if (pixelsA[index + 3] < 220 || pixelsB[index + 3] < 220) continue;

        const diff = (
          Math.abs(pixelsA[index] - pixelsB[index]) +
          Math.abs(pixelsA[index + 1] - pixelsB[index + 1]) +
          Math.abs(pixelsA[index + 2] - pixelsB[index + 2])
        ) / 3;
        const energy = clamp(diff / 24, 0, 1);
        outData[index] = 255 * clamp(energy * 1.1, 0, 1);
        outData[index + 1] = 156 * clamp(energy * 0.9, 0, 1);
        outData[index + 2] = 61 * (1 - energy) * 0.2;
      }
    }

    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  function stitch(frames, transforms, options) {
    const blend = options.blend === undefined ? 72 : options.blend;
    const layers = frames.map((frame, index) => renderLayer(frame, transforms[index]));
    const composite = compositeLayers(layers, blend);
    const seams = [
      {
        id: "A",
        pair: "01 → 02",
        centerX: FRAME_X[0] + FRAME_WIDTH - OVERLAP / 2,
        range: [FRAME_X[0] + FRAME_WIDTH - OVERLAP, FRAME_X[1] + OVERLAP],
        layerA: layers[0],
        layerB: layers[1],
        focusX: 580,
        focusY: 365
      },
      {
        id: "B",
        pair: "02 → 03",
        centerX: FRAME_X[1] + FRAME_WIDTH - OVERLAP / 2,
        range: [FRAME_X[1] + FRAME_WIDTH - OVERLAP, FRAME_X[2] + OVERLAP],
        layerA: layers[1],
        layerB: layers[2],
        focusX: 1110,
        focusY: 365
      }
    ];

    seams.forEach((seam) => {
      const error = seamError(seam.layerA, seam.layerB, seam.range[0], seam.range[1]);
      const continuity = continuityAtSeam(composite, seam.centerX);
      Object.assign(seam, error, continuity);
    });

    return {
      composite,
      layers,
      seams,
      blend,
      maxError: Math.max(seams[0].error, seams[1].error),
      minContinuity: Math.min(seams[0].continuity, seams[1].continuity),
      differenceMap: options.includeDifference ? buildDifferenceMap(composite, layers, blend) : null
    };
  }

  window.PanoStitch = {
    WORLD_WIDTH,
    WORLD_HEIGHT,
    stitch,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    FRAME_X,
    OVERLAP
  };
})();
