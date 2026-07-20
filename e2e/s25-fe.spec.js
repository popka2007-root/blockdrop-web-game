import { expect, test } from "@playwright/test";

test("Galaxy S25 FE portrait keeps gameplay usable inside the viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#startButton").click();

  const layout = await page.evaluate(() => {
    const box = (selector) =>
      document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      board: box("#boardShell"),
      side: box("#sidePanel"),
      controls: box("#controls"),
      hold: box("#holdButton"),
      menu: box("#mainMenuButton"),
    };
  });

  expect(layout.viewport).toEqual({ width: 360, height: 780 });
  expect(layout.documentWidth).toBeLessThanOrEqual(360);
  expect(layout.board.width).toBeGreaterThan(150);
  expect(layout.board.height).toBeGreaterThan(300);
  expect(layout.board.x).toBeGreaterThanOrEqual(0);
  expect(layout.side.right).toBeLessThanOrEqual(360);
  expect(layout.controls.bottom).toBeLessThanOrEqual(780);
  expect(Math.abs(layout.hold.y - layout.menu.y)).toBeLessThan(2);
  expect(layout.hold.height).toBeGreaterThanOrEqual(42);
  expect(layout.menu.height).toBeGreaterThanOrEqual(42);
});

test("Galaxy S25 FE shows a clear casual-only mode on public HTTP", async ({
  page,
}) => {
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        secureTransport: false,
        authEnabled: false,
        rankedEnabled: false,
        casualOnlineEnabled: true,
        maxPlayers: 2,
      }),
    }),
  );
  await page.goto("/");
  await page.locator("#friendButton").click();

  await expect(page.locator("#onlineSecurityNotice")).toBeVisible();
  await expect(page.locator("#onlineSecurityNotice")).toContainText("HTTPS");
  await expect(page.locator("#accountUsernameInput")).toBeHidden();
  await expect(page.locator("#findRankedButton")).toBeHidden();
  await expect(page.locator("#connectOnlineButton")).toBeVisible();
  await expect(page.locator("#roomQr")).toHaveAttribute("src", /\/api\/qr/);
  await expect(page.locator("#roomQr")).toHaveJSProperty("complete", true);
});

test("dialogs expose dialog semantics and keep focus inside", async ({
  page,
}) => {
  await page.goto("/");
  const startOverlay = page.locator("#startOverlay");
  await expect(startOverlay).toHaveAttribute("role", "dialog");
  await expect(startOverlay).toHaveAttribute("aria-modal", "true");
  await expect(startOverlay).toHaveAttribute("aria-labelledby", /.+/);

  await page.locator("#menuMoreSummary").click();
  await page.locator("#startSettingsButton").click();
  await expect(page.locator("#settingsOverlay")).toBeVisible();
  await expect(page.locator("#settingsOverlay")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .querySelector("#settingsOverlay")
          .contains(document.activeElement),
      ),
    )
    .toBe(true);
});
