import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const engine = require("../shared/engine.js");

function randomGenerator(seed = 0xdecafbad) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("engine property checks", () => {
  it("preserves board invariants under randomized commands and garbage", () => {
    const random = randomGenerator();
    for (let run = 0; run < 40; run += 1) {
      const state = engine.createState({ seed: `property:${run}` });
      let seq = 0;
      for (let tick = 0; tick < 500 && !state.gameOver; tick += 1) {
        const inputs = [];
        if (random() < 0.32) {
          inputs.push({
            tick: state.tick,
            seq: ++seq,
            action:
              engine.ACTIONS[Math.floor(random() * engine.ACTIONS.length)],
            pressed: random() > 0.1,
          });
        }
        if (random() < 0.025)
          engine.queueGarbage(state, 1 + Math.floor(random() * 4));
        engine.step(state, inputs);
        expect(state.board).toHaveLength(engine.ROWS);
        expect(state.board.every((row) => row.length === engine.COLS)).toBe(
          true,
        );
        expect(state.pendingGarbage).toBeGreaterThanOrEqual(0);
        expect(state.pendingGarbage).toBeLessThanOrEqual(40);
        if (!state.gameOver)
          expect(engine.isValid(state.board, state.active)).toBe(true);
      }
    }
  }, 15_000);

  it("never returns an illegal successful SRS rotation", () => {
    const random = randomGenerator(12345);
    for (let run = 0; run < 400; run += 1) {
      const state = engine.createState({ seed: `rotate:${run}` });
      for (let fill = 0; fill < 45; fill += 1) {
        const x = Math.floor(random() * engine.COLS);
        const y = engine.ROWS - 1 - Math.floor(random() * 7);
        if (
          !engine
            .pieceCells(state.active)
            .some((cell) => cell.x === x && cell.y === y)
        ) {
          state.board[y][x] = random() < 0.5 ? "J" : "L";
        }
      }
      if (!engine.isValid(state.board, state.active)) continue;
      const rotated = engine.rotatePiece(
        state.board,
        state.active,
        random() < 0.5 ? -1 : 1,
      );
      if (rotated.rotated)
        expect(engine.isValid(state.board, rotated.piece)).toBe(true);
    }
  });

  it("rejects structurally corrupt snapshots", () => {
    const valid = engine.snapshot(
      engine.createState({ seed: "snapshot-fuzz" }),
    );
    const corrupt = [
      { ...valid, board: [] },
      { ...valid, board: valid.board.map((row) => row.slice(1)) },
      {
        ...valid,
        board: valid.board.map((row, index) =>
          index ? row : ["INVALID", ...row.slice(1)],
        ),
      },
      { ...valid, active: { ...valid.active, kind: "Q" } },
      { ...valid, queue: ["T", "Q"] },
    ];
    for (const value of corrupt) {
      expect(() => engine.restoreSnapshot(value)).toThrow();
    }
  });
});
