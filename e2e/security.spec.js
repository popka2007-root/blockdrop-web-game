import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

test("strict CSP allows normal menu, gameplay, stats, and replay flows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__blockdropCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__blockdropCspViolations.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
      });
    });
  });
  await page.goto("/");
  await page.locator("#startButton").click();
  await page.keyboard.press("Space");
  await page.locator("#mainMenuButton").click();
  await page.locator("#menuMoreSummary").click();
  await page.locator("#openStatsButton").click();
  await page.locator("#closeStatsButton").click();
  await page.locator("#replayButton").click();

  expect(
    await page.evaluate(() => window.__blockdropCspViolations),
  ).toEqual([]);
  const csp = await page.request
    .get("/")
    .then((response) => response.headers()["content-security-policy"]);
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
});
