import { expect, test } from "@playwright/test";

test("pinned mobile profile keeps gameplay usable inside the viewport", async ({
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

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.board.width).toBeGreaterThan(120);
  expect(layout.board.height).toBeGreaterThan(
    layout.viewport.width > layout.viewport.height ? 180 : 280,
  );
  expect(layout.board.x).toBeGreaterThanOrEqual(0);
  expect(layout.side.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.controls.bottom).toBeLessThanOrEqual(layout.viewport.height);
  if (layout.viewport.height >= layout.viewport.width) {
    expect(Math.abs(layout.hold.y - layout.menu.y)).toBeLessThan(2);
  }
  expect(layout.hold.height).toBeGreaterThanOrEqual(44);
  expect(layout.menu.height).toBeGreaterThanOrEqual(44);
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

test("Galaxy S25 FE sustains the frame and local input latency budget", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "galaxy-s25-fe");
  await page.goto("/");
  await page.locator("#startButton").click();

  const frameStats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let previous = performance.now();
        const started = previous;
        const collect = (now) => {
          samples.push(now - previous);
          previous = now;
          if (now - started < 1_200) {
            requestAnimationFrame(collect);
            return;
          }
          const sorted = samples.slice(1).sort((a, b) => a - b);
          resolve({
            fps: (sorted.length * 1_000) / (now - started),
            p50FrameMs: sorted[Math.floor(sorted.length * 0.5)] || 0,
            p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] || 0,
          });
        };
        requestAnimationFrame(collect);
      }),
  );

  await page.evaluate(() => {
    window.__blockdropInputLatency = null;
    addEventListener(
      "keydown",
      () => {
        const started = performance.now();
        requestAnimationFrame(() => {
          window.__blockdropInputLatency = performance.now() - started;
        });
      },
      { capture: true, once: true },
    );
  });
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => page.evaluate(() => window.__blockdropInputLatency))
    .not.toBeNull();
  const inputLatencyMs = await page.evaluate(
    () => window.__blockdropInputLatency,
  );

  expect(frameStats.fps).toBeGreaterThanOrEqual(40);
  expect(frameStats.p50FrameMs).toBeLessThan(20);
  expect(frameStats.p95FrameMs).toBeLessThan(35);
  expect(inputLatencyMs).toBeLessThan(80);
});
