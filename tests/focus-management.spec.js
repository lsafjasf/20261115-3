import { expect, test } from "@playwright/test";

async function activeDialogId(page) {
  return page.evaluate(() => document.activeElement?.closest("dialog")?.id ?? null);
}

test("弹窗聚焦首控件、Tab 循环并在 Esc 后回到触发按钮", async ({ page }) => {
  await page.goto("/");
  const shareTrigger = page.getByRole("button", { name: "分享" });
  const shareDialog = page.getByRole("dialog", { name: "分享画册封面" });
  const email = page.getByLabel("受邀成员邮箱");

  await shareTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(shareDialog).toBeVisible();
  await expect(email).toBeFocused();

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(await activeDialogId(page)).toBe("share-dialog");
  }
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await activeDialogId(page)).toBe("share-dialog");
  }

  const sendButton = page.getByRole("button", { name: "发送邀请" });
  const closeButton = page.getByRole("button", { name: "关闭分享弹窗" });
  await sendButton.focus();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(sendButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(shareDialog).toBeHidden();
  await expect(shareTrigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(email).toBeFocused();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(shareDialog).toBeHidden();
  await expect(shareTrigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(email).toBeFocused();
});

test("表单错误使用 alert、关联输入框，并在取消重开后清除", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "新建画板" });
  const dialog = page.getByRole("dialog", { name: "新建画板" });
  const nameInput = page.getByLabel("画板名称");

  await trigger.click();
  await expect(nameInput).toBeFocused();
  await page.getByRole("button", { name: "创建画板" }).click();

  const error = page.getByRole("alert");
  await expect(error).toBeVisible();
  await expect(error).toHaveText("请输入画板名称后再创建。");
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveAttribute("aria-invalid", "true");
  await expect(nameInput).toHaveAttribute("aria-describedby", /board-name-error/);

  await page.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(nameInput).toBeFocused();
  await expect(page.locator("#board-name-error")).toBeHidden();
  await expect(nameInput).not.toHaveAttribute("aria-invalid", "true");

  await nameInput.fill("社交媒体方图");
  await page.getByRole("button", { name: "创建画板" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("status")).toContainText("社交媒体方图");
});

test("输入框聚焦时禁用画布快捷键，画布聚焦后恢复", async ({ page }) => {
  await page.goto("/");
  const artboard = page.locator("#artboard");
  const title = page.locator('[data-object="title"]');
  const objectCount = page.locator(".canvas-object");
  const xInput = page.locator("#position-x");
  const initialCount = await objectCount.count();
  const initialBox = await title.boundingBox();
  const initialX = Number(await xInput.inputValue());

  await xInput.focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("r");
  await page.keyboard.press("ArrowRight");

  expect(await objectCount.count()).toBe(initialCount);
  await expect(title).toBeVisible();
  const afterInputBox = await title.boundingBox();
  expect(afterInputBox.x).toBe(initialBox.x);
  expect(afterInputBox.y).toBe(initialBox.y);

  const shareTrigger = page.getByRole("button", { name: "分享" });
  await shareTrigger.click();
  const email = page.getByLabel("受邀成员邮箱");
  await expect(email).toBeFocused();
  await page.keyboard.press("Delete");
  await page.keyboard.press("r");
  await page.keyboard.press("ArrowRight");
  expect(await objectCount.count()).toBe(initialCount);
  const duringDialogBox = await title.boundingBox();
  expect(duringDialogBox.x).toBe(initialBox.x);

  await page.keyboard.press("Escape");
  await expect(shareTrigger).toBeFocused();

  await artboard.focus();
  await page.keyboard.press("ArrowRight");
  expect(Number(await xInput.inputValue())).toBe(initialX + 2);

  await page.keyboard.press("r");
  await expect(objectCount).toHaveCount(initialCount + 1);
  await page.keyboard.press("Delete");
  await expect(objectCount).toHaveCount(initialCount);
});

test("不同弹窗分别回焦到自己的触发按钮并可重新打开", async ({ page }) => {
  await page.goto("/");
  const exportTrigger = page.getByRole("button", { name: "导出" });
  const exportDialog = page.getByRole("dialog", { name: "导出画册封面" });
  const pngOption = page.getByRole("radio", { name: /PNG/ });

  await exportTrigger.click();
  await expect(pngOption).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(exportDialog).toBeHidden();
  await expect(exportTrigger).toBeFocused();

  const shareTrigger = page.getByRole("button", { name: "分享" });
  await shareTrigger.click();
  await expect(page.getByLabel("受邀成员邮箱")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(shareTrigger).toBeFocused();

  await exportTrigger.click();
  await expect(pngOption).toBeFocused();
  await page.getByRole("button", { name: "关闭导出弹窗" }).click();
  await expect(exportDialog).toBeHidden();
  await expect(exportTrigger).toBeFocused();
});
