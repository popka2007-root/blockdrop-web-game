import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const engine = require("../shared/engine.js");
const ai = require("../shared/ai.js");

function applyPlan(state, plan) {
  const events = [];
  for (const action of plan.actions) {
    const accepted = engine.applyInput(
      state,
      {
        tick: state.tick,
        seq: state.lastAckSeq + 1,
        action,
        pressed: true,
      },
      events,
    );
    expect(accepted).toBe(true);
  }
  return events;
}

describe("beam-search AI", () => {
  it("returns the same legal plan for the same snapshot", () => {
    const state = engine.createState({ seed: "ai-deterministic" });
    const snapshot = engine.snapshot(state);
    const first = ai.planMove(snapshot, {
      difficulty: "hard",
      style: "balanced",
    });
    const second = ai.planMove(snapshot, {
      difficulty: "hard",
      style: "balanced",
    });

    expect(second).toEqual(first);
    expect(first.actions.at(-1)).toBe("hardDrop");
    expect(applyPlan(state, first).some((event) => event.type === "lock")).toBe(
      true,
    );
  });

  it("exposes four measurably different difficulty profiles", () => {
    const profiles = Object.values(ai.DIFFICULTIES);
    expect(
      new Set(profiles.map((profile) => profile.depth)).size,
    ).toBeGreaterThan(1);
    expect(new Set(profiles.map((profile) => profile.thinkTicks)).size).toBe(4);
    expect(new Set(profiles.map((profile) => profile.mistakeRate)).size).toBe(
      4,
    );
    expect(ai.DIFFICULTIES.easy.allowHold).toBe(false);
    expect(ai.DIFFICULTIES.insane.allowHold).toBe(true);
    expect(ai.DIFFICULTIES.easy.mistakeRate).toBe(0.2);
    expect(ai.DIFFICULTIES.easy.mistakeWindow).toBe(4);
    expect(ai.DIFFICULTIES.normal.mistakeRate).toBe(0.05);
    expect(ai.DIFFICULTIES.insane.maxNodes).toBeLessThanOrEqual(3_600);
  });

  it("plays a long deterministic sequence without illegal moves", () => {
    const run = () => {
      const state = engine.createState({ seed: "ai-long-run" });
      for (let piece = 0; piece < 45 && !state.gameOver; piece += 1) {
        const plan = ai.planMove(engine.snapshot(state), {
          difficulty: "normal",
          style: "defensive",
        });
        applyPlan(state, plan);
        engine.step(state);
      }
      return engine.checksum(engine.snapshot(state));
    };

    expect(run()).toBe(run());
  });

  it("evaluates the requested board features", () => {
    const board = engine.makeBoard();
    board[19][0] = "T";
    board[17][0] = "T";
    board[19][2] = "I";
    const metrics = ai.boardMetrics(board);

    expect(metrics).toMatchObject({
      aggregateHeight: 4,
      holes: 1,
      maxHeight: 3,
    });
    expect(metrics.bumpiness).toBeGreaterThan(0);
    expect(metrics.wells).toBeGreaterThanOrEqual(0);
  });

  it("keeps deliberate mistakes near the configured rate with vector RNG seeds", () => {
    let easyMistakes = 0;
    for (let index = 0; index < 80; index += 1) {
      const state = engine.createState({ seed: `ai-rate-${index}` });
      state.tick = index * 17;
      state.pieces = index;
      const plan = ai.planMove(engine.snapshot(state), {
        difficulty: "easy",
        style: "balanced",
      });
      easyMistakes += plan.mistake ? 1 : 0;
    }

    expect(easyMistakes).toBeGreaterThanOrEqual(8);
    expect(easyMistakes).toBeLessThanOrEqual(28);
  });
});
