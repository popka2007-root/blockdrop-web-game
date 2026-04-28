const { chromium } = require("@playwright/test");

const targetUrl = (process.env.TARGET_URL || "http://45.148.117.119").replace(
  /\/$/,
  "",
);
const expectedRevision = process.env.EXPECTED_REVISION || "";
const viewports = [
  { name: "desktop", width: 1280, height: 800, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readHealth(page) {
  const response = await page.request.get(`${targetUrl}/health`);
  assert(response.ok(), `/health returned ${response.status()}`);
  return response.json();
}

async function smokeAccountAndDaily(page) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const accountResponse = await page.request.post(`${targetUrl}/api/account`, {
    data: {
      action: "register",
      username: `smoke_${suffix}`,
      password: "password123",
      displayName: "Smoke",
    },
  });
  assert(accountResponse.ok(), `account register returned ${accountResponse.status()}`);
  const account = await accountResponse.json();
  assert(account.token, "account token missing");

  const dailyResponse = await page.request.get(`${targetUrl}/api/daily`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  assert(dailyResponse.ok(), `/api/daily returned ${dailyResponse.status()}`);
  const daily = await dailyResponse.json();
  assert(daily.runToken && daily.runSignature, "daily run signature missing");

  const submitResponse = await page.request.post(`${targetUrl}/api/daily`, {
    data: {
      accountToken: account.token,
      runToken: daily.runToken,
      runSignature: daily.runSignature,
      playerId: "smoke",
      name: "Smoke",
      score: 500,
      lines: 2,
      level: 1,
      timeMs: 2500,
      pieces: 10,
      bestCombo: 1,
      tSpins: 0,
      perfectClears: 0,
    },
  });
  assert(submitResponse.ok(), `daily submit returned ${submitResponse.status()}`);
  return { account: account.account.username, dailyDate: daily.date };
}

async function smokeViewport(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(targetUrl, { waitUntil: "networkidle" });
  assert(
    await page.locator("#startOverlay").isVisible(),
    `${viewport.name}: start overlay missing`,
  );
  assert(
    (await page.locator("#startMode option").count()) >= 4,
    `${viewport.name}: modes missing`,
  );
  assert(
    (await page.locator("#menuRecords").textContent()).trim().length > 0,
    `${viewport.name}: menu records missing`,
  );

  await page.locator("#startButton").click();
  await page.waitForTimeout(250);
  assert(
    await page.locator("#startOverlay").evaluate((node) => node.hidden),
    `${viewport.name}: quick start did not enter game`,
  );
  assert(
    await page.locator("#board").isVisible(),
    `${viewport.name}: board not visible`,
  );

  await page.locator("#mainMenuButton").click();
  await page.locator("#aiButton").click();
  await page.selectOption("#aiDifficultySelect", "hard");
  await page.locator("#startAiButton").click();
  await page.waitForTimeout(250);
  assert(
    await page.locator("#startOverlay").evaluate((node) => node.hidden),
    `${viewport.name}: AI game did not start`,
  );

  await page.locator("#mainMenuButton").click();
  await page.locator("#friendButton").click();
  const roomCode = await page.locator("#roomCodeValue").innerText();
  const qrSrc = await page.locator("#roomQr").getAttribute("src");
  assert(
    /^[A-Z0-9]{4,16}$/.test(roomCode),
    `${viewport.name}: room code invalid`,
  );
  assert(
    qrSrc && qrSrc.includes("create-qr-code"),
    `${viewport.name}: QR missing`,
  );
  await page.locator("#closeOnlineButton").click();
  await page.waitForFunction(() => document.querySelector("#onlineOverlay")?.hidden === true);
  await page.waitForFunction(() => document.querySelector("#startOverlay")?.hidden === false);

  await page.locator("#dailyButton").click();
  await page.waitForTimeout(250);
  assert(
    await page.locator("#startOverlay").evaluate((node) => node.hidden),
    `${viewport.name}: daily did not start`,
  );

  assert(
    errors.length === 0,
    `${viewport.name}: browser errors:\n${errors.join("\n")}`,
  );
  await page.close();
  return { viewport: viewport.name, roomCode };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const healthPage = await browser.newPage();
    const health = await readHealth(healthPage);
    const accountDaily = await smokeAccountAndDaily(healthPage);
    await healthPage.close();
    assert(health.ok === true, "health ok flag is false");
    assert(health.service === "blockdrop-web-game", "health service mismatch");
    if (expectedRevision)
      assert(
        health.revision === expectedRevision,
        `revision ${health.revision} !== ${expectedRevision}`,
      );

    const results = [];
    for (const viewport of viewports) {
      results.push(await smokeViewport(browser, viewport));
    }

    console.log(
      JSON.stringify({ targetUrl, health, accountDaily, results }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
