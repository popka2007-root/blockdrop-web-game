import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../js/event-bus.js";
import { GameState } from "../js/game-state.js";
import {
  getModeConfig,
  getModeOptions,
  normalizeModeKey,
} from "../js/modes.js";
import {
  calc,
  format,
  getGhostOverlayHeight,
  localDateKey,
  validate,
} from "../js/utils.js";

describe("mode configuration", () => {
  it("normalizes known modes and legacy aliases", () => {
    expect(normalizeModeKey("classic")).toBe("classic");
    expect(normalizeModeKey("zen")).toBe("relax");
    expect(normalizeModeKey("unknown")).toBe("classic");
  });

  it("defines sprint and chaos gameplay parameters", () => {
    expect(getModeConfig("sprint").targetLines).toBe(40);
    expect(getModeConfig("chaos").garbageAttacks).toBe(true);
    expect(getModeConfig("hardcore").speedMultiplier).toBeGreaterThan(1);
    expect(getModeConfig("timeAttack").timeLimit).toBe(120);
    expect(getModeOptions("en").map((mode) => mode.name)).toContain("40 Lines");
  });
});

describe("event bus", () => {
  it("emits regular and once-only handlers", () => {
    const bus = new EventBus();
    const regular = vi.fn();
    const once = vi.fn();

    bus.on("game:started", regular);
    bus.once("game:started", once);
    bus.emit("game:started", { mode: "classic" });
    bus.emit("game:started", { mode: "sprint" });

    expect(regular).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("removes handlers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("settings:changed", handler);
    bus.off("settings:changed", handler);
    bus.emit("settings:changed", {});
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("game state manager", () => {
  it("starts from mode defaults and serializes the state", () => {
    const state = new GameState(getModeConfig("sprint"));
    state.updateScore(100);
    state.updateLines(4);

    expect(state.level).toBe(1);
    expect(state.lines).toBe(4);
    expect(state.toJSON().mode).toBe("sprint");
  });
});

describe("utils", () => {
  it("formats and validates common UI values", () => {
    expect(format.time(65_000)).toBe("1:05");
    expect(format.percentage(0.42)).toBe("42%");
    expect(validate.roomName("DUEL42")).toBe(true);
    expect(validate.playerName("")).toBe(false);
  });

  it("calculates progress and next level boundaries", () => {
    expect(calc.progress(20, 40)).toBe(0.5);
    expect(calc.nextLevel(10, 10)).toBe(10);
    expect(calc.nextLevel(13, 10)).toBe(7);
  });

  it("keeps daily keys stable within a local calendar day", () => {
    const morning = new Date(2026, 3, 28, 8, 15);
    const lateEvening = new Date(2026, 3, 28, 23, 59);
    const nextDay = new Date(2026, 3, 29, 0, 1);

    expect(localDateKey(morning)).toBe("2026-04-28");
    expect(localDateKey(lateEvening)).toBe(localDateKey(morning));
    expect(localDateKey(nextDay)).toBe("2026-04-29");
  });

  it("shows ghost comparison height only for an explicit ghost replay", () => {
    const ghostRun = {
      mode: "classic",
      samples: [
        { time: 0, height: 3 },
        { time: 6000, height: 7 },
      ],
    };

    expect(
      getGhostOverlayHeight({
        ghostRun,
        mode: "classic",
        running: true,
        ghostReplay: false,
        elapsedMs: 7000,
      }),
    ).toBe(0);

    expect(
      getGhostOverlayHeight({
        ghostRun,
        mode: "classic",
        running: true,
        ghostReplay: true,
        elapsedMs: 7000,
      }),
    ).toBe(7);
  });
});
