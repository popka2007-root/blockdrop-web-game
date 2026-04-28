import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAudioSettings, SOUND_EVENTS } from "../js/audio.js";
import {
  gestureProfile,
  normalizeControls,
  swipeThresholdForPreset,
} from "../js/input.js";
import {
  BOARD_PREVIEW_COLS,
  BOARD_PREVIEW_ROWS,
  buildJoinMessage,
  copyTextToClipboard,
  buildRoomInviteUrl,
  createOnlineClient,
  buildUpdateMessage,
  defaultServerUrl,
  loadRankedIdentityToken,
  normalizePlayerName,
  normalizePlayerId,
  loadOrCreatePlayerId,
  normalizeRoomId,
  parseServerMessage,
  roomFromLocation,
  sanitizeBoardPreview,
  saveRankedIdentityToken,
  sendAttack,
  sendRematchReady,
  sendScoreUpdate,
} from "../js/online.js";
import {
  loadMatchHistory,
  loadOnlineStats,
  saveMatchHistoryEntry,
  saveOnlineStats,
} from "../js/storage.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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
        ranked: true,
        playerId: " player<id> ",
      }),
    ).toEqual({
      type: "join",
      protocolVersion: 2,
      room: "ABC",
      name: "P1",
      maxPlayers: 4,
      durationSec: 180,
      mode: "classic",
      ranked: true,
        playerId: "playerid",
        identityToken: "",
        accountToken: "",
        rankedQueue: false,
      });

    expect(
      buildUpdateMessage({ room: "abc", name: "P1", score: 12.8, level: 0 })
        .level,
    ).toBe(1);
  });

  it("keeps a stable local ranked player id", () => {
    expect(normalizePlayerId(" abc<>._-123 ")).toBe("abc._-123");
    const bucket = new Map();
    const storage = {
      getItem: vi.fn((key) => bucket.get(key) || null),
      setItem: vi.fn((key, value) => bucket.set(key, value)),
    };
    const first = loadOrCreatePlayerId(storage, "ranked-id");
    const second = loadOrCreatePlayerId(storage, "ranked-id");
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("stores ranked identity tokens safely", () => {
    const bucket = new Map();
    const storage = {
      getItem: vi.fn((key) => bucket.get(key) || null),
      setItem: vi.fn((key, value) => bucket.set(key, value)),
      removeItem: vi.fn((key) => bucket.delete(key)),
    };

    expect(loadRankedIdentityToken(storage, "ranked-token")).toBe("");
    expect(
      saveRankedIdentityToken("v1.player.signature", storage, "ranked-token"),
    ).toBe("v1.player.signature");
    expect(loadRankedIdentityToken(storage, "ranked-token")).toBe(
      "v1.player.signature",
    );
    expect(saveRankedIdentityToken("", storage, "ranked-token")).toBe("");
    expect(loadRankedIdentityToken(storage, "ranked-token")).toBe("");
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

  it("sanitizes compact board previews for opponent mini-boards", () => {
    const preview = sanitizeBoardPreview(
      Array.from({ length: BOARD_PREVIEW_ROWS + 4 }, (_, rowIndex) =>
        Array.from(
          { length: BOARD_PREVIEW_COLS + 3 },
          (_, colIndex) => (rowIndex + colIndex) % 3,
        ),
      ),
    );

    expect(preview).toHaveLength(BOARD_PREVIEW_ROWS);
    expect(preview[0]).toHaveLength(BOARD_PREVIEW_COLS);
    expect(new Set(preview.flat())).toEqual(new Set([0, 1]));
  });

  it("throttles score updates and blocks spectator PvP actions", () => {
    const socket = { readyState: 1, send: vi.fn() };
    const client = createOnlineClient();
    client.socket = socket;

    vi.spyOn(performance, "now")
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(250)
      .mockReturnValueOnce(380);

    expect(sendScoreUpdate(client, { room: "duel", name: "P1", score: 10 })).toBe(
      true,
    );
    expect(sendScoreUpdate(client, { room: "duel", name: "P1", score: 20 })).toBe(
      false,
    );
    expect(
      sendScoreUpdate(client, {
        room: "duel",
        name: "P1",
        score: 30,
        boardPreview: [[1, 2, 0]],
      }),
    ).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(socket.send.mock.calls[1][0]).boardPreview).toEqual([
      [1, 1, 0],
    ]);

    client.role = "spectator";
    expect(sendScoreUpdate(client, { room: "duel", name: "P1", score: 40 })).toBe(
      false,
    );
    expect(sendAttack(client, "duel", 4)).toBe(false);
    expect(sendRematchReady(client, "duel")).toBe(false);
  });

  it("copies invite text with secure clipboard and HTTP fallback", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue() };
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    const originalSecureContext = Object.getOwnPropertyDescriptor(
      globalThis,
      "isSecureContext",
    );
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard },
    });
    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value: true,
    });

    await expect(copyTextToClipboard("https://example.com/room/DUEL")).resolves.toBe(
      true,
    );
    expect(clipboard.writeText).toHaveBeenCalledWith(
      "https://example.com/room/DUEL",
    );

    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const documentLike = {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    };

    Object.defineProperty(globalThis, "isSecureContext", {
      configurable: true,
      value: false,
    });

    await expect(
      copyTextToClipboard("http://example.com/room/DUEL", documentLike),
    ).resolves.toBe(true);
    expect(documentLike.body.appendChild).toHaveBeenCalledWith(textarea);
    expect(documentLike.execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalled();

    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
    if (originalSecureContext) {
      Object.defineProperty(globalThis, "isSecureContext", originalSecureContext);
    } else {
      delete globalThis.isSecureContext;
    }
  });
});

describe("storage module", () => {
  it("keeps at most 10 PvP history entries", () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify(
          Array.from({ length: 12 }, (_, index) => ({
            result: index % 2 ? "win" : "loss",
            opponent: `P${index}`,
          })),
        ),
      ),
    };

    const history = loadMatchHistory("history", storage);
    expect(history).toHaveLength(10);
    expect(history[0].opponent).toBe("P0");
    expect(history[9].opponent).toBe("P9");
  });

  it("does not fail when localStorage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    expect(() =>
      saveMatchHistoryEntry({ result: "win", opponent: "Alex" }, "history", storage),
    ).not.toThrow();
  });

  it("tracks online wins, losses, and winrate", () => {
    const bucket = new Map();
    const storage = {
      getItem: vi.fn((key) => (bucket.has(key) ? bucket.get(key) : null)),
      setItem: vi.fn((key, value) => bucket.set(key, value)),
    };

    expect(saveOnlineStats("win", "stats", storage)).toMatchObject({
      wins: 1,
      losses: 0,
      totalMatches: 1,
      winrate: 100,
    });
    expect(saveOnlineStats("loss", "stats", storage)).toMatchObject({
      wins: 1,
      losses: 1,
      totalMatches: 2,
      winrate: 50,
    });
    expect(loadOnlineStats("stats", storage)).toMatchObject({
      wins: 1,
      losses: 1,
      totalMatches: 2,
      winrate: 50,
    });
  });
});
