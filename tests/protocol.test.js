import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const protocol = require("../shared/protocol.js");

describe("wire protocol payload builders", () => {
  it("normalizes malformed identifiers, names, modes, and previews", () => {
    expect(protocol.normalizeRoomId(" a-b c!42 ")).toBe("ABC42");
    expect(protocol.normalizePlayerName("  <Player>  ")).toBe("Player");
    expect(protocol.normalizePlayerName("<>")).toBe("Player");
    expect(protocol.normalizePlayerId(" player<>._-1 ")).toBe("player._-1");
    expect(protocol.normalizeIdentityToken(" token+/._- ")).toBe("token._-");
    expect(protocol.normalizeMatchMode("TIMEATTACK")).toBe("timeAttack");
    expect(protocol.normalizeMatchMode("unknown")).toBe("classic");
    expect(protocol.sanitizeBoardPreview(null)).toEqual([]);
    expect(
      protocol.sanitizeBoardPreview([
        [true, false, null, "2", "bad"],
        "0101",
      ]),
    ).toEqual([
      [1, 0, 0, 1, 0],
      [0, 1, 0, 1],
    ]);
  });

  it("creates a random local id through both supported entropy APIs", () => {
    expect(
      protocol.createLocalPlayerId({ randomUUID: () => "uuid-value" }),
    ).toBe("uuid-value");
    expect(
      protocol.createLocalPlayerId({
        getRandomValues(values) {
          values.fill(10);
          return values;
        },
      }),
    ).toBe("0a".repeat(16));
  });

  it("clamps join and authoritative input commands", () => {
    expect(
      protocol.buildJoinMessage({
        room: "room",
        name: "P1",
        maxPlayers: 0,
        durationSec: 0,
        mode: "chaos",
        protocolVersion: 999,
        rankedQueue: 1,
      }),
    ).toMatchObject({
      protocolVersion: 2,
      maxPlayers: 2,
      durationSec: 180,
      mode: "chaos",
      rankedQueue: true,
    });
    expect(
      protocol.buildInputMessage({
        matchId: "x".repeat(200),
        seq: -4,
        tick: 999999999,
        action: "illegal",
        pressed: false,
      }),
    ).toEqual({
      type: "input",
      matchId: "x".repeat(128),
      seq: 1,
      tick: 216000,
      action: "",
      pressed: false,
    });
  });

  it("builds bounded legacy, tournament, ping, rematch, and result payloads", () => {
    expect(
      protocol.buildUpdateMessage({
        room: "room",
        name: "P1",
        score: 1e12,
        lines: -1,
        level: 1000,
        height: 30,
        sentGarbage: 1e9,
        receivedGarbage: 2,
        mode: "x".repeat(40),
        time: "1:23",
        status: "Playing",
        force: true,
        fieldPreview: [[1, 0]],
      }),
    ).toMatchObject({
      score: protocol.MAX_RECORD_SCORE,
      lines: 0,
      level: 99,
      height: 20,
      sentGarbage: 9999,
      boardPreview: [[1, 0]],
    });
    expect(
      protocol.buildTournamentMessage({ room: "t", maxPlayers: 0 }),
    ).toMatchObject({ maxPlayers: 2, durationSec: 180, mode: "classic" });
    expect(protocol.buildPingMessage(-10)).toEqual({ type: "ping", ts: 0 });
    expect(protocol.buildRematchReadyMessage("a-b")).toEqual({
      type: "rematchReady",
      room: "AB",
    });
    expect(protocol.buildMatchOverMessage("a", "other").result).toBe("loss");
    expect(protocol.buildMatchOverMessage("a", "win").result).toBe("win");
    expect(
      protocol.buildMatchEventMessage("a", {
        eventType: "x".repeat(30),
        lines: 9,
        attackLines: 99,
        combo: 2000,
        score: 1e12,
        elapsedMs: 1e12,
      }),
    ).toMatchObject({
      lines: 4,
      attackLines: 12,
      combo: 999,
      score: protocol.MAX_RECORD_SCORE,
      elapsedMs: 10800000,
    });
  });
});
