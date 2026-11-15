import { mkdir, writeFile } from "node:fs/promises";
import { IncrementalPacker } from "../src/packer.js";
import {
  DEMO_ATLAS_SIZE,
  editPayload,
  editSprites,
  makeDemoFrames,
} from "../src/demo.js";
import {
  compareRasters,
  createRaster,
  extractRegion,
  hashRaster,
  renderAtlas,
  verifyAtlasFrames,
} from "../src/raster.js";
import {
  createAtlasDocument,
  parseAtlasDocument,
} from "../src/atlas-json.js";
import {
  encodePng,
  pngDataUrl,
  rasterFromDataUrl,
} from "../tests/helpers/png.js";

const outputDirectory = "artifacts/visual";

function setPixel(raster, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  const index = (y * raster.width + x) * 4;
  raster.data[index] = color[0];
  raster.data[index + 1] = color[1];
  raster.data[index + 2] = color[2];
  raster.data[index + 3] = alpha;
}

function fillRect(raster, rect, color, alpha = 255) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      setPixel(raster, x, y, color, alpha);
    }
  }
}

function strokeRect(raster, rect, color, thickness = 2) {
  fillRect(raster, { ...rect, height: thickness }, color);
  fillRect(
    raster,
    { ...rect, y: rect.y + rect.height - thickness, height: thickness },
    color,
  );
  fillRect(raster, { ...rect, width: thickness }, color);
  fillRect(
    raster,
    { ...rect, x: rect.x + rect.width - thickness, width: thickness },
    color,
  );
}

const glyphs = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  E: ["111", "100", "110", "100", "111"],
  I: ["111", "010", "010", "010", "111"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  "": ["000", "000", "000", "000", "000"],
};

function drawLabel(raster, x, y, text, scale = 2) {
  const width = text.length * 4 * scale + 8;
  fillRect(
    raster,
    { x: x - 4, y: y - 4, width, height: 7 * scale + 8 },
    [20, 35, 31],
    225,
  );
  let cursor = x;
  for (const letter of text) {
    const glyph = glyphs[letter] || glyphs[""];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row][column] === "1") {
          fillRect(
            raster,
            {
              x: cursor + column * scale,
              y: y + row * scale,
              width: scale,
              height: scale,
            },
            [247, 244, 236],
          );
        }
      }
    }
    cursor += 4 * scale;
  }
}

function drawReportOverlay(atlas, report) {
  const overlay = {
    width: atlas.width,
    height: atlas.height,
    data: new Uint8ClampedArray(atlas.data),
  };
  for (const rect of report.touchedRects) {
    const old = rect.kind === "removed" || rect.kind === "resized-old";
    strokeRect(overlay, rect, old ? [192, 74, 57] : [239, 106, 58], 2);
  }
  if (report.repackRegion) {
    strokeRect(overlay, report.repackRegion, [52, 120, 199], 3);
  }
  return overlay;
}

function composeComparison(stages) {
  const gap = 20;
  const width = stages.length * 640 + (stages.length - 1) * gap;
  const output = createRaster(width, 670);
  fillRect(output, { x: 0, y: 0, width, height: 670 }, [225, 225, 218]);
  stages.forEach((stage, index) => {
    const originX = index * (640 + gap);
    fillRect(
      output,
      { x: originX, y: 0, width: 640, height: 30 },
      stage.headerColor,
    );
    for (let y = 30; y < 670; y += 10) {
      for (let x = originX; x < originX + 640; x += 10) {
        const light = ((x - originX) / 10 + (y - 30) / 10) % 2 === 0;
        fillRect(
          output,
          { x, y, width: 10, height: 10 },
          light ? [242, 239, 232] : [222, 219, 211],
        );
      }
    }
    for (let y = 0; y < stage.atlas.height; y += 1) {
      for (let x = 0; x < stage.atlas.width; x += 1) {
        const sourceIndex = (y * stage.atlas.width + x) * 4;
        const alpha = stage.atlas.data[sourceIndex + 3];
        if (alpha === 0) continue;
        const targetIndex =
          ((y + 30) * output.width + originX + x) * 4;
        output.data[targetIndex] = stage.atlas.data[sourceIndex];
        output.data[targetIndex + 1] = stage.atlas.data[sourceIndex + 1];
        output.data[targetIndex + 2] = stage.atlas.data[sourceIndex + 2];
        output.data[targetIndex + 3] = alpha;
      }
    }
    for (const rect of stage.report?.touchedRects || []) {
      const old = rect.kind === "removed" || rect.kind === "resized-old";
      strokeRect(
        output,
        { ...rect, y: rect.y + 30 },
        old ? [192, 74, 57] : [239, 106, 58],
        2,
      );
    }
    if (stage.report?.repackRegion) {
      strokeRect(
        output,
        { ...stage.report.repackRegion, y: stage.report.repackRegion.y + 30 },
        [52, 120, 199],
        3,
      );
    }
    drawLabel(output, originX + 10, 8, stage.title, 2);
  });
  return output;
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const demoFrames = makeDemoFrames();
  const sources = new Map(
    demoFrames.map((frame) => [frame.id, frame.raster]),
  );
  const packer = new IncrementalPacker({
    width: DEMO_ATLAS_SIZE,
    height: DEMO_ATLAS_SIZE,
    padding: 1,
  });
  const stages = [];

  function capture(title, report, headerColor) {
    const atlas = renderAtlas(
      [...packer.frames.values()],
      sources,
      packer.width,
      packer.height,
    );
    const visual = verifyAtlasFrames(
      atlas,
      [...packer.frames.values()],
      sources,
    );
    stages.push({
      title,
      headerColor,
      atlas,
      report,
      visual,
      hash: hashRaster(atlas),
      utilization: packer.utilization(),
      frameCount: packer.frames.size,
    });
    return atlas;
  }

  packer.packInitial(demoFrames, { label: "基线" });
  const baselinePositions = new Map(
    [...packer.frames].map(([id, frame]) => [id, { ...frame }]),
  );
  capture("BASE 100", packer.lastReport, [23, 43, 39]);

  const positionsAfterA = new Map();
  for (const key of ["A", "B"]) {
    const payload = editPayload(key);
    const report = packer.applyChanges(payload, {
      label: `增量 ${key}`,
    });
    for (const [id, raster] of editSprites(key)) sources.set(id, raster);
    for (const id of payload.remove) sources.delete(id);
    if (key === "A") {
      for (const [id, frame] of packer.frames) {
        positionsAfterA.set(id, { ...frame });
      }
    }
    capture(
      `STEP ${key}`,
      report,
      key === "A" ? [52, 120, 199] : [241, 184, 75],
    );
  }

  const finalAtlas = stages[2].atlas;
  const finalDocument = createAtlasDocument(packer, {
    image: pngDataUrl(finalAtlas),
    createdAt: new Date().toISOString(),
  });
  const serialized = JSON.stringify(finalDocument);
  const parsed = parseAtlasDocument(serialized);
  const decodedAtlas = rasterFromDataUrl(parsed.image);
  const restoredSources = new Map(
    parsed.frames.map((frame) => [
      frame.id,
      extractRegion(
        decodedAtlas,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
      ),
    ]),
  );
  const restoredPacker = new IncrementalPacker();
  restoredPacker.restore({
    width: parsed.width,
    height: parsed.height,
    padding: parsed.padding,
    frames: parsed.frames,
    stats: parsed.stats,
  });
  const restoredVisual = verifyAtlasFrames(
    decodedAtlas,
    [...restoredPacker.frames.values()],
    restoredSources,
  );
  const roundtripMismatches = [...sources.keys()].filter((id) =>
    !compareRasters(sources.get(id), restoredSources.get(id)).equal,
  );

  const stableChecks = [];
  const modifiedA = new Set(
    editPayload("A").update.map((frame) => frame.id),
  );
  const modifiedB = new Set(
    editPayload("B").update.map((frame) => frame.id),
  );
  for (const id of baselinePositions.keys()) {
    const afterA = positionsAfterA.get(id);
    if (!afterA || modifiedA.has(id)) continue;
    const before = baselinePositions.get(id);
    stableChecks.push({
      id,
      stage: "A",
      unchanged:
        before.x === afterA.x &&
        before.y === afterA.y &&
        before.width === afterA.width &&
        before.height === afterA.height,
    });
  }
  for (const id of positionsAfterA.keys()) {
    const current = packer.frames.get(id);
    if (!current || modifiedB.has(id)) continue;
    const before = positionsAfterA.get(id);
    stableChecks.push({
      id,
      stage: "B",
      unchanged:
        before.x === current.x &&
        before.y === current.y &&
        before.width === current.width &&
        before.height === current.height,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scenario: {
      initialFrames: 100,
      finalFrames: packer.frames.size,
      atlas: {
        width: packer.width,
        height: packer.height,
        padding: packer.padding,
      },
      edits: ["A", "B"],
    },
    stages: stages.map((stage) => ({
      title: stage.title,
      frameCount: stage.frameCount,
      repackCount: stage.report?.repackCount ?? 0,
      movedFrames: stage.report?.movedFrames ?? [],
      untouchedFrames: stage.report?.untouchedFrames ?? 100,
      added: stage.report?.added ?? [],
      removed: stage.report?.removed ?? [],
      modified: stage.report?.modified ?? [],
      repackRegion: stage.report?.repackRegion ?? null,
      regionRatio: stage.report?.regionRatio ?? 0,
      touchedArea: stage.report?.touchedArea ?? 0,
      touchedRects: stage.report?.touchedRects ?? [],
      utilization: stage.utilization,
      validation: stage.report?.validation ?? packer.validate(),
      visual: {
        equal: stage.visual.equal,
        framesChecked: stage.frameCount,
        mismatches: stage.visual.mismatches,
        atlasHash: stage.hash,
      },
    })),
    regionComparison: {
      different: JSON.stringify(stages[1].report.repackRegion) !==
        JSON.stringify(stages[2].report.repackRegion),
      a: stages[1].report.repackRegion,
      b: stages[2].report.repackRegion,
      aMoved: stages[1].report.movedFrames,
      bMoved: stages[2].report.movedFrames,
    },
    stableFrameChecks: {
      total: stableChecks.length,
      movedFromStableSet: stableChecks.filter((check) => !check.unchanged),
    },
    jsonRoundtrip: {
      bytes: Buffer.byteLength(serialized),
      frameCount: parsed.frames.length,
      imageBytes: Buffer.byteLength(parsed.image),
      validation: parsed.validation,
      visualEqual: restoredVisual.equal,
      pixelMismatches: roundtripMismatches,
      restoredRepackCount: restoredPacker.repackCount,
    },
  };

  await writeFile(
    `${outputDirectory}/baseline.png`,
    encodePng(stages[0].atlas),
  );
  await writeFile(
    `${outputDirectory}/incremental-a.png`,
    encodePng(drawReportOverlay(stages[1].atlas, stages[1].report)),
  );
  await writeFile(
    `${outputDirectory}/incremental-b.png`,
    encodePng(drawReportOverlay(stages[2].atlas, stages[2].report)),
  );
  await writeFile(
    `${outputDirectory}/region-comparison.png`,
    encodePng(composeComparison(stages)),
  );
  await writeFile(
    "artifacts/visual-report.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        frames: report.scenario.finalFrames,
        repacks: stages[2].report.repackCount,
        regions: report.regionComparison,
        utilization: stages.map((stage) =>
          Number(stage.utilization.toFixed(2)),
        ),
        visual: stages.map((stage) => ({
          stage: stage.title,
          equal: stage.visual.equal,
          checked: stage.frameCount,
          hash: stage.hash,
        })),
        stableFrameChecks: report.stableFrameChecks,
        jsonRoundtrip: report.jsonRoundtrip,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
