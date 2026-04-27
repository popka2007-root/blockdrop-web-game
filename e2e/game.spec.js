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

test("new menu actions expose useful play flows", async ({ page }) => {
  await page.goto("/");

  await page.locator("#helpButton").click();
  await expect(page.locator("#helpOverlay")).toContainText("AI");
  await expect(page.locator("#helpOverlay")).toContainText("QR");
  await expect(page.locator("#helpOverlay")).not.toContainText("Открыть комнату");
  await page.locator("#closeHelpButton").click();

  await expect(page.locator("#menuRecords")).toContainText("Рекорд");
  await page.selectOption("#aiDifficultySelect", "hard");
  await page.locator("#aiButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();

  await page.locator("#mainMenuButton").click();
  await page.locator("#friendButton").click();
  await expect(page.locator("#roomCodeValue")).not.toHaveText("----");
  await expect(page.locator("#roomQr")).toHaveAttribute("src", /create-qr-code/);
  await page.locator("#closeOnlineButton").click();

  await page.locator("#dailyButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();
});
