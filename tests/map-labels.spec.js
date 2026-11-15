import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

async function waitForMap(page) {
  await page.goto("/");
  await page.waitForFunction(
    () => window.mapApp?.getState().labels.length === 10,
  );
}

test("lays out all labels without collisions or line crossings", async ({ page }) => {
  await waitForMap(page);
  const state = await page.evaluate(() => window.mapApp.getState());

  expect(state.labels).toHaveLength(10);
  expect(state.labels.filter((label) => label.hidden)).toHaveLength(0);
  expect(Object.keys(state.pinnedWorld)).toHaveLength(2);
  expect(state.collisions).toBe(0);
  expect(state.crossing).toBe(0);
  await expect(page.locator(".candidate-chip")).toHaveCount(8);
  await expect(page.locator("#collisionStatus")).toContainText("0 处压线");
});

test("keeps pinned label world coordinates through two zoom levels", async ({ page }) => {
  await waitForMap(page);
  const before = await page.evaluate(() => window.mapApp.getState());
  await page.locator("#verifyButton").click();
  await expect(page.locator("#verificationResult")).toContainText("验证通过");

  const after = await page.evaluate(() => window.mapApp.getState());
  expect(after.zoomFactor).toBeGreaterThan(1.5);
  expect(after.collisions).toBe(0);
  expect(after.crossing).toBe(0);
  expect(after.labels.filter((label) => label.hidden)).toHaveLength(0);

  for (const [id, point] of Object.entries(before.pinnedWorld)) {
    expect(after.pinnedWorld[id].x).toBeCloseTo(point.x, 6);
    expect(after.pinnedWorld[id].y).toBeCloseTo(point.y, 6);
    const rendered = after.labels.find((label) => label.cityId === id);
    expect(rendered.x).toBeCloseTo(point.x, 6);
    expect(rendered.y).toBeCloseTo(point.y, 6);
  }
});

test("pins an unpinned label when dragged", async ({ page }) => {
  await waitForMap(page);
  const before = await page.evaluate(() => window.mapApp.getState());
  const city = before.labels.find((label) => label.cityId === "qichuan");
  const canvasBox = await page.locator("#mapCanvas").boundingBox();
  const screen = {
    x: city.x * before.view.scale + before.view.panX + canvasBox.x,
    y: city.y * before.view.scale + before.view.panY + canvasBox.y,
  };

  await page.mouse.move(screen.x, screen.y);
  await page.mouse.down();
  await page.mouse.move(screen.x + 14, screen.y - 10, { steps: 6 });
  await page.mouse.up();

  const after = await page.evaluate(() => window.mapApp.getState());
  expect(after.selectedId).toBe("qichuan");
  expect(after.pinnedWorld.qichuan).toBeTruthy();
  expect(after.labels.find((label) => label.cityId === "qichuan").pinned).toBe(true);
  expect(after.collisions).toBe(0);
  expect(after.crossing).toBe(0);
});

test("shows unreadable regions and exports a vector SVG", async ({ page }) => {
  await waitForMap(page);
  await page.locator("#unreadableToggle").check();
  let state = await page.evaluate(() => window.mapApp.getState());
  expect(state.showUnreadable).toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  const svg = await fs.readFile(await download.path(), "utf8");
  state = await page.evaluate(() => window.mapApp.getState());

  expect(svg).toContain("<svg");
  expect(svg).toContain("pinnedWorld");
  expect(svg.match(/class="city-label"/g)).toHaveLength(10);
  expect(svg.match(/data-pinned="true"/g)).toHaveLength(2);
  expect(state.collisions).toBe(0);
});
