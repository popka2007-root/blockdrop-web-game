import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const engine = require("../shared/engine.js");

describe("competitive balance contracts", () => {
  it("uses one capped scoring and attack calculation for special clears", () => {
    expect(
      engine.calculateClearResult({
        lines: 4,
        level: 1,
        combo: 1,
        tSpinType: "",
        perfectClear: false,
        backToBack: false,
      }),
    ).toMatchObject({ score: 800, attack: 4, difficult: true });

    expect(
      engine.calculateClearResult({
        lines: 4,
        level: 1,
        combo: 2,
        tSpinType: "",
        perfectClear: false,
        backToBack: true,
      }),
    ).toMatchObject({ score: 1_250, attack: 6, difficult: true });

    expect(
      engine.calculateClearResult({
        lines: 2,
        level: 1,
        combo: 1,
        tSpinType: "",
        perfectClear: true,
        backToBack: false,
      }),
    ).toMatchObject({ score: 1_500, attack: 11, difficult: false });

    const extreme = engine.calculateClearResult({
      lines: 4,
      level: 99,
      combo: 999,
      tSpinType: "full",
      perfectClear: true,
      backToBack: true,
    });
    expect(extreme.attack).toBe(engine.MAX_ATTACK_PER_LOCK);
    expect(extreme.attack).toBe(12);
  });

  it("caps pending garbage and creates deterministic, readable garbage packets", () => {
    const first = engine.createState({ seed: "garbage-packet" });
    const second = engine.createState({ seed: "garbage-packet" });
    const randomState = first.randomState;
    engine.addGarbage(first, 0);
    expect(first.randomState).toBe(randomState);
    engine.queueGarbage(first, 999);
    expect(first.pendingGarbage).toBe(engine.MAX_PENDING_GARBAGE);

    engine.addGarbage(first, 20);
    engine.addGarbage(second, 20);
    expect(first.board).toEqual(second.board);

    const holes = first.board.map((row) => row.findIndex((cell) => !cell));
    const holeChanges = holes.slice(1).filter((hole, index) => hole !== holes[index]);
    expect(new Set(holes).size).toBeGreaterThan(1);
    expect(holeChanges.length).toBeLessThanOrEqual(8);
  });
});
