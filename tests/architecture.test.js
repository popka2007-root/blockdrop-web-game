import { describe, expect, it } from "vitest";
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
import fs from "node:fs";

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

describe("PWA update architecture", () => {
  it("waits for an explicit safe-reload message before activating updates", () => {
    const worker = fs.readFileSync(
      new URL("../sw.js", import.meta.url),
      "utf8",
    );
    const installHandler = worker.slice(
      worker.indexOf('self.addEventListener("install"'),
      worker.indexOf('self.addEventListener("message"'),
    );
    expect(installHandler).not.toContain("skipWaiting");
    expect(worker).toContain('event.data?.type === "SKIP_WAITING"');
    expect(worker).toContain("caches.delete");
    expect(worker).toContain("/js/progression.js");
    expect(worker).toContain("/js/analytics.js");
  });
});

describe("strict CSP source gate", () => {
  it("contains no inline style attributes or runtime style assignments", () => {
    const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const browserSources = ["ui.js", "game.js", "online.js"].map((name) =>
      fs.readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8"),
    );
    expect(html).not.toMatch(/\sstyle\s*=/i);
    for (const source of browserSources) {
      expect(source).not.toMatch(/\.style\.|setAttribute\(["']style["']/);
    }
  });
});
