import { describe, expect, it, vi } from "vitest";
import {
  createPrivacyAnalytics,
  sanitizeAnalyticsEvent,
} from "../js/analytics.js";

describe("privacy-first analytics", () => {
  it("drops forbidden fields and rejects unknown events", () => {
    expect(sanitizeAnalyticsEvent({ eventName: "board_snapshot" })).toBeNull();
    const event = sanitizeAnalyticsEvent({
      eventName: "game_finish",
      sessionId: "session.1",
      consented: true,
      payload: {
        result: "win",
        board: [[1]],
        inputs: ["left"],
        password: "secret",
        token: "token",
        ip: "127.0.0.1",
      },
    });
    expect(event.payload).toEqual({ result: "win" });
    expect(JSON.stringify(event)).not.toMatch(/board|input|password|token|ip/);
  });

  it("only transmits when both capability and consent are enabled", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const analytics = createPrivacyAnalytics({ fetchImpl });
    expect(await analytics.track("screen_view")).toBe(false);
    analytics.setEnabled(true);
    analytics.setConsent(true);
    expect(await analytics.track("screen_view")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
