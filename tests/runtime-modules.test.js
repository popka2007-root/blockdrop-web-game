import { describe, expect, it } from "vitest";
import { FLOW_STATE } from "../js/config.js";
import { advanceFrameClock, decayFlashes } from "../js/runtime-loop.js";
import {
  rankInfo,
  rankTextForScore,
  resultBadgeForGame,
  resultHighlightsForGame,
  scoreLineClear,
} from "../js/scoring.js";
import {
  countHoles,
  currentHeight,
  surfaceBumpiness,
  topDanger,
} from "../js/scene-state.js";
import { applySaveSnapshot, buildSavePayload } from "../js/save-load.js";

describe("runtime helper modules", () => {
  it("keeps scoring and rank calculations deterministic", () => {
    expect(scoreLineClear(4, 2)).toBe(1600);
    expect(rankTextForScore(3500)).toBe("Профи");
    expect(rankInfo(7000)).toMatchObject({
      current: "Мастер",
      next: "Легенда",
    });
  });

  it("calculates board risk metrics", () => {
    const board = Array.from({ length: 20 }, () => Array(10).fill(null));
    board[18][0] = "I";
    board[19][0] = "I";
    board[19][2] = "I";

    expect(currentHeight(board)).toBe(2);
    expect(countHoles(board)).toBe(0);
    expect(surfaceBumpiness(board)).toBeGreaterThan(0);
    expect(topDanger(board)).toBe(false);
  });

  it("builds and applies autosave snapshots without menu state leakage", () => {
    const state = {
      board: [["I"]],
      active: { kind: "T" },
      queue: ["I"],
      bag: [],
      hold: { kind: "O" },
      holdUsed: true,
      mode: "classic",
      difficulty: "normal",
      score: 120,
      lines: 1,
      level: 1,
      combo: 0,
      bestComboRun: 0,
      backToBackChain: 2,
      bestBackToBackRun: 3,
      pieces: 2,
      hardDrops: 1,
      holds: 1,
      rotations: 0,
      moves: 0,
      softDrops: 0,
      bestClearInGame: 1,
      tSpinCount: 2,
      tSpinMiniCount: 1,
      perfectClearCount: 1,
      bestMomentEvent: { isTSpin: true, lines: 2 },
      lastRotation: { active: true, from: 0, to: 1 },
      sessionHistory: [],
      survivalStreak: 1,
      lastStreakMs: 1000,
      currentGhostRun: [],
      lastGhostSampleMs: 1000,
      elapsedMs: 1000,
    };
    const save = buildSavePayload(state);
    const target = {
      running: false,
      paused: true,
      gameOver: true,
      flashes: [{ life: 1 }],
    };

    applySaveSnapshot(target, save, FLOW_STATE.PLAYING);

    expect(target.running).toBe(true);
    expect(target.paused).toBe(false);
    expect(target.gameOver).toBe(false);
    expect(target.phase).toBe(FLOW_STATE.PLAYING);
    expect(target.holdUsed).toBe(true);
    expect(target.bestBackToBackRun).toBe(3);
    expect(target.tSpinCount).toBe(2);
    expect(target.perfectClearCount).toBe(1);
    expect(target.lastRotation).toMatchObject({ active: true });
  });

  it("advances frame timing and decays row flashes", () => {
    const state = { lastTime: 0 };
    expect(advanceFrameClock(state, 100, 80)).toBe(0);
    expect(advanceFrameClock(state, 220, 80)).toBe(80);
    expect(
      decayFlashes([{ row: 1, life: 1, width: 0 }], 160, {
        FLASH_DECAY_MS: 320,
        FLASH_GROW_MS: 160,
      }),
    ).toEqual([{ row: 1, life: 0.5, width: 1 }]);
  });

  it("formats result badges and highlights for special clears", () => {
    expect(
      resultBadgeForGame({
        won: false,
        mode: "classic",
        daily: null,
        bestClearInGame: 4,
        bestComboRun: 3,
        bestBackToBackRun: 4,
        totalTSpins: 2,
        totalPerfectClears: 1,
        holes: 0,
        score: 3200,
        bestScore: 5000,
        language: "en",
      }),
    ).toBe("Perfect Clear");

    expect(
      resultHighlightsForGame({
        modeName: "Classic",
        dailyLabel: "—",
        bestClearInGame: 4,
        bestComboRun: 3,
        bestMoment: "T-Spin Double • B2B",
        bestBackToBackRun: 4,
        totalPerfectClears: 1,
        apm: 36,
        language: "en",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Best moment",
          value: "T-Spin Double • B2B",
        }),
        expect.objectContaining({ label: "B2B", value: "x4" }),
        expect.objectContaining({ label: "Perfect Clear", value: 1 }),
      ]),
    );
  });
});
