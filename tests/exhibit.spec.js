import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__AURELIS_READY__ === true);
  await page.waitForTimeout(700);
});

test("auto turntable advances and fully pauses", async ({ page }) => {
  await page.waitForTimeout(500);
  const startAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  await page.waitForTimeout(650);
  const movingAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  expect(movingAngle).toBeGreaterThan(startAngle + 0.05);

  await page.getByRole("button", { name: "暂停自动转台" }).click();
  await expect(page.getByRole("button", { name: "继续自动转台" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const pausedAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  await page.waitForTimeout(700);
  const stillPausedAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  expect(Math.abs(stillPausedAngle - pausedAngle)).toBeLessThan(0.0001);
  await expect(page.locator("#meta-state")).toHaveText("已暂停");

  await page.getByRole("button", { name: "继续自动转台" }).click();
  await page.waitForTimeout(500);
  const resumedAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  expect(resumedAngle).toBeGreaterThan(stillPausedAngle + 0.03);
});

test("material and lighting controls update the scene", async ({ page }) => {
  await page.getByRole("button", { name: /黑曜石/ }).click();
  await expect(page.locator("#meta-material")).toHaveText("黑曜石");
  await expect(page.locator('[data-material="obsidian"]')).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /月相/ }).click();
  await expect(page.locator("#meta-lighting")).toHaveText("月相");
  await expect(page.locator('[data-lighting="lunar"]')).toHaveAttribute("aria-pressed", "true");
});

test("capture freezes the turntable and downloads a PNG", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#capture-button").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^aurelis-ar07-gallery-\d+x\d+\.png$/);
  await expect(page.getByRole("button", { name: "继续自动转台" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("#toast")).toContainText("截图已保存");

  const capturedAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  await page.waitForTimeout(500);
  const stableAngle = await page.evaluate(() => window.viewer.exhibit.angle);
  expect(Math.abs(stableAngle - capturedAngle)).toBeLessThan(0.0001);
});

test("captures two distinct lighting states", async ({ page }) => {
  await page.getByRole("button", { name: "暂停自动转台" }).click();

  await page.locator('[data-lighting="gallery"]').click();
  await page.waitForTimeout(1_100);
  const galleryShot = await page
    .locator("canvas")
    .screenshot({ path: "artifacts/lighting-gallery.png" });

  await page.locator('[data-lighting="solstice"]').click();
  await page.waitForTimeout(1_300);
  const solsticeShot = await page
    .locator("canvas")
    .screenshot({ path: "artifacts/lighting-solstice.png" });

  expect(galleryShot.length).toBeGreaterThan(50_000);
  expect(solsticeShot.length).toBeGreaterThan(50_000);
  expect(galleryShot.equals(solsticeShot)).toBe(false);
});

test("rear orbit preserves readable normals and cast shadows", async ({ page }) => {
  await page.getByRole("button", { name: "暂停自动转台" }).click();
  await page.evaluate(() => {
    window.viewer.setAngle(Math.PI * 0.88);
    window.viewer.camera.position.set(-5.8, 3.45, -8.2);
    window.viewer.controls.update();
  });
  await page.waitForTimeout(700);
  await page.locator("canvas").screenshot({ path: "artifacts/rear-orbit.png" });

  const report = await page.evaluate(() => {
    let solidMeshes = 0;
    let shadowCasters = 0;
    let triangleCount = 0;
    let outwardFailures = 0;
    let finiteNormals = true;

    window.viewer.exhibit.root.traverse((object) => {
      if (!object.isMesh) return;
      if (object.castShadow) shadowCasters += 1;
      if (!object.userData.convexSolid) return;

      solidMeshes += 1;
      const geometry = object.geometry;
      geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      const center = [
        (min.x + max.x) / 2,
        (min.y + max.y) / 2,
        (min.z + max.z) / 2,
      ];
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const indices = geometry.index?.array;
      const faceCount = (indices?.length ?? positions.count) / 3;

      for (let face = 0; face < faceCount; face += 1) {
        const a = indices ? indices[face * 3] : face * 3;
        const b = indices ? indices[face * 3 + 1] : face * 3 + 1;
        const c = indices ? indices[face * 3 + 2] : face * 3 + 2;
        const ids = [a, b, c];

        const faceCenter = [0, 0, 0];
        const faceNormal = [0, 0, 0];
        for (const vertex of ids) {
          faceCenter[0] += positions.getX(vertex) / 3;
          faceCenter[1] += positions.getY(vertex) / 3;
          faceCenter[2] += positions.getZ(vertex) / 3;
          faceNormal[0] += normals.getX(vertex) / 3;
          faceNormal[1] += normals.getY(vertex) / 3;
          faceNormal[2] += normals.getZ(vertex) / 3;
        }

        finiteNormals &&= faceNormal.every(Number.isFinite);
        const outward =
          faceNormal[0] * (faceCenter[0] - center[0]) +
          faceNormal[1] * (faceCenter[1] - center[1]) +
          faceNormal[2] * (faceCenter[2] - center[2]);
        if (outward <= 1e-6) outwardFailures += 1;
        triangleCount += 1;
      }
    });

    return { solidMeshes, shadowCasters, triangleCount, outwardFailures, finiteNormals };
  });

  expect(report.solidMeshes).toBeGreaterThanOrEqual(10);
  expect(report.shadowCasters).toBeGreaterThanOrEqual(20);
  expect(report.triangleCount).toBeGreaterThan(150);
  expect(report.outwardFailures).toBe(0);
  expect(report.finiteNormals).toBe(true);
});
