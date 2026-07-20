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
});
