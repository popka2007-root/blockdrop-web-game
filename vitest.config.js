const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: [
        "shared/engine.js",
        "shared/protocol.js",
        "server-auth.js",
        "server-observability.js",
        "server-transport.js",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
