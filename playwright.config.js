const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  // Performance budgets must run without a competing browser worker.
  workers: 1,
  snapshotPathTemplate: `{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-${process.platform}{ext}`,
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /s25-fe\.spec\.js/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], serviceWorkers: "block" },
      testIgnore: [/s25-fe\.spec\.js/, /visual\.spec\.js/, /pwa\.spec\.js/],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], serviceWorkers: "block" },
      testIgnore: [/s25-fe\.spec\.js/, /visual\.spec\.js/, /pwa\.spec\.js/],
    },
    {
      name: "galaxy-s25-fe",
      testMatch: /s25-fe\.spec\.js/,
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 780 },
        screen: { width: 360, height: 780 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 16; SM-S731B) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
      },
    },
    {
      name: "mobile-360x700",
      testMatch: /s25-fe\.spec\.js/,
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 700 },
        screen: { width: 360, height: 700 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-390x844",
      testMatch: /s25-fe\.spec\.js/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-landscape-780x360",
      testMatch: /s25-fe\.spec\.js/,
      use: {
        browserName: "chromium",
        viewport: { width: 780, height: 360 },
        screen: { width: 780, height: 360 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
