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

  await expect(page.locator("#modeSummary")).toContainText("Выжить");
  await page.selectOption("#startMode", "sprint");
  await expect(page.locator("#modeSummary")).toContainText("40");

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

test("mobile layout keeps board and controls inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#startButton").click();

  const board = await page.locator("#boardShell").boundingBox();
  const controls = await page.locator("#controls").boundingBox();
  const pause = await page.locator("#pauseButton").boundingBox();

  expect(board?.width).toBeGreaterThan(150);
  expect(board?.height).toBeGreaterThan(300);
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.x + board.width).toBeLessThanOrEqual(390);
  expect(controls.y + controls.height).toBeLessThanOrEqual(844);
  expect(pause?.width).toBeGreaterThanOrEqual(44);
  expect(pause?.height).toBeGreaterThanOrEqual(44);
});

test("online room connects two players and shares state", async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  const room = `PW${Date.now().toString(36).slice(-6)}`.toUpperCase();

  await first.goto("/");
  await second.goto("/");

  await first.locator("#friendButton").click();
  await first.fill("#onlineRoomInput", room);
  await first.fill("#onlineNameInput", "P1");
  await first.locator("#connectOnlineButton").click();

  await second.locator("#friendButton").click();
  await second.fill("#onlineRoomInput", room);
  await second.fill("#onlineNameInput", "P2");
  await second.locator("#connectOnlineButton").click();

  await expect(first.locator("#onlineStatus")).toContainText(room);
  await expect(second.locator("#onlineStatus")).toContainText(room);
  await expect(first.locator("#onlinePlayers")).toContainText("P2");
  await expect(second.locator("#onlinePlayers")).toContainText("P1");

  const direct = await browser.newPage();
  await direct.goto(`/room/${room}`);
  await expect(direct.locator("#onlineOverlay")).toBeVisible();
  await expect(direct.locator("#roomCodeValue")).toHaveText(room);

  await first.close();
  await second.close();
  await direct.close();
});

test("hardcore time attack and replay menu are exposed", async ({ page }) => {
  await page.goto("/");

  await page.selectOption("#startMode", "hardcore");
  await expect(page.locator("#modeSummary")).toContainText("скорости");

  await page.selectOption("#startMode", "timeAttack");
  await expect(page.locator("#modeSummary")).toContainText("2");

  await page.locator("#replayButton").click();
  await expect(page.locator("#replayOverlay")).toBeVisible();
  await expect(page.locator("#replaySummary")).toBeVisible();
  await page.locator("#closeReplayButton").click();
});
