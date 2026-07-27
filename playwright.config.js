const { defineConfig, devices } = require("@playwright/test");

const parallelProjects = [
  "chromium-functional",
  "firefox",
  "galaxy-s25-fe",
  "mobile-360x700",
  "mobile-390x844",
  "mobile-landscape-780x360",
];

const galaxyS25Fe = {
  browserName: "chromium",
  viewport: { width: 360, height: 780 },
  screen: { width: 360, height: 780 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 16; SM-S731B) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
};

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  // Independent projects share four workers. Resource-sensitive projects are
  // chained below so WebKit, visual snapshots, and performance run alone.
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 4),
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
      name: "chromium-functional",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/s25-fe\.spec\.js/, /visual\.spec\.js/],
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
      dependencies: parallelProjects,
    },
    {
      name: "galaxy-s25-fe",
      testMatch: /s25-fe\.spec\.js/,
      grepInvert: /@performance/,
      use: galaxyS25Fe,
    },
    {
      name: "mobile-360x700",
      testMatch: /s25-fe\.spec\.js/,
      grepInvert: /@performance/,
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
      grepInvert: /@performance/,
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
      grepInvert: /@performance/,
      use: {
        browserName: "chromium",
        viewport: { width: 780, height: 360 },
        screen: { width: 780, height: 360 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      // Keep the historical project name so existing screenshot baselines are reused.
      name: "chromium",
      testMatch: /visual\.spec\.js/,
      dependencies: ["webkit"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "galaxy-s25-fe-performance",
      testMatch: /s25-fe\.spec\.js/,
      grep: /@performance/,
      dependencies: ["chromium"],
      use: galaxyS25Fe,
    },
  ],
});
