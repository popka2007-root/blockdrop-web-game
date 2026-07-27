const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect } = require("@playwright/test");

test.setTimeout(60_000);

async function expectNoSeriousViolations(page) {
  await page.waitForFunction(() =>
    document
      .getAnimations({ subtree: true })
      .every((animation) => ["finished", "idle"].includes(animation.playState)),
  );
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact),
  );
  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test("menu, settings, and gameplay have no critical or serious axe violations", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoSeriousViolations(page);

  await page.locator("#menuMoreSummary").click();
  await page.locator("#startSettingsButton").click();
  await expectNoSeriousViolations(page);
  await page.locator("#closeSettingsButton").click();

  await page.locator("#startButton").click();
  await expect(page.locator("#board")).toHaveAttribute(
    "aria-describedby",
    "boardDescription",
  );
  await expect(page.locator("#boardDescription")).not.toBeEmpty();
  await expectNoSeriousViolations(page);
});

test("interactive onboarding validates movement, rotate, drop, and hold", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#menuMoreSummary").click();
  await page.locator("#helpButton").click();
  await page.locator("#tutorialButton").click();
  await page.locator("#tutorialPlayButton").click();
  await expect(page.locator("#onboardingBar")).toBeVisible();

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await page.keyboard.press("KeyC");
  await expect(page.locator("#onboardingBar")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("blockdrop-onboarding-v1") || "null"),
      ),
    )
    .toMatchObject({ completed: true });
});
