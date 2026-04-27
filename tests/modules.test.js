import { describe, expect, it } from "vitest";
import { makeAudioSettings, SOUND_EVENTS } from "../js/audio.js";
import {
  gestureProfile,
  normalizeControls,
  swipeThresholdForPreset,
} from "../js/input.js";
import {
  buildJoinMessage,
  buildRoomInviteUrl,
  buildUpdateMessage,
  defaultServerUrl,
  normalizePlayerName,
  normalizeRoomId,
  parseServerMessage,
  roomFromLocation,
} from "../js/online.js";

describe("audio module", () => {
  it("defines gameplay sound events and category settings", () => {
    expect(SOUND_EVENTS.move.category).toBe("move");
    expect(SOUND_EVENTS.tetris.category).toBe("clear");
    expect(makeAudioSettings({ volume: 85 }).volume).toBe(85);
  });
});

describe("input module", () => {
  it("normalizes mobile control settings and classifies swipes", () => {
    expect(normalizeControls({ sensitivityPreset: "high" }).sensitivity).toBe(
      swipeThresholdForPreset("high"),
    );

    expect(
      gestureProfile({ dx: 48, dy: 8, elapsedMs: 140, threshold: 24 }),
    ).toMatchObject({ horizontal: true, direction: "right" });
    expect(
      gestureProfile({ dx: 4, dy: 92, elapsedMs: 220, threshold: 24 }),
    ).toMatchObject({ shouldSoftDrop: true, shouldHardDrop: true });
    expect(
      gestureProfile({ dx: 4, dy: 4, elapsedMs: 80, threshold: 24 }),
    ).toMatchObject({ isTap: true });
  });
});

describe("online module", () => {
  it("normalizes room and player identifiers", () => {
    expect(normalizeRoomId(" duel-42! ")).toBe("DUEL42");
    expect(normalizePlayerName("<Alex>")).toBe("Alex");
  });

  it("builds room URLs for direct invites", () => {
    const location = new URL("http://example.com/game/index.html");
    const invite = buildRoomInviteUrl(location, "duel");
    expect(invite).toBe("http://example.com/game/room/DUEL");
  });

  it("reads rooms from URL path or query", () => {
    expect(roomFromLocation(new URL("http://example.com/room/AB12"))).toBe(
      "AB12",
    );
    expect(roomFromLocation(new URL("http://example.com/?room=xy9"))).toBe(
      "XY9",
    );
  });

  it("builds typed WebSocket messages", () => {
    expect(
      buildJoinMessage({
        room: "abc",
        name: "<P1>",
        maxPlayers: "4",
        durationSec: "180",
      }),
    ).toEqual({
      type: "join",
      room: "ABC",
      name: "P1",
      maxPlayers: 4,
      durationSec: 180,
    });

    expect(
      buildUpdateMessage({ room: "abc", name: "P1", score: 12.8, level: 0 })
        .level,
    ).toBe(1);
  });

  it("parses server messages defensively", () => {
    expect(parseServerMessage('{"type":"hello","id":"1"}').type).toBe("hello");
    expect(() => parseServerMessage("{}")).toThrow("Bad server message");
  });

  it("chooses the matching WebSocket scheme", () => {
    expect(defaultServerUrl(new URL("https://example.com/play"))).toBe(
      "wss://example.com",
    );
    expect(defaultServerUrl(new URL("http://example.com/play"))).toBe(
      "ws://example.com",
    );
  });
});
