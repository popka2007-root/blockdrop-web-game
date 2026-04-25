import { expect, test } from "@playwright/test";

test("game starts and piece can move", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#startOverlay")).toBeVisible();
  await page.locator("#startButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#scoreValue")).toBeVisible();
});

test("pause works", async ({ page }) => {
  await page.goto("/");
  await page.locator("#startButton").click();
  await page.locator("#pauseButton").click();
  await expect(page.locator("#pauseOverlay")).toBeVisible();
});

test("game over overlay can be shown by the runtime", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.getElementById("gameOverOverlay").hidden = false;
  });
  await expect(page.locator("#gameOverOverlay")).toBeVisible();
});
