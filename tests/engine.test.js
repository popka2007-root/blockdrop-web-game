import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const engine = require("../shared/engine.js");
const goldenReplay = require("../shared/golden-replay.json");

function runScript(seed, inputScript, ticks) {
  const state = engine.createState({ seed });
  const byTick = new Map();
  for (const input of inputScript) {
    const list = byTick.get(input.tick) || [];
    list.push(input);
    byTick.set(input.tick, list);
  }
  while (!state.gameOver && state.tick < ticks) {
    engine.step(state, byTick.get(state.tick) || []);
  }
  return state;
}

describe("deterministic engine", () => {
  it("matches the versioned Node golden checksum", () => {
    const result = engine.simulateReplay(goldenReplay);
    expect(result).toMatchObject({
      ok: true,
      finalChecksum: goldenReplay.finalChecksum,
    });
  });
  const inputs = [
    { tick: 0, seq: 1, action: "left", pressed: true },
    { tick: 1, seq: 2, action: "rotateCW", pressed: true },
    { tick: 2, seq: 3, action: "hardDrop", pressed: true },
    { tick: 3, seq: 4, action: "hold", pressed: true },
    { tick: 4, seq: 5, action: "right", pressed: true },
    { tick: 5, seq: 6, action: "hardDrop", pressed: true },
    { tick: 6, seq: 7, action: "rotateCCW", pressed: true },
    { tick: 7, seq: 8, action: "hardDrop", pressed: true },
  ];

  it("produces identical snapshots for the same seed and input stream", () => {
    const first = runScript("golden-seed", inputs, 120);
    const second = runScript("golden-seed", inputs, 120);
    expect(engine.snapshot(first)).toEqual(engine.snapshot(second));
    expect(engine.checksum(engine.snapshot(first))).toBe(
      engine.checksum(engine.snapshot(second)),
    );
  });

  it("changes the deterministic result when the seed changes", () => {
    const first = runScript("seed-a", inputs, 120);
    const second = runScript("seed-b", inputs, 120);
    expect(engine.checksum(engine.snapshot(first))).not.toBe(
      engine.checksum(engine.snapshot(second)),
    );
  });

  it("ignores duplicate sequence numbers", () => {
    const state = engine.createState({ seed: "duplicates" });
    const startX = state.active.x;
    engine.step(state, [
      { seq: 1, action: "left", pressed: true },
      { seq: 1, action: "left", pressed: true },
    ]);
    expect(state.active.x).toBe(startX - 1);
    expect(state.lastAckSeq).toBe(1);
  });

  it("round-trips versioned snapshots and rejects unknown versions", () => {
    const state = runScript("snapshot", inputs, 40);
    const serialized = engine.snapshot(state);
    expect(engine.restoreSnapshot(serialized)).toEqual(serialized);
    expect(() =>
      engine.restoreSnapshot({ ...serialized, engineVersion: 999 }),
    ).toThrow(/unsupported/i);
  });

  it("re-simulates input replays and verifies the final checksum", () => {
    const finalState = runScript("replay", inputs, 120);
    const replay = engine.createReplay({
      seed: "replay",
      inputs,
      finalState,
    });
    const verified = engine.simulateReplay(replay);
    expect(verified.ok).toBe(true);
    expect(verified.finalChecksum).toBe(replay.finalChecksum);

    const corrupted = {
      ...replay,
      inputs: replay.inputs.filter((input) => input.seq !== 3),
    };
    expect(engine.simulateReplay(corrupted)).toMatchObject({
      ok: false,
      code: "checksumMismatch",
    });
  });

  it("serializes garbage queue and applies deterministic garbage holes", () => {
    const first = engine.createState({ seed: "garbage" });
    const second = engine.createState({ seed: "garbage" });
    engine.queueGarbage(first, 3);
    engine.queueGarbage(second, 3);
    for (let tick = 0; tick < 6; tick += 1) {
      const input = {
        seq: tick + 1,
        action: "hardDrop",
        pressed: true,
      };
      engine.step(first, [input]);
      engine.step(second, [input]);
    }
    expect(first.receivedGarbage).toBe(second.receivedGarbage);
    expect(first.board).toEqual(second.board);
  });
});
