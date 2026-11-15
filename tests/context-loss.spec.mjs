import { expect, test } from "@playwright/test";

const savedCameraMatches = (camera, savedView) => {
  expect(camera.yaw).toBeCloseTo(savedView.yaw, 5);
  expect(camera.pitch).toBeCloseTo(savedView.pitch, 5);
  expect(camera.distance).toBeCloseTo(savedView.distance, 5);
  expect(camera.target).toEqual(savedView.target);
};

test("context loss stops rendering and recovery rebuilds the scene and view", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.locator("#statusPill")).toHaveAttribute(
    "data-state",
    "running",
  );
  await page.waitForFunction(
    () => window.__orbital.diagnostics().frameCount > 5,
  );

  const before = await page.evaluate(() => window.__orbital.diagnostics());
  expect(before.resources).toEqual({
    programs: 3,
    buffers: 8,
    vertexArrays: 5,
    textures: 1,
  });
  expect(before.lastFrameSample.nonBlack).toBe(true);

  await page.click("#saveViewButton");
  const saved = await page.evaluate(
    () => window.__orbital.diagnostics().savedView,
  );
  expect(saved).not.toBeNull();
  savedCameraMatches(before.camera, saved);

  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(900, 530, { steps: 12 });
  await page.mouse.up();

  const moved = await page.evaluate(() => window.__orbital.diagnostics());
  expect(moved.camera.yaw).not.toBeCloseTo(saved.yaw, 2);
  expect(moved.camera.pitch).not.toBeCloseTo(saved.pitch, 2);

  await page.click("#lossButton");
  await expect(page.locator("#statusPill")).toHaveAttribute(
    "data-state",
    "lost",
  );
  await expect(page.locator("#lostOverlay")).toBeVisible();
  await expect(page.locator("#lostTitle")).toContainText("上下文已丢失");

  const lostStart = await page.evaluate(() => window.__orbital.diagnostics());
  await page.waitForTimeout(700);
  const lostEnd = await page.evaluate(() => window.__orbital.diagnostics());
  expect(lostStart.webglContextLost).toBe(true);
  expect(lostStart.loopActive).toBe(false);
  expect(lostEnd.frameCount).toBe(lostStart.frameCount);
  expect(lostEnd.renderCalls).toBe(lostStart.renderCalls);
  expect(lostEnd.generation).toBe(1);
  await page.screenshot({
    path: "artifacts/context-lost.png",
    fullPage: true,
  });

  await page.click("#restoreButton");
  await expect(page.locator("#statusPill")).toHaveAttribute(
    "data-state",
    "running",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () => (await page.evaluate(() => window.__orbital.diagnostics())).frameCount,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(lostEnd.frameCount + 8);

  const restored = await page.evaluate(() => window.__orbital.diagnostics());
  expect(restored.generation).toBe(2);
  expect(restored.webglContextLost).toBe(false);
  expect(restored.loopActive).toBe(true);
  expect(restored.resources).toEqual(before.resources);
  expect(restored.lastFrameSample.nonBlack).toBe(true);
  savedCameraMatches(restored.camera, saved);

  await page.screenshot({
    path: "artifacts/context-restored.png",
    fullPage: true,
  });

  const frameBeforeInteraction = restored.frameCount;
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(600, 420, { steps: 10 });
  await page.mouse.up();
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(450);

  const interacted = await page.evaluate(() => window.__orbital.diagnostics());
  expect(interacted.camera.yaw).not.toBeCloseTo(restored.camera.yaw, 2);
  expect(interacted.camera.distance).toBeLessThan(restored.camera.distance);
  expect(interacted.frameCount).toBeGreaterThan(frameBeforeInteraction + 5);
  expect(errors).toEqual([]);
});
