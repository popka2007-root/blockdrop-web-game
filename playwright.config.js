const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
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
  ],
});
