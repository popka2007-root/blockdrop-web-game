const { chromium } = require("@playwright/test");
const engine = require("../shared/engine.js");
const ai = require("../shared/ai.js");

const targetUrl = (process.env.TARGET_URL || "http://45.148.117.119").replace(
  /\/$/,
  "",
);
const expectedRevision = process.env.EXPECTED_REVISION || "";
const viewports = [
  { name: "desktop", width: 1280, height: 800, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
  {
    name: "galaxy-s25-fe",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    isMobile: true,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildDailyReplay(seed) {
  const state = engine.createState({ seed: `daily:${seed}`, mode: "classic" });
  const inputs = [];
  let seq = 0;
  while (!state.gameOver && state.tick < 100) {
    const plan = ai.planMove(engine.snapshot(state), {
      difficulty: "hard",
      style: "defensive",
    });
    for (const action of plan.actions) {
      const input = { tick: state.tick, seq: ++seq, action, pressed: true };
      inputs.push(input);
      engine.applyInput(state, input, []);
    }
    for (let tick = 0; tick < 12 && !state.gameOver; tick += 1) {
      engine.step(state);
    }
  }
  return {
    state,
    replay: engine.createReplay({
      seed: state.seed,
      mode: state.mode,
      inputs,
      finalState: state,
    }),
  };
}

async function readHealth(page) {
  const response = await page.request.get(`${targetUrl}/health`);
  assert(response.ok(), `/health returned ${response.status()}`);
  return response.json();
}

async function readCapabilities(page) {
  const response = await page.request.get(`${targetUrl}/api/capabilities`);
  assert(response.ok(), `/api/capabilities returned ${response.status()}`);
  return response.json();
}

async function smokeAccountAndDaily(page, capabilities) {
  const suffix = Math.random().toString(36).slice(2, 10);
  let account = null;
  if (capabilities.authEnabled) {
    const accountResponse = await page.request.post(
      `${targetUrl}/api/account`,
      {
        data: {
          action: "register",
          username: `smoke_${suffix}`,
          password: "password123",
          displayName: "Smoke",
        },
      },
    );
    assert(
      accountResponse.ok(),
      `account register returned ${accountResponse.status()}`,
    );
    account = await accountResponse.json();
    assert(account.token, "account token missing");
  } else {
    const accountResponse = await page.request.post(
      `${targetUrl}/api/account`,
      {
        data: {
          action: "register",
          username: `smoke_${suffix}`,
          password: "password123",
        },
      },
    );
    assert(
      accountResponse.status() === 426,
      `unsafe account endpoint returned ${accountResponse.status()}`,
    );
  }

  const dailyResponse = await page.request.post(`${targetUrl}/api/daily/run`, {
    headers: account?.token
      ? { Authorization: `Bearer ${account.token}` }
      : undefined,
    data: { playerId: "smoke" },
  });
  assert(
    dailyResponse.ok(),
    `/api/daily/run returned ${dailyResponse.status()}`,
  );
  const daily = await dailyResponse.json();
  assert(daily.runToken && daily.runSignature, "daily run signature missing");
  const dailyRun = buildDailyReplay(daily.seed);

  const submitResponse = await page.request.post(`${targetUrl}/api/daily`, {
    headers: account?.token
      ? { Authorization: `Bearer ${account.token}` }
      : undefined,
    data: {
      runToken: daily.runToken,
      runSignature: daily.runSignature,
      playerId: "smoke",
      name: "Smoke",
      score: dailyRun.state.score,
      lines: dailyRun.state.lines,
      level: dailyRun.state.level,
      timeMs: Math.floor((dailyRun.state.tick / engine.TICK_RATE) * 1000),
      pieces: dailyRun.state.pieces,
      bestCombo: dailyRun.state.combo,
      tSpins: 0,
      perfectClears: 0,
      replayChecksum: dailyRun.replay.finalChecksum,
      replay: dailyRun.replay,
    },
  });
  assert(
    submitResponse.ok(),
    `daily submit returned ${submitResponse.status()}`,
  );
  return {
    account: account?.account?.username || "disabled-without-https",
    dailyDate: daily.date,
  };
}

async function smokeViewport(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
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
    qrSrc && qrSrc.includes("/api/qr?data="),
    `${viewport.name}: QR missing`,
  );
  await page.locator("#closeOnlineButton").click();
  await page.waitForFunction(
    () => document.querySelector("#onlineOverlay")?.hidden === true,
  );
  await page.waitForFunction(
    () => document.querySelector("#startOverlay")?.hidden === false,
  );

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
    const capabilities = await readCapabilities(healthPage);
    const accountDaily = await smokeAccountAndDaily(healthPage, capabilities);
    for (const privatePath of [
      "/server.js",
      "/package-lock.json",
      "/blockdrop.sqlite",
      "/.git/HEAD",
    ]) {
      const privateResponse = await healthPage.request.get(
        `${targetUrl}${privatePath}`,
      );
      assert(
        privateResponse.status() === 404,
        `${privatePath} is publicly exposed (${privateResponse.status()})`,
      );
    }
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
      JSON.stringify(
        { targetUrl, health, capabilities, accountDaily, results },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
