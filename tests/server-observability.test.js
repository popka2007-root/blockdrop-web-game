import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createLogger, createMetrics } = require("../server-observability.js");

afterEach(() => vi.restoreAllMocks());

describe("server observability", () => {
  it("writes structured info, warning, and error logs", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ service: "test-service" });
    logger.info("started", { requestId: "request-1" });
    logger.warn("slow", { matchId: "match-1" });
    logger.error("failed", { roomId: "ROOM" });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      level: "info",
      event: "started",
      service: "test-service",
      requestId: "request-1",
    });
    expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({
      level: "warn",
      event: "slow",
      matchId: "match-1",
    });
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
      level: "error",
      event: "failed",
      roomId: "ROOM",
    });
  });

  it("renders counters, gauges, summaries, and bounded observations", () => {
    const metrics = createMetrics();
    metrics.increment("requests_total");
    metrics.increment("requests_total", 2);
    metrics.increment("coerced_total", Number.NaN);
    metrics.set("players_active", 4);
    metrics.set("invalid_gauge", Number.NaN);
    metrics.observe("latency_ms", Number.NaN);
    for (let value = 1; value <= 2050; value += 1) {
      metrics.observe("latency_ms", value);
    }
    expect(metrics.get("requests_total")).toBe(3);
    expect(metrics.get("players_active")).toBe(4);
    expect(metrics.get("missing")).toBe(0);
    const rendered = metrics.render({ backup_age_seconds: 120 });
    expect(rendered).toContain("# TYPE requests_total counter");
    expect(rendered).toContain("requests_total 3");
    expect(rendered).toContain("# TYPE players_active gauge");
    expect(rendered).toContain("latency_ms_count 2050");
    expect(rendered).toContain("latency_ms_p50 1026");
    expect(rendered).toContain("latency_ms_p95 1948");
    expect(rendered).toContain("backup_age_seconds 120");
  });
});
