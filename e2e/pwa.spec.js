import { expect, test } from "@playwright/test";

test("offline fallback reloads the game after the service worker warms", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => "serviceWorker" in navigator && navigator.serviceWorker.ready,
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#startOverlay")).toBeVisible();
  await expect(page.locator("#startButton")).toBeEnabled();
  await context.setOffline(false);
});

test("public HTTP capability keeps installation hidden", async ({ page }) => {
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        secureTransport: false,
        authEnabled: false,
        rankedEnabled: false,
        pwaInstallEnabled: false,
      }),
    }),
  );
  await page.goto("/");
  await expect(page.locator("#installButton")).toBeHidden();
});
