import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  parseMetrics,
  websocketUrl,
} = require("../scripts/soak-test.js");

describe("100 CCU soak runner", () => {
  it("parses Prometheus values used by the release thresholds", () => {
    expect(
      parseMetrics(`
# TYPE blockdrop_process_cpu_percent gauge
blockdrop_process_cpu_percent 24.5
blockdrop_db_lock_errors_total 0
blockdrop_match_processing_ms_p95 3.75
`),
    ).toEqual({
      blockdrop_process_cpu_percent: 24.5,
      blockdrop_db_lock_errors_total: 0,
      blockdrop_match_processing_ms_p95: 3.75,
    });
  });

  it("builds secure and insecure WebSocket targets", () => {
    expect(websocketUrl("http://127.0.0.1:8787/app")).toBe(
      "ws://127.0.0.1:8787/ws",
    );
    expect(websocketUrl("https://blockdrop.example/app")).toBe(
      "wss://blockdrop.example/ws",
    );
    expect(parseArgs(["--ccu", "10", "--duration", "5"])).toEqual({
      ccu: "10",
      duration: "5",
    });
  });
});
