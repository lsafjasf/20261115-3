import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const ARTIFACT_DIR = path.resolve("artifacts/verification");

function readState(page) {
  return page.evaluate(() => window.__collage.getState());
}

function scrollMetrics(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("#scroller");
    const sequence = document.querySelector("#sequence");
    const firstCard = document.querySelector(".group-card");
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      sequenceWidth: sequence.getBoundingClientRect().width,
      firstTop: firstCard.offsetTop,
    };
  });
}

async function setRangeByClick(page, selector, ratio) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Range not found: ${selector}`);
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
}

async function setRangeExact(page, selector, value) {
  const input = page.locator(selector);
  const min = Number(await input.getAttribute("min"));
  const max = Number(await input.getAttribute("max"));
  await setRangeByClick(page, selector, (value - min) / (max - min));
  await input.focus();
  let current = Number(await input.inputValue());

  while (current !== value) {
    await page.keyboard.press(current < value ? "ArrowRight" : "ArrowLeft");
    current += current < value ? 1 : -1;
  }
}

async function dragGroup(page, sourceId, targetId, after = false) {
  const handle = page.locator(`[data-drag-id="${sourceId}"]`);
  await handle.scrollIntoViewIfNeeded();
  const sourceBox = await handle.boundingBox();
  if (!sourceBox) throw new Error(`Drag handle not found: ${sourceId}`);

  const scrollerBox = await page.locator("#scroller").boundingBox();
  if (!scrollerBox) throw new Error("Scroller not found");

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2 + 10,
    { steps: 4 },
  );

  let targetBox = await page.locator(`[data-id="${targetId}"]`).boundingBox();
  if (!targetBox) throw new Error(`Target card not found: ${targetId}`);

  if (targetBox.y + targetBox.height / 2 > scrollerBox.y + scrollerBox.height - 50) {
    const edgeY = scrollerBox.y + scrollerBox.height - 24;
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, edgeY, { steps: 8 });
    await page.waitForFunction(
      ({ id, bottom }) => {
        const card = document.querySelector(`[data-id="${id}"]`);
        if (!card) return false;
        const rect = card.getBoundingClientRect();
        return rect.top + rect.height / 2 < bottom - 70;
      },
      { id: targetId, bottom: scrollerBox.y + scrollerBox.height },
      { timeout: 15_000 },
    );
  }

  if (targetBox.y + targetBox.height / 2 < scrollerBox.y + 50) {
    const edgeY = scrollerBox.y + 24;
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, edgeY, { steps: 8 });
    await page.waitForFunction(
      ({ id, top }) => {
        const card = document.querySelector(`[data-id="${id}"]`);
        if (!card) return false;
        const rect = card.getBoundingClientRect();
        return rect.top + rect.height / 2 > top + 70;
      },
      { id: targetId, top: scrollerBox.y },
      { timeout: 15_000 },
    );
  }

  targetBox = await page.locator(`[data-id="${targetId}"]`).boundingBox();
  if (!targetBox) throw new Error(`Target card lost: ${targetId}`);
  const targetY = after
    ? targetBox.y + targetBox.height - 8
    : targetBox.y + 8;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, targetY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
});

test("eight generated frames reorder and export consistently", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".group-card")).toHaveCount(8);
  await page.evaluate(() =>
    Promise.all(
      [...document.images].map((image) =>
        image.decode().catch(() => {
          throw new Error(`Image failed: ${image.alt}`);
        }),
      ),
    ),
  );
  await page.evaluate(() => document.fonts.ready);

  const images = await page.locator(".group-card img").evaluateAll((nodes) =>
    nodes.map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
      srcLength: image.src.length,
    })),
  );
  expect(images).toHaveLength(8);
  expect(images.every((image) => image.width === 600 && image.height === 750)).toBe(true);
  expect(new Set(images.map((image) => image.srcLength)).size).toBeGreaterThan(1);

  const initial = await readState(page);
  expect(initial.order).toEqual([
    "tidal",
    "echo",
    "field",
    "orbit",
    "garden",
    "citrus",
    "aqua",
    "night",
  ]);
  const initialJson = JSON.stringify(initial.groups);

  const topBefore = await scrollMetrics(page);
  await page.locator("#scroller").hover();
  await page.mouse.wheel(0, 30_000);
  await page.waitForTimeout(250);
  const bottom = await scrollMetrics(page);
  expect(bottom.scrollTop).toBeGreaterThan(0);
  expect(bottom.scrollHeight).toBe(topBefore.scrollHeight);
  expect(bottom.scrollWidth).toBe(topBefore.scrollWidth);
  expect(bottom.clientWidth).toBe(topBefore.clientWidth);
  expect(bottom.sequenceWidth).toBe(topBefore.sequenceWidth);

  await page.mouse.wheel(0, -30_000);
  await page.waitForTimeout(250);
  const topAfter = await scrollMetrics(page);
  expect(topAfter.scrollTop).toBe(0);
  expect(topAfter.firstTop).toBe(topBefore.firstTop);
  expect(topAfter.scrollHeight).toBe(topBefore.scrollHeight);
  expect(topAfter.scrollWidth).toBe(topBefore.scrollWidth);
  expect(topAfter.sequenceWidth).toBe(topBefore.sequenceWidth);

  const settings = [
    { scale: 0.72, spacing: 18 },
    { scale: 1.24, spacing: 146 },
    { scale: 0.84, spacing: 28 },
    { scale: 1.18, spacing: 112 },
    { scale: 0.76, spacing: 52 },
    { scale: 1.22, spacing: 136 },
    { scale: 0.88, spacing: 74 },
    { scale: 1.16, spacing: 96 },
  ];

  for (let index = 0; index < initial.order.length; index += 1) {
    const id = initial.order[index];
    await page.locator(`[data-id="${id}"] .art-frame`).click();
    const title = await page.locator(`[data-id="${id}"] img`).getAttribute("alt");
    expect(title).toContain(["潮汐切片", "蓝色回响", "野地网格", "粉色轨道", "墨色花园", "柑橘脉冲", "青绿折面", "夜间信号"][index]);

    await setRangeExact(page, "#scale-range", Math.round(settings[index].scale * 100));
    await setRangeExact(page, "#spacing-range", settings[index].spacing);
    await page.locator('[data-align-value="center"]').click();
  }

  const tuned = await readState(page);
  tuned.groups.forEach((group, index) => {
    expect(group.scale).toBeCloseTo(settings[index].scale, 2);
    expect(group.spacing).toBeCloseTo(settings[index].spacing, 0);
    expect(group.align).toBe("center");
  });
  expect(JSON.stringify(tuned.groups)).not.toBe(initialJson);

  await dragGroup(page, "night", "tidal");
  await dragGroup(page, "echo", "garden", true);
  await dragGroup(page, "orbit", "citrus", true);

  const finalState = await readState(page);
  expect(finalState.order).toEqual([
    "night",
    "tidal",
    "field",
    "garden",
    "echo",
    "citrus",
    "orbit",
    "aqua",
  ]);
  expect(finalState.order).not.toEqual(initial.order);
  await expect(page.locator(".group-card")).toHaveCount(8);
  await expect(page.locator(".group-card .art-frame")).toHaveCount(8);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, "editor-final.png") });

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-json").click(),
  ]);
  const jsonPath = path.join(ARTIFACT_DIR, "collage-sequence.json");
  await jsonDownload.saveAs(jsonPath);

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-png").click(),
  ]);
  const pngPath = path.join(ARTIFACT_DIR, "collage-strip.png");
  await pngDownload.saveAs(pngPath);

  const exported = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const png = PNG.sync.read(fs.readFileSync(pngPath));

  expect(exported.order).toEqual(finalState.order);
  expect(exported.groups.map((group) => group.id)).toEqual(finalState.order);
  expect(exported.groups).toHaveLength(8);
  expect(exported.artboard.width).toBe(1200);
  expect(exported.artboard.height).toBe(png.height);
  expect(png.width).toBe(1200);
  expect(png.height).toBeGreaterThan(5_000);

  const sampledMarkers = exported.groups.map((group, index) => {
    const x = group.box.x + 12;
    const y = group.box.y + 12;
    const offset = (png.width * y + x) * 4;
    const actual = `#${[png.data[offset], png.data[offset + 1], png.data[offset + 2]]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
    expect(actual).toBe(group.verificationColor);
    if (index > 0) {
      expect(group.box.y).toBeGreaterThan(exported.groups[index - 1].box.y);
    }
    return { id: group.id, y: group.box.y, actual };
  });
  expect(sampledMarkers.map((marker) => marker.id)).toEqual(finalState.order);

  exported.groups.forEach((group, index) => {
    expect(group.scale).toBeCloseTo(finalState.groups[index].scale, 5);
    expect(group.spacingAfter).toBe(finalState.groups[index].spacing);
    expect(group.alignment).toBe(finalState.groups[index].align);
  });

  fs.writeFileSync(
    path.join(ARTIFACT_DIR, "verification-summary.json"),
    JSON.stringify(
      {
        imagesGenerated: images.length,
        orderBefore: initial.order,
        orderAfter: finalState.order,
        boundaryStable: true,
        png: { width: png.width, height: png.height },
        markerOrder: sampledMarkers.map((marker) => marker.id),
        pageErrors,
      },
      null,
      2,
    ),
  );
  expect(pageErrors).toEqual([]);
});
