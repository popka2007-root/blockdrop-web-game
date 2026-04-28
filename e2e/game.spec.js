import { devices, expect, test } from "@playwright/test";

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

test("solo play keeps online and PvP side panels hidden", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "blockdrop-ghost-run-v1",
      JSON.stringify({
        score: 9000,
        mode: "classic",
        date: "2026-04-27T10:00:00.000Z",
        samples: [{ time: 0, height: 12, score: 9000, lines: 24 }],
      }),
    );
  });
  await page.goto("/");
  await page.locator("#startButton").click();

  await expect(page.locator("#onlinePanel")).toBeHidden();
  await expect(page.locator("#pvpEnhancements")).toBeHidden();

  const pixel = await page.evaluate(() => {
    const canvas = document.getElementById("board");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const data = ctx.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height * 0.85),
      1,
      1,
    ).data;
    return Array.from(data);
  });

  expect(pixel[0]).toBeLessThan(80);
  expect(pixel[1]).toBeLessThan(80);
});

test("P and Escape toggle pause from keyboard", async ({ page }) => {
  await page.goto("/");
  await page.locator("#startButton").click();

  await page.keyboard.press("KeyP");
  await expect(page.locator("#pauseOverlay")).toBeVisible();

  await page.locator("#resumeButton").click();
  await expect(page.locator("#pauseOverlay")).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(page.locator("#pauseOverlay")).toBeVisible();
});

test("hold works on C key and is limited until the next lock", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto("/");
  await page.locator("#startButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();

  const holdPreview = page.locator("#hold");
  const beforeHold = await holdPreview.evaluate((canvas) => canvas.toDataURL());
  await page.keyboard.press("KeyC");
  await expect
    .poll(() => holdPreview.evaluate((canvas) => canvas.toDataURL()))
    .not.toBe(beforeHold);
  const afterHold = await holdPreview.evaluate((canvas) => canvas.toDataURL());
  expect(afterHold).not.toBe(beforeHold);

  await page.keyboard.press("KeyC");
  const afterBlockedHold = await holdPreview.evaluate((canvas) =>
    canvas.toDataURL(),
  );
  expect(afterBlockedHold).toBe(afterHold);

  await page.keyboard.press("Space");
  await page.waitForTimeout(50);
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(50);
  const afterLockHold = await holdPreview.evaluate((canvas) =>
    canvas.toDataURL(),
  );
  expect(afterLockHold).not.toBe(afterBlockedHold);
});

test("autosave restores an active game from the menu", async ({ page }) => {
  await page.goto("/");
  await page.locator("#startButton").click();
  await page.keyboard.press("KeyC");
  await page.keyboard.press("KeyP");

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blockdrop-save-v2") || "null"),
  );
  expect(saved?.active).toBeTruthy();
  expect(saved?.hold).toBeTruthy();

  await page.reload();
  await page.locator("#continueButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();
  await expect(page.locator("#scoreValue")).toBeVisible();
});

test("menu buttons ignore scroll-like pointer movement", async ({ page }) => {
  await page.goto("/");
  const moreButton = page.locator("#menuMoreSummary");
  await moreButton.scrollIntoViewIfNeeded();
  const box = await moreButton.boundingBox();
  expect(box).toBeTruthy();

  await moreButton.dispatchEvent("pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
  await moreButton.dispatchEvent("pointermove", {
    pointerId: 1,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2 + 40,
  });
  await moreButton.dispatchEvent("pointerup", {
    pointerId: 1,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2 + 40,
  });

  await expect(page.locator("#helpOverlay")).toBeHidden();
});

test("game over overlay can be shown by the runtime", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.getElementById("gameOverOverlay").hidden = false;
  });
  await expect(page.locator("#gameOverOverlay")).toBeVisible();
});

test("new menu actions expose useful play flows", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    window.__copiedText = "";
    document.execCommand = (command) => {
      if (command !== "copy") return false;
      window.__copiedText = document.activeElement?.value || "";
      return true;
    };
  });
  await page.goto("/");

  await expect(page.locator("#modeSummary")).toContainText("Выжить");
  await page.selectOption("#startMode", "sprint");
  await expect(page.locator("#modeSummary")).toContainText("40");

  await page.locator("#menuMoreSummary").click();
  await page.locator("#helpButton").click();
  await expect(page.locator("#helpOverlay")).toContainText("AI");
  await expect(page.locator("#helpOverlay")).toContainText("QR");
  await expect(page.locator("#helpOverlay")).not.toContainText(
    "Открыть комнату",
  );
  await page.locator("#closeHelpButton").click();

  await expect(page.locator("#menuRecords")).toContainText("Рекорд");
  await page.locator("#aiButton").click();
  await expect(page.locator("#aiOverlay")).toBeVisible();
  await page.selectOption("#aiDifficultySelect", "hard");
  await page.locator("#startAiButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();

  await page.locator("#mainMenuButton").click();
  await page.locator("#friendButton").click();
  await expect(page.locator("#roomCodeValue")).not.toHaveText("----");
  await expect(page.locator("#onlineStatus")).toContainText(/Комната/);
  await expect(page.locator("#connectOnlineButton")).toHaveText("Начать игру");
  await expect(page.locator("#roomQr")).toHaveAttribute(
    "src",
    /create-qr-code/,
  );
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toContain("/room/");
  await page.locator("#closeOnlineButton").click();

  await page.locator("#dailyButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();
});

test("language switch updates settings, help, and online labels", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#menuMoreSummary").click();
  await page.locator("#startSettingsButton").click();
  await page.selectOption("#languageSelect", "en");

  await expect(page.locator("#settingsOverlay h2")).toHaveText("Settings");
  await expect(page.locator("#themeSelect")).toContainText("Graphite and mint");
  await expect(page.locator("#controlModeSelect")).toContainText("Swipes");
  await expect(page.locator("#sensitivitySelect")).toContainText("Medium");
  await expect(page.locator("#handednessSelect")).toContainText("Right");
  await page.locator("#closeSettingsButton").click();

  await page.locator("#helpButton").click();
  await expect(page.locator("#helpOverlay")).toContainText(
    "Online with a friend",
  );
  await page.locator("#closeHelpButton").click();

  await page.locator("#friendButton").click();
  await expect(page.locator("#onlineOverlay h2")).toHaveText("Online room");
  await expect(page.locator("label[for='onlineRoomInput']")).toHaveText("Room");
  await expect(page.locator(".toggle-row")).toContainText("Ranked PvP");
  await expect(page.locator("#connectOnlineButton")).toHaveText("Start game");
});

test("mobile layout keeps board and controls inside viewport", async ({
  page,
}) => {
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

test("mobile touch controls work without page scroll", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["iPhone 12"] });
  await context.addInitScript(() => {
    localStorage.setItem(
      "blockdrop-settings-v2",
      JSON.stringify({ controlMode: "hybrid" }),
    );
  });
  const page = await context.newPage();
  await page.goto(baseURL || "http://127.0.0.1:8787");
  await page.locator("#startButton").click();
  await expect(page.locator("#startOverlay")).toBeHidden();

  const beforeScore = Number(await page.locator("#scoreValue").textContent());
  await page.locator("#downButton").tap();
  await expect
    .poll(async () => Number(await page.locator("#scoreValue").textContent()))
    .toBeGreaterThan(beforeScore);

  const beforeScroll = await page.evaluate(() => window.scrollY);

  const board = await page.locator("#board").boundingBox();
  expect(board).toBeTruthy();
  const x = board.x + board.width / 2;
  const y = board.y + board.height / 2;
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: y + 80, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBe(beforeScroll);
  await context.close();
});

test("online room connects two players and shares state", async ({
  browser,
}) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  const room = `PW${Date.now().toString(36).slice(-6)}`.toUpperCase();

  await first.addInitScript(() =>
    localStorage.setItem("blockdrop-player-name", "P1"),
  );
  await second.addInitScript(() =>
    localStorage.setItem("blockdrop-player-name", "P2"),
  );

  await first.goto(`/room/${room}`);
  await second.goto(`/room/${room}`);

  await expect(first.locator("#onlineStatus")).toContainText(room);
  await expect(second.locator("#onlineStatus")).toContainText(room);
  await expect(first.locator("#pvpEnhancements")).toBeVisible();
  await expect(second.locator("#pvpEnhancements")).toBeVisible();
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

  await page.locator("#menuMoreSummary").click();
  await page.locator("#replayButton").click();
  await expect(page.locator("#replayOverlay")).toBeVisible();
  await expect(page.locator("#replaySummary")).toBeVisible();
  await page.locator("#closeReplayButton").click();
});
